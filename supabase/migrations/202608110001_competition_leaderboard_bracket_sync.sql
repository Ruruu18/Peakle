-- Two gaps in the competition experience:
--
-- 1. Verified competition results never touched player_ratings, so the global
--    Leaderboard was disconnected from actual competition outcomes. Matches
--    created for a competition were tagged mode='casual', which the rating
--    engine (see confirm_match_result) explicitly skips.
--
-- 2. Only match participants (or, since 202608090007, competition managers)
--    could read public.matches / public.match_games. Any other player in the
--    division had no way to see bracket match status or scores, even for a
--    public competition whose bracket rows they can already read.

-- --- 1. Let any player read status/scores for matches of a public (or
-- manageable) competition, matching the existing bracket-read policy. ---
create policy "competition matches are readable"
on public.matches for select to authenticated
using (
  competition_id is not null
  and exists (
    select 1 from public.competitions c
    where c.id = matches.competition_id
      and (c.visibility = 'public' or public.can_manage_competition(c.id))
  )
);

create policy "competition match games are readable"
on public.match_games for select to authenticated
using (
  exists (
    select 1 from public.matches m
    join public.competitions c on c.id = m.competition_id
    where m.id = match_games.match_id
      and (c.visibility = 'public' or public.can_manage_competition(c.id))
  )
);

