-- Professional competition divisions.
-- Preserves every existing competition by creating one default division, then
-- moves capacity, eligibility, standings, and brackets to the division scope.

create table if not exists public.competition_divisions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 100),
  participant_division text not null default 'open'
    check (participant_division in ('open','women','men','mixed')),
  format text not null default 'doubles'
    check (format in ('singles','doubles')),
  skill_category text not null default 'open'
    check (skill_category in ('open','novice','intermediate','advanced')),
  skill_min numeric(3,2),
  skill_max numeric(3,2),
  entry_type text not null default 'player'
    check (entry_type in ('player','team')),
  capacity integer not null check (capacity between 2 and 200),
  fee_amount numeric(10,2) not null default 0 check (fee_amount >= 0),
  fee_basis text not null default 'entry' check (fee_basis in ('entry','player')),
  status text not null default 'registration'
    check (status in ('draft','registration','active','completed','cancelled')),
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (skill_min is null or skill_min between 1 and 5.5),
  check (skill_max is null or skill_max between 1 and 5.5),
  check (skill_min is null or skill_max is null or skill_max >= skill_min),
  unique (competition_id, position),
  unique (competition_id, name)
);

insert into public.competition_divisions (
  competition_id,
  name,
  participant_division,
  format,
  skill_category,
  entry_type,
  capacity,
  status,
  position
)
select
  c.id,
  'Open ' || initcap(case when c.format = 'singles' then 'singles' else 'doubles' end),
  'open',
  case when c.format = 'singles' then 'singles' else 'doubles' end,
  'open',
  case
    when exists (
      select 1 from public.competition_entries e
      where e.competition_id = c.id and e.team_id is not null
    ) then 'team'
    else 'player'
  end,
  greatest(2, least(200, coalesce(c.capacity, 16))),
  case
    when c.status = 'registration' then 'registration'
    when c.status = 'active' then 'active'
    when c.status = 'completed' then 'completed'
    when c.status = 'cancelled' then 'cancelled'
    else 'draft'
  end,
  1
from public.competitions c
where not exists (
  select 1 from public.competition_divisions d where d.competition_id = c.id
);

alter table public.competition_entries
  add column if not exists competition_division_id uuid references public.competition_divisions(id) on delete cascade,
  add column if not exists eligibility_status text not null default 'not_required';

alter table public.competition_entries
  drop constraint if exists competition_entries_eligibility_status_check;
alter table public.competition_entries
  add constraint competition_entries_eligibility_status_check
  check (eligibility_status in ('not_required','pending','approved','rejected'));

update public.competition_entries e
set competition_division_id = (
  select d.id
  from public.competition_divisions d
  where d.competition_id = e.competition_id
  order by d.position
  limit 1
)
where e.competition_division_id is null;

alter table public.competition_entries
  alter column competition_division_id set not null;

alter table public.competition_entries
  drop constraint if exists competition_entries_competition_id_user_id_team_id_key;
alter table public.competition_entries
  add constraint competition_entries_division_entry_key
  unique nulls not distinct (competition_division_id, user_id, team_id);

alter table public.competition_bracket_matches
  add column if not exists competition_division_id uuid references public.competition_divisions(id) on delete cascade;

update public.competition_bracket_matches b
set competition_division_id = (
  select d.id
  from public.competition_divisions d
  where d.competition_id = b.competition_id
  order by d.position
  limit 1
)
where b.competition_division_id is null;

alter table public.competition_bracket_matches
  alter column competition_division_id set not null;

alter table public.competition_bracket_matches
  drop constraint if exists competition_bracket_matches_competition_id_round_number_position_key;
alter table public.competition_bracket_matches
  add constraint competition_bracket_matches_division_round_position_key
  unique (competition_division_id, round_number, position);

alter table public.matches
  add column if not exists competition_division_id uuid references public.competition_divisions(id) on delete set null;

update public.matches m
set competition_division_id = (
  select d.id
  from public.competition_divisions d
  where d.competition_id = m.competition_id
  order by d.position
  limit 1
)
where m.competition_id is not null and m.competition_division_id is null;

create index if not exists competition_divisions_competition_position_idx
  on public.competition_divisions(competition_id, position);
create index if not exists competition_entries_division_standings_idx
  on public.competition_entries(competition_division_id, standing_points desc, won desc);
create index if not exists competition_brackets_division_round_idx
  on public.competition_bracket_matches(competition_division_id, round_number, position);

