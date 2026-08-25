-- Introduces the owner price vs. player price split. Venue owners set
-- owner_hourly_price (what they actually earn per hour); the platform adds
-- a markup on top to produce hourly_price, the player-facing price every
-- existing screen and booking RPC already reads. A trigger keeps
-- hourly_price in sync, so nothing that displays or charges hourly_price
-- today needs to change — only the write paths where an owner sets a price.

create table public.platform_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.platform_config enable row level security;

create policy "authenticated read platform config"
on public.platform_config for select to authenticated
using (true);

insert into public.platform_config (key, value) values
  ('platform_fee_rate', '0.20'),
  ('min_withdrawal_amount', '500.00'),
  ('withdrawal_large_amount_threshold', '10000'),
  ('withdrawal_very_large_amount_threshold', '50000'),
  ('cancellation_owner_fee_rate', '0.15'),
  ('cancellation_platform_fee_rate', '0.05')
on conflict (key) do nothing;

alter table public.courts
  add column owner_hourly_price numeric(10,2),
  add column platform_fee_rate  numeric(5,4);

update public.courts set owner_hourly_price = hourly_price where owner_hourly_price is null;

alter table public.courts
  alter column owner_hourly_price set not null,
  add constraint courts_owner_hourly_price_check check (owner_hourly_price >= 0),
  add constraint courts_platform_fee_rate_check
    check (platform_fee_rate is null or (platform_fee_rate >= 0 and platform_fee_rate <= 1));

create or replace function public.get_court_player_price(
  p_owner_price numeric,
  p_court_fee_rate numeric default null
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(
    p_owner_price * (1 + coalesce(
      p_court_fee_rate,
      (select value::numeric from public.platform_config where key = 'platform_fee_rate')
    )),
    2
  )
$$;

revoke all on function public.get_court_player_price(numeric, numeric) from public;
grant execute on function public.get_court_player_price(numeric, numeric) to authenticated;

create or replace function public.sync_court_player_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.hourly_price := public.get_court_player_price(new.owner_hourly_price, new.platform_fee_rate);
  return new;
end;
$$;

drop trigger if exists sync_court_player_price on public.courts;
create trigger sync_court_player_price
before insert or update of owner_hourly_price, platform_fee_rate on public.courts
for each row execute function public.sync_court_player_price();

-- Re-fire the trigger for every pre-existing row so hourly_price reflects
-- the markup immediately instead of only on the next owner edit.
update public.courts set owner_hourly_price = owner_hourly_price;

create or replace function public.admin_recompute_court_prices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  update public.courts set owner_hourly_price = owner_hourly_price;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.admin_recompute_court_prices() from public;
grant execute on function public.admin_recompute_court_prices() to authenticated;

-- Owner-facing court creation now takes the owner's price; the trigger
-- above derives the player-facing hourly_price from it. Parameter is
-- renamed from p_hourly_price, so the old signature must be dropped first
-- (CREATE OR REPLACE cannot rename parameters).
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_venue(p_venue_id) then raise exception 'Venue access required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Court name is required'; end if;
  if p_environment not in ('Indoor', 'Outdoor', 'Mixed') then raise exception 'Choose a valid environment'; end if;
  if char_length(trim(coalesce(p_surface, ''))) < 2 then raise exception 'Court surface is required'; end if;
  if p_owner_hourly_price is null or p_owner_hourly_price < 0 then raise exception 'Hourly price cannot be negative'; end if;

  insert into public.courts (id, venue_id, name, environment, surface, owner_hourly_price)
  values (
    p_venue_id || '-court-' || gen_random_uuid()::text,
    p_venue_id,
    trim(p_name),
    p_environment,
    trim(p_surface),
    p_owner_hourly_price
  )
  returning * into created;

  return created;
end
$$;

revoke all on function public.create_venue_court(text, text, text, text, numeric) from public;
grant execute on function public.create_venue_court(text, text, text, text, numeric) to authenticated;
