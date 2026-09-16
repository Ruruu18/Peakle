-- Competition (tournament/bracket) matches had no working score-entry path:
-- record_competition_match_result required public.can_manage_competition,
-- which only admits venue owners/managers. That meant a venue running many
-- physical courts needed an owner/manager to personally enter every result.
--
-- Open play already solves the same "optional dedicated scorer per court"
-- problem via public.owns_open_play, which also trusts front_desk,
-- court_monitor and scorer staff. This migration adds the same access model
-- for competition results, so any of those roles can record a live bracket
-- match's score from the organizer-web monitor.

create or replace function public.can_score_competition(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.competitions c
    left join public.venue_members membership
      on membership.venue_id = c.venue_id and membership.user_id = auth.uid()
    where c.id = target
      and (
        c.organizer_id = auth.uid()
        or membership.role in ('owner', 'manager', 'front_desk', 'court_monitor', 'scorer')
      )
  )
$$;

revoke all on function public.can_score_competition(uuid) from public;
grant execute on function public.can_score_competition(uuid) to authenticated;

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
    or not public.can_score_competition(target.competition_id) then
    raise exception 'Competition scorer permission required';
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
