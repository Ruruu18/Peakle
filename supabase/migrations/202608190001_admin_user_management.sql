-- The admin web portal shipped with several placeholders: ban/unban were
-- no-ops, user rows never carried an email or membership tier, the
-- dashboard's gross revenue was hardcoded to zero, and "add admin by email"
-- actually matched against display_name. auth.users isn't reachable from
-- the client, so each of these needs a security-definer RPC (same pattern
-- as find_staff_candidate_by_email) rather than a direct table query.

alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text;

-- profiles has a blanket "readable by signed-in users" select policy and a
-- "users update own profile" policy scoped only by row (id = auth.uid()),
-- not by column. Without this, any user could read another user's ban
-- reason, or unban themselves with a direct table update. Column-level
-- grants close that off while leaving the security-definer functions below
-- (owned by the migration role, not `authenticated`) unaffected.
revoke select (is_banned, ban_reason) on public.profiles from authenticated, anon;
revoke update (is_banned, ban_reason) on public.profiles from authenticated, anon;

create or replace function public.admin_list_users(p_search text default '', p_limit integer default 100)
returns table (
  id uuid,
  display_name text,
  email text,
  created_at timestamptz,
  rating numeric,
  is_banned boolean,
  ban_reason text,
  membership_tier text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'Limit must be between 1 and 200';
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    account.email::text,
    profile.created_at,
    profile.skill_rating,
    profile.is_banned,
    profile.ban_reason,
    entitlement.tier,
    profile.avatar_url
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join public.organizer_entitlements entitlement
    on entitlement.user_id = profile.id and entitlement.status in ('active', 'trialing')
  where trim(p_search) = ''
    or profile.display_name ilike '%' || trim(p_search) || '%'
    or account.email ilike '%' || trim(p_search) || '%'
  order by profile.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.admin_list_users(text, integer) from public;
grant execute on function public.admin_list_users(text, integer) to authenticated;

create or replace function public.admin_get_user(p_user_id uuid)
returns table (
  id uuid,
  display_name text,
  email text,
  created_at timestamptz,
  rating numeric,
  is_banned boolean,
  ban_reason text,
  membership_tier text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    account.email::text,
    profile.created_at,
    profile.skill_rating,
    profile.is_banned,
    profile.ban_reason,
    entitlement.tier,
    profile.avatar_url
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join public.organizer_entitlements entitlement
    on entitlement.user_id = profile.id and entitlement.status in ('active', 'trialing')
  where profile.id = p_user_id;
end;
$$;

revoke all on function public.admin_get_user(uuid) from public;
grant execute on function public.admin_get_user(uuid) to authenticated;

create or replace function public.admin_ban_user(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A ban reason is required';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot ban your own account';
  end if;

  update public.profiles
  set is_banned = true, ban_reason = trim(p_reason)
  where id = p_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

revoke all on function public.admin_ban_user(uuid, text) from public;
grant execute on function public.admin_ban_user(uuid, text) to authenticated;

create or replace function public.admin_unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  update public.profiles
  set is_banned = false, ban_reason = null
  where id = p_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

revoke all on function public.admin_unban_user(uuid) from public;
grant execute on function public.admin_unban_user(uuid) to authenticated;

create or replace function public.admin_find_user_by_email(p_email text)
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
  select profile.id, profile.display_name
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where lower(account.email) = lower(trim(coalesce(p_email, '')))
  limit 1;
end;
$$;

revoke all on function public.admin_find_user_by_email(text) from public;
grant execute on function public.admin_find_user_by_email(text) to authenticated;

create or replace function public.admin_list_platform_admins()
returns table (
  user_id uuid,
  display_name text,
  email text,
  granted_at timestamptz,
  granted_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
  select
    admin.user_id,
    profile.display_name,
    account.email::text,
    admin.granted_at,
    granter.display_name
  from public.platform_admins admin
  join public.profiles profile on profile.id = admin.user_id
  join auth.users account on account.id = admin.user_id
  left join public.profiles granter on granter.id = admin.granted_by
  order by admin.granted_at desc;
end;
$$;

revoke all on function public.admin_list_platform_admins() from public;
grant execute on function public.admin_list_platform_admins() to authenticated;

-- venue_earnings has RLS enabled with no select policy for authenticated
-- users (see 202608060003), so the dashboard's gross revenue figure needs
-- its own security-definer accessor rather than a direct table count.
create or replace function public.admin_get_gross_revenue_this_month()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gross numeric(10,2);
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  select coalesce(sum(total_collected), 0) into v_gross
  from public.venue_earnings
  where created_at >= date_trunc('month', now());

  return v_gross;
end;
$$;

revoke all on function public.admin_get_gross_revenue_this_month() from public;
grant execute on function public.admin_get_gross_revenue_this_month() to authenticated;
