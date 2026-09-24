begin;

-- "People you may know" previously ranked same home_area above every social
-- signal, and only returned 6-8 rows, so players from other cities (e.g.
-- Manila) were crowded out even when they shared many connections with the
-- viewer. Rank by social graph first, location last:
--   1. teammates  2. follows you  3. mutual connections  4. similar skill
--   5. same area  6. newest players
--
-- "Mutual connections" are friends-of-friends: accounts the viewer follows
-- that also follow the candidate (the "Followed by Alex + 2 others" signal).
-- Counts are aggregated once in CTEs instead of per-candidate subqueries.
--
-- Also restores the private-profile filter from the original suggestions
-- function (private profiles are only suggested to teammates) and hides
-- banned accounts. Return type is unchanged, so clients need no update.
create or replace function public.get_player_suggestions(p_limit integer default 8)
returns table (
  id uuid, display_name text, avatar_url text, home_area text,
  skill_rating numeric, reason text, followers bigint, following bigint, mutuals bigint
)
language sql stable security definer set search_path = ''
as $$
  with viewer as (
    select profile.id, profile.home_area, profile.skill_rating
    from public.profiles profile where profile.id = auth.uid()
  ),
  viewer_following as (
    select relation.followed_id as id
    from public.player_follows relation
    where relation.follower_id = auth.uid()
  ),
  mutual_connections as (
    select relation.followed_id as candidate_id,
      count(*) as mutual_count,
      (array_agg(connection.display_name order by connection.display_name))[1] as first_name
    from public.player_follows relation
    join viewer_following on viewer_following.id = relation.follower_id
    join public.profiles connection on connection.id = relation.follower_id
    where relation.followed_id <> auth.uid()
    group by relation.followed_id
  ),
  candidates as (
    select profile.*,
      public.shares_team_with(profile.id) as is_teammate,
      exists (
        select 1 from public.player_follows relation
        where relation.follower_id = profile.id and relation.followed_id = auth.uid()
      ) as follows_viewer,
      coalesce(mutual.mutual_count, 0) as mutual_count,
      mutual.first_name as first_mutual_name,
      public.can_view_competitive_profile(profile.id) as can_view_rating
    from public.profiles profile
    left join mutual_connections mutual on mutual.candidate_id = profile.id
    where auth.uid() is not null
      and profile.id <> auth.uid()
      and profile.onboarding_completed
      and not profile.is_banned
      and not exists (select 1 from viewer_following where viewer_following.id = profile.id)
      and not exists (select 1 from public.player_follow_requests pending where pending.requester_id = auth.uid() and pending.recipient_id = profile.id)
      and not exists (select 1 from public.chat_user_blocks block where (block.blocker_id = auth.uid() and block.blocked_id = profile.id) or (block.blocker_id = profile.id and block.blocked_id = auth.uid()))
  ),
  scored as (
    select candidate.*,
      (candidate.can_view_rating
        and viewer.skill_rating is not null and candidate.skill_rating is not null
        and abs(viewer.skill_rating - candidate.skill_rating) <= 0.5) as similar_skill,
      (viewer.home_area is not null and candidate.home_area is not null
        and lower(btrim(viewer.home_area)) = lower(btrim(candidate.home_area))) as same_area
    from candidates candidate
    cross join viewer
    where candidate.profile_visibility <> 'private' or candidate.is_teammate
  )
  select scored.id, scored.display_name, scored.avatar_url, scored.home_area,
    case when scored.can_view_rating then scored.skill_rating else null end,
    case
      when scored.is_teammate then 'Teammate'
      when scored.follows_viewer then 'Follows you'
      when scored.mutual_count = 1 then 'Followed by ' || coalesce(scored.first_mutual_name, 'a friend')
      when scored.mutual_count > 1 then 'Followed by ' || coalesce(scored.first_mutual_name, 'a friend') || ' + ' || (scored.mutual_count - 1) || ' more'
      when scored.similar_skill then 'Similar skill level'
      when scored.same_area then 'Plays in your area'
      else 'Peakle player'
    end,
    (select count(*) from public.player_follows relation where relation.followed_id = scored.id),
    (select count(*) from public.player_follows relation where relation.follower_id = scored.id),
    scored.mutual_count
  from scored
  order by scored.is_teammate desc,
    scored.follows_viewer desc,
    scored.mutual_count desc,
    scored.similar_skill desc,
    scored.same_area desc,
    scored.created_at desc,
    scored.id
  limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;

revoke all on function public.get_player_suggestions(integer) from public;
grant execute on function public.get_player_suggestions(integer) to authenticated;

-- The friends-of-friends join uses the existing (follower_id, followed_id)
-- primary key and player_follows_followed_idx; no new index is needed.

notify pgrst, 'reload schema';
commit;
