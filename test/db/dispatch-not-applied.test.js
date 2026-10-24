// Order dispatch switched on before its columns exist (test run 2026-10-23, R3B-1): the settings row `order_dispatch`
// says pulse/edge true, but renellence-edge/db/v2-011-order-dispatch.sql has not been applied. Pulse must behave as before
// (the old send), never fail the order or stop the timer. Rolled back, test database (v1) only; fictional rows.
// Runs only while the columns are missing (v1 tonight); once v2-011 is applied to the test database it skips.
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/act').OPS;
const cron = require('../../api/cron')._;
const D = require('../../api/_dispatch');

after(() => h.closeDb());
let f;
afterEach(() => { if (f) f.restore(); f = null; delete process.env.N8N_MYFIFTY_URL; });

test('switch row on, columns missing: the order goes the old way and the timer still runs', async (t) => {
  await h.withDb(async (sql) => {
    const [col] = await sql`select count(*)::int n from information_schema.columns where table_name = 'orders' and column_name = 'dispatch_status'`;
    if (col.n) return t.skip('v2-011 is applied on this database');
    await sql`insert into settings (key, value) values ('order_dispatch', ${sql.json({ pulse: true, edge: true })})
              on conflict (key) do update set value = excluded.value`;
    assert.equal(await D.enabled(sql, 'pulse'), null, 'off without the columns');
    assert.equal(await D.anyOn(sql), null);
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql, { email: 'demo-test-dispatch-na.' + h.uid() + '@demo.invalid' });
    const c = await h.contact(sql, me);
    await sql`update contacts set legacy_id = ${'demo-test-dispatch-na-' + h.uid()} where id = ${c}`;
    await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.ok, true);
    assert.equal(r.sentToN8n, true, 'sent the old way');
    const out = await cron.sendOrders(sql);
    assert.ok(!('dispatch' in out), 'the timer uses the old resend');
  });
});
