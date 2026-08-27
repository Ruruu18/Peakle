import { requireSupabase } from "./supabase";

const SUPPORT_MEDIA_BUCKET = "support-chat-media";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type SupportMediaAttachment = {
  path: string;
  type: "image";
  mime: string;
  size: number;
  name: string;
};

export function validateSupportImage(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The image must be smaller than 5 MB.");
}

export async function uploadSupportChatMedia(file: File): Promise<SupportMediaAttachment> {
  validateSupportImage(file);
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("Sign in before uploading an image.");

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${auth.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from(SUPPORT_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;

  return { path, type: "image", mime: file.type, size: file.size, name: file.name };
}

export async function deleteSupportChatMedia(path: string) {
  const client = requireSupabase();
  const { error } = await client.storage.from(SUPPORT_MEDIA_BUCKET).remove([path]);
  if (error) throw error;
}

export async function signSupportChatMedia(paths: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map();
  const client = requireSupabase();
  const { data, error } = await client.storage.from(SUPPORT_MEDIA_BUCKET).createSignedUrls(unique, 3600);
  if (error) throw error;
  return new Map((data || []).map((item, index) => [unique[index], item.signedUrl]));
}
