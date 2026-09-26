-- "Want to be an organizer?" waitlist. Organizer tools are off for the player
-- beta, so players who want them leave a contact email and the team reaches
-- out. One row per player; players only see and change their own. Review with
-- the service role:
--   select created_at, email from public.organizer_interest order by created_at desc;

create table if not exists public.organizer_interest (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizer_interest enable row level security;

drop policy if exists organizer_interest_select_own on public.organizer_interest;
create policy organizer_interest_select_own on public.organizer_interest
  for select to authenticated using (user_id = auth.uid());

drop policy if exists organizer_interest_insert_own on public.organizer_interest;
create policy organizer_interest_insert_own on public.organizer_interest
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists organizer_interest_update_own on public.organizer_interest;
create policy organizer_interest_update_own on public.organizer_interest
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.organizer_interest to authenticated;
