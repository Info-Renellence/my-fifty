require('./_staging'); // first: with STAGING=1 nothing goes out (api/_staging.js)
// The timer (GET /api/cron?op=tick). Called every 5 minutes by pg_cron in Supabase v2 (db/002-cron.sql), with
// the key in the X-Cron-Key header (CRON_SECRET). Vercel's free plan only allows daily timers, and new-lead
// pushes can't wait a day.
//
// Each tick:
//   1. new_lead pushes (L1 "New Instagram lead: <name>"): every social-media lead created in the last 24 hours that
//      nobody has touched yet, to its owner, once (notifications.dedupe_key).
//   2. the morning summary (L1 "6 days in a row · 7 on today's list"; the streak in days only,
//      like the Today streak tile, Yousef 2026-10-23), once a business day,
//      on the first tick from 7:30 AM Toronto.
//   3. orders n8n did not accept when they were placed are sent again (resendOrders, once-only key; F22). With the
//      order_dispatch switch on (api/_dispatch.js, 2026-10-23) queued orders are retried with counted tries instead.
//   4. the Gmail pull (api/_gmail.js), with what is left of the time.
const crypto = require('crypto');
const { db, asUser } = require('./_db');
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
  if (op === 'wires') return send(res, 200, await wires(db()));
  if (op !== 'tick') throw fail(400, 'unknown_op');
  const started = Date.now();
  const sql = db();
  // 0. Meta lead-form leads straight into v2 first (Yousef 2026-10-27), so this tick's new-lead pushes include them
  const out = { meta: await require('./_meta').sync(sql).catch((e) => ({ error: e.message })) };
  Object.assign(out, { leads: await newLeads(sql), morning: await morning(sql), orders: await sendOrders(sql) });
  // 5. what reps and integrations wrote to HubSpot since the last tick (owner 2026-10-27: everything hooked up), read only
  out.hubspot = !(await require('./_flags').on(sql, 'hubspot_pull')) ? { off: true } : await require('./intake').sync(sql, Math.min(25000, Math.max(5000, 35000 - (Date.now() - started)))).catch((e) => ({ error: e.message }));
  out.gmail = await require('./_gmail').sync(sql, Math.max(5000, 45000 - (Date.now() - started))).catch((e) => ({ error: e.message }));
  send(res, 200, out);
});

async function newLeads(sql) {
  const leads = await sql`
    select c.id, c.first_name, c.last_name, c.owner_id
      from contacts c join users u on u.id = c.owner_id and u.is_active is not false   -- never to a switched-off rep's phone
     where c.lead_source = ${'social'} and c.owner_id is not null and c.deleted_at is null and c.created_at > now() - interval '24 hours'
       and not exists (select 1 from interactions i where i.contact_id = c.id and i.deleted_at is null and i.status is distinct from 'cancelled')
       and not exists (select 1 from notifications n where n.dedupe_key = 'new_lead:' || c.id::text)`;
  let sent = 0;
  for (const l of leads) {
    const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'someone new';
    const r = await push.notify(sql, l.owner_id, { kind: 'new_lead', contactId: l.id, dedupeKey: 'new_lead:' + l.id,
      title: 'New Meta lead: ' + name,
      body: 'Reach out today', url: '/person/' + l.id });
    sent += r.sent || 0;
  }
  return { found: leads.length, sent };
}

// The morning notification's title: the streak in days, as the Today tile shows it (Yousef 2026-10-23).
const morningTitle = (streak) => streak ? streak + (streak === 1 ? ' day' : ' days') + ' in a row' : 'Good morning';

async function morning(sql) {
  const now = new Date();
  const today = T.ymd(now);
  const cfg = await B.settings(sql);
  if (!T.isBusinessDay(today, cfg.holidays) || now < T.atLocal(today, 7, 30) || now > T.atLocal(today, 11, 0)) return { skipped: 'not_now' };
  const users = await sql`
    select distinct u.id, u.full_name, u.email, u.preferences from users u join connections c on c.user_id = u.id and c.provider = 'push' and c.status = 'connected'
     where u.is_active is not false
       and not exists (select 1 from notifications n where n.dedupe_key = 'morning:' || u.id::text || ':' || ${today})`;
  let sent = 0;
  for (const u of users) {
    const me = { id: u.id, name: u.full_name, preferences: u.preferences && typeof u.preferences === 'object' && !Array.isArray(u.preferences) ? u.preferences : {} };
    const [{ people }, day] = await Promise.all([B.book(sql, me, { cfg }), B.dayStats(sql, me, cfg)]);
    const list = B.todayList(people, me, cfg);
    if (!list.length && !day.streak) continue;   // nothing worth a notification
    const visits = list.filter((x) => x.action === 'visit').length;
    const title = morningTitle(day.streak);
    const body = list.length + ' on today\'s list' + (visits ? ' · ' + visits + (visits === 1 ? ' visit' : ' visits') : '');   // F1 wording (Pulse UI 2026-10-27)
    const r = await push.notify(sql, u.id, { kind: 'morning_summary', dedupeKey: 'morning:' + u.id + ':' + today, title, body, url: '/' });
    sent += r.sent || 0;
  }
  return { users: users.length, sent };
}

