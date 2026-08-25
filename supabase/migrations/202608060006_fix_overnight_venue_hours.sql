-- quote_booking's operating-hours check assumed closes_at > opens_at (a
-- same-day window). Venues that close after midnight — e.g. Pickld
-- Pickleball Center, opens_at 08:00 / closes_at 01:00 — store closes_at as
-- an early-morning time, which is numerically less than almost every
-- daytime/evening booking time. That made local_end::time > closes_at true
-- for nearly every booking, so every quote failed with "The venue is
-- closed by this time" even during normal open hours.
--
-- Fix: when closes_at <= opens_at, treat the open window as wrapping past
-- midnight (opens_at..24:00 plus 00:00..closes_at) instead of a flat
-- opens_at..closes_at range. Everything else in this function is
-- unchanged from the 202607170003 definition.

create or replace function public.quote_booking(
  p_court_ids text[], p_starts_at timestamptz, p_ends_at timestamptz, p_promo_code text default null
) returns public.booking_quotes language plpgsql security definer set search_path = '' as $$
declare
  selected_venue public.venues;
  court_count integer;
  hours numeric;
  subtotal_value numeric := 0;
  total_value numeric := 0;
  line_base numeric;
  line_total numeric;
  discount_value numeric := 0;
  matching_rule public.venue_pricing_rules;
  current_court public.courts;
  local_start timestamp;
  local_end timestamp;
  lines jsonb := '[]'::jsonb;
  promo_matched boolean := false;
  created public.booking_quotes;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_ends_at <= p_starts_at or p_starts_at <= now() then raise exception 'Choose a future booking time'; end if;
  if cardinality(p_court_ids) is null or cardinality(p_court_ids) < 1 or cardinality(p_court_ids) > 20 then
    raise exception 'Choose between 1 and 20 courts';
  end if;
  if cardinality(array(select distinct unnest(p_court_ids))) <> cardinality(p_court_ids) then raise exception 'A court was selected twice'; end if;

  select count(distinct c.id), max(v.id) into court_count, selected_venue.id
  from public.courts c join public.venues v on v.id = c.venue_id
  where c.id = any(p_court_ids) and c.active and v.active;
  if court_count <> cardinality(p_court_ids) then raise exception 'One or more courts are unavailable'; end if;
  if (select count(distinct venue_id) from public.courts where id = any(p_court_ids)) <> 1 then raise exception 'All courts must be at one venue'; end if;
  select * into selected_venue from public.venues where id = selected_venue.id;
  local_start := p_starts_at at time zone selected_venue.time_zone;
  local_end := p_ends_at at time zone selected_venue.time_zone;
  if local_start::date <> local_end::date and local_end::time <> time '00:00' then raise exception 'Bookings cannot cross venue calendar days'; end if;

  if selected_venue.opens_at is not null and selected_venue.closes_at is not null
     and selected_venue.closes_at <= selected_venue.opens_at then
    -- Overnight venue — the open window wraps past midnight.
    if local_start::time >= selected_venue.opens_at then
      null; -- evening segment, runs past midnight — no same-day upper bound
    elsif local_start::time < selected_venue.closes_at then
      if local_end::time > selected_venue.closes_at then raise exception 'The venue is closed by this time'; end if;
    else
      raise exception 'The venue is not open yet';
    end if;
  else
    if selected_venue.opens_at is not null and local_start::time < selected_venue.opens_at then raise exception 'The venue is not open yet'; end if;
    if selected_venue.closes_at is not null and local_end::time > selected_venue.closes_at then raise exception 'The venue is closed by this time'; end if;
  end if;

  hours := extract(epoch from (p_ends_at - p_starts_at)) / 3600;

  for current_court in select * from public.courts where id = any(p_court_ids) order by id loop
    if not public.booking_court_is_available(current_court.id, p_starts_at, p_ends_at, null) then
      raise exception '% is no longer available', current_court.name;
    end if;
    line_base := round(current_court.hourly_price * hours, 2);
    line_total := line_base;
    matching_rule := null;
    select rule.* into matching_rule from public.venue_pricing_rules rule
    where rule.venue_id = current_court.venue_id and rule.active
      and (rule.court_id is null or rule.court_id = current_court.id)
      and (rule.valid_from is null or local_start::date >= rule.valid_from)
      and (rule.valid_until is null or local_start::date <= rule.valid_until)
      and (rule.days_of_week is null or extract(dow from local_start)::smallint = any(rule.days_of_week))
      and (rule.starts_at_local is null or local_start::time >= rule.starts_at_local)
      and (rule.ends_at_local is null or local_end::time <= rule.ends_at_local)
      and (rule.rule_type <> 'promotion' or upper(rule.promo_code) = upper(trim(p_promo_code)))
      and (rule.rule_type <> 'membership' or exists (
        select 1 from public.venue_membership_entitlements entitlement
        where entitlement.venue_id = rule.venue_id and entitlement.user_id = auth.uid() and entitlement.active
          and entitlement.starts_at <= now() and (entitlement.ends_at is null or entitlement.ends_at > now())
      ))
    order by rule.priority desc, rule.created_at desc limit 1;
    if found then
      promo_matched := promo_matched or matching_rule.rule_type = 'promotion';
      line_total := case matching_rule.adjustment_type
        when 'fixed_hourly' then round(greatest(0, matching_rule.adjustment_value) * hours, 2)
        when 'percentage' then round(greatest(0, line_base * (1 + matching_rule.adjustment_value / 100)), 2)
        when 'flat_discount' then round(greatest(0, line_base - matching_rule.adjustment_value), 2)
      end;
    end if;
    subtotal_value := subtotal_value + line_base;
    total_value := total_value + line_total;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'courtId', current_court.id, 'courtName', current_court.name, 'baseAmount', line_base,
      'amount', line_total, 'ruleId', matching_rule.id, 'ruleName', matching_rule.name
    ));
  end loop;
  if nullif(trim(p_promo_code), '') is not null and not promo_matched then raise exception 'Promo code is invalid or not eligible for this time'; end if;
  discount_value := greatest(0, subtotal_value - total_value);
  insert into public.booking_quotes(user_id, venue_id, court_ids, starts_at, ends_at, promo_code,
    subtotal, discount_amount, fee_amount, total, breakdown)
  values(auth.uid(), selected_venue.id, p_court_ids, p_starts_at, p_ends_at, nullif(upper(trim(p_promo_code)), ''),
    subtotal_value, discount_value, 0, total_value,
    jsonb_build_object('timeZone', selected_venue.time_zone, 'lines', lines,
      'subtotal', subtotal_value, 'discount', discount_value, 'fees', 0, 'total', total_value))
  returning * into created;
  return created;
end $$;
