begin;

-- Player search in "New message" required the other player to have finished
-- the chat safety step, so anyone who never opened Messages could not be found
-- or followed, although follow_player does not need it. Search now lists every
-- onboarded, unbanned, unblocked player; can_message still goes through
-- can_start_private_conversation, which keeps private chat gated on both
-- players' chat safety. Name wildcards are escaped like search_registered_players.
create or replace function public.search_direct_message_candidates(p_query text)
returns table (
  id uuid, display_name text, avatar_url text, skill_rating numeric, home_area text,
  is_following boolean, follows_you boolean, shares_team boolean,
  has_existing_conversation boolean, can_message boolean
)
language sql stable security definer set search_path = ''
as $$
  with term as (
    select btrim(coalesce(p_query, '')) as value
  )
  select profile.id, profile.display_name, profile.avatar_url,
    case when public.can_view_competitive_profile(profile.id) then profile.skill_rating else null end,
    profile.home_area,
    exists (select 1 from public.player_follows relation where relation.follower_id = auth.uid() and relation.followed_id = profile.id),
    exists (select 1 from public.player_follows relation where relation.follower_id = profile.id and relation.followed_id = auth.uid()),
    public.shares_team_with(profile.id),
    public.has_accepted_direct_conversation(profile.id),
    public.can_start_private_conversation(profile.id)
  from public.profiles profile
  cross join term
  where auth.uid() is not null
    and public.can_use_team_chat()
    and profile.id <> auth.uid()
    and profile.onboarding_completed
    and not profile.is_banned
    and char_length(term.value) >= 2
    and profile.display_name ilike '%' || replace(replace(replace(term.value, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    and not exists (select 1 from public.chat_suspensions suspension where suspension.user_id = profile.id and (suspension.suspended_until is null or suspension.suspended_until > now()))
    and not exists (select 1 from public.chat_user_blocks block where (block.blocker_id = auth.uid() and block.blocked_id = profile.id) or (block.blocker_id = profile.id and block.blocked_id = auth.uid()))
  order by public.can_start_private_conversation(profile.id) desc,
    exists (select 1 from public.player_follows relation where relation.follower_id = profile.id and relation.followed_id = auth.uid()) desc,
    profile.display_name
  limit 20
$$;

revoke all on function public.search_direct_message_candidates(text) from public;
grant execute on function public.search_direct_message_candidates(text) to authenticated;

notify pgrst, 'reload schema';
commit;
