import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { requireSupabase } from '../lib/supabase';

const SUPPORT_MEDIA_BUCKET = 'support-chat-media';
const SUPPORT_MESSAGE_SELECT = 'id, conversation_id, sender_type, sender_id, body, media_path, media_type, media_name, media_mime, media_size, created_at, profiles(display_name, avatar_url)';

async function addSignedSupportMedia(client, rows) {
  const paths = [...new Set((rows || []).map((row) => row.media_path).filter(Boolean))];
  if (!paths.length) return (rows || []).map((row) => ({ ...row, media_url: null }));
  const { data, error } = await client.storage.from(SUPPORT_MEDIA_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const urls = new Map((data || []).map((item, index) => [paths[index], item.signedUrl]));
  return (rows || []).map((row) => ({ ...row, media_url: row.media_path ? urls.get(row.media_path) || null : null }));
}

export function normalizeSupportConversation(row) {
  if (!row) return null;
  return {
    id: row.conversation_id,
    status: row.status,
    category: row.category || null,
    aiHandled: Boolean(row.ai_handled),
    needsHuman: Boolean(row.needs_human),
    assignedAgentId: row.assigned_agent_id || null,
    assignedAgentName: row.assigned_agent_name || null,
    requesterId: row.requester_id || null,
    requesterName: row.requester_name || null,
    requesterAvatar: row.requester_avatar_url || null,
    createdAt: row.created_at || null,
    lastMessageAt: row.last_message_at || null,
    lastBody: row.last_body || null,
    lastSenderType: row.last_sender_type || null,
    unreadCount: Number(row.unread_count || 0),
    requesterLastReadAt: row.requester_last_read_at || null,
    agentLastReadAt: row.agent_last_read_at || null,
    csatRating: row.csat_rating || null,
    csatComment: row.csat_comment || null,
    csatSubmittedAt: row.csat_submitted_at || null,
  };
}

export function normalizeSupportMessage(row, currentUserId) {
  if (!row) return null;
  const name = row.sender_type === 'ai'
    ? 'Peakle AI'
    : row.sender_type === 'agent'
      ? (row.profiles?.display_name || 'Peakle support')
      : (row.sender_id === currentUserId ? 'You' : row.profiles?.display_name || 'You');
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    sender: name,
    avatar: row.profiles?.avatar_url || null,
    mine: row.sender_type === 'user' && row.sender_id === currentUserId,
    text: row.body,
    mediaUrl: row.media_url || null,
    mediaType: row.media_type || null,
    mediaName: row.media_name || null,
    createdAt: row.created_at,
    time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

export async function startSupportConversation(body, category = null, media = null) {
  const { data, error } = await requireSupabase().rpc('start_support_conversation', {
    p_body: body.trim(),
    p_category: category,
    p_media_path: media?.path || null,
    p_media_type: media?.type || null,
    p_media_name: media?.name || null,
    p_media_mime: media?.mime || null,
    p_media_size: media?.size || null,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return { conversationId: result?.conversation_id, messageId: result?.message_id };
}

export async function sendSupportMessage(conversationId, body, media = null) {
  const { error } = await requireSupabase().rpc('send_support_message', {
    p_conversation_id: conversationId,
    p_body: body.trim(),
    p_media_path: media?.path || null,
    p_media_type: media?.type || null,
    p_media_name: media?.name || null,
    p_media_mime: media?.mime || null,
    p_media_size: media?.size || null,
  });
  if (error) throw error;
}

const mediaExtension = (mime, fileName = '') => {
  const known = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return known[mime] || fileName.split('.').pop()?.toLowerCase() || 'jpg';
};

export async function uploadSupportChatMedia(asset) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in before uploading an image.');

  const actions = Math.max(asset.width || 0, asset.height || 0) > 1600
    ? [{ resize: asset.width >= asset.height ? { width: 1600 } : { height: 1600 } }]
    : [];
  const optimized = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: 0.76, format: ImageManipulator.SaveFormat.JPEG });
  const mime = 'image/jpeg';

  const response = await fetch(optimized.uri);
  const file = await response.arrayBuffer();
  const maxBytes = 5 * 1024 * 1024;
  if (file.byteLength > maxBytes) throw new Error('Image is too large. The limit is 5 MB.');

  const extension = mediaExtension(mime, asset.fileName);
  const path = `${auth.user.id}/${Crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from(SUPPORT_MEDIA_BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (error) throw error;

  return { path, type: 'image', mime, size: file.byteLength, name: asset.fileName || `Attachment.${extension}` };
}

export async function deleteSupportChatMedia(path) {
  if (!path) return;
  const { error } = await requireSupabase().storage.from(SUPPORT_MEDIA_BUCKET).remove([path]);
  if (error) throw error;
}

export async function requestHumanSupport(conversationId) {
  const { error } = await requireSupabase().rpc('request_human_support', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function rateSupportConversation(conversationId, rating, comment = null) {
  const { error } = await requireSupabase().rpc('rate_support_conversation', {
    p_conversation_id: conversationId,
    p_rating: rating,
    p_comment: comment,
  });
  if (error) throw error;
}

export async function triggerSupportAiReply(conversationId) {
  try {
    await requireSupabase().functions.invoke('support-ai-reply', {
      body: { conversation_id: conversationId },
    });
  } catch {
    // Best-effort: the requester can still reach a human via "Talk to a human"
    // even if the AI responder is unavailable right now.
  }
}

export async function listSupportConversations() {
  const { data, error } = await requireSupabase().rpc('list_support_conversations');
  if (error) throw error;
  return (data || []).map(normalizeSupportConversation);
}

export async function getSupportConversation(conversationId) {
  if (!conversationId) return null;
  const { data, error } = await requireSupabase().rpc('get_support_conversation', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeSupportConversation(row);
}

export async function listSupportMessages(conversationId) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('support_messages')
    .select(SUPPORT_MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(200);
  if (error) throw error;
  const signed = await addSignedSupportMedia(client, data || []);
  return signed.map((row) => normalizeSupportMessage(row, auth.user?.id));
}

export async function getSupportMessage(messageId) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('support_messages')
    .select(SUPPORT_MESSAGE_SELECT)
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [signed] = await addSignedSupportMedia(client, [data]);
  return normalizeSupportMessage(signed, auth.user?.id);
}

export async function markSupportConversationRead(conversationId) {
  const { error } = await requireSupabase().rpc('mark_support_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}
