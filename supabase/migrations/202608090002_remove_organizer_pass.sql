-- The Organizer Pass subscription is being retired: the platform already
-- takes a cut on every paid court booking (see 202608060002/0004), so
-- gating organizer tooling behind a second, separate subscription no longer
-- makes sense. Organizer access is now purely "do you manage a real venue"
-- (public.venue_members) or platform admin status.

-- 1. Open Play session creation no longer requires an entitlement, only
--    venue-scoped ownership of the session being created.
drop policy if exists "entitled organizers create sessions" on public.open_play_sessions;
create policy "organizers create sessions"
on public.open_play_sessions for insert to authenticated
with check (
  organizer_id = auth.uid()
  and status in ('draft', 'active')
  and exists (
    select 1 from public.venues venue
    where venue.id = open_play_sessions.venue_id
    and venue.active
    and venue.verification_status = 'verified'
  )
);

create or replace function public.create_open_play_session(
  p_name text,
  p_venue_id text,
  p_court_ids text[],
  p_capacity integer,
  p_visibility text,
  p_approval_mode text,
  p_skill_min numeric,
  p_skill_max numeric,
  p_fee_amount numeric,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_rules text,
  p_cancellation_policy text,
  p_match_format text,
  p_average_match_minutes integer,
  p_max_consecutive_games integer,
  p_rest_minutes integer
)
returns public.open_play_sessions
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  created public.open_play_sessions;
  generated_code text;
  selected_court_id text;
  selected_court_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Session name is required'; end if;
  if cardinality(p_court_ids) is null or cardinality(p_court_ids) not between 1 and 50 then raise exception 'Select at least one available court'; end if;
  if cardinality(array(select distinct unnest(p_court_ids))) <> cardinality(p_court_ids) then raise exception 'A court was selected twice'; end if;
  if p_capacity not between 4 and 200 then raise exception 'Capacity must be between 4 and 200'; end if;
  if p_visibility not in ('public', 'private', 'invite_only') then raise exception 'Choose a valid visibility'; end if;
  if p_approval_mode not in ('automatic', 'manual') then raise exception 'Choose a valid approval mode'; end if;
  if p_match_format not in ('singles', 'doubles') then raise exception 'Choose singles or doubles'; end if;
  if p_average_match_minutes not between 5 and 90 then raise exception 'Average match time must be between 5 and 90 minutes'; end if;
  if p_max_consecutive_games not between 0 and 10 then raise exception 'Consecutive-game limit must be between 0 and 10'; end if;
  if p_rest_minutes not between 0 and 120 then raise exception 'Rest time must be between 0 and 120 minutes'; end if;
  if p_scheduled_start is null or p_scheduled_end is null or p_scheduled_end <= p_scheduled_start then raise exception 'Choose a valid session schedule'; end if;
  if p_scheduled_end <= now() then raise exception 'The session must end in the future'; end if;
  if p_fee_amount is null or p_fee_amount < 0 then raise exception 'Fee cannot be negative'; end if;
  if p_skill_min is not null and (p_skill_min < 1 or p_skill_min > 5.5) then raise exception 'Minimum skill must be between 1.0 and 5.5'; end if;
  if p_skill_max is not null and (p_skill_max < 1 or p_skill_max > 5.5) then raise exception 'Maximum skill must be between 1.0 and 5.5'; end if;
  if p_skill_min is not null and p_skill_max is not null and p_skill_min > p_skill_max then raise exception 'Minimum skill cannot exceed maximum skill'; end if;
  if not exists (
    select 1 from public.venues
    where id = p_venue_id and active and verification_status = 'verified'
  ) then raise exception 'Choose a verified active venue'; end if;

  select count(*)
  into selected_court_count
  from public.courts
  where id = any(p_court_ids)
    and venue_id = p_venue_id
    and active;
  if selected_court_count <> cardinality(p_court_ids) then
    raise exception 'Every selected court must be active at this center';
  end if;

  for selected_court_id in
    select selected.court_id
    from unnest(p_court_ids) as selected(court_id)
    order by selected.court_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(selected_court_id, 0));
  end loop;

  for selected_court_id in
    select selected.court_id
    from unnest(p_court_ids) as selected(court_id)
  loop
    if not public.booking_court_is_available(selected_court_id, p_scheduled_start, p_scheduled_end, null) then
      raise exception '% is no longer available',
        (select name from public.courts where id = selected_court_id);
    end if;
  end loop;

  loop
    generated_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 6));
    exit when not exists (
      select 1 from public.open_play_sessions where session_code = generated_code
    );
  end loop;

  insert into public.open_play_sessions (
    id, organizer_id, venue_id, name, status, court_count, session_code,
    visibility, approval_mode, capacity, skill_min, skill_max, fee_amount,
    scheduled_start, scheduled_end, rules, cancellation_policy,
    match_format, average_match_minutes, max_consecutive_games, rest_minutes
  ) values (
    gen_random_uuid()::text, auth.uid(), p_venue_id, trim(p_name), 'active',
    cardinality(p_court_ids), generated_code, p_visibility, p_approval_mode,
    p_capacity, p_skill_min, p_skill_max, p_fee_amount, p_scheduled_start,
    p_scheduled_end,
    coalesce(nullif(trim(p_rules), ''), 'Doubles · First to 11 · Win by 2'),
    coalesce(nullif(trim(p_cancellation_policy), ''), 'Cancel before the session starts so a waitlisted player can take your place.'),
    p_match_format, p_average_match_minutes, p_max_consecutive_games, p_rest_minutes
  )
  returning * into created;

  insert into public.open_play_courts (
    id, session_id, court_number, venue_court_id
  )
  select
    created.id || '-court-' || selected.position,
    created.id,
    selected.position::integer,
    selected.court_id
  from unnest(p_court_ids) with ordinality as selected(court_id, position);

  return created;
end
$$;

revoke all on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
) from public;
grant execute on function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
) to authenticated;

-- 2. Drop the admin grant/revoke-pass tooling.
drop function if exists public.admin_grant_entitlement(uuid, text, text, timestamptz);
drop function if exists public.admin_revoke_entitlement(uuid);

-- 3. Drop the demo checkout RPCs and the entitlement check they backed.
drop function if exists public.activate_demo_organizer_pass(text);
drop function if exists public.cancel_demo_organizer_pass();
drop function if exists public.expire_demo_organizer_pass();
drop function if exists public.restore_demo_organizer_pass();
drop function if exists public.has_active_organizer_entitlement(uuid);

-- 4. Drop the table itself (cascades its own indexes/policies/trigger).
drop table if exists public.organizer_entitlements cascade;
