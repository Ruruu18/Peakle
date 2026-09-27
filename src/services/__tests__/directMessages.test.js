import { requireSupabase } from '../../lib/supabase';
import {
  normalizeDirectConversation,
  normalizeDirectMessage,
  listDirectConversations,
  listFollowingPlayers,
  listFollowerPlayers,
  listPrivateConnections,
  getDirectConversation,
  findDirectConversation,
  listDirectMessages,
  getDirectMessage,
  muteDirectConversation,
  unmuteDirectConversation,
  setDirectConversationArchived,
  deleteDirectConversationForMe,
  isMuteActive,
  muteStatusLabel,
  startDirectConversation,
  getDirectMessagePermission,
  getPlayerFollowCounts,
  getPublicPlayerProfile,
  getPlayerMutualConnections,
  searchDirectMessageCandidates,
  followPlayer,
  unfollowPlayer,
  dismissPlayerSuggestion,
  listPlayerSuggestions,
  respondFollowRequest,
  sendDirectMessage,
  toggleDirectMessageReaction,
  respondDirectMessageRequest,
  markDirectConversationRead,
  reportDirectMessage,
  unsendDirectMessage,
  hideDirectMessage,
  sendDirectMediaMessage,
} from '../directMessages';
import { uploadChatMedia } from '../database';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('../database', () => ({ uploadChatMedia: jest.fn() }));

// Mirrors the exact select strings built in directMessages.js so tests can
// assert each fallback drops only the missing part (reactions or unsend).
const MESSAGE_SELECT_CORE = 'id, conversation_id, sender_id, body, created_at, profiles!direct_messages_sender_id_fkey(display_name, avatar_url)';
const MESSAGE_MEDIA_COLUMNS = ', deleted_at, media_path, media_type, media_mime, media_name, media_duration_ms';
const MESSAGE_SELECT_FULL = `${MESSAGE_SELECT_CORE}, direct_message_reactions(emoji, user_id)${MESSAGE_MEDIA_COLUMNS}`;
const MESSAGE_SELECT_BASE = `${MESSAGE_SELECT_CORE}${MESSAGE_MEDIA_COLUMNS}`;
const MESSAGE_SELECT_UNSEND_ONLY = `${MESSAGE_SELECT_CORE}, direct_message_reactions(emoji, user_id), deleted_at`;
// listDirectMessages reads settings, then this player's hidden messages, then the messages.
const noHides = () => makeQueryBuilder({ data: [], error: null });

// Mimics the real supabase-js query builder: every filter/chain method
// returns the same object, and awaiting it (or calling a terminal method
// like maybeSingle()) resolves to the given { data, error } (or
// { count, error }) result — exactly like the real thenable builder.
function makeQueryBuilder(result) {
  const builder = {};
  ['select', 'eq', 'gt', 'in', 'order', 'limit'].forEach((method) => {
    builder[method] = jest.fn(() => builder);
  });
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient({ authUser = { id: 'me' }, authError = null } = {}) {
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: authUser }, error: authError })) },
    from: jest.fn(),
    rpc: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeDirectConversation', () => {
  it('returns null for a missing row', () => {
    expect(normalizeDirectConversation(null)).toBeNull();
  });

  it('maps every field from a fully-populated row', () => {
    const row = {
      conversation_id: 'c1',
      peer_id: 'p1',
      peer_name: 'Dana Lim',
      peer_avatar_url: 'https://x/a.png',
      peer_home_area: 'Makati',
      status: 'accepted',
      requester_id: 'me',
      accepted_at: '2026-08-10T00:00:00Z',
      created_at: '2026-08-09T00:00:00Z',
      last_message_at: '2026-08-10T01:00:00Z',
      last_body: 'hey there',
      last_sender_id: 'p1',
      unread_count: '3',
      peer_last_read_at: '2026-08-10T00:30:00Z',
      blocked_by_me: 1,
      blocked_me: 0,
    };
    expect(normalizeDirectConversation(row)).toEqual({
      id: 'c1',
      peer: { id: 'p1', name: 'Dana Lim', avatar: 'https://x/a.png', area: 'Makati' },
      status: 'accepted',
      requesterId: 'me',
      acceptedAt: '2026-08-10T00:00:00Z',
      createdAt: '2026-08-09T00:00:00Z',
      lastMessageAt: '2026-08-10T01:00:00Z',
      lastBody: 'hey there',
      lastSenderId: 'p1',
      unreadCount: 3,
      peerLastReadAt: '2026-08-10T00:30:00Z',
      blockedByMe: true,
      blockedMe: false,
    });
  });

  it('applies fallbacks for a sparse row: peer name, unread count, and last-message-at', () => {
    const row = { conversation_id: 'c1', peer_id: 'p1', last_created_at: '2026-08-01T00:00:00Z' };
    const normalized = normalizeDirectConversation(row);
    expect(normalized.peer.name).toBe('Peakle player');
    expect(normalized.peer.avatar).toBeNull();
    expect(normalized.peer.area).toBeNull();
    expect(normalized.acceptedAt).toBeNull();
    expect(normalized.createdAt).toBeNull();
    expect(normalized.lastMessageAt).toBe('2026-08-01T00:00:00Z');
    expect(normalized.lastBody).toBeNull();
    expect(normalized.unreadCount).toBe(0);
    expect(normalized.blockedByMe).toBe(false);
    expect(normalized.blockedMe).toBe(false);
  });

  it('prefers last_message_at over last_created_at when both are present', () => {
    const row = { last_message_at: 'A', last_created_at: 'B' };
    expect(normalizeDirectConversation(row).lastMessageAt).toBe('A');
  });
});