create or replace function public.validate_competition_division_scope()
returns trigger language plpgsql set search_path = '' as $$
declare expected_competition_id uuid;
begin
  if new.competition_id is null or new.competition_division_id is null then
    raise exception 'Competition and division must be set together';
  end if;

  select d.competition_id into expected_competition_id
  from public.competition_divisions d
  where d.id = new.competition_division_id;

  if expected_competition_id is null or expected_competition_id <> new.competition_id then
    raise exception 'Competition division does not belong to this competition';
  end if;
  return new;
end $$;

drop trigger if exists competition_entries_validate_division_scope on public.competition_entries;
create trigger competition_entries_validate_division_scope
before insert or update of competition_id, competition_division_id
on public.competition_entries
for each row execute function public.validate_competition_division_scope();

drop trigger if exists competition_brackets_validate_division_scope on public.competition_bracket_matches;
create trigger competition_brackets_validate_division_scope
before insert or update of competition_id, competition_division_id
on public.competition_bracket_matches
for each row execute function public.validate_competition_division_scope();

drop trigger if exists competition_matches_validate_division_scope on public.matches;
create trigger competition_matches_validate_division_scope
before insert or update of competition_id, competition_division_id
on public.matches
for each row
when (new.competition_id is not null or new.competition_division_id is not null)
execute function public.validate_competition_division_scope();

create or replace function public.create_competition_with_divisions(
  p_venue_id text,
  p_name text,
  p_kind text,
  p_starts_on date,
  p_ends_on date,
  p_rules text,
  p_visibility text,
  p_divisions jsonb
)
returns public.competitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.competitions;
  division_item record;
  division_name text;
  division_format text;
  participant text;
  skill text;
  entry_kind text;
  division_capacity integer;
  division_fee numeric(10,2);
  division_fee_basis text;
  minimum_skill numeric(3,2);
  maximum_skill numeric(3,2);
  total_capacity integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to create a competition'; end if;
  if p_venue_id is null or not public.can_manage_venue(p_venue_id) then
    raise exception 'Venue management permission required';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 3 and 100 then
    raise exception 'Competition name must be 3 to 100 characters';
  end if;
  if p_kind not in ('league','ladder','season','tournament') then
    raise exception 'Invalid competition type';
  end if;
  if p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception 'Competition dates are invalid';
  end if;
  if p_visibility not in ('private','members','public') then
    raise exception 'Invalid competition visibility';
  end if;
  if jsonb_typeof(p_divisions) <> 'array' or jsonb_array_length(p_divisions) not between 1 and 12 then
    raise exception 'Add between 1 and 12 competition divisions';
  end if;

  for division_item in
    select value, ordinality from jsonb_array_elements(p_divisions) with ordinality
  loop
    division_capacity := (division_item.value->>'capacity')::integer;
    if division_capacity not between 2 and 200 then
      raise exception 'Each division capacity must be between 2 and 200';
    end if;
    total_capacity := total_capacity + division_capacity;
  end loop;
  if total_capacity > 512 then raise exception 'Combined division capacity cannot exceed 512'; end if;

  insert into public.competitions (
    venue_id, organizer_id, name, kind, format, status, starts_on, ends_on,
    capacity, rules, visibility
  )
  values (
    p_venue_id, auth.uid(), trim(p_name), p_kind,
    coalesce(p_divisions->0->>'format', 'doubles'), 'registration',
    p_starts_on, p_ends_on, total_capacity, nullif(trim(coalesce(p_rules, '')), ''),
    p_visibility
  )
  returning * into created;

  for division_item in
    select value, ordinality from jsonb_array_elements(p_divisions) with ordinality
  loop
    division_name := trim(coalesce(division_item.value->>'name', ''));
    division_format := coalesce(division_item.value->>'format', 'doubles');
    participant := coalesce(division_item.value->>'participantDivision', 'open');
    skill := coalesce(division_item.value->>'skillCategory', 'open');
    entry_kind := coalesce(division_item.value->>'entryType', case when division_format = 'singles' then 'player' else 'team' end);
    division_capacity := (division_item.value->>'capacity')::integer;
    division_fee := coalesce((division_item.value->>'feeAmount')::numeric, 0);
    division_fee_basis := coalesce(division_item.value->>'feeBasis', 'entry');

    if char_length(division_name) not between 3 and 100 then
      raise exception 'Every division needs a name between 3 and 100 characters';
    end if;
    if division_format not in ('singles','doubles') then raise exception 'Invalid division format'; end if;
    if participant not in ('open','women','men','mixed') then raise exception 'Invalid participant division'; end if;
    if skill not in ('open','novice','intermediate','advanced') then raise exception 'Invalid skill category'; end if;
    if entry_kind not in ('player','team') then raise exception 'Invalid entry type'; end if;
    if division_fee < 0 then raise exception 'Division fee cannot be negative'; end if;
    if division_fee_basis not in ('entry','player') then raise exception 'Invalid division fee basis'; end if;

    minimum_skill := case skill when 'novice' then 1.0 when 'intermediate' then 2.6 when 'advanced' then 4.0 else null end;
    maximum_skill := case skill when 'novice' then 2.5 when 'intermediate' then 3.9 when 'advanced' then 5.5 else null end;

    insert into public.competition_divisions (
      competition_id, name, participant_division, format, skill_category,
      skill_min, skill_max, entry_type, capacity, fee_amount, fee_basis,
      status, position
    )
    values (
      created.id, division_name, participant, division_format, skill,
      minimum_skill, maximum_skill, entry_kind, division_capacity, division_fee,
      division_fee_basis, 'registration', division_item.ordinality
    );
  end loop;

  return created;
