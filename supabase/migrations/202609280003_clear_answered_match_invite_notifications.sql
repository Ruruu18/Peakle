-- A nearby match invitation notice is only actionable while the invite is
-- pending. Once it is accepted, declined, cancelled or expired, remove the
-- recipient's "New match invitation" notice, like answered follow requests.

create or replace function public.clear_answered_match_invite_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' or old.status is not distinct from new.status then
    return new;
  end if;

  delete from public.user_notifications notification
  where notification.user_id = new.recipient_id
    and notification.kind = 'match_invite'
    and notification.data->>'inviteId' = new.id::text;

  return new;
end;
$$;

revoke all on function public.clear_answered_match_invite_notification() from public;

drop trigger if exists clear_answered_match_invite_notification on public.match_invites;
create trigger clear_answered_match_invite_notification
after update of status on public.match_invites
for each row
execute function public.clear_answered_match_invite_notification();

-- Clean up notices left behind by invites that were answered or have lapsed
-- (invites only last one minute) before this trigger existed.
delete from public.user_notifications notification
where notification.kind = 'match_invite'
  and not exists (
    select 1
    from public.match_invites invite
    where invite.id::text = notification.data->>'inviteId'
      and invite.status = 'pending'
      and invite.created_at > now() - interval '1 minute'
  );
