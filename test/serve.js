// Local server for trying My Fifty against v2 without Google: serves the page and the API, and signs every request
// in as one person (default admin@renellence.com). Test-only; nothing here is deployed.
//   node test/serve.js [port] [email]
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const port = Number(process.argv[2] || 5178);
const email = process.argv[3] || 'admin@renellence.com';

// Sign everyone in as `email`.
const auth = require('../api/_auth');
const { db } = require('../api/_db');
auth.signedIn = async () => {
  const [u] = await db()`select id, email, name, kind, settings from users where email = ${email}`;
  return { id: u.id, email: u.email, name: u.name, first: u.name.split(' ')[0], initials: auth.initials(u.name), kind: u.kind, settings: u.settings || {} };
};
const handlers = { '/api/data': require('../api/data'), '/api/act': require('../api/act') };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/data' && url.searchParams.get('op') === 'config') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ supabaseUrl: 'http://stub', supabaseAnonKey: 'stub', vapidPublicKey: '' }));
  }
  const h = handlers[url.pathname];
  if (h) {
    if (req.method === 'POST') { const chunks = []; for await (const c of req) chunks.push(c); req.body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
    return h(req, res);
  }
  let file = path.join(ROOT, url.pathname);
  if (!path.extname(url.pathname) || !fs.existsSync(file)) file = path.join(ROOT, 'index.html');
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('My Fifty test server on http://localhost:' + port + ' as ' + email));
