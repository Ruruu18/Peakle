-- Peakle shows connections as friends. Follows already only take effect once
-- the other player accepts, and accepting connects both directions, so a
-- friend is a pair of player_follows rows (A -> B and B -> A). The tables keep
-- their follow names; this migration:
--   * words follow notifications as friend requests,
--   * makes removing a friend disconnect both directions (and clear any
--     pending request either way), so no new one-way rows are left behind,
--   * adds friend counts that only count mutual pairs. Older one-way rows are
--     kept but no longer count as friends.

create or replace function public.respond_follow_request(
  p_requester_id uuid,
  p_accept boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.player_follow_requests;
  recipient_name text;
  recipient_avatar text;
begin
  select item.* into request
  from public.player_follow_requests item
  where item.requester_id = p_requester_id
    and item.recipient_id = auth.uid()
  for update;

  if not found then
    raise exception 'This friend request is no longer pending.';
  end if;

  if p_accept and exists (
    select 1
    from public.chat_user_blocks block
    where (block.blocker_id = request.requester_id and block.blocked_id = request.recipient_id)
       or (block.blocker_id = request.recipient_id and block.blocked_id = request.requester_id)
  ) then
    raise exception 'This friend request cannot be accepted.';
  end if;

  if p_accept then
    insert into public.player_follows(follower_id, followed_id)
    values
      (request.requester_id, request.recipient_id),
      (request.recipient_id, request.requester_id)
    on conflict (follower_id, followed_id) do nothing;

    select profile.display_name, profile.avatar_url
    into recipient_name, recipient_avatar
    from public.profiles profile
    where profile.id = auth.uid();

    insert into public.user_notifications(user_id, kind, title, body, data)
    values (
      request.requester_id,
      'follow_accepted',
      format('%s accepted your friend request', coalesce(recipient_name, 'A Peakle player')),
      'You are now friends on Peakle.',
      jsonb_build_object(
        'playerId', auth.uid(),
        'playerName', recipient_name,
        'playerAvatarUrl', recipient_avatar,
        'dedupeKey', 'follow-accepted:' || request.id::text
      )
    )
    on conflict do nothing;
  end if;

  -- If both players requested each other before either request was accepted,
  -- acceptance resolves the pair. Remove both request rows and notifications
  -- so neither account remains stuck in a misleading Requested state.
  delete from public.user_notifications notification
  using public.player_follow_requests pending
  where notification.kind = 'follow_request'
    and notification.data->>'requestId' = pending.id::text
    and (
      (pending.requester_id = request.requester_id and pending.recipient_id = request.recipient_id)
      or
      (p_accept and pending.requester_id = request.recipient_id and pending.recipient_id = request.requester_id)
    );

  delete from public.player_follow_requests pending
  where (pending.requester_id = request.requester_id and pending.recipient_id = request.recipient_id)
     or (p_accept and pending.requester_id = request.recipient_id and pending.recipient_id = request.requester_id);

  return p_accept;
end;
$$;

revoke all on function public.respond_follow_request(uuid, boolean) from public;
grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;

create or replace function public.follow_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
  requester_name text;
  requester_avatar text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to add friends.';
  end if;
  if p_player_id is null or p_player_id = auth.uid() then
    raise exception 'Choose another player to add.';
  end if;
  if not exists (
    select 1 from public.profiles profile where profile.id = p_player_id
  ) then
    raise exception 'Player not found.';
  end if;
  if exists (
    select 1
    from public.chat_user_blocks block
    where (block.blocker_id = auth.uid() and block.blocked_id = p_player_id)
       or (block.blocker_id = p_player_id and block.blocked_id = auth.uid())
  ) then
    raise exception 'This player is unavailable.';
  end if;
  if exists (
    select 1
    from public.player_follows relation
    where relation.follower_id = auth.uid()
      and relation.followed_id = p_player_id
  ) then
    return;
  end if;

  select profile.display_name, profile.avatar_url
  into requester_name, requester_avatar
  from public.profiles profile
  where profile.id = auth.uid();

  -- They already follow this player, so following back needs no approval.
  if exists (
    select 1
    from public.player_follows relation
    where relation.follower_id = p_player_id
      and relation.followed_id = auth.uid()
  ) then
    insert into public.player_follows(follower_id, followed_id)
    values (auth.uid(), p_player_id)
    on conflict (follower_id, followed_id) do nothing;

    -- Clear any request either player still has pending for this pair.
    delete from public.user_notifications notification
    using public.player_follow_requests pending
    where notification.kind = 'follow_request'
      and notification.data->>'requestId' = pending.id::text
      and (
        (pending.requester_id = auth.uid() and pending.recipient_id = p_player_id)
        or (pending.requester_id = p_player_id and pending.recipient_id = auth.uid())
      );

    delete from public.player_follow_requests pending
    where (pending.requester_id = auth.uid() and pending.recipient_id = p_player_id)
       or (pending.requester_id = p_player_id and pending.recipient_id = auth.uid());

    insert into public.user_notifications(user_id, kind, title, body, data)
    values (
      p_player_id,
      'follow_accepted',
      format('%s accepted your friend request', coalesce(requester_name, 'A Peakle player')),
      'You are now friends on Peakle.',
      jsonb_build_object(
        'playerId', auth.uid(),
        'playerName', requester_name,
        'playerAvatarUrl', requester_avatar,
        'dedupeKey', 'follow-back:' || auth.uid()::text || ':' || p_player_id::text || ':' || extract(epoch from now())::bigint::text
      )
    )
    on conflict do nothing;
    return;
  end if;

  insert into public.player_follow_requests(requester_id, recipient_id)
  values (auth.uid(), p_player_id)
  on conflict (requester_id, recipient_id) do nothing
  returning id into request_id;

  if request_id is null then
    return;
  end if;

  insert into public.user_notifications(user_id, kind, title, body, data)
  values (
    p_player_id,
    'follow_request',
    format('%s sent you a friend request', coalesce(requester_name, 'A Peakle player')),
    'Accept to add them as a friend, or delete the request.',
    jsonb_build_object(
      'requestId', request_id,
      'requesterId', auth.uid(),
      'playerId', auth.uid(),
      'playerName', requester_name,
      'playerAvatarUrl', requester_avatar,
      'dedupeKey', 'follow-request:' || request_id::text
    )
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.follow_player(uuid) from public;
grant execute on function public.follow_player(uuid) to authenticated;

create or replace function public.unfollow_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_player_id is null or p_player_id = auth.uid() then
    return;
  end if;

  delete from public.player_follows relation
  where (relation.follower_id = auth.uid() and relation.followed_id = p_player_id)
     or (relation.follower_id = p_player_id and relation.followed_id = auth.uid());

  delete from public.user_notifications notification
  using public.player_follow_requests pending
  where notification.kind = 'follow_request'
    and notification.data->>'requestId' = pending.id::text
    and (
      (pending.requester_id = auth.uid() and pending.recipient_id = p_player_id)
      or (pending.requester_id = p_player_id and pending.recipient_id = auth.uid())
    );

  delete from public.player_follow_requests pending
  where (pending.requester_id = auth.uid() and pending.recipient_id = p_player_id)
     or (pending.requester_id = p_player_id and pending.recipient_id = auth.uid());
end;
$$;

create or replace function public.get_player_friend_counts_batch(p_player_ids uuid[])
returns table (
  player_id uuid,
  friends bigint
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
      from public.player_follows outgoing
      join public.player_follows incoming
        on incoming.follower_id = outgoing.followed_id
       and incoming.followed_id = outgoing.follower_id
      where outgoing.follower_id = requested.player_id
    ) as friends
  from requested_players requested
  where auth.uid() is not null
$$;

create or replace function public.get_player_friend_count(p_player_id uuid default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select counts.friends
  from public.get_player_friend_counts_batch(array[coalesce(p_player_id, auth.uid())]) counts
$$;

revoke all on function public.unfollow_player(uuid) from public;
revoke all on function public.get_player_friend_counts_batch(uuid[]) from public;
revoke all on function public.get_player_friend_count(uuid) from public;

grant execute on function public.unfollow_player(uuid) to authenticated;
grant execute on function public.get_player_friend_counts_batch(uuid[]) to authenticated;
grant execute on function public.get_player_friend_count(uuid) to authenticated;

notify pgrst, 'reload schema';
