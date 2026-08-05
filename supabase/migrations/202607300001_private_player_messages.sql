-- Consent-based private player conversations.
--
-- Players who share a team can chat immediately. Other players send one
-- message request that must be accepted before either side can continue.
-- Existing adult-chat eligibility, suspensions, and account blocks apply.

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_one_id uuid not null references public.profiles(id) on delete cascade,
  participant_two_id uuid not null references public.profiles(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (participant_one_id <> participant_two_id),
  check (requester_id in (participant_one_id, participant_two_id)),
  unique (participant_one_id, participant_two_id)
);

create index if not exists direct_conversations_one_inbox_idx
on public.direct_conversations(participant_one_id, last_message_at desc nulls last);
create index if not exists direct_conversations_two_inbox_idx
on public.direct_conversations(participant_two_id, last_message_at desc nulls last);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists direct_messages_conversation_idx
on public.direct_messages(conversation_id, created_at desc, id desc);

create table if not exists public.direct_conversation_reads (
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.direct_message_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  message_id uuid references public.direct_messages(id) on delete set null,
  reason text not null check (reason in (
    'harassment', 'hate', 'sexual_content', 'violence', 'spam',
    'privacy', 'child_safety', 'other'
  )),
  details text check (details is null or char_length(details) <= 1000),
  content_snapshot text check (content_snapshot is null or char_length(content_snapshot) <= 1000),
  priority text not null default 'standard'
    check (priority in ('standard', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);

create index if not exists direct_message_reports_queue_idx
on public.direct_message_reports(status, priority, created_at);
create unique index if not exists direct_message_reports_one_open_idx
on public.direct_message_reports(reporter_id, message_id)
where message_id is not null and status in ('open', 'reviewing');

alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;
alter table public.direct_conversation_reads enable row level security;
alter table public.direct_message_reports enable row level security;

create or replace function public.is_direct_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.direct_conversations conversation
    where conversation.id = p_conversation_id
      and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
  )
$$;

revoke all on function public.is_direct_conversation_participant(uuid) from public;
grant execute on function public.is_direct_conversation_participant(uuid) to authenticated;

drop policy if exists "participants read direct conversations" on public.direct_conversations;
create policy "participants read direct conversations"
on public.direct_conversations for select to authenticated
using (
  public.can_use_team_chat()
  and auth.uid() in (participant_one_id, participant_two_id)
);

drop policy if exists "participants read direct messages" on public.direct_messages;
create policy "participants read direct messages"
on public.direct_messages for select to authenticated
using (
  public.can_use_team_chat()
  and public.is_direct_conversation_participant(conversation_id)
);

drop policy if exists "participants read direct receipts" on public.direct_conversation_reads;
create policy "participants read direct receipts"
on public.direct_conversation_reads for select to authenticated
using (
  public.can_use_team_chat()
  and public.is_direct_conversation_participant(conversation_id)
);

drop policy if exists "users read own direct reports" on public.direct_message_reports;
create policy "users read own direct reports"
on public.direct_message_reports for select to authenticated
using (reporter_id = auth.uid() or public.is_platform_admin());

drop policy if exists "platform admins review direct reports" on public.direct_message_reports;
create policy "platform admins review direct reports"
on public.direct_message_reports for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

grant select on public.direct_conversations to authenticated;
grant select on public.direct_messages to authenticated;
grant select on public.direct_conversation_reads to authenticated;
grant select, update on public.direct_message_reports to authenticated;
revoke insert, update, delete on public.direct_conversations from authenticated;
revoke insert, update, delete on public.direct_messages from authenticated;
revoke insert, update, delete on public.direct_conversation_reads from authenticated;
revoke insert, delete on public.direct_message_reports from authenticated;

create or replace function public.get_direct_conversation(p_conversation_id uuid)
returns table (
  conversation_id uuid,
  peer_id uuid,
  peer_name text,
  peer_avatar_url text,
  peer_home_area text,
  status text,
  requester_id uuid,
  accepted_at timestamptz,
  created_at timestamptz,
  last_message_at timestamptz,
  peer_last_read_at timestamptz,
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
    conversation.accepted_at,
    conversation.created_at,
    conversation.last_message_at,
    peer_read.last_read_at,
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
  left join public.direct_conversation_reads peer_read
    on peer_read.conversation_id = conversation.id and peer_read.user_id = peer.id
  where conversation.id = p_conversation_id
    and public.can_use_team_chat()
    and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
$$;

create or replace function public.find_direct_conversation(p_player_id uuid)
returns table (
  conversation_id uuid,
  peer_id uuid,
  peer_name text,
  peer_avatar_url text,
  peer_home_area text,
  status text,
  requester_id uuid,
  accepted_at timestamptz,
  created_at timestamptz,
  last_message_at timestamptz,
  peer_last_read_at timestamptz,
  blocked_by_me boolean,
  blocked_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select details.*
  from public.direct_conversations conversation
  cross join lateral public.get_direct_conversation(conversation.id) details
  where auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
    and p_player_id in (conversation.participant_one_id, conversation.participant_two_id)
    and p_player_id <> auth.uid()
  limit 1
$$;

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
    latest.body,
    latest.created_at,
    latest.sender_id,
    count(unread.id) filter (where unread.sender_id <> auth.uid()),
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
    select message.body, message.created_at, message.sender_id
    from public.direct_messages message
    where message.conversation_id = conversation.id
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
    latest.body, latest.created_at, latest.sender_id
  order by latest.created_at desc nulls last, conversation.created_at desc
$$;

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

create or replace function public.send_direct_message(
  p_conversation_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := btrim(coalesce(p_body, ''));
  conversation public.direct_conversations;
  peer_id uuid;
  new_message_id uuid;
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 4000 then
    raise exception 'Messages must be between 1 and 4000 characters.';
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
  if (
    select count(*) from public.direct_messages recent
    where recent.sender_id = auth.uid()
      and recent.created_at > now() - interval '2 minutes'
      and lower(recent.body) = lower(clean_body)
  ) >= 2 then
    raise exception 'Please do not send the same message repeatedly.';
  end if;
  perform public.assert_chat_text_allowed(clean_body);

  insert into public.direct_messages(conversation_id, sender_id, body)
  values (conversation.id, auth.uid(), clean_body)
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

create or replace function public.respond_direct_message_request(
  p_conversation_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.direct_conversations;
  next_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;

  select item.* into conversation
  from public.direct_conversations item
  where item.id = p_conversation_id
    and item.status = 'pending'
    and item.requester_id <> auth.uid()
    and auth.uid() in (item.participant_one_id, item.participant_two_id)
  for update;

  if not found then
    raise exception 'This message request is no longer pending.';
  end if;
  if p_accept and exists (
    select 1 from public.chat_user_blocks block
    where (
      block.blocker_id = conversation.participant_one_id
      and block.blocked_id = conversation.participant_two_id
    ) or (
      block.blocker_id = conversation.participant_two_id
      and block.blocked_id = conversation.participant_one_id
    )
  ) then
    raise exception 'This message request cannot be accepted.';
  end if;

  update public.direct_conversations
  set status = next_status,
      accepted_at = case when p_accept then now() else null end,
      updated_at = now()
  where id = conversation.id;

  insert into public.direct_conversation_reads(conversation_id, user_id, last_read_at)
  values (conversation.id, auth.uid(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;

  if p_accept then
    insert into public.user_notifications(user_id, kind, title, body, data)
    values (
      conversation.requester_id,
      'direct_message_accepted',
      'Message request accepted',
      'You can now continue your private conversation.',
      jsonb_build_object(
        'conversationId', conversation.id,
        'playerId', auth.uid(),
        'dedupeKey', 'direct-accepted:' || conversation.id::text
      )
    )
    on conflict do nothing;
  end if;

  return next_status;
end;
$$;

create or replace function public.mark_direct_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_use_team_chat()
    or not public.is_direct_conversation_participant(p_conversation_id) then
    raise exception 'This conversation is unavailable.';
  end if;

  insert into public.direct_conversation_reads(conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.report_direct_message(
  p_message_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_message public.direct_messages;
  report_id uuid;
  clean_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if p_reason not in (
    'harassment', 'hate', 'sexual_content', 'violence', 'spam',
    'privacy', 'child_safety', 'other'
  ) then
    raise exception 'Choose a valid report reason.';
  end if;
  if clean_details is not null and char_length(clean_details) > 1000 then
    raise exception 'Report details must be 1000 characters or fewer.';
  end if;

  select message.* into source_message
  from public.direct_messages message
  where message.id = p_message_id;

  if not found
    or source_message.sender_id = auth.uid()
    or not public.is_direct_conversation_participant(source_message.conversation_id) then
    raise exception 'This message cannot be reported.';
  end if;

  insert into public.direct_message_reports(
    reporter_id, reported_user_id, conversation_id, message_id, reason,
    details, content_snapshot, priority
  )
  values (
    auth.uid(), source_message.sender_id, source_message.conversation_id,
    source_message.id, p_reason, clean_details, left(source_message.body, 1000),
    case
      when p_reason = 'child_safety' then 'critical'
      when p_reason in ('sexual_content', 'violence', 'privacy') then 'high'
      else 'standard'
    end
  )
  returning id into report_id;

  return report_id;
exception
  when unique_violation then
    raise exception 'You already reported this message and it is awaiting review.';
end;
$$;

-- A direct-message participant can block the other player even when they do
-- not share a team.
create or replace function public.block_chat_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Choose another player to block.';
  end if;
  if not exists (
    select 1
    from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  ) and not exists (
    select 1
    from public.direct_conversations conversation
    where auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
      and p_user_id in (conversation.participant_one_id, conversation.participant_two_id)
  ) then
    raise exception 'You can only block a player you have interacted with.';
  end if;

  insert into public.chat_user_blocks(blocker_id, blocked_id)
  values (auth.uid(), p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

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

drop trigger if exists notify_direct_message_after_insert on public.direct_messages;
create trigger notify_direct_message_after_insert
after insert on public.direct_messages
for each row execute function public.notify_direct_message();

alter table public.user_notifications
  drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications
  add constraint user_notifications_kind_check check (kind in (
    'approval','waitlist_promotion','check_in_reminder','court_assignment','match_point','result',
    'cancellation','venue_announcement','booking_reminder','court_waitlist','booking_changed',
    'booking_confirmed','match_invite','match_invite_response','match_found','organizer_match',
    'direct_message','direct_message_request','direct_message_accepted'
  ));

create unique index if not exists user_notifications_direct_message_dedupe_idx
on public.user_notifications(user_id, kind, ((data->>'dedupeKey')))
where data ? 'dedupeKey'
  and kind in ('direct_message','direct_message_request','direct_message_accepted');

revoke all on function public.get_direct_conversation(uuid) from public;
revoke all on function public.find_direct_conversation(uuid) from public;
revoke all on function public.list_direct_conversations() from public;
revoke all on function public.start_direct_conversation(uuid, text) from public;
revoke all on function public.send_direct_message(uuid, text) from public;
revoke all on function public.respond_direct_message_request(uuid, boolean) from public;
revoke all on function public.mark_direct_conversation_read(uuid) from public;
revoke all on function public.report_direct_message(uuid, text, text) from public;
revoke all on function public.notify_direct_message() from public;
grant execute on function public.get_direct_conversation(uuid) to authenticated;
grant execute on function public.find_direct_conversation(uuid) to authenticated;
grant execute on function public.list_direct_conversations() to authenticated;
grant execute on function public.start_direct_conversation(uuid, text) to authenticated;
grant execute on function public.send_direct_message(uuid, text) to authenticated;
grant execute on function public.respond_direct_message_request(uuid, boolean) to authenticated;
grant execute on function public.mark_direct_conversation_read(uuid) to authenticated;
grant execute on function public.report_direct_message(uuid, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_conversations'
  ) then
    alter publication supabase_realtime add table public.direct_conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_conversation_reads'
  ) then
    alter publication supabase_realtime add table public.direct_conversation_reads;
  end if;
end $$;
