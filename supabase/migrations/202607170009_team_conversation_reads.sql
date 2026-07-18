create table if not exists public.team_message_reads (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table public.team_message_reads enable row level security;

create policy "members read own team message state"
on public.team_message_reads for select to authenticated
using (user_id = auth.uid() and public.is_team_member(team_id));

create policy "members create own team message state"
on public.team_message_reads for insert to authenticated
with check (user_id = auth.uid() and public.is_team_member(team_id));

create policy "members update own team message state"
on public.team_message_reads for update to authenticated
using (user_id = auth.uid() and public.is_team_member(team_id))
with check (user_id = auth.uid() and public.is_team_member(team_id));

create or replace function public.list_team_conversations(p_team_ids uuid[])
returns table (
  team_id uuid,
  last_body text,
  last_has_image boolean,
  last_created_at timestamptz,
  last_sender_name text,
  unread_count bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    team.id,
    latest.body,
    latest.image_url is not null,
    latest.created_at,
    sender.display_name,
    count(unread.id) filter (where unread.sender_id <> auth.uid())
  from unnest(p_team_ids) as team(id)
  left join lateral (
    select message.body, message.image_url, message.created_at, message.sender_id
    from public.team_messages message
    where message.team_id = team.id
    order by message.created_at desc
    limit 1
  ) latest on true
  left join public.profiles sender on sender.id = latest.sender_id
  left join public.team_message_reads read_state
    on read_state.team_id = team.id and read_state.user_id = auth.uid()
  left join public.team_messages unread
    on unread.team_id = team.id
   and unread.created_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
  where public.is_team_member(team.id)
  group by team.id, latest.body, latest.image_url, latest.created_at, sender.display_name
  order by latest.created_at desc nulls last;
$$;

create or replace function public.mark_team_conversation_read(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'Only team members can mark this conversation read.';
  end if;

  insert into public.team_message_reads(team_id, user_id, last_read_at)
  values (p_team_id, auth.uid(), now())
  on conflict (team_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.list_team_conversations(uuid[]) from public;
grant execute on function public.list_team_conversations(uuid[]) to authenticated;
revoke all on function public.mark_team_conversation_read(uuid) from public;
grant execute on function public.mark_team_conversation_read(uuid) to authenticated;
