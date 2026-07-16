-- Priority 4: quote-locked pricing, transactional multi-court reservations,
-- venue blackouts, booking changes/cancellations, court waitlists, receipts,
-- and booking reminders. All calendar boundaries are stored as timestamptz;
-- venue-local rule matching uses the venue's IANA time zone.

alter table public.venues
  add column if not exists time_zone text not null default 'Asia/Manila',
  add column if not exists cancellation_cutoff_minutes integer not null default 240
    check (cancellation_cutoff_minutes between 0 and 10080);

alter table public.bookings
  add column if not exists booking_group_id uuid,
  add column if not exists reference text,
  add column if not exists idempotency_key uuid,
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists subtotal numeric(10,2) not null default 0,
  add column if not exists discount_amount numeric(10,2) not null default 0,
  add column if not exists fee_amount numeric(10,2) not null default 0,
  add column if not exists refund_status text not null default 'not_applicable',
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists revision bigint not null default 1;

update public.bookings
set booking_group_id = coalesce(booking_group_id, id),
    reference = coalesce(reference, 'PKL-' || upper(substr(replace(id::text, '-', ''), 1, 10))),
    subtotal = case when subtotal = 0 then amount else subtotal end
where booking_group_id is null or reference is null or subtotal = 0;

alter table public.bookings alter column booking_group_id set not null;
alter table public.bookings alter column reference set not null;
alter table public.bookings drop constraint if exists bookings_refund_status_check;
alter table public.bookings add constraint bookings_refund_status_check
  check (refund_status in ('not_applicable', 'pending', 'partially_refunded', 'refunded', 'failed'));
create unique index if not exists bookings_reference_idx on public.bookings(reference, court_id);
create unique index if not exists bookings_idempotency_idx
  on public.bookings(user_id, idempotency_key, court_id) where idempotency_key is not null;
create index if not exists bookings_group_idx on public.bookings(booking_group_id);

create table if not exists public.venue_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues(id) on delete cascade,
  court_id text references public.courts(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  rule_type text not null check (rule_type in ('peak', 'off_peak', 'holiday', 'membership', 'promotion')),
  adjustment_type text not null check (adjustment_type in ('fixed_hourly', 'percentage', 'flat_discount')),
  adjustment_value numeric(10,2) not null,
  days_of_week smallint[] check (days_of_week is null or days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  starts_at_local time,
  ends_at_local time,
  valid_from date,
  valid_until date,
  promo_code text,
  priority integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check (rule_type = 'promotion' or promo_code is null),
  check (adjustment_type <> 'percentage' or adjustment_value between -100 and 1000)
);
create index if not exists venue_pricing_rules_match_idx
  on public.venue_pricing_rules(venue_id, active, priority desc);

create table if not exists public.venue_membership_entitlements (
  venue_id text not null references public.venues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Member',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  primary key (venue_id, user_id),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.court_blackouts (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues(id) on delete cascade,
  court_id text references public.courts(id) on delete cascade,
  kind text not null check (kind in ('maintenance', 'private_event', 'closure')),
  reason text not null check (char_length(trim(reason)) between 2 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists court_blackouts_window_idx
  on public.court_blackouts(venue_id, court_id, starts_at, ends_at);

create table if not exists public.booking_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  venue_id text not null references public.venues(id) on delete cascade,
  court_ids text[] not null check (cardinality(court_ids) between 1 and 20),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  promo_code text,
  subtotal numeric(10,2) not null,
  discount_amount numeric(10,2) not null default 0,
  fee_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  currency text not null default 'PHP',
  breakdown jsonb not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (subtotal >= 0 and discount_amount >= 0 and fee_amount >= 0 and total >= 0)
);
create index if not exists booking_quotes_user_idx on public.booking_quotes(user_id, expires_at desc);

create table if not exists public.court_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  venue_id text not null references public.venues(id) on delete cascade,
  court_id text not null references public.courts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  offered_at timestamptz,
  offer_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, court_id, starts_at, ends_at),
  check (ends_at > starts_at)
);
create index if not exists court_waitlist_position_idx
  on public.court_waitlist(court_id, starts_at, created_at) where status = 'waiting';

