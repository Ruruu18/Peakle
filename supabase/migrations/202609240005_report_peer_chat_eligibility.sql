-- Mutual followers can still be unable to chat when the other player has not
-- finished chat-safety setup (or is suspended). Report peer eligibility for
-- every relationship, not just teammates, so the app can explain why.

create or replace function public.get_direct_message_permission(p_player_id uuid)
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
    public.private_chat_peer_is_eligible(p_player_id),
    public.private_chat_is_blocked(p_player_id),
    public.can_start_private_conversation(p_player_id)
  where auth.uid() is not null
    and p_player_id is not null
    and p_player_id <> auth.uid()
$$;

revoke all on function public.get_direct_message_permission(uuid) from public;
grant execute on function public.get_direct_message_permission(uuid) to authenticated;

notify pgrst, 'reload schema';
