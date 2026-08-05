-- Free archived sessions with registrations but no match history can be deleted.
-- Registration and operational rows already reference the session with ON DELETE CASCADE.
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

  if p_action = 'cancel' then
    if current_session.archived_at is not null then raise exception 'Archived sessions cannot be changed'; end if;
    if current_session.status not in ('draft', 'active') then raise exception 'Only upcoming or active sessions can be cancelled'; end if;
    update public.open_play_sessions
    set status = 'cancelled', ended_at = coalesce(ended_at, now()), updated_at = now()
    where id = p_session_id
    returning * into current_session;
  elsif p_action = 'end' then
    if current_session.archived_at is not null then raise exception 'Archived sessions cannot be changed'; end if;
    if current_session.status <> 'active' then raise exception 'Only an active session can be ended'; end if;
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
    if exists (select 1 from public.open_play_matches where session_id = p_session_id) then raise exception 'Sessions with match records must be retained'; end if;
    delete from public.open_play_sessions where id = p_session_id;
  else
    raise exception 'Choose cancel, end, archive, restore, or delete';
  end if;

  return current_session;
end
$$;

revoke all on function public.manage_open_play_session(text, text) from public;
grant execute on function public.manage_open_play_session(text, text) to authenticated;
