-- Give verified venue staff a secure, app-facing way to maintain their courts.
-- Venue creation and staff assignment stay admin-controlled: authenticated
-- users cannot grant themselves access to a venue.

create table public.venue_members (
  venue_id text not null references public.venues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner', 'manager')),
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

alter table public.venue_members enable row level security;

create policy "venue staff read own access"
on public.venue_members for select to authenticated
using (user_id = auth.uid());

create or replace function public.can_manage_venue(target_venue_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.venue_members membership
    where membership.venue_id = target_venue_id
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'manager')
  )
$$;

revoke all on function public.can_manage_venue(text) from public;
grant execute on function public.can_manage_venue(text) to authenticated;

create policy "venue staff read managed venues"
on public.venues for select to authenticated
using (public.can_manage_venue(id));

create policy "venue staff update managed venues"
on public.venues for update to authenticated
using (public.can_manage_venue(id))
with check (public.can_manage_venue(id));

create policy "venue staff read managed courts"
on public.courts for select to authenticated
using (public.can_manage_venue(venue_id));

create policy "venue staff create managed courts"
on public.courts for insert to authenticated
with check (public.can_manage_venue(venue_id));

create policy "venue staff update managed courts"
on public.courts for update to authenticated
using (public.can_manage_venue(venue_id))
with check (public.can_manage_venue(venue_id));

create or replace function public.create_venue_court(
  p_venue_id text,
  p_name text,
  p_environment text,
  p_surface text,
  p_hourly_price numeric
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
  if p_hourly_price is null or p_hourly_price < 0 then raise exception 'Hourly price cannot be negative'; end if;

  insert into public.courts (id, venue_id, name, environment, surface, hourly_price)
  values (
    p_venue_id || '-court-' || gen_random_uuid()::text,
    p_venue_id,
    trim(p_name),
    p_environment,
    trim(p_surface),
    p_hourly_price
  )
  returning * into created;

  return created;
end
$$;

revoke all on function public.create_venue_court(text, text, text, text, numeric) from public;
grant execute on function public.create_venue_court(text, text, text, text, numeric) to authenticated;

