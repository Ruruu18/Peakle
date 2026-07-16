-- Peakle's production data model. Run with `supabase db push` or paste into the
-- Supabase SQL editor. All client-facing tables use row-level security.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.booking_status as enum ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
create type public.team_role as enum ('creator', 'admin', 'co_admin', 'member');
create type public.request_status as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.match_status as enum ('scheduled', 'live', 'completed', 'cancelled');
create type public.session_status as enum ('draft', 'active', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  avatar_url text,
  home_area text,
  skill_rating numeric(2,1) check (skill_rating between 1 and 5.5),
  play_preference text check (play_preference in ('Singles', 'Doubles', 'Both')),
  app_mode text not null default 'player' check (app_mode in ('player', 'organizer')),
  notification_preferences jsonb not null default '{"squad":true,"reminders":true,"calendar":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.venues (
  id text primary key,
  name text not null,
  area text not null,
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  description text,
  venue_type text not null check (venue_type in ('Indoor', 'Outdoor', 'Mixed')),
  opens_at time,
  closes_at time,
  amenities text[] not null default '{}',
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courts (
  id text primary key,
  venue_id text not null references public.venues(id) on delete cascade,
  name text not null,
  environment text not null,
  surface text not null,
  hourly_price numeric(10,2) not null check (hourly_price >= 0),
  active boolean not null default true,
  unique (venue_id, name)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  venue_id text not null references public.venues(id),
  court_id text not null references public.courts(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'PHP',
  payment_status text not null default 'pay_at_venue',
  status public.booking_status not null default 'confirmed',
  invite_team boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index bookings_user_start_idx on public.bookings(user_id, starts_at desc);
create index bookings_court_start_idx on public.bookings(court_id, starts_at);
alter table public.bookings add constraint bookings_no_court_overlap exclude using gist
  (court_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('pending', 'confirmed'));

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 2 and 80),
  tag text not null check (char_length(tag) between 2 and 6),
  motto text,
  about text,
  location text,
  latitude double precision,
  longitude double precision,
  skill_level text,
  capacity integer not null default 16 check (capacity between 2 and 100),
  image_url text,
  color text,
  is_discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.team_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members(user_id);

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  image_url text,
  created_at timestamptz not null default now(),
  check (body is not null or image_url is not null)
);
create index team_messages_team_created_idx on public.team_messages(team_id, created_at desc);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  venue_id text references public.venues(id),
  court_id text references public.courts(id),
  team_home_id uuid references public.teams(id),
  team_away_id uuid references public.teams(id),
  match_type text not null default 'doubles' check (match_type in ('singles', 'doubles')),
  mode text not null default 'casual' check (mode in ('casual', 'ranked')),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  target_score integer not null default 11 check (target_score > 0),
  best_of integer not null default 3 check (best_of in (1,3,5,7)),
  win_by_two boolean not null default true,
  status public.match_status not null default 'scheduled',
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  scorer_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_participants (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  side smallint not null check (side in (0,1)),
  position smallint not null default 0,
  primary key (match_id, side, position),
  check (user_id is not null or guest_name is not null)
);

create table public.match_games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  game_number integer not null check (game_number > 0),
  home_score integer not null default 0 check (home_score >= 0),
  away_score integer not null default 0 check (away_score >= 0),
  winner_side smallint check (winner_side in (0,1)),
  started_at timestamptz default now(),
  ended_at timestamptz,
  unique (match_id, game_number)
);

