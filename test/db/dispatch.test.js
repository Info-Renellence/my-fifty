// Order dispatch (data map risk #4, 2026-10-23): queued -> sent | failed, counted tries, the timer's retry, the alert,
// and the once-only key. On the TEST database (v1) only, each test rolled back. The structure change
// (renellence-edge/db/v2-011-order-dispatch.sql, not applied anywhere) is applied inside each test's transaction first,
// through V2_PRACTICE_SQL. n8n is faked. Every row is fictional and marked demo-test-.
//   node --test test/db/dispatch.test.js
const path = require('path');
process.env.V2_PRACTICE_SQL = process.env.V2_PRACTICE_SQL || path.join(__dirname, '..', '..', '..', 'renellence-edge', 'db', 'v2-011-order-dispatch.sql');
const { test, describe, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/act').OPS;
const cron = require('../../api/cron')._;
const D = require('../../api/_dispatch');
const { asUser } = require('../../api/_db');

let f;
afterEach(() => { if (f) f.restore(); f = null; delete process.env.N8N_MYFIFTY_URL; });
after(() => h.closeDb());

const tag = () => 'demo-test-dispatch-' + h.uid();
async function switchOn(sql, more) {
  await sql`update settings set value = value || ${sql.json(Object.assign({ pulse: true }, more || {}))} where key = 'order_dispatch'`;
}
async function ready(sql, me) {
  const c = await h.contact(sql, me);
  await sql`update contacts set legacy_id = ${tag()} where id = ${c}`;
  await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
  return c;
}
const state = async (sql, id) => (await sql`select dispatch_status::text s, dispatch_attempts n, dispatch_error_message e, dispatched_at at from orders where id = ${id}`)[0];
const sends = async (sql, id) => (await sql`select count(*)::int n from change_logs where entity_type = 'orders' and entity_id = ${id} and action = 'send'`)[0].n;
const age = (sql, id, min) => sql`update orders set dispatch_last_attempt_at = now() - ${String(min) + ' minutes'}::interval where id = ${id}`;
const retry = async (sql) => D.retry(sql, (fn) => asUser(null, fn), { cfg: await D.config(sql), source: 'my_fifty', includeFictional: true });
const forOrder = (id) => f.calls.filter((x) => JSON.parse(x.body).orderId === id);

describe('order dispatch', () => {
  test('the SQL adds the columns and an OFF switch; while it is off an order is sent as before (no dispatch state)', () => h.withDb(async (sql) => {
    const cfg = await D.config(sql);
    assert.equal(cfg.pulse, false); assert.equal(cfg.edge, false); assert.equal(cfg.max_attempts, 5); assert.equal(cfg.retry_after_minutes, 15);
    assert.equal(await D.enabled(sql, 'pulse'), null);
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, true);
    const s = await state(sql, r.orderId);
    assert.equal(s.s, null); assert.equal(s.n, 0);
    assert.equal(await sends(sql, r.orderId), 1);
  }));

  test('queue -> send success: queued with the order, sent at once, once-only key, change_logs send', () => h.withDb(async (sql) => {
    await switchOn(sql);
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: { accepted: true } }));
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, true);
    const s = await state(sql, r.orderId);
    assert.equal(s.s, 'sent'); assert.equal(s.n, 1); assert.equal(s.e, null); assert.ok(s.at);
    const calls = forOrder(r.orderId);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers['X-Idempotency-Key'], 'order:' + r.orderId);
    assert.equal(JSON.parse(calls[0].body).from, 'pulse');
    assert.equal(await sends(sql, r.orderId), 1);
    const [lg] = await sql`select count(*)::int n from change_logs where entity_type = 'orders' and entity_id = ${r.orderId} and field_name = 'dispatch_status'`;
    assert.ok(lg.n >= 1, 'every state change is in change_logs (orders trigger)');
  }));

  test('send fails -> stays queued with the error; the timer waits 15 minutes, then retries -> success', () => h.withDb(async (sql) => {
    await switchOn(sql);
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    let up = false;
    f = h.fakeFetch(() => (up ? { json: {} } : { status: 503, text: 'down' }));
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, false); assert.equal(r.queued, true);
    let s = await state(sql, r.orderId);
    assert.equal(s.s, 'queued'); assert.equal(s.n, 1); assert.match(s.e, /^n8n_503/);
    assert.equal(await sends(sql, r.orderId), 0);
    assert.equal((await retry(sql)).due, 0, 'not before 15 minutes');
    await age(sql, r.orderId, 16);
    up = true;
    const out = await retry(sql);
    assert.equal(out.sent, 1);
    s = await state(sql, r.orderId);
    assert.equal(s.s, 'sent'); assert.equal(s.n, 2); assert.equal(s.e, null);
    assert.equal(await sends(sql, r.orderId), 1);
    assert.ok(forOrder(r.orderId).every((x) => x.init.headers['X-Idempotency-Key'] === 'order:' + r.orderId), 'the same key on every try');
    await age(sql, r.orderId, 60);
    assert.equal((await retry(sql)).due, 0, 'a sent order is never sent again');
  }));

  test('max tries -> failed, one task for the alert address, then left alone', () => h.withDb(async (sql) => {
    const ops = await h.user(sql, { kind: 'admin', email: 'ops.' + h.uid() + '@demo.invalid' });
    await switchOn(sql, { max_attempts: 3, alert_email: ops.email });
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => { throw new Error('connect ECONNREFUSED'); });
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal((await state(sql, r.orderId)).n, 1);
    for (let i = 0; i < 2; i++) { await age(sql, r.orderId, 20); await retry(sql); }
    const s = await state(sql, r.orderId);
    assert.equal(s.s, 'failed'); assert.equal(s.n, 3); assert.equal(s.e, 'n8n_unreachable');
    const tasks = await sql`select title, body, status::text, source::text, contact_id from tasks where assignee_id = ${ops.id}`;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'Order not sent for approval');
    assert.equal(tasks[0].contact_id, c); assert.equal(tasks[0].source, 'system'); assert.match(tasks[0].body, /3 tries/);
    await age(sql, r.orderId, 60);
    assert.equal((await retry(sql)).due, 0, 'failed orders are not retried');
    assert.equal(forOrder(r.orderId).length, 3);
  }));

  test('once-only: a second try (the button again, or the timer) sends nothing; a repeat after sending sends nothing', () => h.withDb(async (sql) => {
    await switchOn(sql);
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), c = await h.contact(sql, me);
    const id = await h.order(sql, c, me, { status: 'submitted' });
    await sql`update orders set legacy_id = ${tag()} where id = ${id}`;
    await asUser(me.id, (tx) => D.queue(tx, id));
    await D.queue(sql, id);   // queueing twice changes nothing
    const cfg = await D.config(sql);
    const run = (fn) => asUser(me.id, fn);
    // The claim is one conditional UPDATE (attempts + 1 where still queued), so whichever try comes second finds it taken.
    const a = await D.attempt(run, id, { from: 'pulse', source: 'my_fifty', actorId: me.id, cfg });
    const b = await D.attempt(run, id, { from: 'timer', source: 'my_fifty', actorId: null, cfg, retry: true });
    assert.equal([a, b].filter((x) => x.sent).length, 1, 'one try sent');
    assert.equal(forOrder(id).length, 1, 'n8n called once');
    const again = await D.attempt(run, id, { from: 'pulse', source: 'my_fifty', actorId: me.id, cfg });
    assert.equal(again.skipped, true);
    assert.equal(forOrder(id).length, 1);
    assert.equal(await sends(sql, id), 1);
    const [{ n }] = await sql`select count(*)::int n from orders where id = ${id}`;
    assert.equal(n, 1);
  }));

  test('the tick uses the dispatcher when a switch is on; the old resend skips queued orders', () => h.withDb(async (sql) => {
    await switchOn(sql);
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ status: 500, text: 'x' }));
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    const before = forOrder(r.orderId).length;
    const out = await cron.sendOrders(sql);
    assert.ok(out.dispatch && out.old, 'both parts ran');
    assert.equal(forOrder(r.orderId).length, before, 'within 15 minutes nothing is re-sent, and the old resend leaves queued orders alone');
  }));
});
