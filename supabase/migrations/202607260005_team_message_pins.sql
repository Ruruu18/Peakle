create table if not exists public.team_message_pins (
  message_id uuid primary key references public.team_messages(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  pinned_at timestamptz not null default now()
);

create index if not exists team_message_pins_team_pinned_idx
on public.team_message_pins(team_id, pinned_at desc);

alter table public.team_message_pins enable row level security;

grant select on public.team_message_pins to authenticated;
revoke insert, update, delete on public.team_message_pins from authenticated;

drop policy if exists "team members read message pins" on public.team_message_pins;
create policy "team members read message pins"
on public.team_message_pins for select to authenticated
using (public.is_team_member(team_id));

create or replace function public.toggle_team_message_pin(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  message_team_id uuid;
begin
  select message.team_id into message_team_id
  from public.team_messages message
  where message.id = p_message_id
    and message.deleted_at is null;

  if message_team_id is null or not public.is_team_member(message_team_id) then
    raise exception 'Only team members can pin active messages.';
  end if;

  if exists (
    select 1 from public.team_message_pins pin
    where pin.message_id = p_message_id
  ) then
    delete from public.team_message_pins pin
    where pin.message_id = p_message_id;
  else
    insert into public.team_message_pins(message_id, team_id, pinned_by)
    values (p_message_id, message_team_id, auth.uid());
  end if;
end;
$$;

revoke all on function public.toggle_team_message_pin(uuid) from public;
grant execute on function public.toggle_team_message_pin(uuid) to authenticated;

create or replace function public.remove_team_message_pin_when_unsent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.team_message_pins pin
    where pin.message_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists remove_team_message_pin_when_unsent on public.team_messages;
create trigger remove_team_message_pin_when_unsent
after update of deleted_at on public.team_messages
for each row execute function public.remove_team_message_pin_when_unsent();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_message_pins'
  ) then
    alter publication supabase_realtime add table public.team_message_pins;
  end if;
end
$$;
