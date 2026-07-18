-- Some auth accounts can predate the profile-creation trigger. Allow an
-- authenticated user to create only the profile row matching their auth ID so
-- onboarding can repair that missing row safely.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'users insert own profile'
  ) then
    create policy "users insert own profile"
      on public.profiles
      for insert
      to authenticated
      with check (id = auth.uid());
  end if;
end
$$;
