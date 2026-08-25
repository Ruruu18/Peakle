-- Treat an accepted follow request as a connection between both players.
-- Previously acceptance inserted only requester -> recipient, which meant the
-- recipient gained a follower but the two accounts did not appear in both
-- Followers and Following as the approval UI promises.

-- Existing rows are accepted relationships (pending requests live in the
-- separate player_follow_requests table), so repair previously accepted
-- one-way relationships before fixing future acceptances.
insert into public.player_follows (follower_id, followed_id, created_at)
select relation.followed_id, relation.follower_id, relation.created_at
from public.player_follows relation
on conflict (follower_id, followed_id) do nothing;

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

notify pgrst, 'reload schema';
