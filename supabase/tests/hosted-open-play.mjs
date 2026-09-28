import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Isolated PostgreSQL checks: never connects to the hosted project. Applies
// the full migration history so hosted open play runs through the real
// check-in, rally scoring, match history and notification functions.
const db = new PGlite({ extensions: { pgcrypto, btree_gist, pg_trgm } });
const migrationsDir = new URL('../migrations/', import.meta.url);
// Push-dispatch Cron needs pg_cron/pg_net, which PGlite does not provide.
const SKIPPED = new Set(['202608250003_configure_push_dispatch_cron.sql', '202608250004_verify_push_dispatch_cron.sql']);
const ADMIN_SEED = '714ab268-7fe2-49a9-a3df-251cbaa4b183';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const host = id(1), secondHost = id(2), stranger = id(99);
const players = [id(11), id(12), id(13), id(14), id(15)];
const crew = [id(21), id(22), id(23), id(24), id(25), id(26), id(27)];

async function as(role, user = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, sub: user })]);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const value = async (sql, params = []) => Object.values((await one(sql, params)) || {})[0];
const rpc = (sql, params) => value(sql, params);
const rejects = (promise, pattern) => assert.rejects(promise, (error) => pattern.test(error.message));
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

async function bootstrap() {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_auth_admin; create role authenticator;
    create schema auth; create schema extensions; create schema storage; create schema cron;
    create schema net; create schema vault; create schema realtime;
    create extension pgcrypto with schema extensions;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}',
      banned_until timestamptz, created_at timestamptz default now(), updated_at timestamptz, deleted_at timestamptz, phone text,
      email_confirmed_at timestamptz, last_sign_in_at timestamptz, is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key, user_id uuid);
    create table auth.refresh_tokens(id bigserial primary key, user_id text, session_id uuid, revoked boolean);
    create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    create function auth.email() returns text language sql stable as $$ select auth.jwt()->>'email' $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
    create publication supabase_realtime;
    create table cron.job(jobid bigint, jobname text, schedule text, command text, active boolean default true);
    create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
    create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    insert into auth.users(id, email) values ('${ADMIN_SEED}', 'admin@example.com');
  `);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql') && !SKIPPED.has(name)).sort();
  for (const name of files) {
    let sql = await readFile(new URL(name, migrationsDir), 'utf8');
    // This historical file has identifiers split across lines in the repo copy.
    if (name === '202607210001_team_chat_features.sql') sql = sql.replace('public.t\n\neam_messages', 'public.team_messages').replace('team_mess\nages', 'team_messages');
    sql = sql.replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
    try { await db.exec(sql); } catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  const accounts = [[host, 'Hana Host', 3.5], [secondHost, 'Sol Host', 3.0], [stranger, 'Stranger', 3.0],
    ...players.map((user, index) => [user, `Player ${index + 1}`, [4.5, 2.5, 3.5, 3.0, 4.0][index]]),
    ...crew.map((user, index) => [user, `Crew ${index + 1}`, 3.0])];
  for (const [user, name] of accounts) {
    await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('display_name', $3::text))", [user, `${user}@example.com`, name]);
  }
  for (const [user, , rating] of accounts) await db.query('update public.profiles set skill_rating = $2 where id = $1', [user, rating]);
}

async function scheduleOpenPlay(owner, invitees, { kind = 'open_play', startsIn = 30, capacity = 8 } = {}) {
  // Step past the 30-second creation cooldown between activities.
  await as('postgres');
  await db.exec("update app_private.activity_creation_log set created_at = created_at - interval '1 minute'");
  await as('authenticated', owner);
  const game = await one(`select * from public.create_scheduled_activity($1, 'Sunday open play', $2, $3, 'doubles', 'casual', 'invite', $4,
    'Community Court', 'Pasig', null, null, null, $5::uuid[])`, [kind, inMinutes(startsIn), inMinutes(startsIn + 180), capacity, invitees]);
  for (const user of invitees) {
    await as('authenticated', user);
    await db.query('select public.respond_scheduled_game($1, true)', [game.id]);
  }
  return game.id;
}
const start = async (gameId, courts, present) => {
  const result = await rpc('select public.start_hosted_open_play($1, $2, $3::uuid[])', [gameId, courts, present]);
  return result.session_id;
};
const liveMatches = (sessionId) => db.query(`select m.id, array_agg(p.user_id::text order by l.side, l.position) as users,
  array_agg(l.side order by l.side, l.position) as sides, (select user_id from public.open_play_players s where s.id = m.scorer_player_id) as scorer
  from public.open_play_matches m join public.open_play_match_players l on l.match_id = m.id
  join public.open_play_players p on p.id = l.player_id
  where m.session_id = $1 and m.status = 'live' group by m.id`, [sessionId]).then(({ rows }) => rows);
const queue = (sessionId) => db.query(`select user_id::text, queue_position from public.open_play_players
  where session_id = $1 and status = 'waiting' and queue_position is not null order by queue_position`, [sessionId]).then(({ rows }) => rows);
async function winMatch(matchId, scorer) {
  await as('authenticated', scorer);
  for (let rally = 0; rally < 11; rally += 1) await db.query('select public.record_open_play_rally($1, 0::smallint)', [matchId]);
  return rpc('select public.complete_open_play_match_by_scorer($1, 11, 0)', [matchId]);
}

try {
  await bootstrap();

  // ---------- Starting ----------
  const gameId = await scheduleOpenPlay(host, players);
  await as('authenticated', players[0]);
  await rejects(start(gameId, 1, [host]), /Only the host can start/);
  await as('authenticated', host);
  await rejects(start(gameId, 0, [host]), /between 1 and 8 courts/);

  const gameOnly = await scheduleOpenPlay(secondHost, [], { kind: 'game', capacity: 4 });
  await rejects(start(gameOnly, 1, [secondHost]), /Only open play runs a rotation/);

  // Host plus four players are here; Player 5 is going but has not arrived.
  await as('authenticated', host);
  const sessionId = await start(gameId, 1, [host, ...players.slice(0, 4)]);
  assert.equal(await start(gameId, 1, [host]), sessionId, 'starting twice returns the same live session');

  await as('postgres');
  const session = await one('select * from public.open_play_sessions where id = $1', [sessionId]);
  assert.equal(session.venue_id, null);
  assert.equal(session.scheduled_game_id, gameId);
  assert.ok(session.live_started_at, 'hosted sessions are live as soon as they start');
  let live = await liveMatches(sessionId);
  assert.equal(live.length, 1, 'the only court is filled immediately');
  assert.equal(live[0].users.length, 4);
  assert.deepEqual(live[0].sides, [0, 0, 1, 1]);
  const benched = (await queue(sessionId)).map((row) => row.user_id);
  assert.equal(benched.length, 1, 'the fifth player present waits in the queue');
  assert.ok(!live[0].users.includes(benched[0]));
  assert.ok(!live[0].users.includes(players[4]) && !benched.includes(players[4]), 'players who have not arrived are not queued');
  if (live[0].users.includes(host)) assert.equal(live[0].scorer, host, 'the host scores when they are on court');
  assert.equal(await value("select count(*)::int from public.user_notifications where kind = 'game_update' and data->>'sessionId' = $1", [sessionId]), 1,
    'only the player who has not arrived is told the open play started');
  assert.equal(await value("select count(*)::int from public.user_notifications where kind = 'organizer_match' and session_id = $1", [sessionId]), 0,
    'the host is not sent organizer court alerts');
  assert.equal(await value("select count(*)::int from public.user_notifications where kind = 'court_assignment' and session_id = $1", [sessionId]), 4,
    'everyone put on court is told');

  // ---------- Reading ----------
  await as('authenticated', players[4]);
  const view = await rpc('select public.get_open_play_session($1)', [sessionId]);
  assert.equal(view.venue, null);
  assert.equal(view.hosted.place, 'Community Court');
  assert.equal(view.hosted.is_host, false);
  assert.equal(view.hosted.can_check_in, true);
  assert.equal(view.hosted.players.length, 6);
  assert.equal(view.hosted.players.filter((player) => player.state === 'playing').length, 4);
  assert.equal(view.hosted.players.find((player) => player.user_id === players[4]).state, 'not_here');
  assert.equal((await rpc('select public.get_hosted_open_play($1)', [gameId])).session_id, sessionId);
  await as('authenticated', stranger);
  await rejects(rpc('select public.get_open_play_session($1)', [sessionId]), /invitation or session code/);
  assert.equal(await rpc('select public.get_hosted_open_play($1)', [gameId]), null);

  // ---------- Checking in ----------
  await rejects(rpc('select public.check_in_hosted_open_play($1)', [sessionId]), /Only players who are going/);
  await as('authenticated', players[0]);
  await rejects(rpc('select public.check_in_hosted_open_play($1, $2)', [sessionId, players[4]]), /Only the host can check in other players/);
  await as('authenticated', players[4]);
  await rpc('select public.check_in_hosted_open_play($1)', [sessionId]);
  await as('postgres');
  assert.deepEqual((await queue(sessionId)).map((row) => row.user_id), [benched[0], players[4]], 'late arrivals join the back of the queue');
  assert.equal((await liveMatches(sessionId)).length, 1, 'no second court to fill');

  // ---------- Finishing a match rotates the court ----------
  const [first] = live;
  const result = await winMatch(first.id, first.scorer);
  assert.ok(result.recorded_match_id, 'the result is saved to match history');
  await as('postgres');
  assert.equal(await value('select count(*)::int from public.match_participants where match_id = $1', [result.recorded_match_id]), 4);
  live = await liveMatches(sessionId);
  assert.equal(live.length, 1, 'the court is filled again as soon as the result is recorded');
  const next = live[0].users;
  assert.ok(next.includes(benched[0]) && next.includes(players[4]), 'the players who waited go on first');
  const firstTeams = [first.users.slice(0, 2), first.users.slice(2)];
  const nextTeams = [next.slice(0, 2), next.slice(2)];
  for (const team of nextTeams) {
    assert.ok(!firstTeams.some((previous) => previous.every((user) => team.includes(user))), 'partners from the last match are split up');
  }
  assert.equal((await queue(sessionId)).length, 2, 'two returning players wait for the next game');
  const decision = await one('select explanation from public.open_play_rotation_decisions where session_id = $1 order by created_at desc limit 1', [sessionId]);
  assert.equal(decision.explanation.source, 'hosted_auto');

  // ---------- Breaks ----------
  const [waiting] = await queue(sessionId);
  await as('authenticated', waiting.user_id);
  await rpc('select public.leave_hosted_open_play_queue($1)', [sessionId]);
  await as('postgres');
  assert.deepEqual((await queue(sessionId)).map((row) => row.queue_position), [0], 'the queue closes the gap');
  const onCourt = live[0].users[0];
  await as('authenticated', onCourt);
  await rejects(rpc('select public.leave_hosted_open_play_queue($1)', [sessionId]), /Finish the current match first/);
  await as('authenticated', waiting.user_id);
  await rpc('select public.check_in_hosted_open_play($1)', [sessionId]);
  await as('postgres');
  assert.equal((await queue(sessionId)).at(-1).user_id, waiting.user_id, 'coming back from a break rejoins at the back');

  // Players cannot jump the queue with direct table writes.
  const last = (await queue(sessionId)).at(-1);
  await as('authenticated', last.user_id);
  const jump = await db.query('update public.open_play_players set queue_position = -1 where session_id = $1 and user_id = $2', [sessionId, last.user_id])
    .then((outcome) => outcome.affectedRows, () => 0);
  assert.equal(jump, 0);

  // ---------- Ending ----------
  await as('authenticated', players[0]);
  await rejects(rpc('select public.end_hosted_open_play($1)', [sessionId]), /Only the host can end/);
  await as('authenticated', host);
  const ended = await rpc('select public.end_hosted_open_play($1)', [sessionId]);
  assert.equal(ended.status, 'completed');
  await as('postgres');
  assert.equal((await liveMatches(sessionId)).length, 0, 'unfinished matches are cancelled');
  assert.equal(await value("select count(*)::int from public.open_play_matches where session_id = $1 and status = 'completed'", [sessionId]), 1,
    'finished matches stay in history');
  assert.equal(await value("select count(*)::int from public.open_play_players where session_id = $1 and status <> 'done'", [sessionId]), 0);
  await as('authenticated', host);
  await rejects(start(gameId, 1, [host]), /already ended/);
  await rejects(rpc('select public.get_open_play_session($1)', [sessionId]), /not found/);

  // ---------- Several courts, and cancelling the activity ----------
  const crewGame = await scheduleOpenPlay(secondHost, crew, { capacity: 8 });
  await as('authenticated', secondHost);
  const crewSession = await start(crewGame, 2, [secondHost, ...crew]);
  await as('postgres');
  const crewLive = await liveMatches(crewSession);
  assert.equal(crewLive.length, 2, 'eight players fill two courts');
  assert.equal(new Set(crewLive.flatMap((match) => match.users)).size, 8);
  await as('authenticated', secondHost);
  await db.query('select public.cancel_scheduled_game($1)', [crewGame]);
  await as('postgres');
  assert.equal(await value('select status::text from public.open_play_sessions where id = $1', [crewSession]), 'cancelled');
  assert.equal((await liveMatches(crewSession)).length, 0);

  // ---------- Organizer sessions keep their rules ----------
  await as('postgres');
  await db.exec(`
    insert into public.venues(id, name, area, address, latitude, longitude, venue_type, verification_status)
      values ('venue-a', 'Center A', 'Pasig', '1 Court St', 14.57, 121.08, 'Indoor', 'verified');
    insert into public.courts(id, venue_id, name, environment, surface, owner_hourly_price) values ('court-a', 'venue-a', 'Court 1', 'Indoor', 'Acrylic', 0);
    insert into public.venue_members(venue_id, user_id, role) values ('venue-a', '${stranger}', 'owner');
  `);
  const publish = (startsIn) => rpc(`select to_jsonb(s) from public.create_open_play_session('Venue open play', 'venue-a', array['court-a'], 12, 'public',
    'automatic', null, null, 0, $1, $2, 'First to 11', 'Cancel before play', 'doubles', 15, 2, 0, array['doubles']) s`, [inMinutes(startsIn), inMinutes(startsIn + 120)]);
  await as('authenticated', stranger);
  await rejects(publish(-10), /future/);
  const published = await publish(24 * 60);
  assert.equal(published.venue_id, 'venue-a', 'venue managers still publish organizer open play');
  assert.equal(published.scheduled_game_id, null);
  await as('authenticated', host);
  await rejects(rpc(`select to_jsonb(s) from public.create_open_play_session('Venue open play', 'venue-a', array['court-a'], 12, 'public',
    'automatic', null, null, 0, $1, $2, 'First to 11', 'Cancel before play', 'doubles', 15, 2, 0, array['doubles']) s`, [inMinutes(2 * 24 * 60), inMinutes(2 * 24 * 60 + 120)]),
    /owner, manager, or a platform admin/);
  await rejects(db.query(`insert into public.open_play_sessions(id, organizer_id, name, status, session_code, scheduled_start, scheduled_end)
    values ('rogue', $1, 'Rogue session', 'active', 'ROGUE1', now() + interval '1 day', now() + interval '1 day 2 hours')`, [host]), /row-level security|venue|permission denied/);

  console.log('Hosted open play checks passed.');
} finally {
  await db.close();
}
