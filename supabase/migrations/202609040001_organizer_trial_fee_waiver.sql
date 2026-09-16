-- The organizer-web marketing site promises a 14-day trial with a 0%
-- Peakle booking fee and no subscription. Today that's only a claim: signup
-- writes trial_requested / trial_length_days / trial_platform_fee_rate into
-- auth user_metadata, but nothing reads it — handle_new_user() ignores it,
-- courts.platform_fee_rate stays null (20% global default), and app_mode
-- stays 'player' even for organizer signups. This migration makes the
-- trial real: a tracked trial window per account, an automatic 0% fee on
-- courts an organizer creates while trialing, and an automatic revert once
-- the trial ends — plus visibility for platform admins.

create table public.organizer_trials (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null,
  fee_rate_override numeric(5,4) not null default 0
    check (fee_rate_override >= 0 and fee_rate_override <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_ends_at > trial_started_at)
);

alter table public.organizer_trials enable row level security;

revoke all on table public.organizer_trials from anon, authenticated;
grant select on table public.organizer_trials to authenticated;

create policy "users read own trial"
on public.organizer_trials for select to authenticated
using (user_id = auth.uid() or public.is_platform_admin());

create trigger organizer_trials_updated
before update on public.organizer_trials
for each row execute function public.set_updated_at();

-- account_type/trial_* were already being written to user_metadata at
-- signup (organizer-web/components/providers.tsx) but ignored here.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url, home_area, skill_rating, play_preference, app_mode)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'home_area',
    nullif(new.raw_user_meta_data ->> 'skill_rating', '')::numeric,
    nullif(new.raw_user_meta_data ->> 'play_preference', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'account_type', ''), 'player')
  );

  if (new.raw_user_meta_data ->> 'trial_requested')::boolean is true then
    insert into public.organizer_trials (user_id, trial_ends_at, fee_rate_override)
    values (
      new.id,
      now() + make_interval(days => coalesce(nullif(new.raw_user_meta_data ->> 'trial_length_days', '')::int, 14)),
      coalesce(nullif(new.raw_user_meta_data ->> 'trial_platform_fee_rate', '')::numeric, 0)
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end $$;

create or replace function public.organizer_trial_is_active(target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizer_trials trial
    where trial.user_id = target_user
      and trial.trial_ends_at > now()
  )
$$;

revoke all on function public.organizer_trial_is_active(uuid) from public;
grant execute on function public.organizer_trial_is_active(uuid) to authenticated;

-- Marks courts whose 0% platform_fee_rate came from the trial waiver (as
-- opposed to an admin manually pricing a court at 0%), so the expiry job
-- below only ever touches rows it granted.
alter table public.courts
  add column trial_fee_waived boolean not null default false;

drop function if exists public.create_venue_court(text, text, text, text, numeric);

create or replace function public.create_venue_court(
  p_venue_id text,
  p_name text,
  p_environment text,
  p_surface text,
  p_owner_hourly_price numeric
)
returns public.courts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created public.courts;
  waiving_trial boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_venue(p_venue_id) then raise exception 'Venue access required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Court name is required'; end if;
  if p_environment not in ('Indoor', 'Outdoor', 'Mixed') then raise exception 'Choose a valid environment'; end if;
  if char_length(trim(coalesce(p_surface, ''))) < 2 then raise exception 'Court surface is required'; end if;
  if p_owner_hourly_price is null or p_owner_hourly_price < 0 then raise exception 'Hourly price cannot be negative'; end if;

  waiving_trial := public.organizer_trial_is_active(auth.uid());

  insert into public.courts (id, venue_id, name, environment, surface, owner_hourly_price, platform_fee_rate, trial_fee_waived)
  values (
    p_venue_id || '-court-' || gen_random_uuid()::text,
    p_venue_id,
    trim(p_name),
    p_environment,
    trim(p_surface),
    p_owner_hourly_price,
    case when waiving_trial then
      (select fee_rate_override from public.organizer_trials where user_id = auth.uid())
    else null end,
    waiving_trial
  )
  returning * into created;

  return created;
end
$$;

revoke all on function public.create_venue_court(text, text, text, text, numeric) from public;
grant execute on function public.create_venue_court(text, text, text, text, numeric) to authenticated;

-- Reverts courts back to the standard platform fee once their owner's
-- trial window has passed. Runs as a daily cron job (below); safe to call
-- manually too since it only ever touches trial_fee_waived rows.
create or replace function public.expire_organizer_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.courts court
  set platform_fee_rate = null,
      trial_fee_waived = false
  where court.trial_fee_waived = true
    and court.venue_id in (
      select member.venue_id
      from public.venue_members member
      join public.organizer_trials trial on trial.user_id = member.user_id
      where member.role = 'owner'
        and trial.trial_ends_at <= now()
    );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_organizer_trials() from public;
grant execute on function public.expire_organizer_trials() to service_role;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'expire-organizer-trials') then
    perform cron.unschedule('expire-organizer-trials');
  end if;
  perform cron.schedule(
    'expire-organizer-trials',
    '15 0 * * *',
    $job$select public.expire_organizer_trials();$job$
  );
end
$cron$;

-- Surface trial status to platform admins (admin-web Users list/detail).
drop function if exists public.admin_list_users(text, integer);

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
  avatar_url text,
  trial_ends_at timestamptz
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
    profile.avatar_url,
    trial.trial_ends_at
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join public.organizer_entitlements entitlement
    on entitlement.user_id = profile.id and entitlement.status in ('active', 'trialing')
  left join public.organizer_trials trial on trial.user_id = profile.id
  where trim(p_search) = ''
    or profile.display_name ilike '%' || trim(p_search) || '%'
    or account.email ilike '%' || trim(p_search) || '%'
  order by profile.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.admin_list_users(text, integer) from public;
grant execute on function public.admin_list_users(text, integer) to authenticated;

drop function if exists public.admin_get_user(uuid);

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
  avatar_url text,
  trial_ends_at timestamptz
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
    profile.avatar_url,
    trial.trial_ends_at
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join public.organizer_entitlements entitlement
    on entitlement.user_id = profile.id and entitlement.status in ('active', 'trialing')
  left join public.organizer_trials trial on trial.user_id = profile.id
  where profile.id = p_user_id;
end;
$$;

revoke all on function public.admin_get_user(uuid) from public;
grant execute on function public.admin_get_user(uuid) to authenticated;

notify pgrst, 'reload schema';
