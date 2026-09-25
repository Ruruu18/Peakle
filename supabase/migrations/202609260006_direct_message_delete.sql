-- Per-message delete for private conversations, matching team chat:
--
-- Delete for you       Hides one message from the caller only
--                      (direct_message_hides). The other player still sees it.
-- Delete for everyone  The sender unsends their own message. Its text and
--                      reactions are erased and both players see
--                      "Message unsent" in its place.

alter table public.direct_messages
  add column if not exists deleted_at timestamptz;

alter table public.direct_messages alter column body drop not null;
alter table public.direct_messages drop constraint if exists direct_messages_body_check;
alter table public.direct_messages drop constraint if exists direct_messages_body_or_deleted_check;
alter table public.direct_messages
  add constraint direct_messages_body_or_deleted_check
  check (
    (deleted_at is null and body is not null and char_length(btrim(body)) between 1 and 4000)
    or (deleted_at is not null and body is null)
  );

create table if not exists public.direct_message_hides (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists direct_message_hides_user_idx
on public.direct_message_hides(user_id);

alter table public.direct_message_hides enable row level security;
revoke all on public.direct_message_hides from public, anon, authenticated;
grant select on public.direct_message_hides to authenticated;

drop policy if exists "users read own hidden direct messages" on public.direct_message_hides;
create policy "users read own hidden direct messages"
on public.direct_message_hides for select to authenticated
using (user_id = (select auth.uid()));

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
  set body = null, deleted_at = unsent_at
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

create or replace function public.hide_direct_message(p_message_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.direct_messages message
    where message.id = p_message_id
      and public.is_direct_conversation_participant(message.conversation_id)
  ) then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;

  insert into public.direct_message_hides(message_id, user_id)
  values (p_message_id, auth.uid())
  on conflict (message_id, user_id) do nothing;
end;
$$;

-- Same as before, except the inbox preview skips messages hidden for the
-- caller, labels unsent ones, and unsent messages no longer count as unread.
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
    case when latest.deleted_at is not null then 'Message unsent' else latest.body end,
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
    select message.body, message.deleted_at, message.created_at, message.sender_id
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
    latest.body, latest.deleted_at, latest.created_at, latest.sender_id
  order by latest.created_at desc nulls last, conversation.created_at desc
$$;

revoke all on function public.unsend_direct_message(uuid) from public;
revoke all on function public.hide_direct_message(uuid) from public;
grant execute on function public.unsend_direct_message(uuid) to authenticated;
grant execute on function public.hide_direct_message(uuid) to authenticated;

notify pgrst, 'reload schema';
