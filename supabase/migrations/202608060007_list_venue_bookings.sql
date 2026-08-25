-- Venue owners currently have no way to see the bookings made at their own
-- venue — bookings RLS only lets the booking's own player (or invited
-- team) read it. This adds a SECURITY DEFINER RPC, gated by
-- can_manage_venue, matching the existing get_venue_earnings_summary
-- pattern.

create or replace function public.list_venue_bookings(p_venue_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.can_manage_venue(p_venue_id) then raise exception 'Venue access required'; end if;

  return coalesce((
    select jsonb_agg(row_to_json(booking_row) order by booking_row.starts_at desc)
    from (
      select
        b.id, b.reference, b.starts_at, b.ends_at, b.amount, b.currency,
        b.status, b.payment_status, b.created_at,
        c.name as court_name, p.display_name as player_name
      from public.bookings b
      join public.courts c on c.id = b.court_id
      join public.profiles p on p.id = b.user_id
      where b.venue_id = p_venue_id
      order by b.starts_at desc
      limit 200
    ) booking_row
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_venue_bookings(text) from public;
grant execute on function public.list_venue_bookings(text) to authenticated;
