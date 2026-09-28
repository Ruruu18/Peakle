export function readAuthParams(url) {
  if (!url) return new URLSearchParams();
  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const fragment = url.includes('#') ? url.split('#')[1] : '';
  return new URLSearchParams([query, fragment].filter(Boolean).join('&'));
}

// returnPath: where a signed-out player was heading (a shared game) before auth.
export function cleanAuthUrl(url, returnPath = null) {
  const parsed = new URL(url);
  const authKeys = ['code', 'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'provider_token', 'provider_refresh_token', 'error', 'error_code', 'error_description', 'google_handoff'];
  for (const key of authKeys) parsed.searchParams.delete(key);
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  if (authKeys.some((key) => fragment.has(key))) parsed.hash = '';
  if (['/oauth/callback', '/verify-email', '/reset-password'].includes(parsed.pathname)) parsed.pathname = returnPath || '/';
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export const GOOGLE_HANDOFF_PARAM = 'google_handoff';

// iOS Home Screen web apps keep their own storage, separate from Safari.
export function isStandaloneWebApp() {
  if (typeof window === 'undefined') return false;
  return window.navigator?.standalone === true || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
}

export function createHandoffId() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// x-safari-https:// (iOS 17+) makes iOS open the page in Safari itself instead
// of the Home Screen app's in-app browser sheet.
export function safariHandoffUrl(origin, handoffId) {
  const url = new URL('/', origin);
  url.searchParams.set(GOOGLE_HANDOFF_PARAM, handoffId);
  return url.href.replace(/^https:\/\//, 'x-safari-https://');
}

// iOS may reload the Home Screen app while the player is in Safari, so keep
// the pending handoff id long enough to reopen the code prompt afterwards.
const APP_HANDOFF_KEY = 'peakle.safariHandoffPending';
const APP_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

export function rememberAppHandoff(handoffId) {
  try { window.localStorage.setItem(APP_HANDOFF_KEY, JSON.stringify({ id: handoffId, startedAt: Date.now() })); } catch (_) { /* Best effort. */ }
}

export function readAppHandoff() {
  try {
    const pending = JSON.parse(window.localStorage.getItem(APP_HANDOFF_KEY) || 'null');
    if (pending?.id && Date.now() - pending.startedAt < APP_HANDOFF_MAX_AGE_MS) return pending.id;
  } catch (_) { /* Treat unreadable storage as nothing pending. */ }
  return null;
}

export function clearAppHandoff() {
  try { window.localStorage.removeItem(APP_HANDOFF_KEY); } catch (_) { /* Best effort. */ }
}
