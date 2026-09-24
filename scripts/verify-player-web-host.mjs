import assert from 'node:assert/strict';

// Read-only HTTP verification. Run again against the actual Vercel preview or
// production origin; a local pass alone does not certify a hosted deployment.
const origin = process.env.PLAYER_WEB_URL || 'http://127.0.0.1:8081';
const paths = ['/', '/teams', '/play', '/sessions/release-check',
  '/competitions/release-check/divisions/open', '/players/release-check',
  '/oauth/callback?code=release-check', '/verify-email?code=release-check',
  '/reset-password?code=release-check',
  '/booking/release-check/payment-result?status=success',
  '/membership/release-check/payment-result?status=cancelled'];
let html;
for (const path of paths) {
  const response = await fetch(new URL(path, origin), { redirect: 'manual' });
  assert.equal(response.status, 200, `${path}: directly reachable`);
  assert.match(response.headers.get('content-type') || '', /text\/html/, `${path}: SPA HTML`);
  assert.match(response.headers.get('cache-control') || '', /no-cache|no-store|max-age=0/, `${path}: HTML must revalidate`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const body = await response.text();
  html ||= body;
  assert.equal(body, html, `${path}: same app shell, no host 404/auth interstitial`);
}
const assetPath = html.match(/<script[^>]+src="([^"]*\/_expo\/static\/[^"?]+\.js)[^"]*"/)?.[1];
assert.ok(assetPath, 'Exported hashed JavaScript asset is linked');
const asset = await fetch(new URL(assetPath, origin));
assert.equal(asset.status, 200);
assert.match(asset.headers.get('content-type') || '', /javascript/);
assert.match(asset.headers.get('cache-control') || '', /max-age=31536000.*immutable/);
assert.ok(!(await asset.text()).startsWith('<!DOCTYPE'), 'Asset is not rewritten to HTML');
const icon = await fetch(new URL('/images/web-favicon.png', origin));
assert.equal(icon.status, 200);
assert.match(icon.headers.get('content-type') || '', /image\/png/);
const manifest = await fetch(new URL('/manifest.webmanifest', origin));
assert.equal(manifest.status, 200);
assert.equal((await manifest.json()).start_url, '/');
console.log(`PASS ${paths.length} direct routes, authentication/payment callbacks, security headers, asset precedence, and caching at ${origin}`);
