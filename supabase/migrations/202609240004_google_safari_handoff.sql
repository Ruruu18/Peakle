begin;

-- iOS Home Screen web apps do not share storage with Safari. When a player
-- signs in with Google in Safari, Safari parks the one-time Supabase auth code
-- and its PKCE verifier here under the app's random handoff id, and shows a
-- 6-digit PIN. The app exchanges the code only after the player types that PIN,
-- so a phishing link carrying someone else's handoff id cannot capture a login.
create table if not exists public.auth_handoffs (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  pin text not null,
  auth_code text not null check (length(auth_code) between 1 and 512),
  code_verifier text not null check (length(code_verifier) between 1 and 1024),
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.auth_handoffs enable row level security;
revoke all on public.auth_handoffs from anon, authenticated;

create or replace function public.put_auth_handoff(p_id text, p_auth_code text, p_code_verifier text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pin text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
begin
  delete from public.auth_handoffs where created_at < now() - interval '15 minutes';
  insert into public.auth_handoffs (id, pin, auth_code, code_verifier)
  values (p_id, v_pin, p_auth_code, p_code_verifier)
  on conflict (id) do nothing;
  if not found then
    raise exception 'This sign-in link was already used. Start again from the Peakle app.';
  end if;
  return v_pin;
end;
$$;

-- Returns status 'ok' with the code, 'wrong_pin', or 'expired'. Five wrong
-- PINs discard the handoff so it cannot be brute forced.
create or replace function public.take_auth_handoff(p_id text, p_pin text)
returns table (status text, auth_code text, code_verifier text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row public.auth_handoffs;
begin
  select * into v_row from public.auth_handoffs handoff
  where handoff.id = p_id and handoff.created_at > now() - interval '10 minutes'
  for update;
  if not found then
    return query select 'expired'::text, null::text, null::text;
    return;
  end if;
  if v_row.pin <> p_pin then
    if v_row.attempts >= 4 then
      delete from public.auth_handoffs where id = p_id;
      return query select 'expired'::text, null::text, null::text;
    else
      update public.auth_handoffs set attempts = attempts + 1 where id = p_id;
      return query select 'wrong_pin'::text, null::text, null::text;
    end if;
    return;
  end if;
  delete from public.auth_handoffs where id = p_id;
  return query select 'ok'::text, v_row.auth_code, v_row.code_verifier;
end;
$$;

revoke all on function public.put_auth_handoff(text, text, text) from public;
revoke all on function public.take_auth_handoff(text, text) from public;
grant execute on function public.put_auth_handoff(text, text, text) to anon, authenticated;
grant execute on function public.take_auth_handoff(text, text) to anon, authenticated;

commit;
