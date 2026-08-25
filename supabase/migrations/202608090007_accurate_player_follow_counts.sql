-- Migration version normalized to preserve the original execution order.
-- Return authoritative follow totals for suggestion cards in one request.
-- This function is security-definer because the player_follows select policy
-- intentionally exposes only relationships involving the signed-in viewer.

create or replace function public.get_player_follow_counts_batch(p_player_ids uuid[])
returns table (
  player_id uuid,
  followers bigint,
  following bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested_players as (
    select distinct requested.player_id
    from unnest(coalesce(p_player_ids[1:100], array[]::uuid[])) as requested(player_id)
    where requested.player_id is not null
  )
  select
    requested.player_id,
    (
      select count(*)
      from public.player_follows relation
      where relation.followed_id = requested.player_id
    ) as followers,
    (
      select count(*)
      from public.player_follows relation
      where relation.follower_id = requested.player_id
    ) as following
  from requested_players requested
  where auth.uid() is not null
$$;

revoke all on function public.get_player_follow_counts_batch(uuid[]) from public;
grant execute on function public.get_player_follow_counts_batch(uuid[]) to authenticated;

notify pgrst, 'reload schema';
