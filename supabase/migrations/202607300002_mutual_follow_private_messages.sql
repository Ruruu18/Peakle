-- Restrict new private conversations to mutual followers or shared teammates.
-- Existing accepted conversations remain available so established chats are
-- not unexpectedly broken when this policy is installed.

create table if not exists public.player_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create index if not exists player_follows_followed_idx
on public.player_follows(followed_id, created_at desc);

alter table public.player_follows enable row level security;

drop policy if exists "players read their follow relationships" on public.player_follows;
create policy "players read their follow relationships"
on public.player_follows for select to authenticated
using (auth.uid() in (follower_id, followed_id));

drop policy if exists "players follow from their own account" on public.player_follows;
create policy "players follow from their own account"
on public.player_follows for insert to authenticated
with check (follower_id = auth.uid());

drop policy if exists "players remove their own follows" on public.player_follows;
create policy "players remove their own follows"
on public.player_follows for delete to authenticated
using (follower_id = auth.uid());

grant select, insert, delete on public.player_follows to authenticated;
revoke update on public.player_follows from authenticated;

create or replace function public.has_mutual_follow(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_player_id is not null
    and p_player_id <> auth.uid()
    and exists (
      select 1
      from public.player_follows relation
      where relation.follower_id = auth.uid()
        and relation.followed_id = p_player_id
    )
    and exists (
      select 1
      from public.player_follows relation
      where relation.follower_id = p_player_id
        and relation.followed_id = auth.uid()
    )
$$;

create or replace function public.has_accepted_direct_conversation(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.direct_conversations conversation
    where conversation.status = 'accepted'
      and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
      and p_player_id in (conversation.participant_one_id, conversation.participant_two_id)
      and p_player_id <> auth.uid()
  )
$$;

create or replace function public.can_start_private_conversation(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_player_id is not null
    and p_player_id <> auth.uid()
    and (
      public.shares_team_with(p_player_id)
      or public.has_mutual_follow(p_player_id)
      or public.has_accepted_direct_conversation(p_player_id)
    )
$$;

create or replace function public.follow_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to follow a player.';
  end if;
  if p_player_id is null or p_player_id = auth.uid() then
    raise exception 'Choose another player to follow.';
  end if;
  if not exists (
    select 1 from public.profiles profile where profile.id = p_player_id
  ) then
    raise exception 'Player not found.';
  end if;
  if exists (
    select 1
    from public.chat_user_blocks block
    where (block.blocker_id = auth.uid() and block.blocked_id = p_player_id)
       or (block.blocker_id = p_player_id and block.blocked_id = auth.uid())
  ) then
    raise exception 'This player is unavailable.';
  end if;

  insert into public.player_follows(follower_id, followed_id)
  values (auth.uid(), p_player_id)
  on conflict (follower_id, followed_id) do nothing;
end;
$$;

create or replace function public.unfollow_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.player_follows
  where follower_id = auth.uid()
    and followed_id = p_player_id;
end;
$$;

create or replace function public.get_direct_message_permission(p_player_id uuid)
returns table (
  is_following boolean,
  follows_you boolean,
  shares_team boolean,
  has_existing_conversation boolean,
  can_message boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = auth.uid()
        and relation.followed_id = p_player_id
    ),
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = p_player_id
        and relation.followed_id = auth.uid()
    ),
    public.shares_team_with(p_player_id),
    public.has_accepted_direct_conversation(p_player_id),
    public.can_start_private_conversation(p_player_id)
  where auth.uid() is not null
    and p_player_id is not null
    and p_player_id <> auth.uid()
$$;

create or replace function public.get_player_follow_counts(p_player_id uuid default null)
returns table (
  followers bigint,
  following bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)
      from public.player_follows relation
      where relation.followed_id = coalesce(p_player_id, auth.uid())
    ) as followers,
    (
      select count(*)
      from public.player_follows relation
      where relation.follower_id = coalesce(p_player_id, auth.uid())
    ) as following
  where auth.uid() is not null
    and coalesce(p_player_id, auth.uid()) is not null
$$;

