import { requireSupabase } from "./supabase";

const ORGANIZER_MEDIA_BUCKET = "organizer-media";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateOrganizerImage(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error("Choose a JPG, PNG, or WebP court photo.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The court photo must be smaller than 4 MB.");
}

export async function saveCourtImage(venueId: string, courtId: string, file: File) {
  validateOrganizerImage(file);

  const client = requireSupabase();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `venues/${venueId}/courts/${courtId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage.from(ORGANIZER_MEDIA_BUCKET).upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const imageUrl = client.storage.from(ORGANIZER_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  const { error: updateError } = await client.from("courts").update({ image_url: imageUrl }).eq("id", courtId).eq("venue_id", venueId);
  if (updateError) throw updateError;
  return imageUrl;
}
