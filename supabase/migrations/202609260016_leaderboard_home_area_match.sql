-- Local leaderboard matched home areas by exact text, but profiles store them
-- in two shapes: legacy "Surigao City" and the picker's
-- "Surigao City · Region XIII · Philippines". Players in the same city were
-- split apart. Areas now match on the city, and also on the region when both
-- profiles have one, so same-named towns in different regions stay separate.

create or replace function public.same_home_area(a text, b text)
returns boolean
language sql immutable set search_path = '' as $$
  select nullif(lower(btrim(split_part(a, ' · ', 1))), '') = nullif(lower(btrim(split_part(b, ' · ', 1))), '')
     and (nullif(btrim(split_part(a, ' · ', 2)), '') is null
       or nullif(btrim(split_part(b, ' · ', 2)), '') is null
       or lower(btrim(split_part(a, ' · ', 2))) = lower(btrim(split_part(b, ' · ', 2))));
$$;

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
  caller_city text;
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
  caller_city := nullif(btrim(split_part(caller_area, ' · ', 1)), '');
  effective_scope := case when p_scope = 'local' and caller_city is not null then 'local' else 'global' end;

  with eligible as (
    select r.user_id, r.rating, r.verified_matches, r.wins, r.losses,
           p.display_name, p.avatar_url, p.home_area
      from public.player_ratings r
      join public.profiles p on p.id = r.user_id
     where r.format = target_format
       and r.verified_matches > 0
       and (p.profile_visibility <> 'private' or r.user_id = caller)
       and (effective_scope = 'global' or public.same_home_area(p.home_area, caller_area))
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
       and (effective_scope = 'global' or public.same_home_area(p.home_area, caller_area));
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
    'area', case when effective_scope = 'local' then caller_city else '' end,
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
