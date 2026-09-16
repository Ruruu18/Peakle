-- The start function returns a column named `conversation_id`. In PL/pgSQL,
-- that output column is also a variable, so the previous
-- `on conflict (conversation_id, user_id)` target was ambiguous and rolled
-- back every attempt to create a support conversation. Target the named
-- primary-key constraint instead.

create or replace function public.start_support_conversation(
  p_body text,
  p_category text default null,
  p_media_path text default null,
  p_media_type text default null,
  p_media_name text default null,
  p_media_mime text default null,
  p_media_size bigint default null
)
returns table (conversation_id uuid, message_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := btrim(coalesce(p_body, ''));
  clean_category text := nullif(btrim(coalesce(p_category, '')), '');
  new_conversation public.support_conversations;
  new_message_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to contact support.';
  end if;
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
  if clean_category is not null and char_length(clean_category) > 60 then
    raise exception 'Choose a shorter topic.';
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
  if clean_body <> '' then
    perform public.assert_chat_text_allowed(clean_body);
  end if;

  insert into public.support_conversations(
    requester_id, category, status, ai_handled, last_message_at, updated_at
  )
  values (auth.uid(), clean_category, 'bot', true, now(), now())
  returning * into new_conversation;

  insert into public.support_messages(
    conversation_id, sender_type, sender_id, body,
    media_path, media_type, media_name, media_mime, media_size
  )
  values (
    new_conversation.id, 'user', auth.uid(), clean_body,
    p_media_path, p_media_type, p_media_name, p_media_mime, p_media_size
  )
  returning id into new_message_id;

  insert into public.support_conversation_reads(conversation_id, user_id, last_read_at)
  values (new_conversation.id, auth.uid(), clock_timestamp())
  on conflict on constraint support_conversation_reads_pkey
  do update set last_read_at = excluded.last_read_at;

  return query select new_conversation.id, new_message_id;
end;
$$;

revoke all on function public.start_support_conversation(text, text, text, text, text, text, bigint) from public;
grant execute on function public.start_support_conversation(text, text, text, text, text, text, bigint) to authenticated;
