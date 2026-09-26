-- Chat photos are uploaded as the original file (no resize or re-compression),
-- so the buckets must accept full-resolution photos up to 50 MB. The app still
-- caps videos at 15 MB and voice messages at 10 MB.
update storage.buckets
set file_size_limit = 52428800
where id in ('direct-message-media', 'team-chat-media');
