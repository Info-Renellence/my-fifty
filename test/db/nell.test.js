// Nell's moments (Final Mockup (3) N1-N3, owner 2026-10-28): what a log and an order earn (api/_nell.js).
'use strict';
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');
const N = require('../../api/_nell');
const T = require('../../api/_time');

after(() => h.closeDb());

// n reached calls for the rep today (or `days` workdays back), one contact each.
async function logs(sql, me, n, at) {
  for (let i = 0; i < n; i++) await h.touch(sql, await h.contact(sql, me), me.id, { at: at || new Date() });
}
const cfgOf = async (sql) => Object.assign({}, await B.settings(sql), { daily_goal: 5 });
const run = async (sql, me, ctx) => { const cfg = await cfgOf(sql); return N.afterLog(sql, me, cfg, await B.dayStats(sql, me, cfg), Object.assign({ counted: true }, ctx || {})); };

describe('after a log', () => {
  test('the log that reaches the goal is Cheer; under the goal is nothing; a text that does not count is nothing', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await logs(sql, me, 4);
    assert.equal(await run(sql, me), null, '4 of 5: no moment');
    await logs(sql, me, 1);
    const m = await run(sql, me);
    assert.equal(m.kind, 'cheer');
    assert.equal(m.kicker, 'STREAK SAVED');
    assert.equal(await run(sql, me, { counted: false }), null, 'a log that does not count earns nothing');
  }));

  test('more logs than any day before (and over the goal) is a Jackpot record, once a day, saved to the wins', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await logs(sql, me, 6, new Date(Date.now() - 3 * T.DAY));
    await logs(sql, me, 7);
    const m = await run(sql, me);
    assert.equal(m.kind, 'jackpot');
    assert.equal(m.title, '7 in a day');
    assert.match(m.sub, /Previous best: 6/);
    const [u] = await sql`select preferences from users where id = ${me.id}`;
    assert.equal(u.preferences.nell_wins.length, 1, 'kept for Rewards');
    assert.equal(N.wins({ preferences: u.preferences })[0].when, 'Today');
    await logs(sql, me, 1);
    assert.equal(await run(sql, me), null, 'no second jackpot today, and 8 is past the goal so no Cheer either');
  }));

  test('a customer reached for the first time in 30+ days is a Jackpot "back in touch"', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'shipped', days: 90 });
    await h.touch(sql, c, me.id, { days: 45 });
    const i = await h.touch(sql, c, me.id, {});
    const m = await run(sql, me, { contactId: c, interactionId: i, name: 'Sample Person' });
    assert.equal(m.kind, 'jackpot');
    assert.equal(m.kicker, 'BACK IN TOUCH');
    assert.match(m.sub, /45 days/);
  }));

  test('a perfect week only on the week\'s last workday with every workday at the goal', () => {
    const cfg = { daily_goal: 5, holidays: [] };
    const by = { '2026-10-26': 5, '2026-10-27': 6, '2026-10-28': 5, '2026-10-29': 5, '2026-10-30': 5 };
    assert.equal(N.perfectWeek(by, '2026-10-30', cfg), 5, 'Friday, all five met');
    assert.equal(N.perfectWeek(by, '2026-10-29', cfg), 0, 'Thursday is not the last workday');
    assert.equal(N.perfectWeek(Object.assign({}, by, { '2026-10-27': 4 }), '2026-10-30', cfg), 0, 'one day short');
    assert.equal(N.perfectWeek(by, '2026-10-29', { daily_goal: 5, holidays: ['2026-10-30'] }), 4, 'Thursday before a Friday holiday');
  });
});

describe('payday', () => {
  test('2% on a person\'s first paid order, 4% once they have one; nothing for samples or someone else\'s order', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    const first = await N.payday(sql, me, c, me.id, 1000);
    assert.equal(first.amount, '$20');
    assert.equal(first.rate, '2%');
    await h.order(sql, c, me, { status: 'shipped', days: 10, paid: true });
    const again = await N.payday(sql, me, c, me.id, 1000);
    assert.equal(again.amount, '$40');
    assert.equal(again.rate, '4%');
    assert.match(again.balance, /^\$\d/);
    assert.equal(await N.payday(sql, me, c, me.id, 0), null, 'a sample order');
    assert.equal(await N.payday(sql, me, c, other.id, 1000), null, 'credited to another rep');
  }));
});

