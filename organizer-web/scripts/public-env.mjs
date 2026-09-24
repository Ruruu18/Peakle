// Browser bundles must use public credentials, including in local previews.
export function validatePublicEnvironment(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || url.includes('your-project') || key.startsWith('your-')) {
    throw new Error('Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before building the organizer portal.');
  }
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be an HTTP(S) URL without credentials.');
  }
  let role;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* Publishable keys are not JWTs. */ }
  if (!key.startsWith('sb_publishable_') && role !== 'anon') {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY must be a publishable or anon key. Never include secret/service-role credentials in a browser build.');
  }
  if (env.NEXT_PUBLIC_PLAYER_APP_URL?.trim()) {
    const player = new URL(env.NEXT_PUBLIC_PLAYER_APP_URL.trim());
    if (player.protocol !== 'https:' || player.username || player.password || ['localhost', '127.0.0.1', '[::1]'].includes(player.hostname)) {
      throw new Error('NEXT_PUBLIC_PLAYER_APP_URL must be the public HTTPS player app URL. Leave it empty until the player app is hosted.');
    }
  }
}
