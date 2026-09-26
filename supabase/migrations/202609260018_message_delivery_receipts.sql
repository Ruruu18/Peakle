-- Private chats show Sent / Delivered / Seen under the latest message. A
-- message counts as delivered once the recipient's app has checked in (see
-- touch_player_activity) at or after it was sent, so the sender needs the
-- other participant's last check-in. It is shared only inside an accepted,
-- unblocked conversation the caller belongs to, and only as a timestamp and
-- online flag, never the player's location or chosen status label.
create or replace function public.get_direct_peer_activity(p_conversation_id uuid)
returns table (is_online boolean, last_active_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select
    activity.is_active and activity.last_active_at > now() - interval '5 minutes',
    activity.last_active_at
  from public.direct_conversations conversation
  join public.player_activity activity
    on activity.user_id = case
      when conversation.participant_one_id = auth.uid() then conversation.participant_two_id
      else conversation.participant_one_id
    end
  where auth.uid() is not null
    and conversation.id = p_conversation_id
    and conversation.status = 'accepted'
    and auth.uid() in (conversation.participant_one_id, conversation.participant_two_id)
    and not public.private_chat_is_blocked(activity.user_id)
$$;

revoke all on function public.get_direct_peer_activity(uuid) from public;
grant execute on function public.get_direct_peer_activity(uuid) to authenticated;

-- Team chats show Delivered once any other member's app has checked in since
-- a message was sent. Only the most recent check-in across the team is
-- returned, so no single member's activity is revealed.
create or replace function public.get_team_chat_last_active(p_team_id uuid)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(case
    when activity.is_active and activity.last_active_at > now() - interval '5 minutes' then now()
    else activity.last_active_at
  end)
  from public.team_members member
  join public.player_activity activity on activity.user_id = member.user_id
  where auth.uid() is not null
    and member.team_id = p_team_id
    and member.user_id <> auth.uid()
    and exists (
      select 1 from public.team_members caller
      where caller.team_id = p_team_id and caller.user_id = auth.uid()
    )
$$;

revoke all on function public.get_team_chat_last_active(uuid) from public;
grant execute on function public.get_team_chat_last_active(uuid) to authenticated;

notify pgrst, 'reload schema';
