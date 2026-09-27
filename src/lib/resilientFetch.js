// fetch for the Supabase client that copes with slow or flaky mobile data.
//
// Without it a request on a weak connection can hang with no answer, or fail
// once and leave the screen empty. Every request gets a time limit, and reads
// that fail on the network are retried with a short backoff. Writes are never
// retried: a message that reached the server before the connection dropped
// would otherwise be sent twice. Uploads get a long limit instead of a retry.

const READ_TIMEOUT_MS = 20000;
const WRITE_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 180000;
const RETRY_DELAYS_MS = [700, 2000];
const RETRY_STATUSES = new Set([408, 502, 503, 504]);
// Database functions safe to call again: reads, plus get-or-create ones
// (get_or_create_community_chat, get_scheduled_game_share_code) that return
// the existing row. Any other RPC is treated as a write.
const READ_ONLY_RPC = /\/rest\/v1\/rpc\/(get|list|search|nearby|count|can|has|is)_/;

function requestUrl(input) {
  if (typeof input === 'string') return input;
  return input?.url || String(input);
}

function requestMethod(input, init) {
  return String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
}

export function isRetryableRequest(url, method) {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method !== 'POST') return false;
  // Signing a media link only reads.
  if (READ_ONLY_RPC.test(url) || url.includes('/storage/v1/object/sign/')) return true;
  // Refreshing the session: Supabase accepts the same refresh token again for
  // a short window, so a retry after a dropped response is safe.
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token');
}

function timeoutFor(url, method) {
  if (url.includes('/storage/v1/') && method !== 'GET' && method !== 'HEAD' && !url.includes('/object/sign/')) return UPLOAD_TIMEOUT_MS;
  return method === 'GET' || method === 'HEAD' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function timeoutError() {
  const error = new Error('The connection is slow. Check your signal and try again.');
  error.name = 'TimeoutError';
  return error;
}

// One attempt with its own time limit. The caller's own abort still wins.
async function attempt(baseFetch, input, init, timeoutMs) {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort);
  }
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await baseFetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !callerSignal?.aborted) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener?.('abort', onCallerAbort);
  }
}

export function createResilientFetch(baseFetch = (...args) => fetch(...args), { retryDelaysMs = RETRY_DELAYS_MS } = {}) {
  return async function resilientFetch(input, init = {}) {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const retryable = isRetryableRequest(url, method);
    const timeoutMs = timeoutFor(url, method);
    // A Request body can only be read once, so only plain init bodies retry.
    const canRepeat = retryable && !(typeof input === 'object' && input?.body);
    for (let tries = 0; ; tries += 1) {
      const last = !canRepeat || tries >= retryDelaysMs.length;
      try {
        const response = await attempt(baseFetch, input, init, timeoutMs);
        if (last || !RETRY_STATUSES.has(response.status)) return response;
      } catch (error) {
        if (last || init?.signal?.aborted) throw error;
      }
      await wait(retryDelaysMs[tries]);
      if (init?.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    }
  };
}
