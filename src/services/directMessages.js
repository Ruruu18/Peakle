import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';
import {
  DEMO_CONVERSATIONS, DEMO_CONVERSATION, DEMO_CONVERSATION_ID, DEMO_DIRECT_MESSAGES,
  DEMO_SUGGESTIONS, DEMO_FOLLOWING, DEMO_FOLLOW_COUNTS,
} from '../config/demoData';

const DIRECT_MESSAGE_SELECT_BASE = 'id, conversation_id, sender_id, body, created_at, profiles!direct_messages_sender_id_fkey(display_name, avatar_url)';
const DIRECT_MESSAGE_SELECT = `${DIRECT_MESSAGE_SELECT_BASE}, direct_message_reactions(emoji, user_id)`;
const reactionsSchemaMissing = (error) => ['42P01', 'PGRST200', 'PGRST205'].includes(error?.code);

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
    text: row.body,
    reactions: row.direct_message_reactions || [],
    createdAt: row.created_at,
    time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

export async function listDirectConversations() {
  if (DEMO_MODE) return DEMO_CONVERSATIONS;
  const { data, error } = await requireSupabase().rpc('list_direct_conversations');
  if (error) throw error;
  return (data || []).map(normalizeDirectConversation);
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
  const onlineIds = await getOnlinePlayerIds(client, ids);
  return relationships
    .map((relationship) => profilesById.get(relationship[idKey]))
    .filter(Boolean)
    .map((profile) => ({
      id: profile.id,
      name: profile.display_name || 'Peakle player',
      avatar: profile.avatar_url || null,
      area: profile.home_area || null,
      playerStatus: profile.presence_status || 'free',
      isOnline: onlineIds.has(profile.id),
    }));
}

// presence_status is only the player's chosen label and defaults to free, so
// the status dot is shown only for players who are using the app right now.
// Activity is non-essential: if it cannot load, everyone simply reads offline.
async function getOnlinePlayerIds(client, ids) {
  try {
    const { data, error } = await client.rpc('get_player_activity', { p_player_ids: ids });
    if (error) return new Set();
    return new Set((data || []).filter((row) => row.is_online).map((row) => row.user_id));
  } catch {
    return new Set();
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

export async function listPrivateConnections() {
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
  const { data: auth } = await client.auth.getUser();
  let { data, error } = await client.from('direct_messages')
    .select(DIRECT_MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(150);
  if (error && reactionsSchemaMissing(error)) {
    ({ data, error } = await client.from('direct_messages')
      .select(DIRECT_MESSAGE_SELECT_BASE)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(150));
  }
  if (error) throw error;
  return (data || []).map((row) => normalizeDirectMessage(row, auth.user?.id));
}

export async function getDirectMessage(messageId) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  let { data, error } = await client.from('direct_messages')
    .select(DIRECT_MESSAGE_SELECT)
    .eq('id', messageId)
    .maybeSingle();
  if (error && reactionsSchemaMissing(error)) {
    ({ data, error } = await client.from('direct_messages')
      .select(DIRECT_MESSAGE_SELECT_BASE)
      .eq('id', messageId)
      .maybeSingle());
  }
  if (error) throw error;
  return normalizeDirectMessage(data, auth.user?.id);
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
      return {
        followers: Number(followersResult.count || 0),
        following: Number(followingResult.count || 0),
      };
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    followers: Number(row?.followers || 0),
    following: Number(row?.following || 0),
  };
}

async function getPlayerFollowCountsByIds(playerIds) {
  const ids = [...new Set((playerIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const client = requireSupabase();
  const { data, error } = await client.rpc('get_player_follow_counts_batch', {
    p_player_ids: ids,
  });

  if (!error) {
    return new Map((data || []).map((row) => [row.player_id, {
      followers: Number(row.followers || 0),
      following: Number(row.following || 0),
    }]));
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
  const permission = await getDirectMessagePermission(playerId);
  return { ...permission, followRequestPending: !permission?.isFollowing };
}

export async function unfollowPlayer(playerId) {
  const { error } = await requireSupabase().rpc('unfollow_player', {
    p_player_id: playerId,
  });
  if (error) throw error;
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
