-- Bookings never recorded which payment method (gcash/paymaya/card/dob) was
-- actually used, so the organizer bookings detail page had nothing to show
-- there. paymongo-webhook already receives this on the payment payload
-- (attributes.source.type) — just wasn't threading it through.

alter table public.bookings add column payment_method text;

-- Adding a trailing defaulted parameter is safe via create or replace (no
-- drop needed) since existing 3-arg callers still resolve correctly.
create or replace function public.record_booking_payment(
  p_booking_id uuid,
  p_paymongo_payment_id text,
  p_amount_paid numeric,
  p_payment_method text default null
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
      paymongo_payment_id = p_paymongo_payment_id,
      payment_method = p_payment_method
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

revoke all on function public.record_booking_payment(uuid, text, numeric, text) from public;
grant execute on function public.record_booking_payment(uuid, text, numeric, text) to service_role;

create or replace function public.list_venue_bookings(p_venue_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.can_manage_venue(p_venue_id) then raise exception 'Venue access required'; end if;

  return coalesce((
    select jsonb_agg(row_to_json(booking_row) order by booking_row.starts_at desc)
    from (
      select
        b.id, b.reference, b.starts_at, b.ends_at, b.amount, b.currency,
        b.status, b.payment_status, b.payment_method, b.created_at,
        c.name as court_name, p.display_name as player_name
      from public.bookings b
      join public.courts c on c.id = b.court_id
      join public.profiles p on p.id = b.user_id
      where b.venue_id = p_venue_id
      order by b.starts_at desc
      limit 200
    ) booking_row
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_venue_bookings(text) from public;
grant execute on function public.list_venue_bookings(text) to authenticated;
