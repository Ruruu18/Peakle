-- Give public profiles a privacy-safe mutual-connections preview.
-- A mutual connection is a player followed by both the viewer and the
-- profile being viewed. Only accounts the viewer already follows are exposed.

create or replace function public.get_player_mutual_connections(
  p_player_id uuid,
  p_limit integer default 3
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mutual_connections as (
    select
      profile.id,
      profile.display_name,
      profile.avatar_url,
      viewer_relation.created_at
    from public.player_follows viewer_relation
    join public.player_follows player_relation
      on player_relation.followed_id = viewer_relation.followed_id
    join public.profiles profile
      on profile.id = viewer_relation.followed_id
    where auth.uid() is not null
      and p_player_id is not null
      and p_player_id <> auth.uid()
      and viewer_relation.follower_id = auth.uid()
      and player_relation.follower_id = p_player_id
  ),
  preview as (
    select id, display_name, avatar_url, created_at
    from mutual_connections
    order by created_at desc, id
    limit greatest(1, least(coalesce(p_limit, 3), 6))
  )
  select jsonb_build_object(
    'count', (select count(*) from mutual_connections),
    'connections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'display_name', item.display_name,
            'avatar_url', item.avatar_url
          )
          order by item.created_at desc, item.id
        )
        from preview item
      ),
      '[]'::jsonb
    )
  )
$$;

revoke all on function public.get_player_mutual_connections(uuid, integer) from public;
grant execute on function public.get_player_mutual_connections(uuid, integer) to authenticated;
