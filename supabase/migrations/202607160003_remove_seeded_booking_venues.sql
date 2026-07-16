-- Hide the original demo venue catalog from player-facing booking. Keep the
-- rows intact so existing booking and match history continues to satisfy its
-- foreign-key references.
update public.venues
set active = false,
    updated_at = now()
where (id, name) in (
  ('yard', 'Pickle Yard BGC'),
  ('rockwell', 'Rockwell Club'),
  ('valley', 'Valley Court Club')
);
