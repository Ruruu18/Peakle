-- In-app support chat: a player or organizer starts a conversation with
-- Peakle support. An AI responder (a separate Edge Function, using the
-- service role) answers first; it or the requester can escalate to a human,
-- at which point a platform admin claims the conversation from the admin
-- inbox. Reuses the same shape as private player messages
-- (202607300001_private_player_messages.sql) but without peer-to-peer
-- gating, since the counterparty is always Peakle support. Also supports a
-- single image attachment per message (mirroring team_messages' media
-- columns from 202607210001_team_chat_features.sql) and a one-time CSAT
-- rating once a conversation is closed.

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'bot'
    check (status in ('bot', 'open', 'assigned', 'closed')),
  assigned_agent_id uuid references public.profiles(id),
  category text check (category is null or char_length(category) <= 60),
  ai_handled boolean not null default true,
  needs_human boolean not null default false,
  csat_rating smallint check (csat_rating is null or csat_rating between 1 and 5),
  csat_comment text check (csat_comment is null or char_length(csat_comment) <= 500),
  csat_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create index if not exists support_conversations_requester_idx
on public.support_conversations(requester_id, last_message_at desc nulls last);
create index if not exists support_conversations_status_idx
on public.support_conversations(status, last_message_at desc nulls last);

-- `create table if not exists` above is a no-op if this table already
-- existed from an earlier partial run of this file (before these columns
-- were added to it) — these backfill it either way.
alter table public.support_conversations add column if not exists needs_human boolean not null default false;
alter table public.support_conversations add column if not exists csat_rating smallint check (csat_rating is null or csat_rating between 1 and 5);
alter table public.support_conversations add column if not exists csat_comment text check (csat_comment is null or char_length(csat_comment) <= 500);
alter table public.support_conversations add column if not exists csat_submitted_at timestamptz;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'ai', 'agent')),
  sender_id uuid references public.profiles(id),
  body text not null default '' check (char_length(btrim(body)) <= 4000),
  media_path text,
  media_type text check (media_type is null or media_type = 'image'),
  media_name text,
  media_mime text,
  media_size bigint check (media_size is null or media_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  check (
    (sender_type = 'ai' and sender_id is null)
    or (sender_type <> 'ai' and sender_id is not null)
  ),
  check (char_length(btrim(body)) >= 1 or media_path is not null)
);

create index if not exists support_messages_conversation_idx
on public.support_messages(conversation_id, created_at desc, id desc);

-- Same backfill as above: an already-existing support_messages table (from
-- before attachments/the relaxed body constraint were added) needs these
-- added explicitly. The original body check was a single unnamed
-- column-level constraint, so Postgres auto-named it
-- `support_messages_body_check` (the standard `<table>_<column>_check`
-- convention) — drop that specific name, not a guess.
alter table public.support_messages alter column body set default '';
alter table public.support_messages drop constraint if exists support_messages_body_check;
alter table public.support_messages drop constraint if exists support_messages_body_length_check;
alter table public.support_messages add constraint support_messages_body_length_check check (char_length(btrim(body)) <= 4000);
alter table public.support_messages add column if not exists media_path text;
alter table public.support_messages add column if not exists media_type text check (media_type is null or media_type = 'image');
alter table public.support_messages add column if not exists media_name text;
alter table public.support_messages add column if not exists media_mime text;
alter table public.support_messages add column if not exists media_size bigint check (media_size is null or media_size between 1 and 5242880);
alter table public.support_messages drop constraint if exists support_messages_body_or_media_check;
alter table public.support_messages add constraint support_messages_body_or_media_check check (char_length(btrim(body)) >= 1 or media_path is not null);

create table if not exists public.support_conversation_reads (
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_conversation_reads enable row level security;

create or replace function public.is_support_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations conversation
    where conversation.id = p_conversation_id
      and conversation.requester_id = auth.uid()
  )
$$;

revoke all on function public.is_support_conversation_participant(uuid) from public;
grant execute on function public.is_support_conversation_participant(uuid) to authenticated;

drop policy if exists "participants and admins read support conversations" on public.support_conversations;
create policy "participants and admins read support conversations"
on public.support_conversations for select to authenticated
using (requester_id = auth.uid() or public.is_platform_admin());

drop policy if exists "participants and admins read support messages" on public.support_messages;
create policy "participants and admins read support messages"
on public.support_messages for select to authenticated
using (
  public.is_support_conversation_participant(conversation_id)
  or public.is_platform_admin()
);

drop policy if exists "participants and admins read support receipts" on public.support_conversation_reads;
create policy "participants and admins read support receipts"
on public.support_conversation_reads for select to authenticated
using (
  public.is_support_conversation_participant(conversation_id)
  or public.is_platform_admin()
);

