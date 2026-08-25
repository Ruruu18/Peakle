-- Migration version normalized to keep every deployment version unique.
-- Booking ownership is private. Other players may learn that a court slot is
-- unavailable through the privacy-safe availability RPC, but they must not be
-- able to select another player's booking row or display it as their own.
drop policy if exists "team members read invited bookings" on public.bookings;
