-- Photos, videos, and voice messages in private conversations. Files live in the private
-- direct-message-media bucket under <conversation_id>/<sender_id>/<file>, so
-- only the two participants can read them and only the sender can upload
-- into their own folder. Requires 202609260005 and 202609260006.

alter table public.direct_messages
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists media_mime text,
  add column if not exists media_size bigint,
  add column if not exists media_name text,
  add column if not exists media_duration_ms integer;

alter table public.direct_messages drop constraint if exists direct_messages_media_type_check;
alter table public.direct_messages
  add constraint direct_messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'audio'));

alter table public.direct_messages drop constraint if exists direct_messages_media_duration_check;
alter table public.direct_messages
  add constraint direct_messages_media_duration_check
  check (media_duration_ms is null or media_duration_ms between 0 and 600000);

alter table public.direct_messages drop constraint if exists direct_messages_media_size_check;
alter table public.direct_messages
  add constraint direct_messages_media_size_check
  check (media_size is null or media_size between 1 and 15728640);

-- A live message has text, media, or both. An unsent one has neither.
alter table public.direct_messages drop constraint if exists direct_messages_body_or_deleted_check;
alter table public.direct_messages
  add constraint direct_messages_body_or_deleted_check
  check (
    (deleted_at is null
      and (body is null or char_length(btrim(body)) between 1 and 4000)
      and (body is not null or media_path is not null))
    or (deleted_at is not null and body is null and media_path is null)
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'direct-message-media',
  'direct-message-media',
  false,
  15728640,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/mpeg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- storage.foldername(name)[1] is the conversation id, [2] the uploader.
create or replace function public.direct_media_conversation_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "participants read direct message media" on storage.objects;
create policy "participants read direct message media"
on storage.objects for select to authenticated
using (
  bucket_id = 'direct-message-media'
  and public.is_direct_conversation_participant(public.direct_media_conversation_id(name))
);

drop policy if exists "participants upload direct message media" on storage.objects;
create policy "participants upload direct message media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'direct-message-media'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1 from public.direct_conversations conversation
    where conversation.id = public.direct_media_conversation_id(name)
      and conversation.status = 'accepted'
      and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
  )
);

drop policy if exists "senders delete own direct message media" on storage.objects;
create policy "senders delete own direct message media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'direct-message-media'
  and owner_id = auth.uid()::text
);

