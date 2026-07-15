-- Let players safely extend an active court reservation and preserve an
-- unfinished score without including it in completed-match statistics.

alter table public.matches
  add column if not exists resume_state jsonb;

create or replace function public.extend_booking(
  p_booking_id uuid,
  p_minutes integer default 30
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_booking public.bookings;
  selected_court public.courts;
  selected_venue public.venues;
  extended public.bookings;
  proposed_end timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_minutes <> 30 then raise exception 'Bookings can only be extended by 30 minutes'; end if;

  select * into current_booking
  from public.bookings
  where id = p_booking_id
    and user_id = auth.uid()
    and status in ('pending', 'confirmed')
  for update;

  if not found then raise exception 'Booking is no longer available'; end if;
  if now() < current_booking.ends_at - interval '15 minutes' then
    raise exception 'Extensions open 15 minutes before the booking ends';
  end if;
  if now() > current_booking.ends_at + interval '10 minutes' then
    raise exception 'This booking has already ended';
  end if;

  proposed_end := current_booking.ends_at + make_interval(mins => p_minutes);

  select * into selected_venue from public.venues where id = current_booking.venue_id;
  if (proposed_end at time zone 'Asia/Manila')::time > selected_venue.closes_at then
    raise exception 'The venue closes before this extension would end';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.court_id = current_booking.court_id
      and b.id <> current_booking.id
      and b.status in ('pending', 'confirmed')
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(current_booking.ends_at, proposed_end, '[)')
  ) then
    raise exception 'The next 30-minute slot is already booked';
  end if;

  select * into selected_court from public.courts where id = current_booking.court_id;

  update public.bookings
  set ends_at = proposed_end,
      amount = amount + selected_court.hourly_price * (p_minutes::numeric / 60),
      updated_at = now()
  where id = current_booking.id
  returning * into extended;

  return extended;
exception
  when exclusion_violation then
    raise exception 'The next 30-minute slot was just booked by another player';
end
$$;

revoke all on function public.extend_booking(uuid, integer) from public;
grant execute on function public.extend_booking(uuid, integer) to authenticated;
