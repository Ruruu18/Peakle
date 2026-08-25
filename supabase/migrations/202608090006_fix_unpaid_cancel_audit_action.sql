-- Migration version normalized to preserve the original execution order.
-- cancel_unpaid_booking writes action = 'unpaid_cancelled', but
-- the audit log's check constraint never allowed that value, so every unpaid
-- cancellation fails with "violates check constraint".
alter table public.booking_audit_log drop constraint if exists booking_audit_log_action_check;
alter table public.booking_audit_log add constraint booking_audit_log_action_check
  check (action in ('created', 'modified', 'cancelled', 'waitlist_promoted', 'unpaid_cancelled'));
