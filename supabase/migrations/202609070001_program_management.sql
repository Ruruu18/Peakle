-- Program management uses the same program row lock as register_for_program,
-- keeping organizer admissions and capacity edits serialized with player joins.
begin;

drop policy if exists "admins read programs" on public.venue_programs;
create policy "admins read programs" on public.venue_programs
for select to authenticated using (public.is_platform_admin());
drop policy if exists "admins create programs" on public.venue_programs;
create policy "admins create programs" on public.venue_programs
for insert to authenticated with check (created_by = auth.uid() and public.is_platform_admin());
drop policy if exists "admins read program participants" on public.program_registrations;
create policy "admins read program participants" on public.program_registrations
for select to authenticated using (public.is_platform_admin());

create or replace function public.update_venue_program_details(
  p_program_id uuid, p_expected_updated_at timestamptz, p_name text, p_kind text,
  p_skill_division text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_capacity integer, p_price numeric, p_description text
)
returns public.venue_programs
language plpgsql security definer set search_path = '' as $$
declare
  program public.venue_programs;
  occupied integer;
begin
  select * into program from public.venue_programs where id = p_program_id for update;
  if auth.uid() is null or program.id is null or not (public.can_manage_venue(program.venue_id) or public.is_platform_admin()) then
    raise exception 'Program manager access required';
  end if;
  if program.updated_at is distinct from p_expected_updated_at then
    raise exception 'This program has changed. Refresh before trying again.';
  end if;
  if program.registration_status = 'cancelled' or program.ends_at <= now() then
    raise exception 'Completed or cancelled programs cannot be edited';
  end if;
  if p_starts_at is distinct from program.starts_at and program.starts_at <= now() then
    raise exception 'The start time cannot change after a program has begun';
  end if;
  if p_starts_at is distinct from program.starts_at and p_starts_at <= now() then
    raise exception 'Choose a new start time in the future';
  end if;
  if p_ends_at <= now() then raise exception 'Choose an end time in the future'; end if;
  if p_price is null or p_price = 'NaN'::numeric or p_price < 0 or p_price > 99999999.99 then
    raise exception 'Enter a valid price of zero or more';
  end if;
  select count(*) into occupied from public.program_registrations
    where program_id = p_program_id and status in ('registered', 'attended');
  if p_capacity < occupied then raise exception 'Capacity cannot be below the % registered players', occupied; end if;
  -- Table constraints validate names, types, skill levels, date order and limits.
  update public.venue_programs set name = btrim(p_name), kind = p_kind,
    skill_division = p_skill_division, starts_at = p_starts_at, ends_at = p_ends_at,
    capacity = p_capacity, price = p_price, description = nullif(btrim(p_description), '')
    where id = p_program_id returning * into program;
  return program;
end;
$$;

create or replace function public.set_venue_program_status(
  p_program_id uuid, p_status text, p_expected_updated_at timestamptz
)
returns public.venue_programs
language plpgsql security definer set search_path = '' as $$
declare program public.venue_programs;
begin
  select * into program from public.venue_programs where id = p_program_id for update;
  if auth.uid() is null or program.id is null or not (public.can_manage_venue(program.venue_id) or public.is_platform_admin()) then
    raise exception 'Program manager access required';
  end if;
  if program.updated_at is distinct from p_expected_updated_at then
    raise exception 'This program has changed. Refresh before trying again.';
  end if;
  if p_status is null or p_status not in ('open', 'closed', 'cancelled') then raise exception 'Invalid registration status'; end if;
  if program.registration_status = 'cancelled' or program.ends_at <= now() then
    raise exception 'Completed or cancelled programs cannot change registration status';
  end if;
  if p_status = 'open' and (program.starts_at <= now() or not public.is_verified_active_venue(program.venue_id)) then
    raise exception 'Registration requires a future program at a verified, active venue';
  end if;
  -- Preserve the roster and attendance history when cancelling a program.
  update public.venue_programs set registration_status = p_status where id = p_program_id returning * into program;
  return program;
end;
$$;

create or replace function public.update_program_participant(
  p_program_id uuid, p_user_id uuid, p_status text, p_expected_status text
)
returns public.program_registrations
language plpgsql security definer set search_path = '' as $$
declare
  program public.venue_programs;
  registration public.program_registrations;
  occupied integer;
begin
  select * into program from public.venue_programs where id = p_program_id for update;
  if auth.uid() is null or program.id is null or not (public.can_manage_venue(program.venue_id) or public.is_platform_admin()) then
    raise exception 'Program manager access required';
  end if;
  if program.registration_status = 'cancelled' then raise exception 'This program is cancelled'; end if;
  select * into registration from public.program_registrations
    where program_id = p_program_id and user_id = p_user_id for update;
  if registration.user_id is null then raise exception 'Registration not found'; end if;
  if registration.status is distinct from p_expected_status then raise exception 'This registration has changed. Refresh before trying again.'; end if;
  if p_status is null or not (
    (registration.status = 'waitlisted' and p_status in ('registered', 'cancelled')) or
    (registration.status = 'registered' and p_status in ('attended', 'no_show', 'cancelled')) or
    (registration.status in ('attended', 'no_show') and p_status = 'registered')
  ) then raise exception 'This registration change is not available'; end if;
  if p_status in ('attended', 'no_show') and program.starts_at > now() then
    raise exception 'Attendance can be recorded once the program starts';
  end if;
  if p_status = 'registered' and registration.status = 'waitlisted' and program.ends_at <= now() then
    raise exception 'Completed programs cannot admit more players';
  end if;
  if p_status = 'registered' and registration.status not in ('registered', 'attended') then
    select count(*) into occupied from public.program_registrations
      where program_id = p_program_id and status in ('registered', 'attended');
    if occupied >= program.capacity then raise exception 'This program is full. Increase capacity before admitting another player.'; end if;
  end if;
  update public.program_registrations set status = p_status,
    checked_in_at = case when p_status = 'attended' then now() else null end
    where program_id = p_program_id and user_id = p_user_id returning * into registration;
  return registration;
end;
$$;

revoke all on function public.update_venue_program_details(uuid,timestamptz,text,text,text,timestamptz,timestamptz,integer,numeric,text) from public;
revoke all on function public.set_venue_program_status(uuid,text,timestamptz) from public;
revoke all on function public.update_program_participant(uuid,uuid,text,text) from public;
grant execute on function public.update_venue_program_details(uuid,timestamptz,text,text,text,timestamptz,timestamptz,integer,numeric,text) to authenticated;
grant execute on function public.set_venue_program_status(uuid,text,timestamptz) to authenticated;
grant execute on function public.update_program_participant(uuid,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
