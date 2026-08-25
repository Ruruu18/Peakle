-- Paid membership products use the same PayMongo checkout/webhook trust
-- boundary as court bookings. The client may start a checkout, but only the
-- service-role webhook can mark a paid product as paid and activate access.

alter table public.player_memberships
  add column amount_due numeric(10,2) not null default 0 check (amount_due >= 0),
  add column currency text not null default 'PHP',
  add column payment_status text not null default 'awaiting_payment'
    check (payment_status in ('awaiting_payment', 'paid', 'failed', 'refunded')),
  add column payment_method text,
  add column paymongo_checkout_session_id text,
  add column paymongo_payment_id text,
  add column paid_at timestamptz;

update public.player_memberships membership
set amount_due = product.price,
    payment_status = case
      when membership.status in ('active', 'paused', 'expired') then 'paid'
      else 'awaiting_payment'
    end,
    paid_at = case
      when membership.status in ('active', 'paused', 'expired') then membership.starts_at
      else null
    end,
    payment_method = case
      when membership.status in ('active', 'paused', 'expired') then 'legacy'
      else null
    end
from public.membership_products product
where product.id = membership.product_id;

alter table public.player_memberships
  add constraint active_memberships_require_payment
  check (status <> 'active' or payment_status = 'paid');

create unique index player_memberships_checkout_session_idx
  on public.player_memberships (paymongo_checkout_session_id)
  where paymongo_checkout_session_id is not null;

create unique index player_memberships_paymongo_payment_idx
  on public.player_memberships (paymongo_payment_id)
  where paymongo_payment_id is not null;

-- Earnings can originate from either a court booking or a membership sale.
-- Existing booking rows remain unchanged and every row has exactly one source.
alter table public.venue_earnings alter column booking_id drop not null;
alter table public.venue_earnings
  add column membership_id uuid references public.player_memberships(id) on delete restrict,
  add constraint venue_earnings_membership_key unique (membership_id),
  add constraint venue_earnings_exactly_one_source check (num_nonnulls(booking_id, membership_id) = 1);

create or replace function public.request_membership_product(p_product_id uuid)
returns public.player_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.membership_products;
  membership public.player_memberships;
  initial_status text;
  initial_payment_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into product
  from public.membership_products
  where id = p_product_id
    and active
    and public.is_verified_active_venue(venue_id);
  if product.id is null then raise exception 'This membership product is unavailable'; end if;

  select * into membership
  from public.player_memberships
  where product_id = p_product_id
    and user_id = auth.uid()
    and status in ('pending', 'active', 'paused')
  order by created_at desc
  limit 1;

  if membership.id is not null then
    -- A failed checkout may be retried without creating duplicate orders.
    if membership.status = 'pending' and membership.payment_status = 'failed' then
      update public.player_memberships
      set payment_status = 'awaiting_payment',
          paymongo_checkout_session_id = null
      where id = membership.id
      returning * into membership;
    end if;
    return membership;
  end if;

  initial_status := case when product.price = 0 then 'active' else 'pending' end;
  initial_payment_status := case when product.price = 0 then 'paid' else 'awaiting_payment' end;

  insert into public.player_memberships(
    product_id, user_id, status, credits_remaining, starts_at, expires_at,
    amount_due, currency, payment_status, payment_method, paid_at
  ) values (
    product.id, auth.uid(), initial_status, product.credits, now(),
    now() + (product.validity_days || ' days')::interval,
    product.price, 'PHP', initial_payment_status,
    case when product.price = 0 then 'free' else null end,
    case when product.price = 0 then now() else null end
  ) returning * into membership;

  if product.price = 0 and product.credits > 0 then
    insert into public.membership_credit_ledger(membership_id, delta, reason, created_by)
    values (membership.id, product.credits, 'Initial package credits', auth.uid());
  end if;

  return membership;
end;
$$;

-- Manual activation remains available for zero-cost products only. Paid
-- products must be activated by record_membership_payment below.
create or replace function public.activate_player_membership(p_membership_id uuid)
returns public.player_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership public.player_memberships;
  product public.membership_products;
