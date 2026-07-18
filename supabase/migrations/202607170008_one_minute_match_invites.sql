-- Keep nearby match invitations intentionally short-lived. The client shows a
-- 60-second countdown; these RPC checks make the same limit authoritative.
create or replace function public.send_match_invite(p_recipient_id uuid, p_match_payload jsonb default '{}'::jsonb)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.match_invites;
begin
  if auth.uid() is null or p_recipient_id = auth.uid() then raise exception 'Choose another signed-in player.'; end if;
  update public.match_invites
    set status = 'expired', updated_at = now()
    where sender_id = auth.uid() and recipient_id = p_recipient_id
      and status = 'pending' and created_at <= now() - interval '1 minute';
  select * into invite from public.match_invites
    where sender_id = auth.uid() and recipient_id = p_recipient_id and status = 'pending'
    order by created_at desc limit 1;
  if invite.id is not null then return invite; end if;
  insert into public.match_invites (sender_id, recipient_id, match_payload)
    values (auth.uid(), p_recipient_id, coalesce(p_match_payload, '{}'::jsonb))
    returning * into invite;
  return invite;
end;
$$;

create or replace function public.respond_match_invite(p_invite_id uuid, p_accept boolean)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.match_invites;
begin
  update public.match_invites
    set status = case when p_accept then 'accepted' else 'declined' end,
        responded_at = now(),
        updated_at = now()
    where id = p_invite_id
      and recipient_id = auth.uid()
      and status = 'pending'
      and created_at > now() - interval '1 minute'
    returning * into changed;
  if changed.id is null then raise exception 'This invitation has expired.'; end if;
  return changed;
end;
$$;

revoke all on function public.send_match_invite(uuid, jsonb) from public;
grant execute on function public.send_match_invite(uuid, jsonb) to authenticated;
revoke all on function public.respond_match_invite(uuid, boolean) from public;
grant execute on function public.respond_match_invite(uuid, boolean) to authenticated;
