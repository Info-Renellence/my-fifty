// Data-flow improvements 1, 2 and 6 (owner 2026-10-28) on the TEST database, rolled back; no network.
//   1 payments straight from Stripe (api/_stripe.js), 2 Pulse orders linked by id (api/intake.js), 6 alarms (api/_alarms.js)
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('../helpers');
const S = require('../../api/_stripe');
const I = require('../../api/intake');
const A = require('../../api/_alarms');

after(() => h.closeDb());
const n = Date.now() % 1e8;

test('Stripe signature: right secret and time pass; a wrong secret, an old time or no header fail', () => {
  const raw = '{"id":"evt_1"}', t = Math.floor(Date.now() / 1000);
  const sig = (sec, at) => 't=' + at + ',v1=' + crypto.createHmac('sha256', sec).update(at + '.' + raw).digest('hex');
  assert.equal(S.signatureOk(sig('whsec_unit', t), raw, 'whsec_unit'), true);
  assert.equal(S.signatureOk(sig('whsec_other', t), raw, 'whsec_unit'), false);
  assert.equal(S.signatureOk(sig('whsec_unit', t - 900), raw, 'whsec_unit'), false);
  assert.equal(S.signatureOk('', raw, 'whsec_unit'), false);
});

test('a charge waits for its order, then lands on it; the same charge from HubSpot is not doubled; a refund is its own row', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql), c = await h.contact(sql, rep);
    const pi = 'pi_unit' + n;
    const charge = { id: 'evt_c' + n, type: 'charge.succeeded', data: { object: { id: 'ch_' + n, payment_intent: pi, amount: 45000, currency: 'cad', created: Math.floor(Date.now() / 1000),
      livemode: true, receipt_url: 'https://pay.stripe.com/receipts/x', payment_method_details: { card: { brand: 'visa', last4: '4242' } }, metadata: {} } } };
    let r = await S.handle(sql, charge);
    assert.equal(r.pending, true, JSON.stringify(r));
    // the sales form makes the order a minute later, with the HubSpot payment (no Stripe id) and the pi in its note
    const oid = await h.order(sql, c, rep, { status: 'paid', lines: [['SAF100', 2]] });
    await sql`update orders set approval_note = ${'Internal Sales Order - Rep: Unit | CARD ON FILE (Stripe ' + pi + ')'} where id = ${oid}`;
    await sql`insert into payments (order_id, kind, method, amount, currency, status, paid_at, is_test) values (${oid}, 'charge', 'card_on_file', 450, 'CAD', 'succeeded', now(), false)`;
    r = await S.retryPending(sql);
    assert.ok(r.done >= 1, JSON.stringify(r));
    const pays = await sql`select kind::text, provider::text, external_id, card_last4, amount::float8 from payments where order_id = ${oid} order by created_at`;
    assert.deepEqual(pays.map((p) => [p.kind, p.provider, p.external_id, p.card_last4, p.amount]), [['charge', 'stripe', pi, '4242', 450]], 'one charge, now with the Stripe id and card');
    assert.deepEqual(await S.handle(sql, charge), { ok: true, duplicate: true });
    await S.handle(sql, { id: 'evt_r' + n, type: 'charge.refunded', data: { object: { id: 'ch_' + n, payment_intent: pi, amount_refunded: 10000, currency: 'cad', livemode: true,
      refunds: { data: [{ id: 're_' + n, amount: 10000, created: Math.floor(Date.now() / 1000) }] } } } });
    const ref = await sql`select amount::float8 from payments where order_id = ${oid} and kind = 'refund'`;
    assert.deepEqual(ref.map((x) => x.amount), [100]);
  });
});

test('a sales-form order names its Pulse order in the note: linked by id even when the products differ', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql), c = await h.contact(sql, rep);
    const hsC = String(860000000 + n), hsO = String(861000000 + n), li = 'LX' + n;
    await sql`update contacts set legacy_id = ${hsC} where id = ${c}`;
    const oid = await h.order(sql, c, rep, { status: 'submitted', lines: [['SAF100', 3]] });
    await sql`update orders set placed_by_id = ${rep.id}, legacy_id = null where id = ${oid}`;
    const real = global.fetch; global.fetch = async (u) => { throw new Error('no network: ' + u); };
    const to = (id, t) => ({ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: t }] });
    const props = { hs_order_name: '#L' + n, hs_pipeline_stage: '937ea84d-x', hs_payment_status: 'Paid', hs_total_price: '450', hs_order_note: 'Internal Sales Order - Rep: Unit | CARD ON FILE | Pulse order ' + oid };
    try {
      await I.intake(sql, { wf: 'ISF', node: 'HS Order: Create Line Items', hs: { method: 'POST', url: 'https://api.hubapi.com/crm/v3/objects/line_items/batch/create', body: '{}', response: { results: [{ id: li, properties: { hs_sku: 'SAF100', quantity: '2', price: '225' } }] } } });
      const r = await I.intake(sql, { wf: 'ISF', node: 'HS Order: Create', hs: { method: 'POST', url: 'https://api.hubapi.com/crm/v3/objects/orders', body: JSON.stringify({ properties: props, associations: [to(hsC, 507), to(li, 513)] }), response: { id: hsO, properties: props } } });
      assert.equal(r.linked, 'pulse', JSON.stringify(r));
      assert.equal(r.id, oid);
    } finally { global.fetch = real; }
  });
});

test('alarms: a quiet Gmail on a weekday afternoon and an order only the pull brought in are found; nothing is sent without the n8n line', async () => {
  await h.withDb(async (sql) => {
    await sql`update ingest_events set received_at = received_at - interval '30 days' where source = 'gmail' and received_at > now() - interval '30 days'`;
    const rep = await h.user(sql), c = await h.contact(sql, rep);
    const oid = await h.order(sql, c, rep, {});
    await sql`insert into change_logs (actor_kind, source, action, entity_type, entity_id, note) values ('system', 'import', 'create', 'orders', ${oid}, 'unit')`;
    const wed3pm = Date.parse('2026-10-28T19:00:00Z');   // Wednesday 3 PM Toronto
    const keys = (await A.findings(sql, wed3pm)).map((a) => a.key);
    assert.ok(keys.includes('gmail_quiet'), keys.join(','));
    assert.ok(keys.includes('missed_writes'), keys.join(','));
    const sat = (await A.findings(sql, Date.parse('2026-10-31T19:00:00Z'))).map((a) => a.key);
    assert.ok(!sat.includes('gmail_quiet'), 'not on a Saturday');
    delete process.env.N8N_ALARM_URL;
    const r = await A.check(sql);
    assert.equal(r.sent, 0);
  });
});
