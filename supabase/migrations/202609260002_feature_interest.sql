-- Thumbs up/down on "coming soon" teasers (e.g. Club Wars) so the team can
-- gauge interest before building. One vote per player per feature; players
-- only see and change their own vote. Read totals with the service role:
--   select feature, vote, count(*) from public.feature_interest group by 1, 2;

create table if not exists public.feature_interest (
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null check (feature ~ '^[a-z0-9_]{1,40}$'),
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature)
);

alter table public.feature_interest enable row level security;

drop policy if exists feature_interest_select_own on public.feature_interest;
create policy feature_interest_select_own on public.feature_interest
  for select to authenticated using (user_id = auth.uid());

drop policy if exists feature_interest_insert_own on public.feature_interest;
create policy feature_interest_insert_own on public.feature_interest
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists feature_interest_update_own on public.feature_interest;
create policy feature_interest_update_own on public.feature_interest
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists feature_interest_delete_own on public.feature_interest;
create policy feature_interest_delete_own on public.feature_interest
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.feature_interest to authenticated;
