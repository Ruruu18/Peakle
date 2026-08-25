-- Real online payment collection via PayMongo. Bookings are still created
-- (and the slot still held, via the existing exclusion constraint) exactly
-- as before — create_booking/create_multi_court_booking are only changed
-- to start bookings in 'awaiting_payment'/'pending' instead of assuming
-- pay-at-venue. Payment itself is layered on top via edge functions:
--   1. create-checkout-session — opens a PayMongo Checkout Session for an
--      already-created booking.
--   2. paymongo-webhook — confirms payment server-side and calls
--      record_booking_payment, which is where the venue_earnings split
--      actually gets written.
--   3. process-refund — used on cancellation to actually return money via
--      PayMongo's Refunds API.
-- Abandoned checkouts are swept by expire_unpaid_bookings on a pg_cron
-- schedule so the held slot doesn't stay blocked forever.

alter table public.bookings
  add column paymongo_checkout_session_id text,
  add column paymongo_payment_id text;

create unique index bookings_paymongo_checkout_session_idx
  on public.bookings (paymongo_checkout_session_id)
  where paymongo_checkout_session_id is not null;

alter table public.bookings
  add constraint bookings_payment_status_check
  check (payment_status in ('pay_at_venue', 'awaiting_payment', 'paid', 'refunded', 'partially_refunded', 'failed'));

alter table public.bookings alter column payment_status set default 'awaiting_payment';

