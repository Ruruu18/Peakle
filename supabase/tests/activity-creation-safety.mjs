import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Isolated PostgreSQL checks: never connects to the hosted project.
const db = new PGlite({ extensions: { pgcrypto } });
const host = '11111111-1111-4111-8111-111111111111';
const friend = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const viewer = '44444444-4444-4444-8444-444444444444';
const admin = '55555555-5555-4555-8555-555555555555';
const migration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const start = future(24), end = future(26);
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
async function as(role, id = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, sub: id })]);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}
const create = (overrides = {}) => {
  const args = { kind: 'open_play', title: 'Community session', start, end, match: 'doubles', mode: 'casual', visibility: 'open', capacity: 8, label: 'Community Court', area: 'Pasig', venue: null, court: null, notes: null, invitees: [friend], ...overrides };
  return db.query('select * from public.create_scheduled_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid[])', Object.values(args)).then(({ rows }) => rows[0]);
};
const publish = (overrides = {}, legacy = false) => {
  const args = { name: 'Venue open play', venue: 'venue-a', courts: ['court-a'], capacity: 12, visibility: 'public', approval: 'automatic', min: null, max: null, fee: 0, start, end, rules: 'First to 11', cancellation: 'Cancel before play', format: 'doubles', minutes: 15, consecutive: 2, rest: 0, formats: ['doubles'], ...overrides };
  if (legacy) delete args.formats;
  return db.query(`select * from public.create_open_play_session(${Object.values(args).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(args)).then(({ rows }) => rows[0]);
};
async function ageUsage(actor = host, kind = 'scheduled', hours = 0) {
  await as('postgres');
  await db.query("update app_private.activity_creation_log set created_at = clock_timestamp() - interval '31 seconds' - ($3 * interval '1 hour') where actor_id=$1 and kind=$2", [actor, kind, hours]);
  await as('authenticated', actor);
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    grant usage on schema auth to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.profiles(id uuid primary key, display_name text);
    create table public.venues(id text primary key, name text, active boolean default true, verification_status text default 'verified', latitude double precision, longitude double precision);
    create table public.courts(id text primary key, venue_id text references public.venues(id), name text, active boolean default true);
    create table public.venue_members(venue_id text, user_id uuid, role text);
    create table public.platform_admins(user_id uuid primary key);
    create function public.can_manage_venue(target text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.venue_members where venue_id=target and user_id=auth.uid() and role in ('owner','manager')) $$;
    create function public.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;
    create function public.is_verified_active_venue(target text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.venues where id=target and active and verification_status='verified') $$;
    create table public.user_notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text not null, title text not null, body text not null, data jsonb default '{}', created_at timestamptz default now());
    create table public.open_play_sessions(
      id text primary key, organizer_id uuid references public.profiles(id), venue_id text references public.venues(id), name text, status text,
      court_count int, session_code text unique, visibility text, approval_mode text, capacity int, skill_min numeric, skill_max numeric, fee_amount numeric,
      scheduled_start timestamptz, scheduled_end timestamptz, rules text, cancellation_policy text, match_format text,
      average_match_minutes int, max_consecutive_games int, rest_minutes int, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.open_play_courts(id text primary key, session_id text references public.open_play_sessions(id) on delete cascade, court_number int, venue_court_id text references public.courts(id));
    create table public.bookings(id uuid primary key, court_id text, status text, starts_at timestamptz, ends_at timestamptz);
    create table public.court_blackouts(venue_id text, court_id text, starts_at timestamptz, ends_at timestamptz);
    create table public.court_waitlist(court_id text, status text, offer_expires_at timestamptz, user_id uuid, starts_at timestamptz, ends_at timestamptz);
    alter table public.open_play_sessions enable row level security;
    create policy "read owned sessions" on public.open_play_sessions for select to authenticated using (organizer_id=auth.uid());
    create policy "update owned sessions" on public.open_play_sessions for update to authenticated using (organizer_id=auth.uid()) with check (organizer_id=auth.uid());
    create policy "delete owned sessions" on public.open_play_sessions for delete to authenticated using (organizer_id=auth.uid());
    grant select on all tables in schema public to authenticated;
    grant insert, update, delete on public.open_play_sessions to authenticated;
    insert into profiles values ('${host}','Host'),('${friend}','Friend'),('${stranger}','Stranger'),('${viewer}','Viewer'),('${admin}','Admin');
    insert into venues(id,name) values ('venue-a','A'),('venue-b','B');
    insert into courts values ('court-a','venue-a','Court A',true),('court-b','venue-b','Court B',true);
    insert into venue_members values ('venue-a','${host}','owner'),('venue-b','${friend}','manager'),('venue-a','${viewer}','viewer');
    insert into platform_admins values ('${admin}');
  `);
  await db.exec(await migration('202609250002_scheduled_games.sql'));
  await db.exec(await migration('202609260011_scheduled_activity_types.sql'));
  await db.exec(await migration('202609260013_scheduled_activity_coordinates.sql'));
  await db.exec(await migration('202609260015_scheduled_activity_sharing.sql'));
  const availability = await migration('202607260001_open_play_court_availability.sql');
  await db.exec(availability.slice(0, availability.indexOf('create or replace function public.get_court_availability')));
  const base = await migration('202608090002_remove_organizer_pass.sql');
  await db.exec(base.slice(0, base.indexOf('-- 2. Drop')));
  const mixed = await migration('202607260004_mixed_open_play_formats.sql');
  await db.exec(mixed.slice(0, mixed.indexOf('create or replace function public.assign_fair_play_match')));
  // Production's security cleanup keeps the mixed-format implementation in
  // app_private behind a public invoker wrapper. Exercise that call chain too.
  const mixedSignature = 'text, text, text[], integer, text, text, numeric, numeric, numeric, timestamptz, timestamptz, text, text, text, integer, integer, integer, text[]';
  const mixedHeader = mixed.slice(mixed.indexOf('create function public.create_open_play_session('), mixed.indexOf('as $$'));
  await db.exec(`create schema app_private; alter function public.create_open_play_session(${mixedSignature}) set schema app_private;`);
  await db.exec(`${mixedHeader.replace('security definer', 'security invoker')}as $$ begin
    return app_private.create_open_play_session(p_name,p_venue_id,p_court_ids,p_capacity,p_visibility,p_approval_mode,p_skill_min,p_skill_max,p_fee_amount,p_scheduled_start,p_scheduled_end,p_rules,p_cancellation_policy,p_match_format,p_average_match_minutes,p_max_consecutive_games,p_rest_minutes,p_court_formats);
    end $$; grant execute on function public.create_open_play_session(${mixedSignature}) to authenticated;`);
  await db.exec(await migration('202609270005_activity_creation_safety.sql'));
  console.log('PASS safety migration applies with the current scheduled-activity and open-play implementations');

  await as('authenticated', host);
  const activity = await create();
  const retry = await create();
  assert.equal(retry.id, activity.id);
  const repeated = await Promise.all(Array.from({ length: 205 }, () => create()));
  assert.equal(new Set(repeated.map((row) => row.id)).size, 1);
  await as('postgres');
  assert.equal(await scalar('select count(*)::int as value from public.user_notifications'), 1);
  assert.equal(await scalar('select count(*)::int as value from app_private.activity_creation_log'), 1);
  await as('authenticated', host);
  await assert.rejects(create({ title: 'Different title' }), /wait 30 seconds/);
  await db.query('select public.cancel_scheduled_game($1)', [activity.id]);
  await assert.rejects(create({ title: 'After cancelling' }), /wait 30 seconds/);
  assert.equal((await create()).status, 'cancelled');
  console.log('PASS identical retries reuse one record and invitation; cancellation does not reset the cooldown');

  // Quota applies across all activity categories and survives cancellation.
  for (let i = 1; i < 10; i++) {
    await ageUsage();
    const row = await create({ title: `Activity ${i}`, kind: i % 2 ? 'program' : 'competition' });
    await db.query('select public.cancel_scheduled_game($1)', [row.id]);
  }
  await ageUsage();
  await assert.rejects(create({ title: 'Eleventh activity' }), /up to 10 activities in 24 hours/);
  await assert.rejects(db.query("select * from public.create_scheduled_game('Legacy bypass', $1,$2,'doubles','casual','open',4,'Court')", [start, end]), /up to 10 activities/);
  await ageUsage(host, 'scheduled', 25);
  assert.ok((await create({ title: 'Next day' })).id);
  console.log('PASS daily quota spans categories and legacy clients; quota expires after 24 hours');

  await as('authenticated', stranger);
  const personal = await create({ title: 'My private game', visibility: 'invite', invitees: [], start: future(48), end: future(50) });
  // Seed historic traffic as trusted maintenance, not through the client API.
  await as('postgres');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: 'service_role' })]);
  await db.query(`insert into public.scheduled_games(host_id,title,starts_at,ends_at,visibility,capacity,court_label)
    select $1, 'Public event ' || n, $2::timestamptz, $3::timestamptz, 'open', 4, 'Court' from generate_series(1,205) n`, [host, start, end]);
  await as('authenticated', stranger);
  const mine = await db.query('select id from public.list_my_scheduled_games($1,$2)', [future(0), future(72)]);
  assert.deepEqual(mine.rows.map((row) => row.id), [personal.id]);
  await as('authenticated', viewer);
  assert.equal((await db.query('select id from public.list_my_scheduled_games($1,$2)', [future(0), future(72)])).rows.length, 0);
  await as('authenticated', friend);
  assert.ok((await db.query('select id from public.list_my_scheduled_games($1,$2)', [future(0), future(72)])).rows.some((row) => row.id === activity.id));
  await ageUsage(host, 'scheduled', 25);
  await assert.rejects(create({ title: 'Too many upcoming' }), /up to 20 upcoming activities/);
  console.log('PASS personal calendars survive 205 public posts; private records stay private; upcoming cap is enforced');

  await as('authenticated', stranger);
  await assert.rejects(publish(), /owner, manager/);
  await assert.rejects(publish({}, true), /owner, manager/);
  await assert.rejects(db.query("insert into public.open_play_sessions(id,organizer_id,venue_id,name,status,scheduled_start,scheduled_end) values ('bypass',$1,'venue-a','Bypass','active',$2,$3)", [stranger, start, end]), /owner, manager|row-level security/);
  await as('authenticated', viewer);
  await assert.rejects(publish(), /owner, manager/);
  await as('authenticated', host);
  await assert.rejects(publish({ venue: 'venue-b', courts: ['court-b'] }), /owner, manager/);
  const session = await publish();
  assert.equal((await publish()).id, session.id);
  await assert.rejects(publish({ name: 'Second session', start: future(28), end: future(30) }), /wait 30 seconds/);
  await assert.rejects(db.query("update public.open_play_sessions set venue_id='venue-b' where id=$1", [session.id]), /change its organizer or venue/);
  await assert.rejects(db.query("update public.open_play_sessions set scheduled_end=$2 where id=$1", [session.id, future(1000)]), /change its schedule/);
  await db.query("update public.open_play_sessions set status='cancelled' where id=$1", [session.id]);
  await assert.rejects(db.query("update public.open_play_sessions set status='active' where id=$1", [session.id]), /cannot be reopened/);
  await db.query('delete from public.open_play_sessions where id=$1', [session.id]);
  await assert.rejects(publish({ name: 'Deleted then recreated' }), /wait 30 seconds/);
  await assert.rejects(publish(), /was removed/);
  console.log('PASS venue ownership enforced for current RPC, legacy RPC, direct insert and venue reassignment; deletion preserves quota');

  await ageUsage(host, 'open_play');
  await assert.rejects(publish({ end: future(40) }), /at most 12 hours/);
  await assert.rejects(publish({ name: 'x'.repeat(81) }), /3–80/);
  const valid = await publish({ name: 'Valid after rollback' });
  assert.ok(valid.id);
  await as('authenticated', friend);
  assert.ok((await publish({ venue: 'venue-b', courts: ['court-b'] })).id);
  await as('authenticated', admin);
  await assert.rejects(publish({ name: 'Court conflict' }), /no longer available/);
  assert.ok((await publish({ start: future(60), end: future(62) })).id);
  console.log('PASS failed requests roll back quota; venue managers and admins can publish; overlapping courts remain protected');

  await as('postgres');
  await db.query(`insert into app_private.activity_creation_log(actor_id,kind,resource_id,created_at)
    select $1, 'open_play', 'previous-session-' || n, now() - interval '1 hour' from generate_series(1,28) n`, [host]);
  await ageUsage(host, 'open_play');
  await assert.rejects(publish({ start: future(80), end: future(82) }), /up to 30 activities in 24 hours/);
  await assert.rejects(publish({ start: future(80), end: future(82) }, true), /up to 30 activities in 24 hours/);
  await ageUsage(host, 'open_play', 25);
  await as('postgres');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: 'service_role' })]);
  await db.query(`insert into public.open_play_sessions(id,organizer_id,venue_id,name,status,scheduled_start,scheduled_end)
    select 'historic-session-' || n, $1, 'venue-a', 'Existing session', 'active', $2::timestamptz, $3::timestamptz from generate_series(1,100) n`, [host, start, end]);
  await as('authenticated', host);
  await assert.rejects(publish({ start: future(80), end: future(82) }), /up to 100 upcoming activities/);
  console.log('PASS organizer daily and upcoming limits cover current and legacy publication');

  await as('authenticated', stranger);
  await assert.rejects(db.query('select * from app_private.activity_creation_log'), /permission denied/);
  await assert.rejects(db.query("select * from app_private.create_scheduled_activity_impl('open_play','Bypass',$1,$2,'doubles','casual','open',8,'Court')", [start, end]), /permission denied/);
  await assert.rejects(db.query("insert into public.scheduled_games(host_id,title,starts_at,ends_at,court_label) values ($1,'Bypass',$2,$3,'Court')", [stranger, start, end]), /permission denied/);
  await as('authenticated');
  await assert.rejects(create(), /Sign in/);
  await as('anon');
  await assert.rejects(create(), /permission denied/);
  await assert.rejects(publish(), /permission denied/);
  await assert.rejects(db.query('select * from public.list_my_scheduled_games($1,$2)', [start, end]), /permission denied/);
  console.log('PASS private implementations, quota ledger, direct scheduled writes and anonymous RPCs cannot bypass protection');
} finally {
  await db.close();
}
