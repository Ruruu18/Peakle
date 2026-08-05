-- Realtime scoring for nearby matches. The host creates the session from the
-- accepted invitations; only the assigned scorer can change the score, while
-- the host alone can hand scoring to another signed-in match member.
create table if not exists public.nearby_live_matches (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  scorer_id uuid not null references public.profiles(id) on delete restrict,
  setup_id text not null,
  status text not null default 'live' check (status in ('live', 'paused', 'completed', 'ended')),
  configuration jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (host_id, setup_id)
);

create table if not exists public.nearby_live_match_members (
  match_id uuid not null references public.nearby_live_matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invite_id uuid references public.match_invites(id) on delete set null,
  role text not null default 'player' check (role in ('host', 'player')),
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.match_invites
  add column if not exists live_match_id uuid references public.nearby_live_matches(id) on delete set null;

create index if not exists nearby_live_match_members_user_idx
  on public.nearby_live_match_members(user_id, match_id);
create index if not exists nearby_live_matches_scorer_idx
  on public.nearby_live_matches(scorer_id, status, updated_at desc);

alter table public.nearby_live_matches enable row level security;
alter table public.nearby_live_match_members enable row level security;

create or replace function public.can_access_nearby_live_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.nearby_live_matches match
    where match.id = p_match_id
      and (
        match.host_id = auth.uid()
        or exists(
          select 1 from public.nearby_live_match_members member
          where member.match_id = match.id and member.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.can_access_nearby_live_match(uuid) from public;
grant execute on function public.can_access_nearby_live_match(uuid) to authenticated;

drop policy if exists "members read nearby live matches" on public.nearby_live_matches;
create policy "members read nearby live matches"
on public.nearby_live_matches for select to authenticated
using (public.can_access_nearby_live_match(id));

drop policy if exists "members read nearby live membership" on public.nearby_live_match_members;
create policy "members read nearby live membership"
on public.nearby_live_match_members for select to authenticated
using (public.can_access_nearby_live_match(match_id));

create or replace function public.start_nearby_live_match(
  p_setup_id text,
  p_configuration jsonb,
  p_initial_state jsonb,
  p_scorer_id uuid
)
returns public.nearby_live_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.nearby_live_matches;
  selected_scorer uuid := coalesce(p_scorer_id, auth.uid());
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_setup_id), '') is null then raise exception 'Match setup is missing'; end if;
  if jsonb_typeof(p_configuration) <> 'object' or jsonb_typeof(p_initial_state) <> 'object' then
    raise exception 'Invalid live match state';
  end if;

  if selected_scorer <> auth.uid() and not exists(
    select 1 from public.match_invites invitation
    where invitation.sender_id = auth.uid()
      and invitation.recipient_id = selected_scorer
      and invitation.status = 'accepted'
      and invitation.match_payload->>'setupId' = p_setup_id
  ) then
    raise exception 'Choose the host or an accepted signed-in player as scorer';
  end if;

  insert into public.nearby_live_matches(
    host_id, scorer_id, setup_id, configuration, state
  ) values (
    auth.uid(), selected_scorer, p_setup_id, p_configuration, p_initial_state
  )
  on conflict (host_id, setup_id) do update
    set scorer_id = excluded.scorer_id,
        configuration = excluded.configuration,
        state = excluded.state,
        status = 'live',
        ended_at = null,
        revision = public.nearby_live_matches.revision + 1,
        updated_at = now()
  returning * into created;

  insert into public.nearby_live_match_members(match_id, user_id, role)
  values(created.id, auth.uid(), 'host')
  on conflict (match_id, user_id) do update set role = 'host';

  delete from public.nearby_live_match_members
  where match_id = created.id and user_id <> auth.uid();

  insert into public.nearby_live_match_members(match_id, user_id, invite_id, role)
  select created.id, invitation.recipient_id, invitation.id, 'player'
  from public.match_invites invitation
  where invitation.sender_id = auth.uid()
    and invitation.status = 'accepted'
    and invitation.match_payload->>'setupId' = p_setup_id
  on conflict (match_id, user_id) do update
    set invite_id = excluded.invite_id,
        role = case when public.nearby_live_match_members.role = 'host' then 'host' else 'player' end;

  update public.match_invites
  set live_match_id = created.id,
      updated_at = now()
  where sender_id = auth.uid()
    and status = 'accepted'
    and match_payload->>'setupId' = p_setup_id;

  return created;
end;
$$;

create or replace function public.update_nearby_live_match(
  p_match_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_status text default null
)
returns public.nearby_live_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.nearby_live_matches;
begin
  if jsonb_typeof(p_state) <> 'object' then raise exception 'Invalid live match state'; end if;
  if p_status is not null and p_status not in ('live', 'paused', 'completed', 'ended') then
    raise exception 'Invalid live match status';
  end if;

  update public.nearby_live_matches
  set state = p_state,
      status = coalesce(p_status, status),
      ended_at = case when p_status in ('completed', 'ended') then now() else ended_at end,
      revision = revision + 1,
      updated_at = now()
  where id = p_match_id
    and (
      scorer_id = auth.uid()
      or (host_id = auth.uid() and p_status in ('completed', 'ended'))
    )
    and revision = p_expected_revision
    and status in ('live', 'paused')
  returning * into changed;

  if changed.id is null then
    raise exception 'The live score changed on another device. Refresh and try again.';
  end if;
  return changed;
end;
$$;

create or replace function public.handoff_nearby_live_scorer(
  p_match_id uuid,
  p_scorer_id uuid
)
returns public.nearby_live_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.nearby_live_matches;
begin
  if not exists(
    select 1 from public.nearby_live_match_members member
    where member.match_id = p_match_id and member.user_id = p_scorer_id
  ) then
    raise exception 'Choose a signed-in player in this match';
  end if;

  update public.nearby_live_matches
  set scorer_id = p_scorer_id,
      revision = revision + 1,
      updated_at = now()
  where id = p_match_id
    and host_id = auth.uid()
    and status in ('live', 'paused')
  returning * into changed;

  if changed.id is null then raise exception 'Only the host can hand off scoring'; end if;
  return changed;
end;
$$;

revoke all on function public.start_nearby_live_match(text, jsonb, jsonb, uuid) from public;
grant execute on function public.start_nearby_live_match(text, jsonb, jsonb, uuid) to authenticated;
revoke all on function public.update_nearby_live_match(uuid, bigint, jsonb, text) from public;
grant execute on function public.update_nearby_live_match(uuid, bigint, jsonb, text) to authenticated;
revoke all on function public.handoff_nearby_live_scorer(uuid, uuid) from public;
grant execute on function public.handoff_nearby_live_scorer(uuid, uuid) to authenticated;

create or replace function public.leave_match_invite(p_invite_id uuid)
returns public.match_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  source public.match_invites;
  changed public.match_invites;
begin
  select * into source
  from public.match_invites
  where id = p_invite_id
    and recipient_id = auth.uid()
    and status = 'accepted'
  for update;

  if source.id is null then raise exception 'You are no longer joined to this match.'; end if;

  if source.live_match_id is not null and exists(
    select 1 from public.nearby_live_matches match
    where match.id = source.live_match_id
      and match.status in ('live', 'paused')
      and match.scorer_id = auth.uid()
  ) then
    raise exception 'Ask the host to choose another scorer before you leave.';
  end if;

  if source.live_match_id is not null then
    delete from public.nearby_live_match_members
    where match_id = source.live_match_id and user_id = auth.uid();
  end if;

  update public.match_invites
  set status = 'cancelled', updated_at = now()
  where id = source.id
  returning * into changed;
  return changed;
end;
$$;

revoke all on function public.leave_match_invite(uuid) from public;
grant execute on function public.leave_match_invite(uuid) to authenticated;

alter table public.nearby_live_matches replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nearby_live_matches'
  ) then
    alter publication supabase_realtime add table public.nearby_live_matches;
  end if;
end $$;
