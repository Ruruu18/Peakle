-- Fix nearby players not appearing across devices.
--
-- Problems fixed:
-- 1. The 2-minute staleness window was too tight — if the app briefly went
--    to the background the player's presence expired and they vanished.
--    Extended to 5 minutes to match realistic mobile usage patterns.
-- 2. The viewer JOIN was a hard INNER JOIN, meaning if the current user had
--    no presence row (e.g. not yet visible), the whole query returned nothing.
--    Changed to use the caller's coordinates directly from the parameters so
--    the function works regardless of whether the viewer is published.

drop function if exists public.nearby_online_players(double precision, double precision, double precision);

create function public.nearby_online_players(
  p_latitude  double precision,
  p_longitude double precision,
  p_radius_km double precision default 25
)
returns table (
  id                   uuid,
  display_name         text,
  avatar_url           text,
  skill_rating         numeric,
  distance_km          double precision,
  location_accuracy_m  double precision,
  availability         text,
  last_seen_at         timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profile.id,
    profile.display_name,
    profile.avatar_url,
    profile.skill_rating,
    round(calculated.distance_km::numeric, 2)::double precision,
    presence.accuracy_m   as location_accuracy_m,
    presence.availability,
    presence.last_seen_at
  from public.player_presence as presence
  join public.profiles        as profile on profile.id = presence.user_id
  cross join lateral (
    -- Haversine distance from the caller's coordinates (passed as params)
    -- instead of looking up the viewer's own presence row.
    select 6371 * 2 * asin(sqrt(least(1, greatest(0,
        power(sin(radians(presence.latitude  - p_latitude)  / 2), 2)
      + cos(radians(p_latitude))
      * cos(radians(presence.latitude))
      * power(sin(radians(presence.longitude - p_longitude) / 2), 2)
    )))) as distance_km
  ) as calculated
  where auth.uid() is not null
    and presence.user_id  <> auth.uid()
    and presence.is_visible
    and presence.availability in ('available', 'busy')
    -- Extended from 2 → 5 minutes so brief background pauses don't hide players
    and presence.last_seen_at > now() - interval '5 minutes'
    and calculated.distance_km <= least(greatest(coalesce(p_radius_km, 25), 1), 100)
  order by calculated.distance_km, presence.last_seen_at desc
  limit 50;
$$;

revoke all   on function public.nearby_online_players(double precision, double precision, double precision) from public;
grant execute on function public.nearby_online_players(double precision, double precision, double precision) to authenticated;

-- Make the new return shape available to PostgREST immediately after deploy.
notify pgrst, 'reload schema';
