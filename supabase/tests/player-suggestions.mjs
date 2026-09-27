import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Exercise the shipped SQL in isolated PostgreSQL, without hosted credentials.
const db = new PGlite();
const migration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const viewer = uuid(1);
const connection = uuid(2);
const local = uuid(3);
const legacyLocal = uuid(4);
const remote = uuid(5);
const mutual = uuid(6);
const oneWayRecommendation = uuid(7);
const noArea = uuid(8);
const otherRegion = uuid(9);
const otherCountry = uuid(10);
const remoteTeammate = uuid(11);
const remoteFollower = uuid(12);
const remoteOpponent = uuid(13);
const remoteSessionPlayer = uuid(14);
const newViewer = uuid(15);
const city = 'Navotas · NCR · Philippines';
async function as(role, id = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, sub: id })]);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}
const suggestions = async (limit = 20) => (await db.query('select * from public.get_player_suggestions($1)', [limit])).rows;
const suggestionIds = async (limit = 20) => (await suggestions(limit)).map((row) => row.id);
const profile = (id, area) => db.query(
  'insert into public.profiles(id, display_name, home_area) values ($1, $2, $3)',
  [id, `Player ${id.slice(-2)}`, area],
);

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
    $$;
    create table public.profiles (
      id uuid primary key, display_name text, avatar_url text, home_area text,
      skill_rating numeric default 3.5, profile_visibility text default 'public',
      onboarding_completed boolean default true, is_banned boolean default false,
      updated_at timestamptz default now()
    );
    create table public.player_follows (
      follower_id uuid references public.profiles, followed_id uuid references public.profiles,
      created_at timestamptz default now(), primary key (follower_id, followed_id)
    );
    create table public.player_follow_requests (requester_id uuid, recipient_id uuid);
    create table public.chat_user_blocks (blocker_id uuid, blocked_id uuid);
    create table public.player_activity (user_id uuid primary key, last_active_at timestamptz);
    create table public.team_members (team_id uuid, user_id uuid);
    create table public.open_play_players (session_id uuid, user_id uuid, registration_status text);
    create table public.matches (id uuid primary key, status text, mode text, match_type text, verification_status text);
    create table public.match_participants (match_id uuid, user_id uuid);
    create table public.player_ratings (
      user_id uuid, format text, rating numeric, verified_matches integer,
      wins integer, losses integer
    );
  `);
  // Load existing helper implementations instead of reproducing their logic.
  const pickleball = await migration('202607170004_priority_6_pickleball.sql');
  await db.exec(pickleball.slice(
    pickleball.indexOf('create or replace function public.shares_team_with'),
    pickleball.indexOf('create or replace function public.confirm_match_result'),
  ));
  const privacy = await migration('202608190002_high_severity_security_hardening.sql');
  await db.exec(privacy.slice(
    privacy.indexOf('create or replace function public.can_view_competitive_profile'),
    privacy.indexOf('create or replace function public.get_my_profile'),
  ));
  await db.exec(await migration('202607300004_public_profile_mutual_connections.sql'));
  await db.exec(await migration('202609260016_leaderboard_home_area_match.sql'));
  await db.exec(await migration('202609270001_smarter_player_suggestions.sql'));
  await db.exec(await migration('202609270003_suggestions_match_area_by_city.sql'));

  for (const [id, area] of [
    [viewer, city], [connection, 'Manila'], [local, city], [legacyLocal, ' navotas '],
    [remote, 'Cebu City'], [mutual, 'Davao City'], [oneWayRecommendation, 'Baguio'],
    [noArea, null], [otherRegion, 'Navotas · Other region · Philippines'],
    [otherCountry, 'Navotas · NCR · Other country'], [remoteTeammate, 'Manila'],
    [remoteFollower, 'Manila'], [remoteOpponent, 'Manila'], [remoteSessionPlayer, 'Manila'],
    [newViewer, null],
  ]) await profile(id, area);
  await db.query(`
    insert into public.player_follows(follower_id, followed_id)
    values ($1,$2), ($2,$1), ($3,$2), ($2,$3), ($2,$4), ($5,$1)
  `, [viewer, connection, mutual, oneWayRecommendation, remoteFollower]);
  await db.query('insert into public.team_members values ($1,$2), ($1,$3)', [uuid(100), viewer, remoteTeammate]);
  await db.query("insert into public.matches(id,status) values ($1,'completed')", [uuid(101)]);
  await db.query('insert into public.match_participants values ($1,$2), ($1,$3)', [uuid(101), viewer, remoteOpponent]);
  await db.query("insert into public.open_play_players values ($1,$2,'approved'), ($1,$3,'approved')", [uuid(102), viewer, remoteSessionPlayer]);
  await db.query("update public.profiles set avatar_url = 'profile.jpg' where id = $1", [remote]);

  await as('authenticated', viewer);
  assert.ok((await suggestionIds()).includes(remote), 'Reproduce unrelated remote-player fallback before the fix');
  const previous = (await suggestions()).find((row) => row.id === oneWayRecommendation);
  assert.equal(Number(previous.mutuals), 1);
  assert.equal((await scalar('select public.get_player_mutual_connections($1) as value', [oneWayRecommendation])).count, 0);
  console.log('PASS reproduced global fallback and inconsistent mutual counts in the previous migration');

  await as('postgres');
  await db.exec(await migration('202609270004_require_relevant_player_suggestions.sql'));
  const areaCases = [
    [city, city, true], [city, 'Navotas', true], ['Navotas', city, true],
    [city, ' NAVOTAS· ncr · philippines ', true],
    [city, 'Manila · NCR · Philippines', false],
    [city, 'Navotas · Other region · Philippines', false],
    [city, 'Navotas · NCR · Other country', false],
    [city, 'Navotas · · Other country', false],
    [null, null, false], ['', '', false], [' ', ' ', false],
    [null, city, false], [city, '', false],
    [' · NCR · Philippines', ' · NCR · Philippines', false],
  ];
  for (const [a, b, expected] of areaCases) {
    assert.equal(await scalar('select public.same_home_area($1,$2) as value', [a, b]), expected, `${a} vs ${b}`);
  }
  console.log('PASS home cities normalize case/spacing, preserve legacy values, and reject blank or conflicting locations');

  await as('authenticated', viewer);
  const rows = await suggestions();
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set([local, legacyLocal, mutual]));
  assert.equal(rows[0].id, mutual);
  assert.equal(rows.find((row) => row.id === local).reason, 'Plays in your area');
  assert.equal(rows.find((row) => row.id === mutual).reason, '1 mutual connection');
  for (const row of rows) {
    const preview = await scalar('select public.get_player_mutual_connections($1) as value', [row.id]);
    assert.equal(Number(row.mutuals), preview.count);
  }
  assert.equal((await suggestions(1)).length, 1);
  assert.equal((await suggestions(null)).length, 3);
  assert.equal((await suggestions(100)).length, 3, 'Never fill remaining slots with unrelated players');
  console.log('PASS only same-area or shared-connection players qualify, with consistent reasons and mutual counts');

  // Each exclusion must still win even when a player has a matching home area.
  for (const [label, sql, params] of [
    ['banned', 'update public.profiles set is_banned = true where id = $1', [local]],
    ['incomplete', 'update public.profiles set onboarding_completed = false where id = $1', [local]],
    ['private', "update public.profiles set profile_visibility = 'private' where id = $1", [local]],
    ['inactive', "update public.profiles set updated_at = now() - interval '31 days' where id = $1", [local]],
    ['followed', 'insert into public.player_follows(follower_id,followed_id) values ($1,$2)', [viewer, local]],
    ['pending', 'insert into public.player_follow_requests values ($1,$2)', [viewer, local]],
    ['dismissed', 'insert into public.player_suggestion_dismissals(viewer_id,dismissed_id) values ($1,$2)', [viewer, local]],
    ['blocked by viewer', 'insert into public.chat_user_blocks values ($1,$2)', [viewer, local]],
    ['blocks viewer', 'insert into public.chat_user_blocks values ($1,$2)', [local, viewer]],
  ]) {
    await as('postgres');
    await db.exec('begin');
    try {
      await db.query(sql, params);
      await as('authenticated', viewer);
      assert.ok(!(await suggestionIds()).includes(local), label);
    } finally {
      await db.exec('rollback');
    }
  }
  console.log('PASS existing privacy, blocks, bans, dismissals, requests, follows and inactivity exclusions remain enforced');

  await as('postgres');
  await db.query("update public.profiles set profile_visibility = 'members' where id = $1", [local]);
  await as('authenticated', viewer);
  assert.equal((await suggestions()).find((row) => row.id === local).skill_rating, null);
  await as('postgres');
  await db.query("update public.profiles set home_area = null where id = $1", [viewer]);
  await as('authenticated', viewer);
  assert.deepEqual(await suggestionIds(), [mutual], 'Missing home area still permits a real mutual connection');
  await as('postgres');
  await db.query('delete from public.player_follows where follower_id = $1 and followed_id = $2', [mutual, connection]);
  await as('authenticated', viewer);
  assert.deepEqual(await suggestions(), [], 'Losing the last qualifying connection must not trigger a global fallback');
  await as('authenticated', newViewer);
  assert.deepEqual(await suggestions(), [], 'New players without a home area or connections get an empty list');
  await as('authenticated');
  assert.deepEqual(await suggestions(), []);
  await as('anon');
  await assert.rejects(suggestions(), /permission denied/);
  console.log('PASS hidden ratings, missing areas, disconnected/new viewers and anonymous access');

  // The area helper is also used by the local leaderboard: check its integration.
  await as('postgres');
  await db.query('update public.profiles set home_area = $1 where id = $2', [city, viewer]);
  for (const id of [local, legacyLocal, remote, otherRegion, otherCountry]) {
    await db.query("insert into public.player_ratings values ($1,'doubles',1500,1,1,0)", [id]);
  }
  await as('authenticated', viewer);
  const board = await scalar("select public.get_player_leaderboard('doubles','local',50) as value");
  assert.deepEqual(new Set(board.standings.map((row) => row.user_id)), new Set([local, legacyLocal]));
  console.log('PASS local leaderboard respects the corrected home-area comparison');

  // People you may know: relationships qualify from any area, location only adds weight.
  await as('postgres');
  await db.exec(await migration('202609270006_people_you_may_know_ranking.sql'));
  const nearby = uuid(16);
  await profile(nearby, 'Malabon · NCR · Philippines');
  for (const [a, b, expected] of [
    [city, 'Malabon · NCR · Philippines', true], [city, city, false], [city, 'Navotas', false],
    [city, 'Navotas · Other region · Philippines', false], [city, 'Malabon · NCR · Other country', false],
    ['Navotas', 'Malabon', false], [null, city, false],
  ]) {
    assert.equal(await scalar('select public.same_home_region($1,$2) as value', [a, b]), expected, `region ${a} vs ${b}`);
  }
  await as('authenticated', viewer);
  const ranked = await suggestions();
  const rankedIds = ranked.map((row) => row.id);
  assert.deepEqual(new Set(rankedIds), new Set([
    remoteTeammate, remoteFollower, remoteOpponent, remoteSessionPlayer,
    local, legacyLocal, mutual, oneWayRecommendation, nearby,
  ]));
  for (const id of [remote, otherRegion, otherCountry, noArea, newViewer, connection]) {
    assert.ok(!rankedIds.includes(id), `unrelated or followed player ${id} excluded`);
  }
  assert.deepEqual(rankedIds.slice(0, 2), [remoteTeammate, remoteFollower]);
  assert.ok(rankedIds.indexOf(local) < rankedIds.indexOf(oneWayRecommendation), 'same city outranks one network follow');
  assert.equal(rankedIds.at(-1), nearby, 'same region ranks below every connection');
  const reasonOf = (id) => ranked.find((row) => row.id === id).reason;
  assert.equal(reasonOf(remoteTeammate), 'Teammate');
  assert.equal(reasonOf(remoteFollower), 'Follows you');
  assert.equal(reasonOf(remoteOpponent), 'Played with you');
  assert.equal(reasonOf(remoteSessionPlayer), 'Played with you');
  assert.equal(reasonOf(oneWayRecommendation), `Followed by Player ${connection.slice(-2)}`);
  assert.equal(reasonOf(nearby), 'Plays near you');
  for (const row of ranked) {
    const preview = await scalar('select public.get_player_mutual_connections($1) as value', [row.id]);
    assert.equal(Number(row.mutuals), preview.count);
  }
  await as('authenticated', newViewer);
  assert.deepEqual(await suggestions(), [], 'Unconnected viewers still get no global fallback');
  console.log('PASS teammates, opponents, followers and friends-of-friends qualify from any area, ranked by weighted signals');
  console.log('Player suggestion database checks passed. No hosted database accessed.');
} finally {
  await db.close();
}
