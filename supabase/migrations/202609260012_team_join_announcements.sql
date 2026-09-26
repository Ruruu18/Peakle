-- Team chat announces new members ("Kelvin joined the club"), and the Teams
-- screen can react live to memberships and invitations instead of waiting for
-- a manual refresh.

alter table public.team_messages
  add column if not exists kind text not null default 'message';

alter table public.team_messages drop constraint if exists team_messages_kind_check;
alter table public.team_messages add constraint team_messages_kind_check
  check (kind in ('message', 'member_joined'));

-- Announcements are written by the membership trigger below, often while a
-- captain (not the new member) is signed in. Only that trigger may create
-- them: pg_trigger_depth() is 1 for a direct insert and greater inside it.
create or replace function public.enforce_team_message_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'message' then
    if pg_trigger_depth() > 1 then return new; end if;
    raise exception 'Only Peakle can post team announcements.';
  end if;

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

-- Announcements cannot be rewritten through the edit RPC or a direct update.
create or replace function public.protect_team_announcements()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Clearing the body (unsend or moderation) is still allowed.
  if old.kind <> 'message' and ((new.body is distinct from old.body and new.body is not null) or new.kind is distinct from old.kind) then
    raise exception 'Team announcements cannot be edited.';
  end if;
  if old.kind = 'message' and new.kind <> 'message' then
    raise exception 'Messages cannot be turned into announcements.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_team_announcements on public.team_messages;
create trigger protect_team_announcements
before update on public.team_messages
for each row execute function public.protect_team_announcements();

create or replace function public.announce_team_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_name text;
begin
  -- The creator starts the team; everyone after them "joins the club".
  if new.role = 'creator' then return new; end if;
  select nullif(btrim(display_name), '') into member_name from public.profiles where id = new.user_id;
  insert into public.team_messages (team_id, sender_id, body, kind)
  values (new.team_id, new.user_id, left(coalesce(member_name, 'A new player'), 80) || ' joined the club', 'member_joined');
  return new;
end;
$$;

drop trigger if exists announce_team_member_joined on public.team_members;
create trigger announce_team_member_joined
after insert on public.team_members
for each row execute function public.announce_team_member_joined();

-- Live updates for the Teams screen. team_members is already published by
-- 202607260007; add it again defensively for databases that skipped it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_invitations'
  ) then
    alter publication supabase_realtime add table public.team_invitations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end;
$$;

notify pgrst, 'reload schema';
