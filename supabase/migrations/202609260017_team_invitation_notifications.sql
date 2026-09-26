-- Team invitations were stored but never announced: the invited player got no
-- inbox entry or push, so they only found the invite by opening the Joined tab.
-- Notify the invitee when an invite is sent (or re-sent), and the inviter when
-- it is accepted.

alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in (
  'approval', 'waitlist_promotion', 'check_in_reminder', 'court_assignment', 'match_point', 'result',
  'cancellation', 'venue_announcement', 'booking_confirmed', 'booking_reminder', 'court_waitlist',
  'booking_changed', 'match_invite', 'match_invite_response', 'match_found', 'organizer_match',
  'direct_message', 'direct_message_request', 'direct_message_accepted', 'follow_request', 'follow_accepted',
  'community_announcement', 'game_invite', 'game_response', 'game_update',
  'team_invite', 'team_invite_response'
));

create or replace function public.notify_team_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter_name text;
  invitee_name text;
  team_name text;
begin
  select nullif(btrim(name), '') into team_name from public.teams where id = new.team_id;

  -- New invite, or a re-invite after a decline/expiry (upsert flips it back to pending).
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending' or old.created_at is distinct from new.created_at) then
    select nullif(btrim(display_name), '') into inviter_name from public.profiles where id = new.invited_by;
    insert into public.user_notifications (user_id, kind, title, body, data)
    values (
      new.invited_user_id,
      'team_invite',
      format('%s invited you to join %s', coalesce(inviter_name, 'A captain'), coalesce(team_name, 'their team')),
      'Open Teams to accept or decline. The invitation expires in 7 days.',
      jsonb_build_object(
        'teamId', new.team_id,
        'invitationId', new.id,
        'inviterId', new.invited_by,
        'dedupeKey', 'team-invite:' || new.id::text || ':' || extract(epoch from new.created_at)::bigint::text
      )
    );
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
    select nullif(btrim(display_name), '') into invitee_name from public.profiles where id = new.invited_user_id;
    insert into public.user_notifications (user_id, kind, title, body, data)
    values (
      new.invited_by,
      'team_invite_response',
      format('%s joined %s', coalesce(invitee_name, 'A player'), coalesce(team_name, 'your team')),
      'They accepted your team invitation.',
      jsonb_build_object(
        'teamId', new.team_id,
        'invitationId', new.id,
        'playerId', new.invited_user_id,
        'dedupeKey', 'team-invite-accepted:' || new.id::text || ':' || extract(epoch from new.responded_at)::bigint::text
      )
    );
  end if;

  -- Once answered, the invitee's own invite notice has nothing left to act on.
  if tg_op = 'UPDATE' and new.status <> 'pending' and old.status = 'pending' then
    update public.user_notifications
    set read_at = coalesce(read_at, now())
    where user_id = new.invited_user_id
      and kind = 'team_invite'
      and data->>'invitationId' = new.id::text;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_team_invitation() from public;

drop trigger if exists notify_team_invitation on public.team_invitations;
create trigger notify_team_invitation
after insert or update on public.team_invitations
for each row execute function public.notify_team_invitation();

notify pgrst, 'reload schema';
