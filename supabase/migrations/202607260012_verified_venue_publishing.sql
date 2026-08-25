-- Migration version normalized to preserve the original execution order.
-- Keep organizer publishing and all player-facing activity behind venue
-- verification. Client filtering improves the UX; these database rules are
-- the authority when an outdated or modified client attempts to publish.

create or replace function public.is_verified_active_venue(target text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.venues venue
    where venue.id = target
      and venue.verification_status = 'verified'
      and venue.active
  );
$$;

revoke all on function public.is_verified_active_venue(text) from public;
grant execute on function public.is_verified_active_venue(text) to anon, authenticated;

create or replace function public.require_verified_venue_for_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_verified_active_venue(new.venue_id) then
    raise exception 'Venue must be verified and active before publishing';
  end if;
  return new;
end;
$$;

revoke all on function public.require_verified_venue_for_activity() from public;

drop policy if exists "venues are publicly readable" on public.venues;
create policy "venues are publicly readable"
on public.venues
for select
using (
  active
  and verification_status = 'verified'
);

drop policy if exists "courts are publicly readable" on public.courts;
create policy "courts are publicly readable"
on public.courts
for select
using (
  active
  and public.is_verified_active_venue(venue_id)
);

drop trigger if exists venue_programs_require_verified_venue on public.venue_programs;
create trigger venue_programs_require_verified_venue
before insert or update of venue_id
on public.venue_programs
for each row execute function public.require_verified_venue_for_activity();

drop trigger if exists competitions_require_verified_venue on public.competitions;
create trigger competitions_require_verified_venue
before insert or update of venue_id
on public.competitions
for each row execute function public.require_verified_venue_for_activity();

drop trigger if exists membership_products_require_verified_venue on public.membership_products;
create trigger membership_products_require_verified_venue
before insert or update of venue_id
on public.membership_products
for each row execute function public.require_verified_venue_for_activity();

create or replace function public.require_verified_venue_for_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_venue_id text;
begin
  if tg_table_name = 'program_registrations' then
    select program.venue_id into target_venue_id
    from public.venue_programs program
    where program.id = new.program_id;
  elsif tg_table_name = 'competition_entries' then
    select competition.venue_id into target_venue_id
    from public.competitions competition
    where competition.id = new.competition_id;
  elsif tg_table_name = 'player_memberships' then
    select product.venue_id into target_venue_id
    from public.membership_products product
    where product.id = new.product_id;
  end if;

  if not public.is_verified_active_venue(target_venue_id) then
    raise exception 'Registration requires a verified, active venue';
  end if;
  return new;
end;
$$;

revoke all on function public.require_verified_venue_for_registration() from public;

drop trigger if exists program_registrations_require_verified_venue on public.program_registrations;
create trigger program_registrations_require_verified_venue
before insert
on public.program_registrations
for each row execute function public.require_verified_venue_for_registration();

drop trigger if exists competition_entries_require_verified_venue on public.competition_entries;
create trigger competition_entries_require_verified_venue
before insert
on public.competition_entries
for each row execute function public.require_verified_venue_for_registration();

drop trigger if exists player_memberships_require_verified_venue on public.player_memberships;
create trigger player_memberships_require_verified_venue
before insert
on public.player_memberships
for each row execute function public.require_verified_venue_for_registration();

drop policy if exists "published competitions are readable" on public.competitions;
create policy "published competitions are readable"
on public.competitions
for select
to authenticated
using (
  (
    visibility = 'public'
    and public.is_verified_active_venue(venue_id)
  )
  or organizer_id = auth.uid()
  or public.can_manage_competition(id)
);

drop policy if exists "organizers create competitions" on public.competitions;
create policy "organizers create competitions"
on public.competitions
for insert
to authenticated
with check (
  organizer_id = auth.uid()
  and venue_id is not null
  and public.can_manage_venue(venue_id)
  and public.is_verified_active_venue(venue_id)
);

drop policy if exists "open programs are readable" on public.venue_programs;
create policy "open programs are readable"
on public.venue_programs
for select
to authenticated
using (
  (
    registration_status = 'open'
    and public.is_verified_active_venue(venue_id)
  )
  or public.can_manage_venue(venue_id)
);

drop policy if exists "venue managers create programs" on public.venue_programs;
create policy "venue managers create programs"
on public.venue_programs
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_venue(venue_id)
  and public.is_verified_active_venue(venue_id)
);

drop policy if exists "active products are readable" on public.membership_products;
create policy "active products are readable"
on public.membership_products
for select
to authenticated
using (
  (
    active
    and public.is_verified_active_venue(venue_id)
  )
  or public.can_manage_venue(venue_id)
);

drop policy if exists "venue managers create products" on public.membership_products;
create policy "venue managers create products"
on public.membership_products
for insert
to authenticated
with check (
  public.can_manage_venue(venue_id)
  and public.is_verified_active_venue(venue_id)
);
