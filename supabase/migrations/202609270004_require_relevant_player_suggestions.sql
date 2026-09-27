begin;

-- Compare saved home cities, including region/country whenever both profiles
-- provide them. Keep legacy bare-city values compatible with the picker, but
-- never treat a missing/blank city as a shared area.
create or replace function public.same_home_area(a text, b text)
returns boolean
language sql immutable set search_path = '' as $$
  with areas as (
    select
      nullif(lower(btrim(split_part(a, '·', 1))), '') as city_a,
      nullif(lower(btrim(split_part(b, '·', 1))), '') as city_b,
      nullif(lower(btrim(split_part(a, '·', 2))), '') as region_a,
      nullif(lower(btrim(split_part(b, '·', 2))), '') as region_b,
      nullif(lower(btrim(split_part(a, '·', 3))), '') as country_a,
      nullif(lower(btrim(split_part(b, '·', 3))), '') as country_b
  )
  select coalesce(
    city_a = city_b
    and (region_a is null or region_b is null or region_a = region_b)
    and (country_a is null or country_b is null or country_a = country_b),
    false
  ) from areas;
$$;

-- Suggestions previously ranked all active profiles, filling unused slots
-- with unrelated players anywhere. Require a shared connection or home area
-- before limiting the results. Skill, activity and photos only rank eligible
-- players; an empty list must not fall back to the global player pool.
-- Mutual connections use the same shared-following definition as
-- get_player_mutual_connections so card counts agree with public profiles.
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
      public.can_view_competitive_profile(profile.id) as can_view_rating,
      greatest(activity.last_active_at, profile.updated_at) as last_active_at
    from public.profiles profile
    left join mutual_connections mutual on mutual.candidate_id = profile.id
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
  scored as (
    select candidate.*,
      (candidate.can_view_rating
        and viewer.skill_rating is not null and candidate.skill_rating is not null
        and abs(viewer.skill_rating - candidate.skill_rating) <= 0.5) as similar_skill,
      public.same_home_area(viewer.home_area, candidate.home_area) as same_area,
      nullif(btrim(coalesce(candidate.avatar_url, '')), '') is not null as has_photo,
      (select count(*) from public.player_follows relation where relation.followed_id = candidate.id) as follower_count
    from candidates candidate
    cross join viewer
    where (candidate.profile_visibility <> 'private' or candidate.is_teammate)
      and (candidate.is_teammate
        or candidate.follows_viewer
        or candidate.last_active_at > now() - interval '30 days')
  )
  select scored.id, scored.display_name, scored.avatar_url, scored.home_area,
    case when scored.can_view_rating then scored.skill_rating else null end,
    case
      when scored.is_teammate then 'Teammate'
      when scored.played_count > 0 then 'Played with you'
      when scored.follows_viewer then 'Follows you'
      when scored.mutual_count = 1 then '1 mutual connection'
      when scored.mutual_count > 1 then scored.mutual_count || ' mutual connections'
      else 'Plays in your area'
    end,
    scored.follower_count,
    (select count(*) from public.player_follows relation where relation.follower_id = scored.id),
    scored.mutual_count
  from scored
  where scored.mutual_count > 0 or scored.same_area
  order by scored.is_teammate desc,
    scored.played_count desc,
    scored.follows_viewer desc,
    scored.mutual_count desc,
    scored.same_area desc,
    scored.similar_skill desc,
    scored.has_photo desc,
    scored.last_active_at desc nulls last,
    scored.follower_count desc,
    scored.id
  limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;

revoke all on function public.get_player_suggestions(integer) from public;
grant execute on function public.get_player_suggestions(integer) to authenticated;

notify pgrst, 'reload schema';
commit;