create table if not exists public.booking_audit_log (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('created', 'modified', 'cancelled', 'waitlist_promoted')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

alter table public.venue_pricing_rules enable row level security;
alter table public.venue_membership_entitlements enable row level security;
alter table public.court_blackouts enable row level security;
alter table public.booking_quotes enable row level security;
alter table public.court_waitlist enable row level security;
alter table public.booking_audit_log enable row level security;

create policy "staff manage venue pricing" on public.venue_pricing_rules for all to authenticated
  using (public.can_manage_venue(venue_id)) with check (public.can_manage_venue(venue_id));
create policy "staff manage venue memberships" on public.venue_membership_entitlements for all to authenticated
  using (public.can_manage_venue(venue_id)) with check (public.can_manage_venue(venue_id));
create policy "members read own venue membership" on public.venue_membership_entitlements for select to authenticated
  using (user_id = auth.uid());
create policy "staff manage court blackouts" on public.court_blackouts for all to authenticated
  using (public.can_manage_venue(venue_id)) with check (public.can_manage_venue(venue_id) and created_by = auth.uid());
create policy "users read own booking quotes" on public.booking_quotes for select to authenticated
  using (user_id = auth.uid());
create policy "users read own waitlist" on public.court_waitlist for select to authenticated
  using (user_id = auth.uid());
create policy "users leave own waitlist" on public.court_waitlist for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users read own booking audit" on public.booking_audit_log for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = auth.uid()));

create or replace function public.booking_court_is_available(
  p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking uuid default null
) returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.court_id = p_court_id and b.id is distinct from p_exclude_booking
      and b.status in ('pending', 'confirmed')
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) and not exists (
    select 1 from public.court_blackouts blackout
    join public.courts c on c.id = p_court_id
    where blackout.venue_id = c.venue_id
      and (blackout.court_id is null or blackout.court_id = p_court_id)
      and tstzrange(blackout.starts_at, blackout.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  )
$$;

create or replace function public.get_court_availability(
  p_court_ids text[], p_starts_at timestamptz, p_ends_at timestamptz
) returns table(court_id text, available boolean, reason text)
language sql stable security definer set search_path = '' as $$
  select c.id,
    public.booking_court_is_available(c.id, p_starts_at, p_ends_at, null),
    case
      when not c.active then 'Court unavailable'
      when exists (select 1 from public.court_blackouts x where x.venue_id = c.venue_id
        and (x.court_id is null or x.court_id = c.id)
        and tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then 'Venue blackout'
      when exists (select 1 from public.bookings b where b.court_id = c.id and b.status in ('pending','confirmed')
        and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then 'Booked'
      else null end
  from public.courts c where c.id = any(p_court_ids)
$$;

create or replace function public.get_court_schedule(
  p_court_ids text[], p_starts_at timestamptz, p_ends_at timestamptz
) returns table(court_id text, starts_at timestamptz, ends_at timestamptz, reason text)
language sql stable security definer set search_path = '' as $$
  select b.court_id, b.starts_at, b.ends_at, 'Booked'::text
  from public.bookings b
  where b.court_id = any(p_court_ids) and b.status in ('pending','confirmed')
    and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  union all
  select c.id, blackout.starts_at, blackout.ends_at, blackout.reason
  from public.court_blackouts blackout
  join public.courts c on c.venue_id = blackout.venue_id
    and (blackout.court_id is null or blackout.court_id = c.id)
  where c.id = any(p_court_ids)
    and tstzrange(blackout.starts_at, blackout.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
$$;

create or replace function public.quote_booking(
  p_court_ids text[], p_starts_at timestamptz, p_ends_at timestamptz, p_promo_code text default null
) returns public.booking_quotes language plpgsql security definer set search_path = '' as $$
declare
  selected_venue public.venues;
  court_count integer;
  hours numeric;
  subtotal_value numeric := 0;
  total_value numeric := 0;
  line_base numeric;
  line_total numeric;
  discount_value numeric := 0;
  matching_rule public.venue_pricing_rules;
  current_court public.courts;
  local_start timestamp;
  local_end timestamp;
  lines jsonb := '[]'::jsonb;
  created public.booking_quotes;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_ends_at <= p_starts_at or p_starts_at <= now() then raise exception 'Choose a future booking time'; end if;
  if cardinality(p_court_ids) is null or cardinality(p_court_ids) < 1 or cardinality(p_court_ids) > 20 then
    raise exception 'Choose between 1 and 20 courts';
  end if;
  if cardinality(array(select distinct unnest(p_court_ids))) <> cardinality(p_court_ids) then raise exception 'A court was selected twice'; end if;

  select count(distinct c.id), max(v.id) into court_count, selected_venue.id
  from public.courts c join public.venues v on v.id = c.venue_id
  where c.id = any(p_court_ids) and c.active and v.active;
  if court_count <> cardinality(p_court_ids) then raise exception 'One or more courts are unavailable'; end if;
  if (select count(distinct venue_id) from public.courts where id = any(p_court_ids)) <> 1 then raise exception 'All courts must be at one venue'; end if;
  select * into selected_venue from public.venues where id = selected_venue.id;
  local_start := p_starts_at at time zone selected_venue.time_zone;
  local_end := p_ends_at at time zone selected_venue.time_zone;
  if local_start::date <> local_end::date and local_end::time <> time '00:00' then raise exception 'Bookings cannot cross venue calendar days'; end if;
  if selected_venue.opens_at is not null and local_start::time < selected_venue.opens_at then raise exception 'The venue is not open yet'; end if;
  if selected_venue.closes_at is not null and local_end::time > selected_venue.closes_at then raise exception 'The venue is closed by this time'; end if;
  hours := extract(epoch from (p_ends_at - p_starts_at)) / 3600;

  for current_court in select * from public.courts where id = any(p_court_ids) order by id loop
    if not public.booking_court_is_available(current_court.id, p_starts_at, p_ends_at, null) then
      raise exception '% is no longer available', current_court.name;
    end if;
    line_base := round(current_court.hourly_price * hours, 2);
    line_total := line_base;
    matching_rule := null;
    select rule.* into matching_rule from public.venue_pricing_rules rule
    where rule.venue_id = current_court.venue_id and rule.active
      and (rule.court_id is null or rule.court_id = current_court.id)
      and (rule.valid_from is null or local_start::date >= rule.valid_from)
      and (rule.valid_until is null or local_start::date <= rule.valid_until)
      and (rule.days_of_week is null or extract(dow from local_start)::smallint = any(rule.days_of_week))
      and (rule.starts_at_local is null or local_start::time >= rule.starts_at_local)
      and (rule.ends_at_local is null or local_end::time <= rule.ends_at_local)
      and (rule.rule_type <> 'promotion' or upper(rule.promo_code) = upper(trim(p_promo_code)))
      and (rule.rule_type <> 'membership' or exists (
        select 1 from public.venue_membership_entitlements entitlement
        where entitlement.venue_id = rule.venue_id and entitlement.user_id = auth.uid() and entitlement.active
          and entitlement.starts_at <= now() and (entitlement.ends_at is null or entitlement.ends_at > now())
      ))
    order by rule.priority desc, rule.created_at desc limit 1;
    if found then
      line_total := case matching_rule.adjustment_type
        when 'fixed_hourly' then round(greatest(0, matching_rule.adjustment_value) * hours, 2)
        when 'percentage' then round(greatest(0, line_base * (1 + matching_rule.adjustment_value / 100)), 2)
        when 'flat_discount' then round(greatest(0, line_base - matching_rule.adjustment_value), 2)
      end;
    end if;
    subtotal_value := subtotal_value + line_base;
    total_value := total_value + line_total;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'courtId', current_court.id, 'courtName', current_court.name, 'baseAmount', line_base,
      'amount', line_total, 'ruleId', matching_rule.id, 'ruleName', matching_rule.name
    ));
  end loop;
  discount_value := greatest(0, subtotal_value - total_value);
  insert into public.booking_quotes(user_id, venue_id, court_ids, starts_at, ends_at, promo_code,
    subtotal, discount_amount, fee_amount, total, breakdown)
  values(auth.uid(), selected_venue.id, p_court_ids, p_starts_at, p_ends_at, nullif(upper(trim(p_promo_code)), ''),
    subtotal_value, discount_value, 0, total_value,
    jsonb_build_object('timeZone', selected_venue.time_zone, 'lines', lines,
      'subtotal', subtotal_value, 'discount', discount_value, 'fees', 0, 'total', total_value))
  returning * into created;
  return created;
end $$;

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
      (line->>'amount')::numeric, quote.currency, 'pay_at_venue', 'confirmed', p_invite_team,
      case when p_invite_team then p_team_id else null end, group_id, reference_value, p_idempotency_key,
      line, (line->>'baseAmount')::numeric,
      greatest(0, (line->>'baseAmount')::numeric - (line->>'amount')::numeric), 0)
    returning * into created;
    insert into public.booking_audit_log(booking_id, actor_id, action, after_state)
      values(created.id, auth.uid(), 'created', to_jsonb(created));
    return next created;
  end loop;
  update public.booking_quotes set consumed_at = now() where id = quote.id;
exception when exclusion_violation or unique_violation then
  raise exception 'A selected court was just reserved. No duplicate booking was created';
end $$;

create or replace function public.modify_booking(
  p_booking_id uuid, p_quote_id uuid, p_expected_revision bigint
) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare current_booking public.bookings; quote public.booking_quotes; before_value jsonb; updated public.bookings; line jsonb;
begin
  select * into current_booking from public.bookings
    where id = p_booking_id and user_id = auth.uid() and status in ('pending','confirmed') for update;
  if not found then raise exception 'Booking is no longer available'; end if;
  if current_booking.revision <> p_expected_revision then raise exception 'Booking changed on another device. Refresh and try again'; end if;
  select * into quote from public.booking_quotes where id = p_quote_id and user_id = auth.uid() and expires_at > now() for update;
  if not found or cardinality(quote.court_ids) <> 1 then raise exception 'A current single-court quote is required'; end if;
  if quote.venue_id <> current_booking.venue_id then raise exception 'Choose a court at the same venue'; end if;
  if not public.booking_court_is_available(quote.court_ids[1], quote.starts_at, quote.ends_at, current_booking.id) then raise exception 'That time was just reserved'; end if;
  before_value := to_jsonb(current_booking);
  select value into line from jsonb_array_elements(quote.breakdown->'lines') value;
  update public.bookings set court_id = quote.court_ids[1], starts_at = quote.starts_at, ends_at = quote.ends_at,
    amount = quote.total, pricing_snapshot = line, subtotal = quote.subtotal,
    discount_amount = quote.discount_amount, fee_amount = quote.fee_amount, revision = revision + 1
  where id = current_booking.id returning * into updated;
  update public.booking_quotes set consumed_at = now() where id = quote.id;
  insert into public.booking_audit_log(booking_id, actor_id, action, before_state, after_state)
    values(updated.id, auth.uid(), 'modified', before_value, to_jsonb(updated));
  return updated;
exception when exclusion_violation then raise exception 'That time was just reserved';
end $$;

create or replace function public.join_court_waitlist(
  p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz
) returns public.court_waitlist language plpgsql security definer set search_path = '' as $$
declare selected_court public.courts; result public.court_waitlist;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_starts_at <= now() or p_ends_at <= p_starts_at then raise exception 'Choose a future time'; end if;
  select * into selected_court from public.courts where id = p_court_id and active;
  if not found then raise exception 'Court unavailable'; end if;
  if public.booking_court_is_available(p_court_id, p_starts_at, p_ends_at, null) then raise exception 'This court is available now. Book it instead'; end if;
  insert into public.court_waitlist(user_id, venue_id, court_id, starts_at, ends_at)
  values(auth.uid(), selected_court.venue_id, p_court_id, p_starts_at, p_ends_at)
  on conflict(user_id, court_id, starts_at, ends_at) do update set status = 'waiting', updated_at = now()
  returning * into result;
  return result;
end $$;

create or replace function public.offer_next_court_waitlist(
  p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare next_entry public.court_waitlist; venue_name text; court_name text;
begin
  if not public.booking_court_is_available(p_court_id, p_starts_at, p_ends_at, null) then return; end if;
  select * into next_entry from public.court_waitlist
    where court_id = p_court_id and status = 'waiting'
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
    order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.court_waitlist set status = 'offered', offered_at = now(), offer_expires_at = now() + interval '15 minutes'
    where id = next_entry.id;
  select v.name, c.name into venue_name, court_name from public.courts c join public.venues v on v.id = c.venue_id where c.id = p_court_id;
  insert into public.user_notifications(user_id, kind, title, body, data)
  values(next_entry.user_id, 'court_waitlist', 'A court opened up',
    court_name || ' at ' || venue_name || ' is available for 15 minutes.',
    jsonb_build_object('waitlistId', next_entry.id, 'courtId', p_court_id));
end $$;

create or replace function public.cancel_booking(
  p_booking_id uuid, p_expected_revision bigint, p_reason text default null
) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare current_booking public.bookings; selected_venue public.venues; before_value jsonb; updated public.bookings;
begin
  select * into current_booking from public.bookings
    where id = p_booking_id and user_id = auth.uid() and status in ('pending','confirmed') for update;
  if not found then raise exception 'Booking is no longer cancellable'; end if;
  if current_booking.revision <> p_expected_revision then raise exception 'Booking changed on another device. Refresh and try again'; end if;
  select * into selected_venue from public.venues where id = current_booking.venue_id;
  if now() > current_booking.starts_at - make_interval(mins => selected_venue.cancellation_cutoff_minutes) then
    raise exception 'The free-cancellation window has closed. Contact the venue';
  end if;
  before_value := to_jsonb(current_booking);
  update public.bookings set status = 'cancelled', cancelled_at = now(),
    cancellation_reason = nullif(trim(p_reason), ''), refund_status = case when payment_status = 'pay_at_venue' then 'not_applicable' else 'pending' end,
    revision = revision + 1 where id = current_booking.id returning * into updated;
  insert into public.booking_audit_log(booking_id, actor_id, action, before_state, after_state)
    values(updated.id, auth.uid(), 'cancelled', before_value, to_jsonb(updated));
  perform public.offer_next_court_waitlist(updated.court_id, updated.starts_at, updated.ends_at);
  return updated;
end $$;

-- Priority 3 created the notification type; extend it for booking operations.
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'approval','waitlist_promotion','check_in_reminder','court_assignment','match_point','result',
  'cancellation','venue_announcement','booking_reminder','court_waitlist','booking_changed'
));
alter table public.user_notifications add column if not exists booking_id uuid references public.bookings(id) on delete cascade;
create unique index if not exists booking_reminder_dedupe_idx
  on public.user_notifications(user_id, booking_id, kind, ((data->>'startsAt'))) where kind = 'booking_reminder';

