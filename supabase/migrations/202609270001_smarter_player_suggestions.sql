begin;

-- "People you may know" improvements:
--   * "Played with you": approved players from the same Open Play session or
--     the same (non-cancelled) match rank right after teammates, since meeting
--     on court is a stronger signal than any online follow.
--   * Inactive accounts (no app activity or profile update in 30 days) are no
--     longer suggested, except teammates and players who follow the viewer.
--   * The fallback prefers players with a profile photo, then recently active
--     players, then more-followed players, instead of simply the newest
--     accounts (which are often empty profiles).
--   * Players can dismiss a suggestion; dismissed players are never suggested
--     to that viewer again.
-- Return type is unchanged, so older clients keep working.

create table if not exists public.player_suggestion_dismissals (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (viewer_id, dismissed_id),
  check (viewer_id <> dismissed_id)
);

alter table public.player_suggestion_dismissals enable row level security;
revoke all on public.player_suggestion_dismissals from authenticated, anon;

create or replace function public.dismiss_player_suggestion(p_player_id uuid)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.player_suggestion_dismissals(viewer_id, dismissed_id)
  select auth.uid(), p_player_id
  where auth.uid() is not null
    and p_player_id is not null
    and p_player_id <> auth.uid()
    and exists (select 1 from public.profiles profile where profile.id = p_player_id)
  on conflict do nothing;
$$;

revoke all on function public.dismiss_player_suggestion(uuid) from public;
grant execute on function public.dismiss_player_suggestion(uuid) to authenticated;

-- "Played with you" looks up the viewer's own sessions and matches by user_id.
create index if not exists open_play_players_user_idx
  on public.open_play_players(user_id) where user_id is not null;
create index if not exists match_participants_user_idx
  on public.match_participants(user_id) where user_id is not null;

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
      mutual.first_name as first_mutual_name,
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
      (viewer.home_area is not null and candidate.home_area is not null
        and lower(btrim(viewer.home_area)) = lower(btrim(candidate.home_area))) as same_area,
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
      when scored.mutual_count = 1 then 'Followed by ' || coalesce(scored.first_mutual_name, 'a friend')
      when scored.mutual_count > 1 then 'Followed by ' || coalesce(scored.first_mutual_name, 'a friend') || ' + ' || (scored.mutual_count - 1) || ' more'
      when scored.similar_skill then 'Similar skill level'
      when scored.same_area then 'Plays in your area'
      else 'Peakle player'
    end,
    scored.follower_count,
    (select count(*) from public.player_follows relation where relation.follower_id = scored.id),
    scored.mutual_count
  from scored
  order by scored.is_teammate desc,
    scored.played_count desc,
    scored.follows_viewer desc,
    scored.mutual_count desc,
    scored.similar_skill desc,
    scored.same_area desc,
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
