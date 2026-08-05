-- Publish accepted follow relationships so profile counts update immediately
-- after an acceptance or unfollow on another device.

alter table public.player_follows replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'player_follows'
  ) then
    alter publication supabase_realtime add table public.player_follows;
  end if;
end
$$;
