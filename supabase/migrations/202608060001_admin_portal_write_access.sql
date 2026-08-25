-- The admin web portal needs platform admins to be able to manage the admin
-- roster and organizer entitlements directly, not just read them. The
-- platform_admins table only had a select policy, and organizer_entitlements
-- has table grants locked to select for authenticated — so both need an
-- explicit, admin-gated path in rather than a broad grant loosening.

drop policy if exists "platform admins add admin roster" on public.platform_admins;
create policy "platform admins add admin roster"
on public.platform_admins for insert to authenticated
with check (public.is_platform_admin());

drop policy if exists "platform admins remove admin roster" on public.platform_admins;
create policy "platform admins remove admin roster"
on public.platform_admins for delete to authenticated
using (public.is_platform_admin() and user_id <> auth.uid());

create or replace function public.admin_grant_entitlement(
  p_user_id uuid,
  p_product_id text,
  p_tier text,
  p_period_end timestamptz
)
returns public.organizer_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  granted public.organizer_entitlements;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  insert into public.organizer_entitlements (
    user_id, provider, product_id, tier, status,
    current_period_start, current_period_end, auto_renews, verified_at
  ) values (
    p_user_id, 'admin', p_product_id, p_tier, 'active',
    now(), coalesce(p_period_end, now() + interval '30 days'), false, now()
  )
  on conflict (user_id) do update set
    provider = excluded.provider,
    product_id = excluded.product_id,
    tier = excluded.tier,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    auto_renews = excluded.auto_renews,
    verified_at = excluded.verified_at
  returning * into granted;

  return granted;
end;
$$;

create or replace function public.admin_revoke_entitlement(p_user_id uuid)
returns public.organizer_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked public.organizer_entitlements;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  update public.organizer_entitlements
  set status = 'revoked',
      auto_renews = false,
      verified_at = now()
  where user_id = p_user_id
  returning * into revoked;

  if revoked.id is null then
    raise exception 'No entitlement found for this user';
  end if;

  return revoked;
end;
$$;

revoke all on function public.admin_grant_entitlement(uuid, text, text, timestamptz) from public;
revoke all on function public.admin_revoke_entitlement(uuid) from public;
grant execute on function public.admin_grant_entitlement(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_revoke_entitlement(uuid) to authenticated;
