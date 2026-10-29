// Wire payments against v2 (rolled back): terms on new orders, the daily follow-up list (api/cron.js op=wires), the
// "Mark as received" page (api/wire.js), and rewards still dating a wire order by the day it was placed.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/act').OPS;
const W = require('../../api/_wire');
const T = require('../../api/_time');
const R = require('../../api/_rewards');
const cron = require('../../api/cron');
const wire = require('../../api/wire');

after(() => h.closeDb());

async function ready(sql, me, o) {
  const c = await h.contact(sql, me, o);
  await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
  return c;
}
// A wire order placed on `day` (Toronto), as the app writes it.
async function wireOrder(sql, me, c, day, terms) {
  const id = await h.order(sql, c, me, { status: 'approved', method: 'wire', lines: [['SAF100', 2]] });
  await sql`update orders set submitted_at = ${T.atLocal(day, 10, 0)}, created_at = ${T.atLocal(day, 10, 0)}, payment_terms_days = ${terms} where id = ${id}`;
  await sql`insert into payments (order_id, kind, method, amount, currency, status, provider, is_test) values (${id}, 'charge', 'wire', 450, 'CAD', 'pending', 'wire', false)`;
  return id;
}
async function adminInfo(sql) {
  const [a] = await sql`select id from users where lower(email::text) = 'info@renellence.com'`;
  return a ? a.id : (await h.user(sql, { email: 'info@renellence.com', name: 'Info Admin', kind: 'admin' })).id;
}

describe('terms on new wire orders', () => {
  test('the customer\'s own terms are copied onto the order; otherwise the standard', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const own = await ready(sql, me), std = await ready(sql, me);
    await sql`update contacts set payment_terms_days = 45 where id = ${own}`;
    const a = await A.order(me, { contactId: own, payment: 'wire', lines: [{ sku: 'SAF100', qty: 1 }] });
    const b = await A.order(me, { contactId: std, payment: 'wire', lines: [{ sku: 'SAF100', qty: 1 }] });
    const c = await A.order(me, { contactId: std, lines: [{ sku: 'SAF100', qty: 1 }] });
    const t = Object.fromEntries((await sql`select id, payment_terms_days from orders where id = any(${[a.orderId, b.orderId, c.orderId]})`).map((r) => [r.id, r.payment_terms_days]));
    assert.equal(t[a.orderId], 45);
    assert.equal(t[b.orderId], 30);
    assert.equal(t[c.orderId], null, 'card orders have no terms');
  }));
  test('changing the standard terms changes new orders only', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    const before = await A.order(me, { contactId: c, payment: 'wire', lines: [{ sku: 'SAF100', qty: 1 }] });
    await sql`update settings set value = '{"default_terms_days": 60}'::jsonb where key = 'payments'`;
    const later = await A.order(me, { contactId: c, payment: 'wire', lines: [{ sku: 'SAF100', qty: 1 }] });
    const t = Object.fromEntries((await sql`select id, payment_terms_days from orders where id = any(${[before.orderId, later.orderId]})`).map((r) => [r.id, r.payment_terms_days]));
    assert.deepEqual([t[before.orderId], t[later.orderId]], [30, 60]);
  }));
});

describe('the daily wire follow-up (op=wires)', () => {
  test('the rep gets heads-ups and overdue ones; info@ gets overdue ones with a button', () => h.withDb(async (sql) => {
    await adminInfo(sql);
    const rep = await h.user(sql, { name: 'Robin Wireunit' });
    const c1 = await ready(sql, rep, { first: 'Hanna', last: 'Headsup' }), c2 = await ready(sql, rep, { first: 'Otto', last: 'Overdue' }), c3 = await ready(sql, rep, { first: 'Quinn', last: 'Quiet' });
    const now = T.atLocal('2026-11-01', 8, 0);
    const headsUp = await wireOrder(sql, rep, c1, '2026-10-07', 30);   // due Nov 6: 5 days away
    const overdue = await wireOrder(sql, rep, c2, '2026-10-01', 30);   // due Oct 31: 1 day late
    await wireOrder(sql, rep, c3, '2026-10-10', 30);                   // due Nov 9: nothing today
    const r = await cron._.wires(sql, now);
    const mine = r.emails.find((e) => e.to[0] === rep.email);
    assert.ok(mine, 'an email to the rep');
    assert.match(mine.subject, /^Wire payments to follow up \(2\)$/);
    assert.match(mine.html, /Hanna Headsup/);
    assert.match(mine.html, /Otto Overdue/);
    assert.doesNotMatch(mine.html, /Quinn Quiet/);
    assert.doesNotMatch(mine.html, /Mark as received/, 'reps get no button');
    // info@ can also own customers (the test database has some), so its own rep email may come first: take the overdue one.
    const info = r.emails.find((e) => e.to[0] === 'info@renellence.com' && /Otto Overdue/.test(e.html));
    assert.ok(info);
    assert.match(info.html, /Otto Overdue/);
    assert.doesNotMatch(info.html, /Hanna Headsup/, 'heads-ups go to the rep only');
    // the button for this order (the test database's own overdue wires have buttons too)
    const qs = [...info.html.matchAll(/href="([^"]+)"/g)].map((m) => Object.fromEntries(new URL(m[1].replace(/&amp;/g, '&')).searchParams));
    const q = qs.find((x) => x.o === overdue);
    assert.ok(q, 'a Mark as received button for the overdue order');
    assert.equal(W.verify(q, now.getTime()), true);
    void headsUp;
  }));
  test('received, cancelled and fictional (demo) wires are left out', () => h.withDb(async (sql) => {
    const rep = await h.user(sql), c = await ready(sql, rep);
    const now = T.atLocal('2026-11-01', 8, 0);
    const got = await wireOrder(sql, rep, c, '2026-10-01', 30);
    await sql`update payments set status = 'succeeded', paid_at = now() where order_id = ${got}`;
    const gone = await wireOrder(sql, rep, c, '2026-10-01', 30);
    await sql`update orders set status = 'cancelled' where id = ${gone}`;
    const demo = await wireOrder(sql, rep, c, '2026-10-01', 30);
    await sql`update orders set legacy_id = ${'demo-test-wire-' + h.uid()} where id = ${demo}`;
    const r = await cron._.wires(sql, now);
    assert.equal(r.emails.find((e) => e.to[0] === rep.email), undefined);
  }));
  test('the route needs the cron key', () => h.withDb(async () => {
    const res = h.fakeRes();
    await cron({ method: 'GET', url: '/api/cron?op=wires', headers: {} }, res);
    assert.equal(res.statusCode, 401);
    const ok = h.fakeRes();
    await cron({ method: 'GET', url: '/api/cron?op=wires', headers: { 'x-cron-key': 'test-cron-key' } }, ok);
    assert.equal(ok.statusCode, 200);
    assert.ok(Array.isArray(ok.json().emails));
  }));
});

