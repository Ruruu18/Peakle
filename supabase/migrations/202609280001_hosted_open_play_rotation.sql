begin;

-- Player-hosted open play runs a live fair-play rotation. When the host
-- starts an open play from their calendar, the scheduled activity becomes an
-- open-play session with no venue: the players who are going form the queue,
-- the host picks how many courts they have, and Peakle fills every open court
-- automatically — at the start, whenever someone checks in, and whenever a
-- player scorer finishes a match. Scoring, the queue and match history reuse
-- the organizer open-play model, so players see the same live screens.

alter table public.open_play_sessions
  add column if not exists scheduled_game_id uuid references public.scheduled_games(id) on delete set null;

comment on column public.open_play_sessions.scheduled_game_id is
  'Player-scheduled open play this session runs. Hosted sessions have no venue and assign courts automatically.';

create unique index if not exists open_play_sessions_scheduled_game_idx
  on public.open_play_sessions(scheduled_game_id)
  where scheduled_game_id is not null;

-- ---------- Creation guards ----------

-- Hosted sessions are created only by start_hosted_open_play for the host's
-- own open play. The scheduled activity already consumed the creation quota,
-- and a session starting now is expected, so venue and future-start rules
-- apply only to organizer publishing. Everything else is unchanged.
create or replace function app_private.guard_activity_creation()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  activity_kind text := case when tg_table_name = 'scheduled_games' then 'scheduled' else 'open_play' end;
  daily_limit integer := case when tg_table_name = 'scheduled_games' then 10 else 30 end;
  upcoming_limit integer := case when tg_table_name = 'scheduled_games' then 20 else 100 end;
  upcoming_count integer;
  recent_count integer;
  last_created timestamptz;
begin
  -- Trusted maintenance remains possible; client requests always need a user.
  if actor is null and coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if actor is null then raise exception 'Sign in to host an activity.'; end if;

  if activity_kind = 'open_play' then
    if tg_op = 'UPDATE' then
      if new.organizer_id is distinct from old.organizer_id or new.venue_id is distinct from old.venue_id then
        raise exception 'Create a new session to change its organizer or venue.';
      end if;
      if new.scheduled_start is distinct from old.scheduled_start or new.scheduled_end is distinct from old.scheduled_end then
        raise exception 'Create a new session to change its schedule.';
      end if;
      if old.status in ('completed', 'cancelled') and new.status in ('draft', 'active') then
        raise exception 'A finished or cancelled session cannot be reopened. Create a new session instead.';
      end if;
      return new;
    end if;
    if new.scheduled_game_id is not null then
      if new.organizer_id is distinct from actor or new.venue_id is not null or not exists (
        select 1 from public.scheduled_games game
        where game.id = new.scheduled_game_id and game.host_id = actor
          and game.activity_kind = 'open_play' and game.status = 'scheduled'
      ) then
        raise exception 'Only the host can start this open play.';
      end if;
      return new;
    end if;
    if new.organizer_id is distinct from actor
       or not (public.can_manage_venue(new.venue_id) or public.is_platform_admin()) then
      raise exception 'Only this venue''s owner, manager, or a platform admin can publish open play.';
    end if;
    if not public.is_verified_active_venue(new.venue_id) then
      raise exception 'Choose a verified active venue.';
    end if;
    if char_length(btrim(new.name)) not between 3 and 80
       or char_length(coalesce(new.rules, '')) > 1000
       or char_length(coalesce(new.cancellation_policy, '')) > 1000 then
      raise exception 'Use a session name of 3–80 characters and rules and cancellation policy of at most 1,000 characters each.';
    end if;
    if new.scheduled_start is null or new.scheduled_end is null
       or new.scheduled_start <= now() or new.scheduled_start > now() + interval '180 days'
       or new.scheduled_end <= new.scheduled_start
       or new.scheduled_end > new.scheduled_start + interval '12 hours' then
      raise exception 'Choose a future session within 180 days, lasting at most 12 hours.';
    end if;
  elsif new.host_id is distinct from actor then
    raise exception 'You can only create activities for your own account.';
  end if;

  -- All entry points, including legacy RPCs and direct inserts, share this lock.
  perform pg_advisory_xact_lock(hashtextextended('activity-create:' || actor::text || ':' || activity_kind, 0));
  select count(*), max(created_at) into recent_count, last_created
  from app_private.activity_creation_log
  where actor_id = actor and kind = activity_kind and created_at > clock_timestamp() - interval '24 hours';
  if last_created > clock_timestamp() - interval '30 seconds' then
    raise exception 'Please wait 30 seconds before creating another activity.';
  end if;
  if recent_count >= daily_limit then
    raise exception 'You can create up to % activities in 24 hours. Please try again later.', daily_limit;
  end if;
  if activity_kind = 'scheduled' then
    select count(*) into upcoming_count from public.scheduled_games
    where host_id = actor and status = 'scheduled' and ends_at > now();
  else
    select count(*) into upcoming_count from public.open_play_sessions
    where organizer_id = actor and status in ('draft', 'active') and scheduled_end > now();
  end if;
  if upcoming_count >= upcoming_limit then
    raise exception 'You can host up to % upcoming activities. Finish or cancel an existing activity first.', upcoming_limit;
  end if;
  new.created_at := clock_timestamp();
  insert into app_private.activity_creation_log(actor_id, kind, resource_id, created_at)
  values (actor, activity_kind, new.id::text, new.created_at);
  return new;