describe('the 3 pm nudge push', () => {
  const cron = require('../../api/cron');
  const P = require('../../api/_push');
  // A workday at 3:10 pm Toronto, and the push stubbed (v1 cannot store a 'streak_nudge' row: CHANGELOG-v2 #85).
  const at = (h, m) => T.atLocal('2026-10-28', h, m);
  const withPush = async (fn) => { const real = P.notify, sent = []; P.notify = async (s, id, n) => { sent.push({ id, n }); return { sent: 1 }; }; try { return await fn(sent); } finally { P.notify = real; } };
  const phone = (sql, u) => sql`insert into connections (user_id, provider, status) values (${u.id}, 'push', 'connected')`;

  test('only between 3:00 and 3:30 pm on a workday', () => h.withDb(async (sql) => withPush(async () => {
    assert.equal((await cron._.nudge(sql, at(14, 50))).skipped, 'not_now');
    assert.equal((await cron._.nudge(sql, at(15, 40))).skipped, 'not_now');
    assert.equal((await cron._.nudge(sql, T.atLocal('2026-10-31', 15, 10))).skipped, 'not_now', 'Saturday');
  })));

  test('a rep under the goal with nothing since noon gets it; one who logged since noon does not', () => h.withDb(async (sql) => withPush(async (sent) => {
    const quiet = await h.user(sql), busy = await h.user(sql);
    await phone(sql, quiet); await phone(sql, busy);
    await h.touch(sql, await h.contact(sql, quiet), quiet.id, { at: at(10, 0) });
    await h.touch(sql, await h.contact(sql, busy), busy.id, { at: at(13, 0) });
    await cron._.nudge(sql, at(15, 10));
    const mine = sent.filter((s) => s.id === quiet.id || s.id === busy.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, quiet.id);
    assert.equal(mine[0].n.kind, 'streak_nudge');
    assert.match(mine[0].n.body, /4 more start a new streak|more keeps your/);
  })));
});

describe('the forecast snapshot on the 1st (Compass forecast accuracy)', () => {
  const cron = require('../../api/cron');
  test('saves each active rep\'s forecast for the month once, and never changes it', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const month = T.ymd().slice(0, 7), on1st = T.atLocal(month + '-01', 9, 0);
    await sql`insert into forecasts (contact_id, rep_id, due_date, syringes, syringe_price) values (${c}, ${me.id}, ${month + '-20'}, 10, 225)`;
    await cron._.forecastSnapshot(sql, on1st);
    const [s] = await sql`select metric_value::float8 v from metric_snapshots where rep_id = ${me.id} and metric = 'forecast' and snapshot_date = ${month + '-01'}`;
    assert.equal(s.v, 2250);
    await sql`insert into forecasts (contact_id, rep_id, due_date, syringes, syringe_price) values (${c}, ${me.id}, ${month + '-21'}, 10, 225)`;
    await cron._.forecastSnapshot(sql, on1st);
    const [again] = await sql`select metric_value::float8 v from metric_snapshots where rep_id = ${me.id} and metric = 'forecast' and snapshot_date = ${month + '-01'}`;
    assert.equal(again.v, 2250, 'as it stood the first time');
    assert.equal((await cron._.forecastSnapshot(sql, T.atLocal(month + '-10', 9, 0))).skipped, 'not_start_of_month');
  }));
});

describe('the sales form\'s approval answer (op=order_decision)', () => {
  const cron = require('../../api/cron');
  test('not approved: a Pulse order waiting on approval becomes rejected ("Disapproved"); approved: approved; others untouched', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const a = await h.order(sql, c, me, { status: 'submitted' }), b = await h.order(sql, c, me, { status: 'submitted' }), shipped = await h.order(sql, c, me, { status: 'shipped' });
    assert.deepEqual(await cron._.orderDecision(sql, { pulseOrderId: a, approved: false }), { ok: true, changed: true, status: 'rejected' });
    assert.equal((await cron._.orderDecision(sql, { pulseOrderId: b, approved: true })).status, 'approved');
    assert.equal((await cron._.orderDecision(sql, { pulseOrderId: shipped, approved: false })).changed, false, 'only one still waiting on approval');
    assert.equal((await cron._.orderDecision(sql, { pulseOrderId: 'x', approved: false })).reason, 'bad_request');
    const st = Object.fromEntries((await sql`select id, status::text, approved_at from orders where id = any(${[a, b, shipped]})`).map((r) => [r.id, r]));
    assert.equal(st[a].status, 'rejected');
    assert.equal(st[b].status, 'approved'); assert.ok(st[b].approved_at);
    assert.equal(st[shipped].status, 'shipped');
  }));
});

