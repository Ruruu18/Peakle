-- Restore the public-profile count RPC in projects where the follow tables
-- were deployed without the function from migration 202607300002.

create or replace function public.get_player_follow_counts(p_player_id uuid default null)
returns table (
  followers bigint,
  following bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)
      from public.player_follows relation
      where relation.followed_id = coalesce(p_player_id, auth.uid())
    ) as followers,
    (
      select count(*)
      from public.player_follows relation
      where relation.follower_id = coalesce(p_player_id, auth.uid())
    ) as following
  where auth.uid() is not null
    and coalesce(p_player_id, auth.uid()) is not null
$$;

revoke all on function public.get_player_follow_counts(uuid) from public;
grant execute on function public.get_player_follow_counts(uuid) to authenticated;

notify pgrst, 'reload schema';
