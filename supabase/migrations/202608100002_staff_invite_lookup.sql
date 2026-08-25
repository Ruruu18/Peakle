-- The organizer staff invite flow previously ended at a mailto: link with no
-- way to actually complete the invite: an owner/manager had no way to find a
-- newly-signed-up teammate's account to grant them a role. This adds a
-- narrow, permission-gated lookup so the invite screen can go straight from
-- "enter their email" to "assign a role" for people who already have a
-- Peakle account, while still falling back to sign-up instructions for
-- people who don't.

create or replace function public.find_staff_candidate_by_email(
  p_venue_id text,
  p_email text
)
returns table (user_id uuid, display_name text, already_staff boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_venue(p_venue_id) then
    raise exception 'Owner or manager permission required';
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    exists (
      select 1 from public.venue_members member
      where member.venue_id = p_venue_id and member.user_id = profile.id
    )
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where lower(account.email) = lower(trim(coalesce(p_email, '')))
  limit 1;
end;
$$;

revoke all on function public.find_staff_candidate_by_email(text, text) from public;
grant execute on function public.find_staff_candidate_by_email(text, text) to authenticated;