-- Same signature as the existing RPC (202607160008) — only the initial
-- payment_status/status values change, from pay-at-venue/confirmed to
-- awaiting-payment/pending.
create or replace function public.create_booking(
  p_court_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_invite_team boolean default false,
  p_team_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_court public.courts;
  created public.bookings;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Invalid booking duration'; end if;
  if p_starts_at <= now() then raise exception 'Choose a future booking time'; end if;
  if p_invite_team and p_team_id is null then raise exception 'Choose a team to invite'; end if;
  if p_team_id is not null and not public.is_team_member(p_team_id) then
    raise exception 'You can only invite a team you have joined';
  end if;

  select * into selected_court
  from public.courts
  where id = p_court_id and active;
  if not found then raise exception 'Court is unavailable'; end if;

  insert into public.bookings(
    user_id, venue_id, court_id, starts_at, ends_at, amount, currency,
    payment_status, status, invite_team, team_id
  )
  values(
    auth.uid(), selected_court.venue_id, selected_court.id, p_starts_at, p_ends_at,
    round(selected_court.hourly_price * (extract(epoch from (p_ends_at - p_starts_at)) / 3600), 2),
    'PHP', 'awaiting_payment', 'pending', p_invite_team,
    case when p_invite_team then p_team_id else null end
  )
  returning * into created;

  return created;
end
$$;

-- Same signature as the existing RPC (202607170003) — only the initial
-- payment_status/status values change.
create or replace function public.create_multi_court_booking(
  p_quote_id uuid, p_idempotency_key uuid, p_invite_team boolean default false, p_team_id uuid default null
) returns setof public.bookings language plpgsql security definer set search_path = '' as $$
declare
  quote public.booking_quotes;
  court_id_value text;
  current_court public.courts;
  line jsonb;
  created public.bookings;
  group_id uuid := gen_random_uuid();
  reference_value text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null then raise exception 'A request key is required'; end if;
  if exists (select 1 from public.bookings b where b.user_id = auth.uid() and b.idempotency_key = p_idempotency_key) then
    return query select * from public.bookings b where b.user_id = auth.uid() and b.idempotency_key = p_idempotency_key order by b.court_id;
    return;
  end if;
  select * into quote from public.booking_quotes where id = p_quote_id and user_id = auth.uid() for update;
  if not found or quote.expires_at <= now() then raise exception 'Your price quote expired. Review the updated total'; end if;
  if quote.consumed_at is not null then raise exception 'This price quote was already used'; end if;
  if p_invite_team and (p_team_id is null or not public.is_team_member(p_team_id)) then raise exception 'Choose a team you have joined'; end if;
  foreach court_id_value in array (select array_agg(value order by value) from unnest(quote.court_ids) value) loop
    perform pg_advisory_xact_lock(hashtextextended(court_id_value, 0));
  end loop;
  reference_value := 'PKL-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-' || upper(substr(replace(group_id::text, '-', ''), 1, 8));
  foreach court_id_value in array quote.court_ids loop
    select * into current_court from public.courts where id = court_id_value and active;
    if not found or not public.booking_court_is_available(court_id_value, quote.starts_at, quote.ends_at, null) then
      raise exception 'One of the selected courts was just reserved. No booking was created';
    end if;
    select value into line from jsonb_array_elements(quote.breakdown->'lines') value where value->>'courtId' = court_id_value;
    insert into public.bookings(user_id, venue_id, court_id, starts_at, ends_at, amount, currency,
      payment_status, status, invite_team, team_id, booking_group_id, reference, idempotency_key,
      pricing_snapshot, subtotal, discount_amount, fee_amount)
    values(auth.uid(), quote.venue_id, court_id_value, quote.starts_at, quote.ends_at,
      (line->>'amount')::numeric, quote.currency, 'awaiting_payment', 'pending', p_invite_team,
      case when p_invite_team then p_team_id else null end, group_id, reference_value, p_idempotency_key,
      line, (line->>'baseAmount')::numeric,
      greatest(0, (line->>'baseAmount')::numeric - (line->>'amount')::numeric), 0)
    returning * into created;
    insert into public.booking_audit_log(booking_id, actor_id, action, after_state)
      values(created.id, auth.uid(), 'created', to_jsonb(created));
    update public.court_waitlist set status = 'booked', updated_at = now()
      where user_id = auth.uid() and court_id = court_id_value and status = 'offered'
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(quote.starts_at, quote.ends_at, '[)');
    return next created;
  end loop;
  update public.booking_quotes set consumed_at = now() where id = quote.id;
exception when exclusion_violation or unique_violation then
  raise exception 'A selected court was just reserved. No duplicate booking was created';
end $$;

-- Only the paymongo-webhook edge function (using the service-role key)
-- should ever call this — it's where the venue_earnings split is written,
-- so it must not be reachable by a regular authenticated client.
create or replace function public.record_booking_payment(
  p_booking_id uuid,
  p_paymongo_payment_id text,
  p_amount_paid numeric
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.bookings;
  paid_court public.courts;
  v_fee_rate numeric(5,4);
  v_platform_fee numeric(10,2);
  v_venue_amount numeric(10,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'This action is only available to the payment webhook';
  end if;

  update public.bookings
  set payment_status = 'paid',
      status = case when status = 'pending' then 'confirmed' else status end,
      paymongo_payment_id = p_paymongo_payment_id
  where id = p_booking_id and payment_status = 'awaiting_payment'
  returning * into updated;

  if updated.id is null then
    -- Already recorded (webhook retry) or booking not in an expected
    -- state — return the current row instead of erroring so PayMongo's
    -- retry doesn't keep failing.
    select * into updated from public.bookings where id = p_booking_id;
    return updated;
  end if;

  select * into paid_court from public.courts where id = updated.court_id;
  v_fee_rate := coalesce(
    paid_court.platform_fee_rate,
    (select value::numeric from public.platform_config where key = 'platform_fee_rate')
  );
  v_platform_fee := round(p_amount_paid * v_fee_rate, 2);
  v_venue_amount := p_amount_paid - v_platform_fee;

  insert into public.venue_earnings (venue_id, booking_id, total_collected, platform_fee, venue_amount, fee_rate)
  values (updated.venue_id, updated.id, p_amount_paid, v_platform_fee, v_venue_amount, v_fee_rate)
  on conflict (booking_id) do nothing;

  return updated;
end;
$$;

revoke all on function public.record_booking_payment(uuid, text, numeric) from public;
grant execute on function public.record_booking_payment(uuid, text, numeric) to service_role;

create or replace function public.expire_unpaid_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.bookings
  set status = 'cancelled',
      payment_status = 'failed',
      cancelled_at = now(),
      cancellation_reason = 'Payment window expired'
  where payment_status = 'awaiting_payment'
    and status = 'pending'
    and created_at < now() - interval '20 minutes';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_unpaid_bookings() from public;

do $$
begin
  create extension if not exists pg_cron;
exception when insufficient_privilege then
  raise notice 'pg_cron could not be enabled automatically — enable it via Supabase Dashboard > Database > Extensions, then re-run the cron.schedule below.';
end
$$;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'expire-unpaid-bookings') then
      perform cron.unschedule('expire-unpaid-bookings');
    end if;
    perform cron.schedule('expire-unpaid-bookings', '*/5 * * * *', $job$select public.expire_unpaid_bookings();$job$);
  end if;
end
$cron$;
