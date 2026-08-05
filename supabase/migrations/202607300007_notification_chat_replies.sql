-- Interactive notification replies are processed by both the normal response
-- listener and (on Android) a headless task. Store a receipt before sending so
-- the same OS action can never create two chat messages.

alter table public.profiles
  alter column notification_preferences
  set default '{"squad":true,"reminders":true,"calendar":false,"messages":true}'::jsonb;

update public.profiles
set notification_preferences = coalesce(notification_preferences, '{}'::jsonb)
  || jsonb_build_object('messages', true)
where not (coalesce(notification_preferences, '{}'::jsonb) ? 'messages');

create table if not exists public.notification_action_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid not null references public.user_notifications(id) on delete cascade,
  action_key text not null,
  message_id uuid references public.direct_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, notification_id, action_key)
);

alter table public.notification_action_receipts enable row level security;
revoke all on public.notification_action_receipts from authenticated;

create or replace function public.reply_to_direct_message_notification(
  p_notification_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notice public.user_notifications;
  clean_body text := btrim(coalesce(p_body, ''));
  conversation_id uuid;
  sent_message_id uuid;
  claimed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in before replying.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 4000 then
    raise exception 'Messages must be between 1 and 4000 characters.';
  end if;

  select item.* into notice
  from public.user_notifications item
  where item.id = p_notification_id
    and item.user_id = auth.uid()
    and item.kind = 'direct_message';

  if not found then
    raise exception 'This message notification is no longer available.';
  end if;

  begin
    conversation_id := (notice.data->>'conversationId')::uuid;
  exception when others then
    raise exception 'This message notification is invalid.';
  end;
  if conversation_id is null then
    raise exception 'This message notification is invalid.';
  end if;

  insert into public.notification_action_receipts(user_id, notification_id, action_key)
  values (auth.uid(), notice.id, 'reply')
  on conflict do nothing
  returning true into claimed;

  if not coalesce(claimed, false) then
    select receipt.message_id into sent_message_id
    from public.notification_action_receipts receipt
    where receipt.user_id = auth.uid()
      and receipt.notification_id = notice.id
      and receipt.action_key = 'reply';
    return sent_message_id;
  end if;

  sent_message_id := public.send_direct_message(conversation_id, clean_body);

  update public.notification_action_receipts
  set message_id = sent_message_id
  where user_id = auth.uid()
    and notification_id = notice.id
    and action_key = 'reply';

  update public.user_notifications
  set read_at = coalesce(read_at, now())
  where id = notice.id and user_id = auth.uid();

  return sent_message_id;
end;
$$;

revoke all on function public.reply_to_direct_message_notification(uuid, text) from public;
grant execute on function public.reply_to_direct_message_notification(uuid, text) to authenticated;