end;
$$;
revoke all on function app_private.guard_activity_creation() from public, anon, authenticated;

create or replace function public.enforce_future_open_play_start()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.scheduled_game_id is null and new.scheduled_start <= now() then
    raise exception 'Open play start time must be in the future'
      using errcode = '22007';
  end if;
  return new;
end;
$$;

-- ---------- Organizer notifications ----------

-- A hosted session's host is a player, not venue staff: they already get
-- "You are on court" and result notifications, so skip the per-court
-- organizer alerts that would otherwise arrive for every match.
create or replace function public.notify_open_play_organizer_match_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_user uuid;
  session_name text;
  court_number integer;
begin
  select session.organizer_id, session.name, court.court_number
  into organizer_user, session_name, court_number
  from public.open_play_sessions session
  join public.open_play_courts court on court.id = new.session_court_id
  where session.id = new.session_id
    and session.scheduled_game_id is null;

  if organizer_user is null or exists (
    select 1
    from public.open_play_match_players lineup
    join public.open_play_players player on player.id = lineup.player_id
    where lineup.match_id = new.match_id
      and player.user_id = organizer_user
  ) then
    return new;
  end if;

  insert into public.user_notifications(user_id, session_id, kind, title, body, data)
  values(
    organizer_user,
    new.session_id,
    'organizer_match',
    'Match started',
    format('Court %s is live for %s.', court_number, session_name),
    jsonb_build_object(
      'sessionId', new.session_id,
      'matchId', new.match_id,
      'court', court_number,
      'event', 'started',
      'dedupeKey', 'organizer-started:' || new.match_id
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

create or replace function public.notify_open_play_organizer_match_finished()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_user uuid;
  session_name text;
  court_number integer;
begin
  if new.status <> 'completed' or old.status is not distinct from new.status then
    return new;
  end if;

  select session.organizer_id, session.name, court.court_number
  into organizer_user, session_name, court_number
  from public.open_play_sessions session
  join public.open_play_courts court on court.id = new.session_court_id
  where session.id = new.session_id
    and session.scheduled_game_id is null;

  if organizer_user is null or exists (
    select 1
    from public.open_play_match_players lineup
    join public.open_play_players player on player.id = lineup.player_id
    where lineup.match_id = new.id
      and player.user_id = organizer_user
  ) then
    return new;
  end if;

  insert into public.user_notifications(user_id, session_id, kind, title, body, data)
  values(
    organizer_user,
    new.session_id,
    'organizer_match',
    'Match finished',
    format('Court %s at %s finished %s–%s.', court_number, session_name, new.home_score, new.away_score),
    jsonb_build_object(
      'sessionId', new.session_id,
      'matchId', new.id,
      'court', court_number,
      'event', 'finished',
      'dedupeKey', 'organizer-finished:' || new.id
    )
  )
  on conflict do nothing;

  return new;
end;
$$;
revoke all on function public.notify_open_play_organizer_match_started() from public;
revoke all on function public.notify_open_play_organizer_match_finished() from public;

-- ---------- Automatic court assignment ----------

-- Orders a lineup as [team 1, team 1, team 2, team 2]. Doubles players come
-- from the front of the queue; of the three ways to split them, prefer
-- partners who have not already played together this session, then the
-- closest total skill (unrated players count as 3.0).
create or replace function app_private.hosted_open_play_lineup(p_session_id text, p_player_ids text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with skill as (
    select player.id, coalesce(profile.skill_rating, 3.0) as rating
    from public.open_play_players player
    left join public.profiles profile on profile.id = player.user_id
    where player.session_id = p_session_id and player.id = any(p_player_ids)
  ),
  splits(choice, a, b, c, d) as (values (1, 1, 2, 3, 4), (2, 1, 3, 2, 4), (3, 1, 4, 2, 3)),
  candidates as (
    select split.choice,
      array[p_player_ids[split.a], p_player_ids[split.b], p_player_ids[split.c], p_player_ids[split.d]] as lineup
    from splits split
  ),
  scored as (
    select candidate.choice, candidate.lineup,
      (
        select count(*)
        from public.open_play_match_players first_partner
        join public.open_play_match_players second_partner
          on second_partner.match_id = first_partner.match_id and second_partner.side = first_partner.side
        join public.open_play_matches played
          on played.id = first_partner.match_id and played.session_id = p_session_id and played.status = 'completed'
        where (first_partner.player_id, second_partner.player_id) in (
          (candidate.lineup[1], candidate.lineup[2]),
          (candidate.lineup[3], candidate.lineup[4])
        )
      ) as repeat_partners,
      abs(
        (select coalesce(sum(rating), 0) from skill where id in (candidate.lineup[1], candidate.lineup[2]))
        - (select coalesce(sum(rating), 0) from skill where id in (candidate.lineup[3], candidate.lineup[4]))
      ) as skill_gap
    from candidates candidate
  )
  select case
    when cardinality(p_player_ids) = 4 then (
      select lineup from scored order by repeat_partners, skill_gap, choice limit 1
    )
    else p_player_ids
  end
$$;
revoke all on function app_private.hosted_open_play_lineup(text, text[]) from public, anon, authenticated;

-- Closes gaps in the waiting queue so positions read 1, 2, 3… again.
create or replace function app_private.compact_open_play_queue(p_session_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  with ordered as (
    select id, row_number() over (order by queue_position, waiting_since, joined_at) - 1 as next_position
    from public.open_play_players
    where session_id = p_session_id and status = 'waiting' and queue_position is not null
  )
  update public.open_play_players player
  set queue_position = ordered.next_position
  from ordered
  where player.id = ordered.id and player.queue_position is distinct from ordered.next_position
$$;
revoke all on function app_private.compact_open_play_queue(text) from public, anon, authenticated;

-- Puts the next fair lineup on every open court of a live hosted session.
-- Idempotent: courts that are playing, or a queue that is too short, are left
-- alone. Returns the number of matches started.
create or replace function app_private.fill_hosted_open_play_courts(p_session_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  court_row public.open_play_courts;
  host_player_id text;
  picked text[];
  lineup text[];
  needed integer;
  scorer text;
  new_match_id text;
  started integer := 0;
begin
  select * into session_row
  from public.open_play_sessions
  where id = p_session_id
    and scheduled_game_id is not null
    and status = 'active'
    and live_started_at is not null
    and archived_at is null
  for update;
  if session_row.id is null then return 0; end if;

  select id into host_player_id
  from public.open_play_players
  where session_id = p_session_id and user_id = session_row.organizer_id;

  for court_row in
    select court.*
    from public.open_play_courts court
    where court.session_id = p_session_id
      and not exists (
        select 1 from public.open_play_matches live_match
        where live_match.session_court_id = court.id and live_match.status = 'live'
      )
    order by court.court_number
  loop
    needed := case when court_row.match_format = 'singles' then 2 else 4 end;

    select array_agg(queued.id order by queued.queue_position) into picked
    from (
      select id, queue_position
      from public.open_play_players
      where session_id = p_session_id
        and registration_status = 'approved'
        and checked_in_at is not null
        and departed_at is null
        and status = 'waiting'
        and queue_position is not null
      order by queue_position
      limit needed
      for update
    ) queued;
    exit when coalesce(cardinality(picked), 0) < needed;

    lineup := app_private.hosted_open_play_lineup(p_session_id, picked);
    scorer := case when host_player_id = any(lineup) then host_player_id else lineup[1] end;
    new_match_id := gen_random_uuid()::text;

    insert into public.open_play_matches(id, session_id, session_court_id, scorer_player_id, status)
    values (new_match_id, p_session_id, court_row.id, scorer, 'live');

    insert into public.open_play_match_players(match_id, player_id, side, position)
    select new_match_id, player_id,
      case when needed = 2 then ordinal - 1 when ordinal <= 2 then 0 else 1 end,
      case when needed = 2 then 0 when ordinal in (1, 3) then 0 else 1 end
    from unnest(lineup) with ordinality selected(player_id, ordinal);

    update public.open_play_players
    set status = 'playing', queue_position = null
    where session_id = p_session_id and id = any(lineup);
    update public.open_play_players
    set consecutive_games = 0
    where session_id = p_session_id and status = 'waiting' and queue_position is not null;
    perform app_private.compact_open_play_queue(p_session_id);

    insert into public.open_play_rotation_decisions(
      session_id, session_court_id, match_id, selected_player_ids, recommended_player_ids,
      explanation, overridden, decided_by
    ) values (
      p_session_id, court_row.id, new_match_id, lineup, lineup,
      jsonb_build_object(
        'source', 'hosted_auto',
        'reason', case when needed = 4
          then 'Next four in the queue by waiting time, split into teams with fresh partners and balanced skill.'
          else 'Next two in the queue by waiting time.' end
      ),
      false, session_row.organizer_id
    );

    started := started + 1;
  end loop;

  return started;
end;
$$;
revoke all on function app_private.fill_hosted_open_play_courts(text) from public, anon, authenticated;

-- Any change to a hosted session's players (a check-in, a return to the queue
-- after a match, a break) is a chance to fill an open court. Statement-level
-- so a scorer finishing a match fills courts once the whole lineup is back in
-- the queue. Nested writes from the fill itself are skipped. A failed fill
-- must never undo the check-in or result that triggered it.
create or replace function app_private.autofill_hosted_open_play()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for target in
    select distinct changed.session_id
    from changed
    join public.open_play_sessions session on session.id = changed.session_id
    where session.scheduled_game_id is not null
      and session.status = 'active'
      and session.live_started_at is not null
  loop
    begin
      perform app_private.fill_hosted_open_play_courts(target);
    exception when others then
      raise warning 'Hosted open play % could not fill courts: %', target, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function app_private.autofill_hosted_open_play() from public, anon, authenticated;

drop trigger if exists autofill_hosted_open_play_after_insert on public.open_play_players;
create trigger autofill_hosted_open_play_after_insert
after insert on public.open_play_players
referencing new table as changed
for each statement execute function app_private.autofill_hosted_open_play();

drop trigger if exists autofill_hosted_open_play_after_update on public.open_play_players;
create trigger autofill_hosted_open_play_after_update
after update on public.open_play_players
referencing new table as changed
for each statement execute function app_private.autofill_hosted_open_play();

-- ---------- Host and player actions ----------

create or replace function public.start_hosted_open_play(
  p_game_id uuid,
  p_court_count integer,
  p_present_user_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game public.scheduled_games;
  existing public.open_play_sessions;
  created public.open_play_sessions;
  generated_code text;
  going_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in to start open play.'; end if;

  select * into game from public.scheduled_games where id = p_game_id for update;
  if game.id is null or game.host_id <> auth.uid() then raise exception 'Only the host can start this open play.'; end if;
  if game.activity_kind <> 'open_play' then raise exception 'Only open play runs a rotation.'; end if;
  if game.status <> 'scheduled' then raise exception 'This open play was cancelled.'; end if;

  select * into existing from public.open_play_sessions where scheduled_game_id = game.id;
  if existing.id is not null then
    if existing.status = 'active' then
      return jsonb_build_object('session_id', existing.id, 'already_started', true);
    end if;
    raise exception 'This open play has already ended.';
  end if;

  if now() < game.starts_at - interval '1 hour' then raise exception 'You can start open play up to 1 hour before it begins.'; end if;
  if now() >= game.ends_at then raise exception 'This open play has already ended.'; end if;
  if p_court_count is null or p_court_count not between 1 and 8 then raise exception 'Choose between 1 and 8 courts.'; end if;
  if coalesce(cardinality(p_present_user_ids), 0) > 16 then raise exception 'Choose at most 16 players.'; end if;

  select count(*) into going_count
  from public.scheduled_game_players
  where game_id = game.id and status = 'going';

  loop
    generated_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists (select 1 from public.open_play_sessions where upper(session_code) = generated_code);
  end loop;

  insert into public.open_play_sessions(
    id, organizer_id, venue_id, scheduled_game_id, name, status, court_count, session_code,
    visibility, approval_mode, capacity, fee_amount, scheduled_start, scheduled_end,
    rules, cancellation_policy, match_format, average_match_minutes,
    max_consecutive_games, rest_minutes, started_at, live_started_at
  ) values (
    gen_random_uuid()::text, game.host_id, null, game.id, game.title, 'active', p_court_count, generated_code,
    'private', 'automatic', greatest(4, game.capacity, going_count), 0, game.starts_at, game.ends_at,
    case when game.match_type = 'singles' then 'Singles · First to 11 · Win by 2' else 'Doubles · First to 11 · Win by 2' end,
    'Hosted by a player. Take a break any time and check back in to rejoin the queue.',
    game.match_type, 15, 2, 0, now(), now()
  ) returning * into created;

  insert into public.open_play_courts(id, session_id, court_number, match_format)
  select created.id || '-court-' || number, created.id, number, game.match_type
  from generate_series(1, p_court_count) number;

  -- Everyone going gets a place; the players who are here enter the queue in
  -- a random order, so nobody is favoured by when they RSVP'd.
  insert into public.open_play_players(
    id, session_id, user_id, registration_status, status, checked_in_at, queue_position, waiting_since
  )
  select gen_random_uuid()::text, created.id, roster.user_id, 'approved', 'waiting',
    case when roster.present then now() end,
    case when roster.present then (row_number() over (partition by roster.present order by random())) - 1 end,
    case when roster.present then now() end
  from (
    select member.user_id, member.user_id = any(coalesce(p_present_user_ids, '{}')) as present
    from public.scheduled_game_players member
    where member.game_id = game.id and member.status = 'going'
  ) roster;

  perform app_private.fill_hosted_open_play_courts(created.id);

  insert into public.user_notifications(user_id, session_id, kind, title, body, data)
  select player.user_id, created.id, 'game_update', 'Open play has started',
    format('%s is live. Check in when you arrive to join the rotation.', created.name),
    jsonb_build_object('sessionId', created.id, 'activityKind', 'open_play', 'event', 'started')
  from public.open_play_players player
  where player.session_id = created.id
    and player.checked_in_at is null
    and player.user_id is not null
    and player.user_id <> created.organizer_id;

  return jsonb_build_object('session_id', created.id, 'already_started', false);
end;
$$;

-- The session a scheduled open play is running, for anyone who can see it.
create or replace function public.get_hosted_open_play(p_game_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'session_id', session.id,
    'status', session.status,
    'live_started_at', session.live_started_at,
    'ended_at', session.ended_at
  )
  from public.open_play_sessions session
  where session.scheduled_game_id = p_game_id
    and public.can_view_scheduled_game(p_game_id)
$$;

-- "I'm here": joins the rotation queue. Works for anyone going to the open
-- play (including players who RSVP'd after it started) and for players coming
-- back from a break. The host can check in any player who is going.
create or replace function public.check_in_hosted_open_play(p_session_id text, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  target uuid := coalesce(p_user_id, auth.uid());
  player_row public.open_play_players;
  next_position integer;
begin
  if auth.uid() is null then raise exception 'Sign in to check in.'; end if;

  select * into session_row from public.open_play_sessions
  where id = p_session_id and scheduled_game_id is not null
  for update;
  if session_row.id is null then raise exception 'Open play not found.'; end if;
  if target <> auth.uid() and auth.uid() <> session_row.organizer_id then
    raise exception 'Only the host can check in other players.';
  end if;
  if session_row.status <> 'active' or session_row.live_started_at is null then
    raise exception 'This open play is not running.';
  end if;
  if not exists (
    select 1 from public.scheduled_game_players member
    where member.game_id = session_row.scheduled_game_id and member.user_id = target and member.status = 'going'
  ) then
    raise exception 'Only players who are going can join the rotation.';
  end if;

  select coalesce(max(queue_position), -1) + 1 into next_position
  from public.open_play_players where session_id = p_session_id;

  select * into player_row from public.open_play_players
  where session_id = p_session_id and user_id = target
  for update;

  if player_row.id is null then
    insert into public.open_play_players(
      id, session_id, user_id, registration_status, status, checked_in_at, queue_position, waiting_since
    ) values (
      gen_random_uuid()::text, p_session_id, target, 'approved', 'waiting', now(), next_position, now()
    ) returning * into player_row;
  elsif player_row.status = 'playing' or (player_row.status = 'waiting' and player_row.queue_position is not null) then
    null;
  else
    update public.open_play_players
    set registration_status = 'approved',
        status = 'waiting',
        checked_in_at = coalesce(checked_in_at, now()),
        departed_at = null,
        queue_position = next_position,
        consecutive_games = 0
    where id = player_row.id
    returning * into player_row;
  end if;

  return to_jsonb(player_row) - 'reviewed_by';
end;
$$;

-- "Take a break": leaves the queue without leaving the open play (so the
-- player keeps the session chat). A player on court finishes their match
-- first. The host can also mark others away.
create or replace function public.leave_hosted_open_play_queue(p_session_id text, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  target uuid := coalesce(p_user_id, auth.uid());
  player_row public.open_play_players;
begin
  if auth.uid() is null then raise exception 'Sign in to update the rotation.'; end if;

  select * into session_row from public.open_play_sessions
  where id = p_session_id and scheduled_game_id is not null
  for update;
  if session_row.id is null then raise exception 'Open play not found.'; end if;
  if target <> auth.uid() and auth.uid() <> session_row.organizer_id then
    raise exception 'Only the host can update other players.';
  end if;

  select * into player_row from public.open_play_players
  where session_id = p_session_id and user_id = target
  for update;
  if player_row.id is null then raise exception 'This player is not in the rotation.'; end if;
  if player_row.status = 'playing' then raise exception 'Finish the current match first.'; end if;

  update public.open_play_players
  set status = 'done', queue_position = null
  where id = player_row.id
  returning * into player_row;
  perform app_private.compact_open_play_queue(p_session_id);

  return to_jsonb(player_row) - 'reviewed_by';
end;
$$;

-- Ends a hosted session. Unfinished matches are cancelled (completed matches
-- stay in everyone's history) so no player is left assigned to a live court.
create or replace function app_private.close_hosted_open_play(p_session_id text, p_status public.session_status)
returns public.open_play_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed public.open_play_sessions;
begin
  -- Close the session first so the player updates below cannot trigger a fill.
  update public.open_play_sessions
  set status = p_status, ended_at = coalesce(ended_at, now()), updated_at = now()
  where id = p_session_id and status = 'active'
  returning * into closed;

  update public.open_play_matches
  set status = 'cancelled', ended_at = coalesce(ended_at, now())
  where session_id = p_session_id and status = 'live';

  update public.open_play_players
  set status = 'done', queue_position = null
  where session_id = p_session_id and status in ('waiting', 'playing');

  return closed;
end;
$$;
revoke all on function app_private.close_hosted_open_play(text, public.session_status) from public, anon, authenticated;

create or replace function public.end_hosted_open_play(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
begin
  if auth.uid() is null then raise exception 'Sign in to end open play.'; end if;
  select * into session_row from public.open_play_sessions
  where id = p_session_id and scheduled_game_id is not null
  for update;
  if session_row.id is null or session_row.organizer_id <> auth.uid() then
    raise exception 'Only the host can end this open play.';
  end if;
  if session_row.status <> 'active' then return jsonb_build_object('session_id', session_row.id, 'status', session_row.status); end if;
  session_row := app_private.close_hosted_open_play(p_session_id, 'completed');
  return jsonb_build_object('session_id', session_row.id, 'status', session_row.status);
end;
$$;

-- Cancelling the scheduled open play also stops its live rotation.
create or replace function app_private.cancel_hosted_open_play_with_game()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
begin
  for target in
    select id from public.open_play_sessions
    where scheduled_game_id = new.id and status = 'active'
  loop
    perform app_private.close_hosted_open_play(target, 'cancelled');
  end loop;
  return new;
end;
$$;
revoke all on function app_private.cancel_hosted_open_play_with_game() from public, anon, authenticated;

drop trigger if exists cancel_hosted_open_play_after_game_cancel on public.scheduled_games;
create trigger cancel_hosted_open_play_after_game_cancel
after update of status on public.scheduled_games
for each row
when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
execute function app_private.cancel_hosted_open_play_with_game();

revoke all on function public.start_hosted_open_play(uuid, integer, uuid[]) from public, anon;
revoke all on function public.get_hosted_open_play(uuid) from public, anon;
revoke all on function public.check_in_hosted_open_play(text, uuid) from public, anon;
revoke all on function public.leave_hosted_open_play_queue(text, uuid) from public, anon;
revoke all on function public.end_hosted_open_play(text) from public, anon;
grant execute on function public.start_hosted_open_play(uuid, integer, uuid[]) to authenticated;
grant execute on function public.get_hosted_open_play(uuid) to authenticated;
grant execute on function public.check_in_hosted_open_play(text, uuid) to authenticated;
grant execute on function public.leave_hosted_open_play_queue(text, uuid) to authenticated;
grant execute on function public.end_hosted_open_play(text) to authenticated;

-- ---------- Reading a session ----------

-- Same as before for organizer sessions. Hosted sessions have no venue, are
-- visible to everyone going to the scheduled open play, and include a
-- `hosted` block with the place and the live player list.
create or replace function public.get_open_play_session(
  p_session_id text default null,
  p_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  registration public.open_play_players;
  game public.scheduled_games;
  invited boolean;
  on_roster boolean := false;
  allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into session_row
  from public.open_play_sessions
  where (p_session_id is not null and id = p_session_id)
     or (p_code is not null and upper(session_code) = upper(trim(p_code)))
  order by case when id = p_session_id then 0 else 1 end
  limit 1;

  if session_row.id is null or session_row.status <> 'active' then
    raise exception 'Open-play session not found';
  end if;

  select * into registration
  from public.open_play_players
  where session_id = session_row.id and user_id = auth.uid();

  select exists (
    select 1
    from public.open_play_invitations
    where session_id = session_row.id
      and invited_user_id = auth.uid()
      and status in ('pending', 'accepted')
  ) into invited;

  if session_row.scheduled_game_id is not null then
    select * into game from public.scheduled_games where id = session_row.scheduled_game_id;
    select exists (
      select 1 from public.scheduled_game_players member
      where member.game_id = session_row.scheduled_game_id
        and member.user_id = auth.uid()
        and member.status in ('going', 'invited')
    ) into on_roster;
  end if;

  allowed := session_row.organizer_id = auth.uid()
    or session_row.visibility = 'public'
    or registration.id is not null
    or invited
    or on_roster
    or (p_code is not null and upper(session_row.session_code) = upper(trim(p_code)));

  if not allowed then
    raise exception 'A valid invitation or session code is required';
  end if;

  return (
    select jsonb_build_object(
      'id', session_row.id,
      'name', session_row.name,
      'session_code', case
        when session_row.organizer_id = auth.uid() or p_code is not null
          then session_row.session_code
        else null
      end,
      'visibility', session_row.visibility,
      'approval_mode', session_row.approval_mode,
      'capacity', session_row.capacity,
      'skill_min', session_row.skill_min,
      'skill_max', session_row.skill_max,
      'fee_amount', session_row.fee_amount,
      'currency', session_row.currency,
      'scheduled_start', session_row.scheduled_start,
      'scheduled_end', session_row.scheduled_end,
      'rules', session_row.rules,
      'cancellation_policy', session_row.cancellation_policy,
      'match_format', session_row.match_format,
      'average_match_minutes', session_row.average_match_minutes,
      'max_consecutive_games', session_row.max_consecutive_games,
      'rest_minutes', session_row.rest_minutes,
      'organizer', jsonb_build_object(
        'id', organizer.id,
        'name', organizer.display_name,
        'avatar_url', organizer.avatar_url
      ),
      'venue', case when venue.id is null then null else jsonb_build_object(
        'id', venue.id,
        'name', venue.name,
        'area', venue.area,
        'address', venue.address,
        'latitude', venue.latitude,
        'longitude', venue.longitude,
        'verified', venue.verification_status = 'verified'
      ) end,
      'registered_count', (
        select count(*)
        from public.open_play_players player
        where player.session_id = session_row.id
          and player.registration_status = 'approved'
          and player.departed_at is null
      ),
      'my_registration', case
        when registration.id is null then null
        else to_jsonb(registration) - 'reviewed_by'
      end,
      'hosted', case when session_row.scheduled_game_id is null then null else jsonb_build_object(
        'scheduled_game_id', session_row.scheduled_game_id,
        'place', game.court_label,
        'area', game.court_area,
        'court_count', session_row.court_count,
        'live_started_at', session_row.live_started_at,
        'is_host', session_row.organizer_id = auth.uid(),
        'can_check_in', on_roster and exists (
          select 1 from public.scheduled_game_players member
          where member.game_id = session_row.scheduled_game_id
            and member.user_id = auth.uid()
            and member.status = 'going'
        ),
        'players', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', member.user_id,
            'name', coalesce(profile.display_name, 'Player'),
            'avatar_url', profile.avatar_url,
            'is_host', member.user_id = session_row.organizer_id,
            'state', case
              when player.status = 'playing' then 'playing'
              when player.status = 'waiting' and player.queue_position is not null then 'queued'
              when player.departed_at is not null or player.status = 'done' then 'break'
              else 'not_here'
            end,
            'queue_position', case when player.queue_position is null then null else player.queue_position + 1 end,
            'games_played', coalesce(player.games_played, 0)
          ) order by
            case when player.status = 'playing' then 0 when player.queue_position is not null then 1 when player.checked_in_at is null then 3 else 2 end,
            player.queue_position nulls last,
            profile.display_name)
          from public.scheduled_game_players member
          left join public.open_play_players player
            on player.session_id = session_row.id and player.user_id = member.user_id
          left join public.profiles profile on profile.id = member.user_id
          where member.game_id = session_row.scheduled_game_id and member.status = 'going'
        ), '[]'::jsonb)
      ) end
    )
    from public.profiles organizer
    left join public.venues venue on venue.id = session_row.venue_id
    where organizer.id = session_row.organizer_id
  );
end
$$;

notify pgrst, 'reload schema';
commit;
