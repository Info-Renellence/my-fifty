// Gmail, as in Edge: the Email button sends from the rep's own mailbox, and client emails are pulled into
// interactions (Yousef 2026-10-20: "Quo app + Gmail", "Yes, all incl. Gmail").
//
// HOW IT CONNECTS: signing in to My Fifty with Google also asks for Gmail (send + read). Supabase hands the
// page a Google refresh token once, right after sign-in; the page passes it to act?op=gmail_connect and it is
// stored encrypted in user_connections (kind gmail). Access tokens are made from it with the same Google
// OAuth client Supabase signs in with (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
//
// send()  -> sends, and saves the email on the person's history straight away (interactions, kind email).
// sync()  -> for each connected mailbox, the messages since the last run (Gmail history id in
//            user_connections.sync_cursor; the first run takes 14 days). A message is kept only when it is to or
//            from a contact in v2 and is not internal; it lands in ingest_events (source gmail, replayable) and
//            becomes one interaction per matched contact (unique source + Message-ID + contact).
const { seal, open } = require('./_crypto');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const OURS = /@renellence\.com$/i;
const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };

async function accessToken(refresh) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refresh, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw fail(r.status === 400 ? 409 : 502, j.error === 'invalid_grant' ? 'gmail_reconnect' : 'gmail_token_failed');
  return j.access_token;
}

async function connection(sql, userId) {
  const [c] = await sql`select id, account, credentials, sync_cursor from user_connections where user_id = ${userId} and kind = 'gmail' and status = 'connected' order by updated_at desc limit 1`;
  return c || null;
}

async function connect(tx, me, refreshToken) {
  const token = String(refreshToken || '').trim();
  if (!token || token.length > 2000) throw fail(400, 'no_token');
  await tx`update user_connections set status = 'off' where user_id = ${me.id} and kind = 'gmail'`;
  await tx`insert into user_connections (user_id, kind, account, credentials, status) values (${me.id}, 'gmail', ${me.email}, ${seal(token)}, 'connected')`;
  return { ok: true };
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const header = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');

// to: one address. Returns { id, threadId, messageId }.
async function send(sql, me, { to, subject, text }) {
  const c = await connection(sql, me.id);
  if (!c) throw fail(409, 'gmail_not_connected');
  const at = await accessToken(open(c.credentials)).catch(async (e) => {
    if (e.message === 'gmail_reconnect') await sql`update user_connections set status = 'broken' where id = ${c.id}`;
    throw e;
  });
  const messageId = '<' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2) + '@myfifty.renellence.com>';
  const raw = [
    'From: ' + encodeWord(header(me.name)) + ' <' + me.email + '>',
    'To: ' + header(to),
    'Subject: ' + encodeWord(header(subject)),
    'Message-ID: ' + messageId,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text || ''),
  ].join('\r\n');
  const r = await fetch(API + 'messages/send', { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(raw) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(502, 'gmail_send_failed');
  return { id: j.id, threadId: j.threadId, messageId };
}

// ---- the pull -----------------------------------------------------------------------------------
const addrs = (s) => (String(s || '').match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((a) => a.toLowerCase());
const hdr = (m, name) => ((m.payload && m.payload.headers) || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body && part.body.data) return Buffer.from(part.body.data, 'base64').toString('utf8');
  for (const p of part.parts || []) { const t = bodyText(p); if (t) return t; }
  return '';
}
// Robots, notices and newsletters are not client conversations (the same idea as Edge's keepEmail).
const ROBOT = /no-?reply|notifications?@|mailer-daemon|postmaster|newsletter|marketing@|@.*(hubspot|mailchimp|stripe|quickbooks|intuit|shopify|google)\./i;

async function gget(at, path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + at } });
  if (r.status === 404) return null;
  if (!r.ok) throw fail(502, 'gmail_read_failed');
  return r.json();
}