grant select on public.support_conversations to authenticated;
grant select on public.support_messages to authenticated;
grant select on public.support_conversation_reads to authenticated;
revoke insert, update, delete on public.support_conversations from authenticated;
revoke insert, update, delete on public.support_messages from authenticated;
revoke insert, update, delete on public.support_conversation_reads from authenticated;

-- Support-chat image attachments. Private bucket, path convention
-- `{user_id}/{uuid}.{ext}`. Ownership-based (not conversation-scoped) RLS —
-- a conversation-scoped check would require the conversation row to already
-- exist before the very first message's image could be uploaded, which
-- breaks "attach a screenshot to your opening message". Platform admins can
-- read any requester's uploads; only the requester may write; only the
-- uploader may delete (admin-side attachment sending is out of scope).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-chat-media', 'support-chat-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "support chat media select" on storage.objects;
create policy "support chat media select"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-chat-media'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_platform_admin())
);

drop policy if exists "support chat media insert" on storage.objects;
create policy "support chat media insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-chat-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "support chat media delete" on storage.objects;
create policy "support chat media delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'support-chat-media'
  and owner_id = auth.uid()::text
);

-- This migration file has been revised in place a few times while this
-- feature was being built out, changing either the OUT columns of a
-- `returns table (...)` function (which `create or replace function` cannot
-- do — Postgres requires an explicit drop first) or the input-parameter
-- arity (which `create or replace` treats as a brand-new overload, leaving
-- the old narrower one behind). These drops make re-running this file safe
-- regardless of which earlier partial version is already applied.
drop function if exists public.get_support_conversation(uuid);
drop function if exists public.list_support_conversations();
drop function if exists public.list_support_conversations_admin(text);
drop function if exists public.start_support_conversation(text, text);
drop function if exists public.send_support_message(uuid, text);

