-- Stream match verification to the players involved so the Ratings review list
-- and the leaderboard update the moment another player confirms or disputes a
-- score, without a manual refresh. Row delivery still follows each table's
-- RLS: participants see their matches and confirmations, and rating rows
-- follow profile visibility (a player always sees their own).

do $$
declare table_name text;
begin
  foreach table_name in array array['matches', 'match_result_confirmations', 'player_ratings'] loop
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
