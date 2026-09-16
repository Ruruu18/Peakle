-- Community chat: add sender avatar_url to the chat list, and expose a
-- lightweight session-state snapshot (courts with player avatars + next fair
-- lineup with avatars) that the chat UI can show inline for open-play events.
begin;

-- ─── 1. list_my_community_chats – expose last sender's avatar ─────────────────
-- Drop and recreate because the RETURNS TABLE shape is changing.
drop function if exists public.list_my_community_chats();

create or replace function public.list_my_community_chats()
returns table (
  conversation_id        uuid,
  event_kind             text,
  event_id               text,
  title                  text,
  subtitle               text,
  is_host                boolean,
  member_count           bigint,
  last_message_at        timestamptz,
  last_body              text,
  last_is_announcement   boolean,
  last_sender_name       text,
  last_sender_avatar_url text,
  unread_count           bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_events as (
    select
      'open_play'::text as event_kind,
      session.id::text  as event_id,
      session.name      as title,
      coalesce(venue.name, 'Open play') as subtitle,
      (session.organizer_id = auth.uid()) as is_host,
      (
        select count(*) from public.open_play_players p2
        where p2.session_id = session.id
          and p2.registration_status in ('approved', 'waitlisted')
          and p2.departed_at is null
      ) as member_count
    from public.open_play_sessions session
    left join public.venues venue on venue.id = session.venue_id
    where session.organizer_id = auth.uid()
       or exists (
            select 1 from public.open_play_players player
            where player.session_id = session.id
              and player.user_id = auth.uid()
              and player.registration_status in ('approved', 'waitlisted')
              and player.departed_at is null
          )
    union all
    select
      'competition'::text,
      competition.id::text,
      competition.name,
      initcap(competition.kind) || coalesce(' · ' || venue.name, ''),
      (competition.organizer_id = auth.uid())
        or (competition.venue_id is not null and public.can_manage_venue(competition.venue_id)),
      (
        select count(*) from public.competition_entries e2
        where e2.competition_id = competition.id and e2.status <> 'withdrawn'
      )
    from public.competitions competition
    left join public.venues venue on venue.id = competition.venue_id
    where competition.organizer_id = auth.uid()
       or (competition.venue_id is not null and public.can_manage_venue(competition.venue_id))
       or exists (
            select 1 from public.competition_entries entry
            where entry.competition_id = competition.id
              and entry.status <> 'withdrawn'
              and (
                entry.user_id = auth.uid()
                or exists (
                     select 1 from public.team_members member
                     where member.team_id = entry.team_id and member.user_id = auth.uid()
                   )
              )
          )
  )
  select
    conversation.id,
    my.event_kind,
    my.event_id,
    my.title,
    my.subtitle,
    my.is_host,
    my.member_count,
    conversation.last_message_at,
    latest.body,
    latest.is_announcement,
    coalesce(sender.display_name, 'Member'),
    sender.avatar_url,
    (
      select count(*) from public.community_messages unread
      where unread.conversation_id = conversation.id
        and unread.sender_id <> auth.uid()
        and unread.created_at > coalesce(
              (select r.last_read_at from public.community_conversation_reads r
               where r.conversation_id = conversation.id and r.user_id = auth.uid()),
              '-infinity'::timestamptz
            )
    )
  from my_events my
  left join public.community_conversations conversation
    on conversation.event_kind = my.event_kind and conversation.event_id = my.event_id
  left join lateral (
    select m.body, m.is_announcement, m.sender_id
    from public.community_messages m
    where m.conversation_id = conversation.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join public.profiles sender on sender.id = latest.sender_id
  order by conversation.last_message_at desc nulls last, my.title
$$;

revoke all on function public.list_my_community_chats() from public;
grant execute on function public.list_my_community_chats() to authenticated;

-- ─── 2. get_community_chat_session_state ─────────────────────────────────────
-- Returns a lightweight snapshot of an open-play session for display inside
-- the community chat:
--   courts      – each court with its live match score and every player's
--                 display_name + avatar_url, side, and position.
--   next_lineup – the next N waiting players (same ordering the fair-play
--                 engine uses: queue_position -> waiting_since -> joined_at),
--                 each with a 1-based position badge, display_name, avatar_url,
--                 and player_id. N = 2 (singles) or 4 (doubles).
-- Only open_play conversations are supported; returns NULL for competitions.
-- Access: any conversation member.
drop function if exists public.get_community_chat_session_state(uuid);

create or replace function public.get_community_chat_session_state(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conv              public.community_conversations;
  session           public.open_play_sessions;
  players_per_match integer;
  courts_json       jsonb;
  lineup_json       jsonb;
begin
  if not public.is_community_conversation_member(p_conversation_id) then
    raise exception 'This chat is unavailable.';
  end if;

  select * into conv
  from public.community_conversations c
  where c.id = p_conversation_id;

  if conv.event_kind <> 'open_play' then
    return null;
  end if;

  select * into session
  from public.open_play_sessions s
  where s.id = conv.event_id;

  if session.id is null then
    return null;
  end if;

  players_per_match := case when session.match_format = 'singles' then 2 else 4 end;

  -- courts with player avatars
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',      court.id,
      'name',    coalesce(vc.name, 'Court ' || court.court_number),
      'number',  court.court_number,
      'status',  case when live_match.id is null then 'open' else 'playing' end,
      'score',   case
                   when live_match.id is null then null
                   else jsonb_build_array(live_match.home_score, live_match.away_score)
                 end,
      'players', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'name',       coalesce(profile.display_name, op.guest_name, 'Player'),
            'avatar_url', profile.avatar_url,
            'side',       mp.side,
            'position',   mp.position
          )
          order by mp.side, mp.position
        )
        from public.open_play_match_players mp
        join public.open_play_players op on op.id = mp.player_id
        left join public.profiles profile on profile.id = op.user_id
        where mp.match_id = live_match.id
      ), '[]'::jsonb)
    )
    order by court.court_number
  ), '[]'::jsonb) into courts_json
  from public.open_play_courts court
  left join public.courts vc on vc.id = court.venue_court_id
  left join lateral (
    select * from public.open_play_matches m
    where m.session_court_id = court.id and m.status = 'live'
    limit 1
  ) live_match on true
  where court.session_id = session.id;

  -- next fair lineup with avatars
  -- Ordering mirrors assign_fair_play_match: queue_position asc, waiting_since
  -- asc, joined_at asc — so this is exactly what the organizer sees as NEXT
  -- FAIR LINEUP. The 1-based pos becomes the numbered badge chip in the UI.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position',   ranked.pos,
      'name',       coalesce(profile.display_name, op.guest_name, 'Player'),
      'avatar_url', profile.avatar_url,
      'player_id',  op.id
    )
    order by ranked.pos
  ), '[]'::jsonb) into lineup_json
  from (
    select op2.id,
           row_number() over (
             order by op2.queue_position, op2.waiting_since, op2.joined_at
           ) as pos
    from public.open_play_players op2
    where op2.session_id = session.id
      and op2.status = 'waiting'
      and op2.queue_position is not null
      and op2.registration_status = 'approved'
      and op2.checked_in_at is not null
      and op2.departed_at is null
    limit players_per_match
  ) ranked
  join public.open_play_players op on op.id = ranked.id
  left join public.profiles profile on profile.id = op.user_id;

  return jsonb_build_object(
    'session_id',    session.id,
    'match_format',  session.match_format,
    'status',        session.status,
    'courts',        courts_json,
    'next_lineup',   lineup_json,
    'waiting_count', (
      select count(*) from public.open_play_players w
      where w.session_id = session.id
        and w.status = 'waiting'
        and w.queue_position is not null
    )
  );
end;
$$;

revoke all on function public.get_community_chat_session_state(uuid) from public;
grant execute on function public.get_community_chat_session_state(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
