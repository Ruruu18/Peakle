-- Migration version normalized to preserve the original execution order.
-- Competition managers (not just the scheduling organizer) need to read live
-- scores for the competition monitor, so extend match/game visibility beyond
-- can_access_match() (created_by/scorer/participant) to cover competition
-- management permission.

create policy "competition managers read competition matches"
on public.matches for select to authenticated
using (competition_id is not null and public.can_manage_competition(competition_id));

create policy "competition managers read competition match games"
on public.match_games for select to authenticated
using (
  exists (
    select 1 from public.matches m
    where m.id = match_id
      and m.competition_id is not null
      and public.can_manage_competition(m.competition_id)
  )
);
