-- Managed, revocable scoreboard links. Viewers receive only presentation data;
-- tokens never grant access to organizer tables or scoring operations.
begin;

create table public.venue_displays (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  source_kind text not null check (source_kind in ('open_play', 'competition')),
  source_id text not null,
  mode text not null check (mode in ('court', 'all_courts', 'bracket', 'standings')),
  court_id text,
  division_id uuid,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  enabled boolean not null default true,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((mode = 'court') = (court_id is not null)),
  check (source_kind = 'competition' or (mode in ('court', 'all_courts') and division_id is null))
);
create index venue_displays_venue_idx on public.venue_displays(venue_id);
alter table public.venue_displays enable row level security;
revoke all on public.venue_displays from anon, authenticated;
grant select on public.venue_displays to authenticated;
create policy "managers read display settings" on public.venue_displays
for select to authenticated using (public.can_manage_venue(venue_id) or public.is_platform_admin());

create or replace function public.save_venue_display(
  p_id uuid, p_venue_id text, p_name text, p_source_kind text, p_source_id text,
  p_mode text, p_court_id text, p_division_id uuid, p_expected_revision integer
)
returns public.venue_displays
language plpgsql security definer set search_path = '' as $$
declare result public.venue_displays;
begin
  if auth.uid() is null or not (public.can_manage_venue(p_venue_id) or public.is_platform_admin()) then
    raise exception 'Venue manager access required';
  end if;
  if p_source_kind = 'open_play' then
    if not exists(select 1 from public.open_play_sessions where id = p_source_id and venue_id = p_venue_id) then
      raise exception 'Choose an open-play session at this venue';
    end if;
    if p_court_id is not null and not exists(select 1 from public.open_play_courts where id = p_court_id and session_id = p_source_id) then
      raise exception 'Choose a court from this session';
    end if;
  elsif p_source_kind = 'competition' then
    if not exists(select 1 from public.competitions where id::text = p_source_id and venue_id = p_venue_id) then
      raise exception 'Choose a competition at this venue';
    end if;
    if p_court_id is not null and not exists(select 1 from public.courts where id = p_court_id and venue_id = p_venue_id and active) then
      raise exception 'Choose an active court at this venue';
    end if;
    if p_division_id is not null and not exists(select 1 from public.competition_divisions where id = p_division_id and competition_id::text = p_source_id) then
      raise exception 'Choose a division from this competition';
    end if;
    if p_mode in ('bracket', 'standings') and p_division_id is null then raise exception 'Choose a division for this display'; end if;
    if p_mode = 'bracket' and not exists(select 1 from public.competitions where id::text = p_source_id and kind = 'tournament') then
      raise exception 'Bracket displays require a tournament';
    end if;
  else raise exception 'Choose a valid display source';
  end if;
  if p_id is null then
    insert into public.venue_displays(venue_id, name, source_kind, source_id, mode, court_id, division_id)
    values(p_venue_id, btrim(p_name), p_source_kind, p_source_id, p_mode, p_court_id, p_division_id) returning * into result;
  else
    select * into result from public.venue_displays where id = p_id and venue_id = p_venue_id for update;
    if result.id is null then raise exception 'Display not found'; end if;
    if result.revision is distinct from p_expected_revision then raise exception 'Display settings changed. Refresh and try again.'; end if;
    update public.venue_displays set name = btrim(p_name), source_kind = p_source_kind, source_id = p_source_id,
      mode = p_mode, court_id = p_court_id, division_id = p_division_id, revision = revision + 1, updated_at = now()
    where id = p_id returning * into result;
  end if;
  return result;
end;
$$;

create or replace function public.reset_venue_display_link(p_id uuid, p_expected_revision integer, p_disconnect boolean)
returns public.venue_displays
language plpgsql security definer set search_path = '' as $$
declare result public.venue_displays;
begin
  select * into result from public.venue_displays where id = p_id for update;
  if auth.uid() is null or result.id is null or not (public.can_manage_venue(result.venue_id) or public.is_platform_admin()) then
    raise exception 'Venue manager access required';
  end if;
  if result.revision is distinct from p_expected_revision then raise exception 'Display settings changed. Refresh and try again.'; end if;
  if p_disconnect is null then raise exception 'Choose a link action'; end if;
  update public.venue_displays set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    enabled = not p_disconnect, revision = revision + 1, updated_at = now() where id = p_id returning * into result;
  return result;
