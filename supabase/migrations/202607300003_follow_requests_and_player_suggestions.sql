-- Add approval-based player follows and dashboard suggestions.
-- Existing rows in player_follows remain accepted relationships.

create table if not exists public.player_follow_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);

create index if not exists player_follow_requests_recipient_idx
on public.player_follow_requests(recipient_id, created_at desc);

alter table public.player_follow_requests enable row level security;

drop policy if exists "players read their follow requests" on public.player_follow_requests;
create policy "players read their follow requests"
on public.player_follow_requests for select to authenticated
using (auth.uid() in (requester_id, recipient_id));

revoke all on public.player_follow_requests from public, anon, authenticated;
grant select on public.player_follow_requests to authenticated;

alter table public.user_notifications
  drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications
  add constraint user_notifications_kind_check check (kind in (
    'approval','waitlist_promotion','check_in_reminder','court_assignment','match_point','result',
    'cancellation','venue_announcement','booking_reminder','court_waitlist','booking_changed',
    'booking_confirmed','match_invite','match_invite_response','match_found','organizer_match',
    'direct_message','direct_message_request','direct_message_accepted',
    'follow_request','follow_accepted'
  ));

create unique index if not exists user_notifications_follow_dedupe_idx
on public.user_notifications(user_id, kind, ((data->>'dedupeKey')))
where data ? 'dedupeKey'
  and kind in ('follow_request','follow_accepted');

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

  insert into public.player_follow_requests(requester_id, recipient_id)
  values (auth.uid(), p_player_id)
  on conflict (requester_id, recipient_id) do nothing
  returning id into request_id;

  if request_id is null then
    return;
  end if;

  select profile.display_name, profile.avatar_url
  into requester_name, requester_avatar
  from public.profiles profile
  where profile.id = auth.uid();

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

create or replace function public.unfollow_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_request_id uuid;
begin
  delete from public.player_follows
  where follower_id = auth.uid()
    and followed_id = p_player_id;

  delete from public.player_follow_requests
  where requester_id = auth.uid()
    and recipient_id = p_player_id
  returning id into pending_request_id;

  if pending_request_id is not null then
    delete from public.user_notifications notification
    where notification.user_id = p_player_id
      and notification.kind = 'follow_request'
      and notification.data->>'requestId' = pending_request_id::text;
  end if;
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
        'playerId', auth.uid(),
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

  delete from public.player_follow_requests
  where id = request.id;

  return p_accept;
end;
$$;

create or replace function public.get_player_suggestions(p_limit integer default 8)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  home_area text,
  skill_rating numeric,
  reason text,
  followers bigint,
  following bigint,
  mutuals bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select profile.home_area, profile.skill_rating
    from public.profiles profile
    where profile.id = auth.uid()
  )
  select
    profile.id,
    profile.display_name,
    profile.avatar_url,
    profile.home_area,
    profile.skill_rating,
    case
      when public.shares_team_with(profile.id) then 'Teammate'
      when exists (
        select 1 from public.player_follows relation
        where relation.follower_id = profile.id
          and relation.followed_id = auth.uid()
      ) then 'Follows you'
      when viewer.home_area is not null
        and lower(viewer.home_area) = lower(profile.home_area) then 'Plays in your area'
      when viewer.skill_rating is not null and profile.skill_rating is not null
        and abs(viewer.skill_rating - profile.skill_rating) <= 0.5 then 'Similar skill level'
      else 'Peakle player'
    end as reason,
    (
      select count(*)
      from public.player_follows relation
      where relation.followed_id = profile.id
    ) as followers,
    (
      select count(*)
      from public.player_follows relation
      where relation.follower_id = profile.id
    ) as following,
    (
      select count(*)
      from public.player_follows relation1
      join public.player_follows relation2 on relation1.followed_id = relation2.followed_id
      where relation1.follower_id = auth.uid()
        and relation2.follower_id = profile.id
    ) as mutuals
  from public.profiles profile
  cross join viewer
  where auth.uid() is not null
    and profile.id <> auth.uid()
    and profile.onboarding_completed
    and (profile.profile_visibility <> 'private' or public.shares_team_with(profile.id))
    and not exists (
      select 1 from public.player_follows relation
      where relation.follower_id = auth.uid()
        and relation.followed_id = profile.id
    )
    and not exists (
      select 1 from public.player_follow_requests pending
      where pending.requester_id = auth.uid()
        and pending.recipient_id = profile.id
    )
    and not exists (
      select 1
      from public.chat_user_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = profile.id)
         or (block.blocker_id = profile.id and block.blocked_id = auth.uid())
    )
  order by
    public.shares_team_with(profile.id) desc,
    exists (
      select 1 from public.player_follows relation
      where relation.follower_id = profile.id
        and relation.followed_id = auth.uid()
    ) desc,
    (viewer.home_area is not null and lower(viewer.home_area) = lower(profile.home_area)) desc,
    abs(coalesce(viewer.skill_rating, 3.0) - coalesce(profile.skill_rating, 3.0)),
    profile.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;

revoke all on function public.follow_player(uuid) from public;
revoke all on function public.unfollow_player(uuid) from public;
revoke all on function public.respond_follow_request(uuid, boolean) from public;
revoke all on function public.get_player_suggestions(integer) from public;

grant execute on function public.follow_player(uuid) to authenticated;
grant execute on function public.unfollow_player(uuid) to authenticated;
grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;
grant execute on function public.get_player_suggestions(integer) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'player_follow_requests'
  ) then
    alter publication supabase_realtime add table public.player_follow_requests;
  end if;
end
$$;
