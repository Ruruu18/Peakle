import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';
import {
  DEMO_CONVERSATIONS, DEMO_CONVERSATION, DEMO_CONVERSATION_ID, DEMO_DIRECT_MESSAGES,
  DEMO_SUGGESTIONS, DEMO_FOLLOWING, DEMO_FOLLOW_COUNTS,
} from '../config/demoData';
import { uploadChatMedia } from './database';
import { announcePlayerStatusChange } from './playerStatus';

const DIRECT_MEDIA_BUCKET = 'direct-message-media';

const DIRECT_MESSAGE_SELECT_BASE = 'id, conversation_id, sender_id, body, created_at, profiles!direct_messages_sender_id_fkey(display_name, avatar_url)';
const DIRECT_MESSAGE_SELECT = `${DIRECT_MESSAGE_SELECT_BASE}, direct_message_reactions(emoji, user_id)`;
const reactionsSchemaMissing = (error) => ['42P01', 'PGRST200', 'PGRST205'].includes(error?.code);
// 42703: a newer column (unsend or media) has not reached this project yet.
const columnMissing = (error) => ['42703', 'PGRST204'].includes(error?.code);
const deleteSchemaMissing = (error) => ['42P01', '42703', 'PGRST202', 'PGRST205'].includes(error?.code);
// Newest first: media (202609260007) builds on unsend (202609260006).
const MESSAGE_COLUMN_LEVELS = ['', ', deleted_at', ', deleted_at, media_path, media_type, media_mime, media_name, media_duration_ms'];

// Tries the newest message shape first and drops only the part the project
// is missing: newer columns, the reactions table, or both.
async function selectDirectMessages(run) {
  let columnLevel = MESSAGE_COLUMN_LEVELS.length - 1;
  let withReactions = true;
  for (;;) {
    const select = `${withReactions ? DIRECT_MESSAGE_SELECT : DIRECT_MESSAGE_SELECT_BASE}${MESSAGE_COLUMN_LEVELS[columnLevel]}`;
    const result = await run(select);
    if (!result.error) return result;
    if (columnLevel > 0 && columnMissing(result.error)) columnLevel -= 1;
    else if (withReactions && reactionsSchemaMissing(result.error)) withReactions = false;
    else return result;
  }
}

// Media is private, so each message gets a short-lived signed URL.
async function addSignedDirectMedia(client, rows) {
  const paths = [...new Set((rows || []).map((row) => row?.media_path).filter(Boolean))];
  if (!paths.length) return rows || [];
  const { data, error } = await client.storage.from(DIRECT_MEDIA_BUCKET).createSignedUrls(paths, 3600);
  const urls = error ? new Map() : new Map((data || []).map((item, index) => [paths[index], item.signedUrl]));
  return rows.map((row) => (row?.media_path ? { ...row, media_url: urls.get(row.media_path) || null } : row));
}

export function normalizeDirectConversation(row) {
  if (!row) return null;
  return {
    id: row.conversation_id,
    peer: {
      id: row.peer_id,
      name: row.peer_name || 'Peakle player',
      avatar: row.peer_avatar_url || null,
      area: row.peer_home_area || null,
    },
    status: row.status,
    requesterId: row.requester_id,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at || null,
    lastMessageAt: row.last_message_at || row.last_created_at || null,
    lastBody: row.last_body || null,
    lastSenderId: row.last_sender_id || null,
    unreadCount: Number(row.unread_count || 0),
    peerLastReadAt: row.peer_last_read_at || null,
    blockedByMe: Boolean(row.blocked_by_me),
    blockedMe: Boolean(row.blocked_me),
  };
}