describe('normalizeDirectMessage', () => {
  it('returns null for a missing row', () => {
    expect(normalizeDirectMessage(null, 'me')).toBeNull();
  });

  it('blanks the text of an unsent message and keeps when it was unsent', () => {
    const message = normalizeDirectMessage({ id: 'm1', sender_id: 'p1', body: null, deleted_at: '2026-09-26T10:00:00Z', created_at: '2026-09-26T09:00:00Z' }, 'me');
    expect(message.text).toBeNull();
    expect(message.deletedAt).toBe('2026-09-26T10:00:00Z');
  });

  it('uses the sender profile name and marks the message as mine', () => {
    const row = {
      id: 'm1',
      conversation_id: 'c1',
      sender_id: 'me',
      body: 'hello',
      created_at: '2026-08-10T12:00:00Z',
      profiles: { display_name: 'Me Myself', avatar_url: 'https://x/me.png' },
      direct_message_reactions: [{ emoji: '👍', user_id: 'p1' }],
    };
    const mapped = normalizeDirectMessage(row, 'me');
    expect(mapped.id).toBe('m1');
    expect(mapped.conversationId).toBe('c1');
    expect(mapped.senderId).toBe('me');
    expect(mapped.sender).toBe('Me Myself');
    expect(mapped.avatar).toBe('https://x/me.png');
    expect(mapped.mine).toBe(true);
    expect(mapped.text).toBe('hello');
    expect(mapped.reactions).toEqual([{ emoji: '👍', user_id: 'p1' }]);
    expect(mapped.time).toBe(new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  });

  it('falls back to "You" for the current user with no profile name, and marks it as not mine for someone else', () => {
    const base = { id: 'm1', sender_id: 'me', body: 'hi', created_at: '2026-08-10T12:00:00Z' };
    expect(normalizeDirectMessage(base, 'me').sender).toBe('You');
    expect(normalizeDirectMessage(base, 'me').mine).toBe(true);

    const fromSomeoneElse = { ...base, sender_id: 'p1' };
    expect(normalizeDirectMessage(fromSomeoneElse, 'me').sender).toBe('Peakle player');
    expect(normalizeDirectMessage(fromSomeoneElse, 'me').mine).toBe(false);
  });

  it('defaults reactions to an empty array and avatar to null when absent', () => {
    const mapped = normalizeDirectMessage({ id: 'm1', sender_id: 'p1', body: 'x', created_at: '2026-08-10T12:00:00Z' }, 'me');
    expect(mapped.reactions).toEqual([]);
    expect(mapped.avatar).toBeNull();
  });
});

describe('listDirectConversations', () => {
  const withSettings = (rows, settings = { data: [], error: null }) => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: rows, error: null });
    client.from.mockReturnValue(makeQueryBuilder(settings));
    requireSupabase.mockReturnValue(client);
    return client;
  };

  it('maps every row returned by the RPC', async () => {
    const client = withSettings([{ conversation_id: 'c1' }, { conversation_id: 'c2' }]);
    const result = await listDirectConversations();
    expect(client.rpc).toHaveBeenCalledWith('list_direct_conversations');
    expect(client.from).toHaveBeenCalledWith('direct_conversation_settings');
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result[0]).toEqual(expect.objectContaining({ archived: false, deleted: false, muted: false }));
  });

  it('propagates an RPC error', async () => {
    const client = withSettings(null);
    client.rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(listDirectConversations()).rejects.toThrow('boom');
  });

  it('applies archive, delete-for-me, and mute until a newer message arrives', async () => {
    withSettings([
      { conversation_id: 'archived', last_created_at: '2026-09-26T08:00:00Z' },
      { conversation_id: 'revived', last_created_at: '2026-09-26T09:00:00Z' },
      { conversation_id: 'deleted', last_created_at: '2026-09-26T08:00:00Z' },
      { conversation_id: 'muted', last_created_at: '2026-09-26T08:00:00Z' },
    ], {
      data: [
        { conversation_id: 'archived', archived_at: '2026-09-26T08:30:00Z' },
        { conversation_id: 'revived', archived_at: '2026-09-26T08:30:00Z', cleared_at: '2026-09-26T08:30:00Z' },
        { conversation_id: 'deleted', cleared_at: '2026-09-26T08:30:00Z' },
        { conversation_id: 'muted', muted_until: 'infinity' },
      ],
      error: null,
    });
    const result = await listDirectConversations();
    const byId = Object.fromEntries(result.map((c) => [c.id, c]));
    expect(Object.keys(byId)).toEqual(['archived', 'revived', 'muted']);
    expect(byId.archived.archived).toBe(true);
    expect(byId.revived.archived).toBe(false);
    expect(byId.muted.muted).toBe(true);
  });

  it('treats a missing settings table as no settings', async () => {
    withSettings([{ conversation_id: 'c1' }], { data: null, error: { code: '42P01' } });
    await expect(listDirectConversations()).resolves.toEqual([expect.objectContaining({ id: 'c1', archived: false })]);
  });
});

describe('conversation inbox controls', () => {
  it('mutes for a number of minutes, or until turned back on', async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: '2026-09-26T09:00:00Z', error: null });
    requireSupabase.mockReturnValue(client);
    await muteDirectConversation('c1', 15);
    expect(client.rpc).toHaveBeenCalledWith('set_direct_conversation_muted', { p_conversation_id: 'c1', p_muted: true, p_minutes: 15 });
    await muteDirectConversation('c1');
    expect(client.rpc).toHaveBeenLastCalledWith('set_direct_conversation_muted', { p_conversation_id: 'c1', p_muted: true, p_minutes: null });
    await unmuteDirectConversation('c1');
    expect(client.rpc).toHaveBeenLastCalledWith('set_direct_conversation_muted', { p_conversation_id: 'c1', p_muted: false });
  });

  it('archives and deletes through their RPCs', async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: 'now', error: null });
    requireSupabase.mockReturnValue(client);
    await setDirectConversationArchived('c1', true);
    expect(client.rpc).toHaveBeenCalledWith('set_direct_conversation_archived', { p_conversation_id: 'c1', p_archived: true });
    await deleteDirectConversationForMe('c1');
    expect(client.rpc).toHaveBeenLastCalledWith('delete_direct_conversation_for_me', { p_conversation_id: 'c1' });
  });

  it('explains when the backend has not been updated yet', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: { code: 'PGRST202' } })) });
    await expect(deleteDirectConversationForMe('c1')).rejects.toThrow('not available yet');
  });

  it('reads mute state, including mutes that never expire', () => {
    const now = Date.parse('2026-09-26T08:00:00Z');
    expect(isMuteActive(null, now)).toBe(false);
    expect(isMuteActive('infinity', now)).toBe(true);
    expect(isMuteActive('2026-09-26T08:15:00Z', now)).toBe(true);
    expect(isMuteActive('2026-09-26T07:59:00Z', now)).toBe(false);
    expect(muteStatusLabel('infinity', now)).toBe('Muted until you turn it back on');
    expect(muteStatusLabel('2026-09-26T07:59:00Z', now)).toBeNull();
  });
});

