-- Player-scheduled games for the Schedule tab. A player picks a time and a
-- court, invites registered players or opens the game to anyone, and everyone
-- sees it on their calendar. Writes go through the RPCs below so invites,
-- capacity and notifications stay consistent; clients only read tables.

create table if not exists public.scheduled_games (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  notes text check (notes is null or char_length(notes) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  match_type text not null default 'doubles' check (match_type in ('singles', 'doubles')),
  mode text not null default 'casual' check (mode in ('casual', 'ranked')),
  visibility text not null default 'invite' check (visibility in ('invite', 'open')),
  capacity integer not null default 4 check (capacity between 2 and 16),
  court_label text not null check (char_length(btrim(court_label)) between 1 and 80),
  court_area text check (court_area is null or char_length(btrim(court_area)) between 1 and 80),
  venue_id text references public.venues(id) on delete set null,
  court_id text references public.courts(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_games_time_window check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours')
);

create table if not exists public.scheduled_game_players (
  game_id uuid not null references public.scheduled_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'going', 'declined')),
  invited_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create index if not exists scheduled_games_host_idx on public.scheduled_games(host_id, starts_at);
create index if not exists scheduled_games_open_idx on public.scheduled_games(starts_at)
  where visibility = 'open' and status = 'scheduled';
create index if not exists scheduled_game_players_user_idx on public.scheduled_game_players(user_id, game_id);

drop trigger if exists scheduled_games_updated on public.scheduled_games;
create trigger scheduled_games_updated before update on public.scheduled_games
  for each row execute function public.set_updated_at();

create or replace function public.can_view_scheduled_game(p_game_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.scheduled_games game
    where game.id = p_game_id
      and (
        game.host_id = auth.uid()
        or (game.visibility = 'open' and game.status = 'scheduled')
        or exists (
          select 1 from public.scheduled_game_players player
          where player.game_id = game.id and player.user_id = auth.uid()
        )
      )
  )
$$;
revoke all on function public.can_view_scheduled_game(uuid) from public;
grant execute on function public.can_view_scheduled_game(uuid) to authenticated;

alter table public.scheduled_games enable row level security;
alter table public.scheduled_game_players enable row level security;

drop policy if exists "players read visible scheduled games" on public.scheduled_games;
create policy "players read visible scheduled games" on public.scheduled_games
  for select to authenticated using (public.can_view_scheduled_game(id));

drop policy if exists "players read visible scheduled game rosters" on public.scheduled_game_players;
create policy "players read visible scheduled game rosters" on public.scheduled_game_players
  for select to authenticated using (public.can_view_scheduled_game(game_id));

revoke insert, update, delete on public.scheduled_games from authenticated;
revoke insert, update, delete on public.scheduled_game_players from authenticated;
grant select on public.scheduled_games to authenticated;
grant select on public.scheduled_game_players to authenticated;

alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'approval', 'waitlist_promotion', 'check_in_reminder', 'court_assignment', 'match_point', 'result',
  'cancellation', 'venue_announcement', 'booking_confirmed', 'booking_reminder', 'court_waitlist',
  'booking_changed', 'match_invite', 'match_invite_response', 'match_found', 'organizer_match',
  'direct_message', 'direct_message_request', 'direct_message_accepted', 'follow_request', 'follow_accepted',
  'community_announcement', 'game_invite', 'game_response', 'game_update'
));

create or replace function public.create_scheduled_game(
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
  if auth.uid() is null then raise exception 'Sign in to schedule a game.'; end if;
  if p_starts_at < now() - interval '5 minutes' then raise exception 'Choose a start time in the future.'; end if;
  if p_starts_at > now() + interval '180 days' then raise exception 'Games can be scheduled up to 180 days ahead.'; end if;

  select coalesce(array_agg(distinct profile.id), '{}') into invitees
  from public.profiles profile
  where profile.id = any(coalesce(p_invitee_ids, '{}')) and profile.id <> auth.uid();

  if cardinality(invitees) >= coalesce(p_capacity, 4) then
    raise exception 'Invite at most % players for this game size.', coalesce(p_capacity, 4) - 1;
  end if;

  insert into public.scheduled_games (
    host_id, title, notes, starts_at, ends_at, match_type, mode, visibility, capacity,
    court_label, court_area, venue_id, court_id
  )
  values (
    auth.uid(), btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_starts_at, p_ends_at,
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
    format('%s invited you to a game', coalesce(host_name, 'A Peakle player')),
    format('%s · %s', game.title, game.court_label),
    jsonb_build_object('gameId', game.id, 'startsAt', game.starts_at, 'dedupeKey', 'game-invite:' || game.id::text || ':' || invitee::text)
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
  if auth.uid() is null then raise exception 'Sign in to respond to this game.'; end if;
  select * into game from public.scheduled_games where id = p_game_id for update;
  if game.id is null or not public.can_view_scheduled_game(game.id) then raise exception 'This game is no longer available.'; end if;
  if game.status <> 'scheduled' then raise exception 'This game was cancelled.'; end if;
  if game.ends_at < now() then raise exception 'This game has already ended.'; end if;
  if game.host_id = auth.uid() then raise exception 'You are hosting this game. Cancel it instead.'; end if;

  select * into membership from public.scheduled_game_players where game_id = game.id and user_id = auth.uid();
  if p_going and coalesce(membership.status, '') <> 'going' then
    select count(*) into going_count from public.scheduled_game_players where game_id = game.id and status = 'going';
    if going_count >= game.capacity then raise exception 'This game is full.'; end if;
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
      format('%s %s', coalesce(player_name, 'A player'), case when p_going then 'is in for your game' else 'can’t make your game' end),
      format('%s · %s', game.title, game.court_label),
      jsonb_build_object('gameId', game.id, 'playerId', auth.uid(), 'startsAt', game.starts_at)
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
  if game.id is null or game.host_id <> auth.uid() then raise exception 'Only the host can cancel this game.'; end if;
  if game.status = 'cancelled' then return game; end if;

  update public.scheduled_games set status = 'cancelled' where id = game.id returning * into game;

  insert into public.user_notifications (user_id, kind, title, body, data)
  select
    player.user_id,
    'game_update',
    'Game cancelled',
    format('%s · %s was cancelled by the host.', game.title, game.court_label),
    jsonb_build_object('gameId', game.id, 'startsAt', game.starts_at)
  from public.scheduled_game_players player
  where player.game_id = game.id and player.user_id <> game.host_id and player.status in ('invited', 'going');

  return game;
end;
$$;

revoke all on function public.create_scheduled_game(text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[]) from public;
grant execute on function public.create_scheduled_game(text, timestamptz, timestamptz, text, text, text, integer, text, text, text, text, text, uuid[]) to authenticated;
revoke all on function public.respond_scheduled_game(uuid, boolean) from public;
grant execute on function public.respond_scheduled_game(uuid, boolean) to authenticated;
revoke all on function public.cancel_scheduled_game(uuid) from public;
grant execute on function public.cancel_scheduled_game(uuid) to authenticated;
