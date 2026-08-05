import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { requireSupabase } from '../lib/supabase';

const BUCKET = 'organizer-media';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const isLocalUri = (uri) => Boolean(uri) && !/^https?:\/\//i.test(uri);

async function uploadImage(pathPrefix, uri) {
  if (!isLocalUri(uri)) return uri || null;
  const optimized = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: .84, format: ImageManipulator.SaveFormat.JPEG },
  );
  const response = await fetch(optimized.uri);
  const file = await response.arrayBuffer();
  if (file.byteLength > MAX_IMAGE_BYTES) throw new Error('The selected image is too large. Choose an image under 4 MB.');

  const client = requireSupabase();
  const path = `${pathPrefix}/${Crypto.randomUUID()}.jpg`;
  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function saveVenueBrandImage(venueId, uri) {
  const imageUrl = await uploadImage(`venues/${venueId}/brand`, uri);
  const { data, error } = await requireSupabase().from('venues')
    .update({ brand_image_url: imageUrl })
    .eq('id', venueId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveCourtImage(venueId, courtId, uri) {
  const imageUrl = await uploadImage(`venues/${venueId}/courts/${courtId}`, uri);
  const { data, error } = await requireSupabase().from('courts')
    .update({ image_url: imageUrl })
    .eq('id', courtId)
    .eq('venue_id', venueId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveCompetitionCover(competitionId, uri) {
  const imageUrl = await uploadImage(`competitions/${competitionId}`, uri);
  const { data, error } = await requireSupabase().from('competitions')
    .update({ cover_image_url: imageUrl })
    .eq('id', competitionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