-- --- 2. Competition matches are official, organizer-confirmed results.
-- Create them as 'ranked' so they are eligible for rating updates. ---
create or replace function public.schedule_competition_match(
  p_competition_id uuid,
  p_division_id uuid,
  p_home_entry_id uuid,
  p_away_entry_id uuid,
  p_scheduled_at timestamptz,
  p_bracket_match_id uuid default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  competition public.competitions;
  division public.competition_divisions;
  home_entry public.competition_entries;
  away_entry public.competition_entries;
  bracket public.competition_bracket_matches;
  created public.matches;
begin
  select * into competition
  from public.competitions
  where id = p_competition_id
  for update;
  select * into division
  from public.competition_divisions
  where id = p_division_id and competition_id = p_competition_id
  for update;
  select * into home_entry
  from public.competition_entries
  where id = p_home_entry_id and competition_division_id = p_division_id;
  select * into away_entry
  from public.competition_entries
  where id = p_away_entry_id and competition_division_id = p_division_id;

  if competition.id is null or division.id is null
    or not public.can_manage_competition(p_competition_id) then
    raise exception 'Competition manager permission required';
  end if;
  if competition.status in ('completed','cancelled')
    or division.status in ('completed','cancelled') then
    raise exception 'This competition division is closed';
  end if;
  if home_entry.id is null or away_entry.id is null
    or home_entry.id = away_entry.id
    or home_entry.status not in ('registered','active')
    or away_entry.status not in ('registered','active')
    or home_entry.eligibility_status not in ('not_required','approved')
    or away_entry.eligibility_status not in ('not_required','approved') then
    raise exception 'Choose two eligible entries from this division';
  end if;
  if p_scheduled_at is null or p_scheduled_at < now() - interval '5 minutes' then
    raise exception 'Choose a current or future match time';
  end if;

  if p_bracket_match_id is not null then
    select * into bracket
    from public.competition_bracket_matches
    where id = p_bracket_match_id
      and competition_id = p_competition_id
      and competition_division_id = p_division_id
    for update;

    if bracket.id is null or bracket.match_id is not null
      or bracket.status not in ('ready','pending') then
      raise exception 'This bracket match is not available';
    end if;
    if bracket.home_entry_id <> p_home_entry_id
      or bracket.away_entry_id <> p_away_entry_id then
      raise exception 'Bracket entries changed; refresh and try again';
    end if;
  end if;

  insert into public.matches (
    created_by, venue_id, team_home_id, team_away_id, match_type, mode,
    visibility, target_score, best_of, win_by_two, status, scheduled_at,
    scorer_id, competition_id, competition_division_id, verification_status
  )
  values (
    auth.uid(), competition.venue_id, home_entry.team_id, away_entry.team_id,
    division.format, 'ranked',
    case when competition.visibility = 'public' then 'public' else 'private' end,
    11, 1, true,
    'scheduled', p_scheduled_at, auth.uid(), p_competition_id, p_division_id,
    'unverified'
  )
  returning * into created;

  if home_entry.user_id is not null then
    insert into public.match_participants(match_id, user_id, side, position)
    values (created.id, home_entry.user_id, 0, 0);
  end if;
  if away_entry.user_id is not null then
    insert into public.match_participants(match_id, user_id, side, position)
    values (created.id, away_entry.user_id, 1, 0);
  end if;

  if bracket.id is not null then
    update public.competition_bracket_matches
    set match_id = created.id,
        scheduled_at = p_scheduled_at,
        status = 'ready'
    where id = bracket.id;
  end if;

  update public.competition_entries
  set status = 'active'
  where id in (home_entry.id, away_entry.id) and status = 'registered';
  update public.competition_divisions
  set status = 'active', updated_at = now()
  where id = p_division_id and status = 'registration';
  update public.competitions
  set status = 'active', updated_at = now()
  where id = p_competition_id and status = 'registration';

  return created;
end
$$;

revoke all on function public.schedule_competition_match(uuid,uuid,uuid,uuid,timestamptz,uuid) from public;
grant execute on function public.schedule_competition_match(uuid,uuid,uuid,uuid,timestamptz,uuid) to authenticated;

-- Shared ELO update, extracted from confirm_match_result so competition
-- results can apply the same rating math without duplicating it inline.
create or replace function public.apply_verified_match_rating(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.matches;
  home_wins integer;
  away_wins integer;
  participant record;
  opponent_average numeric;
  before_rating numeric;
  expected numeric;
  actual numeric;
  after_rating numeric;
begin
  select * into target from public.matches where id = p_match_id for update;
  if target.id is null or target.mode <> 'ranked' then
    return;
  end if;

  select count(*) filter (where winner_side = 0), count(*) filter (where winner_side = 1)
    into home_wins, away_wins
  from public.match_games
  where match_id = p_match_id;
  if home_wins is null or home_wins = away_wins then
    return;
  end if;

  insert into public.player_ratings(user_id, format)
  select distinct user_id, target.match_type
  from public.match_participants
  where match_id = p_match_id and user_id is not null
  on conflict do nothing;

  for participant in
    select user_id, side
    from public.match_participants
    where match_id = p_match_id and user_id is not null
  loop
    select coalesce(avg(r.rating), 3.0) into opponent_average
    from public.match_participants mp
    join public.player_ratings r on r.user_id = mp.user_id and r.format = target.match_type
    where mp.match_id = p_match_id and mp.side <> participant.side and mp.user_id is not null;

    select rating into before_rating
    from public.player_ratings
    where user_id = participant.user_id and format = target.match_type
    for update;

    expected := 1 / (1 + power(10::numeric, (opponent_average - before_rating) / 0.8));
    actual := case
      when (participant.side = 0 and home_wins > away_wins)
        or (participant.side = 1 and away_wins > home_wins) then 1
      else 0
    end;
    after_rating := greatest(1, least(5.5, before_rating + (
      case
        when (select verified_matches from public.player_ratings where user_id = participant.user_id and format = target.match_type) < 10
        then 0.32 else 0.16
      end
    ) * (actual - expected)));

    update public.player_ratings
    set rating = after_rating,
        verified_matches = verified_matches + 1,
        wins = wins + (actual = 1)::integer,
        losses = losses + (actual = 0)::integer,
        updated_at = now()
    where user_id = participant.user_id and format = target.match_type;

    insert into public.rating_history(user_id, match_id, format, rating_before, rating_after, outcome)
    values (participant.user_id, p_match_id, target.match_type, before_rating, after_rating, actual);
  end loop;
end
$$;

revoke all on function public.apply_verified_match_rating(uuid) from public;
grant execute on function public.apply_verified_match_rating(uuid) to authenticated;

create or replace function public.record_competition_match_result(
  p_match_id uuid,
  p_home_score integer,
  p_away_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.matches;
  home_entry public.competition_entries;
  away_entry public.competition_entries;
  winner_id uuid;
  loser_id uuid;
  winner_side smallint;
  bracket public.competition_bracket_matches;
  next_slot public.competition_bracket_matches;
  is_final boolean := false;
begin
  select * into target
  from public.matches
  where id = p_match_id
  for update;

  if target.id is null or target.competition_id is null
    or target.competition_division_id is null
    or not public.can_manage_competition(target.competition_id) then
    raise exception 'Competition manager permission required';
  end if;
  if target.status = 'completed' then
    raise exception 'This result has already been recorded';
  end if;
  if target.status = 'cancelled' then
    raise exception 'A cancelled match cannot receive a result';
  end if;
  if p_home_score is null or p_away_score is null
    or p_home_score < 0 or p_away_score < 0
    or p_home_score = p_away_score then
    raise exception 'Enter two valid scores with one winner';
  end if;

  select * into home_entry
  from public.competition_entries
  where competition_division_id = target.competition_division_id
    and (
      (target.team_home_id is not null and team_id = target.team_home_id)
      or (
        target.team_home_id is null and user_id in (
          select user_id from public.match_participants
          where match_id = target.id and side = 0
        )
      )
    )
  limit 1;
  select * into away_entry
  from public.competition_entries
  where competition_division_id = target.competition_division_id
    and (
      (target.team_away_id is not null and team_id = target.team_away_id)
      or (
        target.team_away_id is null and user_id in (
          select user_id from public.match_participants
          where match_id = target.id and side = 1
        )
      )
    )
  limit 1;

  if home_entry.id is null or away_entry.id is null then
    raise exception 'Competition entries could not be resolved';
  end if;

  winner_side := case when p_home_score > p_away_score then 0 else 1 end;
  winner_id := case when winner_side = 0 then home_entry.id else away_entry.id end;
  loser_id := case when winner_side = 0 then away_entry.id else home_entry.id end;

  insert into public.match_games (
    match_id, game_number, home_score, away_score, winner_side, started_at, ended_at
  )
  values (
    target.id, 1, p_home_score, p_away_score, winner_side,
    coalesce(target.started_at, now()), now()
  )
  on conflict (match_id, game_number) do update
  set home_score = excluded.home_score,
      away_score = excluded.away_score,
      winner_side = excluded.winner_side,
      ended_at = excluded.ended_at;

  update public.matches
  set status = 'completed',
      started_at = coalesce(started_at, now()),
      ended_at = now(),
      verification_status = 'verified',
      verified_at = now(),
      updated_at = now()
  where id = target.id;

  update public.competition_entries
  set played = played + 1,
      won = won + (id = winner_id)::integer,
      lost = lost + (id = loser_id)::integer,
      points_for = points_for + case when id = home_entry.id then p_home_score else p_away_score end,
      points_against = points_against + case when id = home_entry.id then p_away_score else p_home_score end,
      standing_points = standing_points + case when id = winner_id then 3 else 0 end
  where id in (home_entry.id, away_entry.id);

  select * into bracket
  from public.competition_bracket_matches
  where match_id = target.id
  for update;

  if bracket.id is not null then
    update public.competition_bracket_matches
    set winner_entry_id = winner_id,
        status = 'completed'
    where id = bracket.id;

    select * into next_slot
    from public.competition_bracket_matches
    where competition_division_id = bracket.competition_division_id
      and round_number = bracket.round_number + 1
      and position = ((bracket.position + 1) / 2)
    for update;

    if next_slot.id is null then
      is_final := true;
      update public.competition_entries
      set status = case when id = winner_id then 'completed' else 'eliminated' end
      where competition_division_id = target.competition_division_id
        and id in (winner_id, loser_id);
      update public.competition_divisions
      set status = 'completed', updated_at = now()
      where id = target.competition_division_id;
    else
      update public.competition_bracket_matches
      set home_entry_id = case when mod(bracket.position, 2) = 1 then winner_id else home_entry_id end,
          away_entry_id = case when mod(bracket.position, 2) = 0 then winner_id else away_entry_id end,
          status = case
            when (
              case when mod(bracket.position, 2) = 1 then winner_id else home_entry_id end
            ) is not null
            and (
              case when mod(bracket.position, 2) = 0 then winner_id else away_entry_id end
            ) is not null then 'ready'
            else 'pending'
          end
      where id = next_slot.id;

      update public.competition_entries
      set status = 'eliminated'
      where id = loser_id;
    end if;
  end if;

  if not exists (
    select 1
    from public.competition_divisions
    where competition_id = target.competition_id
      and status not in ('completed','cancelled')
  ) then
    update public.competitions
    set status = 'completed', updated_at = now()
    where id = target.competition_id;
  end if;

  perform public.apply_verified_match_rating(target.id);

  return jsonb_build_object(
    'matchId', target.id,
    'winnerEntryId', winner_id,
    'homeScore', p_home_score,
    'awayScore', p_away_score,
    'final', is_final
  );
end
$$;

revoke all on function public.record_competition_match_result(uuid,integer,integer) from public;
grant execute on function public.record_competition_match_result(uuid,integer,integer) to authenticated;
