import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Exercise the shipped follow SQL in isolated PostgreSQL, without hosted credentials.
const db = new PGlite();
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [ana, ben, priv, blocked] = [uuid(1), uuid(2), uuid(3), uuid(4)];
async function as(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: 'authenticated', sub: id })]);
  await db.exec('set role authenticated');
}
async function asAdmin() { await db.exec('reset role'); }
const call = (sql, params = []) => db.query(sql, params);
const follows = async () => (await asAdminRows('select follower_id, followed_id from public.player_follows order by 1, 2'))
  .map((row) => `${row.follower_id.slice(-1)}>${row.followed_id.slice(-1)}`);
const requests = async () => (await asAdminRows('select requester_id, recipient_id from public.player_follow_requests order by 1, 2'))
  .map((row) => `${row.requester_id.slice(-1)}>${row.recipient_id.slice(-1)}`);
const notices = async (userId) => asAdminRows('select kind, title, body, data from public.user_notifications where user_id = $1 order by created_at, title', [userId]);
async function asAdminRows(sql, params = []) {
  const claims = (await db.query("select current_setting('request.jwt.claims', true) as value")).rows[0].value;
  await asAdmin();
  const rows = (await db.query(sql, params)).rows;
  const sub = claims ? JSON.parse(claims).sub : '';
  if (sub) await as(sub);
  return rows;
}

try {
  await db.exec(`
    create role authenticated;
    create schema auth;
    grant usage on schema auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
    $$;
    create table public.profiles (id uuid primary key, display_name text, avatar_url text, profile_visibility text default 'public');
    create table public.player_follows (
      follower_id uuid references public.profiles, followed_id uuid references public.profiles,
      created_at timestamptz default now(), primary key (follower_id, followed_id)
    );
    create table public.player_follow_requests (
      id uuid primary key default gen_random_uuid(), requester_id uuid, recipient_id uuid,
      unique (requester_id, recipient_id)
    );
    create table public.chat_user_blocks (blocker_id uuid, blocked_id uuid);
    create table public.user_notifications (
      id uuid primary key default gen_random_uuid(), user_id uuid, kind text, title text, body text,
      data jsonb, created_at timestamptz default clock_timestamp()
    );
    create unique index on public.user_notifications (user_id, (data->>'dedupeKey'));
  `);
  await db.exec(await readFile(new URL('../migrations/202609270008_instagram_style_follows.sql', import.meta.url), 'utf8'));
  await db.query(`insert into public.profiles(id, display_name, profile_visibility) values
    ($1,'Ana','public'), ($2,'Ben','members'), ($3,'Priv','private'), ($4,'Blocked','public')`, [ana, ben, priv, blocked]);
  await db.query('insert into public.chat_user_blocks values ($1,$2)', [blocked, ana]);

  await as(ana);
  await call('select public.follow_player($1)', [ben]);
  assert.deepEqual(await follows(), ['1>2'], 'Public follow takes effect immediately and one way only');
  assert.deepEqual(await requests(), []);
  const [started] = await notices(ben);
  assert.equal(started.title, 'Ana started following you');
  assert.equal(started.data.event, 'new_follower');
  await call('select public.follow_player($1)', [ben]);
  assert.equal((await notices(ben)).length, 1, 'Following twice is a no-op');
  console.log('PASS public profiles are followed instantly, one way, with a single notification');

  await as(ben);
  await call('select public.follow_player($1)', [ana]);
  assert.deepEqual(await follows(), ['1>2', '2>1']);
  assert.equal((await notices(ana))[0].body, 'You follow each other now.');
  await call('select public.unfollow_player($1)', [ana]);
  assert.deepEqual(await follows(), ['1>2'], 'Unfollowing keeps the other player\'s follow');
  console.log('PASS follow back makes a mutual pair and unfollow only removes your own follow');

  await as(ana);
  await call('select public.follow_player($1)', [priv]);
  assert.deepEqual(await follows(), ['1>2'], 'Private profiles do not get an instant follow');
  assert.deepEqual(await requests(), ['1>3']);
  assert.equal((await notices(priv))[0].title, 'Ana wants to follow you');
  await as(priv);
  assert.equal((await call('select public.respond_follow_request($1, true) as value', [ana])).rows[0].value, true);
  assert.deepEqual(await follows(), ['1>2', '1>3'], 'Accepting adds only requester -> recipient');
  assert.deepEqual(await requests(), []);
  assert.deepEqual((await notices(priv)).map((row) => row.kind), [], 'Handled request notification is removed');
  assert.equal((await notices(ana))[1].title, 'Priv accepted your follow request');
  console.log('PASS private profiles use requests, and accepting is one way');

  await as(ben);
  await call('select public.follow_player($1)', [priv]);
  await call('select public.unfollow_player($1)', [priv]);
  assert.deepEqual(await requests(), [], 'Unfollowing cancels your pending request');
  assert.deepEqual(await notices(priv), []);
  await as(ana);
  await assert.rejects(call('select public.follow_player($1)', [blocked]), /unavailable/);
  await assert.rejects(call('select public.follow_player($1)', [ana]), /another player/);
  console.log('PASS cancelling requests, blocks and self-follows');
  console.log('Instagram-style follow checks passed. No hosted database accessed.');
} finally {
  await db.close();
}