create or replace function public.queue_booking_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  insert into public.user_notifications(user_id, booking_id, kind, title, body, data)
  select booking.user_id, booking.id, 'booking_reminder', 'Court booking starts soon',
    court.name || ' at ' || venue.name || ' starts at ' || to_char(booking.starts_at at time zone venue.time_zone, 'FMHH12:MI AM') || '.',
    jsonb_build_object('bookingId', booking.id, 'startsAt', booking.starts_at::text)
  from public.bookings booking join public.courts court on court.id = booking.court_id
  join public.venues venue on venue.id = booking.venue_id
  where booking.status = 'confirmed' and booking.starts_at between now() + interval '25 minutes' and now() + interval '35 minutes'
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end $$;

revoke all on function public.booking_court_is_available(text,timestamptz,timestamptz,uuid) from public;
revoke all on function public.get_court_availability(text[],timestamptz,timestamptz) from public;
revoke all on function public.get_court_schedule(text[],timestamptz,timestamptz) from public;
revoke all on function public.quote_booking(text[],timestamptz,timestamptz,text) from public;
revoke all on function public.create_multi_court_booking(uuid,uuid,boolean,uuid) from public;
revoke all on function public.modify_booking(uuid,uuid,bigint) from public;
revoke all on function public.join_court_waitlist(text,timestamptz,timestamptz) from public;
revoke all on function public.offer_next_court_waitlist(text,timestamptz,timestamptz) from public;
revoke all on function public.cancel_booking(uuid,bigint,text) from public;
revoke all on function public.queue_booking_reminders() from public;
grant execute on function public.get_court_availability(text[],timestamptz,timestamptz) to authenticated;
grant execute on function public.get_court_schedule(text[],timestamptz,timestamptz) to authenticated;
grant execute on function public.quote_booking(text[],timestamptz,timestamptz,text) to authenticated;
grant execute on function public.create_multi_court_booking(uuid,uuid,boolean,uuid) to authenticated;
grant execute on function public.modify_booking(uuid,uuid,bigint) to authenticated;
grant execute on function public.join_court_waitlist(text,timestamptz,timestamptz) to authenticated;
grant execute on function public.cancel_booking(uuid,bigint,text) to authenticated;
grant execute on function public.queue_booking_reminders() to service_role;

-- Realtime availability and waitlist status updates.
do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.court_blackouts;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.court_waitlist;
exception when duplicate_object then null; end $$;
