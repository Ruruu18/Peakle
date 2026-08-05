alter table public.teams
  add column if not exists cover_image_url text;

comment on column public.teams.image_url is
  'Primary square team photo or logo used in compact identity surfaces.';

comment on column public.teams.cover_image_url is
  'Optional landscape cover photo used on team cards and profile headers.';
