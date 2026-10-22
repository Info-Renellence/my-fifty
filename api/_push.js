// Phone notifications (L1), the way Edge does them (renellence-edge/api/_push.js): Web Push to the installed web
// app. Yousef 2026-10-20: "Yes, web push".
//
// Where things live in v2:
//   - a phone's subscription: connections (provider push, credentials_encrypted = the subscription)
//   - every notification sent: notifications (dedupe_key stops a repeat; status sent / failed)
//
// Two notifications, both sent from the timer (api/cron.js):
//   new_lead         "New Instagram lead: <name>" for each new social-media lead in the rep's book, once
//   morning_summary  at 7:30 on business days: the streak and how many are on today's list
const crypto = require('crypto');
const { seal, open, derive } = require('./_crypto');

const SUBJECT = 'mailto:info@renellence.com';
const MAX_SUBS = 5;   // phones per person; the oldest goes when a sixth arrives

const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let VAPID = null;
function vapid() {
  if (VAPID) return VAPID;
  if (!process.env.MYFIFTY_SECRET) return null;
  // A P-256 private key is any 32-byte number below the curve order; re-hash in the rare case it isn't.
  let seed = derive('vapid-v1');
  for (let i = 0; i < 8; i++) {
    try {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.setPrivateKey(seed);
      VAPID = { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(seed) };
      return VAPID;
    } catch (e) { seed = crypto.createHash('sha256').update(seed).digest(); }
  }
  return null;
}

function cleanSubscription(s) {
  if (!s || typeof s !== 'object') return null;
  const endpoint = String(s.endpoint || '');
  const keys = s.keys || {};
  if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint)) return null;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
const deviceId = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 20);

// Saves this phone for the person (tx: a transaction from asUser).
async function subscribe(tx, me, sub) {
  const clean = cleanSubscription(sub);
  if (!clean) return false;
  const id = deviceId(clean.endpoint);
  const have = await tx`select id, external_account from connections where user_id = ${me.id} and provider = 'push' and status = 'connected' order by created_at`;
  const same = have.find((h) => h.external_account === id);
  if (same) { await tx`update connections set credentials_encrypted = ${seal(JSON.stringify(clean))} where id = ${same.id}`; return true; }
  if (have.length >= MAX_SUBS) await tx`update connections set status = 'off' where id = ${have[0].id}`;
  await tx`insert into connections (user_id, provider, external_account, credentials_encrypted, status) values (${me.id}, 'push', ${id}, ${seal(JSON.stringify(clean))}, 'connected')`;
  return true;
}

// Sends one notification to every phone the person has, logged in `notifications` under dedupe_key (a key that
// was already sent is skipped). sql: the plain connection. n: { kind, title, body, url, dedupeKey, contactId }.
async function notify(sql, userId, n) {
  const keys = vapid();
  if (!keys) return { sent: 0, error: 'no_key' };
  // Nobody to tell yet: nothing is logged, so it can still go once they turn notifications on.
  const [{ n: phones }] = await sql`select count(*)::int as n from connections where user_id = ${userId} and provider = 'push' and status = 'connected'`;
  if (!phones) return { sent: 0, noPhone: true };
  const [row] = await sql`
    insert into notifications (user_id, kind, contact_id, dedupe_key, title, body, status, sent_at)
    values (${userId}, ${n.kind}, ${n.contactId || null}, ${n.dedupeKey}, ${n.title}, ${n.body}, 'sent', now())
    on conflict (dedupe_key) do nothing returning id`;
  if (!row) return { sent: 0, skipped: true };
  const subs = await sql`select id, credentials_encrypted from connections where user_id = ${userId} and provider = 'push' and status = 'connected'`;
  const webpush = require('web-push');
  let sent = 0, failed = 0, lastError = '';
  for (const s of subs) {
    const sub = JSON.parse(open(s.credentials_encrypted) || 'null');
    if (!sub) continue;
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title: n.title, body: n.body, url: n.url || '/', tag: n.kind }), {
        TTL: 6 * 3600, vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey } });
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await sql`update connections set status = 'off' where id = ${s.id}`;
      else { failed++; lastError = String((e && (e.statusCode || e.message)) || 'error'); }
    }
  }
  if (!sent) await sql`update notifications set status = ${subs.length ? 'failed' : 'skipped_by_rule'}, error_message = ${subs.length ? lastError || 'no_phone_reached' : 'no_phone'} where id = ${row.id}`;
  return { sent, failed };
}

module.exports = { vapid, subscribe, notify, cleanSubscription, deviceId };
