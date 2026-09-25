import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL semantics in an isolated database. No hosted credentials.
const db = new PGlite();
const host = '11111111-1111-4111-8111-111111111111';
const friend = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const fourth = '44444444-4444-4444-8444-444444444444';
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
async function as(role, id = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, sub: id })]);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}
const migration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const createGame = (visibility, capacity, invitees) => db.query(
  `select (public.create_scheduled_game('Sunday doubles', $1, $2, 'doubles', 'casual', $3, $4, 'Kapitolyo Court', 'Pasig', null, null, null, $5::uuid[])).id as value`,
  [future(24), future(26), visibility, capacity, invitees],
).then((result) => result.rows[0].value);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create type public.match_status as enum ('scheduled','live','completed','cancelled');
    create table public.profiles(id uuid primary key, display_name text);
    create table public.venues(id text primary key, name text);
    create table public.courts(id text primary key, venue_id text references public.venues(id), name text);
    create table public.teams(id uuid primary key);
    create table public.competitions(id uuid primary key);
    create table public.competition_divisions(id uuid primary key);
    create table public.competition_entries(id uuid primary key, competition_id uuid, competition_division_id uuid, team_id uuid, user_id uuid, played int default 0, won int default 0, lost int default 0, standing_points int default 0);
    create table public.matches(
      id uuid primary key default gen_random_uuid(), created_by uuid not null references public.profiles(id),
      venue_id text references public.venues(id), court_id text references public.courts(id),
      team_home_id uuid, team_away_id uuid, match_type text not null default 'doubles', mode text not null default 'casual',
      status public.match_status not null default 'scheduled', verification_status text not null default 'unverified',
      verified_at timestamptz, result_revision int not null default 1, competition_id uuid, competition_division_id uuid
    );
    create table public.match_participants(match_id uuid references public.matches(id), user_id uuid references public.profiles(id), guest_name text, side int, position int);
    create table public.match_games(match_id uuid references public.matches(id), game_number int, home_score int, away_score int, winner_side int);
    create table public.match_result_confirmations(match_id uuid, user_id uuid, result_revision int, decision text, note text, decided_at timestamptz default now(), primary key(match_id, user_id));
    create table public.player_ratings(user_id uuid, format text, rating numeric not null default 3.0, verified_matches int not null default 0, wins int not null default 0, losses int not null default 0, updated_at timestamptz, primary key(user_id, format));
    create table public.rating_history(user_id uuid, match_id uuid, format text, rating_before numeric, rating_after numeric, outcome numeric);
    create table public.user_notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text not null, title text not null, body text not null, data jsonb not null default '{}'::jsonb, created_at timestamptz default now());
    alter table public.user_notifications add constraint user_notifications_kind_check check (kind in ('approval'));
    grant select on all tables in schema public to authenticated;
    insert into public.profiles values ('${host}','Host'),('${friend}','Friend'),('${stranger}','Stranger'),('${fourth}','Fourth');
  `);
  await db.exec(await migration('202609250001_play_anywhere_courts.sql'));
  await db.exec(await migration('202609250002_scheduled_games.sql'));
  console.log('PASS migrations apply on top of the existing schema');

  // Court labels are stored and bounded.
  await db.query("insert into public.matches(created_by, court_label, court_area) values ($1, 'Kapitolyo Court · Court 2', 'Pasig')", [host]);
  await assert.rejects(db.query("insert into public.matches(created_by, court_label) values ($1, '   ')", [host]), /matches_court_label_length/);
  console.log('PASS matches store a bounded court label and area');

  // A ranked match against guests is verified but does not move the rating.
  const guestMatch = await scalar(`insert into public.matches(created_by, mode, status) values ($1, 'ranked', 'completed') returning id as value`, [host]);
  await db.query(`insert into public.match_participants values ($1,$2,null,0,0),($1,null,'Guest A',1,0)`, [guestMatch, host]);
  await db.query('insert into public.match_games values ($1,1,11,2,0)', [guestMatch]);
  await as('authenticated', host);
  assert.equal((await db.query('select public.confirm_match_result($1, true) as value', [guestMatch])).rows[0].value.status, 'verified');
  await as('postgres');
  assert.equal(await scalar('select count(*)::int as value from public.player_ratings where user_id=$1', [host]), 0);
  console.log('PASS guest-only ranked results cannot farm rating points');

  // Two registered sides still rate once both confirm.
  const ratedMatch = await scalar(`insert into public.matches(created_by, mode, status) values ($1, 'ranked', 'completed') returning id as value`, [host]);
  await db.query('insert into public.match_participants values ($1,$2,null,0,0),($1,$3,null,1,0)', [ratedMatch, host, friend]);
  await db.query('insert into public.match_games values ($1,1,11,5,0)', [ratedMatch]);
  await as('authenticated', host);
  assert.equal((await db.query('select public.confirm_match_result($1, true) as value', [ratedMatch])).rows[0].value.status, 'pending');
  await as('authenticated', friend);
  assert.equal((await db.query('select public.confirm_match_result($1, true) as value', [ratedMatch])).rows[0].value.status, 'verified');
  await as('postgres');
  assert.equal(await scalar("select verified_matches as value from public.player_ratings where user_id=$1 and format='doubles'", [host]), 1);
  console.log('PASS ranked results between registered players still update ratings');

  // Invite-only games: invitee sees and answers, stranger cannot.
  await as('authenticated', host);
  const privateGame = await createGame('invite', 4, [friend]);
  await as('postgres');
  assert.equal(await scalar("select count(*)::int as value from public.user_notifications where user_id=$1 and kind='game_invite'", [friend]), 1);
  await as('authenticated', stranger);
  assert.equal((await db.query('select id from public.scheduled_games where id=$1', [privateGame])).rows.length, 0);
  await assert.rejects(db.query('select public.respond_scheduled_game($1, true)', [privateGame]), /no longer available/);
  await assert.rejects(db.query("insert into public.scheduled_game_players(game_id, user_id, status) values ($1,$2,'going')", [privateGame, stranger]), /permission denied/);
  await as('authenticated', friend);
  assert.equal((await db.query('select id from public.scheduled_games where id=$1', [privateGame])).rows.length, 1);
  assert.equal((await db.query('select public.respond_scheduled_game($1, true) as value', [privateGame])).rows[0].value.going, 2);
  console.log('PASS invite-only games are private to the host and invitees');

  // Open games are joinable until full.
  await as('authenticated', host);
  const openGame = await createGame('open', 2, []);
  await as('authenticated', stranger);
  assert.equal((await db.query('select public.respond_scheduled_game($1, true) as value', [openGame])).rows[0].value.going, 2);
  await as('authenticated', fourth);
  await assert.rejects(db.query('select public.respond_scheduled_game($1, true)', [openGame]), /full/);
  await as('authenticated', host);
  await assert.rejects(createGame('invite', 2, [friend, stranger]), /at most 1/);
  console.log('PASS open games enforce capacity and invite limits');

  // Only the host cancels, and attendees are told.
  await as('authenticated', friend);
  await assert.rejects(db.query('select public.cancel_scheduled_game($1)', [privateGame]), /Only the host/);
  await as('authenticated', host);
  await db.query('select public.cancel_scheduled_game($1)', [privateGame]);
  await as('postgres');
  assert.equal(await scalar("select count(*)::int as value from public.user_notifications where user_id=$1 and kind='game_update'", [friend]), 1);
  await as('authenticated', friend);
  await assert.rejects(db.query('select public.respond_scheduled_game($1, true)', [privateGame]), /cancelled/);
  console.log('PASS hosts cancel games and attendees are notified');
} finally {
  await db.close();
}
