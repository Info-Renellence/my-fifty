// Proof that the guard works (run: node --require ./test/run/no-network.js test/run/prove-offline.js).
// Tries every outside service My Fifty knows about, through fetch, https and raw sockets, and the app's own
// connectors (Gemini, n8n, Gmail, web push) with fake keys. Every one must be refused; the test database (Supabase v1) must work.
'use strict';
const https = require('https');
const net = require('net');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
require(path.join(ROOT, 'test/test-db')).useTestDb();   // never v2
if (!global.__NETWORK_GUARD__) { console.log('FAIL: guard not loaded'); process.exit(1); }

const OUTSIDE = [
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  'https://renellence.app.n8n.cloud/webhook/my-fifty',
  'https://oauth2.googleapis.com/token',
  'https://gmail.googleapis.com/gmail/v1/users/me/profile',
  'https://fcm.googleapis.com/fcm/send/abc',
  'https://api.openphone.com/v1/messages',
  'https://graph.facebook.com/v19.0/me',
  'https://my-fifty.vercel.app/api/data?op=config',
  'https://example.com/',
];
let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log('ok   ', what); } else { fail++; console.log('FAIL ', what); } };

(async () => {
  for (const u of OUTSIDE) {
    let err = null;
    try { await fetch(u); } catch (e) { err = e; }
    ok(err && err.code === 'NETWORK_BLOCKED', 'fetch refused: ' + new URL(u).host);
  }
  let e1 = null; try { https.get('https://generativelanguage.googleapis.com/'); } catch (e) { e1 = e; }
  ok(e1 && e1.code === 'NETWORK_BLOCKED', 'https.get refused: generativelanguage.googleapis.com');
  const sockErr = await new Promise((r) => { const s = net.connect(443, 'gmail.googleapis.com'); s.on('error', r); s.on('connect', () => r(null)); });
  ok(sockErr && sockErr.code === 'NETWORK_BLOCKED', 'raw socket refused: gmail.googleapis.com:443');

  // The app's own connectors, with fake keys set only in this process.
  process.env.GEMINI_API_KEY = 'fake-key-for-guard-proof';
  process.env.N8N_MYFIFTY_URL = 'https://renellence.app.n8n.cloud/webhook/my-fifty';
  process.env.MYFIFTY_SECRET = 'guard-proof-secret';
  const gem = require(path.join(ROOT, 'api/_gemini'));
  let g = null; try { await gem.json('hi', { noRetry: true }); } catch (e) { g = e; }
  ok(g && g.message === 'gemini_unreachable', 'Gemini connector could not reach Google (' + (g && g.message) + ')');
  const n8n = require(path.join(ROOT, 'api/_n8n'));
  const r = await n8n.call('order', { orderId: 'x' });
  ok(r.queued === false && r.reason === 'n8n_unreachable', 'n8n connector could not reach n8n (' + r.reason + ')');
  const gmail = require(path.join(ROOT, 'api/_gmail'));
  let gm = null; try { await gmail._.accessToken('fake'); } catch (e) { gm = e; }
  ok(gm && gm.code === 'NETWORK_BLOCKED', 'Gmail connector could not reach Google OAuth (' + (gm && gm.message) + ')');
  const webpush = require('web-push');
  const push = require(path.join(ROOT, 'api/_push'));
  const k = push.vapid();
  let wp = null;
  try {
    await webpush.sendNotification({ endpoint: 'https://fcm.googleapis.com/fcm/send/fake', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } },
      'x', { vapidDetails: { subject: 'mailto:info@renellence.com', publicKey: k.publicKey, privateKey: k.privateKey } });
  } catch (e) { wp = e; }
  ok(wp && /NETWORK_BLOCKED/.test(String(wp.message || wp.body || wp)), 'web push could not reach the push service (' + String(wp && wp.message).slice(0, 80) + ')');

  // The test database (Supabase v1) still works.
  const { db } = require(path.join(ROOT, 'api/_db'));
  const [x] = await db()`select current_user as u, count(*)::int as n from products`;
  ok(x.u === 'test_runner' && x.n > 0, 'test database (v1) reachable as ' + x.u + ' (' + x.n + ' products)');
  const sb = await fetch('https://tkgcinmmqbtdiqbhsgtk.supabase.co/auth/v1/health').then((r2) => r2.status).catch((e) => e.message);
  ok(typeof sb === 'number', 'test database (v1) API host allowed (HTTP ' + sb + ')');
  await db().end();
  console.log('\n' + pass + ' passed, ' + fail + ' failed. Blocked attempts logged: ' + global.__NETWORK_GUARD__.blocked.length);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
