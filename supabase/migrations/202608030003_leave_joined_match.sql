-- Let an invited player deliberately leave an accepted match while it is
-- still waiting to start. The cancelled status is already supported by the
-- match_invites table and is visible to both participants in realtime.
create or replace function public.leave_match_invite(p_invite_id uuid)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.match_invites;
begin
  update public.match_invites
    set status = 'cancelled',
        responded_at = now(),
        updated_at = now()
    where id = p_invite_id
      and recipient_id = auth.uid()
      and status = 'accepted'
    returning * into changed;

  if changed.id is null then
    raise exception 'This joined match is no longer available to leave.';
  end if;

  return changed;
end;
$$;

revoke all on function public.leave_match_invite(uuid) from public;
grant execute on function public.leave_match_invite(uuid) to authenticated;

notify pgrst, 'reload schema';