describe('listFollowingPlayers / listFollowerPlayers (follow-graph hydration)', () => {
  it('propagates an auth error', async () => {
    const client = makeClient({ authError: new Error('no session') });
    requireSupabase.mockReturnValue(client);
    await expect(listFollowingPlayers()).rejects.toThrow('no session');
  });

  it('returns an empty list when there is no signed-in user, without querying follows', async () => {
    const client = makeClient({ authUser: null });
    requireSupabase.mockReturnValue(client);
    const result = await listFollowingPlayers();
    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('dedupes relationship ids, hydrates profiles, and preserves relationship order (following)', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const relationships = makeQueryBuilder({
      data: [
        { followed_id: 'p2', created_at: '2026-08-02T00:00:00Z' },
        { followed_id: 'p1', created_at: '2026-08-01T00:00:00Z' },
        { followed_id: 'p2', created_at: '2026-08-03T00:00:00Z' }, // duplicate id
      ],
      error: null,
    });
    const profiles = makeQueryBuilder({
      data: [
        { id: 'p1', display_name: 'Alex', avatar_url: 'a.png', home_area: 'BGC', presence_status: 'playing' },
        { id: 'p2', avatar_url: null, home_area: null, presence_status: null },
      ],
      error: null,
    });
    client.from.mockReturnValueOnce(relationships).mockReturnValueOnce(profiles);
    client.rpc.mockResolvedValueOnce({ data: [{ user_id: 'p1', is_online: true }, { user_id: 'p2', is_online: false, last_active_at: '2026-09-26T08:00:00Z' }], error: null });
    requireSupabase.mockReturnValue(client);

    const result = await listFollowingPlayers();

    expect(client.from).toHaveBeenNthCalledWith(1, 'player_follows');
    expect(relationships.eq).toHaveBeenCalledWith('follower_id', 'me');
    expect(client.from).toHaveBeenNthCalledWith(2, 'profiles');
    expect(profiles.in).toHaveBeenCalledWith('id', ['p2', 'p1']);
    // Relationship order is preserved (p2, p1, p2), each hydrated to a profile.
    expect(client.rpc).toHaveBeenCalledWith('get_player_activity', { p_player_ids: ['p2', 'p1'] });
    expect(result.map((p) => p.id)).toEqual(['p2', 'p1', 'p2']);
    expect(result[0]).toEqual({ id: 'p2', name: 'Peakle player', avatar: null, area: null, playerStatus: 'free', isOnline: false, lastActiveAt: '2026-09-26T08:00:00Z' });
    expect(result[1]).toEqual({ id: 'p1', name: 'Alex', avatar: 'a.png', area: 'BGC', playerStatus: 'playing', isOnline: true, lastActiveAt: null });
  });

  it('follower_id is used as the relationship key for listFollowerPlayers', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const relationships = makeQueryBuilder({ data: [{ follower_id: 'p9', created_at: 'x' }], error: null });
    const profiles = makeQueryBuilder({ data: [{ id: 'p9', display_name: 'Sam' }], error: null });
    client.from.mockReturnValueOnce(relationships).mockReturnValueOnce(profiles);
    requireSupabase.mockReturnValue(client);

    const result = await listFollowerPlayers();
    expect(relationships.eq).toHaveBeenCalledWith('followed_id', 'me');
    expect(profiles.in).toHaveBeenCalledWith('id', ['p9']);
    // Activity lookup failures leave players offline instead of failing the list.
    expect(result).toEqual([{ id: 'p9', name: 'Sam', avatar: null, area: null, playerStatus: 'free', isOnline: false, lastActiveAt: null }]);
  });

  it('propagates a profile-lookup error', async () => {
    const client = makeClient();
    client.from
      .mockReturnValueOnce(makeQueryBuilder({ data: [{ followed_id: 'p1' }], error: null }))
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: new Error('profiles rls') }));
    requireSupabase.mockReturnValue(client);
    await expect(listFollowingPlayers()).rejects.toThrow('profiles rls');
  });

  it('batches profile lookups in chunks of 100 ids', async () => {
    const client = makeClient();
    const relationshipRows = Array.from({ length: 150 }, (_, i) => ({ followed_id: `p${i}`, created_at: 'x' }));
    const relationships = makeQueryBuilder({ data: relationshipRows, error: null });
    const chunk1 = makeQueryBuilder({ data: [], error: null });
    const chunk2 = makeQueryBuilder({ data: [], error: null });
    client.from.mockReturnValueOnce(relationships).mockReturnValueOnce(chunk1).mockReturnValueOnce(chunk2);
    requireSupabase.mockReturnValue(client);

    await listFollowingPlayers();

    expect(client.from).toHaveBeenCalledTimes(3);
    expect(chunk1.in).toHaveBeenCalledWith('id', relationshipRows.slice(0, 100).map((r) => r.followed_id));
    expect(chunk2.in).toHaveBeenCalledWith('id', relationshipRows.slice(100, 150).map((r) => r.followed_id));
  });
});

describe('listPrivateConnections (mutual follows)', () => {
  it('propagates an auth error', async () => {
    requireSupabase.mockReturnValue(makeClient({ authError: new Error('no session') }));
    await expect(listPrivateConnections()).rejects.toThrow('no session');
  });

  it('returns an empty list with no signed-in user', async () => {
    const client = makeClient({ authUser: null });
    requireSupabase.mockReturnValue(client);
    expect(await listPrivateConnections()).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('keeps only mutual follows that also resolved a profile', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const following = makeQueryBuilder({
      data: [
        { followed_id: 'p1', created_at: '2026-08-01T00:00:00Z', profile: { id: 'p1', display_name: 'Alex', avatar_url: 'a.png', home_area: 'BGC' } },
        { followed_id: 'p2', created_at: '2026-08-02T00:00:00Z', profile: { id: 'p2', display_name: 'Not mutual' } }, // not a follower
        { followed_id: 'p3', created_at: '2026-08-03T00:00:00Z', profile: null }, // no profile
      ],
      error: null,
    });
    const followers = makeQueryBuilder({ data: [{ follower_id: 'p1' }, { follower_id: 'p3' }], error: null });
    client.from.mockReturnValueOnce(following).mockReturnValueOnce(followers);
    requireSupabase.mockReturnValue(client);

    const result = await listPrivateConnections();
    expect(result).toEqual([{ id: 'p1', name: 'Alex', avatar: 'a.png', area: 'BGC', connectedAt: '2026-08-01T00:00:00Z' }]);
  });

  it('propagates an error from either query', async () => {
    const client = makeClient();
    client.from
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: new Error('following failed') }))
      .mockReturnValueOnce(makeQueryBuilder({ data: [], error: null }));
    requireSupabase.mockReturnValue(client);
    await expect(listPrivateConnections()).rejects.toThrow('following failed');
  });
});

describe('getDirectConversation / findDirectConversation', () => {
  it('returns null without calling supabase when no id/playerId is given', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await getDirectConversation(null)).toBeNull();
    expect(await findDirectConversation(undefined)).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('unwraps the first row of an array response and normalizes it', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ conversation_id: 'c1' }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await getDirectConversation('c1');
    expect(client.rpc).toHaveBeenCalledWith('get_direct_conversation', { p_conversation_id: 'c1' });
    expect(result.id).toBe('c1');
  });

  it('finds a conversation by player id', async () => {
    const client = { rpc: jest.fn(async () => ({ data: { conversation_id: 'c2' }, error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await findDirectConversation('p1');
    expect(client.rpc).toHaveBeenCalledWith('find_direct_conversation', { p_player_id: 'p1' });
    expect(result.id).toBe('c2');
  });

  it('propagates RPC errors', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('nope') })) });
    await expect(getDirectConversation('c1')).rejects.toThrow('nope');
    await expect(findDirectConversation('p1')).rejects.toThrow('nope');
  });
});

