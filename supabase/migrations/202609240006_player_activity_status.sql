-- presence_status is a player's chosen label (free / away / in play) and
-- defaults to free, so on its own it made everyone look online. Track real app
-- activity separately (not on profiles, so heartbeats do not bump updated_at
-- or fire the profile realtime sync) and let the app show the status dot only
-- while the player is actually using Peakle.
create table if not exists public.player_activity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_active boolean not null default false,
  last_active_at timestamptz not null default now()
);

alter table public.player_activity enable row level security;
revoke all on public.player_activity from authenticated, anon;

create or replace function public.touch_player_activity(p_active boolean default true)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.player_activity(user_id, is_active, last_active_at)
  select auth.uid(), coalesce(p_active, true), now()
  where auth.uid() is not null
  on conflict (user_id) do update
    set is_active = excluded.is_active,
        last_active_at = excluded.last_active_at;
$$;

revoke all on function public.touch_player_activity(boolean) from public;
grant execute on function public.touch_player_activity(boolean) to authenticated;

-- Activity is only shared between players connected by a follow in either
-- direction. A player counts as online while their app is in the foreground
-- and has checked in recently; the time window covers apps that were killed
-- without reporting that they went to the background.
create or replace function public.get_player_activity(p_player_ids uuid[])
returns table (user_id uuid, is_online boolean, last_active_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select
    activity.user_id,
    activity.is_active and activity.last_active_at > now() - interval '5 minutes',
    activity.last_active_at
  from public.player_activity activity
  where auth.uid() is not null
    and activity.user_id = any(p_player_ids)
    and activity.user_id <> auth.uid()
    and exists (
      select 1 from public.player_follows relation
      where (relation.follower_id = auth.uid() and relation.followed_id = activity.user_id)
         or (relation.follower_id = activity.user_id and relation.followed_id = auth.uid())
    )
$$;

revoke all on function public.get_player_activity(uuid[]) from public;
grant execute on function public.get_player_activity(uuid[]) to authenticated;

notify pgrst, 'reload schema';
