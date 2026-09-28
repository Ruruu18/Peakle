// A shared link (a game, open play, event) opened by a signed-out player must
// survive sign-up, email verification, Google sign-in and onboarding. The web
// auth callbacks land on fixed paths, so the destination is kept in storage.
const PENDING_DESTINATION_KEY = 'peakle.pendingDestination';
const PENDING_DESTINATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AUTH_PATHS = ['/', '/oauth/callback', '/verify-email', '/reset-password'];
const ID = '[A-Za-z0-9_-]{1,64}';
const SHAREABLE_PATHS = [
  /^\/games\/[a-z0-9]{10}$/i,
  new RegExp(`^/open-play/${ID}$`),
  new RegExp(`^/sessions/${ID}$`),
  new RegExp(`^/activities/[a-z_]{1,32}/${ID}$`),
  new RegExp(`^/competitions/${ID}/divisions/${ID}$`),
  new RegExp(`^/players/${ID}$`),
];

export function isShareablePath(path) {
  const pathname = typeof path === 'string' ? path.split(/[?#]/)[0].replace(/\/+$/, '') : '';
  return SHAREABLE_PATHS.some((pattern) => pattern.test(pathname));
}

function storage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_) { return null; }
}

export function rememberPendingDestination(path, now = Date.now()) {
  if (!isShareablePath(path)) return false;
  try {
    storage()?.setItem(PENDING_DESTINATION_KEY, JSON.stringify({ path: path.split(/[?#]/)[0], savedAt: now }));
    return true;
  } catch (_) { return false; }
}

export function readPendingDestination(now = Date.now()) {
  try {
    const pending = JSON.parse(storage()?.getItem(PENDING_DESTINATION_KEY) || 'null');
    if (pending?.path && isShareablePath(pending.path) && now - pending.savedAt < PENDING_DESTINATION_MAX_AGE_MS) return pending.path;
  } catch (_) { /* Treat unreadable storage as nothing pending. */ }
  return null;
}

export function clearPendingDestination() {
  try { storage()?.removeItem(PENDING_DESTINATION_KEY); } catch (_) { /* Best effort. */ }
}

// Where an auth callback should leave the browser instead of the home page.
export function authReturnPath(pathname) {
  return AUTH_PATHS.includes(pathname) ? readPendingDestination() : null;
}

// Web only: called once before the signed-in navigator reads the address bar.
// Puts the saved destination back when auth or onboarding left the player on
// the home page, then forgets it so a later visit to "/" is not redirected.
export function restorePendingDestination() {
  if (typeof window === 'undefined' || !window.history) return null;
  const pending = readPendingDestination();
  clearPendingDestination();
  if (!pending) return null;
  const { pathname } = window.location;
  if (!AUTH_PATHS.includes(pathname)) return null;
  window.history.replaceState(window.history.state, '', pending);
  return pending;
}