describe('listDirectMessages (reactions-schema fallback)', () => {
  it('maps messages using the full select, tagging mine vs. not mine from the signed-in user', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const builder = makeQueryBuilder({
      data: [{ id: 'm1', sender_id: 'me', body: 'hi', created_at: '2026-08-10T12:00:00Z' }],
      error: null,
    });
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: null })).mockReturnValueOnce(noHides()).mockReturnValueOnce(builder);
    requireSupabase.mockReturnValue(client);

    const result = await listDirectMessages('c1');
    expect(client.from).toHaveBeenNthCalledWith(1, 'direct_conversation_settings');
    expect(client.from).toHaveBeenNthCalledWith(2, 'direct_message_hides');
    expect(client.from).toHaveBeenCalledTimes(3);
    expect(builder.gt).not.toHaveBeenCalled();
    expect(builder.select).toHaveBeenCalledWith(MESSAGE_SELECT_FULL);
    expect(builder.eq).toHaveBeenCalledWith('conversation_id', 'c1');
    expect(builder.limit).toHaveBeenCalledWith(150);
    expect(result[0].mine).toBe(true);
  });

  it('falls back to the reactions-free select when the schema is missing (42P01), and returns empty reactions', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const failing = makeQueryBuilder({ data: null, error: { code: '42P01', message: 'relation missing' } });
    const fallback = makeQueryBuilder({
      data: [{ id: 'm1', sender_id: 'p1', body: 'hi', created_at: '2026-08-10T12:00:00Z' }],
      error: null,
    });
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: null })).mockReturnValueOnce(noHides()).mockReturnValueOnce(failing).mockReturnValueOnce(fallback);
    requireSupabase.mockReturnValue(client);

    const result = await listDirectMessages('c1');
    expect(client.from).toHaveBeenCalledTimes(4);
    expect(fallback.select).toHaveBeenCalledWith(MESSAGE_SELECT_BASE);
    expect(fallback.eq).toHaveBeenCalledWith('conversation_id', 'c1');
    expect(result[0].reactions).toEqual([]);
  });

  it.each(['PGRST200', 'PGRST205'])('also falls back for %s', async (code) => {
    const client = makeClient();
    const failing = makeQueryBuilder({ data: null, error: { code } });
    const fallback = makeQueryBuilder({ data: [], error: null });
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: null })).mockReturnValueOnce(noHides()).mockReturnValueOnce(failing).mockReturnValueOnce(fallback);
    requireSupabase.mockReturnValue(client);
    await expect(listDirectMessages('c1')).resolves.toEqual([]);
    expect(client.from).toHaveBeenCalledTimes(4);
  });

  it('throws immediately on a real error without attempting the fallback', async () => {
    const client = makeClient();
    const failing = makeQueryBuilder({ data: null, error: new Error('rls denied') });
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: null })).mockReturnValueOnce(noHides()).mockReturnValueOnce(failing);
    requireSupabase.mockReturnValue(client);
    await expect(listDirectMessages('c1')).rejects.toThrow('rls denied');
    expect(client.from).toHaveBeenCalledTimes(3);
  });

  it('only loads messages newer than a delete-for-me', async () => {
    const client = makeClient();
    const settings = makeQueryBuilder({ data: { cleared_at: '2026-09-26T08:00:00Z' }, error: null });
    const builder = makeQueryBuilder({ data: [], error: null });
    client.from.mockReturnValueOnce(settings).mockReturnValueOnce(noHides()).mockReturnValueOnce(builder);
    requireSupabase.mockReturnValue(client);
    await listDirectMessages('c1');
    expect(settings.eq).toHaveBeenCalledWith('conversation_id', 'c1');
    expect(builder.gt).toHaveBeenCalledWith('created_at', '2026-09-26T08:00:00Z');
  });

  it('still throws when the fallback query itself errors', async () => {
    const client = makeClient();
    client.from
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: null }))
      .mockReturnValueOnce(noHides())
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: { code: '42P01' } }))
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: new Error('fallback also failed') }));
    requireSupabase.mockReturnValue(client);
    await expect(listDirectMessages('c1')).rejects.toThrow('fallback also failed');
  });
});

describe('listDirectMessages (per-message delete)', () => {
  it('drops only the media columns when they are missing (42703)', async () => {
    const client = makeClient();
    const failing = makeQueryBuilder({ data: null, error: { code: '42703' } });
    const fallback = makeQueryBuilder({ data: [], error: null });
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: null })).mockReturnValueOnce(noHides()).mockReturnValueOnce(failing).mockReturnValueOnce(fallback);
    requireSupabase.mockReturnValue(client);
    await listDirectMessages('c1');
    expect(failing.select).toHaveBeenCalledWith(MESSAGE_SELECT_FULL);
    expect(fallback.select).toHaveBeenCalledWith(MESSAGE_SELECT_UNSEND_ONLY);
  });

  it('leaves out messages this player deleted for themselves', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const hides = makeQueryBuilder({ data: [{ message_id: 'm1' }], error: null });
    const builder = makeQueryBuilder({
      data: [
        { id: 'm1', sender_id: 'p1', body: 'hidden', created_at: '2026-09-26T10:00:00Z' },
        { id: 'm2', sender_id: 'p1', body: 'kept', created_at: '2026-09-26T10:01:00Z' },
      ],
      error: null,
    });
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: null })).mockReturnValueOnce(hides).mockReturnValueOnce(builder);
    requireSupabase.mockReturnValue(client);
    const result = await listDirectMessages('c1');
    expect(hides.eq).toHaveBeenCalledWith('direct_messages.conversation_id', 'c1');
    expect(result.map((message) => message.id)).toEqual(['m2']);
  });

  it('shows every message when the hides table is not deployed yet', async () => {
    const client = makeClient();
    const builder = makeQueryBuilder({ data: [{ id: 'm1', sender_id: 'p1', body: 'hi', created_at: '2026-09-26T10:00:00Z' }], error: null });
    client.from
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: null }))
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: { code: 'PGRST205' } }))
      .mockReturnValueOnce(builder);
    requireSupabase.mockReturnValue(client);
    await expect(listDirectMessages('c1')).resolves.toHaveLength(1);
  });
});

