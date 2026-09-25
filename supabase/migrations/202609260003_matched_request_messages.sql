-- When a player accepts a Find play request ("I can play"), the poster and the
-- player who accepted can message each other even if they do not follow each
-- other, so they can sort out the court and time. Only those two players get
-- access, only while the request is matched, and only until a week after the
-- game. Blocks, suspensions and chat-safety eligibility still apply.

create or replace function public.has_matched_play_request(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_player_id is not null
    and p_player_id <> auth.uid()
    and exists (
      select 1
      from public.matchmaking_posts post
      where post.status = 'matched'
        and post.starts_at > now() - interval '7 days'
        and (
          (post.creator_id = auth.uid() and post.matched_user_id = p_player_id)
          or (post.creator_id = p_player_id and post.matched_user_id = auth.uid())
        )
    )
$$;

create or replace function public.can_start_private_conversation(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_use_team_chat()
    and public.private_chat_peer_is_eligible(p_player_id)
    and not public.private_chat_is_blocked(p_player_id)
    and (
      public.shares_team_with(p_player_id)
      or public.has_mutual_follow(p_player_id)
      or public.has_accepted_direct_conversation(p_player_id)
      or public.has_matched_play_request(p_player_id)
    )
$$;

create or replace function public.enforce_direct_conversation_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  peer_id uuid;
begin
  if auth.uid() is null
    or auth.uid() not in (new.participant_one_id, new.participant_two_id) then
    raise exception 'Private messaging is unavailable.';
  end if;

  peer_id := case
    when new.participant_one_id = auth.uid() then new.participant_two_id
    else new.participant_one_id
  end;

  if tg_op = 'INSERT' then
    if not (
      public.shares_team_with(peer_id)
      or public.has_mutual_follow(peer_id)
      or public.has_accepted_direct_conversation(peer_id)
      or public.has_matched_play_request(peer_id)
    ) then
      raise exception 'You can only message mutual followers, teammates, or players matched on your play request.';
    end if;
    new.status := 'accepted';
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    if not (
      public.shares_team_with(peer_id)
      or public.has_mutual_follow(peer_id)
      or public.has_accepted_direct_conversation(peer_id)
      or public.has_matched_play_request(peer_id)
    ) then
      raise exception 'You can only message mutual followers, teammates, or players matched on your play request.';
    end if;
    new.accepted_at := coalesce(new.accepted_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.has_matched_play_request(uuid) from public;
revoke all on function public.can_start_private_conversation(uuid) from public;
revoke all on function public.enforce_direct_conversation_relationship() from public;

grant execute on function public.has_matched_play_request(uuid) to authenticated;
grant execute on function public.can_start_private_conversation(uuid) to authenticated;

notify pgrst, 'reload schema';
