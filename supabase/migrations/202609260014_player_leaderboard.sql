-- Player standings on the leaderboard. player_ratings RLS follows full profile
-- visibility, so a player on the default "My teammates" setting was invisible
-- to everyone outside their teams and the leaderboard looked empty. Standings
-- now come from this function, which lists every player with verified matches
-- unless they chose "Only me", and exposes only leaderboard fields (name,
-- avatar, area, rating, record). Rating history and other competitive stats
-- still follow profile visibility.
--
-- The caller's summary also counts their recorded and pending-confirmation
-- matches, so an unranked player can see why saved matches have not ranked
-- them yet (only confirmed ranked matches against registered players count).

create or replace function public.get_player_leaderboard(
  p_format text default 'doubles',
  p_scope text default 'local',
  p_limit integer default 50
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  row_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  target_format text := coalesce(p_format, 'doubles');
  caller_area text;
  effective_scope text;
  own public.player_ratings%rowtype;
  own_rank integer;
  recorded_count integer;
  pending_count integer;
  standings jsonb;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if target_format not in ('singles', 'doubles') then raise exception 'Unknown format'; end if;

  select nullif(btrim(p.home_area), '') into caller_area from public.profiles p where p.id = caller;
  effective_scope := case when p_scope = 'local' and caller_area is not null then 'local' else 'global' end;

  with eligible as (
    select r.user_id, r.rating, r.verified_matches, r.wins, r.losses,
           p.display_name, p.avatar_url, p.home_area
      from public.player_ratings r
      join public.profiles p on p.id = r.user_id
     where r.format = target_format
       and r.verified_matches > 0
       and (p.profile_visibility <> 'private' or r.user_id = caller)
       and (effective_scope = 'global' or p.home_area = caller_area)
  ), ranked as (
    select e.*, rank() over (order by e.rating desc)::integer as rank
      from eligible e
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rating desc, r.verified_matches desc), '[]'::jsonb)
    into standings
    from (select * from ranked order by rating desc, verified_matches desc limit row_limit) r;

  select * into own from public.player_ratings where user_id = caller and format = target_format;
  if found and own.verified_matches > 0 then
    select count(*)::integer + 1 into own_rank
      from public.player_ratings r
      join public.profiles p on p.id = r.user_id
     where r.format = target_format
       and r.verified_matches > 0
       and r.rating > own.rating
       and p.profile_visibility <> 'private'
       and (effective_scope = 'global' or p.home_area = caller_area);
  end if;

  select count(*)::integer,
         count(*) filter (where m.mode = 'ranked' and m.verification_status = 'pending')::integer
    into recorded_count, pending_count
    from public.matches m
   where m.status = 'completed'
     and m.match_type = target_format
     and exists (select 1 from public.match_participants mp where mp.match_id = m.id and mp.user_id = caller);

  return jsonb_build_object(
    'scope', effective_scope,
    'area', case when effective_scope = 'local' then caller_area else '' end,
    'standings', standings,
    'own', jsonb_build_object(
      'rating', own.rating, 'verified_matches', coalesce(own.verified_matches, 0),
      'wins', coalesce(own.wins, 0), 'losses', coalesce(own.losses, 0), 'rank', own_rank,
      'recorded_matches', recorded_count, 'pending_matches', pending_count)
  );
end;
$$;

revoke all on function public.get_player_leaderboard(text, text, integer) from public, anon;
grant execute on function public.get_player_leaderboard(text, text, integer) to authenticated;
