// Orders audit 2026-11-02 (Yousef): the HubSpot pull applies the Oct 22 load's order rules (api/intake.js orderFixes),
// and Stripe events find a payment filed under its charge id as well as its payment intent, and mark disputes
// (api/_stripe.js). No database: the Stripe part runs against a fake transaction.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../api/_hsmap');
const I = require('../../api/intake');
const S = require('../../api/_stripe');

const PROCESSED = '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03', SHIPPED = 'aa99e8d0-c1d5-4071-b915-d240bbb1aed9', DELIVERED = '3725360f-519b-4b18-a593-494d60a29c9f';
const NOW = Date.parse('2026-11-02T12:00:00Z');
const rowsOf = (p, lis) => M.orderRows('1', p, lis, 'c1');

test('an order still Processed more than 30 days after it was placed is delivered (no date made up); a recent one stays paid', () => {
  const old = { hs_pipeline_stage: PROCESSED, hs_payment_status: 'Paid', hs_total_price: '418.1', hs_createdate: '2026-05-19T14:35:11Z' };
  const r = I.orderFixes({ properties: old }, rowsOf(old, []), [], null, NOW);
  assert.equal(r.order.status, 'delivered');
  assert.equal(r.order.delivered_at, null);
  const fresh = Object.assign({}, old, { hs_createdate: '2026-10-21T16:39:29Z' });
  assert.equal(I.orderFixes({ properties: fresh }, rowsOf(fresh, []), [], null, NOW).order.status, 'paid');
});

test('delivered and shipped dates come from the stage history; v2 dates and a later v2 status are kept', () => {
  const p = { hs_pipeline_stage: DELIVERED, hs_payment_status: 'Paid', hs_total_price: '100', hs_createdate: '2026-09-01T10:00:00Z' };
  const rec = { properties: p, propertiesWithHistory: { hs_pipeline_stage: [
    { value: DELIVERED, timestamp: '2026-09-05T15:00:00Z' }, { value: SHIPPED, timestamp: '2026-09-02T15:00:00Z' }, { value: PROCESSED, timestamp: '2026-09-01T10:00:00Z' }] } };
  const r = I.orderFixes(rec, rowsOf(p, []), [], null, NOW);
  assert.equal(r.order.delivered_at, '2026-09-05T15:00:00.000Z');
  assert.equal(r.order.shipped_at, '2026-09-02T15:00:00.000Z');
  const kept = I.orderFixes(rec, rowsOf(p, []), [], { status: 'delivered', delivered_at: new Date('2026-09-04'), shipped_at: null }, NOW);
  assert.equal('delivered_at' in kept.order, false, 'a v2 delivered date is never moved');
  assert.equal(kept.order.shipped_at, '2026-09-02T15:00:00.000Z');
  const back = { hs_pipeline_stage: PROCESSED, hs_payment_status: 'Paid', hs_total_price: '100', hs_createdate: '2026-10-30T10:00:00Z' };
  const b = I.orderFixes({ properties: back }, rowsOf(back, []), [], { status: 'delivered' }, NOW);
  assert.equal('status' in b.order, false, 'HubSpot never moves a v2 status back');
  const cancel = Object.assign({}, back, { hs_pipeline_stage: '3c85a297-e9ce-400b-b42e-9f16853d69d6' });
  assert.equal(I.orderFixes({ properties: cancel }, rowsOf(cancel, []), [], { status: 'paid' }, NOW).order.status, 'cancelled');
});

test('a line HubSpot discounted to $0 is a free line; the order discount drops by the same, so the value is unchanged', () => {
  const p = { hs_pipeline_stage: DELIVERED, hs_payment_status: 'Paid', hs_total_price: '3090.55', hs_order_discount: '1940', hs_tax: '355.55', hs_shipping_cost: '35', hs_createdate: '2026-05-13T17:25:20Z' };
  const lis = [
    { id: 'a', properties: { name: 'SAV200', hs_sku: 'SAV200', quantity: '6', price: '210', amount: '810.00' } },
    { id: 'b', properties: { name: 'SAF100', hs_sku: 'SAF100', quantity: '1', price: '200', amount: '0.00' } },
    { id: 'c', properties: { name: 'SAF100', hs_sku: 'SAF100', quantity: '6', price: '200', amount: '810.00' } },
    { id: 'd', properties: { name: 'SAVP300', hs_sku: 'SAVP300', quantity: '1', price: '220', amount: '0.00' } },
    { id: 'e', properties: { name: 'SAVP300', hs_sku: 'SAVP300', quantity: '8', price: '220', amount: '1080.00' } }];
  const value = (r) => r.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0) - (r.order.discount_amount || 0) + r.order.tax_amount + r.order.shipping_amount;
  const before = rowsOf(p, lis);
  assert.equal(Math.round(value(before) * 100) / 100, 3090.55);
  const r = I.orderFixes({ properties: p }, rowsOf(p, lis), lis, null, NOW);
  assert.deepEqual(r.lines.filter((l) => l.is_free).map((l) => [l.product_sku, l.quantity, l.unit_price]), [['SAF100', 1, 0], ['SAVP300', 1, 0]]);
  assert.equal(r.order.discount_amount, 1520);
  assert.equal(Math.round(value(r) * 100) / 100, 3090.55);
});