describe('getDirectMessage (reactions-schema fallback)', () => {
  it('fetches a single message by id with the full select', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const builder = makeQueryBuilder({ data: { id: 'm1', sender_id: 'me', body: 'hi', created_at: '2026-08-10T12:00:00Z' }, error: null });
    client.from.mockReturnValueOnce(builder);
    requireSupabase.mockReturnValue(client);

    const result = await getDirectMessage('m1');
    expect(builder.select).toHaveBeenCalledWith(MESSAGE_SELECT_FULL);
    expect(builder.eq).toHaveBeenCalledWith('id', 'm1');
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(result.id).toBe('m1');
  });

  it('falls back to the reactions-free select on a missing-schema error code', async () => {
    const client = makeClient();
    const failing = makeQueryBuilder({ data: null, error: { code: 'PGRST205' } });
    const fallback = makeQueryBuilder({ data: { id: 'm1', sender_id: 'p1', body: 'hi', created_at: '2026-08-10T12:00:00Z' }, error: null });
    client.from.mockReturnValueOnce(failing).mockReturnValueOnce(fallback);
    requireSupabase.mockReturnValue(client);

    const result = await getDirectMessage('m1');
    expect(fallback.select).toHaveBeenCalledWith(MESSAGE_SELECT_BASE);
    expect(result.reactions).toEqual([]);
  });

  it('propagates a genuine error without falling back', async () => {
    const client = makeClient();
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: new Error('not found') }));
    requireSupabase.mockReturnValue(client);
    await expect(getDirectMessage('m1')).rejects.toThrow('not found');
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});

describe('startDirectConversation', () => {
  it('trims the body and maps the RPC result', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ conversation_id: 'c1', message_id: 'm1', conversation_status: 'pending' }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await startDirectConversation('p1', '  hello there  ');
    expect(client.rpc).toHaveBeenCalledWith('start_direct_conversation', { p_player_id: 'p1', p_body: 'hello there' });
    expect(result).toEqual({ conversationId: 'c1', messageId: 'm1', status: 'pending' });
  });

  it('propagates an RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('blocked') })) });
    await expect(startDirectConversation('p1', 'hi')).rejects.toThrow('blocked');
  });
});

describe('getDirectMessagePermission', () => {
  it('returns null without calling supabase when there is no playerId', async () => {
    const client = makeClient();
    requireSupabase.mockReturnValue(client);
    expect(await getDirectMessagePermission(null)).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('merges the pending-follow-request state into the normalized permission', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => ({
      data: [{ is_following: true, follows_you: false, shares_team: true, has_existing_conversation: true, peer_chat_eligible: null, blocked: false, can_message: true }],
      error: null,
    }));
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: [{ recipient_id: 'p1' }], error: null }));
    requireSupabase.mockReturnValue(client);

    const result = await getDirectMessagePermission('p1');
    expect(client.rpc).toHaveBeenCalledWith('get_direct_message_permission', { p_player_id: 'p1' });
    expect(result).toEqual({
      isFollowing: true,
      followsYou: false,
      followRequestPending: true,
      sharesTeam: true,
      hasExistingConversation: true,
      peerChatEligible: null,
      blocked: false,
      canMessage: true,
    });
  });

  it('treats peer_chat_eligible as a real boolean (not null-coalesced) when present', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => ({ data: [{ peer_chat_eligible: false }], error: null }));
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: [], error: null }));
    requireSupabase.mockReturnValue(client);
    const result = await getDirectMessagePermission('p1');
    expect(result.peerChatEligible).toBe(false);
  });

  it('treats an unauthenticated caller as having no pending request, without throwing', async () => {
    const client = makeClient({ authUser: null });
    client.rpc = jest.fn(async () => ({ data: [{ is_following: false }], error: null }));
    requireSupabase.mockReturnValue(client);
    const result = await getDirectMessagePermission('p1');
    expect(result.followRequestPending).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('propagates a permission RPC error', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: null, error: new Error('denied') }));
    client.from.mockReturnValue(makeQueryBuilder({ data: [], error: null }));
    requireSupabase.mockReturnValue(client);
    await expect(getDirectMessagePermission('p1')).rejects.toThrow('denied');
  });
});

describe('getPlayerFollowCounts', () => {
  it('returns the counts from the RPC row', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ followers: '5', following: '2' }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await getPlayerFollowCounts('p1');
    expect(client.rpc).toHaveBeenCalledWith('get_player_follow_counts', { p_player_id: 'p1' });
    expect(result).toEqual({ followers: 5, following: 2 });
  });

  it('defaults missing counts to 0', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: [{}], error: null })) });
    expect(await getPlayerFollowCounts()).toEqual({ followers: 0, following: 0 });
  });

  it('falls back to manual counting for the caller\'s own profile when the RPC is not deployed yet (PGRST202)', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => ({ data: null, error: { code: 'PGRST202' } }));
    const followers = makeQueryBuilder({ count: 7, error: null });
    const following = makeQueryBuilder({ count: 3, error: null });
    client.from.mockReturnValueOnce(followers).mockReturnValueOnce(following);
    requireSupabase.mockReturnValue(client);

    const result = await getPlayerFollowCounts();
    expect(followers.eq).toHaveBeenCalledWith('followed_id', 'me');
    expect(following.eq).toHaveBeenCalledWith('follower_id', 'me');
    expect(result).toEqual({ followers: 7, following: 3 });
  });

  it('does not fall back when a specific playerId was requested, even on PGRST202', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: null, error: { code: 'PGRST202' } }));
    requireSupabase.mockReturnValue(client);
    await expect(getPlayerFollowCounts('someone-else')).rejects.toMatchObject({ code: 'PGRST202' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('propagates a non-PGRST202 error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('server error') })) });
    await expect(getPlayerFollowCounts()).rejects.toThrow('server error');
  });

  it('propagates an auth error during the fallback', async () => {
    const client = makeClient({ authError: new Error('session expired') });
    client.rpc = jest.fn(async () => ({ data: null, error: { code: 'PGRST202' } }));
    requireSupabase.mockReturnValue(client);
    await expect(getPlayerFollowCounts()).rejects.toThrow('session expired');
  });

  it('throws the original RPC error during the fallback when there is no signed-in user', async () => {
    const client = makeClient({ authUser: null });
    const originalError = { code: 'PGRST202', message: 'not deployed' };
    client.rpc = jest.fn(async () => ({ data: null, error: originalError }));
    requireSupabase.mockReturnValue(client);
    await expect(getPlayerFollowCounts()).rejects.toBe(originalError);
  });

  it('propagates a count-query error from the fallback', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => ({ data: null, error: { code: 'PGRST202' } }));
    client.from
      .mockReturnValueOnce(makeQueryBuilder({ count: null, error: new Error('followers count failed') }))
      .mockReturnValueOnce(makeQueryBuilder({ count: 0, error: null }));
    requireSupabase.mockReturnValue(client);
    await expect(getPlayerFollowCounts()).rejects.toThrow('followers count failed');
  });
});

