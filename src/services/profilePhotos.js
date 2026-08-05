import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { SUPABASE_URL, requireSupabase } from '../lib/supabase';

const BUCKET = 'profile-photos';
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;

export function isLocalPhotoUri(uri) {
  return Boolean(uri) && !/^https?:\/\//i.test(uri);
}

export function isLegacyCartoonPhoto(uri) {
  return typeof uri === 'string' && /^https:\/\/api\.dicebear\.com\//i.test(uri);
}

export function normalizeProfilePhoto(uri) {
  return isLegacyCartoonPhoto(uri) ? null : uri || null;
}

export async function uploadProfilePhoto(userId, uri) {
  if (!isLocalPhotoUri(uri)) return uri || null;
  if (!userId) throw new Error('Sign in before uploading a profile photo.');

  const optimized = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 720, height: 720 } }],
    { compress: .82, format: ImageManipulator.SaveFormat.JPEG },
  );
  const response = await fetch(optimized.uri);
  const file = await response.arrayBuffer();
  if (file.byteLength > MAX_PROFILE_PHOTO_BYTES) {
    throw new Error('The selected photo is too large. Choose a photo under 2 MB.');
  }

  const path = `${userId}/${Crypto.randomUUID()}.jpg`;
  const client = requireSupabase();
  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function deleteManagedProfilePhoto(uri) {
  if (!uri?.startsWith(PUBLIC_PREFIX)) return;
  const path = decodeURIComponent(uri.slice(PUBLIC_PREFIX.length));
  if (!path) return;
  const { error } = await requireSupabase().storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