create table public.score_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.match_games(id) on delete cascade,
  scoring_side smallint not null check (scoring_side in (0,1)),
  home_score integer not null,
  away_score integer not null,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.open_play_sessions (
  id text primary key,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  venue_id text references public.venues(id),
  name text not null default 'Open play',
  status public.session_status not null default 'active',
  court_count integer not null default 1 check (court_count between 1 and 50),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index open_play_organizer_idx on public.open_play_sessions(organizer_id, updated_at desc);

create table public.open_play_players (
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

create table public.open_play_courts (
  id text primary key,
  session_id text not null references public.open_play_sessions(id) on delete cascade,
  court_number integer not null check (court_number > 0),
  venue_court_id text references public.courts(id),
  unique (session_id, court_number)
);

create table public.open_play_matches (
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

create table public.open_play_match_players (
  match_id text not null references public.open_play_matches(id) on delete cascade,
  player_id text not null references public.open_play_players(id),
  side smallint not null check (side in (0,1)),
  position smallint not null check (position in (0,1)),
  primary key (match_id, player_id),
  unique (match_id, side, position)
);

create table public.open_play_score_events (
  id bigint generated always as identity primary key,
  match_id text not null references public.open_play_matches(id) on delete cascade,
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger venues_updated before update on public.venues for each row execute function public.set_updated_at();
create trigger bookings_updated before update on public.bookings for each row execute function public.set_updated_at();
create trigger teams_updated before update on public.teams for each row execute function public.set_updated_at();
create trigger matches_updated before update on public.matches for each row execute function public.set_updated_at();
create trigger open_play_updated before update on public.open_play_sessions for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url, home_area, skill_rating, play_preference)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'home_area',
    nullif(new.raw_user_meta_data ->> 'skill_rating', '')::numeric,
    nullif(new.raw_user_meta_data ->> 'play_preference', '')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_team_member(target_team uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.team_members where team_id = target_team and user_id = auth.uid())
$$;
create or replace function public.can_manage_team(target_team uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.team_members where team_id = target_team and user_id = auth.uid() and role in ('creator','admin','co_admin'))
$$;
create or replace function public.can_access_match(target_match uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.matches m where m.id = target_match and (m.created_by = auth.uid() or m.scorer_id = auth.uid())
  ) or exists(
    select 1 from public.match_participants p where p.match_id = target_match and p.user_id = auth.uid()
  )
$$;
create or replace function public.add_team_creator() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.team_members(team_id, user_id, role) values (new.id, new.creator_id, 'creator');
  return new;
end $$;
create trigger on_team_created after insert on public.teams for each row execute function public.add_team_creator();
create or replace function public.owns_open_play(target_session text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.open_play_sessions where id = target_session and organizer_id = auth.uid())
$$;

create or replace function public.create_booking(p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_invite_team boolean default false)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare selected_court public.courts; created public.bookings;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Invalid booking duration'; end if;
  if p_starts_at <= now() then raise exception 'Choose a future booking time'; end if;
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

alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.courts enable row level security;
alter table public.bookings enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_join_requests enable row level security;
alter table public.team_messages enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.match_games enable row level security;
alter table public.score_events enable row level security;
alter table public.open_play_sessions enable row level security;
alter table public.open_play_players enable row level security;
alter table public.open_play_courts enable row level security;
alter table public.open_play_matches enable row level security;
alter table public.open_play_match_players enable row level security;
alter table public.open_play_score_events enable row level security;

create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "venues are publicly readable" on public.venues for select using (active);
create policy "courts are publicly readable" on public.courts for select using (active);
create policy "users read own bookings" on public.bookings for select to authenticated using (user_id = auth.uid());
create policy "users create own bookings" on public.bookings for insert to authenticated with check (user_id = auth.uid());
create policy "users update own bookings" on public.bookings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "discoverable teams or members can read" on public.teams for select to authenticated using (is_discoverable or public.is_team_member(id));
create policy "signed-in users create teams" on public.teams for insert to authenticated with check (creator_id = auth.uid());
create policy "team managers update teams" on public.teams for update to authenticated using (public.can_manage_team(id));
create policy "team members are readable" on public.team_members for select to authenticated using (true);
create policy "team managers manage members" on public.team_members for all to authenticated using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
create policy "users read own or managed requests" on public.team_join_requests for select to authenticated using (user_id = auth.uid() or public.can_manage_team(team_id));
create policy "users create own requests" on public.team_join_requests for insert to authenticated with check (user_id = auth.uid());
create policy "team managers review requests" on public.team_join_requests for update to authenticated using (public.can_manage_team(team_id));
create policy "members read messages" on public.team_messages for select to authenticated using (public.is_team_member(team_id));
create policy "members send messages" on public.team_messages for insert to authenticated with check (sender_id = auth.uid() and public.is_team_member(team_id));
create policy "participants read matches" on public.matches for select to authenticated using (public.can_access_match(id));
create policy "users create matches" on public.matches for insert to authenticated with check (created_by = auth.uid());
create policy "creator or scorer updates match" on public.matches for update to authenticated using (created_by = auth.uid() or scorer_id = auth.uid());
create policy "participants follow parent match" on public.match_participants for select to authenticated using (public.can_access_match(match_id));
create policy "creator manages participants" on public.match_participants for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and m.created_by = auth.uid()));
create policy "games follow parent match" on public.match_games for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and (m.created_by = auth.uid() or m.scorer_id = auth.uid()))) with check (exists (select 1 from public.matches m where m.id = match_id and (m.created_by = auth.uid() or m.scorer_id = auth.uid())));
create policy "score events follow game" on public.score_events for all to authenticated using (exists (select 1 from public.match_games g join public.matches m on m.id = g.match_id where g.id = game_id and (m.created_by = auth.uid() or m.scorer_id = auth.uid()))) with check (recorded_by = auth.uid());
create policy "organizers own sessions" on public.open_play_sessions for all to authenticated using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());
create policy "organizers manage open play players" on public.open_play_players for all to authenticated using (public.owns_open_play(session_id)) with check (public.owns_open_play(session_id));
create policy "organizers manage open play courts" on public.open_play_courts for all to authenticated using (public.owns_open_play(session_id)) with check (public.owns_open_play(session_id));
create policy "organizers manage open play matches" on public.open_play_matches for all to authenticated using (public.owns_open_play(session_id)) with check (public.owns_open_play(session_id));
create policy "organizers manage open play lineups" on public.open_play_match_players for all to authenticated using (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id))) with check (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id)));
create policy "organizers manage open play scores" on public.open_play_score_events for all to authenticated using (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id))) with check (exists(select 1 from public.open_play_matches m where m.id = match_id and public.owns_open_play(m.session_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-images', 'team-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public;
create policy "team images are public" on storage.objects for select using (bucket_id = 'team-images');
create policy "authenticated users upload team images" on storage.objects for insert to authenticated with check (bucket_id = 'team-images');
create policy "authenticated users update team images" on storage.objects for update to authenticated using (bucket_id = 'team-images');

alter publication supabase_realtime add table public.team_messages;
