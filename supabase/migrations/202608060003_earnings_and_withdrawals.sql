-- Earnings ledger + withdrawal system. venue_earnings records the
-- platform/owner split per paid booking; withdrawal_requests is how an
-- owner cashes out. Disbursement itself is manual for now (admin sends via
-- GCash/bank/Maya and marks the request completed) — no live payout API.
--
-- All writes to these tables happen through SECURITY DEFINER RPCs (owned by
-- the migration role, which bypasses RLS in Supabase, matching the existing
-- admin_grant_entitlement pattern). RLS is enabled with no permissive
-- policies, so direct client reads/writes are blocked; everything goes
-- through the RPCs below, which return jsonb shaped for the UI.

create table public.withdrawal_requests (
  id              uuid primary key default gen_random_uuid(),
  venue_id        text not null references public.venues(id),
  requested_by    uuid not null references public.profiles(id),

  amount          numeric(10,2) not null check (amount > 0),

  payout_method   text not null check (payout_method in ('gcash', 'bank_transfer', 'maya')),
  payout_details  jsonb not null,

  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'completed')),

  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,
  rejection_note  text,

  paymongo_disbursement_id text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.withdrawal_requests enable row level security;

create trigger withdrawal_requests_set_updated_at
before update on public.withdrawal_requests
for each row execute function public.set_updated_at();

create table public.venue_earnings (
  id              uuid primary key default gen_random_uuid(),
  venue_id        text not null references public.venues(id) on delete restrict,
  booking_id      uuid not null references public.bookings(id) on delete restrict,

  total_collected numeric(10,2) not null,
  platform_fee    numeric(10,2) not null,
  venue_amount    numeric(10,2) not null,
  fee_rate        numeric(5,4)  not null,

  outcome                text not null default 'active'
                          check (outcome in ('active', 'cancelled')),
  cancelled_at            timestamptz,
  cancelled_by            uuid references public.profiles(id),
  original_venue_amount   numeric(10,2),
  original_platform_fee   numeric(10,2),
  refund_amount           numeric(10,2),

  status          text not null default 'pending'
                  check (status in ('pending', 'requested', 'processing', 'paid')),
  withdrawal_id   uuid references public.withdrawal_requests(id),

  created_at      timestamptz not null default now(),
  unique (booking_id)
);

alter table public.venue_earnings enable row level security;
create index venue_earnings_venue_status_idx on public.venue_earnings (venue_id, status);
create index venue_earnings_withdrawal_idx on public.venue_earnings (withdrawal_id);

create table public.venue_earnings_adjustments (
  id                uuid primary key default gen_random_uuid(),
  venue_id          text not null references public.venues(id),
  venue_earnings_id uuid not null references public.venue_earnings(id),
  amount            numeric(10,2) not null,
  reason            text not null,
  settled           boolean not null default false,
  created_at        timestamptz not null default now()
);

alter table public.venue_earnings_adjustments enable row level security;
create index venue_earnings_adjustments_venue_idx on public.venue_earnings_adjustments (venue_id, settled);

create table public.booking_refunds (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references public.bookings(id) on delete restrict,
  venue_earnings_id     uuid not null references public.venue_earnings(id),
  total_collected       numeric(10,2) not null,
  refund_amount         numeric(10,2) not null,
  owner_fee_retained    numeric(10,2) not null,
  platform_fee_retained numeric(10,2) not null,
  paymongo_refund_id    text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'refunded', 'failed')),
  created_at timestamptz not null default now(),
  unique (booking_id)
);

alter table public.booking_refunds enable row level security;

-- Owner requests a payout of their full current balance (no partial
-- amounts — avoids the bookkeeping complexity of tracking which earnings
-- rows count toward a partial request). Only one request may be in
-- flight per venue at a time.
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
  v_min     numeric(10,2);
  v_request public.withdrawal_requests;
begin
  if not public.can_manage_venue(p_venue_id) then
    raise exception 'Venue access required';
  end if;
  if p_payout_method not in ('gcash', 'bank_transfer', 'maya') then
    raise exception 'Choose a valid payout method';
  end if;
  if p_payout_details is null
     or coalesce(trim(p_payout_details ->> 'account_name'), '') = ''
     or coalesce(trim(p_payout_details ->> 'account_number'), '') = '' then
    raise exception 'Payout account name and number are required';
  end if;
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

create or replace function public.admin_approve_withdrawal(p_id uuid)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.withdrawal_requests;
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;

  update public.withdrawal_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and status = 'pending'
  returning * into v_request;

  if v_request.id is null then raise exception 'Withdrawal request is not pending'; end if;

  update public.venue_earnings set status = 'processing' where withdrawal_id = p_id;

  return v_request;
end;
$$;

create or replace function public.admin_reject_withdrawal(p_id uuid, p_note text)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.withdrawal_requests;
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 2 then raise exception 'A rejection note is required'; end if;

  update public.withdrawal_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_note = trim(p_note)
  where id = p_id and status in ('pending', 'approved')
  returning * into v_request;

  if v_request.id is null then raise exception 'Withdrawal request cannot be rejected from its current status'; end if;

  update public.venue_earnings
  set status = 'pending', withdrawal_id = null
  where withdrawal_id = p_id;

  return v_request;
end;
$$;

