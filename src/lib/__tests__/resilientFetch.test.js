import { createResilientFetch, isRetryableRequest } from '../resilientFetch';

const BASE = 'https://example.supabase.co';
const ok = (status = 200) => ({ status, ok: status < 400 });
const networkError = () => new TypeError('Network request failed');

describe('isRetryableRequest', () => {
  it.each([
    [`${BASE}/rest/v1/direct_messages?select=*`, 'GET', true],
    [`${BASE}/rest/v1/rpc/get_player_suggestions`, 'POST', true],
    [`${BASE}/rest/v1/rpc/search_direct_message_candidates`, 'POST', true],
    [`${BASE}/storage/v1/object/sign/chat-media/a.jpg`, 'POST', true],
    [`${BASE}/auth/v1/token?grant_type=refresh_token`, 'POST', true],
    [`${BASE}/rest/v1/rpc/send_direct_message`, 'POST', false],
    [`${BASE}/rest/v1/rpc/follow_player`, 'POST', false],
    [`${BASE}/rest/v1/team_messages`, 'POST', false],
    [`${BASE}/rest/v1/team_messages?id=eq.1`, 'PATCH', false],
    [`${BASE}/storage/v1/object/chat-media/a.jpg`, 'POST', false],
    [`${BASE}/auth/v1/token?grant_type=password`, 'POST', false],
  ])('%s %s -> %s', (url, method, expected) => {
    expect(isRetryableRequest(url, method)).toBe(expected);
  });
});

describe('createResilientFetch', () => {
  const noDelay = { retryDelaysMs: [0, 0] };

  it('retries a read that fails on the network, then succeeds', async () => {
    const base = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(ok());
    const response = await createResilientFetch(base, noDelay)(`${BASE}/rest/v1/profiles`);
    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('retries a gateway error on a read-only RPC', async () => {
    const base = jest.fn().mockResolvedValueOnce(ok(503)).mockResolvedValueOnce(ok());
    const response = await createResilientFetch(base, noDelay)(`${BASE}/rest/v1/rpc/get_player_suggestions`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last retry', async () => {
    const base = jest.fn().mockRejectedValue(networkError());
    await expect(createResilientFetch(base, noDelay)(`${BASE}/rest/v1/profiles`)).rejects.toThrow('Network request failed');
    expect(base).toHaveBeenCalledTimes(3);
  });

  it('never repeats a write, so a message is not sent twice', async () => {
    const base = jest.fn().mockRejectedValue(networkError());
    await expect(createResilientFetch(base, noDelay)(`${BASE}/rest/v1/rpc/send_direct_message`, { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('returns client errors without retrying', async () => {
    const base = jest.fn().mockResolvedValue(ok(401));
    const response = await createResilientFetch(base, noDelay)(`${BASE}/rest/v1/profiles`);
    expect(response.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('stops a request that hangs and reports a slow connection', async () => {
    jest.useFakeTimers();
    try {
      const base = jest.fn((_, init) => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      }));
      const pending = createResilientFetch(base, { retryDelaysMs: [] })(`${BASE}/rest/v1/rpc/send_direct_message`, { method: 'POST' });
      const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await jest.advanceTimersByTimeAsync(30000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('respects the caller cancelling a request', async () => {
    const controller = new AbortController();
    const base = jest.fn((_, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    }));
    const pending = createResilientFetch(base, noDelay)(`${BASE}/rest/v1/profiles`, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(base).toHaveBeenCalledTimes(1);
  });
});
