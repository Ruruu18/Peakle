-- Extends the existing cancel_booking RPC (same signature — no client
-- change needed) so venue owners and platform admins can cancel a booking
-- too, and so a paid booking's cancellation actually splits money:
--   - player cancels  -> 15% owner / 5% platform / 80% refunded to player
--   - owner/admin cancels -> 100% refunded to player, owner/platform get ₱0
-- (owners shouldn't be incentivized to cancel low-value bookings for a fee).
-- The free-cancellation cutoff window still applies to player cancellations
-- only; owners/admins can cancel any time (e.g. venue closure).

alter table public.bookings add column cancelled_by uuid references public.profiles(id);

create or replace function public.cancel_booking(
  p_booking_id uuid, p_expected_revision bigint, p_reason text default null
) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare
  current_booking public.bookings;
  selected_venue public.venues;
  before_value jsonb;
  updated public.bookings;
  target_court text;
  target_venue text;
  is_player boolean;
  is_owner_or_admin boolean;
  earnings public.venue_earnings;
  owner_rate numeric(5,4);
  platform_rate numeric(5,4);
  owner_fee numeric(10,2);
  platform_fee_amount numeric(10,2);
  refund_amount numeric(10,2);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select court_id, venue_id into target_court, target_venue from public.bookings
    where id = p_booking_id and status in ('pending', 'confirmed');
  if not found then raise exception 'Booking is no longer cancellable'; end if;

  is_player := exists (select 1 from public.bookings where id = p_booking_id and user_id = auth.uid());
  is_owner_or_admin := public.can_manage_venue(target_venue) or public.is_platform_admin();
  if not is_player and not is_owner_or_admin then raise exception 'You cannot cancel this booking'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_court, 0));
  select * into current_booking from public.bookings
    where id = p_booking_id and status in ('pending', 'confirmed') for update;
  if not found then raise exception 'Booking is no longer cancellable'; end if;
  if current_booking.revision <> p_expected_revision then raise exception 'Booking changed on another device. Refresh and try again'; end if;

  select * into selected_venue from public.venues where id = current_booking.venue_id;
  if is_player and now() > current_booking.starts_at - make_interval(mins => selected_venue.cancellation_cutoff_minutes) then
    raise exception 'The free-cancellation window has closed. Contact the venue';
  end if;

  before_value := to_jsonb(current_booking);
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancellation_reason = nullif(trim(p_reason), ''),
    refund_status = case when current_booking.payment_status = 'paid' then 'pending' else refund_status end,
    revision = revision + 1 where id = current_booking.id returning * into updated;

  select * into earnings from public.venue_earnings where booking_id = p_booking_id and outcome = 'active' for update;
  if earnings.id is not null then
    if is_player then
      select value::numeric into owner_rate from public.platform_config where key = 'cancellation_owner_fee_rate';
      select value::numeric into platform_rate from public.platform_config where key = 'cancellation_platform_fee_rate';
      owner_fee := round(earnings.total_collected * owner_rate, 2);
      platform_fee_amount := round(earnings.total_collected * platform_rate, 2);
    else
      owner_fee := 0;
      platform_fee_amount := 0;
    end if;
    refund_amount := earnings.total_collected - owner_fee - platform_fee_amount;

    if earnings.status in ('requested', 'processing', 'paid') then
      insert into public.venue_earnings_adjustments (venue_id, venue_earnings_id, amount, reason)
      values (
        earnings.venue_id, earnings.id, owner_fee - earnings.venue_amount,
        format('Cancellation after payout: owner entitled to ₱%s only, remainder clawed back', owner_fee)
      );
    end if;

    update public.venue_earnings
    set outcome = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
        original_venue_amount = venue_amount, original_platform_fee = platform_fee,
        venue_amount = owner_fee, platform_fee = platform_fee_amount, refund_amount = refund_amount
    where id = earnings.id;

    insert into public.booking_refunds (
      booking_id, venue_earnings_id, total_collected, refund_amount, owner_fee_retained, platform_fee_retained
    ) values (
      p_booking_id, earnings.id, earnings.total_collected, refund_amount, owner_fee, platform_fee_amount
    );
  end if;

  insert into public.booking_audit_log(booking_id, actor_id, action, before_state, after_state)
    values(updated.id, auth.uid(), 'cancelled', before_value, to_jsonb(updated));
  perform public.offer_next_court_waitlist(updated.court_id, updated.starts_at, updated.ends_at);
  return updated;
end $$;
