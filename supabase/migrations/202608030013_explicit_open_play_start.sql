-- Published Open Play sessions accept registrations before they are live.
-- An organizer must explicitly start the session before matches can begin.
alter table public.open_play_sessions
  add column if not exists live_started_at timestamptz;

comment on column public.open_play_sessions.live_started_at is
  'Organizer-confirmed time when the published session entered live operations.';

-- Preserve the behavior of sessions that were already underway before this
-- explicit lifecycle state existed. Future published sessions remain unstarted.
update public.open_play_sessions
set live_started_at = coalesce(scheduled_start, started_at, created_at, now())
where live_started_at is null
  and (
    status in ('completed', 'cancelled')
    or (status = 'active' and coalesce(scheduled_start, started_at, created_at) <= now())
  );

create or replace function public.manage_open_play_session(
  p_session_id text,
  p_action text
)
returns public.open_play_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_session public.open_play_sessions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into current_session
  from public.open_play_sessions
  where id = p_session_id and organizer_id = auth.uid()
  for update;

  if current_session.id is null then raise exception 'Open Play session not found or access denied'; end if;

  if p_action = 'start' then
    if current_session.archived_at is not null then raise exception 'Archived sessions cannot be started'; end if;
    if current_session.status <> 'active' then raise exception 'Only a published session can be started'; end if;
    if current_session.live_started_at is not null then raise exception 'This session is already live'; end if;
    if current_session.scheduled_end is not null and current_session.scheduled_end <= now() then raise exception 'This session has already passed its scheduled end time'; end if;
    update public.open_play_sessions
    set live_started_at = now(), started_at = now(), updated_at = now()
    where id = p_session_id
    returning * into current_session;
  elsif p_action = 'cancel' then
    if current_session.archived_at is not null then raise exception 'Archived sessions cannot be changed'; end if;
    if current_session.status not in ('draft', 'active') then raise exception 'Only upcoming or active sessions can be cancelled'; end if;
    update public.open_play_sessions
    set status = 'cancelled', ended_at = coalesce(ended_at, now()), updated_at = now()
    where id = p_session_id
    returning * into current_session;
  elsif p_action = 'end' then
    if current_session.archived_at is not null then raise exception 'Archived sessions cannot be changed'; end if;
    if current_session.status <> 'active' or current_session.live_started_at is null then raise exception 'Only a live session can be ended'; end if;
    update public.open_play_sessions
    set status = 'completed', ended_at = coalesce(ended_at, now()), updated_at = now()
    where id = p_session_id
    returning * into current_session;
  elsif p_action = 'archive' then
    if current_session.status not in ('completed', 'cancelled') then raise exception 'End or cancel the session before archiving it'; end if;
    update public.open_play_sessions
    set archived_at = coalesce(archived_at, now()), updated_at = now()
    where id = p_session_id
    returning * into current_session;
  elsif p_action = 'restore' then
    if current_session.archived_at is null then raise exception 'This session is not archived'; end if;
    update public.open_play_sessions
    set archived_at = null, updated_at = now()
    where id = p_session_id
    returning * into current_session;
  elsif p_action = 'delete' then
    if current_session.archived_at is null then raise exception 'Archive the session before deleting it'; end if;
    if current_session.fee_amount > 0 then raise exception 'Sessions with a player fee must be retained'; end if;
    if exists (select 1 from public.open_play_players where session_id = p_session_id) then raise exception 'Sessions with player records must be retained'; end if;
    if exists (select 1 from public.open_play_matches where session_id = p_session_id) then raise exception 'Sessions with match records must be retained'; end if;
    delete from public.open_play_sessions where id = p_session_id;
  else
    raise exception 'Choose start, cancel, end, archive, restore, or delete';
  end if;

  return current_session;
end
$$;

revoke all on function public.manage_open_play_session(text, text) from public;
grant execute on function public.manage_open_play_session(text, text) to authenticated;

create or replace function public.require_live_open_play_match()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.open_play_sessions session
    where session.id = new.session_id
      and session.status = 'active'
      and session.live_started_at is not null
      and session.archived_at is null
  ) then
    raise exception 'Start the Open Play session before assigning a match';
  end if;
  return new;
end
$$;

drop trigger if exists require_live_open_play_match_before_insert on public.open_play_matches;
create trigger require_live_open_play_match_before_insert
before insert on public.open_play_matches
for each row execute function public.require_live_open_play_match();

create index if not exists open_play_sessions_live_started_idx
  on public.open_play_sessions(venue_id, live_started_at desc)
  where live_started_at is not null and archived_at is null;
