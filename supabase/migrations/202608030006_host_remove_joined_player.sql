-- Give the match host a server-authorized way to remove a player after the
-- player accepted. A distinct status lets the recipient distinguish a host
-- removal from voluntarily leaving the lineup.
alter table public.match_invites
  drop constraint if exists match_invites_status_check;

alter table public.match_invites
  add constraint match_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'removed'));

create or replace function public.remove_match_invitee(p_invite_id uuid)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.match_invites;
begin
  update public.match_invites
    set status = 'removed',
        updated_at = now()
    where id = p_invite_id
      and sender_id = auth.uid()
      and status = 'accepted'
    returning * into changed;

  if changed.id is null then
    raise exception 'Only the host can remove a player who joined this match.';
  end if;

  return changed;
end;
$$;

revoke all on function public.remove_match_invitee(uuid) from public;
grant execute on function public.remove_match_invitee(uuid) to authenticated;