end $$;

create or replace function public.register_for_competition_division(
  p_competition_id uuid,
  p_division_id uuid,
  p_team_id uuid default null
)
returns public.competition_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  competition public.competitions;
  division public.competition_divisions;
  entry public.competition_entries;
  occupied integer;
  player_rating numeric(4,3);
  eligibility text := 'not_required';
begin
  if auth.uid() is null then raise exception 'Sign in to register'; end if;

  select * into competition
  from public.competitions
  where id = p_competition_id
  for update;
  select * into division
  from public.competition_divisions
  where id = p_division_id and competition_id = p_competition_id
  for update;

  if competition.id is null or division.id is null then raise exception 'Competition division not found'; end if;
  if competition.status not in ('registration','active') or division.status <> 'registration' then
    raise exception 'Registration is closed for this division';
  end if;
  if competition.registration_closes_at is not null and competition.registration_closes_at <= now() then
    raise exception 'Registration is closed for this competition';
  end if;

  if division.entry_type = 'player' then
    if p_team_id is not null then raise exception 'This division accepts player entries'; end if;
  else
    if p_team_id is null or not public.can_manage_team(p_team_id) then
      raise exception 'Choose a team you manage for this division';
    end if;
  end if;

  select count(*) into occupied
  from public.competition_entries e
  where e.competition_division_id = division.id
    and e.status in ('registered','active')
    and e.eligibility_status <> 'rejected';
  if occupied >= division.capacity then raise exception 'This division is full'; end if;

  if division.participant_division <> 'open' then
    eligibility := 'pending';
  elsif division.skill_category <> 'open' then
    if division.entry_type = 'player' then
      select r.rating into player_rating
      from public.player_ratings r
      where r.user_id = auth.uid() and r.format = division.format;
      if player_rating is not null
        and player_rating >= division.skill_min
        and player_rating <= division.skill_max then
        eligibility := 'approved';
      else
        eligibility := 'pending';
      end if;
    else
      eligibility := 'pending';
    end if;
  end if;

  insert into public.competition_entries (
    competition_id, competition_division_id, user_id, team_id, eligibility_status
  )
  values (
    competition.id, division.id,
    case when division.entry_type = 'player' then auth.uid() else null end,
    case when division.entry_type = 'team' then p_team_id else null end,
    eligibility
  )
  returning * into entry;

  return entry;
end $$;

create or replace function public.review_competition_entry(
  p_entry_id uuid,
  p_approve boolean
)
returns public.competition_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.competition_entries;
  division_status text;
begin
  select * into entry from public.competition_entries where id = p_entry_id for update;
  if entry.id is null or not public.can_manage_competition(entry.competition_id) then
    raise exception 'Competition manager permission required';
  end if;
  select status into division_status
  from public.competition_divisions
  where id = entry.competition_division_id;
  if division_status <> 'registration' then
    raise exception 'Eligibility review is closed for this division';
  end if;

  update public.competition_entries
  set eligibility_status = case when p_approve then 'approved' else 'rejected' end,
      status = case when p_approve then 'registered' else 'withdrawn' end
  where id = p_entry_id
  returning * into entry;
  return entry;
end $$;

