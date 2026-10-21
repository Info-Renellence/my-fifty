// F22 (Yousef 2026-10-21): an order n8n did not accept is sent again by the timer, with a once-only key, until n8n
// accepts it; then never again. Against v2, rolled back; n8n is faked.
const { test, describe, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/act').OPS;
const cron = require('../../api/cron')._;

let f;
afterEach(() => { if (f) f.restore(); f = null; delete process.env.N8N_MYFIFTY_URL; });
after(() => h.closeDb());

async function ready(sql, me) {
  const c = await h.contact(sql, me);
  await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
  return c;
}
const sends = async (sql, id) => (await sql`select count(*)::int n from change_log where entity_type = 'orders' and entity_id = ${id} and action = 'send'`)[0].n;

describe('orders n8n did not accept are sent again', () => {
  test('n8n down when placed: kept, sent again by the timer with the same once-only key, then never again', () => h.withDb(async (sql) => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    let up = false;
    f = h.fakeFetch(() => (up ? { json: {} } : { status: 503, text: 'down' }));
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, false);
    assert.equal(await sends(sql, r.orderId), 0);
    const mine = (out) => out;   // other waiting orders in v2 (if any) may be counted too
    assert.equal(mine(await cron.resendOrders(sql)).sent, 0, 'still down');
    up = true;
    const before = f.calls.length;
    const out = await cron.resendOrders(sql);
    assert.ok(out.sent >= 1);
    assert.equal(await sends(sql, r.orderId), 1);
    const tries = f.calls.filter((x) => JSON.parse(x.body).orderId === r.orderId);
    assert.ok(tries.length >= 3, 'placed, still down, then accepted');
    assert.ok(tries.every((x) => x.init.headers['X-Idempotency-Key'] === 'order:' + r.orderId), 'the same key every time');
    const again = f.calls.length;
    await cron.resendOrders(sql);
    assert.equal(f.calls.filter((x, i) => i >= again && JSON.parse(x.body).orderId === r.orderId).length, 0, 'never sent again');
    void before;
  }));
  test('accepted when placed: recorded, and the timer leaves it alone', () => h.withDb(async (sql) => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, true);
    assert.equal(await sends(sql, r.orderId), 1);
    const n = f.calls.length;
    await cron.resendOrders(sql);
    assert.equal(f.calls.slice(n).filter((x) => JSON.parse(x.body).orderId === r.orderId).length, 0);
  }));
  test('approved, rejected, old or fictional orders are never resent; nothing at all while n8n is not connected', () => h.withDb(async (sql) => {
    assert.deepEqual(await cron.resendOrders(sql), { skipped: 'n8n_not_connected' });
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), c = await h.contact(sql, me);
    const approved = await h.order(sql, c, me, { status: 'approved' });
    const rejected = await h.order(sql, c, me, { status: 'rejected' });
    const old = await h.order(sql, c, me, { status: 'submitted', days: 9 });
    const demo = await h.order(sql, c, me, { status: 'submitted' });
    await sql`update orders set legacy_id = ${'demo-test-' + h.uid()} where id = ${demo}`;
    await cron.resendOrders(sql);
    const sentIds = f.calls.map((x) => JSON.parse(x.body).orderId);
    for (const id of [approved, rejected, old, demo]) assert.ok(!sentIds.includes(id));
  }));
});
