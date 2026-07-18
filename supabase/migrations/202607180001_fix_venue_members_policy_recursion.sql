-- Fix: infinite recursion in "venue staff read venue roster" policy on venue_members.
-- The old policy queried venue_members from within a venue_members policy, causing recursion.
-- Solution: use a SECURITY DEFINER function to bypass RLS when checking same-venue membership.

create or replace function public.is_venue_member(target_venue_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.venue_members
    where venue_id = target_venue_id
      and user_id = auth.uid()
  )
$$;

revoke all on function public.is_venue_member(text) from public;
grant execute on function public.is_venue_member(text) to authenticated;

-- Replace the recursive policy with one that uses the security definer helper.
drop policy if exists "venue staff read venue roster" on public.venue_members;

create policy "venue staff read venue roster" on public.venue_members
  for select to authenticated using (
    -- own row — always visible
    user_id = auth.uid()
    or
    -- any member of the same venue can see the roster (uses definer fn, no recursion)
    public.is_venue_member(venue_id)
  );
