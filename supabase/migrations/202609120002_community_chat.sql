-- Community chat: a group chat per open-play session or competition
-- (league/ladder/season/tournament) that a player is automatically granted
-- access to the moment they join — no separate "add me" step. The host
-- (open-play organizer/staff or competition organizer/venue manager) can
-- post a message flagged `is_announcement`, which is highlighted for
-- everyone and pushed as a notification; regular members can only chat.
-- Membership is derived live from existing registration tables
-- (open_play_players, competition_entries + team_members), not a separate
-- membership table, so leaving/being removed from the event immediately
-- revokes chat access without any extra bookkeeping.
begin;

create table if not exists public.community_conversations (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null check (event_kind in ('open_play', 'competition')),
  event_id text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (event_kind, event_id)
);

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.community_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  is_announcement boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists community_messages_conversation_idx
on public.community_messages(conversation_id, created_at desc, id desc);

create table if not exists public.community_conversation_reads (
  conversation_id uuid not null references public.community_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.community_conversations enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_conversation_reads enable row level security;

-- Membership/host checks are re-derived from the event's own tables on every
-- call (security definer so RLS on those tables never blocks the check
-- itself) instead of a synced membership table, so a cancellation or
-- withdrawal revokes chat access the instant it happens.
create or replace function public.is_community_event_member(p_event_kind text, p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when p_event_kind = 'open_play' then
      public.owns_open_play(p_event_id)
      or exists (
        select 1 from public.open_play_players player
        where player.session_id = p_event_id
          and player.user_id = auth.uid()
          and player.registration_status in ('approved', 'waitlisted')
          and player.departed_at is null
      )
    when p_event_kind = 'competition' then
      exists (
        select 1 from public.competitions c
        where c.id::text = p_event_id
          and (c.organizer_id = auth.uid() or (c.venue_id is not null and public.can_manage_venue(c.venue_id)))
      )
      or exists (
        select 1 from public.competition_entries entry
        where entry.competition_id::text = p_event_id
          and entry.status <> 'withdrawn'
          and (
            entry.user_id = auth.uid()
            or exists (
              select 1 from public.team_members member
              where member.team_id = entry.team_id and member.user_id = auth.uid()
            )
          )
      )
    else false
  end
$$;

create or replace function public.is_community_event_host(p_event_kind text, p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when p_event_kind = 'open_play' then public.owns_open_play(p_event_id)
    when p_event_kind = 'competition' then exists (
      select 1 from public.competitions c
      where c.id::text = p_event_id
        and (c.organizer_id = auth.uid() or (c.venue_id is not null and public.can_manage_venue(c.venue_id)))
    )
    else false
  end
$$;

create or replace function public.is_community_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_conversations c
    where c.id = p_conversation_id
      and public.is_community_event_member(c.event_kind, c.event_id)
  )
$$;

create or replace function public.is_community_conversation_host(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_conversations c
    where c.id = p_conversation_id
      and public.is_community_event_host(c.event_kind, c.event_id)
  )
$$;

revoke all on function public.is_community_event_member(text, text) from public;
revoke all on function public.is_community_event_host(text, text) from public;
revoke all on function public.is_community_conversation_member(uuid) from public;
revoke all on function public.is_community_conversation_host(uuid) from public;
grant execute on function public.is_community_event_member(text, text) to authenticated;
grant execute on function public.is_community_event_host(text, text) to authenticated;
grant execute on function public.is_community_conversation_member(uuid) to authenticated;
grant execute on function public.is_community_conversation_host(uuid) to authenticated;

-- Bare column names here would collide with the same-named PL/pgSQL output
-- variables of any RETURNS TABLE function that queries these tables (e.g.
-- get_or_create_community_chat's `event_kind`/`event_id` output columns),
-- raising "column reference is ambiguous" the moment RLS folds this USING
-- clause into that function's query. Table-qualifying every reference makes
-- them bind to the column unconditionally.
drop policy if exists "members read their community conversations" on public.community_conversations;
create policy "members read their community conversations"
on public.community_conversations for select to authenticated
using (public.is_community_event_member(community_conversations.event_kind, community_conversations.event_id));

drop policy if exists "members read community messages" on public.community_messages;
create policy "members read community messages"
on public.community_messages for select to authenticated
using (public.is_community_conversation_member(community_messages.conversation_id));

drop policy if exists "members read own community read receipts" on public.community_conversation_reads;
create policy "members read own community read receipts"
on public.community_conversation_reads for select to authenticated
using (community_conversation_reads.user_id = auth.uid() or public.is_community_conversation_host(community_conversation_reads.conversation_id));

grant select on public.community_conversations to authenticated;
grant select on public.community_messages to authenticated;
grant select on public.community_conversation_reads to authenticated;
revoke insert, update, delete on public.community_conversations from authenticated;
revoke insert, update, delete on public.community_messages from authenticated;
revoke insert, update, delete on public.community_conversation_reads from authenticated;

-- `create or replace function` cannot change a `returns table (...)` shape,
-- so drop first in case an earlier partial run of this file left a
-- narrower/wider signature behind.
drop function if exists public.get_or_create_community_chat(text, text);
drop function if exists public.list_my_community_chats();
drop function if exists public.send_community_message(uuid, text, boolean);
drop function if exists public.mark_community_conversation_read(uuid);

create or replace function public.get_or_create_community_chat(p_event_kind text, p_event_id text)
returns table (
  conversation_id uuid,
  event_kind text,
  event_id text,
  title text,
  subtitle text,
  is_host boolean,
  member_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.community_conversations;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open this chat.';
  end if;
  if p_event_kind not in ('open_play', 'competition') then
    raise exception 'This chat type is not supported.';
  end if;
  if not public.is_community_event_member(p_event_kind, p_event_id) then
    raise exception 'Join this event to open its chat.';
  end if;

  select * into result from public.community_conversations c
  where c.event_kind = p_event_kind and c.event_id = p_event_id;

  -- Run as dynamic SQL: this function's `returns table (..., event_kind
  -- text, event_id text, ...)` makes event_kind/event_id local PL/pgSQL
  -- variables for its whole body, and an INSERT's column list / ON
  -- CONFLICT target can't be table-qualified — writing this insert as a
  -- static statement collides with those variables ("column reference
  -- \"event_kind\" is ambiguous"). EXECUTE sends the string to the SQL
  -- engine as-is, skipping PL/pgSQL's variable-vs-column resolution pass.
  if result.id is null then
    execute 'insert into public.community_conversations(event_kind, event_id) values ($1, $2) on conflict (event_kind, event_id) do nothing returning *'
      into result using p_event_kind, p_event_id;
    if result.id is null then
      select * into result from public.community_conversations c
      where c.event_kind = p_event_kind and c.event_id = p_event_id;
    end if;
  end if;

  return query
  select
    result.id,
    p_event_kind,
    p_event_id,
    case when p_event_kind = 'open_play' then (select session.name from public.open_play_sessions session where session.id = p_event_id)
      else (select competition.name from public.competitions competition where competition.id::text = p_event_id) end,
    case when p_event_kind = 'open_play' then (
        select coalesce(venue.name, 'Open play') from public.open_play_sessions session
        left join public.venues venue on venue.id = session.venue_id
        where session.id = p_event_id
      )
      else (select initcap(competition.kind) from public.competitions competition where competition.id::text = p_event_id) end,
    public.is_community_event_host(p_event_kind, p_event_id),
    case when p_event_kind = 'open_play' then (
        select count(*) from public.open_play_players player
        where player.session_id = p_event_id and player.registration_status in ('approved', 'waitlisted') and player.departed_at is null
      )
      else (
        select count(*) from public.competition_entries entry
        where entry.competition_id::text = p_event_id and entry.status <> 'withdrawn'
      ) end;
end;
$$;

create or replace function public.list_my_community_chats()
returns table (
  conversation_id uuid,
  event_kind text,
  event_id text,
  title text,
  subtitle text,
  is_host boolean,
  member_count bigint,
  last_message_at timestamptz,
  last_body text,
  last_is_announcement boolean,
  last_sender_name text,
  unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_events as (
    select
      'open_play'::text as event_kind,
      session.id::text as event_id,
      session.name as title,
      coalesce(venue.name, 'Open play') as subtitle,
      (session.organizer_id = auth.uid()) as is_host,
      (
        select count(*) from public.open_play_players p2
        where p2.session_id = session.id and p2.registration_status in ('approved', 'waitlisted') and p2.departed_at is null
      ) as member_count
    from public.open_play_sessions session
    left join public.venues venue on venue.id = session.venue_id
    where session.organizer_id = auth.uid()
      or exists (
        select 1 from public.open_play_players player
        where player.session_id = session.id and player.user_id = auth.uid()
          and player.registration_status in ('approved', 'waitlisted') and player.departed_at is null
      )
    union all
    select
      'competition'::text,
      competition.id::text,
      competition.name,
      initcap(competition.kind) || coalesce(' · ' || venue.name, ''),
      (competition.organizer_id = auth.uid()) or (competition.venue_id is not null and public.can_manage_venue(competition.venue_id)),
      (
        select count(*) from public.competition_entries e2
        where e2.competition_id = competition.id and e2.status <> 'withdrawn'
      )
    from public.competitions competition
    left join public.venues venue on venue.id = competition.venue_id
    where competition.organizer_id = auth.uid()
      or (competition.venue_id is not null and public.can_manage_venue(competition.venue_id))
      or exists (
        select 1 from public.competition_entries entry
        where entry.competition_id = competition.id and entry.status <> 'withdrawn'
          and (
            entry.user_id = auth.uid()
            or exists (select 1 from public.team_members member where member.team_id = entry.team_id and member.user_id = auth.uid())
          )
      )
  )
  select
    conversation.id,
    my.event_kind,
    my.event_id,
    my.title,
    my.subtitle,
    my.is_host,
    my.member_count,
    conversation.last_message_at,
    latest.body,
    latest.is_announcement,
    coalesce(sender.display_name, 'Member'),
    (
      select count(*) from public.community_messages unread
      where unread.conversation_id = conversation.id
        and unread.sender_id <> auth.uid()
        and unread.created_at > coalesce(
          (select r.last_read_at from public.community_conversation_reads r where r.conversation_id = conversation.id and r.user_id = auth.uid()),
          '-infinity'::timestamptz
        )
    )
  from my_events my
  left join public.community_conversations conversation
    on conversation.event_kind = my.event_kind and conversation.event_id = my.event_id
  left join lateral (
    select m.body, m.is_announcement, m.sender_id
    from public.community_messages m
    where m.conversation_id = conversation.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join public.profiles sender on sender.id = latest.sender_id
  order by conversation.last_message_at desc nulls last, my.title
$$;

create or replace function public.send_community_message(
  p_conversation_id uuid,
  p_body text,
  p_announce boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := btrim(coalesce(p_body, ''));
  conversation public.community_conversations;
  new_message_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to send a message.';
  end if;
  if clean_body = '' then
    raise exception 'Write a message first.';
  end if;
  if char_length(clean_body) > 2000 then
    raise exception 'Messages must be 2000 characters or fewer.';
  end if;

  select * into conversation from public.community_conversations c where c.id = p_conversation_id for update;
  if conversation.id is null or not public.is_community_event_member(conversation.event_kind, conversation.event_id) then
    raise exception 'This chat is unavailable.';
  end if;

  if coalesce(p_announce, false) then
    if not public.is_community_event_host(conversation.event_kind, conversation.event_id) then
      raise exception 'Only the host can post an announcement.';
    end if;
    if char_length(clean_body) > 500 then
      raise exception 'Keep announcements under 500 characters.';
    end if;
  end if;

  if (
    select count(*) from public.community_messages recent
    where recent.sender_id = auth.uid()
      and recent.created_at > now() - interval '10 seconds'
  ) >= 8 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;

  perform public.assert_chat_text_allowed(clean_body);

  insert into public.community_messages(conversation_id, sender_id, body, is_announcement)
  values (p_conversation_id, auth.uid(), clean_body, coalesce(p_announce, false))
  returning id into new_message_id;

  insert into public.community_conversation_reads(conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

  return new_message_id;
end;
$$;

create or replace function public.mark_community_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_community_conversation_member(p_conversation_id) then
    raise exception 'This chat is unavailable.';
  end if;
  insert into public.community_conversation_reads(conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.get_or_create_community_chat(text, text) from public;
revoke all on function public.list_my_community_chats() from public;
revoke all on function public.send_community_message(uuid, text, boolean) from public;
revoke all on function public.mark_community_conversation_read(uuid) from public;
grant execute on function public.get_or_create_community_chat(text, text) to authenticated;
grant execute on function public.list_my_community_chats() to authenticated;
grant execute on function public.send_community_message(uuid, text, boolean) to authenticated;
grant execute on function public.mark_community_conversation_read(uuid) to authenticated;

-- Announcements are pushed to every current member (open-play: approved or
-- waitlisted and not departed; competition: any non-withdrawn entrant, or
-- every member of an entered team) as a `community_announcement`
-- notification, reusing the generic push dispatcher
-- (202608250003_configure_push_dispatch_cron.sql) that already drains
-- `user_notifications` regardless of `kind`.
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'approval', 'waitlist_promotion', 'check_in_reminder', 'court_assignment', 'match_point', 'result',
  'cancellation', 'venue_announcement', 'booking_confirmed', 'booking_reminder', 'court_waitlist',
  'booking_changed', 'match_invite', 'match_invite_response', 'match_found', 'organizer_match',
  'direct_message', 'direct_message_request', 'direct_message_accepted', 'follow_request', 'follow_accepted',
  'community_announcement'
));

create or replace function public.after_community_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.community_conversations;
  event_title text;
  sender_name text;
begin
  update public.community_conversations set last_message_at = new.created_at
  where id = new.conversation_id
  returning * into conversation;

  if not new.is_announcement then
    return new;
  end if;

  select display_name into sender_name from public.profiles where id = new.sender_id;

  if conversation.event_kind = 'open_play' then
    select name into event_title from public.open_play_sessions where id = conversation.event_id;
    insert into public.user_notifications(user_id, session_id, kind, title, body, data)
    select player.user_id, conversation.event_id, 'community_announcement',
      coalesce(event_title, 'Open play') || ' · Announcement',
      new.body,
      jsonb_build_object('conversationId', conversation.id, 'eventKind', conversation.event_kind, 'eventId', conversation.event_id, 'senderName', sender_name)
    from public.open_play_players player
    where player.session_id = conversation.event_id
      and player.user_id is not null
      and player.registration_status in ('approved', 'waitlisted')
      and player.departed_at is null
      and player.user_id <> new.sender_id;
  elsif conversation.event_kind = 'competition' then
    select name into event_title from public.competitions where id::text = conversation.event_id;
    insert into public.user_notifications(user_id, kind, title, body, data)
    select distinct recipients.recipient_id, 'community_announcement',
      coalesce(event_title, 'Tournament') || ' · Announcement',
      new.body,
      jsonb_build_object('conversationId', conversation.id, 'eventKind', conversation.event_kind, 'eventId', conversation.event_id, 'senderName', sender_name)
    from (
      select coalesce(entry.user_id, member.user_id) as recipient_id
      from public.competition_entries entry
      left join public.team_members member on member.team_id = entry.team_id
      where entry.competition_id::text = conversation.event_id and entry.status <> 'withdrawn'
    ) recipients
    where recipients.recipient_id is not null and recipients.recipient_id <> new.sender_id;
  end if;

  return new;
end;
$$;

revoke all on function public.after_community_message_insert() from public;

drop trigger if exists after_community_message_insert on public.community_messages;
create trigger after_community_message_insert after insert on public.community_messages
for each row execute function public.after_community_message_insert();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_conversations'
  ) then
    alter publication supabase_realtime add table public.community_conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_messages'
  ) then
    alter publication supabase_realtime add table public.community_messages;
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
