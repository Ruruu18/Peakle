-- Team challenge results on the leaderboard. team_matches are readable only by
-- the two teams involved, so the public standings come from this function,
-- which exposes each team's win–loss totals and never opponents, scores or
-- dates of individual scrimmages. Only discoverable (public) teams are ranked;
-- the caller's own teams are returned separately so a private team can see its
-- record and learn why it is not listed.

create or replace function public.get_team_leaderboard(p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  row_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  standings jsonb;
  mine jsonb;
begin
  if caller is null then raise exception 'Authentication required'; end if;

  with results as (
    select home_team_id as team_id, winner_side = 0 as won, ended_at
      from public.team_matches where status = 'completed' and winner_side is not null
    union all
    select away_team_id, winner_side = 1, ended_at
      from public.team_matches where status = 'completed' and winner_side is not null
  ), totals as (
    select team_id,
           count(*) filter (where won)::integer as wins,
           count(*) filter (where not won)::integer as losses,
           count(*)::integer as matches,
           max(ended_at) as last_played_at
      from results group by team_id
  ), ranked as (
    select t.id, t.name, t.tag, t.image_url, t.location, s.wins, s.losses, s.matches, s.last_played_at,
           rank() over (order by s.wins desc, s.losses asc)::integer as rank
      from totals s join public.teams t on t.id = s.team_id
     where t.is_discoverable
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('is_member', public.is_team_member(r.id)) order by r.rank, r.matches desc, r.name)
                from (select * from ranked order by rank, matches desc, name limit row_limit) r), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'tag', t.tag, 'image_url', t.image_url, 'location', t.location,
                'is_discoverable', t.is_discoverable,
                'wins', coalesce(s.wins, 0), 'losses', coalesce(s.losses, 0), 'matches', coalesce(s.matches, 0),
                'rank', r.rank
              ) order by r.rank nulls last, coalesce(s.wins, 0) desc, t.name)
                from public.team_members m
                join public.teams t on t.id = m.team_id
                left join totals s on s.team_id = t.id
                left join ranked r on r.id = t.id
               where m.user_id = caller), '[]'::jsonb)
    into standings, mine;

  return jsonb_build_object('standings', standings, 'mine', mine);
end;
$$;

revoke all on function public.get_team_leaderboard(integer) from public, anon;
grant execute on function public.get_team_leaderboard(integer) to authenticated;
