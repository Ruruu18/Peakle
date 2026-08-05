-- Messenger-style reactions for accepted one-to-one conversations.

create table if not exists public.direct_message_reactions (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🔥', '👏', '🎉')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists direct_message_reactions_message_idx
on public.direct_message_reactions(message_id, created_at);

alter table public.direct_message_reactions enable row level security;

drop policy if exists "participants read direct message reactions" on public.direct_message_reactions;
create policy "participants read direct message reactions"
on public.direct_message_reactions for select to authenticated
using (
  public.can_use_team_chat()
  and exists (
    select 1
    from public.direct_messages message
    join public.direct_conversations conversation on conversation.id = message.conversation_id
    where message.id = direct_message_reactions.message_id
      and conversation.status = 'accepted'
      and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
  )
);

revoke all on public.direct_message_reactions from public, anon, authenticated;
grant select on public.direct_message_reactions to authenticated;

create or replace function public.toggle_direct_message_reaction(
  p_message_id uuid,
  p_emoji text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_conversation public.direct_conversations;
  existing_emoji text;
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;
  if p_emoji not in ('👍', '❤️', '😂', '🔥', '👏', '🎉') then
    raise exception 'Unsupported reaction.';
  end if;

  select conversation.* into target_conversation
  from public.direct_messages message
  join public.direct_conversations conversation on conversation.id = message.conversation_id
  where message.id = p_message_id
    and conversation.status = 'accepted'
    and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id);

  if not found then
    raise exception 'This message is unavailable for reactions.';
  end if;
  if exists (
    select 1
    from public.chat_user_blocks block
    where (
      block.blocker_id = target_conversation.participant_one_id
      and block.blocked_id = target_conversation.participant_two_id
    ) or (
      block.blocker_id = target_conversation.participant_two_id
      and block.blocked_id = target_conversation.participant_one_id
    )
  ) then
    raise exception 'Private messaging is unavailable for this player.';
  end if;

  select reaction.emoji into existing_emoji
  from public.direct_message_reactions reaction
  where reaction.message_id = p_message_id
    and reaction.user_id = auth.uid();

  delete from public.direct_message_reactions reaction
  where reaction.message_id = p_message_id
    and reaction.user_id = auth.uid();

  if existing_emoji = p_emoji then
    return false;
  end if;

  insert into public.direct_message_reactions(message_id, user_id, emoji)
  values (p_message_id, auth.uid(), p_emoji);
  return true;
end;
$$;

revoke all on function public.toggle_direct_message_reaction(uuid, text) from public;
grant execute on function public.toggle_direct_message_reaction(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_message_reactions'
  ) then
    alter publication supabase_realtime add table public.direct_message_reactions;
  end if;
end $$;
