-- Priority 1: let players discover, join, and check in to organizer open play.
-- All capacity and access decisions are serialized on the session row so two
-- simultaneous requests cannot both claim the final available place.

alter table public.open_play_sessions
  add column if not exists session_code text,
  add column if not exists visibility text not null default 'private',
  add column if not exists approval_mode text not null default 'automatic',
  add column if not exists capacity integer not null default 32,
  add column if not exists skill_min numeric(2,1),
  add column if not exists skill_max numeric(2,1),
  add column if not exists fee_amount numeric(10,2) not null default 0,
  add column if not exists currency text not null default 'PHP',
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists rules text not null default 'Doubles · First to 11 · Win by 2',
  add column if not exists cancellation_policy text not null default 'Cancel before the session starts so a waitlisted player can take your place.';

update public.open_play_sessions
set session_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    scheduled_start = coalesce(scheduled_start, started_at),
    scheduled_end = coalesce(scheduled_end, started_at + interval '3 hours')
where session_code is null or scheduled_start is null or scheduled_end is null;

-- Legacy device-only sessions had no verified venue and must never become
-- player-discoverable after the registration model is enabled.
update public.open_play_sessions
set status = 'cancelled', ended_at = coalesce(ended_at, now())
where status = 'active' and venue_id is null;

alter table public.open_play_sessions
  alter column session_code set not null,
  alter column scheduled_start set not null,
  alter column scheduled_end set not null;

alter table public.open_play_sessions
  drop constraint if exists open_play_sessions_visibility_check,
  drop constraint if exists open_play_sessions_approval_mode_check,
  drop constraint if exists open_play_sessions_capacity_check,
  drop constraint if exists open_play_sessions_skill_range_check,
  drop constraint if exists open_play_sessions_fee_check,
  drop constraint if exists open_play_sessions_schedule_check;

alter table public.open_play_sessions
  add constraint open_play_sessions_visibility_check check (visibility in ('public', 'private', 'invite_only')),
  add constraint open_play_sessions_approval_mode_check check (approval_mode in ('automatic', 'manual')),
  add constraint open_play_sessions_capacity_check check (capacity between 4 and 200),
  add constraint open_play_sessions_skill_range_check check (
    (skill_min is null or skill_min between 1 and 5.5)
    and (skill_max is null or skill_max between 1 and 5.5)
    and (skill_min is null or skill_max is null or skill_min <= skill_max)
  ),
  add constraint open_play_sessions_fee_check check (fee_amount >= 0),
  add constraint open_play_sessions_schedule_check check (scheduled_end > scheduled_start);

create unique index if not exists open_play_sessions_code_idx
  on public.open_play_sessions(upper(session_code));
create index if not exists open_play_sessions_discovery_idx
  on public.open_play_sessions(visibility, status, scheduled_start);

drop policy if exists "entitled organizers create sessions" on public.open_play_sessions;
create policy "entitled organizers create sessions"
on public.open_play_sessions for insert to authenticated
with check (
  organizer_id = auth.uid()
  and public.has_active_organizer_entitlement(auth.uid())
    and status in ('draft', 'active')
    and exists (
      select 1 from public.venues venue
      where venue.id = open_play_sessions.venue_id
      and venue.active
      and venue.verification_status = 'verified'
  )
);

drop policy if exists "organizers update own sessions" on public.open_play_sessions;
create policy "organizers update own sessions"
on public.open_play_sessions for update to authenticated
using (organizer_id = auth.uid())
with check (
  organizer_id = auth.uid()
  and (
    status in ('completed', 'cancelled')
    or exists (
      select 1 from public.venues venue
      where venue.id = open_play_sessions.venue_id
        and venue.active
        and venue.verification_status = 'verified'
    )
  )
);

create or replace function public.enforce_open_play_session_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare approved_count integer;
begin
  if new.capacity = old.capacity then return new; end if;
  select count(*) into approved_count
  from public.open_play_players
  where session_id = new.id and registration_status = 'approved' and departed_at is null;
  if new.capacity < approved_count then
    raise exception 'Capacity cannot be lower than the current approved registration count';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_open_play_session_capacity_before_update on public.open_play_sessions;
create trigger enforce_open_play_session_capacity_before_update
before update of capacity on public.open_play_sessions
for each row execute function public.enforce_open_play_session_capacity();

