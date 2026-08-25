-- Make profile deletion complete and predictable while retaining only
-- de-identified operational records whose lifecycle outlives an account.
-- User-owned rows that already use ON DELETE CASCADE remain cascade-deleted.

do $$
declare
  foreign_key record;
  column_name text;
  column_names text;
begin
  for foreign_key in
    select
      constraint_row.oid,
      constraint_row.conname,
      constraint_row.conrelid,
      constraint_row.conkey
    from pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.profiles'::regclass
      and constraint_row.confdeltype in ('a', 'r')
  loop
    select string_agg(quote_ident(attribute.attname), ', ' order by key_column.ordinality)
    into column_names
    from unnest(foreign_key.conkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = foreign_key.conrelid
     and attribute.attnum = key_column.attnum;

    for column_name in
      select attribute.attname
      from unnest(foreign_key.conkey) as key_column(attnum)
      join pg_attribute attribute
        on attribute.attrelid = foreign_key.conrelid
       and attribute.attnum = key_column.attnum
    loop
      execute format(
        'alter table %s alter column %I drop not null',
        foreign_key.conrelid::regclass,
        column_name
      );
    end loop;

    execute format(
      'alter table %s drop constraint %I',
      foreign_key.conrelid::regclass,
      foreign_key.conname
    );
    execute format(
      'alter table %s add constraint %I foreign key (%s) references public.profiles(id) on delete set null',
      foreign_key.conrelid::regclass,
      foreign_key.conname,
      column_names
    );
  end loop;
end
$$;

create or replace function public.prepare_account_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_team record;
  successor_id uuid;
begin
  if p_user_id is null then
    raise exception 'A user ID is required.';
  end if;

  -- Keep shared teams available by handing ownership to the longest-serving
  -- admin/member. A team with no other member is user-owned content and is
  -- removed with the account.
  for owned_team in
    select team.id
    from public.teams team
    where team.creator_id = p_user_id
    for update
  loop
    select member.user_id
    into successor_id
    from public.team_members member
    where member.team_id = owned_team.id
      and member.user_id <> p_user_id
    order by
      case member.role
        when 'creator' then 0
        when 'admin' then 1
        when 'co_admin' then 2
        else 3
      end,
      member.joined_at
    limit 1;

    if successor_id is null then
      delete from public.teams where id = owned_team.id;
    else
      update public.teams set creator_id = successor_id where id = owned_team.id;
      update public.team_members
      set role = case when user_id = successor_id then 'creator'::public.team_role else role end
      where team_id = owned_team.id;
    end if;
  end loop;
end;
$$;

revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
