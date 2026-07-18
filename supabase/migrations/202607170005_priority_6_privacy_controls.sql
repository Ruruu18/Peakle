-- Make Competitive Hub privacy changes atomic and enforce matching preferences
-- at the database boundary, not only in the interface.

create or replace function public.update_competitive_privacy(
  p_profile_visibility text,
  p_availability_visibility text,
  p_matching_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile_visibility not in ('private','members','public') then
    raise exception 'Invalid competitive profile visibility';
  end if;
  if p_availability_visibility not in ('private','matches','public') then
    raise exception 'Invalid availability visibility';
  end if;

  update public.profiles
  set profile_visibility = p_profile_visibility,
      availability_visibility = p_availability_visibility,
      matching_enabled = p_matching_enabled
  where id = auth.uid();

  if not found then raise exception 'Signed-in profile not found'; end if;

  -- A player who turns matching off must immediately disappear from discovery.
  if not p_matching_enabled then
    update public.matchmaking_posts
    set status = 'closed'
    where creator_id = auth.uid() and status = 'open';
  end if;

  return jsonb_build_object(
    'profileVisibility', p_profile_visibility,
    'availabilityVisibility', p_availability_visibility,
    'matchingEnabled', p_matching_enabled
  );
end;
$$;

revoke all on function public.update_competitive_privacy(text,text,boolean) from public;
grant execute on function public.update_competitive_privacy(text,text,boolean) to authenticated;

drop policy if exists "players create matching posts" on public.matchmaking_posts;
create policy "players create matching posts"
on public.matchmaking_posts for insert to authenticated
with check (
  creator_id = auth.uid()
  and exists(select 1 from public.profiles p where p.id = auth.uid() and p.matching_enabled)
  and (team_id is null or public.is_team_member(team_id))
);

create or replace function public.claim_matchmaking_post(p_post_id uuid)
returns public.matchmaking_posts
language plpgsql
security definer
set search_path = ''
as $$
declare post public.matchmaking_posts;
begin
  select * into post from public.matchmaking_posts where id=p_post_id for update;
  if post.id is null or post.status<>'open' or post.starts_at<=now() then
    raise exception 'This match request is no longer available';
  end if;
  if post.creator_id=auth.uid() then raise exception 'You cannot match with your own request'; end if;
  if not exists(select 1 from public.profiles p where p.id=post.creator_id and p.matching_enabled) then
    raise exception 'This player is no longer accepting matches';
  end if;
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.matching_enabled) then
    raise exception 'Turn on player matching before accepting a request';
  end if;
  update public.matchmaking_posts set matched_user_id=auth.uid(),status='matched' where id=p_post_id returning * into post;
  return post;
end;
$$;

revoke all on function public.claim_matchmaking_post(uuid) from public;
grant execute on function public.claim_matchmaking_post(uuid) to authenticated;
