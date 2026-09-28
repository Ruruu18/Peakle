-- Player beta growth: getting a new player from a shared link into their first
-- game, and bringing them back for the next one.
--   * Activities carry a skill level and an optional court cost.
--   * Hosts can change the time, court and details; players are told.
--   * Full public activities keep a waitlist that fills a spot automatically.
--   * Players can ask to be told when a public activity opens in their area.
--   * A shared link shows a limited public preview before sign-in.
--   * A small, aggregate-only funnel of first-game and repeat-play events.

-- ---------- Skill level and court cost ----------

alter table public.scheduled_games
  add column if not exists skill_level text not null default 'any',
  add column if not exists court_cost text;

alter table public.scheduled_games drop constraint if exists scheduled_games_skill_level_check;
alter table public.scheduled_games add constraint scheduled_games_skill_level_check
  check (skill_level in ('any', 'beginner', 'intermediate', 'advanced'));
alter table public.scheduled_games drop constraint if exists scheduled_games_court_cost_check;
alter table public.scheduled_games add constraint scheduled_games_court_cost_check
  check (court_cost is null or char_length(btrim(court_cost)) between 1 and 60);

alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'approval', 'waitlist_promotion', 'check_in_reminder', 'court_assignment', 'match_point', 'result',
  'cancellation', 'venue_announcement', 'booking_confirmed', 'booking_reminder', 'court_waitlist',
  'booking_changed', 'match_invite', 'match_invite_response', 'match_found', 'organizer_match',
  'direct_message', 'direct_message_request', 'direct_message_accepted', 'follow_request', 'follow_accepted',
  'community_announcement', 'game_invite', 'game_response', 'game_update',
  'team_invite', 'team_invite_response', 'team_mention', 'game_alert'
));

-- ---------- Host edits ----------

-- Null arguments keep the current value; p_court_cost '' clears the cost.
-- Moving the time or court tells everyone invited or going.
create or replace function public.update_scheduled_game(
  p_game_id uuid,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_court_label text default null,
  p_court_area text default null,
  p_venue_id text default null,
  p_court_id text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_skill_level text default null,
  p_court_cost text default null,
  p_notes text default null,
  p_title text default null
)
returns public.scheduled_games
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  previous public.scheduled_games;
  court_changed boolean := p_court_label is not null;
  time_changed boolean;
begin
  select * into game from public.scheduled_games where id = p_game_id for update;
  if auth.uid() is null or game.id is null or game.host_id <> auth.uid() then raise exception 'Only the host can change this activity.'; end if;
  if game.status <> 'scheduled' or game.ends_at < now() then raise exception 'This activity can no longer be changed.'; end if;
  previous := game;
  time_changed := (p_starts_at is not null and p_starts_at <> game.starts_at) or (p_ends_at is not null and p_ends_at <> game.ends_at);
  if time_changed and p_starts_at is not null and p_starts_at < now() - interval '5 minutes' then raise exception 'Choose a start time in the future.'; end if;
  if time_changed and p_starts_at > now() + interval '180 days' then raise exception 'Activities can be scheduled up to 180 days ahead.'; end if;
  if (time_changed or court_changed) and exists (
    select 1 from public.open_play_sessions session where session.scheduled_game_id = game.id
  ) then
    raise exception 'The rotation for this activity has started, so its time and court are fixed.';
  end if;
  if p_skill_level is not null and p_skill_level not in ('any', 'beginner', 'intermediate', 'advanced') then raise exception 'Choose a skill level.'; end if;

  update public.scheduled_games set
    starts_at = coalesce(p_starts_at, starts_at),
    ends_at = coalesce(p_ends_at, ends_at),
    court_label = case when court_changed then btrim(p_court_label) else court_label end,
    court_area = case when court_changed then nullif(btrim(coalesce(p_court_area, '')), '') else court_area end,
    venue_id = case when court_changed then p_venue_id else venue_id end,
    court_id = case when court_changed then (case when p_venue_id is null then null else p_court_id end) else court_id end,
    latitude = case when court_changed then p_latitude else latitude end,
    longitude = case when court_changed then (case when p_latitude is null then null else p_longitude end) else longitude end,
    skill_level = coalesce(p_skill_level, skill_level),
    court_cost = case when p_court_cost is null then court_cost else nullif(btrim(p_court_cost), '') end,
    notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
    title = case when nullif(btrim(coalesce(p_title, '')), '') is null then title else btrim(p_title) end
  where id = game.id
  returning * into game;

  if time_changed or (court_changed and game.court_label is distinct from previous.court_label) then
    insert into public.user_notifications (user_id, kind, title, body, data)
    select
      player.user_id,
      'game_update',
      case when time_changed then 'Activity time changed' else 'Activity court changed' end,
      format('%s · %s', game.title, game.court_label),
      jsonb_build_object('gameId', game.id, 'activityKind', game.activity_kind, 'startsAt', game.starts_at)
    from public.scheduled_game_players player
    where player.game_id = game.id and player.user_id <> game.host_id and player.status in ('invited', 'going');
  end if;

  return game;
