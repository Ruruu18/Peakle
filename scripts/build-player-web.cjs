const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.env.NODE_ENV ||= 'production';
require('@expo/env').load(root);

if (process.env.EXPO_PUBLIC_DEMO_MODE === '1') throw new Error('The player beta must save real account data. Remove EXPO_PUBLIC_DEMO_MODE=1 before building.');
for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
  if (!process.env[name] || process.env[name].startsWith('your-')) throw new Error(`${name} must point to the same Supabase project used by the native app.`);
}
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
let role;
try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* New publishable keys are not JWTs. */ }
if (role === 'service_role' || key.startsWith('sb_secret_')) throw new Error('A browser build must never contain a Supabase secret/service role key.');

const build = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', 'dist/player-beta', '--max-workers', '2'], { cwd: root, env: process.env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
const output = path.join(root, 'dist/player-beta');
const htmlPath = path.join(output, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8')
  .replace(/<title>.*?<\/title>/, '<title>Peakle · Player Beta</title>')
  .replace('</head>', '<meta name="description" content="Join your community on Peakle. Play matches, join tournaments, and keep your results with one account."/><meta name="robots" content="noindex,nofollow"/><meta name="theme-color" content="#0E2321"/><meta name="apple-mobile-web-app-capable" content="yes"/><link rel="apple-touch-icon" href="/images/web-favicon.png"/><link rel="manifest" href="/manifest.webmanifest"/></head>');
fs.writeFileSync(htmlPath, html);
fs.writeFileSync(path.join(output, 'manifest.webmanifest'), JSON.stringify({ name: 'Peakle Player Beta', short_name: 'Peakle', id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: '#F3F5EF', theme_color: '#0E2321', icons: [{ src: '/images/web-favicon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] }, null, 2));
// Cloudflare Pages / Netlify: route direct links back to the player app.
fs.writeFileSync(path.join(output, '_redirects'), '/* /index.html 200\n');
fs.writeFileSync(path.join(output, '_headers'), '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow\n/_expo/static/*\n  Cache-Control: public, max-age=31536000, immutable\n');
console.log('Player beta ready in dist/player-beta. Account data stays in the shared Supabase project.');