export function normalizeDirectMessage(row, currentUserId) {
  if (!row) return null;
  const name = row.profiles?.display_name || (row.sender_id === currentUserId ? 'You' : 'Peakle player');
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    sender: name,
    avatar: row.profiles?.avatar_url || null,
    mine: row.sender_id === currentUserId,
    text: row.deleted_at ? null : row.body,
    deletedAt: row.deleted_at || null,
    mediaType: row.deleted_at ? null : row.media_type || null,
    mediaPath: row.deleted_at ? null : row.media_path || null,
    mediaUrl: row.deleted_at ? null : row.media_url || null,
    mediaDurationMs: row.deleted_at ? null : row.media_duration_ms ?? null,
    reactions: row.direct_message_reactions || [],
    createdAt: row.created_at,
    time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

export async function listDirectConversations() {
  if (DEMO_MODE) return DEMO_CONVERSATIONS.map((conversation) => applyConversationSettings(conversation, null));
  const client = requireSupabase();
  const [{ data, error }, settingsById] = await Promise.all([
    client.rpc('list_direct_conversations'),
    listDirectConversationSettings(client),
  ]);
  if (error) throw error;
  return (data || [])
    .map(normalizeDirectConversation)
    .map((conversation) => applyConversationSettings(conversation, settingsById.get(conversation.id)))
    .filter((conversation) => !conversation.deleted);
}

// ---------------------------------------------------------------------------
// Per-player inbox controls (archive, mute, delete for me). Settings only ever
// affect the caller's own inbox; the other participant sees no change.

// Offered mute lengths in minutes; null mutes until turned back on.
export const MUTE_DURATIONS = [
  { minutes: 15, label: 'For 15 minutes' },
  { minutes: 30, label: 'For 30 minutes' },
  { minutes: 60, label: 'For 1 hour' },
  { minutes: null, label: 'Until I turn it back on' },
];

const settingsSchemaMissing = (error) => ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
const timeOf = (value) => (value ? Date.parse(value) : NaN);

function normalizeConversationSettings(row) {
  return {
    archivedAt: row?.archived_at || null,
    clearedAt: row?.cleared_at || null,
    mutedUntil: row?.muted_until || null,
  };
}

// 'infinity' (mute until turned back on) arrives from PostgREST as a string.
export function isMuteActive(mutedUntil, now = Date.now()) {
  if (!mutedUntil) return false;
  if (mutedUntil === 'infinity') return true;
  const until = timeOf(mutedUntil);
  return Number.isFinite(until) && until > now;
}

export function muteStatusLabel(mutedUntil, now = Date.now()) {
  if (!isMuteActive(mutedUntil, now)) return null;
  if (mutedUntil === 'infinity') return 'Muted until you turn it back on';
  const until = new Date(mutedUntil);
  const sameDay = until.toDateString() === new Date(now).toDateString();
  const time = until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Muted until ${sameDay ? time : `${until.toLocaleDateString([], { weekday: 'short' })} ${time}`}`;
}

// A conversation is archived or deleted only until something newer arrives,
// so a new message brings it back to the inbox automatically.
export function applyConversationSettings(conversation, settings) {
  if (!conversation) return conversation;
  const { archivedAt, clearedAt, mutedUntil } = settings || normalizeConversationSettings(null);
  const lastActivity = timeOf(conversation.lastMessageAt) || timeOf(conversation.createdAt) || 0;
  return {
    ...conversation,
    archivedAt,
    clearedAt,
    mutedUntil,
    archived: Boolean(archivedAt) && lastActivity <= timeOf(archivedAt),
    deleted: Boolean(clearedAt) && lastActivity <= timeOf(clearedAt),
    muted: isMuteActive(mutedUntil),
  };
}

// Settings are optional: before the migration reaches a project every
// conversation simply reads as unarchived, unmuted, and not deleted.
async function listDirectConversationSettings(client) {
  const { data, error } = await client.from('direct_conversation_settings')
    .select('conversation_id, archived_at, cleared_at, muted_until');
  if (error) {
    if (settingsSchemaMissing(error)) return new Map();
    throw error;
  }
  return new Map((data || []).map((row) => [row.conversation_id, normalizeConversationSettings(row)]));
}

export async function getDirectConversationSettings(conversationId) {
  if (DEMO_MODE || !conversationId) return normalizeConversationSettings(null);
  const client = requireSupabase();
  const { data, error } = await client.from('direct_conversation_settings')
    .select('archived_at, cleared_at, muted_until')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    if (settingsSchemaMissing(error)) return normalizeConversationSettings(null);
    throw error;
  }
  return normalizeConversationSettings(data);
}

function settingsError(error) {
  if (settingsSchemaMissing(error)) return new Error('Archive, mute, and delete are not available yet. Please try again after the next update.');
  return error;
}

export async function setDirectConversationArchived(conversationId, archived) {
  if (DEMO_MODE) return archived ? new Date().toISOString() : null;
  const { data, error } = await requireSupabase().rpc('set_direct_conversation_archived', {
    p_conversation_id: conversationId,
    p_archived: Boolean(archived),
  });
  if (error) throw settingsError(error);
  return data || null;
}

// minutes: a number for a timed mute, null to mute until turned back on.
export async function muteDirectConversation(conversationId, minutes = null) {
  if (DEMO_MODE) return minutes == null ? 'infinity' : new Date(Date.now() + minutes * 60000).toISOString();
  const { data, error } = await requireSupabase().rpc('set_direct_conversation_muted', {
    p_conversation_id: conversationId,
    p_muted: true,
    p_minutes: minutes,
  });
  if (error) throw settingsError(error);
  return data || null;
}

export async function unmuteDirectConversation(conversationId) {
  if (DEMO_MODE) return null;
  const { error } = await requireSupabase().rpc('set_direct_conversation_muted', {
    p_conversation_id: conversationId,
    p_muted: false,
  });
  if (error) throw settingsError(error);
  return null;
}

export async function deleteDirectConversationForMe(conversationId) {
  if (DEMO_MODE) return new Date().toISOString();
  const { data, error } = await requireSupabase().rpc('delete_direct_conversation_for_me', {
    p_conversation_id: conversationId,
  });
  if (error) throw settingsError(error);
  return data || null;
}

async function hydrateFollowProfiles(client, relationships, idKey) {
  const ids = [...new Set((relationships || []).map((row) => row[idKey]).filter(Boolean))];
  if (!ids.length) return [];

  const profileResults = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => (
      client
        .from('profiles')
        .select('id, display_name, avatar_url, home_area, presence_status')
        .in('id', ids.slice(index * 100, (index + 1) * 100))
    )),
  );
  const profileError = profileResults.find((result) => result.error)?.error;
  if (profileError) throw profileError;

  const profilesById = new Map(
    profileResults
      .flatMap((result) => result.data || [])
      .map((profile) => [profile.id, profile]),
  );
  const activityById = await getPlayerActivity(client, ids);
  return relationships
    .map((relationship) => profilesById.get(relationship[idKey]))
    .filter(Boolean)
    .map((profile) => ({
      id: profile.id,
      name: profile.display_name || 'Peakle player',
      avatar: profile.avatar_url || null,
      area: profile.home_area || null,
      playerStatus: profile.presence_status || 'free',
      isOnline: Boolean(activityById.get(profile.id)?.is_online),
      lastActiveAt: activityById.get(profile.id)?.last_active_at || null,
    }));
}

// presence_status is only the player's chosen label and defaults to free, so
// the status dot is shown only for players who are using the app right now.
// Activity is non-essential: if it cannot load, everyone simply reads offline.
async function getPlayerActivity(client, ids) {
  try {
    const { data, error } = await client.rpc('get_player_activity', { p_player_ids: ids });
    if (error) return new Map();
    return new Map((data || []).map((row) => [row.user_id, row]));
  } catch {
    return new Map();
  }
}

export async function listFollowingPlayers() {
  if (DEMO_MODE) return DEMO_FOLLOWING;
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user?.id) return [];

  const { data, error } = await client
    .from('player_follows')
    .select('followed_id, created_at')
    .eq('follower_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return hydrateFollowProfiles(client, data, 'followed_id');
}

export async function listFollowerPlayers() {
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user?.id) return [];

  const { data, error } = await client
    .from('player_follows')
    .select('follower_id, created_at')
    .eq('followed_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return hydrateFollowProfiles(client, data, 'follower_id');
}

// Friends are players connected both ways: A follows B and B follows A.
export async function listFriendPlayers() {
  if (DEMO_MODE) return DEMO_FOLLOWING;
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user?.id) return [];

  const [followingResult, followersResult] = await Promise.all([
    client.from('player_follows')
      .select('followed_id, created_at')
      .eq('follower_id', auth.user.id)
      .order('created_at', { ascending: false }),
    client.from('player_follows')
      .select('follower_id')
      .eq('followed_id', auth.user.id),
  ]);
  const error = followingResult.error || followersResult.error;
  if (error) throw error;

  const followerIds = new Set((followersResult.data || []).map((row) => row.follower_id));
  const friends = (followingResult.data || []).filter((row) => followerIds.has(row.followed_id));
  return hydrateFollowProfiles(client, friends, 'followed_id');
}

export async function listPrivateConnections() {
  if (DEMO_MODE) return [];
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user?.id) return [];

  const [followingResult, followersResult] = await Promise.all([
    client.from('player_follows')
      .select('followed_id, created_at, profile:profiles!player_follows_followed_id_fkey(id, display_name, avatar_url, home_area)')
      .eq('follower_id', auth.user.id)
      .order('created_at', { ascending: false }),
    client.from('player_follows')
      .select('follower_id')
      .eq('followed_id', auth.user.id),
  ]);
  const error = followingResult.error || followersResult.error;
  if (error) throw error;

  const followerIds = new Set((followersResult.data || []).map((row) => row.follower_id));
  return (followingResult.data || [])
    .filter((row) => followerIds.has(row.followed_id) && row.profile)
    .map((row) => ({
      id: row.profile.id,
      name: row.profile.display_name || 'Peakle player',
      avatar: row.profile.avatar_url || null,
      area: row.profile.home_area || null,
      connectedAt: row.created_at || null,
    }));
}

export async function getDirectConversation(conversationId) {
  if (!conversationId) return null;
  if (DEMO_MODE) return conversationId === DEMO_CONVERSATION_ID ? DEMO_CONVERSATION : null;
  const { data, error } = await requireSupabase().rpc('get_direct_conversation', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeDirectConversation(row);
}

export async function findDirectConversation(playerId) {
  if (!playerId) return null;
  const { data, error } = await requireSupabase().rpc('find_direct_conversation', {
    p_player_id: playerId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeDirectConversation(row);
}

export async function listDirectMessages(conversationId) {
  if (DEMO_MODE) return conversationId === DEMO_CONVERSATION_ID ? DEMO_DIRECT_MESSAGES : [];
  const client = requireSupabase();
  const [{ data: auth }, settings, hiddenIds] = await Promise.all([
    client.auth.getUser(),
    getDirectConversationSettings(conversationId),
    listHiddenDirectMessageIds(client, conversationId),
  ]);
  // After "delete for me", only messages newer than the deletion are shown.
  const query = (select) => {
    let builder = client.from('direct_messages')
      .select(select)
      .eq('conversation_id', conversationId);
    if (settings.clearedAt) builder = builder.gt('created_at', settings.clearedAt);
    return builder
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(150);
  };
  const { data, error } = await selectDirectMessages(query);
  if (error) throw error;
  const visible = await addSignedDirectMedia(client, (data || []).filter((row) => !hiddenIds.has(row.id)));
  return visible.map((row) => normalizeDirectMessage(row, auth.user?.id));
}

// Messages this player deleted for themselves only.
async function listHiddenDirectMessageIds(client, conversationId) {
  const { data, error } = await client.from('direct_message_hides')
    .select('message_id, direct_messages!inner(conversation_id)')
    .eq('direct_messages.conversation_id', conversationId);
  if (error) {
    if (deleteSchemaMissing(error) || reactionsSchemaMissing(error)) return new Set();
    throw error;
  }
  return new Set((data || []).map((row) => row.message_id));
}

export async function getDirectMessage(messageId) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await selectDirectMessages((select) => client.from('direct_messages')
    .select(select)
    .eq('id', messageId)
    .maybeSingle());
  if (error) throw error;
  const [row] = await addSignedDirectMedia(client, data ? [data] : []);
  return normalizeDirectMessage(row || null, auth.user?.id);
}

export async function startDirectConversation(playerId, body) {
  const { data, error } = await requireSupabase().rpc('start_direct_conversation', {
    p_player_id: playerId,
    p_body: body.trim(),
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    conversationId: result?.conversation_id,
    messageId: result?.message_id,
    status: result?.conversation_status,
  };
}

const normalizeMessagePermission = (row) => ({
  isFollowing: Boolean(row?.is_following),
  followsYou: Boolean(row?.follows_you),
  followRequestPending: Boolean(row?.followRequestPending),
  sharesTeam: Boolean(row?.shares_team),
  hasExistingConversation: Boolean(row?.has_existing_conversation),
  peerChatEligible: row?.peer_chat_eligible == null ? null : Boolean(row.peer_chat_eligible),
  blocked: Boolean(row?.blocked),
  canMessage: Boolean(row?.can_message),
});

async function listOutgoingFollowRequestIds(playerIds) {
  if (!playerIds.length) return new Set();
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user?.id) return new Set();
  const { data, error } = await client.from('player_follow_requests')
    .select('recipient_id')
    .eq('requester_id', auth.user.id)
    .in('recipient_id', playerIds);
  if (error) throw error;
  return new Set((data || []).map((row) => row.recipient_id));
}

export async function getDirectMessagePermission(playerId) {
  if (!playerId) return null;
  if (DEMO_MODE) {
    return {
      isFollowing: true, followsYou: true, followRequestPending: false, sharesTeam: true,
      hasExistingConversation: true, peerChatEligible: true, blocked: false, canMessage: true,
    };
  }
  const client = requireSupabase();
  const [{ data, error }, pendingIds] = await Promise.all([
    client.rpc('get_direct_message_permission', { p_player_id: playerId }),
    listOutgoingFollowRequestIds([playerId]),
  ]);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? normalizeMessagePermission({ ...row, followRequestPending: pendingIds.has(playerId) }) : null;
}

export async function getPlayerFollowCounts(playerId = null) {
  if (DEMO_MODE) return { ...DEMO_FOLLOW_COUNTS };
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_player_follow_counts', {
    p_player_id: playerId,
  });
  if (error) {
    // Older/partially migrated projects may have player_follows without the
    // count RPC. RLS still lets a signed-in player count every relationship
    // involving their own account, so keep the personal profile accurate.
    if (!playerId && error.code === 'PGRST202') {
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      if (!auth.user?.id) throw error;
      const [followersResult, followingResult] = await Promise.all([
        client.from('player_follows')
          .select('follower_id', { count: 'exact', head: true })
          .eq('followed_id', auth.user.id),
        client.from('player_follows')
          .select('followed_id', { count: 'exact', head: true })
          .eq('follower_id', auth.user.id),
      ]);
      if (followersResult.error) throw followersResult.error;
      if (followingResult.error) throw followingResult.error;
      const followers = Number(followersResult.count || 0);
      const following = Number(followingResult.count || 0);
      return { followers, following, friends: Math.min(followers, following) };
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  const followers = Number(row?.followers || 0);
  const following = Number(row?.following || 0);
  return { followers, following, friends: await getPlayerFriendCount(client, playerId, Math.min(followers, following)) };
}

// Databases without the friend count RPC fall back to the smaller of the two
// follow totals, which matches the friend count whenever follows are mutual.
async function getPlayerFriendCount(client, playerId, fallback) {
  const { data, error } = await client.rpc('get_player_friend_count', { p_player_id: playerId });
  if (error) return fallback;
  return Number((Array.isArray(data) ? data[0] : data) || 0);
}

async function getPlayerFollowCountsByIds(playerIds) {
  const ids = [...new Set((playerIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const client = requireSupabase();
  const { data, error } = await client.rpc('get_player_follow_counts_batch', {
    p_player_ids: ids,
  });

  if (!error) {
    const friendResult = await client.rpc('get_player_friend_counts_batch', { p_player_ids: ids });
    const friendsById = new Map((friendResult.error ? [] : friendResult.data || [])
      .map((row) => [row.player_id, Number(row.friends || 0)]));
    return new Map((data || []).map((row) => {
      const followers = Number(row.followers || 0);
      const following = Number(row.following || 0);
      return [row.player_id, { followers, following, friends: friendsById.get(row.player_id) ?? Math.min(followers, following) }];
    }));
  }

  // Keep upgraded clients compatible with databases that have not received
  // the batch RPC yet. The canonical single-player RPC is security-definer,
  // so these values remain complete even when RLS hides unrelated follow rows.
  const results = await Promise.allSettled(ids.map(async (id) => ({
    id,
    counts: await getPlayerFollowCounts(id),
  })));
  return new Map(results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => [result.value.id, result.value.counts]));
}

export async function getPublicPlayerProfile(playerId) {
  if (!playerId) return null;
  const { data, error } = await requireSupabase().rpc('get_public_player_profile', {
    p_player_id: playerId,
  });
  if (error) throw error;
  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.display_name || 'Peakle player',
    avatar: profile.avatar_url || null,
    area: profile.home_area || null,
    rating: profile.skill_rating === null ? null : Number(profile.skill_rating),
    playPreference: profile.play_preference || null,
  };
}

export async function getPlayerMutualConnections(playerId, limit = 3) {
  if (!playerId) return { count: 0, connections: [] };
  const { data, error } = await requireSupabase().rpc('get_player_mutual_connections', {
    p_player_id: playerId,
    p_limit: limit,
  });
  if (error) throw error;
  return {
    count: Number(data?.count || 0),
    connections: (data?.connections || []).map((profile) => ({
      id: profile.id,
      name: profile.display_name || 'Peakle player',
      avatar: profile.avatar_url || null,
    })),
  };
}

export async function searchDirectMessageCandidates(query) {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const { data, error } = await requireSupabase().rpc('search_direct_message_candidates', {
    p_query: clean,
  });
  if (error) throw error;
  const pendingIds = await listOutgoingFollowRequestIds((data || []).map((row) => row.id));
  return (data || []).map((row) => ({
    id: row.id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    skill_rating: row.skill_rating,
    home_area: row.home_area,
    ...normalizeMessagePermission({ ...row, followRequestPending: pendingIds.has(row.id) }),
  }));
}

export async function followPlayer(playerId) {
  const { error } = await requireSupabase().rpc('follow_player', {
    p_player_id: playerId,
  });
  if (error) throw error;
  announcePlayerStatusChange(playerId);
  const permission = await getDirectMessagePermission(playerId);
  return { ...permission, followRequestPending: !permission?.isFollowing };
}

export async function unfollowPlayer(playerId) {
  const { error } = await requireSupabase().rpc('unfollow_player', {
    p_player_id: playerId,
  });
  if (error) throw error;
  announcePlayerStatusChange(playerId);
  return getDirectMessagePermission(playerId);
}

export async function listPlayerSuggestions(limit = 8) {
  if (DEMO_MODE) return DEMO_SUGGESTIONS.slice(0, limit);
  const { data, error } = await requireSupabase().rpc('get_player_suggestions', {
    p_limit: limit,
  });
  if (error) throw error;
  const rows = data || [];
  const countsByPlayerId = await getPlayerFollowCountsByIds(rows.map((row) => row.id));
  return rows.map((row) => {
    const counts = countsByPlayerId.get(row.id);
    return ({
      id: row.id,
      name: row.display_name || 'Peakle player',
      avatar: row.avatar_url || null,
      area: row.home_area || null,
      rating: row.skill_rating === null ? null : Number(row.skill_rating),
      reason: row.reason || 'Peakle player',
      followers: counts?.followers ?? Number(row.followers || 0),
      following: counts?.following ?? Number(row.following || 0),
      friends: counts?.friends ?? Math.min(Number(row.followers || 0), Number(row.following || 0)),
      mutuals: Number(row.mutuals || 0),
      followRequestPending: false,
    });
  });
}

export async function respondFollowRequest(requesterId, accept) {
  if (!requesterId) throw new Error('This follow request is unavailable.');
  const { data, error } = await requireSupabase().rpc('respond_follow_request', {
    p_requester_id: requesterId,
    p_accept: Boolean(accept),
  });
  if (error) throw error;
  announcePlayerStatusChange(requesterId);
  return Boolean(data);
}

export async function sendDirectMessage(conversationId, body) {
  const { data, error } = await requireSupabase().rpc('send_direct_message', {
    p_conversation_id: conversationId,
    p_body: body.trim(),
  });
  if (error) throw error;
  return getDirectMessage(data);
}

export async function toggleDirectMessageReaction(messageId, emoji) {
  const client = requireSupabase();
  const { error } = await client.rpc('toggle_direct_message_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) throw error;
  return getDirectMessage(messageId);
}

function deleteError(error) {
  if (deleteSchemaMissing(error)) return new Error('Deleting messages is not available yet. Please try again after the next update.');
  return error;
}

// Delete for everyone: only the sender can unsend, and both players then see
// "Message unsent" in its place.
export async function unsendDirectMessage(messageId, mediaPath = null) {
  if (DEMO_MODE) return new Date().toISOString();
  const client = requireSupabase();
  const { data, error } = await client.rpc('unsend_direct_message', { p_message_id: messageId });
  if (error) throw deleteError(error);
  // The message no longer points at the file, so removing it is best effort.
  if (mediaPath) client.storage.from(DIRECT_MEDIA_BUCKET).remove([mediaPath]).catch(() => {});
  return data || null;
}

// Uploads a picked photo or video, or a recorded voice message, into this
// conversation's folder, then sends it. A failed send removes the upload so no orphaned file is left behind.
export async function sendDirectMediaMessage(conversationId, asset, type) {
  const client = requireSupabase();
  const uploaded = await uploadChatMedia(DIRECT_MEDIA_BUCKET, (userId) => `${conversationId}/${userId}`, asset, type, 'Private');
  const { data, error } = await client.rpc('send_direct_media_message', {
    p_conversation_id: conversationId,
    p_media_path: uploaded.path,
    p_media_type: uploaded.type,
    p_media_mime: uploaded.mime,
    p_media_size: uploaded.size,
    p_media_name: uploaded.name,
    // Picker and recorder durations are both in milliseconds.
    p_media_duration_ms: Number.isFinite(asset.duration) ? Math.min(600000, Math.round(asset.duration)) : null,
  });
  if (error) {
    client.storage.from(DIRECT_MEDIA_BUCKET).remove([uploaded.path]).catch(() => {});
    if (['PGRST202', '42883'].includes(error.code)) throw new Error('Sending photos and videos is not available yet. Please try again after the next update.');
    throw error;
  }
  return getDirectMessage(data);
}

// Delete for you: hides the message from this player only.
export async function hideDirectMessage(messageId) {
  if (DEMO_MODE) return;
  const { error } = await requireSupabase().rpc('hide_direct_message', { p_message_id: messageId });
  if (error) throw deleteError(error);
}

export async function respondDirectMessageRequest(conversationId, accept) {
  const { data, error } = await requireSupabase().rpc('respond_direct_message_request', {
    p_conversation_id: conversationId,
    p_accept: Boolean(accept),
  });
  if (error) throw error;
  return data;
}

export async function markDirectConversationRead(conversationId) {
  if (DEMO_MODE) return;
  const { error } = await requireSupabase().rpc('mark_direct_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function reportDirectMessage(messageId, reason, details = '') {
  const { data, error } = await requireSupabase().rpc('report_direct_message', {
    p_message_id: messageId,
    p_reason: reason,
    p_details: details.trim() || null,
  });
  if (error) throw error;
  return data;
}
