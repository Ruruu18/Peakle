import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { checkAccountAccess } from '../functions/_shared/account-access.ts';

// Real PostgreSQL semantics in an isolated database. No hosted credentials.
const db = new PGlite();
const admin = '11111111-1111-4111-8111-111111111111';
const player = '22222222-2222-4222-8222-222222222222';
const alreadyBanned = '33333333-3333-4333-8333-333333333333';
const otherAdmin = '44444444-4444-4444-8444-444444444444';
const issuedAt = Math.floor(Date.now() / 1000) - 60;
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
async function as(role, id = '', iat = issuedAt) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, sub: id, iat })]);
}
async function rest(sql, params = []) {
  // PostgREST calls the configured hook inside the request transaction, before
  // any table or RPC query. A definer RPC alone does not run a pre-request hook.
  await db.exec('begin');
  try {
    await db.query('select public.enforce_account_access()');
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}
const suspended = error => error.code === 'PT403';

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create schema storage; create schema app_private;
    grant usage on schema auth, storage, app_private to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    create table auth.users(id uuid primary key, banned_until timestamptz, updated_at timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users);
    create table auth.refresh_tokens(id int, user_id varchar(255), session_id uuid references auth.sessions on delete cascade);
    create table profiles(id uuid primary key references auth.users, display_name text, is_banned boolean not null default false, ban_reason text);
    create table platform_admins(user_id uuid primary key references profiles);
    create function is_platform_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;
    create table player_records(id int generated always as identity, user_id uuid, kind text, body text);
    create table storage.objects(id int generated always as identity, owner_id uuid, name text);
    alter table profiles enable row level security;
    alter table platform_admins enable row level security;
    alter table player_records enable row level security;
    alter table storage.objects enable row level security;
    create policy own_profile on profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
    create policy own_admin_row on platform_admins for select to authenticated using(user_id=auth.uid());
    create policy own_records on player_records for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy own_storage on storage.objects for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    grant all on profiles, platform_admins, player_records, storage.objects to authenticated, service_role;
    grant usage, select on all sequences in schema public, storage to authenticated, service_role;
    -- Deliberately RLS-bypassing RPC: this verifies coverage beyond policies.
    create function write_player_record(p_kind text) returns void language sql security definer set search_path='' as $$ insert into public.player_records(user_id,kind,body) values(auth.uid(),p_kind,'saved') $$;
    grant execute on function write_player_record(text) to authenticated;
    insert into auth.users(id) values('${admin}'),('${player}'),('${alreadyBanned}'),('${otherAdmin}');
    insert into profiles(id,display_name,is_banned) values('${admin}','Admin',false),('${player}','Player',false),('${alreadyBanned}','Previously banned',true),('${otherAdmin}','Other admin',false);
    insert into platform_admins values('${admin}'),('${otherAdmin}');
    insert into auth.sessions values('${player}','${player}'),('${alreadyBanned}','${alreadyBanned}');
    insert into auth.refresh_tokens values(1,'${player}','${player}'),(2,'${alreadyBanned}','${alreadyBanned}');
    insert into player_records(user_id,kind,body) values('${player}','booking','preserve me');
    insert into storage.objects(owner_id,name) values('${player}','private-photo');
  `);
  // Load the shipped admin RPC definitions rather than duplicating their logic.
  const original = await readFile(new URL('../migrations/202608190001_admin_user_management.sql', import.meta.url), 'utf8');
  await db.exec(original.slice(original.indexOf('create or replace function public.admin_ban_user'), original.indexOf('create or replace function public.admin_find_user_by_email')));
  await db.exec(await readFile(new URL('../migrations/202609240001_enforce_account_bans.sql', import.meta.url), 'utf8'));
  assert.equal(await scalar(`select count(*)::int as value from auth.sessions where user_id='${alreadyBanned}'`), 0);
  assert.equal(await scalar(`select banned_until > now() as value from auth.users where id='${alreadyBanned}'`), true);
  assert.ok((await scalar("select rolconfig as value from pg_roles where rolname='authenticator'")).includes('pgrst.db_pre_request=public.enforce_account_access'));
  console.log('PASS migration activates previous bans and registers the request hook');

  await as('authenticated', player);
  assert.equal((await rest('select * from player_records')).rows.length, 1);
  await db.query("update profiles set display_name='Updated Player' where id=$1", [player]);
  await assert.rejects(db.query('update profiles set is_banned=true where id=$1', [player]), /suspension fields/);
  await assert.rejects(db.query("update profiles set access_revoked_at=now() where id=$1", [player]), /suspension fields/);
  await assert.rejects(db.query("update profiles set ban_reason='spoofed' where id=$1", [player]), /suspension fields/);
  await assert.rejects(db.query("insert into profiles(id,display_name,is_banned) values($1,'Spoofed',true) on conflict(id) do update set is_banned=excluded.is_banned", [player]), /suspension fields/);
  await assert.rejects(rest("select admin_ban_user($1,'unauthorized')", [admin]), /Platform admin access required/);
  console.log('PASS ordinary profile edits work; clients cannot forge suspension fields or ban others');

  await as('authenticated', admin);
  await assert.rejects(rest("select admin_ban_user($1,'self')", [admin]), /own account/);
  await assert.rejects(rest("select admin_ban_user($1,'  ')", [player]), /reason is required/);
  await rest("select admin_ban_user($1,'Repeated abuse')", [player]);
  await as('postgres');
  assert.equal(await scalar('select banned_until > now() as value from auth.users where id=$1', [player]), true);
  assert.equal(await scalar('select count(*)::int as value from auth.sessions where user_id=$1', [player]), 0);
  assert.equal(await scalar('select count(*)::int as value from auth.refresh_tokens where user_id=$1', [player]), 0);
  assert.equal(await scalar('select count(*)::int as value from player_records where user_id=$1', [player]), 1);

  await as('authenticated', player);
  for (const kind of ['booking', 'registration', 'scoring', 'chat']) {
    await assert.rejects(rest('select write_player_record($1)', [kind]), suspended);
  }
  await assert.rejects(rest('select * from player_records'), suspended);
  assert.equal((await db.query('select * from player_records')).rows.length, 0);
  assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
  assert.equal((await db.query("update player_records set body='bypass' returning *")).rows.length, 0);
  await assert.rejects(db.query("insert into player_records(user_id,kind) values($1,'bypass')", [player]), /row-level security/);
  await assert.rejects(db.query("insert into storage.objects(owner_id,name) values($1,'bypass')", [player]), /row-level security/);
  console.log('PASS ban revokes Auth sessions and blocks old-token REST/RPC, direct RLS, and private storage access');

  await as('authenticated', admin);
  await rest('select admin_unban_user($1)', [player]);
  await as('postgres');
  assert.equal(await scalar('select banned_until as value from auth.users where id=$1', [player]), null);
  await as('authenticated', player);
  await assert.rejects(rest('select * from player_records'), suspended);
  await as('authenticated', player, Math.floor(Date.now() / 1000) + 2);
  assert.equal((await rest('select * from player_records')).rows[0].body, 'preserve me');
  await rest("select write_player_record('chat')");
  assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
  console.log('PASS unban requires a new token and preserves records/ordinary access');

  await as('authenticated', admin);
  await rest("select admin_ban_user($1,'Suspended admin')", [otherAdmin]);
  await as('authenticated', otherAdmin);
  assert.equal(await scalar('select is_platform_admin() as value'), false);
  await assert.rejects(db.query('select admin_unban_user($1)', [player]), /Platform admin access required/);
  await as('anon');
  await rest('select 1');
  await as('service_role', player);
  await rest('select 1');
  console.log('PASS suspended admins lose privilege; anonymous public reads and service jobs remain available');

  assert.equal(await checkAccountAccess({ rpc: async () => ({ error: null }) }), null);
  assert.equal((await checkAccountAccess({ rpc: async () => ({ error: { code: 'PT403' } }) })).status, 403);
  assert.equal((await checkAccountAccess({ rpc: async () => ({ error: { code: 'PGRST202' } }) })).status, 503);
  assert.equal((await checkAccountAccess({ rpc: async () => { throw new Error('network'); } })).status, 503);
  console.log('PASS Edge access checks deny revoked tokens and fail closed on missing migration/network errors');
} finally {
  await db.close();
}