alter table public.open_play_players
  add column if not exists registration_status text not null default 'approved',
  add column if not exists checked_in_at timestamptz,
  add column if not exists departed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

update public.open_play_players
set checked_in_at = coalesce(checked_in_at, joined_at)
where queue_position is not null or status in ('playing', 'done');

alter table public.open_play_players
  drop constraint if exists open_play_players_registration_status_check;
alter table public.open_play_players
  add constraint open_play_players_registration_status_check
  check (registration_status in ('requested', 'approved', 'waitlisted', 'rejected', 'cancelled'));

alter table public.open_play_players
  drop constraint if exists open_play_players_queue_requires_check_in;
alter table public.open_play_players
  add constraint open_play_players_queue_requires_check_in
  check (queue_position is null or checked_in_at is not null);

create unique index if not exists open_play_players_registered_account_idx
  on public.open_play_players(session_id, user_id)
  where user_id is not null;
create index if not exists open_play_players_registration_queue_idx
  on public.open_play_players(session_id, registration_status, joined_at);

create or replace function public.enforce_open_play_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_capacity integer;
  approved_count integer;
begin
  if new.registration_status <> 'approved'
    or (tg_op = 'UPDATE' and old.registration_status = 'approved')
  then return new;
  end if;

  select capacity into session_capacity
  from public.open_play_sessions
  where id = new.session_id
  for update;

  select count(*) into approved_count
  from public.open_play_players
  where session_id = new.session_id
    and registration_status = 'approved'
    and departed_at is null
    and id <> new.id;

  if approved_count >= session_capacity then
    if new.user_id is not null and new.checked_in_at is null then
      new.registration_status := 'waitlisted';
    else
      raise exception 'Open-play capacity has been reached';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_open_play_capacity_before_write on public.open_play_players;
create trigger enforce_open_play_capacity_before_write
before insert or update of registration_status on public.open_play_players
for each row execute function public.enforce_open_play_capacity();

create table public.open_play_invitations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (session_id, invited_user_id)
);

alter table public.open_play_invitations enable row level security;
revoke all on table public.open_play_invitations from anon;
grant select on table public.open_play_invitations to authenticated;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_play_sessions') then
    alter publication supabase_realtime add table public.open_play_sessions;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_play_players') then
    alter publication supabase_realtime add table public.open_play_players;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_play_invitations') then
    alter publication supabase_realtime add table public.open_play_invitations;
  end if;
end $$;

create policy "invitees and organizers read open play invitations"
on public.open_play_invitations for select to authenticated
using (invited_user_id = auth.uid() or public.owns_open_play(session_id));

drop policy if exists "players read own open play registration" on public.open_play_players;
create policy "players read own open play registration"
on public.open_play_players for select to authenticated
using (user_id = auth.uid());

create or replace function public.create_open_play_session(
  p_name text,
  p_venue_id text,
  p_court_count integer,
  p_capacity integer,
  p_visibility text,
  p_approval_mode text,
  p_skill_min numeric,
  p_skill_max numeric,
  p_fee_amount numeric,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_rules text,
  p_cancellation_policy text
)
returns public.open_play_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.open_play_sessions;
  generated_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_active_organizer_entitlement(auth.uid()) then raise exception 'An active Organizer Pass is required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Session name is required'; end if;
  if p_court_count not between 1 and 8 then raise exception 'Choose between 1 and 8 courts'; end if;
  if p_capacity not between 4 and 200 then raise exception 'Capacity must be between 4 and 200'; end if;
  if p_visibility not in ('public', 'private', 'invite_only') then raise exception 'Choose a valid visibility'; end if;
  if p_approval_mode not in ('automatic', 'manual') then raise exception 'Choose a valid approval mode'; end if;
  if p_scheduled_start is null or p_scheduled_end is null or p_scheduled_end <= p_scheduled_start then raise exception 'Choose a valid session schedule'; end if;
  if p_scheduled_end <= now() then raise exception 'The session must end in the future'; end if;
  if p_fee_amount is null or p_fee_amount < 0 then raise exception 'Fee cannot be negative'; end if;
  if p_skill_min is not null and (p_skill_min < 1 or p_skill_min > 5.5) then raise exception 'Minimum skill must be between 1.0 and 5.5'; end if;
  if p_skill_max is not null and (p_skill_max < 1 or p_skill_max > 5.5) then raise exception 'Maximum skill must be between 1.0 and 5.5'; end if;
  if p_skill_min is not null and p_skill_max is not null and p_skill_min > p_skill_max then raise exception 'Minimum skill cannot exceed maximum skill'; end if;
  if not exists(select 1 from public.venues where id = p_venue_id and active and verification_status = 'verified') then raise exception 'Choose a verified active venue'; end if;

  loop
    generated_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists(select 1 from public.open_play_sessions where session_code = generated_code);
  end loop;

  insert into public.open_play_sessions(
    id, organizer_id, venue_id, name, status, court_count, session_code,
    visibility, approval_mode, capacity, skill_min, skill_max, fee_amount,
    scheduled_start, scheduled_end, rules, cancellation_policy
  ) values (
    gen_random_uuid()::text, auth.uid(), p_venue_id, trim(p_name), 'active', p_court_count, generated_code,
    p_visibility, p_approval_mode, p_capacity, p_skill_min, p_skill_max, p_fee_amount,
    p_scheduled_start, p_scheduled_end,
    coalesce(nullif(trim(p_rules), ''), 'Doubles · First to 11 · Win by 2'),
    coalesce(nullif(trim(p_cancellation_policy), ''), 'Cancel before the session starts so a waitlisted player can take your place.')
  ) returning * into created;

  return created;
