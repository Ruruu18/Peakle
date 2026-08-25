-- Migration version normalized to preserve the original execution order.
-- Hierarchy-safe team member administration.

drop policy if exists "team managers manage members" on public.team_members;
revoke insert, update, delete on public.team_members from authenticated;

create or replace function public.update_team_member_role(
  p_team_id uuid,
  p_user_id uuid,
  p_role text
)
returns public.team_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.team_role;
  target_role public.team_role;
  requested_role public.team_role;
  updated_member public.team_members;
begin
  select member.role into actor_role
  from public.team_members member
  where member.team_id = p_team_id
    and member.user_id = auth.uid();

  select member.role into target_role
  from public.team_members member
  where member.team_id = p_team_id
    and member.user_id = p_user_id
  for update;

  if actor_role is null then
    raise exception 'You are not a member of this team.';
  end if;
  if target_role is null then
    raise exception 'This person is no longer on the team.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;

  begin
    requested_role := p_role::public.team_role;
  exception when invalid_text_representation then
    raise exception 'Choose a valid team role.';
  end;

  if requested_role = 'creator' or target_role = 'creator' then
    raise exception 'Team ownership cannot be changed from member management.';
  end if;

  if actor_role = 'creator' then
    if requested_role not in ('admin', 'co_admin', 'member') then
      raise exception 'The owner can assign Admin, Co-admin, or Member.';
    end if;
  elsif actor_role = 'admin' then
    if target_role not in ('co_admin', 'member')
      or requested_role not in ('co_admin', 'member') then
      raise exception 'Admins can manage only co-admins and members.';
    end if;
  else
    raise exception 'You do not have access to change member roles.';
  end if;

  update public.team_members member
  set role = requested_role
  where member.team_id = p_team_id
    and member.user_id = p_user_id
  returning member.* into updated_member;

  return updated_member;
end;
$$;

create or replace function public.remove_team_member(
  p_team_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.team_role;
  target_role public.team_role;
begin
  select member.role into actor_role
  from public.team_members member
  where member.team_id = p_team_id
    and member.user_id = auth.uid();

  select member.role into target_role
  from public.team_members member
  where member.team_id = p_team_id
    and member.user_id = p_user_id
  for update;

  if actor_role is null then
    raise exception 'You are not a member of this team.';
  end if;
  if target_role is null then
    raise exception 'This person is no longer on the team.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use Leave team to remove yourself.';
  end if;
  if target_role = 'creator' then
    raise exception 'The team owner cannot be removed.';
  end if;

  if actor_role = 'creator' then
    null;
  elsif actor_role = 'admin' and target_role in ('co_admin', 'member') then
    null;
  elsif actor_role = 'co_admin' and target_role = 'member' then
    null;
  else
    raise exception 'You do not have access to remove this member.';
  end if;

  delete from public.team_members member
  where member.team_id = p_team_id
    and member.user_id = p_user_id;
end;
$$;

revoke all on function public.update_team_member_role(uuid, uuid, text) from public;
grant execute on function public.update_team_member_role(uuid, uuid, text) to authenticated;
revoke all on function public.remove_team_member(uuid, uuid) from public;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end
$$;