// Orders n8n did not accept when they were placed (down, timed out or refused: F22, Yousef 2026-10-21): every tick
// sends them again, with the same once-only key (api/_n8n.js), until n8n accepts one (then change_logs 'send' is
// written and it is never sent again). Only orders placed in My Fifty, still waiting on approval, from the last 7
// days; never fictional (demo / test-run) ones. Nothing happens while n8n is not connected.
// Order dispatch (risk #4, 2026-10-23): with settings order_dispatch.pulse or .edge on, queued orders (Pulse's and
// Edge's) are retried by api/_dispatch.js: tries counted, the error kept, failed + a task for info@ after max_attempts.
// The old resend still runs for orders the dispatcher never queued (placed while the switch was off).
async function sendOrders(sql) {
  const D = require('./_dispatch');
  const cfg = await D.anyOn(sql);
  if (!cfg) return resendOrders(sql);
  // Kill switch (settings flags.order_dispatch, api/_flags.js): off = no dispatch retries; queued orders wait (nothing is
  // sent twice), and the old resend still covers orders the dispatcher never queued.
  if (!(await require('./_flags').on(sql, 'order_dispatch'))) return { dispatch: 'off_by_flag', old: await resendOrders(sql, true) };
  const dispatch = await D.retry(sql, (fn) => asUser(null, fn), { cfg, source: 'my_fifty' });
  return Object.assign({ dispatch }, { old: await resendOrders(sql, true) });
}

async function resendOrders(sql, notQueued) {
  if (!String(process.env.N8N_MYFIFTY_URL || '').trim()) return { skipped: 'n8n_not_connected' };
  const waiting = await sql`
    select o.id, o.contact_id from orders o join contacts c on c.id = o.contact_id left join users u on u.id = o.rep_id
     where o.status = ${'submitted'} and o.deleted_at is null and o.placed_by_id is not null and o.submitted_at > now() - interval '7 days'
       and coalesce(o.legacy_id, '') not like 'demo%' and coalesce(c.legacy_id, '') not like 'demo%'
       and coalesce(c.email::text, '') not like '%@demo.invalid' and coalesce(u.email::text, '') not like '%@demo.invalid'
       and not exists (select 1 from change_logs l where l.entity_type = 'orders' and l.entity_id = o.id and l.action = 'send')
       ${notQueued ? sql`and o.dispatch_status is null` : sql``}
     order by o.submitted_at limit 20`;
  let sent = 0;
  for (const o of waiting) {
    const r = await require('./_n8n').call('order', { orderId: o.id });
    if (!r.queued) break;   // still down: try again next tick
    await sql`insert into change_logs (actor_kind, source, action, entity_type, entity_id, contact_id, note)
              values ('system', 'my_fifty', 'send', 'orders', ${o.id}, ${o.contact_id}, 'Sent for approval (again, after n8n was unreachable)')`;
    sent++;
  }
  return { waiting: waiting.length, sent };
}