describe('Mark as received (api/wire.js)', () => {
  const call = async (method, url, body) => { const res = h.fakeRes(); await wire({ method, url, headers: {}, body }, res); return res; };
  async function setup(sql) {
    const admin = await adminInfo(sql);
    const rep = await h.user(sql), c = await ready(sql, rep, { first: 'Mara', last: 'Markpaid' });
    const id = await wireOrder(sql, rep, c, T.addDays(T.ymd(), -40), 30);
    return { admin, rep, c, id, url: W.link('https://my-fifty.vercel.app', id, admin).replace('https://my-fifty.vercel.app', '') };
  }
  test('opening the link only shows the page; pressing the button marks it received on the day picked', () => h.withDb(async (sql) => {
    const s = await setup(sql);
    const page = await call('GET', s.url);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Mara Markpaid/);
    assert.match(page.body, /10 days overdue/);
    assert.equal((await sql`select status::text from payments where order_id = ${s.id}`)[0].status, 'pending', 'opening the link changes nothing');
    const day = T.addDays(T.ymd(), -2);
    const done = await call('POST', s.url, 'day=' + day);
    assert.equal(done.statusCode, 200);
    assert.match(done.body, /Marked as received/);
    const [p] = await sql`select status::text, paid_at from payments where order_id = ${s.id}`;
    assert.equal(p.status, 'succeeded');
    assert.equal(T.ymd(p.paid_at), day);
    const [log] = await sql`select actor_user_id from change_logs where entity_type = 'payments' and field_name = 'status' order by changed_at desc limit 1`;
    assert.equal(log.actor_user_id, s.admin, 'recorded as the admin');
    assert.match((await call('GET', s.url)).body, /Already received/);
  }));
  test('a future day, a changed link or a rep\'s link is refused', () => h.withDb(async (sql) => {
    const s = await setup(sql);
    assert.equal((await call('POST', s.url, 'day=' + T.addDays(T.ymd(), 1))).statusCode, 400);
    assert.equal((await call('GET', s.url.replace(/s=[^&]+/, 's=bad'))).statusCode, 403);
    const repLink = W.link('https://x', s.id, s.rep.id).replace('https://x', '');
    assert.equal((await call('GET', repLink)).statusCode, 403, 'only admins');
    assert.equal((await sql`select status::text from payments where order_id = ${s.id}`)[0].status, 'pending');
  }));
});

describe('rewards count a wire order only once its money is marked received, on that day', () => {
  test('placed before the period, received inside it: counts in the period', () => h.withDb(async (sql) => {
    const keep = JSON.parse(JSON.stringify(R.PROGRAMS));
    const from = T.addDays(T.ymd(), -10);
    for (const k of ['booster', 'trip']) { R.PROGRAMS[k].from = from; R.PROGRAMS[k].to = T.addDays(T.ymd(), 5); }
    try {
      const me = await h.user(sql), c = await h.contact(sql, me);
      const id = await wireOrder(sql, me, c, T.addDays(T.ymd(), -20), 30);   // placed before the period
      await sql`update payments set status = 'succeeded', paid_at = now() where order_id = ${id}`;   // money arrives inside it
      assert.equal((await R.rewards(sql, me)).booster.onNew, '$9', '2% of 450, counted when the money arrived');
      await sql`update payments set status = 'pending', paid_at = null where order_id = ${id}`;
      assert.equal((await R.rewards(sql, me)).booster.onNew, '$0', 'unpaid: nothing');
    } finally { for (const k of ['booster', 'trip']) Object.assign(R.PROGRAMS[k], keep[k]); }
  }));
});