// A fake postgres transaction: answers each query from `answer(text, values)` and records it.
function fakeSql(answer) {
  const seen = [];
  const tx = (strings, ...values) => {
    if (!Array.isArray(strings)) return { __obj: strings };   // tx(row) inside a template
    const text = strings.join('?');
    seen.push({ text, values });
    return Promise.resolve(answer(text, values) || []);
  };
  return { seen, begin: async (fn) => fn(tx) };
}

test('a charge filed under its ch_ id is found by a refund and by a resent charge event (no second row)', async () => {
  const sql = fakeSql((t, v) => {
    if (/select order_id from payments where external_id = any/.test(t)) return v[0].includes('ch_1') ? [{ order_id: 'o1' }] : [];
    if (/select id, status::text as status from payments where external_id = any/.test(t)) return v[0].includes('ch_1') ? [{ id: 'p1', status: 'succeeded' }] : [];
    if (/select id, order_id from payments where external_id = any/.test(t)) return v[0].includes('ch_1') ? [{ id: 'p1', order_id: 'o1' }] : [];
    if (/insert into payments/.test(t)) return [{ id: 'r1' }];
    return [];
  });
  const charge = { id: 'ch_1', payment_intent: 'pi_1', amount: 41810, currency: 'cad', created: 1760000000, livemode: true, metadata: {},
    payment_method_details: { card: { brand: 'visa', last4: '4242' } }, receipt_url: 'https://pay.stripe.com/receipts/x' };
  const r = await S.apply(sql, { id: 'evt_1', type: 'charge.succeeded', data: { object: charge } });
  assert.deepEqual([r.table, r.id, r.created], ['payments', 'p1', undefined]);
  assert.equal(sql.seen.some((q) => /insert into payments/.test(q.text)), false, 'no second succeeded row');
  const upd = sql.seen.find((q) => /update payments set/.test(q.text));
  assert.equal('external_id' in upd.values[0].__obj, false, 'the id it is filed under is kept');
  assert.equal(upd.values[0].__obj.card_last4, '4242');
  const ref = await S.apply(sql, { id: 'evt_2', type: 'charge.refunded', data: { object: Object.assign({}, charge, { amount_refunded: 41810, refunds: { data: [{ id: 're_1', amount: 41810, created: 1760000100 }] } }) } });
  assert.equal(ref.refund, true);
});

test('a dispute marks the payment disputed, and a won dispute makes it succeeded again', async () => {
  const sets = [];
  const sql = fakeSql((t, v) => {
    if (/select id from payments where external_id = any/.test(t)) return v[0].includes('ch_9') ? [{ id: 'p9' }] : [];
    if (/update payments set status/.test(t)) sets.push(v[0]);
    return [];
  });
  const r = await S.apply(sql, { id: 'evt_3', type: 'charge.dispute.created', data: { object: { id: 'dp_1', charge: 'ch_9', payment_intent: 'pi_9', status: 'needs_response', reason: 'fraudulent' } } });
  assert.deepEqual([r.id, r.disputed], ['p9', true]);
  await S.apply(sql, { id: 'evt_4', type: 'charge.dispute.closed', data: { object: { id: 'dp_1', charge: 'ch_9', status: 'won' } } });
  assert.deepEqual(sets, ['disputed', 'succeeded']);
  const none = await S.apply(sql, { id: 'evt_5', type: 'charge.dispute.created', data: { object: { id: 'dp_2', charge: 'ch_unknown', status: 'needs_response' } } });
  assert.equal(none.pending, true);
});
