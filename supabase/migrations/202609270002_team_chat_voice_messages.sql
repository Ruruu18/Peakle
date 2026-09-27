-- Team chats get the same attachments as private chats: camera, gallery, and
-- voice messages. Voice notes are stored like private chat voice notes.
alter table public.team_messages
  drop constraint if exists team_messages_media_type_check;
alter table public.team_messages
  add constraint team_messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'gif', 'audio'));

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/mpeg'
]
where id = 'team-chat-media';
