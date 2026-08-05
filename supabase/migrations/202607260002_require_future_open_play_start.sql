create or replace function public.enforce_future_open_play_start()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.scheduled_start <= now() then
    raise exception 'Open play start time must be in the future'
      using errcode = '22007';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_future_open_play_start_before_insert
  on public.open_play_sessions;

create trigger enforce_future_open_play_start_before_insert
before insert on public.open_play_sessions
for each row execute function public.enforce_future_open_play_start();
