-- Let signed-in organizers submit real venues without publishing unverified
-- listings to players. Platform verification remains a separate admin action.

alter table public.venues
  add column if not exists google_maps_url text,
  add column if not exists verification_status text not null default 'pending',
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null;

alter table public.venues
  drop constraint if exists venues_verification_status_check;

alter table public.venues
  add constraint venues_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected'));

-- Venues that predate applications were already admin-created. Preserve their
-- current availability and treat non-demo records as verified.
update public.venues
set verification_status = 'verified'
where id not in ('yard', 'rockwell', 'valley')
  and verification_status = 'pending';

create or replace function public.create_venue_application(
  p_name text,
  p_area text,
  p_address text,
  p_venue_type text,
  p_google_maps_url text,
  p_description text default null,
  p_opens_at time default '06:00',
  p_closes_at time default '22:00'
)
returns public.venues
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.venues;
  generated_id text;
  maps_url text := trim(coalesce(p_google_maps_url, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Venue name is required';
  end if;
  if char_length(trim(coalesce(p_area, ''))) < 2 then
    raise exception 'City or area is required';
  end if;
  if char_length(trim(coalesce(p_address, ''))) < 5 then
    raise exception 'Venue address is required';
  end if;
  if p_venue_type not in ('Indoor', 'Outdoor', 'Mixed') then
    raise exception 'Choose a valid venue type';
  end if;
  if p_opens_at is null or p_closes_at is null or p_opens_at = p_closes_at then
    raise exception 'Choose valid operating hours';
  end if;
  if not (
    lower(maps_url) ~ '^https://(www\.)?google\.[a-z.]+/maps'
    or lower(maps_url) ~ '^https://maps\.google\.[a-z.]+'
    or lower(maps_url) ~ '^https://maps\.app\.goo\.gl/'
    or lower(maps_url) ~ '^https://goo\.gl/maps/'
  ) then
    raise exception 'Paste a valid Google Maps share link';
  end if;

  generated_id := trim(both '-' from lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g')))
    || '-' || substr(gen_random_uuid()::text, 1, 8);

  insert into public.venues(
    id, name, area, address, latitude, longitude, description, venue_type,
    opens_at, closes_at, google_maps_url, verification_status, submitted_by, active
  ) values (
    generated_id, trim(p_name), trim(p_area), trim(p_address), 0, 0,
    nullif(trim(coalesce(p_description, '')), ''), p_venue_type,
    p_opens_at, p_closes_at, maps_url, 'pending', auth.uid(), false
  )
  returning * into created;

  insert into public.venue_members(venue_id, user_id, role)
  values (created.id, auth.uid(), 'owner')
  on conflict (venue_id, user_id) do update set role = 'owner';

  return created;
end;
$$;

revoke all on function public.create_venue_application(text, text, text, text, text, text, time, time) from public;
grant execute on function public.create_venue_application(text, text, text, text, text, text, time, time) to authenticated;

create or replace function public.review_venue_application(
  p_venue_id text,
  p_approve boolean
)
returns public.venues
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewed public.venues;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin permission required';
  end if;

  update public.venues
  set verification_status = case when p_approve then 'verified' else 'rejected' end,
      active = p_approve,
      updated_at = now()
  where id = p_venue_id
    and verification_status = 'pending'
  returning * into reviewed;

  if reviewed.id is null then
    raise exception 'Pending venue application not found';
  end if;

  return reviewed;
end;
$$;

revoke all on function public.review_venue_application(text, boolean) from public;
grant execute on function public.review_venue_application(text, boolean) to authenticated;
