-- Opt-in, short-lived player discovery. Exact coordinates can only be read by
-- their owner; other players receive an approximate distance through the RPC.
create table if not exists public.player_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  is_visible boolean not null default false,
  availability text not null default 'available' check (availability in ('available', 'busy', 'offline')),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists player_presence_discovery_idx
  on public.player_presence (is_visible, availability, last_seen_at desc);

alter table public.player_presence enable row level security;
drop policy if exists "users read own presence" on public.player_presence;
create policy "users read own presence" on public.player_presence
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users create own presence" on public.player_presence;
create policy "users create own presence" on public.player_presence
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users update own presence" on public.player_presence;
create policy "users update own presence" on public.player_presence
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.nearby_online_players(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 25
)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  skill_rating numeric,
  distance_km double precision,
  availability text,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profile.id,
    profile.display_name,
    profile.avatar_url,
    profile.skill_rating,
    round(calculated.distance_km::numeric, 1)::double precision,
    presence.availability,
    presence.last_seen_at
  from public.player_presence as presence
  join public.profiles as profile on profile.id = presence.user_id
  cross join lateral (
    select 6371 * 2 * asin(sqrt(least(1, greatest(0,
      power(sin(radians(presence.latitude - p_latitude) / 2), 2)
      + cos(radians(p_latitude)) * cos(radians(presence.latitude))
      * power(sin(radians(presence.longitude - p_longitude) / 2), 2)
    )))) as distance_km
  ) as calculated
  where auth.uid() is not null
    and presence.user_id <> auth.uid()
    and presence.is_visible
    and presence.availability = 'available'
    and presence.last_seen_at > now() - interval '2 minutes'
    and calculated.distance_km <= least(greatest(coalesce(p_radius_km, 25), 1), 100)
  order by calculated.distance_km, presence.last_seen_at desc
  limit 50;
$$;
revoke all on function public.nearby_online_players(double precision, double precision, double precision) from public;
grant execute on function public.nearby_online_players(double precision, double precision, double precision) to authenticated;

create table if not exists public.match_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  match_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists match_invites_recipient_idx on public.match_invites (recipient_id, created_at desc);
create index if not exists match_invites_sender_idx on public.match_invites (sender_id, created_at desc);
create unique index if not exists match_invites_one_pending_idx
  on public.match_invites (sender_id, recipient_id) where status = 'pending';

alter table public.match_invites enable row level security;
drop policy if exists "participants read match invites" on public.match_invites;
create policy "participants read match invites" on public.match_invites
  for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists "players send match invites" on public.match_invites;
create policy "players send match invites" on public.match_invites
  for insert to authenticated with check (sender_id = auth.uid() and recipient_id <> auth.uid() and status = 'pending');

create or replace function public.send_match_invite(p_recipient_id uuid, p_match_payload jsonb default '{}'::jsonb)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.match_invites;
begin
  if auth.uid() is null or p_recipient_id = auth.uid() then raise exception 'Choose another signed-in player.'; end if;
  update public.match_invites
    set status = 'expired', updated_at = now()
    where sender_id = auth.uid() and recipient_id = p_recipient_id
      and status = 'pending' and created_at <= now() - interval '15 minutes';
  select * into invite from public.match_invites
    where sender_id = auth.uid() and recipient_id = p_recipient_id and status = 'pending'
    order by created_at desc limit 1;
  if invite.id is not null then return invite; end if;
  insert into public.match_invites (sender_id, recipient_id, match_payload)
    values (auth.uid(), p_recipient_id, coalesce(p_match_payload, '{}'::jsonb))
    returning * into invite;
  return invite;
end;
$$;
revoke all on function public.send_match_invite(uuid, jsonb) from public;
grant execute on function public.send_match_invite(uuid, jsonb) to authenticated;

create or replace function public.respond_match_invite(p_invite_id uuid, p_accept boolean)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.match_invites;
begin
  update public.match_invites
    set status = case when p_accept then 'accepted' else 'declined' end,
        responded_at = now(),
        updated_at = now()
    where id = p_invite_id
      and recipient_id = auth.uid()
      and status = 'pending'
      and created_at > now() - interval '15 minutes'
    returning * into changed;
  if changed.id is null then raise exception 'This invitation is no longer available.'; end if;
  return changed;
end;
$$;
revoke all on function public.respond_match_invite(uuid, boolean) from public;
grant execute on function public.respond_match_invite(uuid, boolean) to authenticated;

create or replace function public.cancel_match_invite(p_invite_id uuid)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.match_invites;
begin
  update public.match_invites
    set status = 'cancelled', updated_at = now()
    where id = p_invite_id and sender_id = auth.uid() and status = 'pending'
    returning * into changed;
  if changed.id is null then raise exception 'This invitation can no longer be cancelled.'; end if;
  return changed;
end;
$$;
revoke all on function public.cancel_match_invite(uuid) from public;
grant execute on function public.cancel_match_invite(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_invites'
  ) then
    alter publication supabase_realtime add table public.match_invites;
  end if;
end $$;
