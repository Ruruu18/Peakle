-- Avoid a PL/pgSQL name collision between the start_direct_conversation
-- result column and direct_conversation_reads.conversation_id.

create or replace function public.start_direct_conversation(
  p_player_id uuid,
  p_body text
)
returns table (conversation_id uuid, message_id uuid, conversation_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := btrim(coalesce(p_body, ''));
  first_id uuid;
  second_id uuid;
  conversation public.direct_conversations;
  new_message_id uuid;
  initial_status text := 'pending';
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;
  if p_player_id is null or p_player_id = auth.uid() then
    raise exception 'Choose another player to message.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 4000 then
    raise exception 'Messages must be between 1 and 4000 characters.';
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
  perform public.assert_chat_text_allowed(clean_body);
  if not exists (
    select 1 from public.chat_safety_profiles safety
    where safety.user_id = p_player_id and safety.is_adult
      and safety.rules_acknowledged_at is not null
  ) or exists (
    select 1 from public.chat_suspensions suspension
    where suspension.user_id = p_player_id
      and (suspension.suspended_until is null or suspension.suspended_until > now())
  ) then
    raise exception 'This player is not available for private chat.';
  end if;
  if exists (
    select 1 from public.chat_user_blocks block
    where (block.blocker_id = auth.uid() and block.blocked_id = p_player_id)
       or (block.blocker_id = p_player_id and block.blocked_id = auth.uid())
  ) then
    raise exception 'Private messaging is unavailable for this player.';
  end if;

  if auth.uid()::text < p_player_id::text then
    first_id := auth.uid();
    second_id := p_player_id;
  else
    first_id := p_player_id;
    second_id := auth.uid();
  end if;

  select existing.* into conversation
  from public.direct_conversations existing
  where existing.participant_one_id = first_id
    and existing.participant_two_id = second_id
  for update;

  if found then
    if conversation.status = 'declined' then
      raise exception 'This message request was declined.';
    end if;
    if conversation.status = 'pending' then
      if conversation.requester_id = auth.uid() then
        raise exception 'Wait for this player to accept your message request.';
      end if;
      raise exception 'Accept the message request before replying.';
    end if;
  else
    if exists (
      select 1
      from public.team_members mine
      join public.team_members peer_member on peer_member.team_id = mine.team_id
      where mine.user_id = auth.uid() and peer_member.user_id = p_player_id
    ) then
      initial_status := 'accepted';
    end if;

    insert into public.direct_conversations(
      participant_one_id, participant_two_id, requester_id, status, accepted_at
    )
    values (
      first_id, second_id, auth.uid(), initial_status,
      case when initial_status = 'accepted' then now() else null end
    )
    returning * into conversation;
  end if;

  insert into public.direct_messages(conversation_id, sender_id, body)
  values (conversation.id, auth.uid(), clean_body)
  returning id into new_message_id;

  update public.direct_conversations
  set last_message_at = now(), updated_at = now()
  where id = conversation.id;

  insert into public.direct_conversation_reads(conversation_id, user_id, last_read_at)
  values (conversation.id, auth.uid(), now())
  on conflict on constraint direct_conversation_reads_pkey
  do update set last_read_at = excluded.last_read_at;

  return query select conversation.id, new_message_id, conversation.status;
end;
$$;

revoke all on function public.start_direct_conversation(uuid, text) from public;
grant execute on function public.start_direct_conversation(uuid, text) to authenticated;