end;
$$;

create or replace function public.list_discoverable_open_play_sessions()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', session.id,
    'name', session.name,
    'visibility', session.visibility,
    'approval_mode', session.approval_mode,
    'capacity', session.capacity,
    'skill_min', session.skill_min,
    'skill_max', session.skill_max,
    'fee_amount', session.fee_amount,
    'currency', session.currency,
    'scheduled_start', session.scheduled_start,
    'scheduled_end', session.scheduled_end,
    'rules', session.rules,
    'organizer', jsonb_build_object('id', organizer.id, 'name', organizer.display_name, 'avatar_url', organizer.avatar_url),
    'venue', jsonb_build_object('id', venue.id, 'name', venue.name, 'area', venue.area, 'address', venue.address, 'latitude', venue.latitude, 'longitude', venue.longitude, 'verified', venue.verification_status = 'verified'),
    'registered_count', (select count(*) from public.open_play_players player where player.session_id = session.id and player.registration_status = 'approved' and player.departed_at is null),
    'my_registration', (select to_jsonb(player) - 'reviewed_by' from public.open_play_players player where player.session_id = session.id and player.user_id = auth.uid())
  )
  from public.open_play_sessions session
  join public.profiles organizer on organizer.id = session.organizer_id
  join public.venues venue on venue.id = session.venue_id
  where auth.uid() is not null
    and session.status = 'active'
    and (
      session.visibility = 'public'
      or exists(select 1 from public.open_play_invitations invitation where invitation.session_id = session.id and invitation.invited_user_id = auth.uid() and invitation.status in ('pending', 'accepted'))
      or exists(select 1 from public.open_play_players player where player.session_id = session.id and player.user_id = auth.uid() and player.registration_status not in ('cancelled', 'rejected'))
    )
    and session.scheduled_end > now()
    and venue.active
    and venue.verification_status = 'verified'
  order by session.scheduled_start asc
$$;

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
  invited boolean;
  allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into session_row
  from public.open_play_sessions
  where (p_session_id is not null and id = p_session_id)
     or (p_code is not null and upper(session_code) = upper(trim(p_code)))
  order by case when id = p_session_id then 0 else 1 end
  limit 1;

  if session_row.id is null or session_row.status <> 'active' then raise exception 'Open-play session not found'; end if;

  select * into registration from public.open_play_players
  where session_id = session_row.id and user_id = auth.uid();
  select exists(select 1 from public.open_play_invitations where session_id = session_row.id and invited_user_id = auth.uid() and status in ('pending', 'accepted')) into invited;

  allowed := session_row.organizer_id = auth.uid()
    or session_row.visibility = 'public'
    or registration.id is not null
    or invited
    or (p_code is not null and upper(session_row.session_code) = upper(trim(p_code)));
  if not allowed then raise exception 'A valid invitation or session code is required'; end if;

  return (
    select jsonb_build_object(
      'id', session_row.id,
      'name', session_row.name,
      'session_code', case when session_row.organizer_id = auth.uid() or p_code is not null then session_row.session_code else null end,
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
      'organizer', jsonb_build_object('id', organizer.id, 'name', organizer.display_name, 'avatar_url', organizer.avatar_url),
      'venue', jsonb_build_object('id', venue.id, 'name', venue.name, 'area', venue.area, 'address', venue.address, 'latitude', venue.latitude, 'longitude', venue.longitude, 'verified', venue.verification_status = 'verified'),
      'registered_count', (select count(*) from public.open_play_players player where player.session_id = session_row.id and player.registration_status = 'approved' and player.departed_at is null),
      'my_registration', case when registration.id is null then null else to_jsonb(registration) - 'reviewed_by' end
    )
    from public.profiles organizer
    join public.venues venue on venue.id = session_row.venue_id
    where organizer.id = session_row.organizer_id
  );
