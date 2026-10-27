// n8n -> v2 mapping (api/_hsmap.js, owner 2026-10-27): the migration's ids and rules for HubSpot contacts, companies and
// orders, and what each kind of n8n HubSpot write is.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../api/_hsmap');

test('ids are the migration\'s: the same HubSpot record always becomes the same v2 row', () => {
  // values the Oct 22 load wrote (renellence-ops/ops/migration/build.js uid)
  assert.equal(M.uid('contact:1'), M.uid('contact:1'));
  assert.match(M.uid('order:42'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(M.ownerUser('265024690'), M.STAFF.info);
  assert.equal(M.ownerUser('90578348'), M.uid('user:emily@renellence.com'));
  assert.equal(M.ownerUser('999'), null);
});

test('a contact: names, email, phones, designation and role, warm by default, billing copies shipping', () => {
  const r = M.contactRow('77', { firstname: 'Dr. Ana', lastname: 'Test', email: ' Ana@Example.COM ', phone: '(416) 555-0199', jobtitle: 'Registered Nurse Injector',
    address: '1 Test St', city: 'Toronto', state: 'Ontario', zip: 'm5v1a1', hubspot_owner_id: '268233660' });
  assert.equal(r.first_name, 'Ana');
  assert.equal(r.email, 'ana@example.com');
  assert.equal(r.phone, '+14165550199');
  assert.equal(r.designation, 'rn');
  assert.equal(r.role, 'injector');
  assert.equal(r.lead_source, 'warm');
  assert.equal(r.shipping_province, 'ON');
  assert.equal(r.shipping_postal_code, 'M5V 1A1');
  assert.equal(r.billing_street, '1 Test St');
  assert.equal(r.owner_id, M.uid('user:sam.almas@renellence.com'));
  assert.equal(r.legacy_id, '77');
  assert.equal(M.contactRow('1', { role: 'MD' }).role, 'physician');
  assert.equal(M.contactRow('1', { hs_analytics_source: 'PAID_SOCIAL' }).lead_source, 'social');
  assert.equal(M.contactRow('1', { jobtitle: 'Clinic owner' }).role, 'manager');
  assert.equal(M.contactRow('1', { jobtitle: 'Medical Director' }).is_medical_director, true);
});

test('an Internal Sales Form order: status, rep from the note, lines without tax, a paid card payment', () => {
  const { order, lines, payments } = M.orderRows('900', {
    hs_order_name: '#1234', hs_pipeline_stage: '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03', hs_payment_status: 'Paid', hs_total_price: '450', hs_tax: '0',
    hs_order_note: 'Internal Sales Order - Rep: Lucas Stockley (123) | CARD ON FILE (Stripe pi_1) | ...', hs_external_created_date: '2026-10-27T15:00:00Z', qbo_id: 'Q9',
  }, [{ id: 'L1', properties: { name: 'saypha filler', hs_sku: 'SAF100', quantity: '2', price: '225' } }, { id: 'L2', properties: { name: 'HST', hs_sku: 'HST', quantity: '1', price: '58' } }], 'C1');
  assert.equal(order.status, 'paid');
  assert.equal(order.rep_id, M.uid('user:lucas.stockley@renellence.com'));
  assert.equal(order.payment_method, 'card_on_file');
  assert.equal(order.quickbooks_invoice_id, 'Q9');
  assert.equal(order.id, M.uid('order:900'));
  assert.deepEqual(lines.map((l) => [l.product_sku, l.quantity, l.unit_price]), [['SAF100', 2, 225]]);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].status, 'succeeded');
  const w = M.orderRows('901', { hs_pipeline_stage: '937ea84d', hs_payment_status: 'Payment Pending', hs_total_price: '900', hs_order_note: 'Rep: Emily Grace | WIRE TRANSFER' }, [], 'C1');
  assert.equal(w.order.status, 'invoiced');
  assert.equal(w.order.payment_method, 'wire');
  assert.equal(w.order.payment_terms_days, 30);
  assert.equal(w.payments[0].status, 'pending');
  // the sales form stamps a wire order Paid when invoiced: still not paid in v2 (owner 2026-10-21)
  const wp = M.orderRows('903', { hs_pipeline_stage: '937ea84d', hs_payment_status: 'Paid', hs_total_price: '900', hs_order_note: 'Rep: Emily Grace | WIRE TRANSFER' }, [], 'C1');
  assert.equal(wp.order.status, 'invoiced');
  assert.equal(wp.payments[0].status, 'pending');
  const sample = M.orderRows('902', { hs_pipeline_stage: '937ea84d', hs_total_price: '0', hs_payment_status: 'Paid' }, [{ id: 'L3', properties: { hs_sku: 'SAL400', quantity: '2', price: '0' } }], 'C1');
  assert.equal(sample.payments.length, 0);
  assert.equal(sample.lines[0].is_free, true);
});

test('what each n8n HubSpot write is', () => {
  const k = (method, url, body, response) => M.classify({ method, url: 'https://api.hubapi.com' + url, body, response });
  assert.deepEqual(k('POST', '/crm/v3/objects/contacts', JSON.stringify({ properties: { email: 'a@b.ca' } }), { id: '5' }), { kind: 'contact', ids: ['5'], create: true, props: ['email'] });
  assert.deepEqual(k('PATCH', '/crm/v3/objects/contacts/5', { properties: { hubspot_owner_id: '1' } }, {}), { kind: 'contact', ids: ['5'], props: ['hubspot_owner_id'] });
  assert.equal(k('POST', '/crm/v3/objects/contacts/batch/update', { inputs: [{ id: '1', properties: { firstname: 'A' } }, { id: '2', properties: { city: 'X' } }] }).ids.length, 2);
  assert.equal(k('POST', '/crm/v3/objects/companies', {}, { id: '9' }).kind, 'company');
  assert.deepEqual(k('PUT', '/crm/v3/objects/contacts/5/associations/companies/9/279', {}), { kind: 'contact_clinic', contact: '5', company: '9' });
  assert.deepEqual(k('PUT', '/crm/v4/objects/contacts/5/associations/contacts/6', {}), { kind: 'contact_md', contact: '5', md: '6' });
  assert.equal(k('POST', '/crm/v3/objects/orders', {}, { id: '1' }).kind, 'order');
  assert.equal(k('PATCH', '/crm/v3/objects/orders/1', {}).kind, 'order');
  for (const [m, u] of [['POST', '/crm/v3/objects/deals'], ['PATCH', '/crm/v3/objects/deals/1'], ['POST', '/crm/v3/objects/notes'], ['POST', '/files/v3/files'],
    ['POST', '/crm/v3/objects/line_items/batch/create'], ['POST', '/crm/v4/associations/orders/deals/batch/create']]) assert.equal(k(m, u).kind, 'skip', u);
  assert.equal(k('DELETE', '/crm/v3/objects/contacts/1').kind, 'unknown');
});
