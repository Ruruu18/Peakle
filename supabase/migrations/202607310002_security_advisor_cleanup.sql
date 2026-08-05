begin;

-- Keep privileged implementations outside PostgREST's exposed `public` schema.
-- Public RPC entry points are recreated as SECURITY INVOKER wrappers below.
create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;
grant usage on schema app_private to service_role;

do $migration$
declare
  function_record record;
  call_arguments text;
  wrapper_statement text;
  volatility_clause text;
  strict_clause text;
begin
  for function_record in
    select
      procedure.oid,
      procedure.proname,
      procedure.pronargs,
      procedure.proretset,
      procedure.prorettype,
      procedure.provolatile,
      procedure.proisstrict,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
      pg_get_function_arguments(procedure.oid) as full_arguments,
      pg_get_function_result(procedure.oid) as function_result,
      obj_description(procedure.oid, 'pg_proc') as description
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and procedure.prosecdef
      and (
        has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('authenticated', procedure.oid, 'execute')
      )
    order by procedure.oid
  loop
    -- Trigger functions are invoked by their trigger OID and never need direct
    -- execution privileges. Keeping their schema stable also preserves bodies
    -- that reference them by a schema-qualified name.
    if function_record.prorettype = 'pg_catalog.trigger'::regtype then
      execute format(
        'revoke all on function public.%I(%s) from public, anon, authenticated',
        function_record.proname,
        function_record.identity_arguments
      );
      continue;
    end if;

    select coalesce(string_agg(format('$%s', argument_number), ', '), '')
      into call_arguments
    from generate_series(1, function_record.pronargs) as argument_number;

    volatility_clause := case function_record.provolatile
      when 'i' then 'immutable'
      when 's' then 'stable'
      else 'volatile'
    end;

    strict_clause := case
      when function_record.proisstrict then 'returns null on null input'
      else 'called on null input'
    end;

    wrapper_statement := case
      when function_record.function_result = 'void' then
        format(
          'perform app_private.%I(%s); return;',
          function_record.proname,
          call_arguments
        )
      when function_record.proretset then
        format(
          'return query select * from app_private.%I(%s);',
          function_record.proname,
          call_arguments
        )
      else
        format(
          'return app_private.%I(%s);',
          function_record.proname,
          call_arguments
        )
    end;

    execute format(
      'alter function public.%I(%s) set schema app_private',
      function_record.proname,
      function_record.identity_arguments
    );

    execute format(
      $wrapper_definition$
      create function public.%I(%s)
      returns %s
      language plpgsql
      %s
      %s
      security invoker
      set search_path = ''
      as $wrapper_body$
      begin
        if (select auth.uid()) is null
          and current_user not in ('postgres', 'service_role', 'supabase_admin')
        then
          raise exception 'Authentication is required'
            using errcode = '42501';
        end if;

        %s
      end;
      $wrapper_body$
      $wrapper_definition$,
      function_record.proname,
      function_record.full_arguments,
      function_record.function_result,
      volatility_clause,
      strict_clause,
      wrapper_statement
    );

    execute format(
      'revoke all on function app_private.%I(%s) from public, anon',
      function_record.proname,
      function_record.identity_arguments
    );
    execute format(
      'grant execute on function app_private.%I(%s) to authenticated, service_role',
      function_record.proname,
      function_record.identity_arguments
    );
    execute format(
      'revoke all on function public.%I(%s) from public, anon',
      function_record.proname,
      function_record.identity_arguments
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated, service_role',
      function_record.proname,
      function_record.identity_arguments
    );

    if function_record.description is not null then
      execute format(
        'comment on function public.%I(%s) is %L',
        function_record.proname,
        function_record.identity_arguments,
        function_record.description
      );
    end if;
  end loop;
end;
$migration$;

-- Prevent newly created functions from silently becoming public RPCs. Migrations
-- must grant EXECUTE deliberately to the roles that should call each function.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Pin the trigger helper's lookup path.
alter function public.set_updated_at() set search_path = '';

-- Supabase reserves `extensions` for installed extensions.
alter extension btree_gist set schema extensions;

-- Public object URLs do not require SELECT policies. Removing these broad
-- policies prevents clients from enumerating every object in each bucket.
drop policy if exists "organizer media is public" on storage.objects;
drop policy if exists "profile photos are public" on storage.objects;
drop policy if exists "team images are public" on storage.objects;

commit;