end;
$$;

create or replace function public.join_open_play_session(p_session_id text, p_code text default null)
returns public.open_play_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.open_play_sessions;
  existing public.open_play_players;
  player_profile public.profiles;
  approved_count integer;
  invited boolean;
  next_status text;
  created public.open_play_players;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into session_row from public.open_play_sessions where id = p_session_id and status = 'active' for update;
  if session_row.id is null or session_row.scheduled_end <= now() then raise exception 'This session is no longer accepting players'; end if;

  select * into existing from public.open_play_players where session_id = p_session_id and user_id = auth.uid();
  if existing.id is not null and existing.registration_status not in ('cancelled', 'rejected') then return existing; end if;

  select exists(select 1 from public.open_play_invitations where session_id = p_session_id and invited_user_id = auth.uid() and status in ('pending', 'accepted')) into invited;
  if session_row.visibility = 'private' and upper(session_row.session_code) <> upper(trim(coalesce(p_code, ''))) then raise exception 'Enter the valid session code'; end if;
  if session_row.visibility = 'invite_only' and not invited then raise exception 'This session is invite-only'; end if;

  select * into player_profile from public.profiles where id = auth.uid();
  if player_profile.skill_rating is not null and session_row.skill_min is not null and player_profile.skill_rating < session_row.skill_min then raise exception 'Your current rating is below this session range'; end if;
  if player_profile.skill_rating is not null and session_row.skill_max is not null and player_profile.skill_rating > session_row.skill_max then raise exception 'Your current rating is above this session range'; end if;

  select count(*) into approved_count from public.open_play_players
  where session_id = p_session_id and registration_status = 'approved' and departed_at is null;
  next_status := case
    when approved_count >= session_row.capacity then 'waitlisted'
    when session_row.approval_mode = 'manual' then 'requested'
    else 'approved'
  end;

  insert into public.open_play_players(id, session_id, user_id, registration_status, status, queue_position, checked_in_at, departed_at)
  values(gen_random_uuid()::text, p_session_id, auth.uid(), next_status, 'waiting', null, null, null)
  on conflict (session_id, user_id) where user_id is not null do update set
    registration_status = excluded.registration_status,
    joined_at = now(),
    checked_in_at = null,
    departed_at = null,
    reviewed_by = null,
    reviewed_at = null
  returning * into created;

  update public.open_play_invitations set status = 'accepted', responded_at = now()
  where session_id = p_session_id and invited_user_id = auth.uid() and status = 'pending';
  return created;
end;
$$;

create or replace function public.review_open_play_registration(p_player_id text, p_approve boolean)
returns public.open_play_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.open_play_players;
  session_row public.open_play_sessions;
  approved_count integer;
  reviewed public.open_play_players;
begin
  select * into player_row from public.open_play_players where id = p_player_id;
  if player_row.id is null then raise exception 'Registration not found'; end if;
  select * into session_row from public.open_play_sessions where id = player_row.session_id for update;
  if session_row.organizer_id <> auth.uid() then raise exception 'Organizer permission required'; end if;
  if player_row.registration_status not in ('requested', 'waitlisted') then raise exception 'Registration is no longer awaiting review'; end if;

  select count(*) into approved_count from public.open_play_players
  where session_id = session_row.id and registration_status = 'approved' and departed_at is null and id <> p_player_id;

  update public.open_play_players
  set registration_status = case when not p_approve then 'rejected' when approved_count >= session_row.capacity then 'waitlisted' else 'approved' end,
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_player_id
  returning * into reviewed;
  return reviewed;
