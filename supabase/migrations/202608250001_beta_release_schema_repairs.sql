begin;

-- Organizer Pass was retired after privileged implementations had already
-- been moved into app_private. Remove the obsolete entry point and the stale
-- private implementation that still referenced the deleted entitlement RPC.
drop function if exists public.create_open_play_session(
  text, text, integer, integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text
);
drop function if exists app_private.create_open_play_session(
  text, text, integer, integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text
);
drop function if exists app_private.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
);

-- Use an unambiguous variable name for the calculated refund and qualify
-- target columns. The earlier body failed at runtime because refund_amount
-- could refer to either the PL/pgSQL variable or the table column.
create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_expected_revision bigint,
  p_reason text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_booking public.bookings;
  selected_venue public.venues;
  before_value jsonb;
  updated public.bookings;
  target_court text;
  target_venue text;
  is_player boolean;
  is_owner_or_admin boolean;
  earnings public.venue_earnings;
  owner_rate numeric(5,4);
  platform_rate numeric(5,4);
  owner_fee numeric(10,2);
  platform_fee_amount numeric(10,2);
  v_refund_amount numeric(10,2);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select court_id, venue_id into target_court, target_venue
  from public.bookings
  where id = p_booking_id and status in ('pending', 'confirmed');
  if not found then raise exception 'Booking is no longer cancellable'; end if;

  is_player := exists (
    select 1 from public.bookings
    where id = p_booking_id and user_id = auth.uid()
  );
  is_owner_or_admin := public.can_manage_venue(target_venue) or public.is_platform_admin();
  if not is_player and not is_owner_or_admin then
    raise exception 'You cannot cancel this booking';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_court, 0));
  select * into current_booking
  from public.bookings
  where id = p_booking_id and status in ('pending', 'confirmed')
  for update;
  if not found then raise exception 'Booking is no longer cancellable'; end if;
  if current_booking.revision <> p_expected_revision then
    raise exception 'Booking changed on another device. Refresh and try again';
  end if;

  select * into selected_venue
  from public.venues
  where id = current_booking.venue_id;
  if is_player and now() > current_booking.starts_at - make_interval(mins => selected_venue.cancellation_cutoff_minutes) then
    raise exception 'The free-cancellation window has closed. Contact the venue';
  end if;

  before_value := to_jsonb(current_booking);
  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = nullif(trim(p_reason), ''),
      refund_status = case when current_booking.payment_status = 'paid' then 'pending' else refund_status end,
      revision = revision + 1
  where id = current_booking.id
  returning * into updated;

  select * into earnings
  from public.venue_earnings
  where booking_id = p_booking_id and outcome = 'active'
  for update;

  if earnings.id is not null then
    if is_player then
      select value::numeric into owner_rate
      from public.platform_config
      where key = 'cancellation_owner_fee_rate';
      select value::numeric into platform_rate
      from public.platform_config
      where key = 'cancellation_platform_fee_rate';
      owner_fee := round(earnings.total_collected * owner_rate, 2);
      platform_fee_amount := round(earnings.total_collected * platform_rate, 2);
    else
      owner_fee := 0;
      platform_fee_amount := 0;
    end if;

    v_refund_amount := earnings.total_collected - owner_fee - platform_fee_amount;

    if earnings.status in ('requested', 'processing', 'paid') then
      insert into public.venue_earnings_adjustments (
        venue_id, venue_earnings_id, amount, reason
      ) values (
        earnings.venue_id,
        earnings.id,
        owner_fee - earnings.venue_amount,
        format('Cancellation after payout: owner entitled to ₱%s only, remainder clawed back', owner_fee)
      );
    end if;

    update public.venue_earnings as target
    set outcome = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        original_venue_amount = target.venue_amount,
        original_platform_fee = target.platform_fee,
        venue_amount = owner_fee,
        platform_fee = platform_fee_amount,
        refund_amount = v_refund_amount
    where target.id = earnings.id;

    insert into public.booking_refunds (
      booking_id,
      venue_earnings_id,
      total_collected,
      refund_amount,
      owner_fee_retained,
      platform_fee_retained
    ) values (
      p_booking_id,
      earnings.id,
      earnings.total_collected,
      v_refund_amount,
      owner_fee,
      platform_fee_amount
    );
  end if;

  insert into public.booking_audit_log (
    booking_id, actor_id, action, before_state, after_state
  ) values (
    updated.id, auth.uid(), 'cancelled', before_value, to_jsonb(updated)
  );
  perform public.offer_next_court_waitlist(updated.court_id, updated.starts_at, updated.ends_at);
  return updated;
end;
$$;

revoke all on function public.cancel_booking(uuid, bigint, text) from public, anon;
grant execute on function public.cancel_booking(uuid, bigint, text) to authenticated;

-- Organizer Pass no longer exists. Report the user's current paid venue
-- membership product instead of joining the retired entitlement table.
create or replace function public.admin_list_users(
  p_search text default '',
  p_limit integer default 100
)
returns table (
  id uuid,
  display_name text,
  email text,
  created_at timestamptz,
  rating numeric,
  is_banned boolean,
  ban_reason text,
  membership_tier text,
  avatar_url text
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
    active_membership.tier,
    profile.avatar_url
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join lateral (
    select product.name::text as tier
    from public.player_memberships membership
    join public.membership_products product on product.id = membership.product_id
    where membership.user_id = profile.id
      and membership.status = 'active'
      and membership.payment_status = 'paid'
      and membership.expires_at > now()
    order by membership.expires_at desc
    limit 1
  ) active_membership on true
  where trim(p_search) = ''
    or profile.display_name ilike '%' || trim(p_search) || '%'
    or account.email ilike '%' || trim(p_search) || '%'
  order by profile.created_at desc
  limit p_limit;
end;
$$;

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
  avatar_url text
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
    active_membership.tier,
    profile.avatar_url
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join lateral (
    select product.name::text as tier
    from public.player_memberships membership
    join public.membership_products product on product.id = membership.product_id
    where membership.user_id = profile.id
      and membership.status = 'active'
      and membership.payment_status = 'paid'
      and membership.expires_at > now()
    order by membership.expires_at desc
    limit 1
  ) active_membership on true
  where profile.id = p_user_id;
end;
$$;

revoke all on function public.admin_list_users(text, integer) from public, anon;
revoke all on function public.admin_get_user(uuid) from public, anon;
grant execute on function public.admin_list_users(text, integer) to authenticated;
grant execute on function public.admin_get_user(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
