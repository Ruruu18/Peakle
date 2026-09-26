-- Hosts can share a player-scheduled activity by link and invite more players
-- after creating it. Public ('open') activities stay discoverable; private
-- ('invite') ones are only reachable by invitation or by the share link.
-- Link codes live in their own table with no client grants, so a private
-- activity's code is only handed out by get_scheduled_game_share_code.

create table if not exists public.scheduled_game_links (
  game_id uuid primary key references public.scheduled_games(id) on delete cascade,
  code text not null unique check (code ~ '^[a-z0-9]{10}$'),
  created_at timestamptz not null default now()
);

alter table public.scheduled_game_links enable row level security;
revoke all on public.scheduled_game_links from anon, authenticated;

-- The host can always share. Anyone who can already see a public activity can
-- share it too; a private activity's link stays with its host.
create or replace function public.get_scheduled_game_share_code(p_game_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  link_code text;
begin
  if auth.uid() is null then raise exception 'Sign in to share this activity.'; end if;
  select * into game from public.scheduled_games where id = p_game_id;
  if game.id is null or not public.can_view_scheduled_game(game.id) then raise exception 'This activity is no longer available.'; end if;
  if game.host_id <> auth.uid() and game.visibility <> 'open' then
    raise exception 'Only the host can share a private activity.';
  end if;
  if game.status <> 'scheduled' or game.ends_at < now() then raise exception 'This activity can no longer be shared.'; end if;

  select code into link_code from public.scheduled_game_links where game_id = game.id;
  while link_code is null loop
    begin
      insert into public.scheduled_game_links (game_id, code)
      values (game.id, substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
      returning code into link_code;
    exception when unique_violation then
      -- Another request created this game's link first, or the random code clashed; read and retry.
      select code into link_code from public.scheduled_game_links where game_id = game.id;
    end;
  end loop;
  return link_code;
end;
$$;

-- Opening a share link puts the activity on the player's calendar as an
-- invitation, so the usual "I'm going" / "Can't make it" flow applies.
create or replace function public.open_scheduled_game_link(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
begin
  if auth.uid() is null then raise exception 'Sign in to open this invitation.'; end if;
  select scheduled.* into game
  from public.scheduled_game_links link
  join public.scheduled_games scheduled on scheduled.id = link.game_id
  where link.code = lower(btrim(coalesce(p_code, '')));
  if game.id is null then raise exception 'This invitation link is not valid.'; end if;
  if game.status <> 'scheduled' then raise exception 'This activity was cancelled.'; end if;
  if game.ends_at < now() then raise exception 'This activity has already ended.'; end if;

  if game.host_id <> auth.uid() then
    insert into public.scheduled_game_players (game_id, user_id, status, invited_by)
    values (game.id, auth.uid(), 'invited', game.host_id)
    on conflict (game_id, user_id) do nothing;
  end if;

  return jsonb_build_object('gameId', game.id, 'startsAt', game.starts_at);
end;
$$;

-- The host invites more registered players after the activity is created.
create or replace function public.invite_scheduled_game_players(p_game_id uuid, p_player_ids uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  host_name text;
  invitees uuid[];
  taken integer;
begin
  select * into game from public.scheduled_games where id = p_game_id for update;
  if game.id is null or game.host_id <> auth.uid() then raise exception 'Only the host can invite players.'; end if;
  if game.status <> 'scheduled' or game.ends_at < now() then raise exception 'This activity is no longer open for invitations.'; end if;

  select coalesce(array_agg(distinct profile.id), '{}') into invitees
  from public.profiles profile
  where profile.id = any(coalesce(p_player_ids, '{}'))
    and profile.id <> game.host_id
    and not exists (
      select 1 from public.scheduled_game_players player
      where player.game_id = game.id and player.user_id = profile.id and player.status <> 'declined'
    );
  if cardinality(invitees) = 0 then return 0; end if;

  select count(*) into taken from public.scheduled_game_players
  where game_id = game.id and status <> 'declined';
  if taken + cardinality(invitees) > game.capacity then
    raise exception 'Only % more player(s) fit in this activity.', greatest(game.capacity - taken, 0);
  end if;

  insert into public.scheduled_game_players (game_id, user_id, status, invited_by)
  select game.id, invitee, 'invited', auth.uid() from unnest(invitees) as invitee
  on conflict (game_id, user_id) do update set status = 'invited', invited_by = excluded.invited_by, responded_at = null;

  select display_name into host_name from public.profiles where id = auth.uid();
  insert into public.user_notifications (user_id, kind, title, body, data)
  select
    invitee,
    'game_invite',
    format('%s invited you to %s', coalesce(host_name, 'A Peakle player'), case when game.activity_kind = 'game' then 'a game' else 'an activity' end),
    format('%s · %s', game.title, game.court_label),
    jsonb_build_object('gameId', game.id, 'startsAt', game.starts_at, 'dedupeKey', 'game-invite:' || game.id::text || ':' || invitee::text)
  from unnest(invitees) as invitee;

  return cardinality(invitees);
end;
$$;

-- The host can switch an upcoming activity between public and private.
create or replace function public.set_scheduled_game_visibility(p_game_id uuid, p_visibility text)
returns public.scheduled_games
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
begin
  if p_visibility is null or p_visibility not in ('invite', 'open') then raise exception 'Choose public or private.'; end if;
  select * into game from public.scheduled_games where id = p_game_id for update;
  if game.id is null or game.host_id <> auth.uid() then raise exception 'Only the host can change who can join.'; end if;
  if game.status <> 'scheduled' or game.ends_at < now() then raise exception 'This activity can no longer be changed.'; end if;
  update public.scheduled_games set visibility = p_visibility where id = game.id returning * into game;
  return game;
end;
$$;

revoke all on function public.get_scheduled_game_share_code(uuid) from public;
grant execute on function public.get_scheduled_game_share_code(uuid) to authenticated;
revoke all on function public.open_scheduled_game_link(text) from public;
grant execute on function public.open_scheduled_game_link(text) to authenticated;
revoke all on function public.invite_scheduled_game_players(uuid, uuid[]) from public;
grant execute on function public.invite_scheduled_game_players(uuid, uuid[]) to authenticated;
revoke all on function public.set_scheduled_game_visibility(uuid, text) from public;
grant execute on function public.set_scheduled_game_visibility(uuid, text) to authenticated;