end;
$$;

create or replace function public.check_in_open_play_player(p_player_id text)
returns public.open_play_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.open_play_players;
  session_row public.open_play_sessions;
  next_position integer;
  checked_in public.open_play_players;
begin
  select * into player_row from public.open_play_players where id = p_player_id for update;
  if player_row.id is null then raise exception 'Registration not found'; end if;
  select * into session_row from public.open_play_sessions where id = player_row.session_id for update;
  if auth.uid() <> player_row.user_id and auth.uid() <> session_row.organizer_id then raise exception 'Check-in permission required'; end if;
  if player_row.registration_status <> 'approved' then raise exception 'Only approved players can check in'; end if;
  if player_row.departed_at is not null then raise exception 'This player has already departed'; end if;
  if player_row.checked_in_at is not null then return player_row; end if;

  select coalesce(max(queue_position), -1) + 1 into next_position
  from public.open_play_players where session_id = session_row.id;
  update public.open_play_players
  set checked_in_at = now(), status = 'waiting', queue_position = next_position
  where id = p_player_id returning * into checked_in;
  return checked_in;
end;
$$;

create or replace function public.cancel_open_play_registration(p_player_id text)
returns public.open_play_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_row public.open_play_players;
  session_row public.open_play_sessions;
  cancelled public.open_play_players;
  promoted_id text;
begin
  select * into player_row from public.open_play_players where id = p_player_id;
  if player_row.id is null then raise exception 'Registration not found'; end if;
  select * into session_row from public.open_play_sessions where id = player_row.session_id for update;
  if auth.uid() <> player_row.user_id and auth.uid() <> session_row.organizer_id then raise exception 'Cancellation permission required'; end if;
  if player_row.status = 'playing' then raise exception 'A player on court cannot leave the session'; end if;

  update public.open_play_players
  set registration_status = 'cancelled', departed_at = now(), queue_position = null
  where id = p_player_id returning * into cancelled;

  if player_row.registration_status = 'approved' then
    select id into promoted_id from public.open_play_players
    where session_id = session_row.id and registration_status = 'waitlisted' and departed_at is null
    order by joined_at for update skip locked limit 1;
    if promoted_id is not null then
      update public.open_play_players
      set registration_status = case when session_row.approval_mode = 'automatic' then 'approved' else 'requested' end
      where id = promoted_id;
    end if;
  end if;
  return cancelled;
end;
$$;

create or replace function public.invite_open_play_player(p_session_id text, p_invited_user_id uuid)
returns public.open_play_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.open_play_invitations;
begin
  if not public.owns_open_play(p_session_id) then raise exception 'Organizer permission required'; end if;
  if p_invited_user_id = auth.uid() then raise exception 'Choose another player'; end if;
  if not exists(select 1 from public.profiles where id = p_invited_user_id) then raise exception 'Player not found'; end if;
  insert into public.open_play_invitations(session_id, invited_user_id, invited_by, status)
  values(p_session_id, p_invited_user_id, auth.uid(), 'pending')
  on conflict (session_id, invited_user_id) do update set status = 'pending', invited_by = auth.uid(), created_at = now(), responded_at = null
  returning * into invitation;
  return invitation;
end;
$$;

revoke all on function public.create_open_play_session(text, text, integer, integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text) from public;
revoke all on function public.list_discoverable_open_play_sessions() from public;
revoke all on function public.get_open_play_session(text, text) from public;
revoke all on function public.join_open_play_session(text, text) from public;
revoke all on function public.review_open_play_registration(text, boolean) from public;
revoke all on function public.check_in_open_play_player(text) from public;
revoke all on function public.cancel_open_play_registration(text) from public;
revoke all on function public.invite_open_play_player(text, uuid) from public;

grant execute on function public.create_open_play_session(text, text, integer, integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.list_discoverable_open_play_sessions() to authenticated;
grant execute on function public.get_open_play_session(text, text) to authenticated;
grant execute on function public.join_open_play_session(text, text) to authenticated;
grant execute on function public.review_open_play_registration(text, boolean) to authenticated;
grant execute on function public.check_in_open_play_player(text) to authenticated;
grant execute on function public.cancel_open_play_registration(text) to authenticated;
grant execute on function public.invite_open_play_player(text, uuid) to authenticated;
