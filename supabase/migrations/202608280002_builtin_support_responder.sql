-- Keep basic support reliable without requiring an optional Edge Function.
-- Known FAQ topics receive an immediate deterministic reply. Unrecognized
-- questions receive a handoff acknowledgement and move to the live-admin
-- queue (`status = 'open'`) automatically.

create or replace function public.support_builtin_answer(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text := lower(coalesce(p_body, ''));
begin
  return case
    when normalized like any (array['%cancel%', '%refund%', '%cancellation%', '%money back%']) then
      'Open the booking to see the venue''s cancellation policy before cancelling. Eligible refunds are returned through the payment flow and appear in Payment history.'
    when normalized like any (array['%booking%', '%book a court%', '%reservation%', '%payment status%']) then
      'Open Explore and switch to My Bookings to see your bookings and payment status. Payment history has your full receipt and refund record.'
    when normalized like any (array['%box score%', '%rally history%', '%match result%', '%game result%', '%my matches%']) then
      'Go to Profile, then Matches, then tap a match to open its box score and rally history.'
    when normalized like any (array['%notification%', '%not receiving%', '%not getting alerts%']) then
      'Check that Peakle notifications are allowed in your phone''s settings, then use the notification test in Help & Support to verify this device.'
    when normalized like any (array['%privacy%', '%visibility%', '%who can see%', '%player matching%', '%hide my profile%']) then
      'Privacy & matching lets you control your competitive-profile visibility, availability, and whether player matching is enabled.'
    when normalized like any (array['%change my name%', '%update photo%', '%home area%', '%account details%', '%profile photo%', '%edit profile%']) then
      'Go to Profile, then Settings, then Account details to update your name, photo, or home area.'
    when normalized like any (array['%report%', '%harass%', '%unsafe%', '%block a player%', '%safety concern%']) then
      'Use the report option on the relevant message or conversation so the safety team gets the right context. If someone may be in immediate danger, contact local emergency services — Peakle support is not an emergency service.'
    when normalized like any (array['%staff access%', '%team access%', '%invite staff%', '%add teammate%']) then
      'Add or manage teammate access from Staff Access in the organizer portal — you control exactly what each role can do.'
    when normalized like any (array['%payout%', '%earnings%', '%withdrawal%', '%my balance%']) then
      'Your balance, payout history, and withdrawal requests are under Earnings in the organizer portal.'
    when normalized like any (array['%open play%', '%publish a session%', '%session registration%']) then
      'Open Play lets you publish sessions, manage registration, and track live courts from the organizer portal.'
    when normalized like any (array['%venue%', '%court setup%', '%add a court%', '%venue hours%']) then
      'Manage your facility details, courts, and hours from Venue & Courts in the organizer portal.'
    else null
  end;
end;
$$;

create or replace function public.answer_or_escalate_support_conversation(
  p_conversation_id uuid,
  p_body text,
  p_user_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_status text;
  latest_sender_type text;
  reply_text text := public.support_builtin_answer(p_body);
  matched boolean := reply_text is not null;
  reply_created_at timestamptz;
begin
  select item.status into conversation_status
  from public.support_conversations item
  where item.id = p_conversation_id
  for update;

  if not found or conversation_status <> 'bot' then
    return false;
  end if;

  select message.sender_type into latest_sender_type
  from public.support_messages message
  where message.conversation_id = p_conversation_id
  order by message.created_at desc, message.id desc
  limit 1;

  -- Makes the responder idempotent if an older client also tries the legacy
  -- Edge Function after the database trigger has already answered.
  if latest_sender_type is distinct from 'user' then
    return false;
  end if;

  if not matched then
    reply_text := 'I don''t have a saved answer for that, so I''ve sent this conversation to a Peakle teammate. They''ll reply here.';
  end if;

  reply_created_at := greatest(
    clock_timestamp(),
    coalesce(p_user_created_at, clock_timestamp()) + interval '1 microsecond'
  );

  insert into public.support_messages(
    conversation_id, sender_type, sender_id, body, created_at
  )
  values (p_conversation_id, 'ai', null, reply_text, reply_created_at);

  update public.support_conversations
  set status = case when matched then 'bot' else 'open' end,
      ai_handled = matched,
      needs_human = not matched,
      last_message_at = reply_created_at,
      updated_at = reply_created_at
  where id = p_conversation_id;

  return matched;
end;
$$;

create or replace function public.handle_support_user_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.answer_or_escalate_support_conversation(
    new.conversation_id,
    new.body,
    new.created_at
  );
  return new;
end;
$$;

drop trigger if exists support_messages_auto_response on public.support_messages;
create trigger support_messages_auto_response
after insert on public.support_messages
for each row
when (new.sender_type = 'user')
execute function public.handle_support_user_message();

revoke all on function public.support_builtin_answer(text) from public;
revoke all on function public.answer_or_escalate_support_conversation(uuid, text, timestamptz) from public;
revoke all on function public.handle_support_user_message() from public;

-- Repair conversations stranded while the undeployed Edge Function returned
-- 404. This inserts the appropriate FAQ reply or queues the conversation for
-- a human immediately when the migration is applied.
do $$
declare
  pending record;
begin
  for pending in
    select
      conversation.id as conversation_id,
      latest.body,
      latest.created_at
    from public.support_conversations conversation
    cross join lateral (
      select message.body, message.created_at, message.sender_type
      from public.support_messages message
      where message.conversation_id = conversation.id
      order by message.created_at desc, message.id desc
      limit 1
    ) latest
    where conversation.status = 'bot'
      and latest.sender_type = 'user'
  loop
    perform public.answer_or_escalate_support_conversation(
      pending.conversation_id,
      pending.body,
      pending.created_at
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
