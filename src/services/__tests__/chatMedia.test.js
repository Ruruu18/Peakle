import { requireSupabase } from '../../lib/supabase';
import { uploadChatMedia } from '../database';

jest.mock('../../lib/supabase', () => ({
  requireSupabase: jest.fn(),
  SUPABASE_URL: 'https://storage.example.test',
  SUPABASE_ANON_KEY: 'test-publishable-key',
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'upload-id' }));

const asset = { uri: 'file:///voice.m4a', mimeType: 'audio/mp4', fileName: 'voice.m4a' };
const originalFetch = global.fetch;
const originalXHR = global.XMLHttpRequest;
let storage;
let request;
let sent;

beforeEach(() => {
  storage = {
    upload: jest.fn(async () => ({ error: null })),
    createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'https://signed.example.test/voice' }, error: null })),
    remove: jest.fn(async () => ({ error: null })),
  };
  requireSupabase.mockReturnValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'me' } } })),
      getSession: jest.fn(async () => ({ data: { session: { access_token: 'test-user-token' } } })),
    },
    storage: { from: jest.fn(() => storage) },
  });
  global.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(2048) }));
  let signalSent;
  sent = new Promise((resolve) => { signalSent = resolve; });
  global.XMLHttpRequest = jest.fn(() => {
    request = {
      open: jest.fn(), setRequestHeader: jest.fn(), upload: {},
      send: jest.fn(() => signalSent()), status: 200,
    };
    return request;
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  global.XMLHttpRequest = originalXHR;
});

const upload = (onProgress) => uploadChatMedia('direct-message-media', (id) => `conversation/${id}`, asset, 'audio', 'Private', { onProgress });

it('reports transfer progress, then completes only after signing the uploaded file', async () => {
  const onProgress = jest.fn();
  const result = upload(onProgress);
  await sent;
  expect(request.open).toHaveBeenCalledWith('POST', 'https://storage.example.test/storage/v1/object/direct-message-media/conversation/me/upload-id.m4a');
  expect(request.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-user-token');
  expect(request.send).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  request.upload.onprogress({ lengthComputable: true, loaded: 1024, total: 2048 });
  expect(onProgress.mock.lastCall[0]).toBeCloseTo(0.525);
  request.upload.onprogress({ lengthComputable: true, loaded: 2048, total: 2048 });
  expect(onProgress).not.toHaveBeenCalledWith(1);
  request.onload();
  await expect(result).resolves.toMatchObject({ path: 'conversation/me/upload-id.m4a', type: 'audio', size: 2048 });
  expect(storage.upload).not.toHaveBeenCalled();
  expect(onProgress).toHaveBeenLastCalledWith(1);
});

it.each([
  ['onerror', 'Check your connection'],
  ['ontimeout', 'took too long'],
  ['onabort', 'interrupted'],
])('rejects %s so a failed attachment can leave the uploading state', async (event, text) => {
  const onProgress = jest.fn();
  const result = upload(onProgress);
  const failure = expect(result).rejects.toThrow(text);
  await sent;
  expect(request.timeout).toBeGreaterThan(0);
  request[event]();
  await failure;
  expect(storage.createSignedUrl).not.toHaveBeenCalled();
  expect(onProgress).not.toHaveBeenCalledWith(1);
});

it('surfaces storage rejection instead of treating a completed transfer as success', async () => {
  const result = upload(jest.fn());
  const failure = expect(result).rejects.toThrow('Conversation is closed');
  await sent;
  request.status = 403;
  request.responseText = JSON.stringify({ message: 'Conversation is closed' });
  request.onload();
  await failure;
  expect(storage.createSignedUrl).not.toHaveBeenCalled();
});

it('removes the uploaded file when signing fails and never reports completion', async () => {
  storage.createSignedUrl.mockResolvedValueOnce({ error: new Error('Cannot sign file') });
  const onProgress = jest.fn();
  const result = upload(onProgress);
  const failure = expect(result).rejects.toThrow('Cannot sign file');
  await sent;
  request.onload();
  await failure;
  expect(storage.remove).toHaveBeenCalledWith(['conversation/me/upload-id.m4a']);
  expect(onProgress).not.toHaveBeenCalledWith(1);
});

it('preserves the SDK upload for callers without progress callbacks', async () => {
  await upload();
  expect(storage.upload).toHaveBeenCalledWith('conversation/me/upload-id.m4a', expect.any(ArrayBuffer), { contentType: 'audio/mp4', upsert: false });
  expect(global.XMLHttpRequest).not.toHaveBeenCalled();
});

it('rejects oversized recordings before sending any bytes', async () => {
  global.fetch.mockResolvedValueOnce({ arrayBuffer: async () => new ArrayBuffer(10 * 1024 * 1024 + 1) });
  await expect(upload(jest.fn())).rejects.toThrow('limit is 10 MB');
  expect(global.XMLHttpRequest).not.toHaveBeenCalled();
  expect(storage.upload).not.toHaveBeenCalled();
});
