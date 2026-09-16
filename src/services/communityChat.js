import { requireSupabase } from '../lib/supabase';

const MESSAGE_SELECT = 'id, conversation_id, sender_id, body, is_announcement, created_at, profiles(display_name, avatar_url)';

function single(data) {
  return Array.isArray(data) ? data[0] : data;
}

export function normalizeCommunityChat(row) {
  if (!row) return null;
  return {
    conversationId: row.conversation_id,
    eventKind: row.event_kind,
    eventId: row.event_id,
    title: row.title,
    subtitle: row.subtitle,
    isHost: Boolean(row.is_host),
    memberCount: Number(row.member_count || 0),
    lastMessageAt: row.last_message_at || null,
    lastBody: row.last_body || null,
    lastIsAnnouncement: Boolean(row.last_is_announcement),
    lastSenderName: row.last_sender_name || null,
    unreadCount: Number(row.unread_count || 0),
  };
}

export function normalizeCommunityMessage(row, currentUserId) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    sender: row.sender_id === currentUserId ? 'You' : row.profiles?.display_name || 'Member',
    avatar: row.profiles?.avatar_url || null,
    mine: row.sender_id === currentUserId,
    text: row.body,
    isAnnouncement: Boolean(row.is_announcement),
    createdAt: row.created_at,
    time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

export async function getOrCreateCommunityChat(eventKind, eventId) {
  const { data, error } = await requireSupabase().rpc('get_or_create_community_chat', {
    p_event_kind: eventKind,
    p_event_id: String(eventId),
  });
  if (error) throw error;
  return normalizeCommunityChat(single(data));
}

export async function listMyCommunityChats() {
  const { data, error } = await requireSupabase().rpc('list_my_community_chats');
  if (error) throw error;
  return (data || []).map(normalizeCommunityChat);
}

export async function listCommunityMessages(conversationId) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('community_messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(300);
  if (error) throw error;
  return (data || []).map((row) => normalizeCommunityMessage(row, auth.user?.id));
}

export async function getCommunityMessage(messageId) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('community_messages')
    .select(MESSAGE_SELECT)
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return normalizeCommunityMessage(data, auth.user?.id);
}

export async function sendCommunityMessage(conversationId, body, announce = false) {
  const { data, error } = await requireSupabase().rpc('send_community_message', {
    p_conversation_id: conversationId,
    p_body: body.trim(),
    p_announce: Boolean(announce),
  });
  if (error) throw error;
  return data;
}

export async function markCommunityConversationRead(conversationId) {
  const { error } = await requireSupabase().rpc('mark_community_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}
