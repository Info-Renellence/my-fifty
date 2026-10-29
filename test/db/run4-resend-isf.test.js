// Run 4: with N8N_MYFIFTY_URL empty (as in Vercel) orders go through the Internal Sales Form; a failed send is retried by the
// timer with a once-only key and a timeout, then never again. Test database (v1), rolled back, stubbed fetch only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/act').OPS;
const cron = require('../../api/cron')._;

after(() => h.closeDb());
const sends = async (sql, id) => (await sql`select count(*)::int n from change_logs where entity_type = 'orders' and entity_id = ${id} and action = 'send'`)[0].n;

test('a failed send to the sales form is sent again by the timer with the same once-only key, then never again; an Edge order is left alone', () => h.withDb(async (sql) => {
  delete process.env.N8N_MYFIFTY_URL; process.env.PULSE_ISF_KEY = 'r4-fake-key';
  let up = false; const forms = [];
  const f = h.fakeFetch((url, init) => {
    if (/token/.test(url)) return { json: { ok: true, token: 'tok' } };
    forms.push(init.headers);
    return up ? { json: {} } : { status: 503, text: 'down' };
  });
  try {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, false); assert.equal(await sends(sql, r.orderId), 0);
    assert.equal(forms[0]['X-Idempotency-Key'], 'order:' + r.orderId, 'the first try carries the key');
    await sql`update orders set submitted_at = now() - interval '3 minutes' where id = ${r.orderId}`;   // past the 2-minute wait
    assert.equal((await cron.resendOrders(sql)).sent, 0, 'still down');
    up = true;
    const t = await cron.resendOrders(sql);
    assert.ok(t.sent >= 1, 'the timer sent it: ' + JSON.stringify(t));
    assert.equal(await sends(sql, r.orderId), 1);
    assert.equal(forms[forms.length - 1]['X-Idempotency-Key'], 'order:' + r.orderId, 'the same key on the retry');
    const n = forms.length;
    await cron.resendOrders(sql);
    assert.ok(!forms.slice(n).some((x) => x['X-Idempotency-Key'] === 'order:' + r.orderId), 'never again once accepted');
    // an order Edge placed is not Pulse's to send
    await sql`select set_config('app.source', 'edge_app', true)`;
    const e = await h.order(sql, c, me, { status: 'submitted' });
    await sql`select set_config('app.source', 'my_fifty', true)`;
    await sql`update orders set placed_by_id = ${me.id} where id = ${e}`;
    await cron.resendOrders(sql);
    assert.equal(await sends(sql, e), 0, 'an order with no Pulse create entry is not retried');
  } finally { f.restore(); delete process.env.PULSE_ISF_KEY; }
}));

test('the timer skips resend only when neither the old n8n address nor the sales form key is set', () => h.withDb(async (sql) => {
  delete process.env.N8N_MYFIFTY_URL; delete process.env.PULSE_ISF_KEY; delete process.env.EDGE_ISF_SECRET;
  assert.deepEqual(await cron.resendOrders(sql), { skipped: 'n8n_not_connected' });
}));
