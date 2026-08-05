-- Organizer competition operations.
-- Adds safe event/division state changes, official match scheduling and
-- atomic score recording with division standings and bracket progression.

create or replace function public.update_competition_details(
  p_competition_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_visibility text,
  p_rules text default null
)
returns public.competitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.competitions;
begin
  select * into target
  from public.competitions
  where id = p_competition_id
  for update;

  if target.id is null or not public.can_manage_competition(p_competition_id) then
    raise exception 'Competition manager permission required';
  end if;
  if target.status in ('completed','cancelled') then
    raise exception 'A finished competition cannot be edited';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 3 and 100 then
    raise exception 'Competition name must be 3 to 100 characters';
  end if;
  if p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception 'Competition dates are invalid';
  end if;
  if p_visibility not in ('private','members','public') then
    raise exception 'Invalid competition visibility';
  end if;

  update public.competitions
  set name = trim(p_name),
      starts_on = p_starts_on,
      ends_on = p_ends_on,
      visibility = p_visibility,
      rules = nullif(trim(coalesce(p_rules, '')), ''),
      updated_at = now()
  where id = p_competition_id
  returning * into target;

  return target;
end
$$;

create or replace function public.set_competition_status(
  p_competition_id uuid,
  p_status text
)
returns public.competitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.competitions;
begin
  select * into target
  from public.competitions
  where id = p_competition_id
  for update;

  if target.id is null or not public.can_manage_competition(p_competition_id) then
    raise exception 'Competition manager permission required';
  end if;
  if p_status not in ('registration','active','completed','cancelled') then
    raise exception 'Invalid competition status';
  end if;
  if target.status in ('completed','cancelled') then
    raise exception 'This competition is already finished';
  end if;
  if p_status = 'registration' and target.status <> 'draft' then
    raise exception 'Registration cannot be reopened after the competition starts';
  end if;
  if p_status = 'completed' and target.status <> 'active' then
    raise exception 'Start the competition before completing it';
  end if;

  update public.competitions
  set status = p_status,
      updated_at = now()
  where id = p_competition_id
  returning * into target;

  update public.competition_divisions
  set status = case
        when p_status = 'cancelled' then 'cancelled'
        when p_status = 'completed' then 'completed'
        when p_status = 'active' and status = 'registration' then 'active'
        else status
      end,
      updated_at = now()
  where competition_id = p_competition_id
    and status not in ('completed','cancelled');

  return target;
end
$$;

create or replace function public.set_competition_division_status(
  p_division_id uuid,
  p_status text
)
returns public.competition_divisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.competition_divisions;
begin
  select * into target
  from public.competition_divisions
  where id = p_division_id
  for update;

  if target.id is null or not public.can_manage_competition(target.competition_id) then
    raise exception 'Competition manager permission required';
  end if;
  if p_status not in ('active','completed','cancelled') then
    raise exception 'Invalid division status';
  end if;
  if target.status in ('completed','cancelled') then
    raise exception 'This division is already finished';
  end if;
  if p_status = 'completed' and target.status <> 'active' then
    raise exception 'Start the division before completing it';
  end if;

  update public.competition_divisions
  set status = p_status,
      updated_at = now()
  where id = p_division_id
  returning * into target;

  if p_status = 'active' then
    update public.competitions
    set status = 'active', updated_at = now()
    where id = target.competition_id and status = 'registration';
  end if;

  if not exists (
    select 1
    from public.competition_divisions
    where competition_id = target.competition_id
      and status not in ('completed','cancelled')
  ) then
    update public.competitions
    set status = case
          when exists (
            select 1 from public.competition_divisions
            where competition_id = target.competition_id and status = 'completed'
          ) then 'completed'
          else 'cancelled'
        end,
        updated_at = now()
    where id = target.competition_id;
  end if;

  return target;
end
$$;

create or replace function public.update_competition_division_details(
  p_division_id uuid,
  p_name text,
  p_capacity integer,
  p_fee_amount numeric,
  p_fee_basis text
)
returns public.competition_divisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.competition_divisions;
  occupied integer;