create or replace function public.search_direct_message_candidates(p_query text)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  skill_rating numeric,
  home_area text,
  is_following boolean,
  follows_you boolean,
  shares_team boolean,
  has_existing_conversation boolean,
  can_message boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.display_name,
    profile.avatar_url,
    profile.skill_rating,
    profile.home_area,
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = auth.uid()
        and relation.followed_id = profile.id
    ) as is_following,
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = profile.id
        and relation.followed_id = auth.uid()
    ) as follows_you,
    public.shares_team_with(profile.id) as shares_team,
    public.has_accepted_direct_conversation(profile.id) as has_existing_conversation,
    public.can_start_private_conversation(profile.id) as can_message
  from public.profiles profile
  where auth.uid() is not null
    and public.can_use_team_chat()
    and profile.id <> auth.uid()
    and char_length(btrim(coalesce(p_query, ''))) >= 2
    and profile.display_name ilike '%' || btrim(p_query) || '%'
    and exists (
      select 1
      from public.chat_safety_profiles safety
      where safety.user_id = profile.id
        and safety.is_adult
        and safety.rules_acknowledged_at is not null
    )
    and not exists (
      select 1
      from public.chat_suspensions suspension
      where suspension.user_id = profile.id
        and (suspension.suspended_until is null or suspension.suspended_until > now())
    )
    and not exists (
      select 1
      from public.chat_user_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = profile.id)
         or (block.blocker_id = profile.id and block.blocked_id = auth.uid())
    )
  order by
    public.can_start_private_conversation(profile.id) desc,
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = profile.id
        and relation.followed_id = auth.uid()
    ) desc,
    profile.display_name
  limit 20
$$;

-- The existing start_direct_conversation function inserts pending requests
-- for unrelated players. This trigger upgrades allowed relationships to an
-- accepted conversation and rejects every unrelated insert at the database
-- boundary. It also protects acceptance of legacy pending requests.
create or replace function public.enforce_direct_conversation_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  peer_id uuid;
begin
  if auth.uid() is null
    or auth.uid() not in (new.participant_one_id, new.participant_two_id) then
    raise exception 'Private messaging is unavailable.';
  end if;

  peer_id := case
    when new.participant_one_id = auth.uid() then new.participant_two_id
    else new.participant_one_id
  end;

  if tg_op = 'INSERT' then
    if not (
      public.shares_team_with(peer_id)
      or public.has_mutual_follow(peer_id)
      or public.has_accepted_direct_conversation(peer_id)
    ) then
      raise exception 'You can only message mutual followers or teammates.';
    end if;
    new.status := 'accepted';
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    if not (
      public.shares_team_with(peer_id)
      or public.has_mutual_follow(peer_id)
      or public.has_accepted_direct_conversation(peer_id)
    ) then
      raise exception 'You can only message mutual followers or teammates.';
    end if;
    new.accepted_at := coalesce(new.accepted_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_direct_conversation_relationship_before_write
on public.direct_conversations;
create trigger enforce_direct_conversation_relationship_before_write
before insert or update of status on public.direct_conversations
for each row execute function public.enforce_direct_conversation_relationship();

revoke all on function public.has_mutual_follow(uuid) from public;
revoke all on function public.has_accepted_direct_conversation(uuid) from public;
revoke all on function public.can_start_private_conversation(uuid) from public;
revoke all on function public.follow_player(uuid) from public;
revoke all on function public.unfollow_player(uuid) from public;
revoke all on function public.get_direct_message_permission(uuid) from public;
revoke all on function public.get_player_follow_counts(uuid) from public;
revoke all on function public.search_direct_message_candidates(text) from public;
revoke all on function public.enforce_direct_conversation_relationship() from public;

grant execute on function public.has_mutual_follow(uuid) to authenticated;
grant execute on function public.has_accepted_direct_conversation(uuid) to authenticated;
grant execute on function public.can_start_private_conversation(uuid) to authenticated;
grant execute on function public.follow_player(uuid) to authenticated;
grant execute on function public.unfollow_player(uuid) to authenticated;
grant execute on function public.get_direct_message_permission(uuid) to authenticated;
grant execute on function public.get_player_follow_counts(uuid) to authenticated;
grant execute on function public.search_direct_message_candidates(text) to authenticated;
