alter table public.team_messages
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists media_name text,
  add column if not exists media_mime text,
  add column if not exists media_size bigint,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

alter table public.t

eam_messages
  drop constraint if exists team_messages_media_type_check;
alter table public.team_mess
ages
  add constraint team_messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'gif'));

alter table public.team_messages
  drop constraint if exists team_messages_body_length_check;
alter table public.team_messages
  add constraint team_messages_body_length_check
  check (body is null or char_length(body) between 1 and 4000);

alter table public.team_messages
  drop constraint if exists team_messages_media_size_check;
alter table public.team_messages
  add constraint team_messages_media_size_check
  check (media_size is null or media_size between 1 and 15728640);

alter table public.team_messages
  drop constraint if exists team_messages_check;
alter table public.team_messages
  drop constraint if exists team_messages_body_or_media_check;
alter table public.team_messages
  add constraint team_messages_body_or_media_check
  check (deleted_at is not null or body is not null or image_url is not null or media_path is not null);

create index if not exists team_messages_sender_created_idx
on public.team_messages(sender_id, created_at desc);

create table if not exists public.team_message_reactions (
  message_id uuid not null references public.team_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🔥', '👏', '🎉')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists team_message_reactions_message_idx
on public.team_message_reactions(message_id, created_at);

create table if not exists public.team_message_hides (
  message_id uuid not null references public.team_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.team_message_reactions enable row level security;
alter table public.team_message_hides enable row level security;

grant select on public.team_message_reactions to authenticated;
grant select on public.team_message_hides to authenticated;
revoke insert, update, delete on public.team_message_reactions from authenticated;
revoke insert, update, delete on public.team_message_hides from authenticated;

create policy "team members read message reactions"
on public.team_message_reactions for select to authenticated
using (
  exists (
    select 1 from public.team_messages message
    where message.id = message_id and public.is_team_member(message.team_id)
  )
);

create policy "members add own message reactions"
on public.team_message_reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.team_messages message
    where message.id = message_id
      and message.deleted_at is null
      and public.is_team_member(message.team_id)
  )
);

create policy "members remove own message reactions"
on public.team_message_reactions for delete to authenticated
using (user_id = auth.uid());

create policy "members read own hidden messages"
on public.team_message_hides for select to authenticated
using (user_id = auth.uid());

create policy "members hide messages for themselves"
on public.team_message_hides for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.team_messages message
    where message.id = message_id and public.is_team_member(message.team_id)
  )
);

create policy "members restore own hidden messages"
on public.team_message_hides for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "members read own team message state" on public.team_message_reads;
drop policy if exists "team members read team message state" on public.team_message_reads;
create policy "team members read team message state"
on public.team_message_reads for select to authenticated
using (public.is_team_member(team_id));

create or replace function public.enforce_team_message_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.sender_id <> auth.uid() or not public.is_team_member(new.team_id) then
    raise exception 'Only team members can send messages as themselves.';
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
  ) >= 10 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_team_message_limits on public.team_messages;
create trigger enforce_team_message_limits
before insert on public.team_messages
for each row execute function public.enforce_team_message_limits();

create or replace function public.edit_team_message(p_message_id uuid, p_body text)
returns setof public.team_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(clean_body) < 1 or char_length(clean_body) > 4000 then
    raise exception 'Messages must contain between 1 and 4000 characters.';
  end if;

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

create or replace function public.unsend_team_message(p_message_id uuid)
returns table (media_path text, media_type text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_media_path text;
  old_media_type text;
begin
  select message.media_path, message.media_type
  into old_media_path, old_media_type
  from public.team_messages message
  where message.id = p_message_id
    and message.sender_id = auth.uid()
    and message.deleted_at is null
    and public.is_team_member(message.team_id);

  if not found then
    raise exception 'Only the sender can unsend an active message.';
  end if;

  update public.team_messages message
  set
    body = null,
    image_url = null,
    media_path = null,
    media_type = null,
    media_name = null,
    media_mime = null,
    media_size = null,
    deleted_at = now(),
    deleted_by = auth.uid()
  where message.id = p_message_id
    and message.sender_id = auth.uid()
    and message.deleted_at is null
    and public.is_team_member(message.team_id);

  delete from public.team_message_reactions reaction
  where reaction.message_id = p_message_id;

  media_path := old_media_path;
  media_type := old_media_type;
  return next;
end;
$$;

create or replace function public.toggle_team_message_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_team_id uuid;
begin
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

create or replace function public.hide_team_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_team_id uuid;
begin
  select message.team_id into message_team_id
  from public.team_messages message
  where message.id = p_message_id;

  if message_team_id is null or not public.is_team_member(message_team_id) then
    raise exception 'Only team members can hide this message.';
  end if;

  insert into public.team_message_hides(message_id, user_id)
  values (p_message_id, auth.uid())
  on conflict (message_id, user_id) do nothing;
end;
$$;

revoke all on function public.edit_team_message(uuid, text) from public;
grant execute on function public.edit_team_message(uuid, text) to authenticated;
revoke all on function public.unsend_team_message(uuid) from public;
grant execute on function public.unsend_team_message(uuid) to authenticated;
revoke all on function public.toggle_team_message_reaction(uuid, text) from public;
grant execute on function public.toggle_team_message_reaction(uuid, text) to authenticated;
revoke all on function public.hide_team_message(uuid) from public;
grant execute on function public.hide_team_message(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-chat-media',
  'team-chat-media',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "team members read chat media"
on storage.objects for select to authenticated
using (
  bucket_id = 'team-chat-media'
  and exists (
    select 1 from public.team_members member
    where member.team_id::text = (storage.foldername(name))[1]
      and member.user_id = auth.uid()
  )
);

create policy "team members upload chat media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-chat-media'
  and exists (
    select 1 from public.team_members member
    where member.team_id::text = (storage.foldername(name))[1]
      and member.user_id = auth.uid()
  )
);

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
      when latest.deleted_at is not null then 'Message unsent'
      when latest.body is not null then latest.body
      when latest.media_type = 'video' then 'Shared a video'
      when latest.media_type = 'gif' then 'Shared a GIF'
      else latest.body
    end,
    latest.image_url is not null or latest.media_path is not null,
    latest.created_at,
    sender.display_name,
    count(unread.id) filter (where unread.sender_id <> auth.uid() and unread.deleted_at is null)
  from unnest(p_team_ids) as team(id)
  left join lateral (
    select message.body, message.image_url, message.media_path, message.media_type,
      message.deleted_at, message.created_at, message.sender_id
    from public.team_messages message
    where message.team_id = team.id
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
  where public.is_team_member(team.id)
  group by team.id, latest.body, latest.image_url, latest.media_path, latest.media_type,
    latest.deleted_at, latest.created_at, sender.display_name
  order by latest.created_at desc nulls last;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_message_reactions'
  ) then
    alter publication supabase_realtime add table public.team_message_reactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_message_reads'
  ) then
    alter publication supabase_realtime add table public.team_message_reads;
  end if;
end $$;