end;
$$;

create or replace function public.delete_venue_display(p_id uuid, p_expected_revision integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare target public.venue_displays;
begin
  select * into target from public.venue_displays where id = p_id for update;
  if auth.uid() is null or target.id is null or not (public.can_manage_venue(target.venue_id) or public.is_platform_admin()) then
    raise exception 'Venue manager access required';
  end if;
  if target.revision is distinct from p_expected_revision then raise exception 'Display settings changed. Refresh and try again.'; end if;
  delete from public.venue_displays where id = target.id;
end;
$$;

create or replace function public.assign_competition_display_court(p_match_id uuid, p_court_id text, p_expected_court_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare target public.matches; competition public.competitions;
begin
  select * into target from public.matches where id = p_match_id;
  select * into competition from public.competitions where id = target.competition_id for update;
  if auth.uid() is null or competition.id is null or not (public.can_manage_venue(competition.venue_id) or public.is_platform_admin()) then
    raise exception 'Venue manager access required';
  end if;
  select * into target from public.matches where id = p_match_id for update;
  if target.competition_id is distinct from competition.id or target.venue_id is distinct from competition.venue_id then raise exception 'Match venue changed. Refresh and try again.'; end if;
  if target.court_id is distinct from p_expected_court_id then raise exception 'Court assignment changed. Refresh and try again.'; end if;
  if target.status not in ('scheduled','live') or competition.status in ('completed','cancelled') then raise exception 'Only upcoming or live matches can change courts'; end if;
  if p_court_id is not null then
    perform 1 from public.courts where id = p_court_id and venue_id = competition.venue_id and active for update;
    if not found then raise exception 'Choose an active court at this venue'; end if;
    if target.status = 'live' and (exists(select 1 from public.matches where court_id = p_court_id and status = 'live' and id <> target.id)
      or exists(select 1 from public.open_play_matches m join public.open_play_courts c on c.id = m.session_court_id where c.venue_court_id = p_court_id and m.status = 'live')) then
      raise exception 'This court already has a live match';
    end if;
  end if;
  update public.matches set court_id = p_court_id, updated_at = now() where id = target.id;
end;
$$;

create schema if not exists app_private;
-- This helper is callable only by the token-authorized snapshot function.
create or replace function app_private.scoreboard_competition_match(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'status', m.status, 'scheduled_at', m.scheduled_at,
    'home', coalesce(th.name, (select string_agg(coalesce(p.display_name, mp.guest_name, 'Player'), ' + ' order by mp.position) from public.match_participants mp left join public.profiles p on p.id = mp.user_id where mp.match_id = m.id and mp.side = 0), 'Home team'),
    'away', coalesce(ta.name, (select string_agg(coalesce(p.display_name, mp.guest_name, 'Player'), ' + ' order by mp.position) from public.match_participants mp left join public.profiles p on p.id = mp.user_id where mp.match_id = m.id and mp.side = 1), 'Away team'),
    'home_score', case when m.status = 'live' then coalesce(m.resume_state #> '{scores,0}', to_jsonb(g.home_score), '0'::jsonb) else to_jsonb(g.home_score) end,
    'away_score', case when m.status = 'live' then coalesce(m.resume_state #> '{scores,1}', to_jsonb(g.away_score), '0'::jsonb) else to_jsonb(g.away_score) end,
    'server_side', case when m.status = 'live' then m.resume_state -> 'server' end,
    'service_number', case when m.status = 'live' then m.resume_state -> 'serviceNumber' end,
    'paused', case when m.status = 'live' then coalesce(m.resume_state -> 'paused', 'false'::jsonb) else 'false'::jsonb end,
    'game', case when m.status = 'live' and jsonb_typeof(m.resume_state -> 'gameScores') = 'array' then jsonb_array_length(m.resume_state -> 'gameScores') + 1 else coalesce(g.game_number, 1) end,
    'games', coalesce((select jsonb_agg(jsonb_build_object('game_number', game_number, 'home_score', home_score, 'away_score', away_score) order by game_number) from public.match_games where match_id = m.id), '[]'::jsonb)
  ) from public.matches m
  left join public.teams th on th.id = m.team_home_id left join public.teams ta on ta.id = m.team_away_id
  left join lateral (select * from public.match_games where match_id = m.id order by game_number desc limit 1) g on true
  where m.id = p_id;
$$;
revoke all on function app_private.scoreboard_competition_match(uuid) from public, anon, authenticated;

-- Managers may assign matches created by another staff member. Existing player
-- participant/profile policies must not hide the lineup in this management UI.
create or replace function public.get_venue_display_setup(p_venue_id text, p_source_kind text, p_source_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare court_rows jsonb; division_rows jsonb := '[]'; match_rows jsonb := '[]';
begin
  if auth.uid() is null or not (public.can_manage_venue(p_venue_id) or public.is_platform_admin()) then
    raise exception 'Venue manager access required';
  end if;
  if p_source_kind = 'open_play' then
    if not exists(select 1 from public.open_play_sessions where id = p_source_id and venue_id = p_venue_id) then raise exception 'Choose an open-play session at this venue'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(vc.name, 'Court ' || c.court_number)) order by c.court_number), '[]'::jsonb) into court_rows
      from public.open_play_courts c left join public.courts vc on vc.id = c.venue_court_id where c.session_id = p_source_id;
  elsif p_source_kind = 'competition' then
    if not exists(select 1 from public.competitions where id::text = p_source_id and venue_id = p_venue_id) then raise exception 'Choose a competition at this venue'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id), '[]'::jsonb) into court_rows
      from public.courts where venue_id = p_venue_id and active;
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by position, id), '[]'::jsonb) into division_rows
      from public.competition_divisions where competition_id::text = p_source_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'court_id', m.court_id, 'status', m.status,
      'label', (app_private.scoreboard_competition_match(m.id) ->> 'home') || ' vs ' || (app_private.scoreboard_competition_match(m.id) ->> 'away'))
      order by (m.status = 'live') desc, m.scheduled_at nulls last, m.id), '[]'::jsonb) into match_rows
      from public.matches m where m.competition_id::text = p_source_id and m.venue_id = p_venue_id and m.status in ('scheduled','live');
  else raise exception 'Choose a valid display source';
  end if;
  return jsonb_build_object('courts', court_rows, 'divisions', division_rows, 'matches', match_rows);
