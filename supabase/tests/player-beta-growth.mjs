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
}

async function schedule(owner, { visibility = 'open', matchType = 'singles', area = 'Kapitolyo, Pasig', startsIn = 24 * 60 } = {}) {
  await as('postgres');
  await db.exec("update app_private.activity_creation_log set created_at = created_at - interval '1 minute'");
  await as('authenticated', owner);
  return value(`select (public.create_scheduled_activity('game', 'Evening singles', $1, $2, $3, 'casual', $4, 2,
    'Community Court', $5, null, null, null, '{}'::uuid[])).id`, [inMinutes(startsIn), inMinutes(startsIn + 90), matchType, visibility, area]);
}
const notices = async (user, kind) => {
  await as('postgres');
  return (await db.query('select title, data from public.user_notifications where user_id = $1 and kind = $2 order by created_at', [user, kind])).rows;
};

try {
  await bootstrap();
  console.log('PASS full migration history applies, including player beta growth');
  const [first, second, third, fourthPlayer] = players;

  // "Notify me when a game opens here"
  await as('authenticated', first);
  await rejects(db.query("select public.set_scheduled_game_alert(' ')"), /Choose an area/);
  await db.query("select public.set_scheduled_game_alert('Pasig')");
  await as('authenticated', third);
  await db.query("select public.set_scheduled_game_alert('Makati')");
  const privateGame = await schedule(host, { visibility: 'invite' });
  assert.equal((await notices(first, 'game_alert')).length, 0, 'private activities do not alert');
  const gameId = await schedule(host);
  const alerts = await notices(first, 'game_alert');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].data.gameId, gameId);
  assert.equal((await notices(third, 'game_alert')).length, 0, 'other areas are not alerted');
  assert.equal((await notices(host, 'game_alert')).length, 0, 'the host is not alerted');
  await as('authenticated', host);
  await db.query("select public.set_scheduled_game_visibility($1, 'open')", [privateGame]);
  await db.query("select public.set_scheduled_game_visibility($1, 'invite')", [privateGame]);
  await db.query("select public.set_scheduled_game_visibility($1, 'open')", [privateGame]);
  assert.equal((await notices(first, 'game_alert')).length, 2, 'going public alerts once per activity');
  await as('authenticated', second);
  assert.equal(await value('select count(*)::int from public.scheduled_game_alerts'), 0, 'players only read their own alert');
  console.log('PASS area alerts reach matching players once, skip private activities and other areas');

  // Waitlist
  await as('authenticated', first);
  await rejects(db.query('select public.join_scheduled_game_waitlist($1)', [gameId]), /A spot is open/);
  await db.query('select public.respond_scheduled_game($1, true)', [gameId]);
  await as('authenticated', second);
  await rejects(db.query('select public.respond_scheduled_game($1, true)', [gameId]), /full/);
  assert.equal(await value('select public.join_scheduled_game_waitlist($1)', [gameId]), 1);
  await as('authenticated', third);
  assert.equal(await value('select public.join_scheduled_game_waitlist($1)', [gameId]), 2);
  await as('authenticated', host);
  assert.equal(await value('select count(*)::int from public.scheduled_game_waitlist where game_id = $1', [gameId]), 2, 'the host sees the waitlist');
  await as('authenticated', third);
  assert.equal(await value('select count(*)::int from public.scheduled_game_waitlist'), 1, 'players only see their own place');
  assert.deepEqual(await one('select place, waiting from public.list_scheduled_game_waitlists() where game_id = $1', [gameId]), { place: 2, waiting: 2 });
  await as('authenticated', host);
  assert.deepEqual(await one('select place, waiting from public.list_scheduled_game_waitlists() where game_id = $1', [gameId]), { place: null, waiting: 2 });
  await as('authenticated', fourthPlayer);
  assert.equal(await value('select count(*)::int from public.list_scheduled_game_waitlists()'), 0, 'other players learn nothing');
  await as('authenticated', first);
  await db.query('select public.respond_scheduled_game($1, false)', [gameId]);
  await as('postgres');
  assert.equal(await value("select status from public.scheduled_game_players where game_id = $1 and user_id = $2", [gameId, second]), 'going');
  assert.equal(await value('select count(*)::int from public.scheduled_game_waitlist where game_id = $1', [gameId]), 1);
  assert.equal((await notices(second, 'waitlist_promotion')).length, 1);
  await as('authenticated', third);
  await db.query('select public.leave_scheduled_game_waitlist($1)', [gameId]);
  await as('authenticated', second);
  await db.query('select public.respond_scheduled_game($1, false)', [gameId]);
  await as('postgres');
  assert.equal(await value("select count(*)::int from public.scheduled_game_players where game_id = $1 and status = 'going'", [gameId]), 1, 'an empty waitlist leaves the spot open');
  console.log('PASS a full activity keeps a waitlist, and a freed spot goes to the longest-waiting player');

  // Host edits
  await as('authenticated', first);
  await db.query('select public.respond_scheduled_game($1, true)', [gameId]);
  await rejects(db.query("select public.update_scheduled_game($1, p_skill_level => 'beginner')", [gameId]), /Only the host/);
  await as('authenticated', host);
  await rejects(db.query("select public.update_scheduled_game($1, p_skill_level => 'pro')", [gameId]), /skill level/);
  await rejects(db.query('select public.update_scheduled_game($1, $2, $3)', [gameId, inMinutes(-60), inMinutes(30)]), /future/);
  await db.query("select public.update_scheduled_game($1, p_skill_level => 'beginner', p_court_cost => '₱150 each')", [gameId]);
  assert.equal((await notices(first, 'game_update')).length, 0, 'detail changes do not notify');
  await as('authenticated', host);
  const moved = await one('select * from public.update_scheduled_game($1, $2, $3, $4, $5)', [gameId, inMinutes(48 * 60), inMinutes(48 * 60 + 90), 'Tiendesitas Court', 'Pasig']);
  assert.equal(moved.court_label, 'Tiendesitas Court');
  assert.equal(moved.skill_level, 'beginner');
  assert.equal(moved.court_cost, '₱150 each');
  assert.equal((await notices(first, 'game_update')).length, 1, 'players hear about a new time or court');
  await as('authenticated', host);
  await db.query("select public.update_scheduled_game($1, p_court_cost => '')", [gameId]);
  assert.equal(await value('select court_cost from public.scheduled_games where id = $1', [gameId]), null);
  console.log('PASS hosts change time, court, skill level and cost; players are told about time and court');

  // Public link preview
  await as('authenticated', host);
  const code = await value('select public.get_scheduled_game_share_code($1)', [privateGame]);
  await as('anon');
  const preview = await value('select public.get_scheduled_game_preview($1)', [code]);
  assert.equal(preview.title, 'Evening singles');
  assert.equal(preview.hostFirstName, 'Hana');
  assert.equal(preview.going, 1);
  assert.equal(preview.status, 'scheduled');
  for (const hidden of ['notes', 'roster', 'hostId', 'players']) assert.equal(preview[hidden], undefined);
  assert.equal(await value('select public.get_scheduled_game_preview($1)', ['zzzzzzzzzz']), null);
  assert.equal(await value('select public.get_scheduled_game_preview($1)', ["' or 1=1 --"]), null);
  await rejects(db.query('select count(*) from public.scheduled_games'), /permission denied/);
  console.log('PASS a signed-out visitor with the link sees public fields only, never rosters or notes');

  // Funnel
  const browser = 'a'.repeat(32);
  await as('anon');
  await db.query("select public.record_player_event('invite_opened', $1, $2)", [browser, privateGame]);
  await db.query("select public.record_player_event('invite_opened', $1, $2)", [browser, privateGame]);
  await db.query("select public.record_player_event('activity_joined', $1, $2)", [browser, privateGame]);
  await db.query("select public.record_player_event('invite_opened', 'not-an-id', null)");
  await rejects(db.query('select count(*) from app_private.player_funnel_events'), /permission denied/);
  await as('authenticated', first);
  await db.query("select public.record_player_event('activity_joined', null, $1)", [gameId]);
  await db.query("select public.record_player_event('delete everything', null, null)");
  await rejects(db.query('select * from public.player_funnel_weekly()'), /platform admins/);
  await as('postgres');
  const events = (await db.query('select event, user_id, anonymous_id from app_private.player_funnel_events order by id')).rows;
  assert.deepEqual(events.map((row) => row.event), ['invite_opened', 'activity_joined']);
  assert.equal(events[0].anonymous_id, browser);
  assert.equal(events[1].user_id, first);
  console.log('PASS funnel events are allow-listed, deduplicated, and unreadable by players');
  console.log('PASS player beta growth checks');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
