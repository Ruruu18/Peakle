-- Migration version normalized to keep every deployment version unique.
-- Profile identity now uses real photos. Clear the retired DiceBear character
-- URLs so existing accounts receive the same initials fallback as new users.
update public.profiles
set avatar_url = null
where avatar_url ilike 'https://api.dicebear.com/%';