begin
  select * into target
  from public.competition_divisions
  where id = p_division_id
  for update;

  if target.id is null or not public.can_manage_competition(target.competition_id) then
    raise exception 'Competition manager permission required';
  end if;
  if target.status in ('completed','cancelled') then
    raise exception 'A finished division cannot be edited';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 3 and 100 then
    raise exception 'Division name must be 3 to 100 characters';
  end if;
  if p_capacity not between 2 and 200 then
    raise exception 'Division capacity must be between 2 and 200';
  end if;
  if p_fee_amount is null or p_fee_amount < 0 then
    raise exception 'Division fee cannot be negative';
  end if;
  if p_fee_basis not in ('entry','player') then
    raise exception 'Invalid division fee basis';
  end if;

  select count(*) into occupied
  from public.competition_entries
  where competition_division_id = p_division_id
    and status in ('registered','active','completed','eliminated')
    and eligibility_status <> 'rejected';
  if p_capacity < occupied then
    raise exception 'Capacity cannot be lower than the current entry count';
  end if;

  update public.competition_divisions
  set name = trim(p_name),
      capacity = p_capacity,
      fee_amount = p_fee_amount,
      fee_basis = p_fee_basis,
      updated_at = now()
  where id = p_division_id
  returning * into target;

  update public.competitions
  set capacity = (
        select sum(capacity)
        from public.competition_divisions
        where competition_id = target.competition_id
      ),
      updated_at = now()
  where id = target.competition_id;

  return target;
end
$$;

create or replace function public.seed_tournament_division_bracket_ready(
  p_competition_id uuid,
  p_division_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  round_count integer;
  current_slot record;
  home_source public.competition_bracket_matches;
  away_source public.competition_bracket_matches;
  resolved_home uuid;
  resolved_away uuid;
begin
  round_count := public.seed_tournament_division_bracket(
    p_competition_id,
    p_division_id
  );

  update public.competition_bracket_matches
  set status = 'bye'
  where competition_division_id = p_division_id
    and round_number = 1
    and home_entry_id is null
    and away_entry_id is null;

  for current_slot in
    select id, round_number, position
    from public.competition_bracket_matches
    where competition_division_id = p_division_id
      and round_number > 1
    order by round_number, position
  loop
    select * into home_source
    from public.competition_bracket_matches
    where competition_division_id = p_division_id
      and round_number = current_slot.round_number - 1
      and position = current_slot.position * 2 - 1;
    select * into away_source
    from public.competition_bracket_matches
    where competition_division_id = p_division_id
      and round_number = current_slot.round_number - 1
      and position = current_slot.position * 2;

    if home_source.status in ('completed','bye')
      and away_source.status in ('completed','bye') then
      resolved_home := home_source.winner_entry_id;
      resolved_away := away_source.winner_entry_id;
      update public.competition_bracket_matches
      set home_entry_id = resolved_home,
          away_entry_id = resolved_away,
          winner_entry_id = case
            when resolved_home is null then resolved_away
            when resolved_away is null then resolved_home
            else null
          end,
          status = case
            when resolved_home is not null and resolved_away is not null then 'ready'
            else 'bye'
          end
      where id = current_slot.id;
    end if;
  end loop;

  return round_count;
end
$$;

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
    division.format, 'casual',
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

  return jsonb_build_object(
    'matchId', target.id,
    'winnerEntryId', winner_id,
    'homeScore', p_home_score,
    'awayScore', p_away_score,
    'final', is_final
  );
end
$$;

revoke all on function public.update_competition_details(uuid,text,date,date,text,text) from public;
grant execute on function public.update_competition_details(uuid,text,date,date,text,text) to authenticated;
revoke all on function public.set_competition_status(uuid,text) from public;
grant execute on function public.set_competition_status(uuid,text) to authenticated;
revoke all on function public.set_competition_division_status(uuid,text) from public;
grant execute on function public.set_competition_division_status(uuid,text) to authenticated;
revoke all on function public.update_competition_division_details(uuid,text,integer,numeric,text) from public;
grant execute on function public.update_competition_division_details(uuid,text,integer,numeric,text) to authenticated;
revoke all on function public.seed_tournament_division_bracket_ready(uuid,uuid) from public;
grant execute on function public.seed_tournament_division_bracket_ready(uuid,uuid) to authenticated;
revoke all on function public.schedule_competition_match(uuid,uuid,uuid,uuid,timestamptz,uuid) from public;
grant execute on function public.schedule_competition_match(uuid,uuid,uuid,uuid,timestamptz,uuid) to authenticated;
revoke all on function public.record_competition_match_result(uuid,integer,integer) from public;
grant execute on function public.record_competition_match_result(uuid,integer,integer) to authenticated;
