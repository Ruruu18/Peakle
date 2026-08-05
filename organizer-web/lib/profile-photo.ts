import { requireSupabase } from "./supabase";

const PROFILE_PHOTOS_BUCKET = "profile-photos";
const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;
const SUPPORTED_PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateProfilePhoto(file: File) {
  if (!SUPPORTED_PROFILE_PHOTO_TYPES.has(file.type)) throw new Error("Choose a JPG, PNG, or WebP profile photo.");
  if (file.size > MAX_PROFILE_PHOTO_BYTES) throw new Error("The profile photo must be smaller than 2 MB.");
}

export async function uploadProfilePhoto(userId: string, file: File) {
  validateProfilePhoto(file);

  const client = requireSupabase();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from(PROFILE_PHOTOS_BUCKET).upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return client.storage.from(PROFILE_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function deleteProfilePhoto(photoUrl?: string | null) {
  if (!photoUrl) return;
  const marker = `/storage/v1/object/public/${PROFILE_PHOTOS_BUCKET}/`;
  const markerIndex = photoUrl.indexOf(marker);
  if (markerIndex < 0) return;
  const path = decodeURIComponent(photoUrl.slice(markerIndex + marker.length));
  if (!path) return;
  const { error } = await requireSupabase().storage.from(PROFILE_PHOTOS_BUCKET).remove([path]);
  if (error) throw error;
}
