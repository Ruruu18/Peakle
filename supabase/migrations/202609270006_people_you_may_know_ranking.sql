begin;

-- Same region and country, different city: "near you" rather than "your area".
-- Bare legacy city values carry no region, so they never match here.
create or replace function public.same_home_region(a text, b text)
returns boolean
language sql immutable set search_path = '' as $$
  with areas as (
    select
      nullif(lower(btrim(split_part(a, '·', 2))), '') as region_a,
      nullif(lower(btrim(split_part(b, '·', 2))), '') as region_b,
      nullif(lower(btrim(split_part(a, '·', 3))), '') as country_a,
      nullif(lower(btrim(split_part(b, '·', 3))), '') as country_b
  )
  select coalesce(
    region_a = region_b
    and (country_a is null or country_b is null or country_a = country_b)
    and not public.same_home_area(a, b),
    false
  ) from areas;
$$;

-- People you may know, ranked like a social graph rather than by city alone.
-- Relationships (teammates, opponents, followers, shared connections and
-- players your network follows) qualify from any area; location only adds
-- weight. Similar skill, photos and activity rank players but never qualify
-- them, so an unconnected viewer still gets no global fallback.
-- mutuals keeps the shared-following definition of get_player_mutual_connections.
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
    select relation.follower_id as candidate_id,
      count(*) as mutual_count
    from public.player_follows relation
    join viewer_following on viewer_following.id = relation.followed_id
    where relation.follower_id <> auth.uid()
    group by relation.follower_id
  ),
  -- Friends of friends: players followed by people the viewer follows.
  network_follows as (
    select relation.followed_id as candidate_id,
      count(*) as network_count,
      (array_agg(profile.display_name order by relation.created_at desc, profile.id))[1] as network_name
    from public.player_follows relation
    join viewer_following on viewer_following.id = relation.follower_id
    join public.profiles profile on profile.id = relation.follower_id
    where relation.followed_id <> auth.uid()
    group by relation.followed_id
  ),
  played_with as (
    select shared.candidate_id, count(*) as games
    from (
      select other.user_id as candidate_id
      from public.open_play_players mine
      join public.open_play_players other
        on other.session_id = mine.session_id
       and other.user_id is not null
       and other.user_id <> mine.user_id
       and other.registration_status = 'approved'
      where mine.user_id = auth.uid() and mine.registration_status = 'approved'
      union all
      select other.user_id
      from public.match_participants mine
      join public.matches played_match on played_match.id = mine.match_id and played_match.status <> 'cancelled'
      join public.match_participants other
        on other.match_id = mine.match_id
       and other.user_id is not null
       and other.user_id <> mine.user_id
      where mine.user_id = auth.uid()
    ) shared
    group by shared.candidate_id
  ),
  candidates as (
    select profile.*,
      public.shares_team_with(profile.id) as is_teammate,
      exists (
        select 1 from public.player_follows relation
        where relation.follower_id = profile.id and relation.followed_id = auth.uid()
      ) as follows_viewer,
      coalesce(played.games, 0) as played_count,
      coalesce(mutual.mutual_count, 0) as mutual_count,
      coalesce(network.network_count, 0) as network_count,
      network.network_name,
      public.can_view_competitive_profile(profile.id) as can_view_rating,
      greatest(activity.last_active_at, profile.updated_at) as last_active_at
    from public.profiles profile
    left join mutual_connections mutual on mutual.candidate_id = profile.id
    left join network_follows network on network.candidate_id = profile.id
    left join played_with played on played.candidate_id = profile.id
    left join public.player_activity activity on activity.user_id = profile.id
    where auth.uid() is not null
      and profile.id <> auth.uid()
      and profile.onboarding_completed
      and not profile.is_banned
      and not exists (select 1 from viewer_following where viewer_following.id = profile.id)
      and not exists (select 1 from public.player_follow_requests pending where pending.requester_id = auth.uid() and pending.recipient_id = profile.id)
      and not exists (select 1 from public.player_suggestion_dismissals dismissed where dismissed.viewer_id = auth.uid() and dismissed.dismissed_id = profile.id)
      and not exists (select 1 from public.chat_user_blocks block where (block.blocker_id = auth.uid() and block.blocked_id = profile.id) or (block.blocker_id = profile.id and block.blocked_id = auth.uid()))
  ),
  signals as (
    select candidate.*,
      public.same_home_area(viewer.home_area, candidate.home_area) as same_area,
      public.same_home_region(viewer.home_area, candidate.home_area) as same_region,
      (candidate.can_view_rating
        and viewer.skill_rating is not null and candidate.skill_rating is not null
        and abs(viewer.skill_rating - candidate.skill_rating) <= 0.5) as similar_skill,
      nullif(btrim(coalesce(candidate.avatar_url, '')), '') is not null as has_photo
    from candidates candidate
    cross join viewer
    where (candidate.profile_visibility <> 'private' or candidate.is_teammate)
      and (candidate.is_teammate
        or candidate.follows_viewer
        or candidate.played_count > 0
        or candidate.last_active_at > now() - interval '30 days')
  ),
  scored as (
    select signals.*,
      -- Each connection counts, with diminishing returns past ten.
        (case when signals.is_teammate then 100 else 0 end)
      + (case when signals.follows_viewer then 60 else 0 end)
      + (case when signals.played_count > 0 then 30 + 10 * least(signals.played_count, 5) else 0 end)
      + 15 * least(signals.mutual_count, 10)
      + 12 * least(signals.network_count, 10)
      + (case when signals.same_area then 25 when signals.same_region then 8 else 0 end)
      as relevance,
        (case when signals.similar_skill then 6 else 0 end)
      + (case when signals.last_active_at > now() - interval '7 days' then 5 else 0 end)
      + (case when signals.has_photo then 3 else 0 end)
      as polish,
      (select count(*) from public.player_follows relation where relation.followed_id = signals.id) as follower_count
    from signals
  )
  select scored.id, scored.display_name, scored.avatar_url, scored.home_area,
    case when scored.can_view_rating then scored.skill_rating else null end,
    case
      when scored.is_teammate then 'Teammate'
      when scored.played_count > 0 then 'Played with you'
      when scored.follows_viewer then 'Follows you'
      when scored.mutual_count >= greatest(scored.network_count, 1) then
        scored.mutual_count || case when scored.mutual_count = 1 then ' mutual connection' else ' mutual connections' end
      when scored.network_count = 1 then 'Followed by ' || coalesce(scored.network_name, 'someone you follow')
      when scored.network_count > 1 then 'Followed by ' || coalesce(scored.network_name, 'someone you follow')
        || ' + ' || (scored.network_count - 1) || case when scored.network_count = 2 then ' other' else ' others' end
      when scored.same_area then 'Plays in your area'
      else 'Plays near you'
    end,
    scored.follower_count,
    (select count(*) from public.player_follows relation where relation.follower_id = scored.id),
    scored.mutual_count
  from scored
  where scored.relevance > 0
  order by scored.relevance + scored.polish desc,
    scored.last_active_at desc nulls last,
    scored.follower_count desc,
    scored.id
  limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;

revoke all on function public.get_player_suggestions(integer) from public;
grant execute on function public.get_player_suggestions(integer) to authenticated;

notify pgrst, 'reload schema';
commit;
