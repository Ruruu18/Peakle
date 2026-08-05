create or replace function public.normalize_team_tag()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  clean_tag text;
  clean_name text;
  second_character text;
begin
  clean_tag := upper(regexp_replace(coalesce(new.tag, ''), '[^A-Za-z0-9]', '', 'g'));
  clean_name := upper(regexp_replace(coalesce(new.name, ''), '[^A-Za-z0-9]', '', 'g'));

  if char_length(clean_tag) = 0 then
    clean_tag := left(clean_name, 4);
  end if;

  if char_length(clean_tag) = 1 then
    second_character := nullif(substr(clean_name, 2, 1), '');
    clean_tag := clean_tag || coalesce(second_character, 'X');
  end if;

  if char_length(clean_tag) = 0 then
    clean_tag := 'TM';
  end if;

  new.tag := left(clean_tag, 6);
  return new;
end;
$$;

drop trigger if exists normalize_team_tag_before_write on public.teams;

create trigger normalize_team_tag_before_write
before insert or update of name, tag on public.teams
for each row
execute function public.normalize_team_tag();

comment on function public.normalize_team_tag() is
  'Normalizes team tags to 2-6 uppercase alphanumeric characters before table constraints run.';
