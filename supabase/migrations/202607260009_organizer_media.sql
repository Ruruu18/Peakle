-- Organizer-controlled branding and photography for venues, courts, and competitions.
-- Apply after the competition-divisions and team-chat-safety migrations.
alter table public.venues
  add column if not exists brand_image_url text;

alter table public.courts
  add column if not exists image_url text;

alter table public.competitions
  add column if not exists cover_image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organizer-media',
  'organizer-media',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "organizer media is public" on storage.objects;
create policy "organizer media is public"
on storage.objects for select
using (bucket_id = 'organizer-media');

drop policy if exists "venue managers upload organizer media" on storage.objects;
create policy "venue managers upload organizer media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'organizer-media'
  and (
    (
      (storage.foldername(name))[1] = 'venues'
      and public.can_manage_venue((storage.foldername(name))[2])
    )
    or (
      (storage.foldername(name))[1] = 'competitions'
      and public.can_manage_competition(((storage.foldername(name))[2])::uuid)
    )
  )
);

drop policy if exists "venue managers delete organizer media" on storage.objects;
create policy "venue managers delete organizer media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'organizer-media'
  and (
    (
      (storage.foldername(name))[1] = 'venues'
      and public.can_manage_venue((storage.foldername(name))[2])
    )
    or (
      (storage.foldername(name))[1] = 'competitions'
      and public.can_manage_competition(((storage.foldername(name))[2])::uuid)
    )
  )
);
