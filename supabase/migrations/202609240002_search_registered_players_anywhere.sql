begin;

-- The Play "Registered players" search only filtered teammates plus
-- nearby_online_players (visible, online in the last 5 minutes, within 25 km),
-- so a player in another city (e.g. Manila) could never be found by name.
-- This name search is location-independent and never exposes coordinates.
create or replace function public.search_registered_players(p_query text)
returns table (
  id uuid, display_name text, avatar_url text, skill_rating numeric, home_area text
)
language sql stable security definer set search_path = ''
as $$
  with viewer as (
    select profile.home_area from public.profiles profile where profile.id = auth.uid()
  ), term as (
    select btrim(coalesce(p_query, '')) as value
  )
  select profile.id, profile.display_name, profile.avatar_url,
    case when public.can_view_competitive_profile(profile.id) then profile.skill_rating else null end,
    profile.home_area
  from public.profiles profile
  cross join term
  left join viewer on true
  where auth.uid() is not null
    and profile.id <> auth.uid()
    and profile.onboarding_completed
    and not profile.is_banned
    and char_length(term.value) >= 2
    and profile.display_name ilike '%' || replace(replace(replace(term.value, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    and (public.shares_team_with(profile.id) or (profile.profile_visibility <> 'private' and profile.matching_enabled))
    and not exists (select 1 from public.chat_user_blocks block where (block.blocker_id = auth.uid() and block.blocked_id = profile.id) or (block.blocker_id = profile.id and block.blocked_id = auth.uid()))
  order by lower(profile.display_name) like lower(term.value) || '%' desc,
    public.shares_team_with(profile.id) desc,
    (viewer.home_area is not null and lower(viewer.home_area) = lower(profile.home_area)) desc,
    profile.display_name
  limit 20
$$;

revoke all on function public.search_registered_players(text) from public;
grant execute on function public.search_registered_players(text) to authenticated;

notify pgrst, 'reload schema';
commit;
