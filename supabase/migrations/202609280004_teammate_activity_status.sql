-- Online status was only shared between players connected by a follow, so
-- teammates listed when setting up a match always read offline. Also share it
-- between players who belong to the same team.
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
    and (
      exists (
        select 1 from public.player_follows relation
        where (relation.follower_id = auth.uid() and relation.followed_id = activity.user_id)
           or (relation.follower_id = activity.user_id and relation.followed_id = auth.uid())
      )
      or exists (
        select 1 from public.team_members mine
        join public.team_members theirs on theirs.team_id = mine.team_id
        where mine.user_id = auth.uid() and theirs.user_id = activity.user_id
      )
    )
$$;

revoke all on function public.get_player_activity(uuid[]) from public;
grant execute on function public.get_player_activity(uuid[]) to authenticated;

notify pgrst, 'reload schema';