create or replace function public.get_support_conversation(p_conversation_id uuid)
returns table (
  conversation_id uuid,
  requester_id uuid,
  requester_name text,
  requester_avatar_url text,
  status text,
  category text,
  ai_handled boolean,
  needs_human boolean,
  assigned_agent_id uuid,
  assigned_agent_name text,
  created_at timestamptz,
  last_message_at timestamptz,
  requester_last_read_at timestamptz,
  agent_last_read_at timestamptz,
  csat_rating smallint,
  csat_comment text,
  csat_submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    conversation.requester_id,
    requester.display_name,
    requester.avatar_url,
    conversation.status,
    conversation.category,
    conversation.ai_handled,
    conversation.needs_human,
    conversation.assigned_agent_id,
    agent.display_name,
    conversation.created_at,
    conversation.last_message_at,
    (
      select r.last_read_at from public.support_conversation_reads r
      where r.conversation_id = conversation.id and r.user_id = conversation.requester_id
    ),
    (
      select max(r.last_read_at) from public.support_conversation_reads r
      where r.conversation_id = conversation.id and r.user_id <> conversation.requester_id
    ),
    conversation.csat_rating,
    conversation.csat_comment,
    conversation.csat_submitted_at
  from public.support_conversations conversation
  join public.profiles requester on requester.id = conversation.requester_id
  left join public.profiles agent on agent.id = conversation.assigned_agent_id
  where conversation.id = p_conversation_id
    and (conversation.requester_id = auth.uid() or public.is_platform_admin())
$$;

create or replace function public.list_support_conversations()
returns table (
  conversation_id uuid,
  status text,
  category text,
  ai_handled boolean,
  needs_human boolean,
  assigned_agent_id uuid,
  assigned_agent_name text,
  created_at timestamptz,
  last_message_at timestamptz,
  last_body text,
  last_sender_type text,
  unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    conversation.status,
    conversation.category,
    conversation.ai_handled,
    conversation.needs_human,
    conversation.assigned_agent_id,
    agent.display_name,
    conversation.created_at,
    conversation.last_message_at,
    latest.body,
    latest.sender_type,
    count(unread.id) filter (where unread.sender_type <> 'user')
  from public.support_conversations conversation
  left join public.profiles agent on agent.id = conversation.assigned_agent_id
  left join lateral (
    select message.body, message.sender_type
    from public.support_messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  left join public.support_conversation_reads read_state
    on read_state.conversation_id = conversation.id and read_state.user_id = auth.uid()
  left join public.support_messages unread
    on unread.conversation_id = conversation.id
   and unread.created_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
  where conversation.requester_id = auth.uid()
  group by
    conversation.id, conversation.status, conversation.category, conversation.ai_handled,
    conversation.needs_human, conversation.assigned_agent_id, agent.display_name,
    conversation.created_at, conversation.last_message_at, latest.body, latest.sender_type
  order by conversation.last_message_at desc nulls last, conversation.created_at desc
$$;

create or replace function public.list_support_conversations_admin(p_status text default null)
returns table (
  conversation_id uuid,
  requester_id uuid,
  requester_name text,
  requester_avatar_url text,
  status text,
  category text,
  ai_handled boolean,
  assigned_agent_id uuid,
  assigned_agent_name text,
  created_at timestamptz,
  last_message_at timestamptz,
  last_body text,
  last_sender_type text,
  csat_rating smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    conversation.requester_id,
    requester.display_name,
    requester.avatar_url,
    conversation.status,
    conversation.category,
    conversation.ai_handled,
    conversation.assigned_agent_id,
    agent.display_name,
    conversation.created_at,
    conversation.last_message_at,
    latest.body,
    latest.sender_type,
    conversation.csat_rating
  from public.support_conversations conversation
  join public.profiles requester on requester.id = conversation.requester_id
  left join public.profiles agent on agent.id = conversation.assigned_agent_id
  left join lateral (
    select message.body, message.sender_type
    from public.support_messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  where public.is_platform_admin()
    and (p_status is null or conversation.status = p_status)
  order by conversation.last_message_at desc nulls last, conversation.created_at desc
$$;

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
  values (new_conversation.id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

  return query select new_conversation.id, new_message_id;
end;
$$;

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
  values (conversation.id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

  return new_message_id;
end;
$$;

create or replace function public.send_support_agent_message(
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
  conversation public.support_conversations;
  new_message_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 4000 then
    raise exception 'Messages must be between 1 and 4000 characters.';
  end if;

  select item.* into conversation
  from public.support_conversations item
  where item.id = p_conversation_id
  for update;

  if not found then
    raise exception 'This conversation is unavailable.';
  end if;

  insert into public.support_messages(conversation_id, sender_type, sender_id, body)
  values (conversation.id, 'agent', auth.uid(), clean_body)
  returning id into new_message_id;

  update public.support_conversations
  set last_message_at = now(),
      updated_at = now(),
      status = 'assigned',
      ai_handled = false,
      assigned_agent_id = coalesce(assigned_agent_id, auth.uid())
  where id = conversation.id;

  insert into public.support_conversation_reads(conversation_id, user_id, last_read_at)
  values (conversation.id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

  return new_message_id;
end;
$$;

create or replace function public.request_human_support(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_conversations
  set status = case when status in ('closed', 'bot') then 'open' else status end,
      ai_handled = false,
      needs_human = false,
      updated_at = now()
  where id = p_conversation_id
    and requester_id = auth.uid();

  if not found then
    raise exception 'This conversation is unavailable.';
  end if;
end;
$$;

create or replace function public.mark_support_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_support_conversation_participant(p_conversation_id)
    or public.is_platform_admin()
  ) then
    raise exception 'This conversation is unavailable.';
  end if;

  insert into public.support_conversation_reads(conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.close_support_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required.';
  end if;

  update public.support_conversations
  set status = 'closed', updated_at = now()
  where id = p_conversation_id;

  if not found then
    raise exception 'This conversation is unavailable.';
  end if;
end;
$$;

create or replace function public.rate_support_conversation(
  p_conversation_id uuid,
  p_rating int,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating between 1 and 5.';
  end if;
  if clean_comment is not null and char_length(clean_comment) > 500 then
    raise exception 'Comments must be 500 characters or fewer.';
  end if;

  update public.support_conversations
  set csat_rating = p_rating,
      csat_comment = clean_comment,
      csat_submitted_at = now()
  where id = p_conversation_id
    and requester_id = auth.uid()
    and status = 'closed'
    and csat_rating is null;

  if not found then
    raise exception 'This conversation cannot be rated right now.';
  end if;
end;
$$;

revoke all on function public.get_support_conversation(uuid) from public;
revoke all on function public.list_support_conversations() from public;
revoke all on function public.list_support_conversations_admin(text) from public;
revoke all on function public.start_support_conversation(text, text, text, text, text, text, bigint) from public;
revoke all on function public.send_support_message(uuid, text, text, text, text, text, bigint) from public;
revoke all on function public.send_support_agent_message(uuid, text) from public;
revoke all on function public.request_human_support(uuid) from public;
revoke all on function public.mark_support_conversation_read(uuid) from public;
revoke all on function public.close_support_conversation(uuid) from public;
revoke all on function public.rate_support_conversation(uuid, int, text) from public;
grant execute on function public.get_support_conversation(uuid) to authenticated;
grant execute on function public.list_support_conversations() to authenticated;
grant execute on function public.list_support_conversations_admin(text) to authenticated;
grant execute on function public.start_support_conversation(text, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.send_support_message(uuid, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.send_support_agent_message(uuid, text) to authenticated;
grant execute on function public.request_human_support(uuid) to authenticated;
grant execute on function public.mark_support_conversation_read(uuid) to authenticated;
grant execute on function public.close_support_conversation(uuid) to authenticated;
grant execute on function public.rate_support_conversation(uuid, int, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_conversations'
  ) then
    alter publication supabase_realtime add table public.support_conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_conversation_reads'
  ) then
    alter publication supabase_realtime add table public.support_conversation_reads;
  end if;
end $$;