create or replace function public.admin_complete_withdrawal(p_id uuid, p_note text default null)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.withdrawal_requests;
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;

  update public.withdrawal_requests
  set status = 'completed', reviewed_by = coalesce(reviewed_by, auth.uid()),
      reviewed_at = coalesce(reviewed_at, now()), rejection_note = p_note
  where id = p_id and status = 'approved'
  returning * into v_request;

  if v_request.id is null then raise exception 'Withdrawal request must be approved before it can be completed'; end if;

  update public.venue_earnings set status = 'paid' where withdrawal_id = p_id;

  -- Adjustments that existed as of the request are already netted into
  -- v_request.amount; settle exactly those, not ones created afterward.
  update public.venue_earnings_adjustments
  set settled = true
  where venue_id = v_request.venue_id and settled = false and created_at <= v_request.created_at;

  return v_request;
end;
$$;

revoke all on function public.admin_approve_withdrawal(uuid) from public;
revoke all on function public.admin_reject_withdrawal(uuid, text) from public;
revoke all on function public.admin_complete_withdrawal(uuid, text) from public;
grant execute on function public.admin_approve_withdrawal(uuid) to authenticated;
grant execute on function public.admin_reject_withdrawal(uuid, text) to authenticated;
grant execute on function public.admin_complete_withdrawal(uuid, text) to authenticated;

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
  v_total_bookings integer;
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
  from public.withdrawal_requests where venue_id = p_venue_id and status in ('pending', 'approved');

  select coalesce(sum(venue_amount), 0), count(*) into v_total_earned, v_total_bookings
  from public.venue_earnings where venue_id = p_venue_id;

  select value::numeric into v_min from public.platform_config where key = 'min_withdrawal_amount';

  select coalesce(jsonb_agg(row_to_json(history_row) order by history_row.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select
      ve.id, ve.total_collected, ve.venue_amount, ve.platform_fee, ve.outcome, ve.status, ve.created_at,
      b.reference, b.starts_at
    from public.venue_earnings ve
    join public.bookings b on b.id = ve.booking_id
    where ve.venue_id = p_venue_id
    order by ve.created_at desc
    limit 50
  ) history_row;

  return jsonb_build_object(
    'available_balance', v_available,
    'pending_withdrawal', v_pending_withdrawal,
    'total_earned', v_total_earned,
    'total_bookings', v_total_bookings,
    'min_withdrawal_amount', v_min,
    'history', v_history
  );
end;
$$;

revoke all on function public.get_venue_earnings_summary(text) from public;
grant execute on function public.get_venue_earnings_summary(text) to authenticated;

create or replace function public.admin_get_financial_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_revenue_this_month numeric(10,2);
  v_total_disbursed numeric(10,2);
  v_cancellation_fees numeric(10,2);
  v_pending_count integer;
  v_pending_amount numeric(10,2);
  v_large_threshold numeric(10,2);
  v_very_large_threshold numeric(10,2);
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;

  select coalesce(sum(platform_fee), 0) into v_revenue_this_month
  from public.venue_earnings where created_at >= date_trunc('month', now());

  select coalesce(sum(venue_amount), 0) into v_total_disbursed
  from public.venue_earnings where status = 'paid';

  select coalesce(sum(platform_fee), 0) into v_cancellation_fees
  from public.venue_earnings where outcome = 'cancelled';

  select count(*), coalesce(sum(amount), 0) into v_pending_count, v_pending_amount
  from public.withdrawal_requests where status in ('pending', 'approved');

  select value::numeric into v_large_threshold
  from public.platform_config where key = 'withdrawal_large_amount_threshold';
  select value::numeric into v_very_large_threshold
  from public.platform_config where key = 'withdrawal_very_large_amount_threshold';

  return jsonb_build_object(
    'platform_revenue_this_month', v_revenue_this_month,
    'total_disbursed', v_total_disbursed,
    'cancellation_fees_retained', v_cancellation_fees,
    'pending_withdrawal_count', v_pending_count,
    'pending_withdrawal_amount', v_pending_amount,
    'withdrawal_large_amount_threshold', v_large_threshold,
    'withdrawal_very_large_amount_threshold', v_very_large_threshold
  );
end;
$$;

create or replace function public.admin_list_withdrawal_requests()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;

  return coalesce((
    select jsonb_agg(row_to_json(queue_row) order by queue_row.created_at desc)
    from (
      select
        wr.id, wr.amount, wr.payout_method, wr.payout_details, wr.status,
        wr.rejection_note, wr.created_at, wr.reviewed_at,
        v.name as venue_name, p.display_name as requested_by_name
      from public.withdrawal_requests wr
      join public.venues v on v.id = wr.venue_id
      join public.profiles p on p.id = wr.requested_by
      order by wr.created_at desc
      limit 200
    ) queue_row
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_refund_queue()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;

  return coalesce((
    select jsonb_agg(row_to_json(refund_row) order by refund_row.created_at desc)
    from (
      select
        br.id, br.booking_id, br.total_collected, br.refund_amount,
        br.owner_fee_retained, br.platform_fee_retained, br.status, br.created_at,
        b.reference, pr.display_name as player_name, v.name as venue_name
      from public.booking_refunds br
      join public.bookings b on b.id = br.booking_id
      join public.profiles pr on pr.id = b.user_id
      join public.venues v on v.id = b.venue_id
      order by br.created_at desc
      limit 200
    ) refund_row
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_get_financial_summary() from public;
revoke all on function public.admin_list_withdrawal_requests() from public;
revoke all on function public.admin_list_refund_queue() from public;
grant execute on function public.admin_get_financial_summary() to authenticated;
grant execute on function public.admin_list_withdrawal_requests() to authenticated;
grant execute on function public.admin_list_refund_queue() to authenticated;
