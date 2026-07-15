-- Upgrade for projects that already ran 202607120001 before app_snapshots was removed.
-- This migration is intentionally idempotent and does not recreate existing enum types.

create extension if not exists btree_gist;

drop table if exists public.app_snapshots cascade;
alter table if exists public.open_play_sessions drop column if exists state;

create table if not exists public.open_play_players (
  id text primary key,
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  status text not null default 'waiting' check (status in ('waiting','playing','done')),
  games_played integer not null default 0 check (games_played >= 0),
  queue_position integer check (queue_position >= 0),
  joined_at timestamptz not null default now(),
  check (user_id is not null or guest_name is not null)
);

create table if not exists public.open_play_courts (
  id text primary key,
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  court_number integer not null check (court_number > 0),
  venue_court_id text references public.courts(id),
  unique (session_id, court_number)
);

create table if not exists public.open_play_matches (
  id text primary key,
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  session_court_id text not null references public.open_play_courts(id),
  scorer_player_id text references public.open_play_players(id),
  home_score integer not null default 0 check (home_score >= 0),
  away_score integer not null default 0 check (away_score >= 0),
  winner_side smallint check (winner_side in (0,1)),
  status public.match_status not null default 'live',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.open_play_match_players (
  match_id text not null references public.open_play_matches(id) on delete cascade,
  player_id text not null references public.open_play_players(id),
  side smallint not null check (side in (0,1)),
  position smallint not null check (position in (0,1)),
  primary key (match_id, player_id),
  unique (match_id, side, position)
);

create table if not exists public.open_play_score_events (
  id bigint generated always as identity primary key,
  match_id text not null references public.open_play_matches(id) on delete cascade,
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_no_court_overlap' and conrelid = 'public.bookings'::regclass) then
    alter table public.bookings add constraint bookings_no_court_overlap exclude using gist
      (court_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
      where (status in ('pending', 'confirmed'));
  end if;
end $$;

create or replace function public.owns_open_play(target_session text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.open_play_sessions where id = target_session and organizer_id = auth.uid())
$$;

create or replace function public.create_booking(p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_invite_team boolean default false)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare selected_court public.courts; created public.bookings;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Invalid booking duration'; end if;
  select * into selected_court from public.courts where id = p_court_id and active;
  if not found then raise exception 'Court is unavailable'; end if;
  insert into public.bookings(user_id, venue_id, court_id, starts_at, ends_at, amount, currency, payment_status, status, invite_team)
  values(auth.uid(), selected_court.venue_id, selected_court.id, p_starts_at, p_ends_at,
    selected_court.hourly_price * (extract(epoch from (p_ends_at - p_starts_at)) / 3600), 'PHP', 'pay_at_venue', 'confirmed', p_invite_team)
  returning * into created;
  return created;
end $$;

create or replace function public.review_team_request(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare request_row public.team_join_requests; current_count integer; team_capacity integer;
begin
  select * into request_row from public.team_join_requests where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'Request is no longer pending'; end if;
  if not public.can_manage_team(request_row.team_id) then raise exception 'Team manager permission required'; end if;
  if p_accept then
    select count(*), max(t.capacity) into current_count, team_capacity from public.team_members tm join public.teams t on t.id = tm.team_id where tm.team_id = request_row.team_id;
    if current_count >= team_capacity then raise exception 'Team is full'; end if;
    insert into public.team_members(team_id, user_id, role) values(request_row.team_id, request_row.user_id, 'member') on conflict do nothing;
  end if;
  update public.team_join_requests set status = case when p_accept then 'accepted'::public.request_status else 'declined'::public.request_status end, reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
end $$;

alter table public.open_play_players enable row level security;
alter table public.open_play_courts enable row level security;
alter table public.open_play_matches enable row level security;
alter table public.open_play_match_players enable row level security;
alter table public.open_play_score_events enable row level security;

drop policy if exists "organizers manage open play players" on public.open_play_players;
create policy "organizers manage open play players" on public.open_play_players for all to authenticated using (public.owns_open_play(session_id)) with check (public.owns_open_play(session_id));
drop policy if exists "organizers manage open play courts" on public.open_play_courts;
create policy "organizers manage open play courts" on public.open_play_courts for all to authenticated using (public.owns_open_play(session_id)) with check (public.owns_open_play(session_id));
drop policy if exists "organizers manage open play matches" on public.open_play_matches;
create policy "organizers manage open play matches" on public.open_play_matches for all to authenticated using (public.owns_open_play(session_id)) with check (public.owns_open_play(session_id));
drop policy if exists "organizers manage open play lineups" on public.open_play_match_players;
create policy "organizers manage open play lineups" on public.open_play_match_players for all to authenticated using (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id))) with check (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id)));
drop policy if exists "organizers manage open play scores" on public.open_play_score_events;
create policy "organizers manage open play scores" on public.open_play_score_events for all to authenticated using (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id))) with check (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-images', 'team-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public;

drop policy if exists "team images are public" on storage.objects;
create policy "team images are public" on storage.objects for select using (bucket_id = 'team-images');
drop policy if exists "authenticated users upload team images" on storage.objects;
create policy "authenticated users upload team images" on storage.objects for insert to authenticated with check (bucket_id = 'team-images');
drop policy if exists "authenticated users update team images" on storage.objects;
create policy "authenticated users update team images" on storage.objects for update to authenticated using (bucket_id = 'team-images') with check (bucket_id = 'team-images');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_messages'
  ) then
    alter publication supabase_realtime add table public.team_messages;
  end if;
end $$;
