create or replace function public.delete_notification(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  delete from public.user_notifications
  where id = p_notification_id
    and user_id = auth.uid()
    and kind <> 'follow_request';

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.delete_notification(uuid) from public;
grant execute on function public.delete_notification(uuid) to authenticated;

create or replace function public.clear_read_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  delete from public.user_notifications
  where user_id = auth.uid()
    and read_at is not null
    and kind <> 'follow_request';

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

revoke all on function public.clear_read_notifications() from public;
grant execute on function public.clear_read_notifications() to authenticated;
