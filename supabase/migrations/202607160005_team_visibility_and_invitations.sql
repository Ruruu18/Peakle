-- Private/public team visibility, four-player activation, and targeted invitations.

alter table public.teams
  add column if not exists status text not null default 'forming';

alter table public.teams
  add column if not exists member_count integer not null default 0;

alter table public.teams
  drop constraint if exists teams_status_check;

alter table public.teams
  add constraint teams_status_check check (status in ('forming', 'active', 'archived'));

alter table public.teams
  drop constraint if exists teams_member_count_check;

alter table public.teams
  add constraint teams_member_count_check check (member_count between 0 and 100);

update public.teams
set capacity = 4
where capacity < 4;

alter table public.teams
  drop constraint if exists teams_capacity_check;

alter table public.teams
  add constraint teams_capacity_check check (capacity between 4 and 100);

-- Existing teams keep their current discoverability. New teams are private unless
-- their creator explicitly opts into public recruiting.
alter table public.teams
  alter column is_discoverable set default false;

create or replace function public.enforce_team_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_member_count integer;
begin
  if tg_op = 'INSERT' then
    new.status := 'forming';
    return new;
  end if;

  if new.status = 'archived' then
    return new;
  end if;

  select count(*) into current_member_count
  from public.team_members
  where team_id = new.id;

  new.status := case when current_member_count >= 4 then 'active' else 'forming' end;
  return new;
end;
$$;

drop trigger if exists teams_enforce_status on public.teams;
create trigger teams_enforce_status
before insert or update of status on public.teams
for each row execute function public.enforce_team_status();

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status public.request_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (team_id, invited_user_id)
);

create index if not exists team_invitations_user_status_idx
  on public.team_invitations(invited_user_id, status, expires_at desc);

alter table public.team_invitations enable row level security;

create or replace function public.has_pending_team_invitation(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.team_invitations invitation
    where invitation.team_id = target_team
      and invitation.invited_user_id = auth.uid()
      and invitation.status = 'pending'
      and invitation.expires_at > now()
  )
$$;

revoke all on function public.has_pending_team_invitation(uuid) from public;
grant execute on function public.has_pending_team_invitation(uuid) to authenticated;

drop policy if exists "discoverable teams or members can read" on public.teams;
create policy "discoverable teams members or invitees can read"
on public.teams for select to authenticated
using (
  is_discoverable
  or public.is_team_member(id)
  or public.has_pending_team_invitation(id)
);

drop policy if exists "team members are readable" on public.team_members;
create policy "team rosters are member only"
on public.team_members for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists "users create own requests" on public.team_join_requests;
create policy "users request discoverable teams"
on public.team_join_requests for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.teams team
    where team.id = team_id
      and team.is_discoverable
  )
);

create policy "invitees and managers read invitations"
on public.team_invitations for select to authenticated
using (
  invited_user_id = auth.uid()
  or public.can_manage_team(team_id)
);

create or replace function public.refresh_team_status(target_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_member_count integer;
begin
  select count(*) into current_member_count
  from public.team_members
  where team_id = target_team;

  update public.teams
  set member_count = current_member_count,
      status = case when current_member_count >= 4 then 'active' else 'forming' end
  where id = target_team
    and status <> 'archived';
end;
$$;

revoke all on function public.refresh_team_status(uuid) from public;

create or replace function public.refresh_team_status_after_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_team_status(coalesce(new.team_id, old.team_id));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_refresh_status on public.team_members;
create trigger team_members_refresh_status
after insert or delete on public.team_members
for each row execute function public.refresh_team_status_after_membership();

update public.teams team
set member_count = (select count(*) from public.team_members member where member.team_id = team.id),
    status = case
      when (select count(*) from public.team_members member where member.team_id = team.id) >= 4 then 'active'
      else 'forming'
    end
where status <> 'archived';

create or replace function public.invite_team_member(
  p_team_id uuid,
  p_invited_user_id uuid
)
returns public.team_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.team_invitations;
  current_count integer;
  team_capacity integer;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'Team manager permission required';
  end if;

  if p_invited_user_id = auth.uid() then
    raise exception 'You are already the team owner';
  end if;

  if exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_invited_user_id
  ) then
    raise exception 'Player is already on this team';
  end if;

  select count(*), max(team.capacity)
  into current_count, team_capacity
  from public.team_members member
  join public.teams team on team.id = member.team_id
  where member.team_id = p_team_id;

  if current_count >= team_capacity then
    raise exception 'Team is full';
  end if;

  insert into public.team_invitations(
    team_id, invited_user_id, invited_by, status, expires_at, responded_at
  ) values (
    p_team_id, p_invited_user_id, auth.uid(), 'pending', now() + interval '7 days', null
  )
  on conflict (team_id, invited_user_id) do update
  set invited_by = auth.uid(),
      status = 'pending',
      expires_at = now() + interval '7 days',
      responded_at = null,
      created_at = now()
  returning * into invitation;

  return invitation;
end;
$$;

revoke all on function public.invite_team_member(uuid, uuid) from public;
grant execute on function public.invite_team_member(uuid, uuid) to authenticated;

create or replace function public.respond_team_invitation(
  p_invitation_id uuid,
  p_accept boolean
)
returns public.team_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.team_invitations;
  current_count integer;
  team_capacity integer;
begin
  select * into invitation
  from public.team_invitations
  where id = p_invitation_id
  for update;

  if invitation.id is null
    or invitation.invited_user_id <> auth.uid()
    or invitation.status <> 'pending' then
    raise exception 'Pending invitation not found';
  end if;

  if invitation.expires_at <= now() then
    update public.team_invitations
    set status = 'declined', responded_at = now()
    where id = invitation.id
    returning * into invitation;
    raise exception 'This invitation has expired';
  end if;

  if p_accept then
    select count(*), max(team.capacity)
    into current_count, team_capacity
    from public.team_members member
    join public.teams team on team.id = member.team_id
    where member.team_id = invitation.team_id;

    if current_count >= team_capacity then
      raise exception 'Team is full';
    end if;

    insert into public.team_members(team_id, user_id, role)
    values (invitation.team_id, auth.uid(), 'member')
    on conflict do nothing;
  end if;

  update public.team_invitations
  set status = case
      when p_accept then 'accepted'::public.request_status
      else 'declined'::public.request_status
    end,
    responded_at = now()
  where id = invitation.id
  returning * into invitation;

  return invitation;
end;
$$;

revoke all on function public.respond_team_invitation(uuid, boolean) from public;
grant execute on function public.respond_team_invitation(uuid, boolean) to authenticated;