describe('getPublicPlayerProfile', () => {
  it('returns null without calling supabase when there is no playerId', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await getPublicPlayerProfile(null)).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('maps a found profile, coercing a numeric skill rating and defaulting missing fields', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ id: 'p1', skill_rating: '3.5' }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await getPublicPlayerProfile('p1');
    expect(client.rpc).toHaveBeenCalledWith('get_public_player_profile', { p_player_id: 'p1' });
    expect(result).toEqual({ id: 'p1', name: 'Peakle player', avatar: null, area: null, rating: 3.5, playPreference: null });
  });

  it('keeps a null skill rating as null rather than coercing it to 0', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: [{ id: 'p1', skill_rating: null }], error: null })) });
    expect((await getPublicPlayerProfile('p1')).rating).toBeNull();
  });

  it('returns null when the RPC finds no profile', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: [], error: null })) });
    expect(await getPublicPlayerProfile('p1')).toBeNull();
  });

  it('propagates an RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('blocked') })) });
    await expect(getPublicPlayerProfile('p1')).rejects.toThrow('blocked');
  });
});

describe('getPlayerMutualConnections', () => {
  it('returns a zeroed result without calling supabase when there is no playerId', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await getPlayerMutualConnections(null)).toEqual({ count: 0, connections: [] });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('passes the default limit of 3 and maps connections', async () => {
    const client = { rpc: jest.fn(async () => ({ data: { count: 5, connections: [{ id: 'p1', display_name: 'Alex', avatar_url: 'a.png' }] }, error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await getPlayerMutualConnections('p1');
    expect(client.rpc).toHaveBeenCalledWith('get_player_mutual_connections', { p_player_id: 'p1', p_limit: 3 });
    expect(result).toEqual({ count: 5, connections: [{ id: 'p1', name: 'Alex', avatar: 'a.png' }] });
  });

  it('honors a custom limit and defaults a missing count/connections', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await getPlayerMutualConnections('p1', 10);
    expect(client.rpc).toHaveBeenCalledWith('get_player_mutual_connections', { p_player_id: 'p1', p_limit: 10 });
    expect(result).toEqual({ count: 0, connections: [] });
  });

  it('propagates an RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('nope') })) });
    await expect(getPlayerMutualConnections('p1')).rejects.toThrow('nope');
  });
});

describe('searchDirectMessageCandidates', () => {
  it('returns an empty list for a too-short query without calling supabase', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await searchDirectMessageCandidates(' a ')).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('trims the query, searches, and flags pending outgoing follow requests', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => ({
      data: [
        { id: 'p1', display_name: 'Alex', avatar_url: 'a.png', skill_rating: 4, home_area: 'BGC', is_following: false, can_message: true },
        { id: 'p2', display_name: 'Sam', avatar_url: null, skill_rating: null, home_area: null, is_following: true, can_message: true },
      ],
      error: null,
    }));
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: [{ recipient_id: 'p1' }], error: null }));
    requireSupabase.mockReturnValue(client);

    const result = await searchDirectMessageCandidates('  dana  ');
    expect(client.rpc).toHaveBeenCalledWith('search_direct_message_candidates', { p_query: 'dana' });
    expect(result[0]).toMatchObject({ id: 'p1', display_name: 'Alex', avatar_url: 'a.png', skill_rating: 4, home_area: 'BGC', followRequestPending: true, isFollowing: false, canMessage: true });
    expect(result[1]).toMatchObject({ id: 'p2', followRequestPending: false, isFollowing: true });
  });

  it('skips the follow-request lookup entirely when the search returns no candidates', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: [], error: null }));
    requireSupabase.mockReturnValue(client);
    const result = await searchDirectMessageCandidates('dana');
    expect(result).toEqual([]);
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it('propagates a search RPC error', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: null, error: new Error('search failed') }));
    requireSupabase.mockReturnValue(client);
    await expect(searchDirectMessageCandidates('dana')).rejects.toThrow('search failed');
  });
});

describe('followPlayer / unfollowPlayer', () => {
  function mockFollowGraphClient({ permissionRow, pendingRows = [] } = {}) {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async (name) => {
      if (name === 'follow_player' || name === 'unfollow_player') return { data: null, error: null };
      if (name === 'get_direct_message_permission') return { data: permissionRow ? [permissionRow] : [], error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    client.from.mockReturnValue(makeQueryBuilder({ data: pendingRows, error: null }));
    requireSupabase.mockReturnValue(client);
    return client;
  }

  it('follows a player and marks the request pending when the permission has not caught up to isFollowing yet', async () => {
    const client = mockFollowGraphClient({ permissionRow: { is_following: false } });
    const result = await followPlayer('p1');
    expect(client.rpc.mock.calls[0]).toEqual(['follow_player', { p_player_id: 'p1' }]);
    expect(result.followRequestPending).toBe(true);
  });

  it('does not mark the request pending once already following', async () => {
    const client = mockFollowGraphClient({ permissionRow: { is_following: true } });
    const result = await followPlayer('p1');
    expect(result.followRequestPending).toBe(false);
    expect(result.isFollowing).toBe(true);
  });

  it('propagates a follow RPC error without calling the permission RPC', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: null, error: new Error('already blocked') }));
    requireSupabase.mockReturnValue(client);
    await expect(followPlayer('p1')).rejects.toThrow('already blocked');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('unfollows a player and returns their refreshed permission', async () => {
    const client = mockFollowGraphClient({ permissionRow: { is_following: false, can_message: false } });
    const result = await unfollowPlayer('p1');
    expect(client.rpc.mock.calls[0]).toEqual(['unfollow_player', { p_player_id: 'p1' }]);
    expect(result.isFollowing).toBe(false);
    expect(result.canMessage).toBe(false);
  });

  it('propagates an unfollow RPC error', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: null, error: new Error('not following') }));
    requireSupabase.mockReturnValue(client);
    await expect(unfollowPlayer('p1')).rejects.toThrow('not following');
  });
});