end;
$$;

-- ---------- Waitlist ----------

create table if not exists public.scheduled_game_waitlist (
  game_id uuid not null references public.scheduled_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index if not exists scheduled_game_waitlist_order_idx on public.scheduled_game_waitlist(game_id, created_at);
create index if not exists scheduled_game_waitlist_user_idx on public.scheduled_game_waitlist(user_id);

alter table public.scheduled_game_waitlist enable row level security;
revoke all on public.scheduled_game_waitlist from anon, authenticated;
grant select on public.scheduled_game_waitlist to authenticated;

-- Players see their own place; hosts see who is waiting for their activity.
drop policy if exists "players read own or hosted waitlist" on public.scheduled_game_waitlist;
create policy "players read own or hosted waitlist" on public.scheduled_game_waitlist
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.scheduled_games game where game.id = game_id and game.host_id = auth.uid())
  );

create or replace function public.join_scheduled_game_waitlist(p_game_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  going_count integer;
  place integer;
begin
  if auth.uid() is null then raise exception 'Sign in to join the waitlist.'; end if;
  select * into game from public.scheduled_games where id = p_game_id for update;
  if game.id is null or not public.can_view_scheduled_game(game.id) then raise exception 'This activity is no longer available.'; end if;
  if game.status <> 'scheduled' or game.ends_at < now() then raise exception 'This activity is no longer taking players.'; end if;
  if game.host_id = auth.uid() then raise exception 'You are hosting this activity.'; end if;
  if exists (select 1 from public.scheduled_game_players where game_id = game.id and user_id = auth.uid() and status = 'going') then
    raise exception 'You already have a spot.';
  end if;
  select count(*) into going_count from public.scheduled_game_players where game_id = game.id and status = 'going';
  if going_count < game.capacity then raise exception 'A spot is open. Join the activity instead.'; end if;

  insert into public.scheduled_game_waitlist (game_id, user_id) values (game.id, auth.uid())
  on conflict (game_id, user_id) do nothing;

  select count(*) into place from public.scheduled_game_waitlist waiting
  where waiting.game_id = game.id
    and waiting.created_at <= (select created_at from public.scheduled_game_waitlist where game_id = game.id and user_id = auth.uid());
  return place;
end;
$$;

create or replace function public.leave_scheduled_game_waitlist(p_game_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.scheduled_game_waitlist where game_id = p_game_id and user_id = auth.uid();
$$;

-- The caller's place in each waitlist they are on, and the size of the
-- waitlist for each activity they host. Players never see who else is waiting.
create or replace function public.list_scheduled_game_waitlists()
returns table (game_id uuid, place integer, waiting integer)
language sql stable security definer set search_path = ''
as $$
  with ranked as (
    select waiting.game_id, waiting.user_id,
      row_number() over (partition by waiting.game_id order by waiting.created_at, waiting.user_id)::integer as place,
      count(*) over (partition by waiting.game_id)::integer as waiting
    from public.scheduled_game_waitlist waiting
    join public.scheduled_games game on game.id = waiting.game_id
    where game.ends_at > now() and game.status = 'scheduled'
      and (game.host_id = auth.uid() or exists (
        select 1 from public.scheduled_game_waitlist mine where mine.game_id = waiting.game_id and mine.user_id = auth.uid()
      ))
  )
  select ranked.game_id, max(case when ranked.user_id = auth.uid() then ranked.place end), max(ranked.waiting)
  from ranked
  group by ranked.game_id
$$;

-- When a player gives up a spot, the longest-waiting player takes it and is
-- told. A player who gets a spot some other way leaves the waitlist.
create or replace function app_private.fill_scheduled_game_from_waitlist()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  next_player uuid;
  going_count integer;
begin
  if tg_op <> 'DELETE' then
    if new.status = 'going' then
      delete from public.scheduled_game_waitlist where game_id = new.game_id and user_id = new.user_id;
    end if;
    if tg_op = 'INSERT' or new.status = 'going' then return null; end if;
  end if;
  if old.status <> 'going' then return null; end if;

  select * into game from public.scheduled_games where id = old.game_id;
  if game.id is null or game.status <> 'scheduled' or game.ends_at < now() then return null; end if;
  select count(*) into going_count from public.scheduled_game_players where game_id = game.id and status = 'going';
  if going_count >= game.capacity then return null; end if;

  select waiting.user_id into next_player
  from public.scheduled_game_waitlist waiting
  where waiting.game_id = game.id and waiting.user_id <> old.user_id
  order by waiting.created_at, waiting.user_id
  limit 1;
  if next_player is null then return null; end if;

  insert into public.scheduled_game_players (game_id, user_id, status, invited_by, responded_at)
  values (game.id, next_player, 'going', null, now())
  on conflict (game_id, user_id) do update set status = 'going', responded_at = now();

  insert into public.user_notifications (user_id, kind, title, body, data)
  values (
    next_player,
    'waitlist_promotion',
    'A spot opened. You’re in!',
    format('%s · %s', game.title, game.court_label),
    jsonb_build_object('gameId', game.id, 'activityKind', game.activity_kind, 'startsAt', game.starts_at)
  );
  return null;
end;
$$;

drop trigger if exists scheduled_game_players_fill_waitlist on public.scheduled_game_players;
create trigger scheduled_game_players_fill_waitlist
  after insert or update of status or delete on public.scheduled_game_players
  for each row execute function app_private.fill_scheduled_game_from_waitlist();

-- ---------- "Tell me when a game opens here" ----------

create table if not exists public.scheduled_game_alerts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  area text not null check (char_length(btrim(area)) between 2 and 80),
  created_at timestamptz not null default now()
);

alter table public.scheduled_game_alerts enable row level security;
revoke all on public.scheduled_game_alerts from anon, authenticated;
grant select on public.scheduled_game_alerts to authenticated;
drop policy if exists "players read own game alert" on public.scheduled_game_alerts;
create policy "players read own game alert" on public.scheduled_game_alerts
  for select to authenticated using (user_id = auth.uid());

create or replace function public.set_scheduled_game_alert(p_area text)
returns public.scheduled_game_alerts
language plpgsql security definer set search_path = ''
as $$
declare
  alert public.scheduled_game_alerts;
begin
  if auth.uid() is null then raise exception 'Sign in to get game alerts.'; end if;
  if char_length(btrim(coalesce(p_area, ''))) < 2 then raise exception 'Choose an area for game alerts.'; end if;
  insert into public.scheduled_game_alerts (user_id, area) values (auth.uid(), left(btrim(p_area), 80))
  on conflict (user_id) do update set area = excluded.area, created_at = now()
  returning * into alert;
  return alert;
end;
$$;

create or replace function public.clear_scheduled_game_alert()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.scheduled_game_alerts where user_id = auth.uid();
$$;

-- An area matches when either name contains the other ("Pasig" and
-- "Kapitolyo, Pasig"). Each player hears about an activity at most once.
create or replace function app_private.notify_scheduled_game_alerts()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  game_area text := lower(btrim(coalesce(new.court_area, '')));
  host_name text;
begin
  if new.visibility <> 'open' or new.status <> 'scheduled' or new.starts_at < now() or char_length(game_area) < 2 then return null; end if;
  if tg_op = 'UPDATE' and old.visibility = 'open' and old.status = 'scheduled' then return null; end if;

  select display_name into host_name from public.profiles where id = new.host_id;
  insert into public.user_notifications (user_id, kind, title, body, data)
  select
    alert.user_id,
    'game_alert',
    format('New %s near %s', case when new.activity_kind = 'game' then 'game' else 'activity' end, btrim(alert.area)),
    format('%s · %s · hosted by %s', new.title, new.court_label, coalesce(host_name, 'a Peakle player')),
    jsonb_build_object('gameId', new.id, 'activityKind', new.activity_kind, 'startsAt', new.starts_at, 'dedupeKey', 'game-alert:' || new.id::text || ':' || alert.user_id::text)
  from public.scheduled_game_alerts alert
  where alert.user_id <> new.host_id
    and (game_area like '%' || lower(btrim(alert.area)) || '%' or lower(btrim(alert.area)) like '%' || game_area || '%')
    and not exists (
      select 1 from public.scheduled_game_players player where player.game_id = new.id and player.user_id = alert.user_id
    )
    and not exists (
      select 1 from public.user_notifications notice
      where notice.user_id = alert.user_id and notice.kind = 'game_alert' and notice.data->>'gameId' = new.id::text
    )
  limit 500;
  return null;
end;
$$;

drop trigger if exists scheduled_games_notify_alerts on public.scheduled_games;
create trigger scheduled_games_notify_alerts
  after insert or update of visibility, status on public.scheduled_games
  for each row execute function app_private.notify_scheduled_game_alerts();

-- ---------- Public link preview ----------

-- Anyone holding a share link sees what they are being invited to before they
-- sign in: deliberate public fields only, never the roster or notes.
create or replace function public.get_scheduled_game_preview(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  game public.scheduled_games;
  going_count integer;
  host_name text;
begin
  if coalesce(p_code, '') !~ '^[A-Za-z0-9]{10}$' then return null; end if;
  select scheduled.* into game
  from public.scheduled_game_links link
  join public.scheduled_games scheduled on scheduled.id = link.game_id
  where link.code = lower(p_code);
  if game.id is null then return null; end if;

  select count(*) into going_count from public.scheduled_game_players where game_id = game.id and status = 'going';
  select split_part(btrim(coalesce(display_name, '')), ' ', 1) into host_name from public.profiles where id = game.host_id;
  return jsonb_build_object(
    'title', game.title,
    'activityKind', game.activity_kind,
    'startsAt', game.starts_at,
    'endsAt', game.ends_at,
    'matchType', game.match_type,
    'mode', game.mode,
    'courtLabel', game.court_label,
    'courtArea', game.court_area,
    'skillLevel', game.skill_level,
    'courtCost', game.court_cost,
    'capacity', game.capacity,
    'going', going_count,
    'hostFirstName', nullif(host_name, ''),
    'status', case when game.status = 'cancelled' then 'cancelled' when game.ends_at < now() then 'ended' else 'scheduled' end
  );
end;
$$;

-- ---------- First-game and repeat-play funnel ----------

-- Event names and ids only: no message text, locations or free-form fields.
-- Signed-out events (a link opened, sign-up started) use a random browser id.
create table if not exists app_private.player_funnel_events (
  id bigint generated always as identity primary key,
  event text not null check (event in (
    'invite_opened', 'signup_started', 'signup_completed', 'onboarding_completed',
    'activity_joined', 'activity_created', 'invite_shared', 'match_completed', 'waitlist_joined', 'game_alert_set'
  )),
  user_id uuid references public.profiles(id) on delete cascade,
  anonymous_id text check (anonymous_id is null or anonymous_id ~ '^[a-f0-9]{32}$'),
  game_id uuid,
  created_at timestamptz not null default now(),
  check (user_id is not null or anonymous_id is not null)
);
create index if not exists player_funnel_events_week_idx on app_private.player_funnel_events(created_at, event);
create index if not exists player_funnel_events_actor_idx on app_private.player_funnel_events(user_id, event, created_at);
create index if not exists player_funnel_events_anonymous_idx on app_private.player_funnel_events(anonymous_id, event, created_at);

create or replace function public.record_player_event(p_event text, p_anonymous_id text default null, p_game_id uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  anonymous text := case when coalesce(p_anonymous_id, '') ~ '^[a-f0-9]{32}$' then p_anonymous_id end;
begin
  if p_event is null or p_event not in (
    'invite_opened', 'signup_started', 'signup_completed', 'onboarding_completed',
    'activity_joined', 'activity_created', 'invite_shared', 'match_completed', 'waitlist_joined', 'game_alert_set'
  ) then return; end if;
  -- Signed-out browsers can only report reaching a link or the sign-up form.
  if actor is null and (anonymous is null or p_event not in ('invite_opened', 'signup_started')) then return; end if;
  -- A crude ceiling on signed-out traffic so a script cannot flood the table.
  if actor is null and (
    select count(*) from app_private.player_funnel_events recent
    where recent.user_id is null and recent.created_at > now() - interval '1 minute'
  ) >= 300 then return; end if;
  -- Repeats within ten minutes (reloads, double taps) count once.
  if exists (
    select 1 from app_private.player_funnel_events recent
    where recent.event = p_event
      and (case when actor is not null then recent.user_id = actor else recent.anonymous_id = anonymous end)
      and recent.game_id is not distinct from p_game_id
      and recent.created_at > now() - interval '10 minutes'
  ) then return; end if;
  insert into app_private.player_funnel_events (event, user_id, anonymous_id, game_id)
  values (p_event, actor, case when actor is null then anonymous end, p_game_id);
end;
$$;

-- Weekly aggregate for platform admins: counts of distinct players per step.
create or replace function public.player_funnel_weekly(p_weeks integer default 8)
returns table (week_start date, event text, players bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'Only platform admins can read funnel reports.'; end if;
  return query
  select date_trunc('week', created_at)::date, funnel.event, count(distinct coalesce(funnel.user_id::text, funnel.anonymous_id))
  from app_private.player_funnel_events funnel
  where funnel.created_at >= date_trunc('week', now()) - make_interval(weeks => greatest(1, least(coalesce(p_weeks, 8), 52)) - 1)
  group by 1, 2
  order by 1 desc, 2;
end;
$$;

-- ---------- Grants ----------

revoke all on function public.update_scheduled_game(uuid, timestamptz, timestamptz, text, text, text, text, double precision, double precision, text, text, text, text) from public;
grant execute on function public.update_scheduled_game(uuid, timestamptz, timestamptz, text, text, text, text, double precision, double precision, text, text, text, text) to authenticated;
revoke all on function public.join_scheduled_game_waitlist(uuid) from public;
grant execute on function public.join_scheduled_game_waitlist(uuid) to authenticated;
revoke all on function public.list_scheduled_game_waitlists() from public;
grant execute on function public.list_scheduled_game_waitlists() to authenticated;
revoke all on function public.leave_scheduled_game_waitlist(uuid) from public;
grant execute on function public.leave_scheduled_game_waitlist(uuid) to authenticated;
revoke all on function public.set_scheduled_game_alert(text) from public;
grant execute on function public.set_scheduled_game_alert(text) to authenticated;
revoke all on function public.clear_scheduled_game_alert() from public;
grant execute on function public.clear_scheduled_game_alert() to authenticated;
revoke all on function public.get_scheduled_game_preview(text) from public;
grant execute on function public.get_scheduled_game_preview(text) to anon, authenticated;
revoke all on function public.record_player_event(text, text, uuid) from public;
grant execute on function public.record_player_event(text, text, uuid) to anon, authenticated;
revoke all on function public.player_funnel_weekly(integer) from public;
grant execute on function public.player_funnel_weekly(integer) to authenticated;
revoke all on function app_private.fill_scheduled_game_from_waitlist() from public;
revoke all on function app_private.notify_scheduled_game_alerts() from public;

notify pgrst, 'reload schema';
