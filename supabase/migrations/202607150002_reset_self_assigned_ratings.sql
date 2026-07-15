-- Ratings are earned from completed match scores. Profiles with no recorded
-- matches must remain unrated; onboarding must never assign a default rating.
with match_performance as (
  select
    m.created_by as user_id,
    m.id as match_id,
    case
      when count(*) filter (where g.home_score > g.away_score) > count(*) filter (where g.away_score > g.home_score)
        then 0.12
      else -0.12
    end
    + coalesce(
        (sum(g.home_score) - sum(g.away_score))::numeric
        / nullif(sum(g.home_score + g.away_score), 0),
        0
      ) * 0.08 as adjustment
  from public.matches m
  join public.match_games g on g.match_id = m.id
  where m.status = 'completed'
  group by m.created_by, m.id
), earned_ratings as (
  select
    user_id,
    round(least(5.5, greatest(1.0, 3.0 + sum(adjustment)))::numeric, 1) as rating
  from match_performance
  group by user_id
)
update public.profiles p
set skill_rating = earned_ratings.rating
from earned_ratings
where p.id = earned_ratings.user_id;

update public.profiles p
set skill_rating = null
where not exists (
  select 1
  from public.matches m
  where m.created_by = p.id
    and m.status = 'completed'
);

notify pgrst, 'reload schema';
