// The timer (GET /api/cron?op=tick). Called every 5 minutes by pg_cron in Supabase v2 (db/002-cron.sql), with
// the key in the X-Cron-Key header (CRON_SECRET). Vercel's free plan only allows daily timers, and new-lead
// pushes can't wait a day.
//
// Each tick:
//   1. new_lead pushes (L1 "New Instagram lead: <name>"): every social-media lead created in the last 24 hours that
//      nobody has touched yet, to its owner, once (notifications.dedupe_key).
//   2. the morning summary (L1 "6 days in a row with your plan done · 7 on today's list"), once a business day,
//      on the first tick from 7:30 AM Toronto.
//   3. the Gmail pull (api/_gmail.js), with what is left of the time.
const crypto = require('crypto');
const { db } = require('./_db');
const { send, query, route, fail } = require('./_http');
const B = require('./_book');
const T = require('./_time');
const push = require('./_push');

function authorised(req) {
  const want = process.env.CRON_SECRET || '';
  const got = String(req.headers['x-cron-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '');
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

module.exports = route(async (req, res) => {
  if (!authorised(req)) throw fail(401, 'not_allowed');
  const op = query(req).get('op') || 'tick';
  if (op !== 'tick') throw fail(400, 'unknown_op');
  const started = Date.now();
  const sql = db();
  const out = { leads: await newLeads(sql), morning: await morning(sql) };
  out.gmail = await require('./_gmail').sync(sql, Math.max(5000, 45000 - (Date.now() - started))).catch((e) => ({ error: e.message }));
  send(res, 200, out);
});

async function newLeads(sql) {
  const leads = await sql`
    select c.id, c.first_name, c.last_name, c.owner_id, c.source_detail
      from contacts c
     where c.source_kind = 'social' and c.owner_id is not null and c.deleted_at is null and c.created_at > now() - interval '24 hours'
       and not exists (select 1 from interactions i where i.contact_id = c.id and i.deleted_at is null)
       and not exists (select 1 from notifications n where n.dedupe_key = 'new_lead:' || c.id::text)`;
  let sent = 0;
  for (const l of leads) {
    const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'someone new';
    const r = await push.notify(sql, l.owner_id, { kind: 'new_lead', contactId: l.id, dedupeKey: 'new_lead:' + l.id,
      title: 'New ' + (l.source_detail || 'social media') + ' lead: ' + name,
      body: "Reach out within 24 hours. It's at the top of your Today.", url: '/person/' + l.id });
    sent += r.sent || 0;
  }
  return { found: leads.length, sent };
}

async function morning(sql) {
  const now = new Date();
  const today = T.ymd(now);
  const cfg = await B.settings(sql);
  if (!T.isBusinessDay(today, cfg.holidays) || now < T.atLocal(today, 7, 30) || now > T.atLocal(today, 11, 0)) return { skipped: 'not_now' };
  const users = await sql`
    select distinct u.id, u.name, u.email, u.settings from users u join user_connections c on c.user_id = u.id and c.kind = 'push' and c.status = 'connected'
     where u.active is not false
       and not exists (select 1 from notifications n where n.dedupe_key = 'morning:' || u.id::text || ':' || ${today})`;
  let sent = 0;
  for (const u of users) {
    const me = { id: u.id, name: u.name, settings: u.settings || {} };
    const [{ people }, day] = await Promise.all([B.book(sql, me, { cfg }), B.dayStats(sql, me, cfg)]);
    const list = B.todayList(people, me, cfg);
    if (!list.length && !day.streak) continue;   // nothing worth a notification
    const visits = list.filter((x) => x.action === 'visit').length;
    const title = day.streak ? day.streak + (day.streak === 1 ? ' day' : ' days') + ' in a row with your plan done' : 'Good morning';
    const body = list.length + ' on today\'s list.' + (visits ? ' ' + visits + (visits === 1 ? ' is a visit.' : ' are visits.') : '');
    const r = await push.notify(sql, u.id, { kind: 'morning_summary', dedupeKey: 'morning:' + u.id + ':' + today, title, body, url: '/' });
    sent += r.sent || 0;
  }
  return { users: users.length, sent };
}

// Exposed for the unit tests only.
module.exports._ = { authorised, newLeads, morning };