end;
$$;

create or replace function public.get_scoreboard_display(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  display public.venue_displays;
  event_name text; event_status text; event_kind text;
  court_rows jsonb := '[]'; bracket_rows jsonb := '[]'; standing_rows jsonb := '[]';
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('available', false); end if;
  select * into display from public.venue_displays where token = p_token and enabled;
  if display.id is null then return jsonb_build_object('available', false); end if;

  if display.source_kind = 'open_play' then
    select name, status::text, 'Open play' into event_name, event_status, event_kind
      from public.open_play_sessions where id = display.source_id and venue_id = display.venue_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(vc.name, 'Court ' || c.court_number),
      'match', case when m.id is null then null else jsonb_build_object(
        'id', m.id, 'status', m.status, 'home_score', m.home_score, 'away_score', m.away_score,
        'home', coalesce((select string_agg(coalesce(p.display_name, op.guest_name, 'Player'), ' + ' order by mp.position) from public.open_play_match_players mp join public.open_play_players op on op.id = mp.player_id left join public.profiles p on p.id = op.user_id where mp.match_id = m.id and mp.side = 0), 'Home team'),
        'away', coalesce((select string_agg(coalesce(p.display_name, op.guest_name, 'Player'), ' + ' order by mp.position) from public.open_play_match_players mp join public.open_play_players op on op.id = mp.player_id left join public.profiles p on p.id = op.user_id where mp.match_id = m.id and mp.side = 1), 'Away team'),
        'server_side', m.server_side, 'service_number', m.service_number, 'game', 1, 'games', '[]'::jsonb
      ) end) order by c.court_number), '[]'::jsonb) into court_rows
    from public.open_play_courts c left join public.courts vc on vc.id = c.venue_court_id
    left join lateral (select * from public.open_play_matches where session_court_id = c.id and session_id = display.source_id and status in ('live','scheduled') and event_status not in ('completed','cancelled') order by (status = 'live') desc, started_at desc, id limit 1) m on true
    where c.session_id = display.source_id and (display.mode = 'all_courts' or c.id = display.court_id);
  else
    select name, status, kind into event_name, event_status, event_kind from public.competitions
      where id::text = display.source_id and venue_id = display.venue_id;
    if display.mode in ('court','all_courts') then
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'match', app_private.scoreboard_competition_match(m.id)) order by c.name, c.id), '[]'::jsonb) into court_rows
      from public.courts c
      left join lateral (select id from public.matches where competition_id::text = display.source_id and venue_id = display.venue_id and court_id = c.id
        and (display.division_id is null or competition_division_id = display.division_id) and status in ('live','scheduled')
        and event_status not in ('completed','cancelled') order by (status = 'live') desc, scheduled_at nulls last, created_at, id limit 1) m on true
      where c.venue_id = display.venue_id and c.active and (display.mode = 'all_courts' or c.id = display.court_id);
    elsif display.mode = 'standings' then
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(p.display_name, t.name, 'Player'),
        'played', e.played, 'won', e.won, 'lost', e.lost, 'points', e.standing_points)
        order by e.standing_points desc, e.won desc, (e.points_for - e.points_against) desc, e.seed nulls last, e.id), '[]'::jsonb) into standing_rows
      from public.competition_entries e left join public.profiles p on p.id = e.user_id left join public.teams t on t.id = e.team_id
      where e.competition_id::text = display.source_id and e.competition_division_id = display.division_id and e.status <> 'withdrawn';
    elsif display.mode = 'bracket' then
      select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'round', b.round_number, 'position', b.position,
        'status', b.status, 'home', coalesce(hp.display_name, ht.name, 'TBD'), 'away', coalesce(ap.display_name, at.name, case when b.status = 'bye' then 'BYE' else 'TBD' end),
        'winner_side', case when b.winner_entry_id = b.home_entry_id then 0 when b.winner_entry_id = b.away_entry_id then 1 end,
        'match', app_private.scoreboard_competition_match(b.match_id)) order by b.round_number, b.position), '[]'::jsonb) into bracket_rows
      from public.competition_bracket_matches b
      left join public.competition_entries h on h.id = b.home_entry_id left join public.profiles hp on hp.id = h.user_id left join public.teams ht on ht.id = h.team_id
      left join public.competition_entries a on a.id = b.away_entry_id left join public.profiles ap on ap.id = a.user_id left join public.teams at on at.id = a.team_id
      where b.competition_id::text = display.source_id and b.competition_division_id = display.division_id;
    end if;
  end if;
  if event_name is null then return jsonb_build_object('available', false); end if;
  return jsonb_build_object('available', true, 'fetched_at', now(),
    'display', jsonb_build_object('id', display.id, 'name', display.name, 'mode', display.mode, 'revision', display.revision),
    'event', jsonb_build_object('name', event_name, 'status', event_status, 'kind', event_kind,
      'division', (select name from public.competition_divisions where id = display.division_id and competition_id::text = display.source_id)),
    'courts', court_rows, 'bracket', bracket_rows, 'standings', standing_rows);
end;
$$;

revoke all on function public.save_venue_display(uuid,text,text,text,text,text,text,uuid,integer) from public, anon, authenticated;
revoke all on function public.reset_venue_display_link(uuid,integer,boolean) from public, anon, authenticated;
revoke all on function public.assign_competition_display_court(uuid,text,text) from public, anon, authenticated;
revoke all on function public.delete_venue_display(uuid,integer) from public, anon, authenticated;
revoke all on function public.get_scoreboard_display(text) from public, anon, authenticated;
revoke all on function public.get_venue_display_setup(text,text,text) from public, anon, authenticated;
grant execute on function public.save_venue_display(uuid,text,text,text,text,text,text,uuid,integer) to authenticated;
grant execute on function public.reset_venue_display_link(uuid,integer,boolean) to authenticated;
grant execute on function public.assign_competition_display_court(uuid,text,text) to authenticated;
grant execute on function public.delete_venue_display(uuid,integer) to authenticated;
grant execute on function public.get_scoreboard_display(text) to anon, authenticated;
grant execute on function public.get_venue_display_setup(text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
