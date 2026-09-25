const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../dist/player-beta');
const port = Number(process.env.PORT || 8081);
const hosting = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Run npm run build:web first.');
const handleRequest = (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  let file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, 'index.html');
  }
  // npm run build:web empties the output folder while it exports; answer briefly instead of crashing.
  if (!fs.existsSync(file)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' }).end('Rebuilding the player beta. Refresh in a few seconds.');
    return;
  }
  // Match this project's static Vercel header rules for local release checks.
  // Real files take precedence over the SPA fallback, as on Vercel.
  const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' };
  for (const rule of hosting.headers) {
    if (new RegExp(`^${rule.source}$`).test(pathname)) {
      for (const { key, value } of rule.headers) headers[key] = value;
    }
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
};

// Reserve both localhost addresses so IPv4 and IPv6 cannot reach different apps.
// Bind only to loopback; the production preview must remain local to this machine.
const servers = [];
async function start() {
  for (const host of ['127.0.0.1', '::1']) {
    const server = http.createServer(handleRequest);
    servers.push(server);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, host, ipv6Only: host === '::1' }, resolve);
      });
    } catch (error) {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) continue;
      throw error;
    }
  }
  console.log(`Peakle player beta: http://localhost:${port}`);
  console.log('Serving the production build. After source changes, restart npm run preview:web to rebuild.');
}

start().catch((error) => {
  for (const server of servers) server.close();
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use on localhost. Stop the existing server or set PORT to another port. Use npm run web for development on port 8082.`
    : error);
  process.exitCode = 1;
});