create or replace function public.seed_tournament_division_bracket(
  p_competition_id uuid,
  p_division_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  competition public.competitions;
  division public.competition_divisions;
  entry_count integer;
  bracket_size integer := 1;
  round_count integer := 0;
  round_no integer;
  slot_count integer;
  slot_no integer;
  home_id uuid;
  away_id uuid;
begin
  select * into competition from public.competitions where id = p_competition_id for update;
  select * into division from public.competition_divisions
    where id = p_division_id and competition_id = p_competition_id for update;
  if competition.id is null or competition.kind <> 'tournament'
    or division.id is null or not public.can_manage_competition(p_competition_id) then
    raise exception 'Tournament division manager permission required';
  end if;
  if exists (
    select 1 from public.competition_bracket_matches
    where competition_division_id = p_division_id
  ) then
    raise exception 'This division bracket has already been seeded';
  end if;
  if exists (
    select 1 from public.competition_entries
    where competition_division_id = p_division_id
      and status in ('registered','active')
      and eligibility_status = 'pending'
  ) then
    raise exception 'Resolve pending eligibility reviews before seeding';
  end if;

  select count(*) into entry_count
  from public.competition_entries
  where competition_division_id = p_division_id
    and status in ('registered','active')
    and eligibility_status in ('not_required','approved');
  if entry_count < 2 then raise exception 'At least two eligible entries are required'; end if;

  while bracket_size < entry_count loop bracket_size := bracket_size * 2; end loop;
  slot_count := bracket_size;
  while slot_count > 1 loop
    round_count := round_count + 1;
    slot_count := slot_count / 2;
  end loop;

  for round_no in 1..round_count loop
    slot_count := bracket_size / cast(power(2, round_no) as integer);
    for slot_no in 1..slot_count loop
      home_id := null;
      away_id := null;
      if round_no = 1 then
        select id into home_id
        from public.competition_entries
        where competition_division_id = p_division_id
          and status in ('registered','active')
          and eligibility_status in ('not_required','approved')
        order by seed nulls last, created_at
        offset ((slot_no - 1) * 2) limit 1;

        select id into away_id
        from public.competition_entries
        where competition_division_id = p_division_id
          and status in ('registered','active')
          and eligibility_status in ('not_required','approved')
        order by seed nulls last, created_at
        offset ((slot_no - 1) * 2 + 1) limit 1;
      end if;

      insert into public.competition_bracket_matches (
        competition_id, competition_division_id, round_number, position,
        home_entry_id, away_entry_id, winner_entry_id, status
      )
      values (
        p_competition_id, p_division_id, round_no, slot_no, home_id, away_id,
        case when round_no = 1 and home_id is not null and away_id is null then home_id else null end,
        case
          when round_no = 1 and home_id is not null and away_id is null then 'bye'
          when round_no = 1 and home_id is not null and away_id is not null then 'ready'
          else 'pending'
        end
      );
    end loop;
  end loop;

  update public.competition_divisions set status = 'active', updated_at = now()
  where id = p_division_id;
  update public.competitions set status = 'active', updated_at = now()
  where id = p_competition_id;
  return round_count;
end $$;

create or replace function public.seed_tournament_bracket(p_competition_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare division_id uuid;
begin
  if (select count(*) from public.competition_divisions where competition_id = p_competition_id) <> 1 then
    raise exception 'Choose a tournament division to seed';
  end if;
  select id into division_id from public.competition_divisions where competition_id = p_competition_id;
  return public.seed_tournament_division_bracket(p_competition_id, division_id);
end $$;

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

  if target.mode = 'ranked' then
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

alter table public.competition_divisions enable row level security;

drop policy if exists "published competition divisions are readable" on public.competition_divisions;
create policy "published competition divisions are readable"
on public.competition_divisions for select to authenticated
using (
  exists (
    select 1 from public.competitions c
    where c.id = competition_id
      and (c.visibility = 'public' or public.can_manage_competition(c.id))
  )
);

drop policy if exists "organizers manage competition divisions" on public.competition_divisions;
create policy "organizers manage competition divisions"
on public.competition_divisions for all to authenticated
using (public.can_manage_competition(competition_id))
with check (public.can_manage_competition(competition_id));

drop policy if exists "players register for competition" on public.competition_entries;
drop policy if exists "organizers create competitions" on public.competitions;

revoke all on function public.create_competition_with_divisions(text,text,text,date,date,text,text,jsonb) from public;
grant execute on function public.create_competition_with_divisions(text,text,text,date,date,text,text,jsonb) to authenticated;
revoke all on function public.register_for_competition_division(uuid,uuid,uuid) from public;
grant execute on function public.register_for_competition_division(uuid,uuid,uuid) to authenticated;
revoke all on function public.review_competition_entry(uuid,boolean) from public;
grant execute on function public.review_competition_entry(uuid,boolean) to authenticated;
revoke all on function public.seed_tournament_division_bracket(uuid,uuid) from public;
grant execute on function public.seed_tournament_division_bracket(uuid,uuid) to authenticated;
