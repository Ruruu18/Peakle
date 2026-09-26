-- Occasional in-app "How's Peakle so far?" prompt: a 1-5 star rating plus an
-- optional suggestion. Players can only insert and read their own rows. Review
-- with the service role:
--   select rating, count(*) from public.app_feedback group by 1 order by 1;
--   select created_at, rating, comment from public.app_feedback where comment is not null order by created_at desc;

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now()
);

create index if not exists app_feedback_user_created_idx on public.app_feedback (user_id, created_at desc);

alter table public.app_feedback enable row level security;

drop policy if exists app_feedback_select_own on public.app_feedback;
create policy app_feedback_select_own on public.app_feedback
  for select to authenticated using (user_id = auth.uid());

drop policy if exists app_feedback_insert_own on public.app_feedback;
create policy app_feedback_insert_own on public.app_feedback
  for insert to authenticated with check (user_id = auth.uid());

grant select, insert on public.app_feedback to authenticated;
