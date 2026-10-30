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
//   5. info@ inbox leads to the territory rep (api/_inboxleads.js).
const crypto = require('crypto');
const { db, asUser } = require('./_db');
const { send, query, route, fail } = require('./_http');
const B = require('./_book');
const T = require('./_time');
const push = require('./_push');

function isfKey(req) {
  const want = String(process.env.PULSE_ISF_KEY || '').trim();
  const got = String(req.headers['x-edge-isf'] || '');
  const a = Buffer.from(got), b = Buffer.from(want);
  return !!want && a.length === b.length && crypto.timingSafeEqual(a, b);
}
// The new Edge's calls (go-live 2026-10-30): Edge cannot hold Pulse's sales-form key or Gmail secret (Vercel never hands
// back a "sensitive" value), so it asks Pulse to do these with the intake secret both already share (X-Intake-Secret).
function intakeKey(req) {
  const want = String(process.env.N8N_INTAKE_SECRET || '');
  const got = String(req.headers['x-intake-secret'] || '');
  const a = Buffer.from(got), b = Buffer.from(want);
  return !!want && a.length === b.length && crypto.timingSafeEqual(a, b);
}
// POST /api/cron?op=edge_send  { what: 'order' | 'paylink', orderId } | { what: 'email', userId, to, subject, text }
// -> the same answer Pulse's own send gives (api/_isf.js send / resendPayLink, api/_gmail.js send).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function edgeSend(sql, b) {
  if (b.what === 'order' || b.what === 'paylink') {
    if (!UUID.test(String(b.orderId || ''))) throw fail(400, 'bad_id');
    const I = require('./_isf');
    return b.what === 'order' ? I.send(sql, b.orderId) : I.resendPayLink(sql, b.orderId);
  }
  if (b.what === 'email') {
    if (!UUID.test(String(b.userId || ''))) throw fail(400, 'bad_id');
    const [u] = await sql`select id, email::text as email, full_name as name from users where id = ${b.userId} and is_active`;
    if (!u) throw fail(404, 'not_found');
    return require('./_gmail').send(sql, u, { to: String(b.to || ''), subject: String(b.subject || ''), text: String(b.text || '') });
  }
  throw fail(400, 'bad_what');
}
function authorised(req) {
  const want = process.env.CRON_SECRET || '';
  const got = String(req.headers['x-cron-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '');
  const a = Buffer.from(got), b = Buffer.from(want);
  return !!want && a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = route(async (req, res) => {
  const op = query(req).get('op') || 'tick';
  // The daily wire list is also read by n8n's [DIGEST] with the Pulse ISF key it already holds (owner 2026-10-27)
  if (op === 'wires' && (authorised(req) || isfKey(req))) return send(res, 200, await wires(db()));
  // The sales form's approval answer for an order Pulse sent (owner 2026-10-28: "I disapproved it and Pulse still says
  // waiting on approval"): POSTed by the workflow's "Pulse: Order Decision" step with the same key.
  if (op === 'order_decision' && req.method === 'POST' && isfKey(req)) return send(res, 200, await orderDecision(db(), await require('./_http').body(req)));
  // Decision 1 (owner 2026-10-28): the sales form asks here before it starts on an order Pulse sent, so a resend of the
  // same order (a retry after a lost answer) never makes a second invoice or charge.
  if (op === 'ping_rsvp' && req.method === 'POST' && isfKey(req)) return send(res, 200, await pingRsvp(db(), await require('./_http').body(req)));
  // The ad-leads feed for n8n "[DIGEST] Leads Master: Meta Leads" (owner 2026-10-28: Pulse reads Meta directly; repoint the
  // node here from Edge's /api/reports?kind=adleads-feed at the switch). Same answer and since / sinceMs as Edge's.
  if (op === 'adleads_feed' && req.method === 'GET' && isfKey(req)) return send(res, ...(await adleadsFeed(req)));
  if (op === 'order_claim' && req.method === 'POST' && isfKey(req)) return send(res, 200, await orderClaim(db(), await require('./_http').body(req)));
  // What n8n looks up, from v2 instead of HubSpot (data-flow improvement 4; api/_lookup.js): read only, Pulse ISF key.
  if (op === 'lookup' && req.method === 'GET' && isfKey(req)) return send(res, 200, await require('./_lookup').lookup(db(), query(req)));
  if (op === 'edge_send' && req.method === 'POST' && intakeKey(req)) return send(res, 200, await edgeSend(db(), await require('./_http').body(req)));
  if (!authorised(req)) throw fail(401, 'not_allowed');
  if (op !== 'tick') throw fail(400, 'unknown_op');
  // The tick in parts (data-flow improvement 5, owner 2026-10-28): pg_cron calls each part on its own every 5 minutes, so the
  // long pulls each get a whole Vercel run instead of sharing one minute. No part (the old single timer job) = all of them.
  const part = query(req).get('part') || 'all';
  if (!['all', 'core', 'hubspot', 'sync'].includes(part)) throw fail(400, 'unknown_part');
  const started = Date.now(), whole = part !== 'all';
  const sql = db();
  const out = { part };
  if (part === 'all' || part === 'core') {
    // 0. Meta lead-form leads straight into v2 first (Yousef 2026-10-27), so this tick's new-lead pushes include them
    out.meta = await require('./_meta').sync(sql).catch((e) => ({ error: e.message }));
    Object.assign(out, { leads: await newLeads(sql), morning: await morning(sql), nudge: await nudge(sql), alerts: await appAlerts(sql).catch((e) => ({ error: e.message })), forecast: await forecastSnapshot(sql).catch((e) => ({ error: e.message })), orders: await sendOrders(sql) });
    // Stripe events still waiting for their order (data-flow improvement 1)
    out.stripe = await require('./_stripe').retryPending(sql).catch((e) => ({ error: e.message }));
  }
  if (part === 'all' || part === 'hubspot') {
    // 5. what reps and integrations wrote to HubSpot since the last tick (owner 2026-10-27: everything hooked up), read only: the bridge
    out.hubspot = !(await require('./_flags').on(sql, 'hubspot_pull')) ? { off: true } : await require('./intake').sync(sql, whole ? 40000 : Math.min(25000, Math.max(5000, 35000 - (Date.now() - started)))).catch((e) => ({ error: e.message }));
  }
  if (part === 'all' || part === 'sync') {
    // 6. SignatureAPI: new envelopes and the waiting ones' signatures (owner 2026-10-27); then Gmail with the time left
    out.signatureapi = await require('./_sigapi').sync(sql, whole ? 15000 : Math.min(12000, Math.max(4000, 40000 - (Date.now() - started)))).catch((e) => ({ error: e.message }));
    out.gmail = await require('./_gmail').sync(sql, Math.max(5000, (whole ? 48000 : 45000) - (Date.now() - started))).catch((e) => ({ error: e.message }));
  }
  // info@ inbox leads -> the territory rep (owner 2026-10-29; api/_inboxleads.js), with Claude reading the mail
  if (part === 'all' || part === 'core') out.inboxLeads = await require('./_inboxleads').run(sql, 57000 - (Date.now() - started)).catch((e) => ({ error: e.message }));
  // Freshness alarms to tech@ (data-flow improvement 6): read from what is already kept, nothing recorded per tick
  if (part === 'all' || part === 'core') out.alarms = await require('./_alarms').check(sql).catch((e) => ({ error: e.message }));
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

// The once-only ledger is ingest_events (UNIQUE source + external_id; renellence-ops/ops/n8n/order-dispatch-proposal.md):
// the first claim of 'order:<id>:received' answers first: true, every later one first: false. Only real Pulse orders.
async function orderClaim(sql, b) {
  const id = String((b && b.pulseOrderId) || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return { ok: false, reason: 'bad_request' };
  const [o] = await sql`select id from orders where id = ${id} and placed_by_id is not null`;
  if (!o) return { ok: false, reason: 'not_a_pulse_order' };   // the sales form carries on as it does today
  const [row] = await sql`insert into ingest_events (source, external_id, payload, received_via, received_at, status, attempts, processed_at, result_table, result_id)
    values ('n8n', ${'order:' + id + ':received'}, ${sql.json({ step: 'received', orderId: id })}, 'n8n', now(), 'done', 1, now(), 'orders', ${id})
    on conflict (source, external_id) do nothing returning id`;
  return { ok: true, first: !!row };
}

// Live Edge's alerts, on v2 (owner 2026-10-28: the sandbox gets everything live Edge does; docs/go-live-inventory.md rows
// 80-83, 62). Pulse is the reps' phone app, so its phone notifications carry them, every tick:
//   a booked visit, 30 minutes before (scheduled meetings in interactions; live Edge's QStash meeting reminder)
//   a new order and a new RSVP, to every admin with a phone connected (live Edge's 5-minute "watch" to info@)
// Each is sent once (notifications dedupe key). Fictional rows (demo-) never notify.
async function appAlerts(sql) {
  const out = { meetings: 0, orders: 0, rsvps: 0 };
  if (!(await require('./_flags').on(sql, 'edge_alerts'))) return { skipped: 'off_until_edge_cutover' };
  const meets = await sql`
    select i.id, i.user_id, i.occurred_at, c.first_name, c.last_name, coalesce(cl.name, '') as clinic
      from interactions i join contacts c on c.id = i.contact_id left join clinics cl on cl.id = c.clinic_id
     where i.kind = 'meeting' and i.status = 'scheduled' and i.deleted_at is null and i.user_id is not null
       and i.occurred_at between now() + interval '20 minutes' and now() + interval '40 minutes'
       and coalesce(c.legacy_id, '') not like 'demo-%'`;
  for (const m of meets) {
    const at = new Date(m.occurred_at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).replace(/\s?([ap])\.?m\.?/i, (x, y) => ' ' + y.toUpperCase() + 'M');
    const who = [m.first_name, m.last_name].filter(Boolean).join(' ');
    const r = await push.notify(sql, m.user_id, { kind: 'meeting_reminder', dedupeKey: 'meet:' + m.id, title: 'Visit at ' + at, body: who + (m.clinic ? ' · ' + m.clinic : ''), url: '/' });
    out.meetings += r.sent || 0;
  }
  const admins = await sql`select distinct u.id from users u join connections c on c.user_id = u.id and c.provider = 'push' and c.status = 'connected'
     where u.kind = 'admin' and u.is_active is not false`;
  if (!admins.length) return out;
  const orders = await sql`
    select o.id, coalesce(cl.name, c.first_name || ' ' || coalesce(c.last_name, '')) as who,
           (select coalesce(sum(case when l.is_free then 0 else l.quantity * coalesce(l.unit_price, 0) end), 0) from order_lines l where l.order_id = o.id)::float8 as total
      from orders o join contacts c on c.id = o.contact_id left join clinics cl on cl.id = c.clinic_id
     where o.created_at > now() - interval '30 minutes' and o.deleted_at is null and coalesce(o.legacy_id, '') not like 'demo-%' and coalesce(c.legacy_id, '') not like 'demo-%'`;
  const rsvps = await sql`
    select a.id, coalesce(nullif(trim(coalesce(c.first_name, a.first_name, '') || ' ' || coalesce(c.last_name, a.last_name, '')), ''), 'Someone') as who, e.name as event
      from attendees a join events e on e.id = a.event_id left join contacts c on c.id = a.contact_id
     where a.status = 'rsvp' and a.created_at > now() - interval '30 minutes' and e.name not like '%(demo)%'`;
  for (const a of admins) {
    for (const o of orders) {
      const r = await push.notify(sql, a.id, { kind: 'new_order', dedupeKey: 'neworder:' + o.id + ':' + a.id, title: 'New order', body: String(o.who || '').trim() + (o.total ? ' · $' + Math.round(o.total).toLocaleString('en-CA') : ' · samples'), url: '/' });
      out.orders += r.sent || 0;
    }
    for (const v of rsvps) {
      const r = await push.notify(sql, a.id, { kind: 'rsvp', dedupeKey: 'rsvp:' + v.id + ':' + a.id, title: 'New RSVP', body: v.who + ' · ' + v.event, url: '/' });
      out.rsvps += r.sent || 0;
    }
  }
  return out;
}

// n8n's ad-leads feed (op=adleads_feed): every Meta lead since a day (since=YYYY-MM-DD, Toronto midnight) or an exact moment
// (sinceMs). A date that can't be read is a 400, never "every lead ever". Meta not set up is a 503.
async function adleadsFeed(req) {
  const q = query(req);
  const ms = Number(q.get('sinceMs'));
  const day = String(q.get('since') || '').slice(0, 10);
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [400, { error: 'bad_since' }];
  const since = ms > 0 ? ms : Date.parse((day || '2026-10-05') + 'T00:00:00-04:00');
  if (!isFinite(since)) return [400, { error: 'bad_since' }];
  const M = require('./_metaleads');
  if (!M.ready()) return [503, { error: 'meta_not_connected' }];
  try { return [200, await M.leadsSince(since)]; } catch (e) { console.error('ADLEADS_FEED', e.message); return [502, { error: e.message }]; }
}

// The instant RSVP ping n8n sends after a launch-event form (live Edge's POST /api/me?ping=rsvp, the "[REG] Liberty Grand
// RSVP" workflow's "Notify Edge (instant)" step; repoint it here at the cut-over): a phone notification to every admin.
async function pingRsvp(sql, b) {
  const who = String((b && (b.name || [b.firstName, b.lastName].filter(Boolean).join(' '))) || '').trim().slice(0, 120) || 'Someone';
  const event = String((b && (b.event || b.eventName)) || 'the launch event').trim().slice(0, 120);
  const key = 'rsvpping:' + require('crypto').createHash('sha1').update(who.toLowerCase() + '|' + event.toLowerCase() + '|' + T.ymd()).digest('hex').slice(0, 16);
  const admins = await sql`select distinct u.id from users u join connections c on c.user_id = u.id and c.provider = 'push' and c.status = 'connected'
     where u.kind = 'admin' and u.is_active is not false`;
  let sent = 0;
  for (const a of admins) sent += (await push.notify(sql, a.id, { kind: 'rsvp', dedupeKey: key + ':' + a.id, title: 'New RSVP', body: who + ' · ' + event, url: '/' })).sent || 0;
  return { ok: true, admins: admins.length, sent };
}

// Aria's answer on a Pulse order. Not approved: the order is 'rejected' (Pulse shows "Disapproved"). Approved: 'approved'
// with approved_at, until the sales form's HubSpot order comes back through the intake and takes over its status. Only an
// order Pulse placed that is still waiting on approval changes; anything else is answered and left alone.
async function orderDecision(sql, b) {
  const id = String((b && b.pulseOrderId) || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof b.approved !== 'boolean') return { ok: false, reason: 'bad_request' };
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'n8n', true), set_config('app.user_id', '', true)`;
    const rows = b.approved
      ? await tx`update orders set status = 'approved', approved_at = coalesce(approved_at, now()) where id = ${id} and placed_by_id is not null and status = 'submitted' returning id`
      : await tx`update orders set status = 'rejected' where id = ${id} and placed_by_id is not null and status = 'submitted' returning id`;
    if (!rows.length) return { ok: true, changed: false };
    return { ok: true, changed: true, status: b.approved ? 'approved' : 'rejected' };
  });
}

// The month's forecast as it stood on the 1st (owner 2026-10-28; run 4: Compass's "Forecast accuracy" card reads
// metric_snapshots 'forecast' for the 1st and nothing wrote it). The first tick of each month saves, for every active
// rep, what their book has forecast for that month (the same sum Compass commits at the monthly 1-on-1). Once a month:
// a snapshot already there is never changed. Only on the 1st or 2nd (a tick missed on the 1st).
async function forecastSnapshot(sql, now) {
  const today = T.ymd(now || new Date()), month = today.slice(0, 7), first = month + '-01';
  if (today > month + '-02') return { skipped: 'not_start_of_month' };   // a snapshot taken later would not be "as it stood on the 1st"
  const reps = await sql`select u.id from users u where u.kind = 'rep' and u.is_active is not false
    and not exists (select 1 from metric_snapshots m where m.rep_id = u.id and m.metric = 'forecast' and m.snapshot_date = ${first})`;
  if (!reps.length) return { skipped: 'done_this_month' };
  const cfg = await B.settings(sql);
  let saved = 0;
  for (const r of reps) {
    const { people } = await B.book(sql, { id: r.id, preferences: {} }, { cfg });
    const ids = people.map((p) => p.id);
    const [sum] = ids.length ? await sql`select coalesce(sum(coalesce(syringes, 0) * coalesce(syringe_price, 0) + coalesce(cannula_boxes, 0) * coalesce(cannula_box_price, 0)
        + coalesce(needle_boxes, 0) * coalesce(needle_box_price, 0)), 0)::float8 as v, count(*)::int as n
      from forecasts where contact_id = any(${ids}) and deleted_at is null and to_char(due_date, 'YYYY-MM') = ${month}` : [{ v: 0, n: 0 }];
    const done = await sql`insert into metric_snapshots (snapshot_date, rep_id, metric, metric_value, details)
      values (${first}, ${r.id}, 'forecast', ${sum.v}, ${sql.json({ forecasts: sum.n, taken_at: new Date().toISOString() })})
      on conflict (snapshot_date, rep_id, metric) do nothing returning id`;
    saved += done.length;
  }
  return { reps: reps.length, saved };
}

// Nell's 3 pm nudge (Final Mockup (3) N4, owner 2026-10-28): on a workday between 3:00 and 3:30 pm Toronto, a rep with a
// phone connected who is under the day goal and has counted nothing since noon gets "2 more keeps your 12-day streak
// alive". Once a day (notifications dedupe key). Pulse records no app opens, so "not opened since noon" is read as
// "nothing logged since noon" (owner 2026-10-28).
async function nudge(sql, now) {
  now = now || new Date();
  const today = T.ymd(now);
  const cfg = await B.settings(sql);
  if (!T.isBusinessDay(today, cfg.holidays) || now < T.atLocal(today, 15, 0) || now > T.atLocal(today, 15, 30)) return { skipped: 'not_now' };
  const noon = T.atLocal(today, 12, 0);
  const users = await sql`
    select distinct u.id, u.full_name, u.preferences from users u join connections c on c.user_id = u.id and c.provider = 'push' and c.status = 'connected'
     where u.is_active is not false and u.kind = 'rep'
       and not exists (select 1 from notifications n where n.dedupe_key = 'nudge:' || u.id::text || ':' || ${today})
       and not exists (select 1 from interactions i where i.user_id = u.id and i.deleted_at is null and i.occurred_at >= ${noon}
                         and (${B.CALL(sql)} or (i.kind = 'meeting' and i.mode in ('in_person', 'video'))) and not ${B.INBOUND(sql)} and ${B.REACHED(sql)})`;
  let sent = 0;
  for (const u of users) {
    const day = await B.dayStats(sql, { id: u.id }, cfg);
    if (day.done >= day.goal) continue;
    const left = day.goal - day.done;
    const body = day.streak ? left + ' more keeps your ' + day.streak + '-day streak alive' : left + ' more ' + (left === 1 ? 'starts' : 'start') + ' a new streak';
    const r = await push.notify(sql, u.id, { kind: 'streak_nudge', dedupeKey: 'nudge:' + u.id + ':' + today, title: 'Still time today', body, url: '/' });
    sent += r.sent || 0;
  }
  return { users: users.length, sent };
}

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
  // Orders go through the Internal Sales Form (api/_isf.js) when N8N_MYFIFTY_URL is empty (it is not set in Vercel), so a failed send is retried there too (run 4).
  if (!String(process.env.N8N_MYFIFTY_URL || '').trim() && !require('./_isf').configured()) return { skipped: 'n8n_not_connected' };
  const waiting = await sql`
    select o.id, o.contact_id from orders o join contacts c on c.id = o.contact_id left join users u on u.id = o.rep_id
     where o.status = ${'submitted'} and o.deleted_at is null and o.placed_by_id is not null and o.submitted_at > now() - interval '7 days'
       -- not one placed in the last 2 minutes: its own send may still be on its way (data-flow audit 2026-10-28: a tick
       -- 1 s after an order sent it a second time while the rep's send was still waiting for n8n's answer)
       and o.submitted_at < now() - interval '2 minutes'
       and coalesce(o.legacy_id, '') not like 'demo%' and coalesce(c.legacy_id, '') not like 'demo%'
       and coalesce(c.email::text, '') not like '%@demo.invalid' and coalesce(u.email::text, '') not like '%@demo.invalid'
       and not exists (select 1 from change_logs l where l.entity_type = 'orders' and l.entity_id = o.id and l.action = 'send')
       and exists (select 1 from change_logs l where l.entity_type = 'orders' and l.entity_id = o.id and l.action = 'create' and l.source = 'my_fifty')   -- only orders Pulse placed (Edge's go to the form themselves)
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
  const base = process.env.PUBLIC_URL || 'https://pulse.renellence.com';
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
module.exports._ = { authorised, newLeads, morning, nudge, forecastSnapshot, orderDecision, orderClaim, appAlerts, pingRsvp, morningTitle, wires, resendOrders, sendOrders, edgeSend, intakeKey };
