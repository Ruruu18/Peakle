do $verification$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'send-push-notifications'
      and schedule = '* * * * *'
      and active
  ) then
    raise exception 'Push dispatcher Cron is not active on the one-minute schedule';
  end if;

  if not exists (
    select 1
    from cron.job_run_details run
    join cron.job job on job.jobid = run.jobid
    where job.jobname = 'send-push-notifications'
      and run.status = 'succeeded'
      and run.start_time >= now() - interval '10 minutes'
  ) then
    raise exception 'Push dispatcher Cron has not completed successfully in the last ten minutes';
  end if;

  if not exists (
    select 1
    from net._http_response
    where created >= now() - interval '10 minutes'
      and status_code = 200
      and content::text like '%"processed"%'
  ) then
    raise exception 'Push dispatcher did not return a successful processing response in the last ten minutes';
  end if;
end
$verification$;
