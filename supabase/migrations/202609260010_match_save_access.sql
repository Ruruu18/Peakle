-- Recording a match inserts the row and reads it back in the same request
-- (insert/upsert ... returning). Postgres checks the returned row against the
-- SELECT policies before it is stored, and "participants read matches" relies
-- on can_access_match(id), which looks the match up in public.matches and so
-- cannot see a row that is still being inserted. Creators and scorers must be
-- able to read their own row directly from its columns.

-- Play-anywhere court columns (from 202609250001). Repeated here so databases
-- that skipped that migration can still record matches with a court label.
alter table public.matches
  add column if not exists court_label text,
  add column if not exists court_area text;

alter table public.matches drop constraint if exists matches_court_label_length;
alter table public.matches add constraint matches_court_label_length
  check (court_label is null or char_length(btrim(court_label)) between 1 and 80);

alter table public.matches drop constraint if exists matches_court_area_length;
alter table public.matches add constraint matches_court_area_length
  check (court_area is null or char_length(btrim(court_area)) between 1 and 80);

drop policy if exists "creator or scorer reads match" on public.matches;
create policy "creator or scorer reads match" on public.matches
  for select to authenticated
  using (created_by = auth.uid() or scorer_id = auth.uid());

notify pgrst, 'reload schema';