create or replace function public.send_direct_media_message(
  p_conversation_id uuid,
  p_media_path text,
  p_media_type text,
  p_media_mime text,
  p_media_size bigint,
  p_media_name text default null,
  p_media_duration_ms integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.direct_conversations;
  peer_id uuid;
  new_message_id uuid;
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;
  if p_media_type not in ('image', 'video', 'audio') then
    raise exception 'This attachment type is not supported.';
  end if;
  -- Only a file this player uploaded into this conversation's folder.
  if p_media_path is null
    or p_media_path not like p_conversation_id::text || '/' || auth.uid()::text || '/%'
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'direct-message-media'
        and object.name = p_media_path
        and object.owner_id = auth.uid()::text
    ) then
    raise exception 'Upload the attachment before sending it.';
  end if;

  select item.* into conversation
  from public.direct_conversations item
  where item.id = p_conversation_id
    and auth.uid() in (item.participant_one_id, item.participant_two_id)
  for update;

  if not found or conversation.status <> 'accepted' then
    raise exception 'This conversation is not open for replies.';
  end if;
  peer_id := case
    when conversation.participant_one_id = auth.uid() then conversation.participant_two_id
    else conversation.participant_one_id
  end;
  if exists (
    select 1 from public.chat_user_blocks block
    where (block.blocker_id = auth.uid() and block.blocked_id = peer_id)
       or (block.blocker_id = peer_id and block.blocked_id = auth.uid())
  ) then
    raise exception 'Private messaging is unavailable for this player.';
  end if;
  if (
    select count(*) from public.direct_messages recent
    where recent.sender_id = auth.uid()
      and recent.created_at > now() - interval '10 seconds'
  ) >= 6 or (
    select count(*) from public.direct_messages recent
    where recent.sender_id = auth.uid()
      and recent.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;

  insert into public.direct_messages(conversation_id, sender_id, body, media_path, media_type, media_mime, media_size, media_name, media_duration_ms)
  values (conversation.id, auth.uid(), null, p_media_path, p_media_type, p_media_mime, p_media_size, left(p_media_name, 200), p_media_duration_ms)
  returning id into new_message_id;

  update public.direct_conversations
  set last_message_at = now(), updated_at = now()
  where id = conversation.id;

  insert into public.direct_conversation_reads(conversation_id, user_id, last_read_at)
  values (conversation.id, auth.uid(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;

  return new_message_id;
end;
$$;

-- Unsend also clears the attachment fields; the app then removes the file.
create or replace function public.unsend_direct_message(p_message_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  unsent_at timestamptz := now();
begin
  update public.direct_messages message
  set body = null, media_path = null, media_type = null, media_mime = null,
      media_size = null, media_name = null, media_duration_ms = null, deleted_at = unsent_at
  where message.id = p_message_id
    and message.sender_id = auth.uid()
    and message.deleted_at is null
    and public.is_direct_conversation_participant(message.conversation_id);

  if not found then
    raise exception 'Only the sender can unsend an active message.' using errcode = '42501';
  end if;

  delete from public.direct_message_reactions reaction
  where reaction.message_id = p_message_id;

  return unsent_at;
end;
$$;

-- Same as 202609260005, but a photo, video, or voice message still gets a
-- notification body.
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
    coalesce(
      left(new.body, 180),
      case new.media_type when 'video' then 'Sent a video' when 'audio' then 'Sent a voice message' else 'Sent a photo' end
    ),
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

-- Same as 202609260006, with photo, video, and voice previews in the inbox.
create or replace function public.list_direct_conversations()
returns table (
  conversation_id uuid,
  peer_id uuid,
  peer_name text,
  peer_avatar_url text,
  peer_home_area text,
  status text,
  requester_id uuid,
  last_body text,
  last_created_at timestamptz,
  last_sender_id uuid,
  unread_count bigint,
  blocked_by_me boolean,
  blocked_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    peer.id,
    peer.display_name,
    peer.avatar_url,
    peer.home_area,
    conversation.status,
    conversation.requester_id,
    case
      when latest.deleted_at is not null then 'Message unsent'
      when latest.body is null and latest.media_type = 'video' then 'Sent a video'
      when latest.body is null and latest.media_type = 'audio' then 'Sent a voice message'
      when latest.body is null and latest.media_type is not null then 'Sent a photo'
      else latest.body
    end,
    latest.created_at,
    latest.sender_id,
    count(unread.id) filter (where unread.sender_id <> auth.uid() and unread.deleted_at is null),
    exists (
      select 1 from public.chat_user_blocks block
      where block.blocker_id = auth.uid() and block.blocked_id = peer.id
    ),
    exists (
      select 1 from public.chat_user_blocks block
      where block.blocker_id = peer.id and block.blocked_id = auth.uid()
    )
  from public.direct_conversations conversation
  join public.profiles peer
    on peer.id = case
      when conversation.participant_one_id = auth.uid() then conversation.participant_two_id
      else conversation.participant_one_id
    end
  left join lateral (
    select message.body, message.media_type, message.deleted_at, message.created_at, message.sender_id
    from public.direct_messages message
    where message.conversation_id = conversation.id
      and not exists (
        select 1 from public.direct_message_hides hidden
        where hidden.message_id = message.id and hidden.user_id = auth.uid()
      )
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  left join public.direct_conversation_reads read_state
    on read_state.conversation_id = conversation.id and read_state.user_id = auth.uid()
  left join public.direct_messages unread
    on unread.conversation_id = conversation.id
   and unread.created_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
  where public.can_use_team_chat()
    and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
  group by
    conversation.id, peer.id, peer.display_name, peer.avatar_url, peer.home_area,
    latest.body, latest.media_type, latest.deleted_at, latest.created_at, latest.sender_id
  order by latest.created_at desc nulls last, conversation.created_at desc
$$;

revoke all on function public.send_direct_media_message(uuid, text, text, text, bigint, text, integer) from public;
grant execute on function public.send_direct_media_message(uuid, text, text, text, bigint, text, integer) to authenticated;
revoke all on function public.unsend_direct_message(uuid) from public;
grant execute on function public.unsend_direct_message(uuid) to authenticated;
revoke all on function public.direct_media_conversation_id(text) from public;
grant execute on function public.direct_media_conversation_id(text) to authenticated;

notify pgrst, 'reload schema';
