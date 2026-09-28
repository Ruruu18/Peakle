-- Let players rescue a live match whose scorer went quiet. The scorer's device
-- checks in every ~20 seconds; once it has been silent for 45 seconds any signed-in
-- member of the match can take over the scoring controls, so a dead phone or a
-- scorer who wandered off no longer freezes the score until the host returns.
alter table public.nearby_live_matches
  add column if not exists scorer_seen_at timestamptz not null default now();

-- Check-ins only move scorer_seen_at; they leave revision alone so they never
-- collide with the optimistic score updates in update_nearby_live_match.
create or replace function public.touch_nearby_live_scorer(p_match_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.nearby_live_matches
  set scorer_seen_at = now()
  where id = p_match_id
    and scorer_id = auth.uid()
    and status in ('live', 'paused');
$$;

create or replace function public.take_over_nearby_live_scorer(p_match_id uuid)
returns public.nearby_live_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.nearby_live_matches;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.nearby_live_match_members member
    where member.match_id = p_match_id and member.user_id = auth.uid()
  ) then
    raise exception 'Only players in this match can take over scoring';
  end if;

  update public.nearby_live_matches match
  set scorer_id = auth.uid(),
      scorer_seen_at = now(),
      revision = match.revision + 1,
      updated_at = now()
  where match.id = p_match_id
    and match.status in ('live', 'paused')
    and match.scorer_id <> auth.uid()
    and (
      match.scorer_seen_at < now() - interval '45 seconds'
      or not exists(
        select 1 from public.nearby_live_match_members member
        where member.match_id = match.id and member.user_id = match.scorer_id
      )
    )
  returning * into changed;

  if changed.id is null then
    raise exception 'The scorer is still active. Ask them or the host to hand over scoring.';
  end if;
  return changed;
end;
$$;

-- Scoring a rally is also proof of life, and a handed-off scorer starts with a
-- fresh grace period instead of inheriting the previous scorer's silence.
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
      scorer_seen_at = case when scorer_id = auth.uid() then now() else scorer_seen_at end,
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
      scorer_seen_at = now(),
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

revoke all on function public.touch_nearby_live_scorer(uuid) from public, anon;
grant execute on function public.touch_nearby_live_scorer(uuid) to authenticated;
revoke all on function public.take_over_nearby_live_scorer(uuid) from public, anon;
grant execute on function public.take_over_nearby_live_scorer(uuid) to authenticated;
