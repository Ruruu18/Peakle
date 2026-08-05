-- Make the private-message permission check match the send-time safety rules.
-- This prevents a teammate from appearing messageable and then failing only
-- after the sender writes a message.

create or replace function public.private_chat_peer_is_eligible(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and target_user is not null
    and target_user <> auth.uid()
    and exists (
      select 1 from public.chat_safety_profiles safety
      where safety.user_id = target_user
        and safety.is_adult
        and safety.rules_acknowledged_at is not null
    )
    and not exists (
      select 1 from public.chat_suspensions suspension
      where suspension.user_id = target_user
        and (suspension.suspended_until is null or suspension.suspended_until > now())
    )
$$;

create or replace function public.private_chat_is_blocked(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_user_blocks block
    where (block.blocker_id = auth.uid() and block.blocked_id = target_user)
       or (block.blocker_id = target_user and block.blocked_id = auth.uid())
  )
$$;

create or replace function public.can_start_private_conversation(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_use_team_chat()
    and public.private_chat_peer_is_eligible(p_player_id)
    and not public.private_chat_is_blocked(p_player_id)
    and (
      public.shares_team_with(p_player_id)
      or public.has_mutual_follow(p_player_id)
      or public.has_accepted_direct_conversation(p_player_id)
    )
$$;

drop function if exists public.get_direct_message_permission(uuid);
create function public.get_direct_message_permission(p_player_id uuid)
returns table (
  is_following boolean,
  follows_you boolean,
  shares_team boolean,
  has_existing_conversation boolean,
  peer_chat_eligible boolean,
  blocked boolean,
  can_message boolean
)
language sql stable security definer set search_path = '' as $$
  select
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = auth.uid() and relation.followed_id = p_player_id
    ),
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = p_player_id and relation.followed_id = auth.uid()
    ),
    public.shares_team_with(p_player_id),
    public.has_accepted_direct_conversation(p_player_id),
    case when public.shares_team_with(p_player_id)
      then public.private_chat_peer_is_eligible(p_player_id)
      else null
    end,
    public.private_chat_is_blocked(p_player_id),
    public.can_start_private_conversation(p_player_id)
  where auth.uid() is not null
    and p_player_id is not null
    and p_player_id <> auth.uid()
$$;

revoke all on function public.private_chat_peer_is_eligible(uuid) from public;
revoke all on function public.private_chat_is_blocked(uuid) from public;
revoke all on function public.can_start_private_conversation(uuid) from public;
revoke all on function public.get_direct_message_permission(uuid) from public;
grant execute on function public.can_start_private_conversation(uuid) to authenticated;
grant execute on function public.get_direct_message_permission(uuid) to authenticated;

notify pgrst, 'reload schema';