begin
  select * into membership
  from public.player_memberships
  where id = p_membership_id
  for update;
  select * into product from public.membership_products where id = membership.product_id;

  if membership.id is null or product.id is null or not public.can_manage_venue(product.venue_id) then
    raise exception 'Venue management permission required';
  end if;
  if product.price > 0 and membership.payment_status <> 'paid' then
    raise exception 'Payment must be verified before this membership can be activated';
  end if;
  if membership.status <> 'pending' then return membership; end if;

  update public.player_memberships
  set status = 'active',
      payment_status = 'paid',
      payment_method = coalesce(payment_method, 'free'),
      paid_at = coalesce(paid_at, now()),
      credits_remaining = product.credits,
      starts_at = now(),
      expires_at = now() + (product.validity_days || ' days')::interval
  where id = p_membership_id
  returning * into membership;

  if product.credits > 0 and not exists (
    select 1 from public.membership_credit_ledger where membership_id = membership.id
  ) then
    insert into public.membership_credit_ledger(membership_id, delta, reason, created_by)
    values (membership.id, product.credits, 'Initial package credits', auth.uid());
  end if;
  return membership;
end;
$$;

create or replace function public.record_membership_payment(
  p_membership_id uuid,
  p_paymongo_payment_id text,
  p_amount_paid numeric,
  p_payment_method text default null
)
returns public.player_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership public.player_memberships;
  product public.membership_products;
  v_fee_rate numeric(5,4);
  v_platform_fee numeric(10,2);
  v_venue_amount numeric(10,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'This action is only available to the payment webhook';
  end if;

  select * into membership
  from public.player_memberships
  where id = p_membership_id
  for update;
  if membership.id is null then raise exception 'Membership order not found'; end if;

  select * into product from public.membership_products where id = membership.product_id;
  if product.id is null then raise exception 'Membership product not found'; end if;

  -- Webhook retries are idempotent. A second delivery returns the entitlement
  -- without duplicating credits or venue earnings.
  if membership.payment_status = 'paid' then return membership; end if;
  if membership.payment_status <> 'awaiting_payment' or membership.status <> 'pending' then
    raise exception 'Membership is not awaiting payment';
  end if;
  if coalesce(trim(p_paymongo_payment_id), '') = '' then
    raise exception 'PayMongo payment id is required';
  end if;
  if round(p_amount_paid, 2) <> round(membership.amount_due, 2) then
    raise exception 'Paid amount does not match the membership order';
  end if;
  if membership.amount_due <= 0 then raise exception 'Free memberships do not require a payment webhook'; end if;

  update public.player_memberships
  set payment_status = 'paid',
      status = 'active',
      payment_method = p_payment_method,
      paymongo_payment_id = p_paymongo_payment_id,
      paid_at = now(),
      credits_remaining = product.credits,
      starts_at = now(),
      expires_at = now() + (product.validity_days || ' days')::interval
  where id = membership.id
  returning * into membership;

  if product.credits > 0 then
    insert into public.membership_credit_ledger(membership_id, delta, reason, created_by)
    values (membership.id, product.credits, 'Initial package credits', membership.user_id);
  end if;

  v_fee_rate := coalesce(
    (select value::numeric from public.platform_config where key = 'platform_fee_rate'),
    0
  );
  v_platform_fee := round(p_amount_paid * v_fee_rate, 2);
  v_venue_amount := p_amount_paid - v_platform_fee;

  insert into public.venue_earnings(
    venue_id, membership_id, total_collected, platform_fee, venue_amount, fee_rate
  ) values (
    product.venue_id, membership.id, p_amount_paid, v_platform_fee, v_venue_amount, v_fee_rate
  ) on conflict (membership_id) do nothing;

  return membership;
end;
$$;

revoke all on function public.record_membership_payment(uuid, text, numeric, text) from public;
grant execute on function public.record_membership_payment(uuid, text, numeric, text) to service_role;

-- Include both booking and membership sales in the organizer's balance and
-- transaction ledger while preserving the existing response keys.
create or replace function public.get_venue_earnings_summary(p_venue_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_available numeric(10,2);
  v_pending_withdrawal numeric(10,2);
  v_total_earned numeric(10,2);
  v_total_transactions integer;
  v_min numeric(10,2);
  v_history jsonb;
begin
  if not public.can_manage_venue(p_venue_id) then raise exception 'Venue access required'; end if;

  select coalesce(sum(venue_amount), 0) into v_available
  from public.venue_earnings where venue_id = p_venue_id and status = 'pending';
  v_available := v_available + coalesce((
    select sum(amount) from public.venue_earnings_adjustments
    where venue_id = p_venue_id and settled = false
  ), 0);

  select coalesce(sum(amount), 0) into v_pending_withdrawal
  from public.withdrawal_requests
  where venue_id = p_venue_id and status in ('pending', 'approved');

  select coalesce(sum(venue_amount), 0), count(*)
  into v_total_earned, v_total_transactions
  from public.venue_earnings where venue_id = p_venue_id;

  select value::numeric into v_min
  from public.platform_config where key = 'min_withdrawal_amount';

  select coalesce(jsonb_agg(row_to_json(history_row) order by history_row.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select
      earning.id, earning.total_collected, earning.venue_amount, earning.platform_fee,
      earning.outcome, earning.status, earning.created_at,
      case
        when earning.booking_id is not null then booking.reference
        else 'MEM-' || upper(substr(replace(membership.id::text, '-', ''), 1, 8))
      end as reference,
      coalesce(booking.starts_at, membership.starts_at) as starts_at,
      case when earning.booking_id is not null then 'booking' else 'membership' end as source_type,
      coalesce(court.name, product.name) as description
    from public.venue_earnings earning
    left join public.bookings booking on booking.id = earning.booking_id
    left join public.courts court on court.id = booking.court_id
    left join public.player_memberships membership on membership.id = earning.membership_id
    left join public.membership_products product on product.id = membership.product_id
    where earning.venue_id = p_venue_id
    order by earning.created_at desc
    limit 50
  ) history_row;

  return jsonb_build_object(
    'available_balance', v_available,
    'pending_withdrawal', v_pending_withdrawal,
    'total_earned', v_total_earned,
    'total_bookings', v_total_transactions,
    'total_transactions', v_total_transactions,
    'min_withdrawal_amount', v_min,
    'history', v_history
  );
end;
$$;

revoke all on function public.get_venue_earnings_summary(text) from public;
grant execute on function public.get_venue_earnings_summary(text) to authenticated;

create or replace function public.list_my_payment_history(
  p_limit integer default 21,
  p_offset integer default 0
)
returns table (
  id uuid,
  amount numeric,
  currency text,
  payment_status text,
  payment_method text,
  refund_status text,
  created_at timestamptz,
  starts_at timestamptz,
  source_type text,
  display_name text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_limit < 1 or p_limit > 101 then raise exception 'Payment history limit must be from 1 to 101'; end if;
  if p_offset < 0 then raise exception 'Payment history offset cannot be negative'; end if;

  return query
  select history.*
  from (
    select
      booking.id,
      booking.amount,
      booking.currency,
      booking.payment_status,
      booking.payment_method,
      booking.refund_status,
      booking.created_at,
      booking.starts_at,
      'booking'::text as source_type,
      venue.name::text as display_name
    from public.bookings booking
    join public.venues venue on venue.id = booking.venue_id
    where booking.user_id = auth.uid()

    union all

    select
      membership.id,
      membership.amount_due as amount,
      membership.currency,
      membership.payment_status,
      membership.payment_method,
      case when membership.payment_status = 'refunded' then 'refunded' else null end::text as refund_status,
      membership.created_at,
      membership.starts_at,
      'membership'::text as source_type,
      (venue.name || ' · ' || product.name)::text as display_name
    from public.player_memberships membership
    join public.membership_products product on product.id = membership.product_id
    join public.venues venue on venue.id = product.venue_id
    where membership.user_id = auth.uid()
  ) history
  order by history.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.list_my_payment_history(integer, integer) from public;
grant execute on function public.list_my_payment_history(integer, integer) to authenticated;
