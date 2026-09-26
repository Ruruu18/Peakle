-- Team rating and win rate were never computed: the Teams screen showed a
-- hard-coded dash, and since 202608190002 clients cannot read
-- profiles.skill_rating directly anyway. Aggregate them server side from each
-- member's completed matches, using the same rules the app applies to a
-- player's own dashboard (listMyMatches + calculatePerformanceRating):
--   * a member's matches are those they played in, plus matches they recorded
--     with guest-only lineups (a sideline scorer's matches are not theirs);
--   * a match is a win when the member's side took more games;
--   * the rating starts at 3.0 and moves ±0.12 per result plus 0.08 × the
--     point margin, clamped to 1.0–5.5, oldest match first.
-- Team members see every teammate's numbers (they already share a team);
-- anyone else only counts members whose competitive profile they may view.

create or replace function public.get_team_stats(p_team_ids uuid[])
returns table (
  team_id uuid,
  rating numeric,
  rated_members integer,
  wins integer,
  losses integer,
  win_rate integer,
  member_ratings jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  team_row record;
  member_row record;
  match_row record;
  member_rating numeric;
  rating_total numeric;
  rating_count integer;
  win_total integer;
  loss_total integer;
  viewer_is_member boolean;
  ratings_by_member jsonb;
begin
  if auth.uid() is null then
    return;
  end if;

  for team_row in
    select team.id
    from public.teams team
    where team.id = any(coalesce(p_team_ids, '{}'::uuid[]))
      and team.status <> 'archived'
      and (
        team.is_discoverable
        or public.is_team_member(team.id)
        or public.has_pending_team_invitation(team.id)
      )
  loop
    rating_total := 0;
    rating_count := 0;
    win_total := 0;
    loss_total := 0;
    ratings_by_member := '{}'::jsonb;
    viewer_is_member := public.is_team_member(team_row.id);

    for member_row in
      select member.user_id
      from public.team_members member
      where member.team_id = team_row.id
    loop
      continue when not viewer_is_member
        and not public.can_view_competitive_profile(member_row.user_id);

      member_rating := null;

      for match_row in
        select
          played.id,
          count(*) filter (where (case when mine.side = 1 then game.away_score else game.home_score end)
            > (case when mine.side = 1 then game.home_score else game.away_score end)) as games_won,
          count(*) filter (where (case when mine.side = 1 then game.home_score else game.away_score end)
            > (case when mine.side = 1 then game.away_score else game.home_score end)) as games_lost,
          coalesce(sum(case when mine.side = 1 then game.away_score else game.home_score end), 0) as points_for,
          coalesce(sum(case when mine.side = 1 then game.home_score else game.away_score end), 0) as points_against
        from public.matches played
        left join lateral (
          select participant.side
          from public.match_participants participant
          where participant.match_id = played.id
            and participant.user_id = member_row.user_id
          order by participant.position
          limit 1
        ) mine on true
        left join public.match_games game on game.match_id = played.id
        where played.status = 'completed'
          and (
            mine.side is not null
            or (
              played.created_by = member_row.user_id
              and not exists (
                select 1 from public.match_participants linked
                where linked.match_id = played.id and linked.user_id is not null
              )
            )
          )
        group by played.id, played.ended_at
        order by played.ended_at nulls first, played.id
      loop
        if match_row.games_won > match_row.games_lost then
          win_total := win_total + 1;
        else
          loss_total := loss_total + 1;
        end if;

        member_rating := least(5.5, greatest(1.0,
          coalesce(member_rating, 3.0)
          + case when match_row.games_won > match_row.games_lost then 0.12 else -0.12 end
          + coalesce(
              (match_row.points_for - match_row.points_against)::numeric
                / nullif(match_row.points_for + match_row.points_against, 0),
              0
            ) * 0.08
        ));
      end loop;

      if member_rating is not null then
        rating_total := rating_total + round(member_rating, 1);
        rating_count := rating_count + 1;
        ratings_by_member := ratings_by_member || jsonb_build_object(member_row.user_id::text, round(member_rating, 1));
      end if;
    end loop;

    team_id := team_row.id;
    rating := case when rating_count > 0 then round(rating_total / rating_count, 1) end;
    rated_members := rating_count;
    wins := win_total;
    losses := loss_total;
    win_rate := case when win_total + loss_total > 0
      then round(win_total * 100.0 / (win_total + loss_total))::integer end;
    member_ratings := ratings_by_member;
    return next;
  end loop;
end;
$$;

revoke all on function public.get_team_stats(uuid[]) from public;
grant execute on function public.get_team_stats(uuid[]) to authenticated;

notify pgrst, 'reload schema';
