-- Priority 6: pickleball ratings, verified results, matching, programs,
-- competition, memberships, recurring schedules, and venue analytics.

alter table public.profiles
  add column if not exists profile_visibility text not null default 'members',
  add column if not exists availability_visibility text not null default 'matches',
  add column if not exists matching_enabled boolean not null default true;

alter table public.profiles drop constraint if exists profiles_profile_visibility_check;
alter table public.profiles add constraint profiles_profile_visibility_check check (profile_visibility in ('private','members','public'));
alter table public.profiles drop constraint if exists profiles_availability_visibility_check;
alter table public.profiles add constraint profiles_availability_visibility_check check (availability_visibility in ('private','matches','public'));

alter table public.matches
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists competition_id uuid,
  add column if not exists result_revision integer not null default 1;

alter table public.matches drop constraint if exists matches_verification_status_check;
alter table public.matches add constraint matches_verification_status_check check (verification_status in ('unverified','pending','verified','disputed'));

create table if not exists public.player_ratings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  format text not null check (format in ('singles','doubles')),
  rating numeric(4,3) not null default 3.000 check (rating between 1 and 5.5),
  verified_matches integer not null default 0 check (verified_matches >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, format)
);

create table if not exists public.rating_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  format text not null check (format in ('singles','doubles')),
  rating_before numeric(4,3) not null,
  rating_after numeric(4,3) not null,
  outcome numeric(2,1) not null check (outcome in (0, 0.5, 1)),
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create table if not exists public.match_result_confirmations (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  result_revision integer not null,
  decision text not null check (decision in ('confirmed','disputed')),
  note text,
  decided_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table if not exists public.player_availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  area text,
  formats text[] not null default array['doubles']::text[],
  recurring_rule jsonb,
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (formats <@ array['singles','doubles']::text[])
);
create index if not exists player_availability_user_start_idx on public.player_availability(user_id, starts_at);

create table if not exists public.matchmaking_posts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  kind text not null check (kind in ('partner','opponent','substitute')),
  format text not null check (format in ('singles','doubles','team')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  area text not null,
  venue_id text references public.venues(id) on delete set null,
  minimum_rating numeric(3,2),
  maximum_rating numeric(3,2),
  note text,
  status text not null default 'open' check (status in ('open','matched','closed','expired')),
  matched_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (minimum_rating is null or minimum_rating between 1 and 5.5),
  check (maximum_rating is null or maximum_rating between 1 and 5.5),
  check (minimum_rating is null or maximum_rating is null or maximum_rating >= minimum_rating)
);
create index if not exists matchmaking_open_start_idx on public.matchmaking_posts(status, starts_at);