describe('decision 1: the sales form claims a Pulse order once (op=order_claim)', () => {
  const cron = require('../../api/cron');
  test('the first claim goes on, a resend of the same order is a repeat; other ids are refused', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const id = await h.order(sql, c, me, { status: 'submitted' });
    assert.deepEqual(await cron._.orderClaim(sql, { pulseOrderId: id }), { ok: true, first: true });
    assert.deepEqual(await cron._.orderClaim(sql, { pulseOrderId: id.toUpperCase() }), { ok: true, first: false }, 'a retry of the same order');
    assert.equal((await cron._.orderClaim(sql, { pulseOrderId: 'order:' + id })).reason, 'bad_request');
    const [{ id: other }] = await sql`insert into orders (contact_id, channel, status) values (${c}, 'stripe', 'submitted') returning id`;
    assert.equal((await cron._.orderClaim(sql, { pulseOrderId: other })).reason, 'not_a_pulse_order');
  }));
});

describe('live Edge alerts on v2 (appAlerts / ping_rsvp, owner 2026-10-28)', () => {
  const cron = require('../../api/cron');
  const P = require('../../api/_push');
  const withPush = async (fn) => { const real = P.notify, sent = []; P.notify = async (s, id, n) => { sent.push({ id, n }); return { sent: 1 }; }; try { return await fn(sent); } finally { P.notify = real; } };
  const flag = (sql, on) => sql`insert into settings (key, value) values ('flags', ${sql.json({ edge_alerts: on })})
    on conflict (key) do update set value = coalesce(settings.value, '{}'::jsonb) || ${sql.json({ edge_alerts: on })}`;

  test('off until the cut-over; on: a visit 30 minutes away reminds its rep, a new order and an RSVP tell the admins', () => h.withDb(async (sql) => withPush(async (sent) => {
    require('../../api/_flags').clear();
    assert.equal((await cron._.appAlerts(sql)).skipped, 'off_until_edge_cutover');
    await flag(sql, true); require('../../api/_flags').clear();   // the switches are cached for 30 s
    const rep = await h.user(sql), admin = await h.user(sql, { kind: 'admin' });
    await sql`insert into connections (user_id, provider, status) values (${admin.id}, 'push', 'connected')`;
    const c = await h.contact(sql, rep, { first: 'Visita' });
    const [m] = await sql`insert into interactions (kind, contact_id, user_id, occurred_at, mode, status, source, created_by_id)
      values ('meeting', ${c}, ${rep.id}, now() + interval '30 minutes', 'in_person', 'scheduled', 'edge', ${rep.id}) returning id`;
    const o = await h.order(sql, c, rep, { status: 'submitted' });
    const [ev] = await sql`insert into events (name, kind, starts_at) values ('Unit Launch', 'launch', now() + interval '7 days') returning id`;
    await sql`insert into attendees (event_id, contact_id, status) values (${ev.id}, ${c}, 'rsvp')`;
    await cron._.appAlerts(sql);
    const mine = sent.filter((s) => s.id === rep.id || s.id === admin.id);
    assert.ok(mine.some((s) => s.id === rep.id && s.n.kind === 'meeting_reminder' && s.n.dedupeKey === 'meet:' + m.id), 'visit reminder to the rep');
    assert.ok(mine.some((s) => s.id === admin.id && s.n.kind === 'new_order' && s.n.dedupeKey.includes(o)), 'new order to the admin');
    assert.ok(mine.some((s) => s.id === admin.id && s.n.kind === 'rsvp' && /Unit Launch/.test(s.n.body)), 'RSVP to the admin');
  })));

  test('the RSVP ping from n8n tells every admin with a phone', () => h.withDb(async (sql) => withPush(async (sent) => {
    const admin = await h.user(sql, { kind: 'admin' });
    await sql`insert into connections (user_id, provider, status) values (${admin.id}, 'push', 'connected')`;
    const r = await cron._.pingRsvp(sql, { name: 'Unit Guest', event: 'Liberty Grand' });
    assert.ok(r.ok && r.admins >= 1);
    assert.ok(sent.some((s) => s.id === admin.id && s.n.body === 'Unit Guest · Liberty Grand'));
  })));
});
