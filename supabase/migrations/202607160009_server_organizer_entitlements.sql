-- Organizer access is an account capability, not a client-side preference.
-- This migration makes the database authoritative for new open-play sessions.

create table public.organizer_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  provider text not null,
  product_id text not null,
  tier text not null check (tier in ('plus', 'pro')),
  status text not null check (status in ('active', 'trialing', 'grace_period', 'expired', 'revoked')),
  provider_transaction_id text,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  auto_renews boolean not null default false,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create index organizer_entitlements_access_idx
  on public.organizer_entitlements(user_id, status, current_period_end);

create trigger organizer_entitlements_updated
before update on public.organizer_entitlements
for each row execute function public.set_updated_at();

alter table public.organizer_entitlements enable row level security;

revoke all on table public.organizer_entitlements from anon, authenticated;
grant select on table public.organizer_entitlements to authenticated;

create policy "users read own organizer entitlement"
on public.organizer_entitlements for select to authenticated
using (user_id = auth.uid() or public.is_platform_admin());

create or replace function public.has_active_organizer_entitlement(
  target_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user is not null and (
    exists (
      select 1
      from public.platform_admins administrator
      where administrator.user_id = target_user
    )
    or exists (
      select 1
      from public.organizer_entitlements entitlement
      where entitlement.user_id = target_user
        and entitlement.status in ('active', 'trialing', 'grace_period')
        and entitlement.current_period_end > now()
    )
  )
$$;

revoke all on function public.has_active_organizer_entitlement(uuid) from public;
grant execute on function public.has_active_organizer_entitlement(uuid) to authenticated;

-- Keep ownership and history readable and editable after a pass expires, but
-- require a current server entitlement when creating a brand-new session.
drop policy if exists "organizers own sessions" on public.open_play_sessions;

create policy "organizers read own sessions"
on public.open_play_sessions for select to authenticated
using (organizer_id = auth.uid());

create policy "entitled organizers create sessions"
on public.open_play_sessions for insert to authenticated
with check (
  organizer_id = auth.uid()
  and public.has_active_organizer_entitlement(auth.uid())
);

create policy "organizers update own sessions"
on public.open_play_sessions for update to authenticated
using (organizer_id = auth.uid())
with check (organizer_id = auth.uid());

create policy "organizers delete own sessions"
on public.open_play_sessions for delete to authenticated
using (organizer_id = auth.uid());

-- Payment-free demo RPCs. They deliberately exist only for the current
-- sandbox checkout and must be removed when store/webhook verification ships.
create or replace function public.activate_demo_organizer_pass(p_product_id text)
returns public.organizer_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_entitlement public.organizer_entitlements;
  activated public.organizer_entitlements;
  duration interval;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_product_id = 'organizer_monthly' then
    duration := interval '30 days';
  elsif p_product_id = 'organizer_annual' then
    duration := interval '365 days';
  else
    raise exception 'Unknown Organizer Pass plan';
  end if;

  select * into current_entitlement
  from public.organizer_entitlements
  where user_id = auth.uid()
  for update;

  if current_entitlement.id is not null and current_entitlement.provider <> 'demo' then
    raise exception 'A verified store entitlement already exists';
  end if;

  insert into public.organizer_entitlements (
    user_id, provider, product_id, tier, status, provider_transaction_id,
    current_period_start, current_period_end, auto_renews, verified_at
  ) values (
    auth.uid(), 'demo', p_product_id, 'plus', 'active',
    'demo_' || replace(gen_random_uuid()::text, '-', ''),
    now(), now() + duration, true, now()
  )
  on conflict (user_id) do update set
    provider = excluded.provider,
    product_id = excluded.product_id,
    tier = excluded.tier,
    status = excluded.status,
    provider_transaction_id = excluded.provider_transaction_id,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    auto_renews = excluded.auto_renews,
    verified_at = excluded.verified_at
  returning * into activated;

  return activated;
end;
$$;

create or replace function public.cancel_demo_organizer_pass()
returns public.organizer_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled public.organizer_entitlements;
begin
  update public.organizer_entitlements
  set auto_renews = false,
      verified_at = now()
  where user_id = auth.uid()
    and provider = 'demo'
    and status in ('active', 'trialing', 'grace_period')
    and current_period_end > now()
  returning * into cancelled;

  if cancelled.id is null then
    raise exception 'No active demo Organizer Pass was found';
  end if;

  return cancelled;
end;
$$;

create or replace function public.expire_demo_organizer_pass()
returns public.organizer_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired public.organizer_entitlements;
begin
  update public.organizer_entitlements
  set status = 'expired',
      current_period_start = least(current_period_start, now() - interval '2 seconds'),
      current_period_end = now() - interval '1 second',
      auto_renews = false,
      verified_at = now()
  where user_id = auth.uid()
    and provider = 'demo'
  returning * into expired;

  if expired.id is null then
    raise exception 'No demo Organizer Pass was found';
  end if;

  return expired;
end;
$$;

create or replace function public.restore_demo_organizer_pass()
returns public.organizer_entitlements
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  restored public.organizer_entitlements;
begin
  select * into restored
  from public.organizer_entitlements
  where user_id = auth.uid()
    and provider = 'demo'
    and status in ('active', 'trialing', 'grace_period')
    and current_period_end > now();

  if restored.id is null then
    raise exception 'No active demo purchase was found to restore';
  end if;

  return restored;
end;
$$;

revoke all on function public.activate_demo_organizer_pass(text) from public;
revoke all on function public.cancel_demo_organizer_pass() from public;
revoke all on function public.expire_demo_organizer_pass() from public;
revoke all on function public.restore_demo_organizer_pass() from public;

grant execute on function public.activate_demo_organizer_pass(text) to authenticated;
grant execute on function public.cancel_demo_organizer_pass() to authenticated;
grant execute on function public.expire_demo_organizer_pass() to authenticated;
grant execute on function public.restore_demo_organizer_pass() to authenticated;