async function syncMailbox(sql, user, c, budgetEnd) {
  const at = await accessToken(open(c.credentials));
  let ids = [];
  let cursor = c.sync_cursor;
  if (cursor) {
    const h = await gget(at, 'history?historyTypes=messageAdded&startHistoryId=' + encodeURIComponent(cursor));
    if (h) {
      for (const x of h.history || []) for (const m of x.messagesAdded || []) ids.push(m.message.id);
      cursor = h.historyId || cursor;
    } else cursor = null;   // too old: start again from a window
  }
  if (!cursor) {
    const l = await gget(at, 'messages?maxResults=100&q=' + encodeURIComponent('newer_than:14d -in:chats'));
    ids = ((l && l.messages) || []).map((m) => m.id);
    const p = await gget(at, 'profile');
    cursor = p && p.historyId;
  }
  let kept = 0;
  for (const id of [...new Set(ids)].slice(0, 80)) {
    if (Date.now() > budgetEnd) break;
    const m = await gget(at, 'messages/' + id + '?format=full');
    if (!m || (m.labelIds || []).some((l) => l === 'SPAM' || l === 'TRASH' || l === 'DRAFT')) continue;
    const from = addrs(hdr(m, 'From'));
    const to = addrs(hdr(m, 'To')).concat(addrs(hdr(m, 'Cc')));
    if (from.some((a) => ROBOT.test(a))) continue;
    const outside = [...new Set(from.concat(to))].filter((a) => !OURS.test(a));
    if (!outside.length) continue;
    // Only the mailbox owner's own clients (Yousef 2026-10-21, Q6): a rep's email never lands on another rep's
    // client's history. Each mailbox keeps its own copy of a message, so when two reps are on one email each
    // rep's client still gets it.
    const contacts = await sql`select id from contacts where deleted_at is null and owner_id = ${user.id}
      and (lower(email::text) = any(${outside}) or lower(secondary_email::text) = any(${outside}))`;
    if (!contacts.length) continue;
    const messageId = hdr(m, 'Message-ID') || m.id;
    const [ev] = await sql`
      insert into ingest_events (source, external_key, payload, received_via, received_at, status, attempts)
      values ('gmail', ${messageId + '|' + user.email}, ${sql.json({ mailbox: user.email, id: m.id, threadId: m.threadId, from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'), subject: hdr(m, 'Subject'), date: hdr(m, 'Date'), snippet: m.snippet })}, 'pull', now(), 'pending', 1)
      on conflict (source, external_key) do nothing returning id`;
    if (!ev) continue;   // already pulled from this mailbox
    const direction = from.some((a) => OURS.test(a)) ? 'out' : 'in';
    const occurred = new Date(Number(m.internalDate) || Date.now());
    let first = null;
    for (const ct of contacts) {
      const [row] = await sql`
        insert into interactions (kind, contact_id, user_id, occurred_at, direction, status, subject, body, thread_id, addresses, source, external_id, created_by)
        values ('email', ${ct.id}, ${direction === 'out' ? user.id : null}, ${occurred}, ${direction}, 'completed', ${hdr(m, 'Subject').slice(0, 500)},
                ${bodyText(m.payload).slice(0, 8000) || m.snippet || ''}, ${m.threadId}, ${sql.json({ from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc') })},
                'gmail', ${messageId}, ${user.id})
        on conflict (source, external_id, contact_id) do nothing returning id`;
      first = first || (row && row.id);
    }
    await sql`update ingest_events set status = 'done', processed_at = now(), result_table = 'interactions', result_id = ${first} where id = ${ev.id}`;
    kept++;
  }
  await sql`update user_connections set sync_cursor = ${cursor ? String(cursor) : null}, last_synced_at = now() where id = ${c.id}`;
  return kept;
}

async function sync(sql, budgetMs) {
  const end = Date.now() + (budgetMs || 40000);
  const boxes = await sql`
    select c.id, c.credentials, c.sync_cursor, u.id as user_id, u.email from user_connections c join users u on u.id = c.user_id
     where c.kind = ${'gmail'} and c.status = 'connected' and u.active is not false order by c.last_synced_at nulls first`;
  const out = { mailboxes: 0, kept: 0, errors: 0 };
  for (const b of boxes) {
    if (Date.now() > end) break;
    try { out.kept += await syncMailbox(sql, { id: b.user_id, email: b.email }, b, end); out.mailboxes++; } catch (e) {
      out.errors++;
      if (e.message === 'gmail_reconnect') await sql`update user_connections set status = 'broken' where id = ${b.id}`;
      console.error('GMAIL_SYNC', b.email, e.message);
    }
  }
  return out;
}

module.exports = { connect, send, sync, connection };
// Exposed for the unit tests only.
module.exports._ = { accessToken, header, encodeWord, addrs, hdr, bodyText, gget, syncMailbox, ROBOT };
