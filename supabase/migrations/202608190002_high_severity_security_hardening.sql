begin;

-- A provider payment id identifies exactly one booking. This also turns a
-- replay containing another booking id into a database error.
create unique index if not exists bookings_paymongo_payment_idx
  on public.bookings (paymongo_payment_id)
  where paymongo_payment_id is not null;

-- Checkout creation uses a durable, atomic claim. A claim is deliberately not
-- timed out automatically: after an ambiguous network failure, creating a new
-- provider session would be less safe than requiring reconciliation.
alter table public.bookings
  add column if not exists paymongo_checkout_url text,
  add column if not exists checkout_claim_token uuid,
  add column if not exists checkout_claimed_at timestamptz;

alter table public.player_memberships
  add column if not exists paymongo_checkout_url text,
  add column if not exists checkout_claim_token uuid,
  add column if not exists checkout_claimed_at timestamptz;

create or replace function public.claim_paymongo_checkout(
  p_resource_type text,
  p_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
  v_status text;
  v_session_id text;
  v_checkout_url text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'This action is only available to the checkout service';
  end if;

  if p_resource_type = 'booking' then
    select payment_status, paymongo_checkout_session_id, paymongo_checkout_url,
           checkout_claim_token
      into v_status, v_session_id, v_checkout_url, v_token
    from public.bookings
    where id = p_resource_id
    for update;
  elsif p_resource_type = 'membership' then
    select payment_status, paymongo_checkout_session_id, paymongo_checkout_url,
           checkout_claim_token
      into v_status, v_session_id, v_checkout_url, v_token
    from public.player_memberships
    where id = p_resource_id
    for update;
  else
    raise exception 'Unsupported checkout resource type';
  end if;

  if not found then raise exception 'Checkout resource not found'; end if;
  if v_status <> 'awaiting_payment' then
    raise exception 'Resource is not awaiting payment';
  end if;
  if v_session_id is not null and v_checkout_url is not null then
    return jsonb_build_object(
      'state', 'existing',
      'session_id', v_session_id,
      'checkout_url', v_checkout_url
    );
  end if;
  if v_session_id is not null then
    raise exception 'Existing checkout requires reconciliation';
  end if;
  if v_token is not null then
    raise exception 'Checkout creation is already in progress';
  end if;

  v_token := gen_random_uuid();
  if p_resource_type = 'booking' then
    update public.bookings
    set checkout_claim_token = v_token, checkout_claimed_at = now()
    where id = p_resource_id;
  else
    update public.player_memberships
    set checkout_claim_token = v_token, checkout_claimed_at = now()
    where id = p_resource_id;
  end if;

  return jsonb_build_object('state', 'claimed', 'claim_token', v_token);
end;
$$;

create or replace function public.finalize_paymongo_checkout(
  p_resource_type text,
  p_resource_id uuid,
  p_claim_token uuid,
  p_session_id text,
  p_checkout_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'This action is only available to the checkout service';
  end if;
  if coalesce(btrim(p_session_id), '') = '' or coalesce(btrim(p_checkout_url), '') = '' then
    raise exception 'Provider checkout details are required';
  end if;

  if p_resource_type = 'booking' then
    update public.bookings
    set paymongo_checkout_session_id = p_session_id,
        paymongo_checkout_url = p_checkout_url,
        checkout_claim_token = null,
        checkout_claimed_at = null
    where id = p_resource_id
      and payment_status = 'awaiting_payment'
      and checkout_claim_token = p_claim_token;
  elsif p_resource_type = 'membership' then
    update public.player_memberships
    set paymongo_checkout_session_id = p_session_id,
        paymongo_checkout_url = p_checkout_url,
        checkout_claim_token = null,
        checkout_claimed_at = null
    where id = p_resource_id
      and payment_status = 'awaiting_payment'
      and checkout_claim_token = p_claim_token;
  else
    raise exception 'Unsupported checkout resource type';
  end if;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'Checkout claim is no longer valid';
  end if;
  return true;
end;
$$;

create or replace function public.release_paymongo_checkout_claim(
  p_resource_type text,
  p_resource_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'This action is only available to the checkout service';
  end if;
  if p_resource_type = 'booking' then
    update public.bookings
    set checkout_claim_token = null, checkout_claimed_at = null
    where id = p_resource_id and checkout_claim_token = p_claim_token
      and paymongo_checkout_session_id is null;
  elsif p_resource_type = 'membership' then
    update public.player_memberships
    set checkout_claim_token = null, checkout_claimed_at = null
    where id = p_resource_id and checkout_claim_token = p_claim_token
      and paymongo_checkout_session_id is null;
  else
    raise exception 'Unsupported checkout resource type';
  end if;
  get diagnostics v_affected = row_count;
  return v_affected = 1;
end;
$$;

revoke all on function public.claim_paymongo_checkout(text, uuid) from public, anon, authenticated;
revoke all on function public.finalize_paymongo_checkout(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_paymongo_checkout_claim(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_paymongo_checkout(text, uuid) to service_role;
grant execute on function public.finalize_paymongo_checkout(text, uuid, uuid, text, text) to service_role;
grant execute on function public.release_paymongo_checkout_claim(text, uuid, uuid) to service_role;

-- Webhook payment recording validates the provider identity and the exact
-- server-priced amount while holding the booking row lock. Earnings are always
-- derived from the booking, never from webhook-controlled arithmetic.
create or replace function public.record_booking_payment(
  p_booking_id uuid,
  p_paymongo_payment_id text,
  p_amount_paid numeric,
  p_payment_method text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_court public.courts;
  v_fee_rate numeric(5,4);
  v_platform_fee numeric(10,2);
  v_venue_amount numeric(10,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'This action is only available to the payment webhook';
  end if;
  if coalesce(btrim(p_paymongo_payment_id), '') = '' then
    raise exception 'A provider payment id is required';
  end if;
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'A positive payment amount is required';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then raise exception 'Booking not found'; end if;
  if v_booking.currency <> 'PHP' then raise exception 'Unsupported booking currency'; end if;
  if p_amount_paid <> v_booking.amount then
    raise exception 'Payment amount does not match booking total';
  end if;

  if v_booking.payment_status = 'paid' then
    if v_booking.paymongo_payment_id = p_paymongo_payment_id then return v_booking; end if;
    raise exception 'Booking was already paid with a different payment';
  end if;
  if v_booking.payment_status <> 'awaiting_payment' then
    raise exception 'Booking is not awaiting payment';
  end if;

  update public.bookings
  set payment_status = 'paid',
      status = case when status = 'pending' then 'confirmed' else status end,
      paymongo_payment_id = p_paymongo_payment_id,
      payment_method = p_payment_method,
      checkout_claim_token = null,
      checkout_claimed_at = null
  where id = p_booking_id
  returning * into v_booking;

  select * into v_court from public.courts where id = v_booking.court_id;
  v_fee_rate := coalesce(
    v_court.platform_fee_rate,
    (select value::numeric from public.platform_config where key = 'platform_fee_rate')
  );
  if v_fee_rate is null then raise exception 'Platform fee rate is not configured'; end if;

  v_platform_fee := round(v_booking.amount * v_fee_rate, 2);
  v_venue_amount := v_booking.amount - v_platform_fee;
  insert into public.venue_earnings (
    venue_id, booking_id, total_collected, platform_fee, venue_amount, fee_rate
  ) values (
    v_booking.venue_id, v_booking.id, v_booking.amount,
    v_platform_fee, v_venue_amount, v_fee_rate
  );

  return v_booking;
end;
$$;

revoke all on function public.record_booking_payment(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.record_booking_payment(uuid, text, numeric, text) to service_role;

create or replace function public.complete_booking_refund(
  p_refund_id uuid,
  p_paymongo_refund_id text default null
)
returns public.booking_refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.booking_refunds;
begin
  if auth.role() <> 'service_role' then
    raise exception 'This action is only available to the refund service';
  end if;

  select * into v_refund
  from public.booking_refunds
  where id = p_refund_id
  for update;
  if v_refund.id is null then raise exception 'Refund not found'; end if;
  if v_refund.status = 'refunded' then return v_refund; end if;
  if v_refund.status <> 'processing' then raise exception 'Refund is not being processed'; end if;
  if v_refund.refund_amount > 0 and coalesce(btrim(p_paymongo_refund_id), '') = '' then
    raise exception 'A provider refund id is required';
  end if;

  update public.booking_refunds
  set status = 'refunded', paymongo_refund_id = p_paymongo_refund_id
  where id = p_refund_id
  returning * into v_refund;

  if v_refund.refund_amount > 0 then
    update public.bookings
    set payment_status = case
      when v_refund.refund_amount >= v_refund.total_collected then 'refunded'
      else 'partially_refunded'
    end
    where id = v_refund.booking_id;
    if not found then raise exception 'Refund booking not found'; end if;
  elsif not exists (select 1 from public.bookings where id = v_refund.booking_id) then
    raise exception 'Refund booking not found';
  end if;

  return v_refund;
end;
$$;

revoke all on function public.complete_booking_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_booking_refund(uuid, text) to service_role;

-- Only one unsettled withdrawal can reserve a venue's earnings. The partial
-- unique index is the final guard even if a future caller forgets to lock.
create unique index if not exists withdrawal_requests_one_in_flight_per_venue
  on public.withdrawal_requests (venue_id)
  where status in ('pending', 'approved');

create or replace function public.request_withdrawal(
  p_venue_id text,
  p_payout_method text,
  p_payout_details jsonb
)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric(10,2);
  v_min numeric(10,2);
  v_request public.withdrawal_requests;
begin
  if not public.can_manage_venue(p_venue_id) then raise exception 'Venue access required'; end if;
  if p_payout_method not in ('gcash', 'bank_transfer', 'maya') then raise exception 'Choose a valid payout method'; end if;
  if p_payout_details is null
     or coalesce(trim(p_payout_details ->> 'account_name'), '') = ''
     or coalesce(trim(p_payout_details ->> 'account_number'), '') = '' then
    raise exception 'Payout account name and number are required';
  end if;

  -- Serialize all withdrawal creation for this venue before checking state or
  -- calculating the amount that will be reserved.
  perform pg_advisory_xact_lock(hashtextextended('withdrawal:' || p_venue_id, 0));

  if exists (
    select 1 from public.withdrawal_requests
    where venue_id = p_venue_id and status in ('pending', 'approved')
  ) then
    raise exception 'A withdrawal request is already in progress for this venue';
  end if;

  select coalesce(sum(venue_amount), 0) into v_balance
  from public.venue_earnings
  where venue_id = p_venue_id and status = 'pending';
  v_balance := v_balance + coalesce((
    select sum(amount) from public.venue_earnings_adjustments
    where venue_id = p_venue_id and settled = false
  ), 0);

  select value::numeric into v_min from public.platform_config where key = 'min_withdrawal_amount';
  if v_balance < v_min then
    raise exception 'Available balance ₱% is below the ₱% minimum withdrawal', v_balance, v_min;
  end if;

  insert into public.withdrawal_requests (venue_id, requested_by, amount, payout_method, payout_details)
  values (p_venue_id, auth.uid(), v_balance, p_payout_method, p_payout_details)
  returning * into v_request;

  update public.venue_earnings
  set status = 'requested', withdrawal_id = v_request.id
  where venue_id = p_venue_id and status = 'pending';

  return v_request;
end;
$$;

revoke all on function public.request_withdrawal(text, text, jsonb) from public;
grant execute on function public.request_withdrawal(text, text, jsonb) to authenticated;

-- Team media paths are namespaced by team UUID. Only team managers can write
-- within that team's prefix; neither ownership of another object nor knowing
-- its path grants overwrite access.
drop policy if exists "authenticated users upload team images" on storage.objects;
drop policy if exists "authenticated users update team images" on storage.objects;
drop policy if exists "team managers upload team images" on storage.objects;
drop policy if exists "team managers update team images" on storage.objects;

create policy "team managers upload team images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-images'
  and exists (
    select 1 from public.teams team
    where team.id::text = (storage.foldername(name))[1]
      and public.can_manage_team(team.id)
  )
);

create policy "team managers update team images"
on storage.objects for update to authenticated
using (
  bucket_id = 'team-images'
  and exists (
    select 1 from public.teams team
    where team.id::text = (storage.foldername(name))[1]
      and public.can_manage_team(team.id)
  )
)
with check (
  bucket_id = 'team-images'
  and exists (
    select 1 from public.teams team
    where team.id::text = (storage.foldername(name))[1]
      and public.can_manage_team(team.id)
  )
);

-- Competitive visibility is column-level, while ordinary identity fields stay
-- readable for chat, teams, and match history. Table-level SELECT would make
-- it possible to bypass every UI/RPC privacy check by asking for skill_rating.
revoke select on table public.profiles from authenticated, anon;
grant select (
  id, display_name, avatar_url, home_area, play_preference, app_mode,
  created_at, updated_at, onboarding_completed, presence_status,
  profile_visibility, availability_visibility, matching_enabled
) on public.profiles to authenticated;

create or replace function public.can_view_competitive_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id
      and (
        profile.id = auth.uid()
        or profile.profile_visibility = 'public'
        or (profile.profile_visibility = 'members' and public.shares_team_with(profile.id))
      )
  )
$$;

create or replace function public.get_my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select profile from public.profiles profile where profile.id = auth.uid()
$$;

create or replace function public.get_public_player_profile(p_player_id uuid)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  home_area text,
  skill_rating numeric,
  play_preference text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.display_name,
    profile.avatar_url,
    profile.home_area,
    case when public.can_view_competitive_profile(profile.id) then profile.skill_rating else null end,
    profile.play_preference
  from public.profiles profile
  where auth.uid() is not null and profile.id = p_player_id
$$;

revoke all on function public.can_view_competitive_profile(uuid) from public, anon;
revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.get_public_player_profile(uuid) from public, anon;
grant execute on function public.can_view_competitive_profile(uuid) to authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_public_player_profile(uuid) to authenticated;

-- Existing SECURITY DEFINER discovery functions legitimately read the private
-- source column, but must mask it before returning rows to the caller.
create or replace function public.search_direct_message_candidates(p_query text)
returns table (
  id uuid, display_name text, avatar_url text, skill_rating numeric, home_area text,
  is_following boolean, follows_you boolean, shares_team boolean,
  has_existing_conversation boolean, can_message boolean
)
language sql stable security definer set search_path = ''
as $$
  select profile.id, profile.display_name, profile.avatar_url,
    case when public.can_view_competitive_profile(profile.id) then profile.skill_rating else null end,
    profile.home_area,
    exists (select 1 from public.player_follows relation where relation.follower_id = auth.uid() and relation.followed_id = profile.id),
    exists (select 1 from public.player_follows relation where relation.follower_id = profile.id and relation.followed_id = auth.uid()),
    public.shares_team_with(profile.id),
    public.has_accepted_direct_conversation(profile.id),
    public.can_start_private_conversation(profile.id)
  from public.profiles profile
  where auth.uid() is not null
    and public.can_use_team_chat()
    and profile.id <> auth.uid()
    and char_length(btrim(coalesce(p_query, ''))) >= 2
    and profile.display_name ilike '%' || btrim(p_query) || '%'
    and exists (select 1 from public.chat_safety_profiles safety where safety.user_id = profile.id and safety.is_adult and safety.rules_acknowledged_at is not null)
    and not exists (select 1 from public.chat_suspensions suspension where suspension.user_id = profile.id and (suspension.suspended_until is null or suspension.suspended_until > now()))
    and not exists (select 1 from public.chat_user_blocks block where (block.blocker_id = auth.uid() and block.blocked_id = profile.id) or (block.blocker_id = profile.id and block.blocked_id = auth.uid()))
  order by public.can_start_private_conversation(profile.id) desc,
    exists (select 1 from public.player_follows relation where relation.follower_id = profile.id and relation.followed_id = auth.uid()) desc,
    profile.display_name
  limit 20
$$;

create or replace function public.nearby_online_players(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 25
)
returns table (
  id uuid, display_name text, avatar_url text, skill_rating numeric,
  distance_km double precision, location_accuracy_m double precision,
  availability text, last_seen_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select profile.id, profile.display_name, profile.avatar_url,
    case when public.can_view_competitive_profile(profile.id) then profile.skill_rating else null end,
    round(calculated.distance_km::numeric, 2)::double precision,
    presence.accuracy_m, presence.availability, presence.last_seen_at
  from public.player_presence presence
  join public.profiles profile on profile.id = presence.user_id
  cross join lateral (
    select 6371 * 2 * asin(sqrt(least(1, greatest(0,
      power(sin(radians(presence.latitude - p_latitude) / 2), 2)
      + cos(radians(p_latitude)) * cos(radians(presence.latitude))
      * power(sin(radians(presence.longitude - p_longitude) / 2), 2)
    )))) as distance_km
  ) calculated
  where auth.uid() is not null
    and presence.user_id <> auth.uid()
    and presence.is_visible
    and presence.availability in ('available', 'busy')
    and presence.last_seen_at > now() - interval '5 minutes'
    and calculated.distance_km <= least(greatest(coalesce(p_radius_km, 25), 1), 100)
  order by calculated.distance_km, presence.last_seen_at desc
  limit 50
$$;

revoke all on function public.search_direct_message_candidates(text) from public;
revoke all on function public.nearby_online_players(double precision, double precision, double precision) from public;
grant execute on function public.search_direct_message_candidates(text) to authenticated;
grant execute on function public.nearby_online_players(double precision, double precision, double precision) to authenticated;

-- RETURNS TABLE uses OUT parameters as part of the function's return type.
-- Some deployed environments have an older OUT-row definition, which cannot
-- be changed by CREATE OR REPLACE even though the input signature is the same.
drop function if exists public.get_player_suggestions(integer);

create function public.get_player_suggestions(p_limit integer default 8)
returns table (
  id uuid, display_name text, avatar_url text, home_area text,
  skill_rating numeric, reason text, followers bigint, following bigint, mutuals bigint
)
language sql stable security definer set search_path = ''
as $$
  with viewer as (
    select profile.home_area, profile.skill_rating
    from public.profiles profile where profile.id = auth.uid()
  )
  select profile.id, profile.display_name, profile.avatar_url, profile.home_area,
    case when public.can_view_competitive_profile(profile.id) then profile.skill_rating else null end,
    case
      when public.shares_team_with(profile.id) then 'Teammate'
      when exists (select 1 from public.player_follows relation where relation.follower_id = profile.id and relation.followed_id = auth.uid()) then 'Follows you'
      when viewer.home_area is not null and lower(viewer.home_area) = lower(profile.home_area) then 'Plays in your area'
      when public.can_view_competitive_profile(profile.id)
        and viewer.skill_rating is not null and profile.skill_rating is not null
        and abs(viewer.skill_rating - profile.skill_rating) <= 0.5 then 'Similar skill level'
      else 'Peakle player'
    end,
    (select count(*) from public.player_follows relation where relation.followed_id = profile.id),
    (select count(*) from public.player_follows relation where relation.follower_id = profile.id),
    (select count(*) from public.player_follows relation1 join public.player_follows relation2 on relation1.followed_id = relation2.followed_id where relation1.follower_id = auth.uid() and relation2.follower_id = profile.id)
  from public.profiles profile
  cross join viewer
  where auth.uid() is not null
    and profile.id <> auth.uid()
    and profile.onboarding_completed
    and not exists (select 1 from public.player_follows relation where relation.follower_id = auth.uid() and relation.followed_id = profile.id)
    and not exists (select 1 from public.player_follow_requests pending where pending.requester_id = auth.uid() and pending.recipient_id = profile.id)
    and not exists (select 1 from public.chat_user_blocks block where (block.blocker_id = auth.uid() and block.blocked_id = profile.id) or (block.blocker_id = profile.id and block.blocked_id = auth.uid()))
  order by public.shares_team_with(profile.id) desc,
    exists (select 1 from public.player_follows relation where relation.follower_id = profile.id and relation.followed_id = auth.uid()) desc,
    (viewer.home_area is not null and lower(viewer.home_area) = lower(profile.home_area)) desc,
    profile.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;

revoke all on function public.get_player_suggestions(integer) from public;
grant execute on function public.get_player_suggestions(integer) to authenticated;

notify pgrst, 'reload schema';
commit;
