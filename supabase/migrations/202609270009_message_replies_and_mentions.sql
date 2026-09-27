begin;

-- Swipe to reply in team and private chats, and @mentions in team chats.
--
-- reply_to_id        The message being replied to, always in the same chat.
--                    If it is later deleted the reply keeps its text and the
--                    quote shows as unavailable.
-- mentions           Team members tagged with @Name. Only current members of
--                    the team (other than the sender) are kept.
-- mentions_everyone  @everyone: notifies the whole team.
--
-- Mentioned players get a 'team_mention' notification (and push) even if they
-- muted the team chat; @everyone respects the mute.

alter table public.team_messages
  add column if not exists reply_to_id uuid references public.team_messages(id) on delete set null,
  add column if not exists mentions uuid[] not null default '{}',
  add column if not exists mentions_everyone boolean not null default false;

alter table public.direct_messages
  add column if not exists reply_to_id uuid references public.direct_messages(id) on delete set null;

create index if not exists team_messages_reply_to_idx on public.team_messages(reply_to_id) where reply_to_id is not null;
create index if not exists direct_messages_reply_to_idx on public.direct_messages(reply_to_id) where reply_to_id is not null;

-- Team messages are inserted by the app directly, so replies and mentions are
-- checked here rather than trusted.
create or replace function public.prepare_team_message_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- A sent message keeps what it replied to and who it tagged. Clearing the
    -- reply is allowed: on delete set null does that when the original goes.
    if new.reply_to_id is not null then new.reply_to_id := old.reply_to_id; end if;
    new.mentions := old.mentions;
    new.mentions_everyone := old.mentions_everyone;
    return new;
  end if;

  if new.reply_to_id is not null and not exists (
    select 1 from public.team_messages original
    where original.id = new.reply_to_id and original.team_id = new.team_id
  ) then
    new.reply_to_id := null;
  end if;

  new.mentions := coalesce((
    select array_agg(distinct member.user_id)
    from public.team_members member
    where member.team_id = new.team_id
      and member.user_id = any(coalesce(new.mentions, '{}'::uuid[]))
      and member.user_id is distinct from new.sender_id
  ), '{}'::uuid[]);
  new.mentions_everyone := coalesce(new.mentions_everyone, false);
  return new;
end;
$$;

drop trigger if exists prepare_team_message_links on public.team_messages;
create trigger prepare_team_message_links
  before insert or update on public.team_messages
  for each row execute function public.prepare_team_message_links();

alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'approval', 'waitlist_promotion', 'check_in_reminder', 'court_assignment', 'match_point', 'result',
  'cancellation', 'venue_announcement', 'booking_confirmed', 'booking_reminder', 'court_waitlist',
  'booking_changed', 'match_invite', 'match_invite_response', 'match_found', 'organizer_match',
  'direct_message', 'direct_message_request', 'direct_message_accepted', 'follow_request', 'follow_accepted',
  'community_announcement', 'game_invite', 'game_response', 'game_update',
  'team_invite', 'team_invite_response', 'team_mention'
));

create or replace function public.notify_team_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_name text;
  team_name text;
  preview text;
begin
  if new.sender_id is null or (cardinality(new.mentions) = 0 and not new.mentions_everyone) then
    return new;
  end if;

  select nullif(btrim(display_name), '') into sender_name from public.profiles where id = new.sender_id;
  select nullif(btrim(name), '') into team_name from public.teams where id = new.team_id;
  preview := coalesce(
    left(new.body, 180),
    case new.media_type when 'video' then 'Sent a video' when 'audio' then 'Sent a voice message' else 'Sent a photo' end
  );

  insert into public.user_notifications(user_id, kind, title, body, data)
  select recipient.user_id,
    'team_mention',
    case when recipient.direct
      then format('%s mentioned you in %s', coalesce(sender_name, 'A teammate'), coalesce(team_name, 'your team'))
      else format('%s @everyone in %s', coalesce(sender_name, 'A teammate'), coalesce(team_name, 'your team'))
    end,
    preview,
    jsonb_build_object(
      'teamId', new.team_id,
      'messageId', new.id,
      'playerId', new.sender_id,
      'dedupeKey', 'team-mention:' || new.id::text
    )
  from (
    select member.user_id, bool_or(member.user_id = any(new.mentions)) as direct
    from public.team_members member
    where member.team_id = new.team_id
      and member.user_id <> new.sender_id
      and (member.user_id = any(new.mentions) or new.mentions_everyone)
    group by member.user_id
  ) recipient
  where (
      recipient.direct
      or not exists (
        select 1 from public.team_chat_settings setting
        where setting.team_id = new.team_id
          and setting.user_id = recipient.user_id
          and setting.muted_until > now()
      )
    )
    and not exists (
      select 1 from public.chat_user_blocks block
      where block.blocker_id = recipient.user_id and block.blocked_id = new.sender_id
    )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_team_mentions on public.team_messages;
create trigger notify_team_mentions
  after insert on public.team_messages
  for each row execute function public.notify_team_mentions();

-- Private messages go through send_direct_message / send_direct_media_message.
-- These wrappers mark the reply for the insert they make; the trigger below
-- attaches it only when the original is in the same conversation.
create or replace function public.attach_direct_message_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested uuid := nullif(current_setting('peakle.reply_to_id', true), '')::uuid;
begin
  if tg_op = 'UPDATE' then
    -- Only on delete set null may change it, when the original is deleted.
    if new.reply_to_id is not null then new.reply_to_id := old.reply_to_id; end if;
    return new;
  end if;
  new.reply_to_id := null;
  if requested is not null and exists (
    select 1 from public.direct_messages original
    where original.id = requested and original.conversation_id = new.conversation_id
  ) then
    new.reply_to_id := requested;
  end if;
  return new;
end;
$$;

drop trigger if exists attach_direct_message_reply on public.direct_messages;
create trigger attach_direct_message_reply
  before insert or update on public.direct_messages
  for each row execute function public.attach_direct_message_reply();

create or replace function public.send_direct_reply(
  p_conversation_id uuid,
  p_body text,
  p_reply_to_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('peakle.reply_to_id', coalesce(p_reply_to_id::text, ''), true);
  return public.send_direct_message(p_conversation_id, p_body);
end;
$$;

create or replace function public.send_direct_media_reply(
  p_conversation_id uuid,
  p_media_path text,
  p_media_type text,
  p_media_mime text,
  p_media_size bigint,
  p_reply_to_id uuid,
  p_media_name text default null,
  p_media_duration_ms integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('peakle.reply_to_id', coalesce(p_reply_to_id::text, ''), true);
  return public.send_direct_media_message(p_conversation_id, p_media_path, p_media_type, p_media_mime, p_media_size, p_media_name, p_media_duration_ms);
end;
$$;

revoke all on function public.send_direct_reply(uuid, text, uuid) from public;
grant execute on function public.send_direct_reply(uuid, text, uuid) to authenticated;
revoke all on function public.send_direct_media_reply(uuid, text, text, text, bigint, uuid, text, integer) from public;
grant execute on function public.send_direct_media_reply(uuid, text, text, text, bigint, uuid, text, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
