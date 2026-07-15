-- Record which joined team receives a booking invite instead of storing only
-- an unscoped boolean.
alter table public.bookings
  add column if not exists team_id uuid references public.teams(id) on delete set null;

create index if not exists bookings_team_start_idx
  on public.bookings(team_id, starts_at desc)
  where team_id is not null;

drop policy if exists "team members read invited bookings" on public.bookings;
create policy "team members read invited bookings"
  on public.bookings for select to authenticated
  using (invite_team and team_id is not null and public.is_team_member(team_id));

drop function if exists public.create_booking(text, timestamptz, timestamptz, boolean);

create function public.create_booking(
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
