-- Messenger-style reactions allow one active reaction per person and message.
-- Keep the newest reaction if older clients previously added more than one.
with ranked_reactions as (
  select
    message_id,
    user_id,
    emoji,
    row_number() over (
      partition by message_id, user_id
      order by created_at desc, emoji
    ) as reaction_rank
  from public.team_message_reactions
)
delete from public.team_message_reactions reaction
using ranked_reactions ranked
where reaction.message_id = ranked.message_id
  and reaction.user_id = ranked.user_id
  and reaction.emoji = ranked.emoji
  and ranked.reaction_rank > 1;

create unique index if not exists team_message_reactions_one_per_user_idx
on public.team_message_reactions(message_id, user_id);

create or replace function public.toggle_team_message_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_team_id uuid;
  removing_same_reaction boolean;
begin
  if p_emoji not in ('👍', '❤️', '😂', '🔥', '👏', '🎉') then
    raise exception 'Unsupported reaction.';
  end if;

  select message.team_id into message_team_id
  from public.team_messages message
  where message.id = p_message_id and message.deleted_at is null;

  if message_team_id is null or not public.is_team_member(message_team_id) then
    raise exception 'Only team members can react to active messages.';
  end if;

  select exists (
    select 1
    from public.team_message_reactions reaction
    where reaction.message_id = p_message_id
      and reaction.user_id = auth.uid()
      and reaction.emoji = p_emoji
  ) into removing_same_reaction;

  delete from public.team_message_reactions reaction
  where reaction.message_id = p_message_id
    and reaction.user_id = auth.uid();

  if removing_same_reaction then return false; end if;

  insert into public.team_message_reactions(message_id, user_id, emoji)
  values (p_message_id, auth.uid(), p_emoji);
  return true;
end;
$$;

revoke all on function public.toggle_team_message_reaction(uuid, text) from public;
grant execute on function public.toggle_team_message_reaction(uuid, text) to authenticated;
