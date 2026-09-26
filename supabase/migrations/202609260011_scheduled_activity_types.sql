-- Players can categorize their own scheduled Peakle activities. Keep the
-- existing game IDs, rosters, visibility rules and legacy creation RPC intact.
alter table public.scheduled_games
  add column if not exists activity_kind text not null default 'game'
  check (activity_kind in ('game', 'open_play', 'competition', 'program'));

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
  p_invitee_ids uuid[] default '{}'
)
returns public.scheduled_games
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  host_name text;
  invitees uuid[];
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

  insert into public.scheduled_games (
    host_id, activity_kind, title, notes, starts_at, ends_at, match_type, mode, visibility, capacity,
    court_label, court_area, venue_id, court_id
  )
  values (
    auth.uid(), p_activity_kind, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_starts_at, p_ends_at,
    coalesce(p_match_type, 'doubles'), coalesce(p_mode, 'casual'), coalesce(p_visibility, 'invite'),
    coalesce(p_capacity, 4), btrim(p_court_label), nullif(btrim(coalesce(p_court_area, '')), ''),
    p_venue_id, case when p_venue_id is null then null else p_court_id end
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

create or replace function public.respond_scheduled_game(p_game_id uuid, p_going boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  membership public.scheduled_game_players;
  going_count integer;
  player_name text;
begin
  if auth.uid() is null then raise exception 'Sign in to respond to this activity.'; end if;
  select * into game from public.scheduled_games where id = p_game_id for update;
  if game.id is null or not public.can_view_scheduled_game(game.id) then raise exception 'This activity is no longer available.'; end if;
  if game.status <> 'scheduled' then raise exception 'This activity was cancelled.'; end if;
  if game.ends_at < now() then raise exception 'This activity has already ended.'; end if;
  if game.host_id = auth.uid() then raise exception 'You are hosting this activity. Cancel it instead.'; end if;

  select * into membership from public.scheduled_game_players where game_id = game.id and user_id = auth.uid();
  if p_going and coalesce(membership.status, '') <> 'going' then
    select count(*) into going_count from public.scheduled_game_players where game_id = game.id and status = 'going';
    if going_count >= game.capacity then raise exception 'This activity is full.'; end if;
  end if;

  insert into public.scheduled_game_players (game_id, user_id, status, invited_by, responded_at)
  values (game.id, auth.uid(), case when p_going then 'going' else 'declined' end, null, now())
  on conflict (game_id, user_id) do update
  set status = excluded.status, responded_at = now();

  if coalesce(membership.status, '') is distinct from (case when p_going then 'going' else 'declined' end) then
    select display_name into player_name from public.profiles where id = auth.uid();
    insert into public.user_notifications (user_id, kind, title, body, data)
    values (
      game.host_id,
      'game_response',
      format('%s %s', coalesce(player_name, 'A player'), case when p_going then 'is in for your activity' else 'can’t make your activity' end),
      format('%s · %s', game.title, game.court_label),
      jsonb_build_object('gameId', game.id, 'activityKind', game.activity_kind, 'playerId', auth.uid(), 'startsAt', game.starts_at)
    );
  end if;

  select count(*) into going_count from public.scheduled_game_players where game_id = game.id and status = 'going';
  return jsonb_build_object('status', case when p_going then 'going' else 'declined' end, 'going', going_count, 'capacity', game.capacity);
end;
$$;

create or replace function public.cancel_scheduled_game(p_game_id uuid)
returns public.scheduled_games
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
begin
  select * into game from public.scheduled_games where id = p_game_id for update;
  if auth.uid() is null or game.id is null or game.host_id <> auth.uid() then raise exception 'Only the host can cancel this activity.'; end if;
  if game.status = 'cancelled' then return game; end if;

  update public.scheduled_games set status = 'cancelled' where id = game.id returning * into game;

  insert into public.user_notifications (user_id, kind, title, body, data)
  select
    player.user_id,
    'game_update',
    'Activity cancelled',
    format('%s · %s was cancelled by the host.', game.title, game.court_label),
    jsonb_build_object('gameId', game.id, 'activityKind', game.activity_kind, 'startsAt', game.starts_at)
  from public.scheduled_game_players player
  where player.game_id = game.id and player.user_id <> game.host_id and player.status in ('invited', 'going');

  return game;
end;
$$;

revoke all on function public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[]) from public;
grant execute on function public.create_scheduled_activity(text, text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
