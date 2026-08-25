-- Migration version normalized to preserve the original execution order.
-- Safety baseline for Peakle team chat.
--
-- Chat is intentionally limited to adults until Peakle has a reviewed
-- guardian-consent and minor-safety program. Enforcement lives in Postgres so
-- a modified client cannot bypass age acknowledgement, blocks, suspensions,
-- rate limits, reporting, or moderator removals.

create table if not exists public.chat_safety_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_adult boolean not null,
  rules_acknowledged_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_suspensions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  suspended_until timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists chat_user_blocks_blocked_idx
on public.chat_user_blocks(blocked_id, blocker_id);

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  message_id uuid references public.team_messages(id) on delete set null,
  reason text not null check (reason in (
    'harassment', 'hate', 'sexual_content', 'violence', 'spam',
    'privacy', 'child_safety', 'other'
  )),
  details text check (details is null or char_length(details) <= 1000),
  priority text not null default 'standard'
    check (priority in ('standard', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  content_snapshot text check (content_snapshot is null or char_length(content_snapshot) <= 1000),
  attachment_type_snapshot text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);

create index if not exists chat_reports_review_queue_idx
on public.chat_reports(status, priority, created_at);
create index if not exists chat_reports_reporter_idx
on public.chat_reports(reporter_id, created_at desc);
create unique index if not exists chat_reports_one_open_message_report_idx
on public.chat_reports(reporter_id, message_id)
where message_id is not null and status in ('open', 'reviewing');

create table if not exists public.chat_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  message_id uuid references public.team_messages(id) on delete set null,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  moderator_id uuid not null references public.profiles(id),
  action text not null check (action in ('remove_message', 'warn', 'suspend')),
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_moderation_actions_team_idx
on public.chat_moderation_actions(team_id, created_at desc);

create table if not exists public.chat_removed_media_paths (
  path text primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  message_id uuid references public.team_messages(id) on delete set null,
  removed_by uuid not null references public.profiles(id),
  removed_at timestamptz not null default now()
);

create table if not exists public.chat_moderation_terms (
  term text primary key check (char_length(term) between 2 and 80),
  category text not null check (category in ('profanity', 'harassment', 'sexual_safety', 'child_safety')),
  action text not null default 'block' check (action in ('block', 'flag')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.chat_moderation_terms(term, category, action)
values
  ('fuck', 'profanity', 'block'),
  ('shit', 'profanity', 'block'),
  ('bitch', 'harassment', 'block'),
  ('putang ina', 'profanity', 'block'),
  ('tangina', 'profanity', 'block'),
  ('gago', 'harassment', 'block'),
  ('kill yourself', 'harassment', 'block'),
  ('send nudes', 'sexual_safety', 'block'),
  ('nude photo', 'sexual_safety', 'block'),
  ('do not tell your parents', 'child_safety', 'flag'),
  ('dont tell your parents', 'child_safety', 'flag'),
  ('meet me alone', 'child_safety', 'flag')
on conflict (term) do nothing;

create table if not exists public.chat_automated_flags (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.team_messages(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('personal_info', 'profanity', 'harassment', 'sexual_safety', 'child_safety')),
  matched_rule text not null,
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (message_id, category, matched_rule)
);

create index if not exists chat_automated_flags_queue_idx
on public.chat_automated_flags(status, created_at);

alter table public.team_messages
  add column if not exists moderated_at timestamptz,
  add column if not exists moderation_reason text;

alter table public.chat_safety_profiles enable row level security;
alter table public.chat_suspensions enable row level security;
alter table public.chat_user_blocks enable row level security;
alter table public.chat_reports enable row level security;
alter table public.chat_moderation_actions enable row level security;
alter table public.chat_removed_media_paths enable row level security;
alter table public.chat_moderation_terms enable row level security;
alter table public.chat_automated_flags enable row level security;

grant select, update on public.chat_reports to authenticated;
grant select on public.chat_moderation_actions to authenticated;
grant select, insert, update, delete on public.chat_suspensions to authenticated;
grant select, insert, update, delete on public.chat_moderation_terms to authenticated;
grant select, update on public.chat_automated_flags to authenticated;
revoke all on public.chat_safety_profiles from authenticated;
revoke all on public.chat_suspensions from authenticated;
revoke all on public.chat_user_blocks from authenticated;
revoke insert, delete on public.chat_reports from authenticated;
revoke insert, update, delete on public.chat_moderation_actions from authenticated;
revoke all on public.chat_removed_media_paths from authenticated;

drop policy if exists "users read own chat reports" on public.chat_reports;
create policy "users read own chat reports"
on public.chat_reports for select to authenticated
using (reporter_id = auth.uid() or public.is_platform_admin());

drop policy if exists "platform admins review chat reports" on public.chat_reports;
create policy "platform admins review chat reports"
on public.chat_reports for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "team managers read moderation actions" on public.chat_moderation_actions;
create policy "team managers read moderation actions"
on public.chat_moderation_actions for select to authenticated
using (public.can_manage_team(team_id) or public.is_platform_admin());

drop policy if exists "platform admins manage chat suspensions" on public.chat_suspensions;
create policy "platform admins manage chat suspensions"
on public.chat_suspensions for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins manage moderation terms" on public.chat_moderation_terms;
create policy "platform admins manage moderation terms"
on public.chat_moderation_terms for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins read automated flags" on public.chat_automated_flags;
create policy "platform admins read automated flags"
on public.chat_automated_flags for select to authenticated
using (public.is_platform_admin());

drop policy if exists "platform admins review automated flags" on public.chat_automated_flags;
create policy "platform admins review automated flags"
on public.chat_automated_flags for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create or replace function public.can_use_team_chat()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.chat_safety_profiles safety
      where safety.user_id = auth.uid()
        and safety.is_adult
        and safety.rules_acknowledged_at is not null
    )
    and not exists (
      select 1
      from public.chat_suspensions suspension
      where suspension.user_id = auth.uid()
        and (suspension.suspended_until is null or suspension.suspended_until > now())
    )
$$;

create or replace function public.is_chat_sender_blocked(p_sender_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_user_blocks block
    where block.blocker_id = auth.uid()
      and block.blocked_id = p_sender_id
  )
$$;

create or replace function public.is_removed_chat_media(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_removed_media_paths removed
    where removed.path = p_path
  )
$$;

revoke all on function public.can_use_team_chat() from public;
grant execute on function public.can_use_team_chat() to authenticated;
revoke all on function public.is_chat_sender_blocked(uuid) from public;
grant execute on function public.is_chat_sender_blocked(uuid) to authenticated;
revoke all on function public.is_removed_chat_media(text) from public;
grant execute on function public.is_removed_chat_media(text) to authenticated;

create or replace function public.get_chat_safety_status()
returns table (
  acknowledged boolean,
  is_adult boolean,
  eligible boolean,
  suspended boolean,
  suspended_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    safety.rules_acknowledged_at is not null,
    coalesce(safety.is_adult, false),
    public.can_use_team_chat(),
    suspension.user_id is not null,
    suspension.suspended_until
  from (select auth.uid() as user_id) current_user_row
  left join public.chat_safety_profiles safety
    on safety.user_id = current_user_row.user_id
  left join public.chat_suspensions suspension
    on suspension.user_id = current_user_row.user_id
   and (suspension.suspended_until is null or suspension.suspended_until > now())
$$;

create or replace function public.acknowledge_chat_safety(p_is_adult boolean)
returns table (
  acknowledged boolean,
  is_adult boolean,
  eligible boolean,
  suspended boolean,
  suspended_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before setting chat safety preferences.';
  end if;

  insert into public.chat_safety_profiles(user_id, is_adult, rules_acknowledged_at, updated_at)
  values (auth.uid(), p_is_adult, now(), now())
  on conflict (user_id) do update
    set is_adult = excluded.is_adult,
        rules_acknowledged_at = excluded.rules_acknowledged_at,
        updated_at = excluded.updated_at;

  return query select * from public.get_chat_safety_status();
end;
$$;

create or replace function public.list_blocked_chat_users()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.display_name, profile.avatar_url, block.created_at
  from public.chat_user_blocks block
  join public.profiles profile on profile.id = block.blocked_id
  where block.blocker_id = auth.uid()
  order by block.created_at desc
$$;

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
  ) then
    raise exception 'You can only block a player who shares a team with you.';
  end if;

  insert into public.chat_user_blocks(blocker_id, blocked_id)
  values (auth.uid(), p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

create or replace function public.unblock_chat_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.chat_user_blocks
  where blocker_id = auth.uid() and blocked_id = p_user_id
$$;

create or replace function public.report_team_message(
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
  source_message public.team_messages;
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
  from public.team_messages message
  where message.id = p_message_id;

  if not found
    or source_message.sender_id = auth.uid()
    or not public.is_team_member(source_message.team_id) then
    raise exception 'This message cannot be reported.';
  end if;

  insert into public.chat_reports(
    reporter_id, reported_user_id, team_id, message_id, reason, details, priority,
    content_snapshot, attachment_type_snapshot
  )
  values (
    auth.uid(),
    source_message.sender_id,
    source_message.team_id,
    source_message.id,
    p_reason,
    clean_details,
    case
      when p_reason = 'child_safety' then 'critical'
      when p_reason in ('sexual_content', 'violence', 'privacy') then 'high'
      else 'standard'
    end,
    left(source_message.body, 1000),
    source_message.media_type
  )
  returning id into report_id;

  insert into public.team_message_hides(message_id, user_id)
  values (source_message.id, auth.uid())
  on conflict (message_id, user_id) do nothing;

  return report_id;
exception
  when unique_violation then
    raise exception 'You already reported this message and it is awaiting review.';
end;
$$;

create or replace function public.moderate_team_message(
  p_message_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_message public.team_messages;
  clean_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(clean_reason) < 3 or char_length(clean_reason) > 500 then
    raise exception 'Add a moderation reason between 3 and 500 characters.';
  end if;

  select message.* into source_message
  from public.team_messages message
  where message.id = p_message_id and message.deleted_at is null;

  if not found or (
    not public.can_manage_team(source_message.team_id)
    and not public.is_platform_admin()
  ) then
    raise exception 'Team manager permission is required.';
  end if;

  if source_message.media_path is not null then
    insert into public.chat_removed_media_paths(
      path, team_id, message_id, removed_by
    )
    values (
      source_message.media_path, source_message.team_id, source_message.id, auth.uid()
    )
    on conflict (path) do nothing;
  end if;

  update public.team_messages message
  set body = null,
      image_url = null,
      media_path = null,
      media_type = null,
      media_name = null,
      media_mime = null,
      media_size = null,
      deleted_at = now(),
      deleted_by = auth.uid(),
      moderated_at = now(),
      moderation_reason = clean_reason
  where message.id = p_message_id;

  delete from public.team_message_reactions reaction
  where reaction.message_id = p_message_id;

  insert into public.chat_moderation_actions(
    team_id, message_id, target_user_id, moderator_id, action, reason
  )
  values (
    source_message.team_id, source_message.id, source_message.sender_id,
    auth.uid(), 'remove_message', clean_reason
  );
end;
$$;

revoke all on function public.get_chat_safety_status() from public;
grant execute on function public.get_chat_safety_status() to authenticated;
revoke all on function public.acknowledge_chat_safety(boolean) from public;
grant execute on function public.acknowledge_chat_safety(boolean) to authenticated;
revoke all on function public.list_blocked_chat_users() from public;
grant execute on function public.list_blocked_chat_users() to authenticated;
revoke all on function public.block_chat_user(uuid) from public;
grant execute on function public.block_chat_user(uuid) to authenticated;
revoke all on function public.unblock_chat_user(uuid) from public;
grant execute on function public.unblock_chat_user(uuid) to authenticated;
revoke all on function public.report_team_message(uuid, text, text) from public;
grant execute on function public.report_team_message(uuid, text, text) to authenticated;
revoke all on function public.moderate_team_message(uuid, text) from public;
grant execute on function public.moderate_team_message(uuid, text) to authenticated;

create or replace function public.normalized_chat_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select ' ' || btrim(regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:]]+', ' ', 'g')) || ' '
$$;

create or replace function public.assert_chat_text_allowed(p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_category text;
begin
  select term.category into matched_category
  from public.chat_moderation_terms term
  where term.active
    and term.action = 'block'
    and public.normalized_chat_text(p_value)
      like '% ' || btrim(public.normalized_chat_text(term.term)) || ' %'
  limit 1;

  if matched_category is not null then
    raise exception 'This message contains language that is not allowed in Peakle chat.';
  end if;
end;
$$;

revoke all on function public.normalized_chat_text(text) from public;
revoke all on function public.assert_chat_text_allowed(text) from public;

create or replace function public.enforce_team_message_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sender_id <> auth.uid()
    or not public.is_team_member(new.team_id)
    or not public.can_use_team_chat() then
    raise exception 'Adult chat access and active team membership are required.';
  end if;

  if new.body is not null then
    new.body := btrim(new.body);
    if new.body = '' then new.body := null; end if;
  end if;

  if new.body is null and new.image_url is null and new.media_path is null then
    raise exception 'A message needs text or an attachment.';
  end if;

  if (
    select count(*)
    from public.team_messages recent
    where recent.sender_id = auth.uid()
      and recent.created_at > now() - interval '10 seconds'
  ) >= 6 or (
    select count(*)
    from public.team_messages recent
    where recent.sender_id = auth.uid()
      and recent.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;

  if new.body is not null and (
    select count(*)
    from public.team_messages recent
    where recent.sender_id = auth.uid()
      and recent.created_at > now() - interval '2 minutes'
      and recent.deleted_at is null
      and lower(recent.body) = lower(new.body)
  ) >= 2 then
    raise exception 'Please do not send the same message repeatedly.';
  end if;

  perform public.assert_chat_text_allowed(new.body);
  return new;
end;
$$;

create or replace function public.flag_team_message_risks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_term record;
begin
  if new.body is null then return new; end if;

  for matched_term in
    select term.term, term.category
    from public.chat_moderation_terms term
    where term.active
      and term.action = 'flag'
      and public.normalized_chat_text(new.body)
        like '% ' || btrim(public.normalized_chat_text(term.term)) || ' %'
  loop
    insert into public.chat_automated_flags(
      message_id, team_id, sender_id, category, matched_rule
    )
    values (
      new.id, new.team_id, new.sender_id, matched_term.category, matched_term.term
    )
    on conflict do nothing;
  end loop;

  if new.body ~* '(^|[^[:alnum:]])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}([^[:alnum:]]|$)'
    or regexp_replace(new.body, '[^0-9+]', '', 'g') ~ E'^(\\+?63|0)[0-9]{9,10}$' then
    insert into public.chat_automated_flags(
      message_id, team_id, sender_id, category, matched_rule
    )
    values (new.id, new.team_id, new.sender_id, 'personal_info', 'contact_information')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists flag_team_message_risks on public.team_messages;
create trigger flag_team_message_risks
after insert or update of body on public.team_messages
for each row execute function public.flag_team_message_risks();

create or replace function public.edit_team_message(p_message_id uuid, p_body text)
returns setof public.team_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := btrim(coalesce(p_body, ''));
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 4000 then
    raise exception 'Messages must contain between 1 and 4000 characters.';
  end if;
  perform public.assert_chat_text_allowed(clean_body);

  return query
  update public.team_messages message
  set body = clean_body, edited_at = now()
  where message.id = p_message_id
    and message.sender_id = auth.uid()
    and message.deleted_at is null
    and public.is_team_member(message.team_id)
  returning message.*;

  if not found then
    raise exception 'Only the sender can edit an active message.';
  end if;
end;
$$;

drop policy if exists "members read messages" on public.team_messages;
create policy "members read messages"
on public.team_messages for select to authenticated
using (
  public.can_use_team_chat()
  and public.is_team_member(team_id)
  and not public.is_chat_sender_blocked(sender_id)
);

drop policy if exists "members send messages" on public.team_messages;
create policy "members send messages"
on public.team_messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.can_use_team_chat()
  and public.is_team_member(team_id)
);

drop policy if exists "team members read team message state" on public.team_message_reads;
create policy "team members read team message state"
on public.team_message_reads for select to authenticated
using (public.can_use_team_chat() and public.is_team_member(team_id));

drop policy if exists "members create own team message state" on public.team_message_reads;
create policy "members create own team message state"
on public.team_message_reads for insert to authenticated
with check (
  public.can_use_team_chat()
  and user_id = auth.uid()
  and public.is_team_member(team_id)
);

drop policy if exists "members update own team message state" on public.team_message_reads;
create policy "members update own team message state"
on public.team_message_reads for update to authenticated
using (
  public.can_use_team_chat()
  and user_id = auth.uid()
  and public.is_team_member(team_id)
)
with check (
  public.can_use_team_chat()
  and user_id = auth.uid()
  and public.is_team_member(team_id)
);

drop policy if exists "team members read message reactions" on public.team_message_reactions;
create policy "team members read message reactions"
on public.team_message_reactions for select to authenticated
using (
  public.can_use_team_chat()
  and exists (
    select 1 from public.team_messages message
    where message.id = message_id and public.is_team_member(message.team_id)
  )
);

drop policy if exists "team members read message pins" on public.team_message_pins;
create policy "team members read message pins"
on public.team_message_pins for select to authenticated
using (public.can_use_team_chat() and public.is_team_member(team_id));

create or replace function public.toggle_team_message_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_team_id uuid;
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;
  if p_emoji not in ('👍', '❤️', '😂', '🔥', '👏', '🎉') then
    raise exception 'Unsupported reaction.';
  end if;

  select message.team_id into message_team_id
  from public.team_messages message
  where message.id = p_message_id and message.deleted_at is null;

  if message_team_id is null or not public.is_team_member(message_team_id) then
    raise exception 'Only team members can react to active messages.';
  end if;

  delete from public.team_message_reactions reaction
  where reaction.message_id = p_message_id
    and reaction.user_id = auth.uid()
    and reaction.emoji = p_emoji;

  if found then return false; end if;

  insert into public.team_message_reactions(message_id, user_id, emoji)
  values (p_message_id, auth.uid(), p_emoji);
  return true;
end;
$$;

create or replace function public.toggle_team_message_pin(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_team_id uuid;
begin
  if not public.can_use_team_chat() then
    raise exception 'Adult chat access is required.';
  end if;

  select message.team_id into message_team_id
  from public.team_messages message
  where message.id = p_message_id
    and message.deleted_at is null;

  if message_team_id is null or not public.is_team_member(message_team_id) then
    raise exception 'Only team members can pin active messages.';
  end if;

  if exists (
    select 1 from public.team_message_pins pin
    where pin.message_id = p_message_id
  ) then
    delete from public.team_message_pins pin
    where pin.message_id = p_message_id;
  else
    insert into public.team_message_pins(message_id, team_id, pinned_by)
    values (p_message_id, message_team_id, auth.uid());
  end if;
end;
$$;

create or replace function public.mark_team_conversation_read(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_use_team_chat() or not public.is_team_member(p_team_id) then
    raise exception 'Adult chat access and team membership are required.';
  end if;

  insert into public.team_message_reads(team_id, user_id, last_read_at)
  values (p_team_id, auth.uid(), now())
  on conflict (team_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.list_team_conversations(p_team_ids uuid[])
returns table (
  team_id uuid,
  last_body text,
  last_has_image boolean,
  last_created_at timestamptz,
  last_sender_name text,
  unread_count bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    team.id,
    case
      when latest.deleted_at is not null then 'Message removed'
      when latest.body is not null then latest.body
      when latest.media_type = 'video' then 'Shared a video'
      when latest.media_type = 'gif' then 'Shared a GIF'
      else latest.body
    end,
    latest.image_url is not null or latest.media_path is not null,
    latest.created_at,
    sender.display_name,
    count(unread.id) filter (
      where unread.sender_id <> auth.uid()
        and unread.deleted_at is null
        and not public.is_chat_sender_blocked(unread.sender_id)
    )
  from unnest(p_team_ids) as team(id)
  left join lateral (
    select message.body, message.image_url, message.media_path, message.media_type,
      message.deleted_at, message.created_at, message.sender_id
    from public.team_messages message
    where message.team_id = team.id
      and not public.is_chat_sender_blocked(message.sender_id)
      and not exists (
        select 1 from public.team_message_hides hidden
        where hidden.message_id = message.id and hidden.user_id = auth.uid()
      )
    order by message.created_at desc
    limit 1
  ) latest on true
  left join public.profiles sender on sender.id = latest.sender_id
  left join public.team_message_reads read_state
    on read_state.team_id = team.id and read_state.user_id = auth.uid()
  left join public.team_messages unread
    on unread.team_id = team.id
   and unread.created_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
   and not exists (
     select 1 from public.team_message_hides hidden
     where hidden.message_id = unread.id and hidden.user_id = auth.uid()
   )
  where public.can_use_team_chat() and public.is_team_member(team.id)
  group by team.id, latest.body, latest.image_url, latest.media_path, latest.media_type,
    latest.deleted_at, latest.created_at, sender.display_name
  order by latest.created_at desc nulls last;
$$;

drop policy if exists "team members read chat media" on storage.objects;
create policy "team members read chat media"
on storage.objects for select to authenticated
using (
  bucket_id = 'team-chat-media'
  and public.can_use_team_chat()
  and not public.is_removed_chat_media(name)
  and exists (
    select 1 from public.team_members member
    where member.team_id::text = (storage.foldername(name))[1]
      and member.user_id = auth.uid()
  )
);

drop policy if exists "team members upload chat media" on storage.objects;
create policy "team members upload chat media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-chat-media'
  and public.can_use_team_chat()
  and exists (
    select 1 from public.team_members member
    where member.team_id::text = (storage.foldername(name))[1]
      and member.user_id = auth.uid()
  )
);

drop policy if exists "senders delete own chat media" on storage.objects;
create policy "senders delete own chat media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'team-chat-media'
  and owner_id = auth.uid()::text
  and exists (
    select 1 from public.team_members member
    where member.team_id::text = (storage.foldername(name))[1]
      and member.user_id = auth.uid()
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_user_blocks'
  ) then
    alter publication supabase_realtime add table public.chat_user_blocks;
  end if;
end
$$;
