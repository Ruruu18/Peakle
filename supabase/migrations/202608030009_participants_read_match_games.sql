-- Every registered participant who can access a match must also be able to
-- read its game scores. Previously only the creator/scorer could read these
-- rows, which made connected matches appear as a 0-0 record for other players.
drop policy if exists "games follow parent match" on public.match_games;
drop policy if exists "participants read match games" on public.match_games;
drop policy if exists "creator or scorer manage match games" on public.match_games;

create policy "participants read match games"
on public.match_games
for select
to authenticated
using (public.can_access_match(match_id));

create policy "creator or scorer manage match games"
on public.match_games
for all
to authenticated
using (
  exists (
    select 1 from public.matches match
    where match.id = match_id
      and (match.created_by = auth.uid() or match.scorer_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from public.matches match
    where match.id = match_id
      and (match.created_by = auth.uid() or match.scorer_id = auth.uid())
  )
);
