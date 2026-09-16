-- Unlike start_support_conversation (fixed in 202608280001), this function
-- has no local `conversation_id` binding — only `p_conversation_id` — so its
-- `on conflict (conversation_id, user_id)` target was never ambiguous. This
-- just aligns it with the same named-constraint target for consistency, and
-- swaps now() for clock_timestamp() so last_read_at can't tie with a
-- message's own created_at when both are stamped from the same statement.
create or replace function public.send_support_message(
  p_conversation_id uuid,
  p_body text,
  p_media_path text default null,
  p_media_type text default null,
  p_media_name text default null,
  p_media_mime text default null,
  p_media_size bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := btrim(coalesce(p_body, ''));
  conversation public.support_conversations;
  new_message_id uuid;
begin
  if char_length(clean_body) > 4000 then
    raise exception 'Messages must be 4000 characters or fewer.';
  end if;
  if clean_body = '' and p_media_path is null then
    raise exception 'Write a message or attach an image.';
  end if;
  if p_media_path is not null then
    if p_media_type is distinct from 'image' then
      raise exception 'Only image attachments are supported.';
    end if;
    if p_media_size is null or p_media_size < 1 or p_media_size > 5242880 then
      raise exception 'Images must be 5MB or smaller.';
    end if;
  end if;

  select item.* into conversation
  from public.support_conversations item
  where item.id = p_conversation_id
    and item.requester_id = auth.uid()
  for update;

  if not found then
    raise exception 'This conversation is unavailable.';
  end if;
  if (
    select count(*) from public.support_messages recent
    where recent.sender_id = auth.uid() and recent.sender_type = 'user'
      and recent.created_at > now() - interval '10 seconds'
  ) >= 6 or (
    select count(*) from public.support_messages recent
    where recent.sender_id = auth.uid() and recent.sender_type = 'user'
      and recent.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;
  if clean_body <> '' and (
    select count(*) from public.support_messages recent
    where recent.sender_id = auth.uid() and recent.sender_type = 'user'
      and recent.created_at > now() - interval '2 minutes'
      and lower(recent.body) = lower(clean_body)
  ) >= 2 then
    raise exception 'Please do not send the same message repeatedly.';
  end if;
  if clean_body <> '' then
    perform public.assert_chat_text_allowed(clean_body);
  end if;

  insert into public.support_messages(
    conversation_id, sender_type, sender_id, body,
    media_path, media_type, media_name, media_mime, media_size
  )
  values (
    conversation.id, 'user', auth.uid(), clean_body,
    p_media_path, p_media_type, p_media_name, p_media_mime, p_media_size
  )
  returning id into new_message_id;

  update public.support_conversations
  set last_message_at = now(),
      updated_at = now(),
      status = case when status = 'closed' then 'open' else status end,
      ai_handled = case when status = 'closed' then false else ai_handled end
  where id = conversation.id;

  insert into public.support_conversation_reads(conversation_id, user_id, last_read_at)
  values (conversation.id, auth.uid(), clock_timestamp())
  on conflict on constraint support_conversation_reads_pkey
  do update set last_read_at = excluded.last_read_at;

  return new_message_id;
end;
$$;

revoke all on function public.send_support_message(uuid, text, text, text, text, text, bigint) from public;
grant execute on function public.send_support_message(uuid, text, text, text, text, text, bigint) to authenticated;

-- Lets a requester remove a conversation from their own history (e.g. once
-- it's closed and no longer useful to keep around). support_messages and
-- support_conversation_reads both reference support_conversations with
-- `on delete cascade`, so this alone clears the whole thread; it does not
-- attempt to sweep any attached-image objects out of the storage bucket.
create or replace function public.delete_support_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.support_conversations
  where id = p_conversation_id
    and requester_id = auth.uid();

  if not found then
    raise exception 'This conversation is unavailable.';
  end if;
end;
$$;

revoke all on function public.delete_support_conversation(uuid) from public;
grant execute on function public.delete_support_conversation(uuid) to authenticated;
