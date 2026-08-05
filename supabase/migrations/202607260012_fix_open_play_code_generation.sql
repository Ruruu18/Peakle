-- create_open_play_session runs with an intentionally restricted search path.
-- pgcrypto is installed in Supabase's extensions schema, so include that
-- trusted schema when the base RPC generates its six-character session code.

alter function public.create_open_play_session(
  text, text, text[], integer, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, text, text, text, integer, integer, integer
)
set search_path = pg_catalog, extensions;
