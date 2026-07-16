-- Booking availability is time-sensitive. Enforce the future-start rule in the
-- database as well as the client so stale screens and direct RPC calls cannot
-- create receipts for sessions that have already started.
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
    selected_court.hourly_price * (extract(epoch from (p_ends_at - p_starts_at)) / 3600),
    'PHP', 'pay_at_venue', 'confirmed', p_invite_team,
    case when p_invite_team then p_team_id else null end
  )
  returning * into created;

  return created;
end
$$;
