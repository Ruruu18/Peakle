begin;

-- Keep a revocation watermark after unban: previously issued JWTs must not
-- become usable again just because the account is reinstated.
alter table public.profiles add column if not exists access_revoked_at timestamptz;

create or replace function app_private.account_access_allowed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role' or (
    not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_banned or (
          p.access_revoked_at is not null
          and coalesce((auth.jwt() ->> 'iat')::bigint, 0)
            <= floor(extract(epoch from p.access_revoked_at))
        ))
    )
    and not exists (
      select 1 from auth.users u
      where u.id = auth.uid() and u.banned_until > now()
    )
  )
$$;
revoke all on function app_private.account_access_allowed() from public, anon;
grant execute on function app_private.account_access_allowed() to authenticated, service_role;

-- Runs BEFORE every PostgREST table/view/RPC request, including SECURITY
-- DEFINER RPCs that intentionally bypass table RLS. Also called by Edge
-- Functions using the caller's JWT, before they use service-role credentials.
create or replace function public.enforce_account_access()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app_private.account_access_allowed() then
    raise sqlstate 'PT403' using message =
      'Account access is suspended or this session has been revoked. Please sign in again or contact support@peakle.app.';
  end if;
end;
$$;
revoke all on function public.enforce_account_access() from public;
grant execute on function public.enforce_account_access() to anon, authenticated, service_role;

-- Do not silently replace an unrelated production request check. If one has
-- been configured outside this repo, compose it with enforce_account_access
-- before applying this migration. The exception rolls back the whole file.
do $$
declare setting text;
begin
  for setting in
    select unnest(s.setconfig) from pg_db_role_setting s
    where s.setrole = (select oid from pg_roles where rolname = 'authenticator')
      and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
  loop
    if setting like 'pgrst.db_pre_request=%'
       and setting not in ('pgrst.db_pre_request=', 'pgrst.db_pre_request=public.enforce_account_access') then
      raise exception 'An existing PostgREST pre-request hook must be composed with public.enforce_account_access before enabling account bans: %', setting;
    end if;
  end loop;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'public.enforce_account_access';
-- A database-specific setting takes precedence over the role-wide setting.
do $$ begin
  execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',
    current_database(), 'public.enforce_account_access');
end $$;

-- RLS also covers Storage and Realtime reads, where PostgREST's hook does not
-- run. Restrictive policies AND with existing role/ownership policies; they
-- never grant access that the original policies denied. Future tables must
-- receive the same restrictive policy when RLS is enabled.
do $$
declare target record;
begin
  for target in
    select n.nspname, c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.relrowsecurity
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('create policy "active accounts only" on %I.%I as restrictive for all to authenticated using ((select app_private.account_access_allowed())) with check ((select app_private.account_access_allowed()))',
      target.nspname, target.relname);
  end loop;
end;
$$;

-- Column REVOKEs alone do not override a table-wide UPDATE grant. This invoker
-- trigger also protects INSERTs and works even on projects with those legacy
-- broad grants. Admin RPCs execute as their owner, not as authenticated.
create or replace function app_private.protect_account_ban_fields()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.is_banned or new.ban_reason is not null or new.access_revoked_at is not null then
        raise exception 'Account suspension fields can only be changed by an administrator' using errcode = '42501';
      end if;
    elsif new.is_banned is distinct from old.is_banned
       or new.ban_reason is distinct from old.ban_reason
       or new.access_revoked_at is distinct from old.access_revoked_at then
      raise exception 'Account suspension fields can only be changed by an administrator' using errcode = '42501';
    end if;
  end if;
  if new.is_banned and (tg_op = 'INSERT' or not old.is_banned) then
    new.access_revoked_at := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function app_private.protect_account_ban_fields() from public, anon, authenticated;
create trigger protect_account_ban_fields before insert or update on public.profiles
for each row execute function app_private.protect_account_ban_fields();

-- Synchronize the existing admin RPC's flag with Supabase Auth atomically.
-- banned_until is a finite timestamp (GoTrue cannot use PostgreSQL infinity).
-- Only Auth's ban field and this account's sessions/refresh tokens are changed;
-- identities, passwords, bookings, payments, and match history are preserved.
create or replace function app_private.sync_account_ban_to_auth()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.is_banned is not distinct from old.is_banned then
    return new;
  end if;
  if new.is_banned then
    update auth.users set banned_until = now() + interval '100 years', updated_at = now()
    where id = new.id;
    delete from auth.refresh_tokens where user_id = new.id::text;
    delete from auth.sessions where user_id = new.id;
  elsif tg_op = 'UPDATE' and old.is_banned then
    update auth.users set banned_until = null, updated_at = now() where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function app_private.sync_account_ban_to_auth() from public, anon, authenticated;
create trigger sync_account_ban_to_auth after insert or update of is_banned on public.profiles
for each row execute function app_private.sync_account_ban_to_auth();

-- A suspended administrator must also fail checks outside PostgREST (for
-- example inside storage policies). Preserve the existing public signature.
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app_private.account_access_allowed() and exists (
    select 1 from public.platform_admins a where a.user_id = auth.uid()
  )
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Existing bans must take effect as soon as this migration commits as well.
update public.profiles set access_revoked_at = coalesce(access_revoked_at, clock_timestamp()) where is_banned;
update auth.users u set banned_until = now() + interval '100 years', updated_at = now()
from public.profiles p where p.id = u.id and p.is_banned;
delete from auth.refresh_tokens t using public.profiles p where t.user_id = p.id::text and p.is_banned;
delete from auth.sessions s using public.profiles p where s.user_id = p.id and p.is_banned;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
