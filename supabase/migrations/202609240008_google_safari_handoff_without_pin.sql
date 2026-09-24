begin;

-- Google sign-in from the iOS Home Screen app runs in Safari, which parks the
-- one-time Supabase auth code under the app's random 256-bit handoff id. The
-- app polls for that id and signs itself in as soon as the player switches
-- back, so no PIN is typed. Safe to apply whether or not 202609240004 ran.
create table if not exists public.auth_handoffs (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  auth_code text not null check (length(auth_code) between 1 and 512),
  code_verifier text not null check (length(code_verifier) between 1 and 1024),
  created_at timestamptz not null default now()
);

alter table public.auth_handoffs drop column if exists pin;
alter table public.auth_handoffs drop column if exists attempts;
alter table public.auth_handoffs enable row level security;
revoke all on public.auth_handoffs from anon, authenticated;

drop function if exists public.put_auth_handoff(text, text, text);
drop function if exists public.take_auth_handoff(text, text);

create function public.put_auth_handoff(p_id text, p_auth_code text, p_code_verifier text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  delete from public.auth_handoffs where created_at < now() - interval '15 minutes';
  insert into public.auth_handoffs (id, auth_code, code_verifier)
  values (p_id, p_auth_code, p_code_verifier)
  on conflict (id) do nothing;
  if not found then
    raise exception 'This sign-in link was already used. Start again from the Peakle app.';
  end if;
end;
$$;

-- Returns status 'ok' with the code once Safari has parked it, otherwise
-- 'pending'. The row is deleted on first read so the code is redeemed once.
create function public.take_auth_handoff(p_id text)
returns table (status text, auth_code text, code_verifier text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row public.auth_handoffs;
begin
  delete from public.auth_handoffs handoff
  where handoff.id = p_id and handoff.created_at > now() - interval '10 minutes'
  returning * into v_row;
  if not found then
    return query select 'pending'::text, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_row.auth_code, v_row.code_verifier;
end;
$$;

revoke all on function public.put_auth_handoff(text, text, text) from public;
revoke all on function public.take_auth_handoff(text) from public;
grant execute on function public.put_auth_handoff(text, text, text) to anon, authenticated;
grant execute on function public.take_auth_handoff(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
