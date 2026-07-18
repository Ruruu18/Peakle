alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'approval','waitlist_promotion','check_in_reminder','court_assignment','match_point','result',
  'cancellation','venue_announcement','booking_reminder','court_waitlist','booking_changed',
  'booking_confirmed'
));

create unique index if not exists user_notifications_booking_confirmation_dedupe_idx
  on public.user_notifications(user_id, kind, ((data->>'dedupeKey')))
  where kind = 'booking_confirmed';

create or replace function public.notify_booking_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  venue_name text;
  venue_time_zone text;
  dedupe_key text := coalesce(new.booking_group_id, new.id)::text;
begin
  select venue.name, venue.time_zone
  into venue_name, venue_time_zone
  from public.venues venue
  where venue.id = new.venue_id;

  insert into public.user_notifications(user_id, booking_id, kind, title, body, data)
  values(
    new.user_id,
    new.id,
    'booking_confirmed',
    'Booking confirmed',
    format('%s · %s', coalesce(venue_name, 'Court reservation'),
      to_char(new.starts_at at time zone coalesce(venue_time_zone, 'Asia/Manila'), 'Mon DD, YYYY · FMHH12:MI AM')),
    jsonb_build_object(
      'bookingId', new.id,
      'bookingGroupId', new.booking_group_id,
      'dedupeKey', dedupe_key,
      'reference', new.reference,
      'venueId', new.venue_id,
      'courtId', new.court_id,
      'startsAt', new.starts_at,
      'endsAt', new.ends_at
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.notify_booking_confirmed() from public;

drop trigger if exists notify_booking_confirmed_after_insert on public.bookings;
create trigger notify_booking_confirmed_after_insert
after insert on public.bookings
for each row
when (new.status = 'confirmed')
execute function public.notify_booking_confirmed();

with upcoming_bookings as (
  select booking.*,
    row_number() over (
      partition by booking.user_id, coalesce(booking.booking_group_id, booking.id)
      order by booking.created_at, booking.id
    ) as group_position
  from public.bookings booking
  where booking.status = 'confirmed' and booking.ends_at > now()
)
insert into public.user_notifications(user_id, booking_id, kind, title, body, data)
select
  booking.user_id,
  booking.id,
  'booking_confirmed',
  'Booking confirmed',
  format('%s · %s', venue.name,
    to_char(booking.starts_at at time zone coalesce(venue.time_zone, 'Asia/Manila'), 'Mon DD, YYYY · FMHH12:MI AM')),
  jsonb_build_object(
    'bookingId', booking.id,
    'bookingGroupId', booking.booking_group_id,
    'dedupeKey', coalesce(booking.booking_group_id, booking.id)::text,
    'reference', booking.reference,
    'venueId', booking.venue_id,
    'courtId', booking.court_id,
    'startsAt', booking.starts_at,
    'endsAt', booking.ends_at
  )
from upcoming_bookings booking
join public.venues venue on venue.id = booking.venue_id
where booking.group_position = 1
on conflict do nothing;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.user_notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to authenticated;
