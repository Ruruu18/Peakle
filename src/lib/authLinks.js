export function readAuthParams(url) {
  if (!url) return new URLSearchParams();
  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const fragment = url.includes('#') ? url.split('#')[1] : '';
  return new URLSearchParams([query, fragment].filter(Boolean).join('&'));
}

export function cleanAuthUrl(url) {
  const parsed = new URL(url);
  const authKeys = ['code', 'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'provider_token', 'provider_refresh_token', 'error', 'error_code', 'error_description'];
  for (const key of authKeys) parsed.searchParams.delete(key);
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  if (authKeys.some((key) => fragment.has(key))) parsed.hash = '';
  if (['/oauth/callback', '/verify-email', '/reset-password'].includes(parsed.pathname)) parsed.pathname = '/';
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
