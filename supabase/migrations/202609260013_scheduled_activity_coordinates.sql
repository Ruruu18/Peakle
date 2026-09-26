-- Player-scheduled activities (games, open play, tournaments, programs) now
-- carry the court's map position, so Home can show how far away they are
-- instead of "Distance unavailable".

alter table public.scheduled_games
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.scheduled_games drop constraint if exists scheduled_games_coordinates_check;
alter table public.scheduled_games add constraint scheduled_games_coordinates_check check (
  (latitude is null and longitude is null)
  or (latitude between -90 and 90 and longitude between -180 and 180)
);

-- Existing activities on listed courts take their venue's pin.
update public.scheduled_games game
set latitude = venue.latitude, longitude = venue.longitude
from public.venues venue
where game.venue_id = venue.id and game.latitude is null
  and venue.latitude is not null and venue.longitude is not null;

-- The new trailing parameters change the signature; drop the old one so
-- PostgREST has a single function to call.
drop function if exists public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[]);

create or replace function public.create_scheduled_activity(
  p_activity_kind text,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_match_type text,
  p_mode text,
  p_visibility text,
  p_capacity integer,
  p_court_label text,
  p_court_area text default null,
  p_venue_id text default null,
  p_court_id text default null,
  p_notes text default null,
  p_invitee_ids uuid[] default '{}',
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns public.scheduled_games
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  host_name text;
  invitees uuid[];
  court_latitude double precision;
  court_longitude double precision;
begin
  if auth.uid() is null then raise exception 'Sign in to schedule an activity.'; end if;
  if p_activity_kind is null or p_activity_kind not in ('game', 'open_play', 'competition', 'program') then
    raise exception 'Choose a valid activity type.';
  end if;
  if p_capacity is null or p_capacity not between 2 and 16 then
    raise exception 'Choose a player limit from 2 to 16.';
  end if;
  if p_activity_kind = 'game' and p_capacity <> (case when p_match_type = 'singles' then 2 else 4 end) then
    raise exception 'Games need 2 players for singles or 4 for doubles.';
  end if;
  if p_activity_kind <> 'game' and coalesce(p_mode, 'casual') <> 'casual' then
    raise exception 'Ranked scoring is only available for games.';
  end if;
  if p_starts_at < now() - interval '5 minutes' then raise exception 'Choose a start time in the future.'; end if;
  if p_starts_at > now() + interval '180 days' then raise exception 'Activities can be scheduled up to 180 days ahead.'; end if;

  select coalesce(array_agg(distinct profile.id), '{}') into invitees
  from public.profiles profile
  where profile.id = any(coalesce(p_invitee_ids, '{}')) and profile.id <> auth.uid();

  if cardinality(invitees) >= coalesce(p_capacity, 4) then
    raise exception 'Invite at most % players for this activity.', coalesce(p_capacity, 4) - 1;
  end if;

  -- A listed Peakle court always uses its venue's pin; a typed-in court keeps
  -- the coordinates the app looked up, when they are plausible.
  if p_venue_id is not null then
    select venue.latitude, venue.longitude into court_latitude, court_longitude
    from public.venues venue where venue.id = p_venue_id;
  elsif p_latitude between -90 and 90 and p_longitude between -180 and 180 then
    court_latitude := p_latitude;
    court_longitude := p_longitude;
  end if;

  insert into public.scheduled_games (
    host_id, activity_kind, title, notes, starts_at, ends_at, match_type, mode, visibility, capacity,
    court_label, court_area, venue_id, court_id, latitude, longitude
  )
  values (
    auth.uid(), p_activity_kind, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_starts_at, p_ends_at,
    coalesce(p_match_type, 'doubles'), coalesce(p_mode, 'casual'), coalesce(p_visibility, 'invite'),
    coalesce(p_capacity, 4), btrim(p_court_label), nullif(btrim(coalesce(p_court_area, '')), ''),
    p_venue_id, case when p_venue_id is null then null else p_court_id end,
    court_latitude, court_longitude
  )
  returning * into game;

  insert into public.scheduled_game_players (game_id, user_id, status, invited_by, responded_at)
  values (game.id, auth.uid(), 'going', auth.uid(), now());

  insert into public.scheduled_game_players (game_id, user_id, status, invited_by)
  select game.id, invitee, 'invited', auth.uid() from unnest(invitees) as invitee;

  select display_name into host_name from public.profiles where id = auth.uid();
  insert into public.user_notifications (user_id, kind, title, body, data)
  select
    invitee,
    'game_invite',
    format('%s invited you to %s', coalesce(host_name, 'A Peakle player'), case p_activity_kind when 'game' then 'a game' when 'open_play' then 'open play' when 'competition' then 'a tournament' else 'a program' end),
    format('%s · %s', game.title, game.court_label),
    jsonb_build_object('gameId', game.id, 'activityKind', game.activity_kind, 'startsAt', game.starts_at, 'dedupeKey', 'game-invite:' || game.id::text || ':' || invitee::text)
  from unnest(invitees) as invitee;

  return game;
end;
$$;

revoke all on function public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[], double precision, double precision) from public;
grant execute on function public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[], double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
