-- Public beta: players score matches at any court, so the court a match was
-- played on is stored as free text alongside the optional venue references.
-- Court booking is paused in the client and no longer proves a match happened,
-- so ranked ratings now require a registered player on both sides.

alter table public.matches
  add column if not exists court_label text,
  add column if not exists court_area text;

alter table public.matches drop constraint if exists matches_court_label_length;
alter table public.matches add constraint matches_court_label_length
  check (court_label is null or char_length(btrim(court_label)) between 1 and 80);

alter table public.matches drop constraint if exists matches_court_area_length;
alter table public.matches add constraint matches_court_area_length
  check (court_area is null or char_length(btrim(court_area)) between 1 and 80);

comment on column public.matches.court_label is 'Court the match was played on, as chosen or entered by the scorer.';
comment on column public.matches.court_area is 'Optional neighborhood or city for court_label.';

create or replace function public.confirm_match_result(
  p_match_id uuid,
  p_confirm boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.matches;
  registered_count integer;
  confirmed_count integer;
  disputed_count integer;
  home_wins integer;
  away_wins integer;
  participant record;
  opponent_average numeric;
  before_rating numeric;
  expected numeric;
  actual numeric;
  after_rating numeric;
  rated_sides integer;
begin
  select * into target from public.matches where id = p_match_id for update;
  if target.id is null or target.status <> 'completed' then raise exception 'Completed match not found'; end if;
  if not exists (
    select 1 from public.match_participants
    where match_id = p_match_id and user_id = auth.uid()
  ) then
    raise exception 'Only registered participants can review this result';
  end if;
  if target.verification_status = 'verified' then
    return jsonb_build_object('status','verified','verifiedAt',target.verified_at);
  end if;

  insert into public.match_result_confirmations (
    match_id, user_id, result_revision, decision, note
  )
  values (
    p_match_id, auth.uid(), target.result_revision,
    case when p_confirm then 'confirmed' else 'disputed' end,
    nullif(trim(p_note), '')
  )
  on conflict (match_id, user_id) do update
  set result_revision = excluded.result_revision,
      decision = excluded.decision,
      note = excluded.note,
      decided_at = now();

  select count(distinct user_id) into registered_count
  from public.match_participants
  where match_id = p_match_id and user_id is not null;
  select
    count(*) filter (where decision = 'confirmed'),
    count(*) filter (where decision = 'disputed')
  into confirmed_count, disputed_count
  from public.match_result_confirmations
  where match_id = p_match_id and result_revision = target.result_revision;

  if disputed_count > 0 then
    update public.matches set verification_status = 'disputed' where id = p_match_id;
    return jsonb_build_object(
      'status','disputed','confirmed',confirmed_count,'required',registered_count
    );
  end if;
  if confirmed_count < registered_count then
    update public.matches set verification_status = 'pending' where id = p_match_id;
    return jsonb_build_object(
      'status','pending','confirmed',confirmed_count,'required',registered_count
    );
  end if;

  select
    count(*) filter (where winner_side = 0),
    count(*) filter (where winner_side = 1)
  into home_wins, away_wins
  from public.match_games
  where match_id = p_match_id;
  if home_wins = away_wins then raise exception 'A verified match must have a winner'; end if;

  -- Ratings move only when both sides include a registered player. A lineup
  -- of guest opponents is still recorded and verified, but it cannot be used
  -- to farm rating points without anyone else confirming the score.
  select count(distinct side) into rated_sides
  from public.match_participants
  where match_id = p_match_id and user_id is not null;

  if target.mode = 'ranked' and rated_sides = 2 then
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
      join public.player_ratings r
        on r.user_id = mp.user_id and r.format = target.match_type
      where mp.match_id = p_match_id
        and mp.side <> participant.side
        and mp.user_id is not null;

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
      after_rating := greatest(
        1,
        least(
          5.5,
          before_rating
            + (
              case
                when (
                  select verified_matches from public.player_ratings
                  where user_id = participant.user_id and format = target.match_type
                ) < 10 then 0.32
                else 0.16
              end
            ) * (actual - expected)
        )
      );

      update public.player_ratings
      set rating = after_rating,
          verified_matches = verified_matches + 1,
          wins = wins + (actual = 1)::integer,
          losses = losses + (actual = 0)::integer,
          updated_at = now()
      where user_id = participant.user_id and format = target.match_type;

      insert into public.rating_history (
        user_id, match_id, format, rating_before, rating_after, outcome
      )
      values (
        participant.user_id, p_match_id, target.match_type,
        before_rating, after_rating, actual
      );
    end loop;
  end if;

  if target.competition_id is not null and target.competition_division_id is not null then
    update public.competition_entries entry
    set played = played + 1,
        won = won + case
          when (entry.team_id = target.team_home_id and home_wins > away_wins)
            or (entry.team_id = target.team_away_id and away_wins > home_wins)
            or (
              entry.user_id in (
                select user_id from public.match_participants
                where match_id = p_match_id and side = 0
              ) and home_wins > away_wins
            )
            or (
              entry.user_id in (
                select user_id from public.match_participants
                where match_id = p_match_id and side = 1
              ) and away_wins > home_wins
            ) then 1
          else 0
        end,
        lost = lost + case
          when (entry.team_id = target.team_home_id and home_wins < away_wins)
            or (entry.team_id = target.team_away_id and away_wins < home_wins)
            or (
              entry.user_id in (
                select user_id from public.match_participants
                where match_id = p_match_id and side = 0
              ) and home_wins < away_wins
            )
            or (
              entry.user_id in (
                select user_id from public.match_participants
                where match_id = p_match_id and side = 1
              ) and away_wins < home_wins
            ) then 1
          else 0
        end,
        standing_points = standing_points + case
          when (entry.team_id = target.team_home_id and home_wins > away_wins)
            or (entry.team_id = target.team_away_id and away_wins > home_wins)
            or (
              entry.user_id in (
                select user_id from public.match_participants
                where match_id = p_match_id and side = 0
              ) and home_wins > away_wins
            )
            or (
              entry.user_id in (
                select user_id from public.match_participants
                where match_id = p_match_id and side = 1
              ) and away_wins > home_wins
            ) then 3
          else 0
        end
    where entry.competition_id = target.competition_id
      and entry.competition_division_id = target.competition_division_id
      and (
        entry.team_id in (target.team_home_id, target.team_away_id)
        or entry.user_id in (
          select user_id from public.match_participants where match_id = p_match_id
        )
      );
  end if;

  update public.matches
  set verification_status = 'verified', verified_at = now()
  where id = p_match_id;
  return jsonb_build_object(
    'status','verified','confirmed',confirmed_count,'required',registered_count,
    'verifiedAt',now()
  );
end $$;

revoke all on function public.confirm_match_result(uuid, boolean, text) from public;
grant execute on function public.confirm_match_result(uuid, boolean, text) to authenticated;
