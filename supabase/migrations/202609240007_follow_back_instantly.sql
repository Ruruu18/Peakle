-- Following back a player who already follows you should connect the pair
-- immediately. follow_player used to file a follow request even then, so the
-- chat stayed on "Waiting for a follow back" until the other player approved
-- a second request.
--
-- respond_follow_request is re-declared unchanged from
-- 202608090003_mutualize_accepted_follows so projects that missed that
-- migration also stop leaving accepted follows one-way.

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
    raise exception 'This follow request is no longer pending.';
  end if;

  if p_accept and exists (
    select 1
    from public.chat_user_blocks block
    where (block.blocker_id = request.requester_id and block.blocked_id = request.recipient_id)
       or (block.blocker_id = request.recipient_id and block.blocked_id = request.requester_id)
  ) then
    raise exception 'This follow request cannot be accepted.';
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
      format('%s accepted your follow request', coalesce(recipient_name, 'A Peakle player')),
      'You now follow each other.',
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
    raise exception 'Sign in to follow a player.';
  end if;
  if p_player_id is null or p_player_id = auth.uid() then
    raise exception 'Choose another player to follow.';
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
      format('%s followed you back', coalesce(requester_name, 'A Peakle player')),
      'You now follow each other.',
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
    format('%s wants to follow you', coalesce(requester_name, 'A Peakle player')),
    'Accept the request to add them to your followers, or delete it.',
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

notify pgrst, 'reload schema';
