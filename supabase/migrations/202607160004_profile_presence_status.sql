-- Persist the player's chosen public activity state independently of the
-- short-lived nearby-presence heartbeat.
alter table public.profiles
  add column if not exists presence_status text not null default 'free'
  check (presence_status in ('free', 'away', 'in_play'));

