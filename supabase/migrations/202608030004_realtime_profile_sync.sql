-- Keep a signed-in player's own cached identity in sync across devices. Client
-- subscriptions are filtered to auth.uid(), and existing profile RLS remains
-- authoritative for which rows may be received.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$$;

notify pgrst, 'reload schema';
