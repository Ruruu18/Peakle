-- Per-player inbox controls for private conversations: archive, mute, and
-- delete-for-me. Each row belongs to one participant, so these choices never
-- change what the other player sees.
--
-- archived_at  Archived while no message is newer than this, so a new message
--              brings the conversation back to the main inbox.
-- cleared_at   "Deleted" for this player: messages up to this moment are hidden
--              and the conversation stays out of the inbox until a newer one.
-- muted_until  No message notifications (in-app or push) until this moment;
--              'infinity' mutes until the player turns it back on.

create table if not exists public.direct_conversation_settings (
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  archived_at timestamptz,
  cleared_at timestamptz,
  muted_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists direct_conversation_settings_user_idx
on public.direct_conversation_settings(user_id);

alter table public.direct_conversation_settings enable row level security;
revoke all on public.direct_conversation_settings from anon, authenticated;
grant select on public.direct_conversation_settings to authenticated;

drop policy if exists "users read own direct conversation settings" on public.direct_conversation_settings;
create policy "users read own direct conversation settings"
on public.direct_conversation_settings for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.require_direct_conversation_participant(p_conversation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage conversations.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.direct_conversations conversation
    where conversation.id = p_conversation_id
      and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
  ) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_direct_conversation_archived(
  p_conversation_id uuid,
  p_archived boolean
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_archived_at timestamptz := case when coalesce(p_archived, false) then now() end;
begin
  perform public.require_direct_conversation_participant(p_conversation_id);
  insert into public.direct_conversation_settings(conversation_id, user_id, archived_at)
  values (p_conversation_id, auth.uid(), next_archived_at)
  on conflict (conversation_id, user_id) do update
    set archived_at = excluded.archived_at, updated_at = now();
  return next_archived_at;
end;
$$;

-- p_muted = false unmutes. With p_muted = true, p_minutes sets a timed mute
-- (up to one week); null mutes until the player turns it back on.
create or replace function public.set_direct_conversation_muted(
  p_conversation_id uuid,
  p_muted boolean,
  p_minutes integer default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_muted_until timestamptz;
begin
  perform public.require_direct_conversation_participant(p_conversation_id);
  if coalesce(p_muted, false) then
    if p_minutes is not null and (p_minutes < 1 or p_minutes > 10080) then
      raise exception 'Choose a mute length between 1 minute and 7 days.' using errcode = '22023';
    end if;
    next_muted_until := case
      when p_minutes is null then 'infinity'::timestamptz
      else now() + make_interval(mins => p_minutes)
    end;
  end if;
  insert into public.direct_conversation_settings(conversation_id, user_id, muted_until)
  values (p_conversation_id, auth.uid(), next_muted_until)
  on conflict (conversation_id, user_id) do update
    set muted_until = excluded.muted_until, updated_at = now();
  return next_muted_until;
end;
$$;

-- Hides the history for the caller only and marks it read, so a later
-- message shows up as a fresh conversation with an accurate unread count.
create or replace function public.delete_direct_conversation_for_me(p_conversation_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleared timestamptz := now();
begin
  perform public.require_direct_conversation_participant(p_conversation_id);
  insert into public.direct_conversation_settings(conversation_id, user_id, cleared_at, archived_at)
  values (p_conversation_id, auth.uid(), cleared, null)
  on conflict (conversation_id, user_id) do update
    set cleared_at = excluded.cleared_at, archived_at = null, updated_at = now();
  insert into public.direct_conversation_reads(conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), cleared)
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(public.direct_conversation_reads.last_read_at, excluded.last_read_at);
  return cleared;
end;
$$;

-- Same as before, except a recipient who muted the conversation gets no
-- notification row, which suppresses both the in-app banner and the push.
create or replace function public.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.direct_conversations;
  recipient_id uuid;
  sender_name text;
  notification_kind text;
begin
  select item.* into conversation
  from public.direct_conversations item
  where item.id = new.conversation_id;

  recipient_id := case
    when conversation.participant_one_id = new.sender_id then conversation.participant_two_id
    else conversation.participant_one_id
  end;

  if exists (
    select 1 from public.direct_conversation_settings setting
    where setting.conversation_id = new.conversation_id
      and setting.user_id = recipient_id
      and setting.muted_until > now()
  ) then
    return new;
  end if;

  select profile.display_name into sender_name
  from public.profiles profile where profile.id = new.sender_id;
  notification_kind := case
    when conversation.status = 'pending' then 'direct_message_request'
    else 'direct_message'
  end;

  insert into public.user_notifications(user_id, kind, title, body, data)
  values (
    recipient_id,
    notification_kind,
    case when conversation.status = 'pending'
      then 'New message request'
      else coalesce(sender_name, 'A player') end,
    left(new.body, 180),
    jsonb_build_object(
      'conversationId', conversation.id,
      'messageId', new.id,
      'playerId', new.sender_id,
      'dedupeKey', 'direct-message:' || new.id::text
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.require_direct_conversation_participant(uuid) from public;
revoke all on function public.set_direct_conversation_archived(uuid, boolean) from public;
revoke all on function public.set_direct_conversation_muted(uuid, boolean, integer) from public;
revoke all on function public.delete_direct_conversation_for_me(uuid) from public;
revoke all on function public.notify_direct_message() from public;
grant execute on function public.set_direct_conversation_archived(uuid, boolean) to authenticated;
grant execute on function public.set_direct_conversation_muted(uuid, boolean, integer) to authenticated;
grant execute on function public.delete_direct_conversation_for_me(uuid) to authenticated;

notify pgrst, 'reload schema';
