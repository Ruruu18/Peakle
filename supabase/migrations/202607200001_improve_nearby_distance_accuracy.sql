-- Keep enough distance precision for useful metre labels while continuing to
-- protect raw coordinates with RLS. Device-reported GPS accuracy lets clients
-- avoid treating an uncertain fix as exact.
alter table public.player_presence
  add column if not exists accuracy_m double precision
  check (accuracy_m is null or accuracy_m between 0 and 50000);

drop function if exists public.nearby_online_players(double precision, double precision, double precision);

create function public.nearby_online_players(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 25
)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  skill_rating numeric,
  distance_km double precision,
  location_accuracy_m double precision,
  availability text,
  last_seen_at timestamptz
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
    presence.accuracy_m as location_accuracy_m,
    presence.availability,
    presence.last_seen_at
  from public.player_presence as presence
  join public.profiles as profile on profile.id = presence.user_id
  join public.player_presence as viewer on viewer.user_id = auth.uid()
  cross join lateral (
    select 6371 * 2 * asin(sqrt(least(1, greatest(0,
      power(sin(radians(presence.latitude - viewer.latitude) / 2), 2)
      + cos(radians(viewer.latitude)) * cos(radians(presence.latitude))
      * power(sin(radians(presence.longitude - viewer.longitude) / 2), 2)
    )))) as distance_km
  ) as calculated
  where auth.uid() is not null
    and presence.user_id <> auth.uid()
    and presence.is_visible
    and presence.availability = 'available'
    and presence.last_seen_at > now() - interval '2 minutes'
    and calculated.distance_km <= least(greatest(coalesce(p_radius_km, 25), 1), 100)
  order by calculated.distance_km, presence.last_seen_at desc
  limit 50;
$$;

revoke all on function public.nearby_online_players(double precision, double precision, double precision) from public;
grant execute on function public.nearby_online_players(double precision, double precision, double precision) to authenticated;
