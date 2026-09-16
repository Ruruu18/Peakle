import { requireSupabase } from '../../lib/supabase';
import {
  deleteSupportChatMedia,
  getSupportConversation,
  getSupportMessage,
  listSupportConversations,
  listSupportMessages,
  markSupportConversationRead,
  normalizeSupportConversation,
  normalizeSupportMessage,
  rateSupportConversation,
  requestHumanSupport,
  sendSupportMessage,
  startSupportConversation,
  uploadSupportChatMedia,
} from '../supportChat';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

function makeThenable(result) {
  return {
    order: jest.fn(function () { return this; }),
    eq: jest.fn(function () { return this; }),
    limit: jest.fn(function () { return this; }),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
}

function mockClient({ rpcResult, selectResult, authUser = { id: 'user-1' }, signedUrls = { data: [], error: null }, storageError = null } = {}) {
  const rpc = jest.fn(() => makeThenable(rpcResult ?? { data: null, error: null }));
  const select = jest.fn(() => makeThenable(selectResult ?? { data: [], error: null }));
  const from = jest.fn(() => ({ select }));
  const createSignedUrls = jest.fn(() => Promise.resolve(signedUrls));
  const upload = jest.fn(() => Promise.resolve({ error: storageError }));
  const remove = jest.fn(() => Promise.resolve({ error: null }));
  const storageFrom = jest.fn(() => ({ createSignedUrls, upload, remove }));
  const client = {
    rpc,
    from,
    storage: { from: storageFrom },
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: authUser } })) },
  };
  requireSupabase.mockReturnValue(client);
  return { client, rpc, from, select, createSignedUrls, upload, remove };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeSupportConversation', () => {
  it('returns null for a missing row', () => {
    expect(normalizeSupportConversation(null)).toBeNull();
  });

  it('maps snake_case columns to the camelCase conversation shape, defaulting missing fields', () => {
    const row = {
      conversation_id: 'conv-1',
      status: 'bot',
      ai_handled: 1,
      needs_human: 0,
      requester_id: 'user-1',
      unread_count: '3',
    };
    expect(normalizeSupportConversation(row)).toMatchObject({
      id: 'conv-1',
      status: 'bot',
      category: null,
      aiHandled: true,
      needsHuman: false,
      assignedAgentId: null,
      requesterId: 'user-1',
      unreadCount: 3,
      csatRating: null,
    });
  });
});

describe('normalizeSupportMessage', () => {
  it('returns null for a missing row', () => {
    expect(normalizeSupportMessage(null, 'user-1')).toBeNull();
  });

  it('labels an AI message as "Peakle AI" regardless of sender id', () => {
    const row = { id: 'm1', sender_type: 'ai', sender_id: 'user-1', body: 'Hi', created_at: '2026-01-01T00:00:00Z' };
    const message = normalizeSupportMessage(row, 'user-1');
    expect(message.sender).toBe('Peakle AI');
    expect(message.mine).toBe(false);
  });

  it('labels an agent message using the sender profile display name, falling back to "Peakle support"', () => {
    const withName = normalizeSupportMessage({ id: 'm1', sender_type: 'agent', sender_id: 'agent-1', body: 'Hi', created_at: '2026-01-01T00:00:00Z', profiles: { display_name: 'Alex' } }, 'user-1');
    expect(withName.sender).toBe('Alex');

    const withoutName = normalizeSupportMessage({ id: 'm2', sender_type: 'agent', sender_id: 'agent-1', body: 'Hi', created_at: '2026-01-01T00:00:00Z' }, 'user-1');
    expect(withoutName.sender).toBe('Peakle support');
  });

  it('marks a user message as "mine" only when the sender matches the current user', () => {
    const mine = normalizeSupportMessage({ id: 'm1', sender_type: 'user', sender_id: 'user-1', body: 'Hi', created_at: '2026-01-01T00:00:00Z' }, 'user-1');
    expect(mine.mine).toBe(true);
    expect(mine.sender).toBe('You');

    const theirs = normalizeSupportMessage({ id: 'm2', sender_type: 'user', sender_id: 'user-2', body: 'Hi', created_at: '2026-01-01T00:00:00Z', profiles: { display_name: 'Jamie' } }, 'user-1');
    expect(theirs.mine).toBe(false);
    expect(theirs.sender).toBe('Jamie');
  });
});

describe('startSupportConversation', () => {
  it('trims the body and forwards optional category/media fields to the RPC', async () => {
    const { rpc } = mockClient({ rpcResult: { data: [{ conversation_id: 'conv-1', message_id: 'm1' }], error: null } });
    const result = await startSupportConversation('  Hello  ', 'Booking or payment', { path: 'p', type: 'image', name: 'n', mime: 'image/jpeg', size: 10 });
    expect(rpc).toHaveBeenCalledWith('start_support_conversation', {
      p_body: 'Hello',
      p_category: 'Booking or payment',
      p_media_path: 'p',
      p_media_type: 'image',
      p_media_name: 'n',
      p_media_mime: 'image/jpeg',
      p_media_size: 10,
    });
    expect(result).toEqual({ conversationId: 'conv-1', messageId: 'm1' });
  });

  it('throws when the RPC returns an error', async () => {
    mockClient({ rpcResult: { data: null, error: new Error('boom') } });
    await expect(startSupportConversation('Hello')).rejects.toThrow('boom');
  });
});

describe('sendSupportMessage', () => {
  it('trims the body and passes null defaults when no media is given', async () => {
    const { rpc } = mockClient({ rpcResult: { data: null, error: null } });
    await sendSupportMessage('conv-1', '  Hi there  ');
    expect(rpc).toHaveBeenCalledWith('send_support_message', {
      p_conversation_id: 'conv-1',
      p_body: 'Hi there',
      p_media_path: null,
      p_media_type: null,
      p_media_name: null,
      p_media_mime: null,
      p_media_size: null,
    });
  });
});

