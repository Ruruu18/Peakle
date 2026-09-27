begin;

-- Follows are one-way again, Instagram style:
--   * following a public or members profile takes effect immediately and only
--     adds follower -> followed; private profiles still get a follow request,
--   * accepting a request adds only requester -> recipient,
--   * unfollowing removes only the caller's own follow and pending request.
-- Followers and Following therefore count each direction on its own. Private
-- chat still needs a mutual follow (has_mutual_follow), so a one-way follow
-- never opens a conversation by itself. Existing mutual rows are kept.
-- "Started following you" reuses the follow_accepted kind (already allowed by
-- user_notifications_kind_check and routed to the social push channel) with
-- data.event = 'new_follower' so clients can tell it apart.

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
  target_visibility text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to follow players.';
  end if;
  if p_player_id is null or p_player_id = auth.uid() then
    raise exception 'Choose another player to follow.';
  end if;

  select profile.profile_visibility into target_visibility
  from public.profiles profile
  where profile.id = p_player_id;
  if not found then
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

  if target_visibility = 'private' then
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
      'Accept to let them follow you, or delete the request.',
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
    return;
  end if;

  insert into public.player_follows(follower_id, followed_id)
  values (auth.uid(), p_player_id)
  on conflict (follower_id, followed_id) do nothing;

  -- A request sent while the profile was private is no longer needed.
  delete from public.user_notifications notification
  using public.player_follow_requests pending
  where notification.kind = 'follow_request'
    and notification.data->>'requestId' = pending.id::text
    and pending.requester_id = auth.uid()
    and pending.recipient_id = p_player_id;
  delete from public.player_follow_requests pending
  where pending.requester_id = auth.uid()
    and pending.recipient_id = p_player_id;

  insert into public.user_notifications(user_id, kind, title, body, data)
  values (
    p_player_id,
    'follow_accepted',
    format('%s started following you', coalesce(requester_name, 'A Peakle player')),
    case
      when exists (
        select 1 from public.player_follows relation
        where relation.follower_id = p_player_id and relation.followed_id = auth.uid()
      ) then 'You follow each other now.'
      else 'Follow them back to connect.'
    end,
    jsonb_build_object(
      'event', 'new_follower',
      'playerId', auth.uid(),
      'playerName', requester_name,
      'playerAvatarUrl', requester_avatar,
      'dedupeKey', 'new-follower:' || auth.uid()::text || ':' || p_player_id::text || ':' || (extract(epoch from now())::bigint / 86400)::text
    )
  )
  on conflict do nothing;
end;
$$;

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
    values (request.requester_id, request.recipient_id)
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
      'You are now following them.',
      jsonb_build_object(
        'playerId', request.recipient_id,
        'playerName', recipient_name,
        'playerAvatarUrl', recipient_avatar,
        'dedupeKey', 'follow-accepted:' || request.id::text
      )
    )
    on conflict do nothing;
  end if;

  delete from public.user_notifications notification
  where notification.user_id = auth.uid()
    and notification.kind = 'follow_request'
    and notification.data->>'requestId' = request.id::text;

  delete from public.player_follow_requests item
  where item.id = request.id;

  return p_accept;
end;
$$;

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
  where relation.follower_id = auth.uid()
    and relation.followed_id = p_player_id;

  delete from public.user_notifications notification
  using public.player_follow_requests pending
  where notification.kind = 'follow_request'
    and notification.data->>'requestId' = pending.id::text
    and pending.requester_id = auth.uid()
    and pending.recipient_id = p_player_id;

  delete from public.player_follow_requests pending
  where pending.requester_id = auth.uid()
    and pending.recipient_id = p_player_id;
end;
$$;

revoke all on function public.follow_player(uuid) from public;
revoke all on function public.respond_follow_request(uuid, boolean) from public;
revoke all on function public.unfollow_player(uuid) from public;
grant execute on function public.follow_player(uuid) to authenticated;
grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;
grant execute on function public.unfollow_player(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