describe('listPlayerSuggestions', () => {
  it('returns an empty list without any follow-count lookups when there are no suggestions', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [], error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await listPlayerSuggestions();
    expect(client.rpc).toHaveBeenCalledWith('get_player_suggestions', { p_limit: 8 });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('uses batched follow counts when available, and falls back to the row\'s own counts when a suggestion is missing from the batch', async () => {
    const client = { rpc: jest.fn(async (name) => {
      if (name === 'get_player_suggestions') {
        return {
          data: [
            { id: 'p1', display_name: 'Alex', avatar_url: 'a.png', home_area: 'BGC', skill_rating: '3.5', reason: 'Mutual friends', mutuals: '2' },
            { id: 'p2', display_name: 'Sam', followers: '5', following: '1' },
          ],
          error: null,
        };
      }
      if (name === 'get_player_follow_counts_batch') {
        return { data: [{ player_id: 'p1', followers: 10, following: 4 }], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }) };
    requireSupabase.mockReturnValue(client);

    const result = await listPlayerSuggestions(5);
    expect(client.rpc).toHaveBeenCalledWith('get_player_suggestions', { p_limit: 5 });
    expect(client.rpc).toHaveBeenCalledWith('get_player_follow_counts_batch', { p_player_ids: ['p1', 'p2'] });
    expect(result[0]).toEqual({ id: 'p1', name: 'Alex', avatar: 'a.png', area: 'BGC', rating: 3.5, reason: 'Mutual friends', followers: 10, following: 4, mutuals: 2, followRequestPending: false });
    // p2 was absent from the batch response, so it falls back to its own row counts.
    expect(result[1]).toMatchObject({ followers: 5, following: 1 });
  });

  it('falls back to per-player follow-count RPCs when the batch RPC errors', async () => {
    const client = { rpc: jest.fn(async (name, args) => {
      if (name === 'get_player_suggestions') return { data: [{ id: 'p1', display_name: 'Alex' }], error: null };
      if (name === 'get_player_follow_counts_batch') return { data: null, error: new Error('batch missing') };
      if (name === 'get_player_follow_counts') {
        expect(args).toEqual({ p_player_id: 'p1' });
        return { data: [{ followers: 9, following: 4 }], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }) };
    requireSupabase.mockReturnValue(client);

    const result = await listPlayerSuggestions();
    expect(result[0]).toMatchObject({ followers: 9, following: 4 });
  });

  it('propagates a suggestions RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('nope') })) });
    await expect(listPlayerSuggestions()).rejects.toThrow('nope');
  });
});

describe('respondFollowRequest', () => {
  it('rejects without calling supabase when there is no requesterId', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    await expect(respondFollowRequest(null, true)).rejects.toThrow('This follow request is unavailable.');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('coerces the accept flag to a boolean and casts the result', async () => {
    const client = { rpc: jest.fn(async () => ({ data: 1, error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await respondFollowRequest('p1', 'yes');
    expect(client.rpc).toHaveBeenCalledWith('respond_follow_request', { p_requester_id: 'p1', p_accept: true });
    expect(result).toBe(true);
  });

  it('propagates an RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('gone') })) });
    await expect(respondFollowRequest('p1', false)).rejects.toThrow('gone');
  });
});

describe('sendDirectMessage', () => {
  it('trims the body, sends it, and returns the hydrated message', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => ({ data: 'm1', error: null }));
    const fetched = makeQueryBuilder({ data: { id: 'm1', sender_id: 'me', body: 'hello', created_at: '2026-08-10T12:00:00Z' }, error: null });
    client.from.mockReturnValueOnce(fetched);
    requireSupabase.mockReturnValue(client);

    const result = await sendDirectMessage('c1', '  hello  ');
    expect(client.rpc).toHaveBeenCalledWith('send_direct_message', { p_conversation_id: 'c1', p_body: 'hello' });
    expect(fetched.eq).toHaveBeenCalledWith('id', 'm1');
    expect(result.id).toBe('m1');
    expect(result.mine).toBe(true);
  });

  it('propagates a send RPC error without fetching the message', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: null, error: new Error('conversation closed') }));
    requireSupabase.mockReturnValue(client);
    await expect(sendDirectMessage('c1', 'hi')).rejects.toThrow('conversation closed');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('toggleDirectMessageReaction', () => {
  it('toggles the reaction and re-fetches the original message id', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => ({ data: null, error: null }));
    const fetched = makeQueryBuilder({ data: { id: 'm1', sender_id: 'me', body: 'hi', created_at: '2026-08-10T12:00:00Z' }, error: null });
    client.from.mockReturnValueOnce(fetched);
    requireSupabase.mockReturnValue(client);

    const result = await toggleDirectMessageReaction('m1', '👍');
    expect(client.rpc).toHaveBeenCalledWith('toggle_direct_message_reaction', { p_message_id: 'm1', p_emoji: '👍' });
    expect(fetched.eq).toHaveBeenCalledWith('id', 'm1');
    expect(result.id).toBe('m1');
  });

  it('propagates a toggle RPC error without re-fetching', async () => {
    const client = makeClient();
    client.rpc = jest.fn(async () => ({ data: null, error: new Error('message not found') }));
    requireSupabase.mockReturnValue(client);
    await expect(toggleDirectMessageReaction('m1', '👍')).rejects.toThrow('message not found');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('respondDirectMessageRequest', () => {
  it('coerces the accept flag and returns the raw RPC data', async () => {
    const client = { rpc: jest.fn(async () => ({ data: { status: 'accepted' }, error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await respondDirectMessageRequest('c1', 1);
    expect(client.rpc).toHaveBeenCalledWith('respond_direct_message_request', { p_conversation_id: 'c1', p_accept: true });
    expect(result).toEqual({ status: 'accepted' });
  });

  it('coerces a falsy accept flag to false', async () => {
    const client = { rpc: jest.fn(async () => ({ data: { status: 'declined' }, error: null })) };
    requireSupabase.mockReturnValue(client);
    await respondDirectMessageRequest('c1', 0);
    expect(client.rpc).toHaveBeenCalledWith('respond_direct_message_request', { p_conversation_id: 'c1', p_accept: false });
  });

  it('propagates an RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('gone') })) });
    await expect(respondDirectMessageRequest('c1', true)).rejects.toThrow('gone');
  });
});

describe('markDirectConversationRead', () => {
  it('calls the RPC with the conversation id and resolves with no value', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await markDirectConversationRead('c1');
    expect(client.rpc).toHaveBeenCalledWith('mark_direct_conversation_read', { p_conversation_id: 'c1' });
    expect(result).toBeUndefined();
  });

  it('propagates an RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('nope') })) });
    await expect(markDirectConversationRead('c1')).rejects.toThrow('nope');
  });
});

describe('sendDirectMediaMessage', () => {
  const uploaded = { path: 'c1/me/v.m4a', type: 'audio', mime: 'audio/mp4', size: 2048, name: 'voice-message.m4a' };

  it('uploads into the conversation folder, then sends with the recorded duration', async () => {
    const onProgress = jest.fn();
    uploadChatMedia.mockImplementationOnce(async (...args) => {
      args[5].onProgress(1);
      return uploaded;
    });
    const client = makeClient({ authUser: { id: 'me' } });
    client.rpc = jest.fn(async () => {
      expect(onProgress).toHaveBeenLastCalledWith(0.95);
      return { data: 'm9', error: null };
    });
    client.storage = { from: jest.fn(() => ({ createSignedUrls: jest.fn(async () => ({ data: [{ signedUrl: 'https://signed/v' }], error: null })) })) };
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: { id: 'm9', sender_id: 'me', body: null, media_path: uploaded.path, media_type: 'audio', media_duration_ms: 4200, created_at: '2026-09-26T10:00:00Z' }, error: null }));
    requireSupabase.mockReturnValue(client);

    const message = await sendDirectMediaMessage('c1', { uri: 'file:///v.m4a', duration: 4200.4 }, 'audio', { onProgress });
    expect(onProgress).toHaveBeenLastCalledWith(1);
    const [bucket, folderFor, , type] = uploadChatMedia.mock.calls[0];
    expect(bucket).toBe('direct-message-media');
    expect(folderFor('me')).toBe('c1/me');
    expect(type).toBe('audio');
    expect(client.rpc).toHaveBeenCalledWith('send_direct_media_message', expect.objectContaining({
      p_conversation_id: 'c1', p_media_path: uploaded.path, p_media_type: 'audio', p_media_duration_ms: 4200,
    }));
    expect(message).toMatchObject({ id: 'm9', mediaType: 'audio', mediaUrl: 'https://signed/v', mediaDurationMs: 4200 });
  });

  it('removes the upload and explains when the send RPC is not deployed yet', async () => {
    uploadChatMedia.mockResolvedValueOnce(uploaded);
    const remove = jest.fn(() => Promise.resolve({ error: null }));
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: { code: 'PGRST202' } })), storage: { from: jest.fn(() => ({ remove })) } });
    await expect(sendDirectMediaMessage('c1', { uri: 'file:///v.m4a' }, 'audio')).rejects.toThrow('not available yet');
    expect(remove).toHaveBeenCalledWith([uploaded.path]);
  });
});

describe('unsendDirectMessage / hideDirectMessage', () => {
  it('unsends through the RPC and returns when it happened', async () => {
    const rpc = jest.fn(async () => ({ data: '2026-09-26T10:00:00Z', error: null }));
    requireSupabase.mockReturnValue({ rpc });
    await expect(unsendDirectMessage('m1')).resolves.toBe('2026-09-26T10:00:00Z');
    expect(rpc).toHaveBeenCalledWith('unsend_direct_message', { p_message_id: 'm1' });
  });

  it('hides a message for the caller through the RPC', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    requireSupabase.mockReturnValue({ rpc });
    await hideDirectMessage('m1');
    expect(rpc).toHaveBeenCalledWith('hide_direct_message', { p_message_id: 'm1' });
  });

  it('explains when the delete RPCs are not deployed yet (PGRST202)', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'missing' } })) });
    await expect(unsendDirectMessage('m1')).rejects.toThrow('Deleting messages is not available yet');
    await expect(hideDirectMessage('m1')).rejects.toThrow('Deleting messages is not available yet');
  });

  it('signs private media URLs when loading messages', async () => {
    const client = makeClient({ authUser: { id: 'me' } });
    const createSignedUrls = jest.fn(async () => ({ data: [{ signedUrl: 'https://signed/photo' }], error: null }));
    client.storage = { from: jest.fn(() => ({ createSignedUrls })) };
    const builder = makeQueryBuilder({
      data: [{ id: 'm1', sender_id: 'p1', body: null, media_path: 'c1/p1/a.jpg', media_type: 'image', media_duration_ms: null, created_at: '2026-09-26T10:00:00Z' }],
      error: null,
    });
    client.from.mockReturnValueOnce(makeQueryBuilder({ data: null, error: null })).mockReturnValueOnce(noHides()).mockReturnValueOnce(builder);
    requireSupabase.mockReturnValue(client);
    const [message] = await listDirectMessages('c1');
    expect(client.storage.from).toHaveBeenCalledWith('direct-message-media');
    expect(createSignedUrls).toHaveBeenCalledWith(['c1/p1/a.jpg'], 3600);
    expect(message).toMatchObject({ mediaType: 'image', mediaUrl: 'https://signed/photo', mediaPath: 'c1/p1/a.jpg' });
  });

  it('removes the attachment file after unsending a media message', async () => {
    const remove = jest.fn(() => Promise.resolve({ error: null }));
    const client = { rpc: jest.fn(async () => ({ data: '2026-09-26T10:00:00Z', error: null })), storage: { from: jest.fn(() => ({ remove })) } };
    requireSupabase.mockReturnValue(client);
    await unsendDirectMessage('m1', 'c1/me/a.jpg');
    expect(client.storage.from).toHaveBeenCalledWith('direct-message-media');
    expect(remove).toHaveBeenCalledWith(['c1/me/a.jpg']);
  });

  it('passes through a real error such as unsending someone else\'s message', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('Only the sender can unsend an active message.') })) });
    await expect(unsendDirectMessage('m1')).rejects.toThrow('Only the sender');
  });
});

