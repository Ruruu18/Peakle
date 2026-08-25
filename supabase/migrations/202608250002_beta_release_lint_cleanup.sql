begin;

-- Keep the linked schema at a zero-warning baseline. These definitions only
-- remove reserved/unused PL/pgSQL variables; their authorization and behavior
-- remain unchanged.

create or replace function app_private.set_venue_staff_role(
  p_venue_id text, p_user_id uuid, p_role text
) returns public.venue_members
language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  result public.venue_members;
begin
  select role into actor_role from public.venue_members
  where venue_id = p_venue_id and user_id = auth.uid();
  if actor_role not in ('owner', 'manager') then
    raise exception 'Owner or manager permission required';
  end if;
  if p_role not in ('manager', 'front_desk', 'court_monitor', 'scorer', 'viewer') then
    raise exception 'Choose a valid staff role';
  end if;
  if p_user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  insert into public.venue_members(venue_id, user_id, role)
  values (p_venue_id, p_user_id, p_role)
  on conflict (venue_id, user_id) do update set role = excluded.role
  returning * into result;
  return result;
end $$;

create or replace function app_private.remove_venue_staff(p_venue_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  target_role text;
begin
  select role into actor_role from public.venue_members
  where venue_id = p_venue_id and user_id = auth.uid();
  select role into target_role from public.venue_members
  where venue_id = p_venue_id and user_id = p_user_id;
  if actor_role not in ('owner', 'manager') then raise exception 'Owner or manager permission required'; end if;
  if p_user_id = auth.uid() or target_role = 'owner' then raise exception 'The venue owner cannot be removed'; end if;
  delete from public.venue_members where venue_id = p_venue_id and user_id = p_user_id;
end $$;

create or replace function app_private.apply_open_play_operation(
  p_operation_id uuid, p_session_id text, p_base_revision bigint, p_operation jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  session_row public.open_play_sessions;
  player_id text;
  next_revision bigint;
begin
  if exists (
    select 1 from public.open_play_operations
    where id = p_operation_id and session_id = p_session_id
  ) then
    return jsonb_build_object(
      'revision', (select applied_revision from public.open_play_operations where id = p_operation_id),
      'replayed', true
    );
  end if;
  select * into session_row from public.open_play_sessions where id = p_session_id for update;
  if session_row.id is null or session_row.status <> 'active' then raise exception 'Active session not found'; end if;
  if not public.owns_open_play(p_session_id) then raise exception 'Session staff permission required'; end if;
  if p_base_revision <> session_row.operation_revision then
    return jsonb_build_object('conflict', true, 'revision', session_row.operation_revision);
  end if;
  player_id := p_operation->>'playerId';
  case p_operation->>'type'
    when 'set_priority' then
      update public.open_play_players set priority_boost = greatest(-10, least(10, (p_operation->>'value')::integer))
      where id = player_id and session_id = p_session_id and status = 'waiting';
    when 'mark_done' then
      update public.open_play_players set status = 'done', departed_at = now(), queue_position = null
      where id = player_id and session_id = p_session_id and status = 'waiting';
    when 'return_to_queue' then
      update public.open_play_players set status = 'waiting', departed_at = null, waiting_since = now(),
        queue_position = (select coalesce(max(queue_position), -1) + 1 from public.open_play_players where session_id = p_session_id)
      where id = player_id and session_id = p_session_id and status = 'done';
    else raise exception 'Unsupported offline operation';
  end case;
  if not found then raise exception 'The player changed on another device'; end if;
  next_revision := session_row.operation_revision + 1;
  update public.open_play_sessions set operation_revision = next_revision where id = p_session_id;
  insert into public.open_play_operations(id, session_id, actor_id, base_revision, applied_revision, operation)
  values(p_operation_id, p_session_id, auth.uid(), p_base_revision, next_revision, p_operation);
  return jsonb_build_object('revision', next_revision, 'conflict', false);
end $$;

-- A later migration replaced the public implementation, so this private copy
-- has no caller and only contributes stale lint output.
drop function if exists app_private.create_multi_court_booking(uuid, uuid, boolean, uuid);

create or replace function public.create_multi_court_booking(
  p_quote_id uuid, p_idempotency_key uuid, p_invite_team boolean default false, p_team_id uuid default null
) returns setof public.bookings language plpgsql security definer set search_path = '' as $$
declare
  quote public.booking_quotes;
  court_id_value text;
  line jsonb;
  created public.bookings;
  group_id uuid := gen_random_uuid();
  reference_value text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null then raise exception 'A request key is required'; end if;
  if exists (select 1 from public.bookings b where b.user_id = auth.uid() and b.idempotency_key = p_idempotency_key) then
    return query select * from public.bookings b where b.user_id = auth.uid() and b.idempotency_key = p_idempotency_key order by b.court_id;
    return;
  end if;
  select * into quote from public.booking_quotes where id = p_quote_id and user_id = auth.uid() for update;
  if not found or quote.expires_at <= now() then raise exception 'Your price quote expired. Review the updated total'; end if;
  if quote.consumed_at is not null then raise exception 'This price quote was already used'; end if;
  if p_invite_team and (p_team_id is null or not public.is_team_member(p_team_id)) then raise exception 'Choose a team you have joined'; end if;
  foreach court_id_value in array (select array_agg(value order by value) from unnest(quote.court_ids) value) loop
    perform pg_advisory_xact_lock(hashtextextended(court_id_value, 0));
  end loop;
  reference_value := 'PKL-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-' || upper(substr(replace(group_id::text, '-', ''), 1, 8));
  foreach court_id_value in array quote.court_ids loop
    if not exists (select 1 from public.courts where id = court_id_value and active)
      or not public.booking_court_is_available(court_id_value, quote.starts_at, quote.ends_at, null)
    then
      raise exception 'One of the selected courts was just reserved. No booking was created';
    end if;
    select value into line from jsonb_array_elements(quote.breakdown->'lines') value where value->>'courtId' = court_id_value;
    insert into public.bookings(user_id, venue_id, court_id, starts_at, ends_at, amount, currency,
      payment_status, status, invite_team, team_id, booking_group_id, reference, idempotency_key,
      pricing_snapshot, subtotal, discount_amount, fee_amount)
    values(auth.uid(), quote.venue_id, court_id_value, quote.starts_at, quote.ends_at,
      (line->>'amount')::numeric, quote.currency, 'awaiting_payment', 'pending', p_invite_team,
      case when p_invite_team then p_team_id else null end, group_id, reference_value, p_idempotency_key,
      line, (line->>'baseAmount')::numeric,
      greatest(0, (line->>'baseAmount')::numeric - (line->>'amount')::numeric), 0)
    returning * into created;
    insert into public.booking_audit_log(booking_id, actor_id, action, after_state)
      values(created.id, auth.uid(), 'created', to_jsonb(created));
    update public.court_waitlist set status = 'booked', updated_at = now()
      where user_id = auth.uid() and court_id = court_id_value and status = 'offered'
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(quote.starts_at, quote.ends_at, '[)');
    return next created;
  end loop;
  update public.booking_quotes set consumed_at = now() where id = quote.id;
exception when exclusion_violation or unique_violation then
  raise exception 'A selected court was just reserved. No duplicate booking was created';
end $$;

create or replace function app_private.seed_tournament_division_bracket(
  p_competition_id uuid,
  p_division_id uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  competition public.competitions;
  division public.competition_divisions;
  entry_count integer;
  bracket_size integer := 1;
  round_count integer := 0;
  slot_count integer;
  home_id uuid;
  away_id uuid;
begin
  select * into competition from public.competitions where id = p_competition_id for update;
  select * into division from public.competition_divisions
    where id = p_division_id and competition_id = p_competition_id for update;
  if competition.id is null or competition.kind <> 'tournament'
    or division.id is null or not public.can_manage_competition(p_competition_id) then
    raise exception 'Tournament division manager permission required';
  end if;
  if exists (select 1 from public.competition_bracket_matches where competition_division_id = p_division_id) then
    raise exception 'This division bracket has already been seeded';
  end if;
  if exists (
    select 1 from public.competition_entries
    where competition_division_id = p_division_id
      and status in ('registered','active') and eligibility_status = 'pending'
  ) then
    raise exception 'Resolve pending eligibility reviews before seeding';
  end if;
  select count(*) into entry_count from public.competition_entries
  where competition_division_id = p_division_id
    and status in ('registered','active') and eligibility_status in ('not_required','approved');
  if entry_count < 2 then raise exception 'At least two eligible entries are required'; end if;
  while bracket_size < entry_count loop bracket_size := bracket_size * 2; end loop;
  slot_count := bracket_size;
  while slot_count > 1 loop
    round_count := round_count + 1;
    slot_count := slot_count / 2;
  end loop;
  for round_no in 1..round_count loop
    slot_count := bracket_size / cast(power(2, round_no) as integer);
    for slot_no in 1..slot_count loop
      home_id := null;
      away_id := null;
      if round_no = 1 then
        select id into home_id from public.competition_entries
        where competition_division_id = p_division_id
          and status in ('registered','active') and eligibility_status in ('not_required','approved')
        order by seed nulls last, created_at offset ((slot_no - 1) * 2) limit 1;
        select id into away_id from public.competition_entries
        where competition_division_id = p_division_id
          and status in ('registered','active') and eligibility_status in ('not_required','approved')
        order by seed nulls last, created_at offset ((slot_no - 1) * 2 + 1) limit 1;
      end if;
      insert into public.competition_bracket_matches(
        competition_id, competition_division_id, round_number, position,
        home_entry_id, away_entry_id, winner_entry_id, status
      ) values (
        p_competition_id, p_division_id, round_no, slot_no, home_id, away_id,
        case when round_no = 1 and home_id is not null and away_id is null then home_id else null end,
        case
          when round_no = 1 and home_id is not null and away_id is null then 'bye'
          when round_no = 1 and home_id is not null and away_id is not null then 'ready'
          else 'pending'
        end
      );
    end loop;
  end loop;
  update public.competition_divisions set status = 'active', updated_at = now() where id = p_division_id;
  update public.competitions set status = 'active', updated_at = now() where id = p_competition_id;
  return round_count;
end $$;

notify pgrst, 'reload schema';

commit;