// Wire payments to follow up today (GET /api/cron?op=wires, called once a day by n8n, which only sends what comes
// back). Each rep gets their heads-ups (5 days before the due date) and overdue wires; info@ gets every overdue wire
// with a "Mark as received" button. Overdue ones come again every 7 days until received (api/_wire.js).
// Fictional data (demo and test-run rows, @demo.invalid people) is never included.
const INFO = 'info@renellence.com';
async function wires(sql, now) {
  const W = require('./_wire');
  const fallback = await W.defaultTerms(sql);
  const rows = await sql`
    select o.id, o.order_number, o.payment_method::text, o.submitted_at, o.invoiced_at, o.created_at, o.payment_terms_days,
           p.amount::float8 as amount, p.status::text as pay_status, p.paid_at,
           c.first_name, c.last_name, c.designation, c.email, cl.name as clinic, u.full_name as rep_name, u.email as rep_email
      from orders o
      join payments p on p.order_id = o.id and p.kind = 'charge' and p.method = 'wire' and p.status = 'pending'
      join contacts c on c.id = o.contact_id
      left join clinics cl on cl.id = c.clinic_id
      left join users u on u.id = o.rep_id
     where o.payment_method = ${'wire'} and o.deleted_at is null and o.status not in ('rejected', 'cancelled')
       and coalesce(o.legacy_id, '') not like 'demo%' and coalesce(c.legacy_id, '') not like 'demo%'
       and coalesce(c.email::text, '') not like '%@demo.invalid' and coalesce(u.email::text, '') not like '%@demo.invalid'
     order by o.submitted_at`;
  const [admin] = await sql`select id from users where lower(email::text) = ${INFO} and is_active is not false`;
  const base = process.env.PUBLIC_URL || 'https://my-fifty.vercel.app';
  const items = [];
  for (const r of rows) {
    const s = W.state(r, { status: r.pay_status, paid_at: r.paid_at }, fallback, now);
    const why = W.followUp(s);
    if (!why) continue;
    items.push({ why, s, r, customer: B.fullName(r), money: '$' + (Number(r.amount) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      link: admin && why === 'overdue' ? W.link(base, r.id, admin.id, now) : null });
  }
  const emails = [];
  const byRep = {};
  for (const it of items) if (it.r.rep_email) (byRep[it.r.rep_email] = byRep[it.r.rep_email] || []).push(it);
  for (const [to, list] of Object.entries(byRep)) {
    emails.push({ to: [to], subject: 'Wire payments to follow up (' + list.length + ')',
      html: wireEmail('Hi ' + esc(String(list[0].r.rep_name || '').split(/\s+/)[0] || 'there') + ',', 'These wire payments from your customers need a follow-up:', list, false) });
  }
  const overdue = items.filter((it) => it.why === 'overdue');
  if (overdue.length) {
    emails.push({ to: [INFO], subject: 'Overdue wire payments (' + overdue.length + ')',
      html: wireEmail('Hi,', 'These wire payments are past their due date. When the money arrives, press "Mark as received".', overdue, true) });
  }
  return { date: T.ymd(now), headsUp: items.length - overdue.length, overdue: overdue.length, emails };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function wireEmail(hello, intro, list, buttons) {
  const row = (it) => '<tr>'
    + '<td style="padding:8px;border-bottom:1px solid #E6E8EE">' + esc(it.customer) + (it.r.clinic ? '<br><span style="color:#6B7486">' + esc(it.r.clinic) + '</span>' : '') + '</td>'
    + '<td style="padding:8px;border-bottom:1px solid #E6E8EE">' + esc(it.r.order_number ? '#' + String(it.r.order_number).replace(/^#/, '') : 'Order of ' + T.short(it.r.submitted_at)) + '</td>'
    + '<td style="padding:8px;border-bottom:1px solid #E6E8EE;text-align:right">' + esc(it.money) + '</td>'
    + '<td style="padding:8px;border-bottom:1px solid #E6E8EE">' + esc(it.why === 'overdue' ? it.s.daysLate + (it.s.daysLate === 1 ? ' day' : ' days') + ' overdue (due ' + T.short(it.s.due + 'T12:00:00Z') + ')' : 'Due ' + T.short(it.s.due + 'T12:00:00Z') + ' (in ' + it.s.daysToDue + ' days)') + '</td>'
    + (buttons ? '<td style="padding:8px;border-bottom:1px solid #E6E8EE">' + esc(it.r.rep_name || '') + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #E6E8EE">' + (it.link ? '<a href="' + esc(it.link) + '" style="background:#1170C0;color:#FFFFFF;padding:6px 10px;border-radius:6px;text-decoration:none;white-space:nowrap">Mark as received</a>' : '') + '</td>' : '')
    + '</tr>';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1D2433">'
    + '<p>' + hello + '</p><p>' + esc(intro) + '</p>'
    + '<table cellspacing="0" style="border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#6B7486">'
    + '<th style="padding:8px">Customer</th><th style="padding:8px">Order</th><th style="padding:8px;text-align:right">Amount</th><th style="padding:8px">Due</th>'
    + (buttons ? '<th style="padding:8px">Rep</th><th style="padding:8px"></th>' : '') + '</tr>'
    + list.map(row).join('') + '</table></div>';
}

// Exposed for the unit tests only.
module.exports._ = { authorised, newLeads, morning, morningTitle, wires, resendOrders, sendOrders };
