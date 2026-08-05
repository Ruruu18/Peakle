-- Publish booking availability changes without exposing another player's booking.
-- The bookings table intentionally remains private under RLS, so clients cannot
-- receive other users' booking rows through Postgres Changes.

create table if not exists public.court_availability_events (
  scope text primary key,
  court_id text references public.courts(id) on delete cascade,
  venue_id text references public.venues(id) on delete cascade,
  changed_at timestamptz not null default clock_timestamp(),
  check (court_id is not null or venue_id is not null)
);

alter table public.court_availability_events enable row level security;
grant select on public.court_availability_events to authenticated;

drop policy if exists "authenticated users read availability events" on public.court_availability_events;
create policy "authenticated users read availability events"
  on public.court_availability_events
  for select
  to authenticated
  using (true);

create or replace function public.bump_court_availability(
  p_court_id text default null,
  p_venue_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_venue_id text := p_venue_id;
  resolved_scope text;
begin
  if resolved_venue_id is null and p_court_id is not null then
    select venue_id into resolved_venue_id from public.courts where id = p_court_id;
  end if;
  if p_court_id is null and resolved_venue_id is null then return; end if;

  resolved_scope := case
    when p_court_id is not null then 'court:' || p_court_id::text
    else 'venue:' || resolved_venue_id::text
  end;

  insert into public.court_availability_events(scope, court_id, venue_id, changed_at)
  values (resolved_scope, p_court_id, resolved_venue_id, clock_timestamp())
  on conflict (scope) do update set
    court_id = excluded.court_id,
    venue_id = excluded.venue_id,
    changed_at = excluded.changed_at;
end;
$$;

revoke all on function public.bump_court_availability(text, text) from public, anon, authenticated;

create or replace function public.emit_booking_availability_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.bump_court_availability(old.court_id, null);
  elsif tg_op = 'UPDATE' then
    perform public.bump_court_availability(new.court_id, null);
    if old.court_id is distinct from new.court_id then
      perform public.bump_court_availability(old.court_id, null);
    end if;
  else
    perform public.bump_court_availability(new.court_id, null);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists bookings_emit_availability on public.bookings;
create trigger bookings_emit_availability
after insert or update or delete on public.bookings
for each row execute function public.emit_booking_availability_change();

create or replace function public.emit_blackout_availability_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.bump_court_availability(old.court_id, old.venue_id);
  elsif tg_op = 'UPDATE' then
    perform public.bump_court_availability(new.court_id, new.venue_id);
    if old.court_id is distinct from new.court_id or old.venue_id is distinct from new.venue_id then
      perform public.bump_court_availability(old.court_id, old.venue_id);
    end if;
  else
    perform public.bump_court_availability(new.court_id, new.venue_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists court_blackouts_emit_availability on public.court_blackouts;
create trigger court_blackouts_emit_availability
after insert or update or delete on public.court_blackouts
for each row execute function public.emit_blackout_availability_change();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'court_availability_events'
  ) then
    alter publication supabase_realtime add table public.court_availability_events;
  end if;
end
$$;

-- Public open-play discovery is exposed through security-definer RPCs, so the
-- underlying session/player rows are also intentionally not readable by every
-- player. Publish a data-version event to invalidate discovery caches safely.
create table if not exists public.open_play_discovery_events (
  topic text primary key check (topic = 'sessions'),
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.open_play_discovery_events enable row level security;
grant select on public.open_play_discovery_events to authenticated;

drop policy if exists "authenticated users read open play discovery events" on public.open_play_discovery_events;
create policy "authenticated users read open play discovery events"
  on public.open_play_discovery_events
  for select
  to authenticated
  using (true);

create or replace function public.emit_open_play_discovery_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.open_play_discovery_events(topic, changed_at)
  values ('sessions', clock_timestamp())
  on conflict (topic) do update set changed_at = excluded.changed_at;
  return coalesce(new, old);
end;
$$;

drop trigger if exists open_play_sessions_emit_discovery on public.open_play_sessions;
create trigger open_play_sessions_emit_discovery
after insert or update or delete on public.open_play_sessions
for each row execute function public.emit_open_play_discovery_change();

drop trigger if exists open_play_players_emit_discovery on public.open_play_players;
create trigger open_play_players_emit_discovery
after insert or update or delete on public.open_play_players
for each row execute function public.emit_open_play_discovery_change();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'open_play_discovery_events'
  ) then
    alter publication supabase_realtime add table public.open_play_discovery_events;
  end if;
end
$$;
