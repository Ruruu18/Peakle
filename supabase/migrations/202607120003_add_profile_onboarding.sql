alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

-- Preserve access for existing users who already completed the original setup.
update public.profiles
set onboarding_completed = true
where home_area is not null
  and skill_rating is not null
  and play_preference is not null;
