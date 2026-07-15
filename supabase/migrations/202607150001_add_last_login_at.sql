-- Track the last successful login and the method used. Both columns are
-- nullable because older profiles have no recorded login yet.
alter table public.profiles
  add column if not exists last_login_at timestamptz,
  add column if not exists last_sign_in_method text
    check (last_sign_in_method in ('email', 'google'));