describe('requestHumanSupport / rateSupportConversation / markSupportConversationRead', () => {
  it('requestHumanSupport forwards the conversation id and surfaces RPC errors', async () => {
    const { rpc } = mockClient({ rpcResult: { data: null, error: null } });
    await requestHumanSupport('conv-1');
    expect(rpc).toHaveBeenCalledWith('request_human_support', { p_conversation_id: 'conv-1' });

    mockClient({ rpcResult: { data: null, error: new Error('nope') } });
    await expect(requestHumanSupport('conv-1')).rejects.toThrow('nope');
  });

  it('rateSupportConversation defaults comment to null and forwards the rating', async () => {
    const { rpc } = mockClient({ rpcResult: { data: null, error: null } });
    await rateSupportConversation('conv-1', 5);
    expect(rpc).toHaveBeenCalledWith('rate_support_conversation', { p_conversation_id: 'conv-1', p_rating: 5, p_comment: null });
  });

  it('markSupportConversationRead forwards the conversation id', async () => {
    const { rpc } = mockClient({ rpcResult: { data: null, error: null } });
    await markSupportConversationRead('conv-1');
    expect(rpc).toHaveBeenCalledWith('mark_support_conversation_read', { p_conversation_id: 'conv-1' });
  });
});

describe('listSupportConversations / getSupportConversation', () => {
  it('lists and normalizes every conversation row', async () => {
    mockClient({ rpcResult: { data: [{ conversation_id: 'conv-1', status: 'bot' }, { conversation_id: 'conv-2', status: 'open' }], error: null } });
    const result = await listSupportConversations();
    expect(result).toEqual([
      expect.objectContaining({ id: 'conv-1', status: 'bot' }),
      expect.objectContaining({ id: 'conv-2', status: 'open' }),
    ]);
  });

  it('getSupportConversation returns null without calling the RPC when no id is given', async () => {
    const { rpc } = mockClient();
    expect(await getSupportConversation(null)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('getSupportConversation unwraps an array response and normalizes it', async () => {
    mockClient({ rpcResult: { data: [{ conversation_id: 'conv-1', status: 'assigned' }], error: null } });
    const result = await getSupportConversation('conv-1');
    expect(result).toMatchObject({ id: 'conv-1', status: 'assigned' });
  });
});

describe('listSupportMessages / getSupportMessage', () => {
  it('signs media URLs for rows with a media_path and leaves the rest null', async () => {
    const rows = [
      { id: 'm1', sender_type: 'user', sender_id: 'user-1', body: 'hi', created_at: '2026-01-01T00:00:00Z', media_path: null },
      { id: 'm2', sender_type: 'user', sender_id: 'user-1', body: 'photo', created_at: '2026-01-01T00:00:00Z', media_path: 'a/b.jpg' },
    ];
    mockClient({ selectResult: { data: rows, error: null }, signedUrls: { data: [{ signedUrl: 'https://signed/a/b.jpg' }], error: null } });
    const messages = await listSupportMessages('conv-1');
    expect(messages[0].mediaUrl).toBeNull();
    expect(messages[1].mediaUrl).toBe('https://signed/a/b.jpg');
  });

  it('getSupportMessage returns null when no row is found', async () => {
    mockClient({ selectResult: { data: null, error: null } });
    expect(await getSupportMessage('missing')).toBeNull();
  });

  it('propagates a signing error from storage', async () => {
    const rows = [{ id: 'm1', sender_type: 'user', sender_id: 'user-1', body: 'photo', created_at: '2026-01-01T00:00:00Z', media_path: 'a/b.jpg' }];
    mockClient({ selectResult: { data: rows, error: null }, signedUrls: { data: null, error: new Error('sign failed') } });
    await expect(listSupportMessages('conv-1')).rejects.toThrow('sign failed');
  });
});

describe('deleteSupportChatMedia', () => {
  it('does nothing when no path is given', async () => {
    const { remove } = mockClient();
    await deleteSupportChatMedia(null);
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes the given path from storage', async () => {
    const { remove } = mockClient();
    await deleteSupportChatMedia('a/b.jpg');
    expect(remove).toHaveBeenCalledWith(['a/b.jpg']);
  });
});

jest.mock('expo-crypto', () => ({ randomUUID: () => 'fixed-uuid' }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(() => Promise.resolve({ uri: 'file://optimized.jpg' })),
  SaveFormat: { JPEG: 'jpeg' },
}));

describe('uploadSupportChatMedia', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)) }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects when there is no signed-in user', async () => {
    mockClient({ authUser: null });
    await expect(uploadSupportChatMedia({ uri: 'file://a.jpg', width: 100, height: 100 })).rejects.toThrow('Sign in before uploading an image.');
  });

  it('uploads the optimized image under the user id and returns its metadata', async () => {
    const { upload } = mockClient();
    const result = await uploadSupportChatMedia({ uri: 'file://a.jpg', width: 100, height: 100, fileName: 'a.jpg' });
    expect(upload).toHaveBeenCalledWith('user-1/fixed-uuid.jpg', expect.anything(), { contentType: 'image/jpeg', upsert: false });
    expect(result).toEqual({ path: 'user-1/fixed-uuid.jpg', type: 'image', mime: 'image/jpeg', size: 1024, name: 'a.jpg' });
  });

  it('rejects an image over the 5 MB limit before uploading', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(6 * 1024 * 1024)) }));
    const { upload } = mockClient();
    await expect(uploadSupportChatMedia({ uri: 'file://a.jpg', width: 100, height: 100 })).rejects.toThrow('Image is too large. The limit is 5 MB.');
    expect(upload).not.toHaveBeenCalled();
  });
});
