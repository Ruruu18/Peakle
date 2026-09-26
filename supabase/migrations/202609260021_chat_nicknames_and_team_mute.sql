-- Messenger-style chat info for private and team conversations.
--
-- chat_nicknames      A nickname for one person inside one conversation. Like
--                     Messenger, anyone in the chat can set or clear any
--                     participant's nickname (their own included) and everyone
--                     in that chat sees it. It never leaves the conversation.
-- team_chat_settings  Per-player team chat preferences; muted_until works like
--                     direct_conversation_settings.muted_until.

create table if not exists public.chat_nicknames (
  chat_kind text not null check (chat_kind in ('direct', 'team')),
  chat_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 40),
  set_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (chat_kind, chat_id, user_id)
);

alter table public.chat_nicknames enable row level security;
revoke all on public.chat_nicknames from anon, authenticated;
grant select on public.chat_nicknames to authenticated;

create or replace function public.is_chat_participant(p_kind text, p_chat_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'direct' then exists (
      select 1 from public.direct_conversations conversation
      where conversation.id = p_chat_id
        and p_user_id in (conversation.participant_one_id, conversation.participant_two_id)
    )
    when 'team' then exists (
      select 1 from public.team_members member
      where member.team_id = p_chat_id and member.user_id = p_user_id
    )
    else false
  end;
$$;

drop policy if exists "participants read chat nicknames" on public.chat_nicknames;
create policy "participants read chat nicknames"
on public.chat_nicknames for select to authenticated
using (public.is_chat_participant(chat_kind, chat_id, (select auth.uid())));

-- An empty or null nickname clears it. Returns the saved nickname.
create or replace function public.set_chat_nickname(
  p_kind text,
  p_chat_id uuid,
  p_user_id uuid,
  p_nickname text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_nickname text := nullif(btrim(coalesce(p_nickname, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to set nicknames.' using errcode = '42501';
  end if;
  if not public.is_chat_participant(p_kind, p_chat_id, auth.uid()) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if not public.is_chat_participant(p_kind, p_chat_id, p_user_id) then
    raise exception 'That player is not in this conversation.' using errcode = '22023';
  end if;
  if char_length(next_nickname) > 40 then
    raise exception 'Keep nicknames to 40 characters or fewer.' using errcode = '22023';
  end if;

  if next_nickname is null then
    delete from public.chat_nicknames
    where chat_kind = p_kind and chat_id = p_chat_id and user_id = p_user_id;
    return null;
  end if;

  insert into public.chat_nicknames(chat_kind, chat_id, user_id, nickname, set_by)
  values (p_kind, p_chat_id, p_user_id, next_nickname, auth.uid())
  on conflict (chat_kind, chat_id, user_id) do update
    set nickname = excluded.nickname, set_by = excluded.set_by, updated_at = now();
  return next_nickname;
end;
$$;

create table if not exists public.team_chat_settings (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  muted_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_chat_settings_user_idx on public.team_chat_settings(user_id);

alter table public.team_chat_settings enable row level security;
revoke all on public.team_chat_settings from anon, authenticated;
grant select on public.team_chat_settings to authenticated;

drop policy if exists "users read own team chat settings" on public.team_chat_settings;
create policy "users read own team chat settings"
on public.team_chat_settings for select to authenticated
using (user_id = (select auth.uid()));

-- Same contract as set_direct_conversation_muted.
create or replace function public.set_team_chat_muted(
  p_team_id uuid,
  p_muted boolean,
  p_minutes integer default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_muted_until timestamptz;
begin
  if auth.uid() is null or not public.is_chat_participant('team', p_team_id, auth.uid()) then
    raise exception 'Team chat not found.' using errcode = 'P0002';
  end if;
  if coalesce(p_muted, false) then
    if p_minutes is not null and (p_minutes < 1 or p_minutes > 10080) then
      raise exception 'Choose a mute length between 1 minute and 7 days.' using errcode = '22023';
    end if;
    next_muted_until := case
      when p_minutes is null then 'infinity'::timestamptz
      else now() + make_interval(mins => p_minutes)
    end;
  end if;
  insert into public.team_chat_settings(team_id, user_id, muted_until)
  values (p_team_id, auth.uid(), next_muted_until)
  on conflict (team_id, user_id) do update
    set muted_until = excluded.muted_until, updated_at = now();
  return next_muted_until;
end;
$$;

revoke all on function public.is_chat_participant(text, uuid, uuid) from public;
revoke all on function public.set_chat_nickname(text, uuid, uuid, text) from public;
revoke all on function public.set_team_chat_muted(uuid, boolean, integer) from public;
grant execute on function public.is_chat_participant(text, uuid, uuid) to authenticated;
grant execute on function public.set_chat_nickname(text, uuid, uuid, text) to authenticated;
grant execute on function public.set_team_chat_muted(uuid, boolean, integer) to authenticated;

notify pgrst, 'reload schema';
