-- Migration version normalized to preserve the original execution order.
-- Unpaid bookings temporarily hold a court while checkout is in progress.
-- Players must be able to release that hold at any time, even inside the
-- venue's paid-booking cancellation cutoff. No refund is involved.

create or replace function public.cancel_unpaid_booking(
  p_booking_id uuid,
  p_expected_revision bigint
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_booking public.bookings;
  updated public.bookings;
  before_value jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into current_booking
  from public.bookings
  where id = p_booking_id
    and user_id = auth.uid()
    and status = 'pending'
    and payment_status = 'awaiting_payment'
  for update;

  if not found then raise exception 'This booking is no longer awaiting payment'; end if;
  if current_booking.revision <> p_expected_revision then
    raise exception 'Booking changed on another device. Refresh and try again';
  end if;

  before_value := to_jsonb(current_booking);
  update public.bookings
  set status = 'cancelled',
      payment_status = 'failed',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = 'Payment cancelled by player',
      revision = revision + 1
  where id = current_booking.id
  returning * into updated;

  insert into public.booking_audit_log(booking_id, actor_id, action, before_state, after_state)
  values(updated.id, auth.uid(), 'unpaid_cancelled', before_value, to_jsonb(updated));

  perform public.offer_next_court_waitlist(updated.court_id, updated.starts_at, updated.ends_at);
  return updated;
end;
$$;

revoke all on function public.cancel_unpaid_booking(uuid, bigint) from public;
grant execute on function public.cancel_unpaid_booking(uuid, bigint) to authenticated;
