begin;

create extension if not exists pg_net with schema extensions;

do $setup$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is required for the push dispatcher';
  end if;

  if not exists (select 1 from vault.secrets where name = 'push_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_dispatch_secret',
      'Server-only credential used by the Peakle push Cron job'
    );
  end if;
end
$setup$;

create or replace function public.verify_push_dispatch_secret(p_candidate text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    return false;
  end if;

  return exists (
    select 1
    from vault.decrypted_secrets
    where name = 'push_dispatch_secret'
      and decrypted_secret = p_candidate
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.verify_push_dispatch_secret(text) from public, anon, authenticated;
grant execute on function public.verify_push_dispatch_secret(text) to service_role;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'queue-open-play-check-in-reminders') then
    perform cron.unschedule('queue-open-play-check-in-reminders');
  end if;
  perform cron.schedule(
    'queue-open-play-check-in-reminders',
    '*/5 * * * *',
    $job$select public.queue_open_play_check_in_reminders();$job$
  );

  if exists (select 1 from cron.job where jobname = 'send-push-notifications') then
    perform cron.unschedule('send-push-notifications');
  end if;
  perform cron.schedule(
    'send-push-notifications',
    '* * * * *',
    $job$
      select net.http_post(
        url := 'https://melbfzfuxrviybblipua.supabase.co/functions/v1/send-push-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-dispatch-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'push_dispatch_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 50000
      );
    $job$
  );
end
$cron$;

notify pgrst, 'reload schema';

commit;
