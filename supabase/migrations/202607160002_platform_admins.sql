-- Platform admins approve and manage venues across Peakle. This role is
-- separate from organizer mode and venue ownership, and cannot be self-granted
-- by an authenticated client.

create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id)
);

alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins admin
    where admin.user_id = auth.uid()
  )
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

drop policy if exists "platform admins read admin access" on public.platform_admins;
create policy "platform admins read admin access"
on public.platform_admins for select to authenticated
using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists "platform admins manage venues" on public.venues;
create policy "platform admins manage venues"
on public.venues for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins manage courts" on public.courts;
create policy "platform admins manage courts"
on public.courts for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins manage venue staff" on public.venue_members;
create policy "platform admins manage venue staff"
on public.venue_members for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Initial Peakle administrator requested by the project owner. Older auth
-- accounts may predate the profiles trigger, so repair that profile first.
do $$
declare
  account_id uuid := '714ab268-7fe2-49a9-a3df-251cbaa4b183'::uuid;
  account_name text;
begin
  select
    left(coalesce(
      nullif(account.raw_user_meta_data ->> 'display_name', ''),
      nullif(account.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(account.email, '@', 1), ''),
      'Peakle Admin'
    ), 80)
  into account_name
  from auth.users account
  where account.id = account_id;

  if account_name is null then
    raise exception 'No authenticated user exists for ID 714ab268-7fe2-49a9-a3df-251cbaa4b183.';
  end if;

  insert into public.profiles (id, display_name)
  values (account_id, account_name)
  on conflict (id) do nothing;

  insert into public.platform_admins (user_id)
  values (account_id)
  on conflict (user_id) do nothing;
end
$$;