describe('reportDirectMessage', () => {
  it('trims details before sending, and returns the raw RPC data', async () => {
    const client = { rpc: jest.fn(async () => ({ data: { id: 'report-1' }, error: null })) };
    requireSupabase.mockReturnValue(client);
    const result = await reportDirectMessage('m1', 'spam', '  extra context  ');
    expect(client.rpc).toHaveBeenCalledWith('report_direct_message', { p_message_id: 'm1', p_reason: 'spam', p_details: 'extra context' });
    expect(result).toEqual({ id: 'report-1' });
  });

  it('sends null details when none are given', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
    requireSupabase.mockReturnValue(client);
    await reportDirectMessage('m1', 'spam');
    expect(client.rpc).toHaveBeenCalledWith('report_direct_message', { p_message_id: 'm1', p_reason: 'spam', p_details: null });
  });

  it('sends null details when details are only whitespace', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
    requireSupabase.mockReturnValue(client);
    await reportDirectMessage('m1', 'spam', '   ');
    expect(client.rpc).toHaveBeenCalledWith('report_direct_message', { p_message_id: 'm1', p_reason: 'spam', p_details: null });
  });

  it('propagates an RPC error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('nope') })) });
    await expect(reportDirectMessage('m1', 'spam')).rejects.toThrow('nope');
  });
});

describe('dismissPlayerSuggestion', () => {
  it('asks the server to stop suggesting the player', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: null })) };
    requireSupabase.mockReturnValue(client);
    await dismissPlayerSuggestion('p1');
    expect(client.rpc).toHaveBeenCalledWith('dismiss_player_suggestion', { p_player_id: 'p1' });
  });

  it('does nothing without a player id', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    await dismissPlayerSuggestion(null);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('surfaces server errors', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: new Error('nope') })) };
    requireSupabase.mockReturnValue(client);
    await expect(dismissPlayerSuggestion('p1')).rejects.toThrow('nope');
  });
});