create table if not exists public.team_challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_team_id uuid not null references public.teams(id) on delete cascade,
  challenged_team_id uuid not null references public.teams(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  venue_id text references public.venues(id) on delete set null,
  format text not null default 'doubles' check (format in ('singles','doubles','mixed')),
  privacy text not null default 'private' check (privacy in ('private','members','public')),
  note text,
  status text not null default 'pending' check (status in ('pending','accepted','declined','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (challenger_team_id <> challenged_team_id)
);

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  venue_id text references public.venues(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 100),
  kind text not null check (kind in ('league','ladder','season','tournament')),
  format text not null default 'doubles' check (format in ('singles','doubles','mixed','team')),
  status text not null default 'draft' check (status in ('draft','registration','active','completed','cancelled')),
  starts_on date not null,
  ends_on date,
  registration_closes_at timestamptz,
  capacity integer check (capacity between 2 and 512),
  rules text,
  visibility text not null default 'public' check (visibility in ('private','members','public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

alter table public.matches
  drop constraint if exists matches_competition_id_fkey;
alter table public.matches
  add constraint matches_competition_id_fkey foreign key (competition_id) references public.competitions(id) on delete set null;

create table if not exists public.competition_entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  seed integer,
  status text not null default 'registered' check (status in ('registered','active','withdrawn','eliminated','completed')),
  played integer not null default 0,
  won integer not null default 0,
  lost integer not null default 0,
  points_for integer not null default 0,
  points_against integer not null default 0,
  standing_points integer not null default 0,
  created_at timestamptz not null default now(),
  check ((user_id is not null)::integer + (team_id is not null)::integer = 1),
  unique nulls not distinct (competition_id, user_id, team_id)
);

create table if not exists public.competition_bracket_matches (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  position integer not null check (position > 0),
  home_entry_id uuid references public.competition_entries(id) on delete set null,
  away_entry_id uuid references public.competition_entries(id) on delete set null,
  winner_entry_id uuid references public.competition_entries(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','ready','live','completed','bye')),
  scheduled_at timestamptz,
  unique (competition_id, round_number, position)
);

create table if not exists public.venue_programs (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 3 and 100),
  kind text not null check (kind in ('clinic','coaching','open_play','camp')),
  skill_division text not null default 'all' check (skill_division in ('beginner','intermediate','advanced','all')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurrence_rule jsonb,
  capacity integer not null check (capacity between 1 and 200),
  price numeric(10,2) not null default 0 check (price >= 0),
  registration_status text not null default 'open' check (registration_status in ('draft','open','closed','cancelled')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.program_registrations (
  program_id uuid not null references public.venue_programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered','waitlisted','attended','cancelled','no_show')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (program_id, user_id)
);

create table if not exists public.membership_products (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('membership','court_package','session_package','credit_pack')),
  price numeric(10,2) not null check (price >= 0),
  credits integer not null default 0 check (credits >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  validity_days integer not null default 30 check (validity_days between 1 and 730),
  active boolean not null default true,
  terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_memberships (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.membership_products(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('pending','active','paused','expired','cancelled')),
  credits_remaining integer not null default 0 check (credits_remaining >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (product_id, user_id, starts_at)
);

create table if not exists public.membership_credit_ledger (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.player_memberships(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.can_manage_competition(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.competitions c
    where c.id = target and (c.organizer_id = auth.uid() or (c.venue_id is not null and public.can_manage_venue(c.venue_id)))
  )
$$;

create or replace function public.shares_team_with(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.team_members mine join public.team_members teammate on teammate.team_id=mine.team_id where mine.user_id=auth.uid() and teammate.user_id=target_user)
$$;

create or replace function public.confirm_match_result(p_match_id uuid, p_confirm boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  if not exists (select 1 from public.match_participants where match_id = p_match_id and user_id = auth.uid()) then raise exception 'Only registered participants can review this result'; end if;
  if target.verification_status = 'verified' then return jsonb_build_object('status','verified','verifiedAt',target.verified_at); end if;

  insert into public.match_result_confirmations(match_id,user_id,result_revision,decision,note)
  values (p_match_id,auth.uid(),target.result_revision,case when p_confirm then 'confirmed' else 'disputed' end,nullif(trim(p_note),''))
  on conflict (match_id,user_id) do update set result_revision=excluded.result_revision, decision=excluded.decision, note=excluded.note, decided_at=now();

  select count(distinct user_id) into registered_count from public.match_participants where match_id=p_match_id and user_id is not null;
  select count(*) filter (where decision='confirmed'), count(*) filter (where decision='disputed')
    into confirmed_count, disputed_count from public.match_result_confirmations where match_id=p_match_id and result_revision=target.result_revision;
  if disputed_count > 0 then
    update public.matches set verification_status='disputed' where id=p_match_id;
    return jsonb_build_object('status','disputed','confirmed',confirmed_count,'required',registered_count);
  end if;
  if confirmed_count < registered_count then
    update public.matches set verification_status='pending' where id=p_match_id;
    return jsonb_build_object('status','pending','confirmed',confirmed_count,'required',registered_count);
  end if;

  select count(*) filter (where winner_side=0), count(*) filter (where winner_side=1)
    into home_wins, away_wins from public.match_games where match_id=p_match_id;
  if home_wins = away_wins then raise exception 'A verified match must have a winner'; end if;

  if target.mode = 'ranked' then
    insert into public.player_ratings(user_id,format)
    select distinct user_id,target.match_type from public.match_participants where match_id=p_match_id and user_id is not null
    on conflict do nothing;

    for participant in select user_id,side from public.match_participants where match_id=p_match_id and user_id is not null loop
      select coalesce(avg(r.rating),3.0) into opponent_average
      from public.match_participants mp join public.player_ratings r on r.user_id=mp.user_id and r.format=target.match_type
      where mp.match_id=p_match_id and mp.side<>participant.side and mp.user_id is not null;
      select rating into before_rating from public.player_ratings where user_id=participant.user_id and format=target.match_type for update;
      expected := 1 / (1 + power(10::numeric,(opponent_average-before_rating)/0.8));
      actual := case when (participant.side=0 and home_wins>away_wins) or (participant.side=1 and away_wins>home_wins) then 1 else 0 end;
      after_rating := greatest(1,least(5.5,before_rating + (case when (select verified_matches from public.player_ratings where user_id=participant.user_id and format=target.match_type)<10 then 0.32 else 0.16 end)*(actual-expected)));
      update public.player_ratings set rating=after_rating, verified_matches=verified_matches+1, wins=wins+(actual=1)::integer, losses=losses+(actual=0)::integer, updated_at=now() where user_id=participant.user_id and format=target.match_type;
      insert into public.rating_history(user_id,match_id,format,rating_before,rating_after,outcome) values(participant.user_id,p_match_id,target.match_type,before_rating,after_rating,actual);
    end loop;
  end if;

  if target.competition_id is not null then
    update public.competition_entries entry set
      played=played+1,
      won=won+case when (entry.team_id=target.team_home_id and home_wins>away_wins) or (entry.team_id=target.team_away_id and away_wins>home_wins) or (entry.user_id in (select user_id from public.match_participants where match_id=p_match_id and side=0) and home_wins>away_wins) or (entry.user_id in (select user_id from public.match_participants where match_id=p_match_id and side=1) and away_wins>home_wins) then 1 else 0 end,
      lost=lost+case when (entry.team_id=target.team_home_id and home_wins<away_wins) or (entry.team_id=target.team_away_id and away_wins<home_wins) or (entry.user_id in (select user_id from public.match_participants where match_id=p_match_id and side=0) and home_wins<away_wins) or (entry.user_id in (select user_id from public.match_participants where match_id=p_match_id and side=1) and away_wins<home_wins) then 1 else 0 end,
      standing_points=standing_points+case when (entry.team_id=target.team_home_id and home_wins>away_wins) or (entry.team_id=target.team_away_id and away_wins>home_wins) or (entry.user_id in (select user_id from public.match_participants where match_id=p_match_id and side=0) and home_wins>away_wins) or (entry.user_id in (select user_id from public.match_participants where match_id=p_match_id and side=1) and away_wins>home_wins) then 3 else 0 end
    where entry.competition_id=target.competition_id and (entry.team_id in (target.team_home_id,target.team_away_id) or entry.user_id in (select user_id from public.match_participants where match_id=p_match_id));
  end if;
  update public.matches set verification_status='verified',verified_at=now() where id=p_match_id;
  return jsonb_build_object('status','verified','confirmed',confirmed_count,'required',registered_count,'verifiedAt',now());
end $$;

create or replace function public.get_venue_pickleball_analytics(p_venue_id text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.can_manage_venue(p_venue_id) then raise exception 'Venue management permission required'; end if;
  select jsonb_build_object(
    'from',p_from,'to',p_to,
    'bookings',count(*) filter (where b.status <> 'cancelled'),
    'cancelledBookings',count(*) filter (where b.status = 'cancelled'),
    'grossRevenue',coalesce(sum(b.amount) filter (where b.status <> 'cancelled'),0),
    'bookedCourtHours',coalesce(round(sum(extract(epoch from (b.ends_at-b.starts_at)))/3600,1),0),
    'uniquePlayers',count(distinct b.user_id) filter (where b.status <> 'cancelled'),
    'cancellationRate',case when count(*)=0 then 0 else round((count(*) filter (where b.status='cancelled'))::numeric*100/count(*),1) end,
    'courtUtilization',coalesce(round(sum(extract(epoch from (b.ends_at-b.starts_at))) filter (where b.status<>'cancelled')/3600*100/nullif((select count(*) from public.courts c where c.venue_id=p_venue_id and c.active)*greatest(1,p_to-p_from+1)*14,0),1),0),
    'peakHour',coalesce((select to_char(date_trunc('hour',x.starts_at at time zone 'Asia/Manila'),'HH12 AM') from public.bookings x where x.venue_id=p_venue_id and x.status<>'cancelled' and x.starts_at::date between p_from and p_to group by 1 order by count(*) desc limit 1),'—'),
    'returningPlayers',(select count(*) from (select x.user_id from public.bookings x where x.venue_id=p_venue_id and x.status<>'cancelled' and x.starts_at::date between p_from and p_to group by x.user_id having count(*)>1) repeat_players)
  ) into result from public.bookings b where b.venue_id=p_venue_id and b.starts_at::date between p_from and p_to;
  return result || jsonb_build_object(
    'openPlaySessions',(select count(*) from public.open_play_sessions s where s.venue_id=p_venue_id and s.started_at::date between p_from and p_to),
    'openPlayAttendance',(select count(*) from public.open_play_players p join public.open_play_sessions s on s.id=p.session_id where s.venue_id=p_venue_id and s.started_at::date between p_from and p_to and p.checked_in_at is not null),
    'programRegistrations',(select count(*) from public.program_registrations r join public.venue_programs v on v.id=r.program_id where v.venue_id=p_venue_id and v.starts_at::date between p_from and p_to and r.status in ('registered','attended'))
  );
end $$;

create or replace function public.claim_matchmaking_post(p_post_id uuid)
returns public.matchmaking_posts language plpgsql security definer set search_path = '' as $$
declare post public.matchmaking_posts;
begin
  select * into post from public.matchmaking_posts where id=p_post_id for update;
  if post.id is null or post.status<>'open' or post.starts_at<=now() then raise exception 'This match request is no longer available'; end if;
  if post.creator_id=auth.uid() then raise exception 'You cannot match with your own request'; end if;
  update public.matchmaking_posts set matched_user_id=auth.uid(),status='matched' where id=p_post_id returning * into post;
  return post;
end $$;

create or replace function public.register_for_program(p_program_id uuid)
returns public.program_registrations language plpgsql security definer set search_path = '' as $$
declare program public.venue_programs; registration public.program_registrations; registered_count integer;
begin
  select * into program from public.venue_programs where id=p_program_id for update;
  if program.id is null or program.registration_status<>'open' or program.starts_at<=now() then raise exception 'Registration is closed'; end if;
  select count(*) into registered_count from public.program_registrations where program_id=p_program_id and status in ('registered','attended');
  insert into public.program_registrations(program_id,user_id,status)
  values(p_program_id,auth.uid(),case when registered_count>=program.capacity then 'waitlisted' else 'registered' end)
  on conflict(program_id,user_id) do update set status=excluded.status
  returning * into registration;
  return registration;
end $$;

create or replace function public.seed_tournament_bracket(p_competition_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare competition public.competitions; entry_count integer; bracket_size integer := 1; round_count integer := 0; round_no integer; slot_count integer; slot_no integer; home_id uuid; away_id uuid;
begin
  select * into competition from public.competitions where id=p_competition_id for update;
  if competition.id is null or competition.kind<>'tournament' or not public.can_manage_competition(p_competition_id) then raise exception 'Tournament manager permission required'; end if;
  if exists(select 1 from public.competition_bracket_matches where competition_id=p_competition_id) then raise exception 'This bracket has already been seeded'; end if;
  select count(*) into entry_count from public.competition_entries where competition_id=p_competition_id and status in ('registered','active');
  if entry_count<2 then raise exception 'At least two entries are required'; end if;
  while bracket_size<entry_count loop bracket_size:=bracket_size*2; end loop;
  slot_count:=bracket_size;
  while slot_count>1 loop round_count:=round_count+1; slot_count:=slot_count/2; end loop;
  for round_no in 1..round_count loop
    slot_count:=bracket_size/cast(power(2,round_no) as integer);
    for slot_no in 1..slot_count loop
      home_id:=null; away_id:=null;
      if round_no=1 then
        select id into home_id from public.competition_entries where competition_id=p_competition_id and status in ('registered','active') order by seed nulls last,created_at offset ((slot_no-1)*2) limit 1;
        select id into away_id from public.competition_entries where competition_id=p_competition_id and status in ('registered','active') order by seed nulls last,created_at offset ((slot_no-1)*2+1) limit 1;
      end if;
      insert into public.competition_bracket_matches(competition_id,round_number,position,home_entry_id,away_entry_id,winner_entry_id,status)
      values(p_competition_id,round_no,slot_no,home_id,away_id,case when round_no=1 and home_id is not null and away_id is null then home_id else null end,case when round_no=1 and home_id is not null and away_id is null then 'bye' when round_no=1 and home_id is not null and away_id is not null then 'ready' else 'pending' end);
    end loop;
  end loop;
  update public.competitions set status='active' where id=p_competition_id;
  return round_count;
end $$;

create or replace function public.request_membership_product(p_product_id uuid)
returns public.player_memberships language plpgsql security definer set search_path = '' as $$
declare product public.membership_products; membership public.player_memberships;
begin
  select * into product from public.membership_products where id=p_product_id and active;
  if product.id is null then raise exception 'This membership product is unavailable'; end if;
  select * into membership from public.player_memberships where product_id=p_product_id and user_id=auth.uid() and status in ('pending','active') order by created_at desc limit 1;
  if membership.id is not null then return membership; end if;
  insert into public.player_memberships(product_id,user_id,status,credits_remaining,expires_at)
  values(product.id,auth.uid(),'pending',product.credits,now()+(product.validity_days||' days')::interval)
  returning * into membership;
  return membership;
end $$;

create or replace function public.activate_player_membership(p_membership_id uuid)
returns public.player_memberships language plpgsql security definer set search_path = '' as $$
declare membership public.player_memberships; product public.membership_products;
begin
  select m.* into membership from public.player_memberships m where m.id=p_membership_id for update;
  select p.* into product from public.membership_products p where p.id=membership.product_id;
  if membership.id is null or product.id is null or not public.can_manage_venue(product.venue_id) then raise exception 'Venue management permission required'; end if;
  if membership.status<>'pending' then return membership; end if;
  update public.player_memberships set status='active',credits_remaining=product.credits,starts_at=now(),expires_at=now()+(product.validity_days||' days')::interval where id=p_membership_id returning * into membership;
  if product.credits>0 then insert into public.membership_credit_ledger(membership_id,delta,reason,created_by) values(membership.id,product.credits,'Initial package credits',auth.uid()); end if;
  return membership;
end $$;

do $$ begin
  alter table public.player_ratings enable row level security;
  alter table public.rating_history enable row level security;
  alter table public.match_result_confirmations enable row level security;
  alter table public.player_availability enable row level security;
  alter table public.matchmaking_posts enable row level security;
  alter table public.team_challenges enable row level security;
  alter table public.competitions enable row level security;
  alter table public.competition_entries enable row level security;
  alter table public.competition_bracket_matches enable row level security;
  alter table public.venue_programs enable row level security;
  alter table public.program_registrations enable row level security;
  alter table public.membership_products enable row level security;
  alter table public.player_memberships enable row level security;
  alter table public.membership_credit_ledger enable row level security;
end $$;

create policy "ratings follow profile visibility" on public.player_ratings for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.profiles p where p.id=user_id and (p.profile_visibility='public' or (p.profile_visibility='members' and public.shares_team_with(user_id)))));
create policy "users read own rating history" on public.rating_history for select to authenticated using (user_id=auth.uid());
create policy "participants read confirmations" on public.match_result_confirmations for select to authenticated using (exists(select 1 from public.match_participants p where p.match_id=match_result_confirmations.match_id and p.user_id=auth.uid()));
create policy "availability follows privacy" on public.player_availability for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.profiles p where p.id=user_id and p.matching_enabled and (p.availability_visibility='public' or (p.availability_visibility='matches' and (public.shares_team_with(user_id) or exists(select 1 from public.matchmaking_posts m where (m.creator_id=user_id and m.matched_user_id=auth.uid()) or (m.creator_id=auth.uid() and m.matched_user_id=user_id)))))));
create policy "users manage availability" on public.player_availability for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "players read open matching posts" on public.matchmaking_posts for select to authenticated using (status='open' or creator_id=auth.uid() or matched_user_id=auth.uid());
create policy "players create matching posts" on public.matchmaking_posts for insert to authenticated with check (creator_id=auth.uid() and (team_id is null or public.is_team_member(team_id)));
create policy "owners update matching posts" on public.matchmaking_posts for update to authenticated using (creator_id=auth.uid()) with check (creator_id=auth.uid());
create policy "team members read challenges" on public.team_challenges for select to authenticated using (public.is_team_member(challenger_team_id) or public.is_team_member(challenged_team_id) or privacy='public');
create policy "team managers create challenges" on public.team_challenges for insert to authenticated with check (proposed_by=auth.uid() and public.can_manage_team(challenger_team_id));
create policy "challenged managers update challenges" on public.team_challenges for update to authenticated using (public.can_manage_team(challenged_team_id) or public.can_manage_team(challenger_team_id));
create policy "published competitions are readable" on public.competitions for select to authenticated using (visibility='public' or organizer_id=auth.uid() or public.can_manage_competition(id));
create policy "organizers create competitions" on public.competitions for insert to authenticated with check (organizer_id=auth.uid() and (venue_id is null or public.can_manage_venue(venue_id)));
create policy "organizers update competitions" on public.competitions for update to authenticated using (public.can_manage_competition(id));
create policy "competition standings are readable" on public.competition_entries for select to authenticated using (exists(select 1 from public.competitions c where c.id=competition_id and (c.visibility='public' or public.can_manage_competition(c.id))) or user_id=auth.uid() or (team_id is not null and public.is_team_member(team_id)));
create policy "players register for competition" on public.competition_entries for insert to authenticated with check ((user_id=auth.uid() and team_id is null) or (team_id is not null and user_id is null and public.can_manage_team(team_id)));
create policy "organizers manage competition entries" on public.competition_entries for update to authenticated using (public.can_manage_competition(competition_id));
create policy "competition brackets are readable" on public.competition_bracket_matches for select to authenticated using (exists(select 1 from public.competitions c where c.id=competition_id and (c.visibility='public' or public.can_manage_competition(c.id))));
create policy "organizers manage competition brackets" on public.competition_bracket_matches for all to authenticated using (public.can_manage_competition(competition_id)) with check (public.can_manage_competition(competition_id));
create policy "open programs are readable" on public.venue_programs for select to authenticated using (registration_status='open' or public.can_manage_venue(venue_id));
create policy "venue managers create programs" on public.venue_programs for insert to authenticated with check (created_by=auth.uid() and public.can_manage_venue(venue_id));
create policy "venue managers update programs" on public.venue_programs for update to authenticated using (public.can_manage_venue(venue_id));
create policy "users read own program registration" on public.program_registrations for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.venue_programs p where p.id=program_id and public.can_manage_venue(p.venue_id)));
create policy "users join open programs" on public.program_registrations for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.venue_programs p where p.id=program_id and p.registration_status='open'));
create policy "users cancel own program registration" on public.program_registrations for update to authenticated using (user_id=auth.uid() or exists(select 1 from public.venue_programs p where p.id=program_id and public.can_manage_venue(p.venue_id)));
create policy "active products are readable" on public.membership_products for select to authenticated using (active or public.can_manage_venue(venue_id));
create policy "venue managers create products" on public.membership_products for insert to authenticated with check (public.can_manage_venue(venue_id));
create policy "venue managers update products" on public.membership_products for update to authenticated using (public.can_manage_venue(venue_id));
create policy "users read own memberships" on public.player_memberships for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.membership_products p where p.id=product_id and public.can_manage_venue(p.venue_id)));
create policy "users read own credit ledger" on public.membership_credit_ledger for select to authenticated using (exists(select 1 from public.player_memberships m where m.id=membership_id and (m.user_id=auth.uid() or exists(select 1 from public.membership_products p where p.id=m.product_id and public.can_manage_venue(p.venue_id)))));

revoke all on function public.confirm_match_result(uuid,boolean,text) from public;
grant execute on function public.confirm_match_result(uuid,boolean,text) to authenticated;
revoke all on function public.get_venue_pickleball_analytics(text,date,date) from public;
grant execute on function public.get_venue_pickleball_analytics(text,date,date) to authenticated;
revoke all on function public.claim_matchmaking_post(uuid) from public;
grant execute on function public.claim_matchmaking_post(uuid) to authenticated;
revoke all on function public.register_for_program(uuid) from public;
grant execute on function public.register_for_program(uuid) to authenticated;
revoke all on function public.request_membership_product(uuid) from public;
grant execute on function public.request_membership_product(uuid) to authenticated;
revoke all on function public.seed_tournament_bracket(uuid) from public;
grant execute on function public.seed_tournament_bracket(uuid) to authenticated;
revoke all on function public.activate_player_membership(uuid) from public;
grant execute on function public.activate_player_membership(uuid) to authenticated;
revoke all on function public.shares_team_with(uuid) from public;
grant execute on function public.shares_team_with(uuid) to authenticated;

drop trigger if exists matchmaking_posts_updated on public.matchmaking_posts;
create trigger matchmaking_posts_updated before update on public.matchmaking_posts for each row execute function public.set_updated_at();
drop trigger if exists team_challenges_updated on public.team_challenges;
create trigger team_challenges_updated before update on public.team_challenges for each row execute function public.set_updated_at();
drop trigger if exists competitions_updated on public.competitions;
create trigger competitions_updated before update on public.competitions for each row execute function public.set_updated_at();
drop trigger if exists venue_programs_updated on public.venue_programs;
create trigger venue_programs_updated before update on public.venue_programs for each row execute function public.set_updated_at();
drop trigger if exists membership_products_updated on public.membership_products;
create trigger membership_products_updated before update on public.membership_products for each row execute function public.set_updated_at();
