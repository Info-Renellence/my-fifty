// Option B (owner 2026-10-28): n8n's writes go into v2 from n8n's own data, never from HubSpot. Every HubSpot call fails in
// these tests, so anything that tries to read HubSpot fails the test. TEST database, rolled back.
const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const I = require('../../api/intake');
const M = require('../../api/_hsmap');

after(() => h.closeDb());
let real;
before(() => { process.env.HUBSPOT_READ_TOKEN = 'test-token'; real = global.fetch; global.fetch = async (url) => { throw new Error('HubSpot was called: ' + url); }; });
after(() => { global.fetch = real; delete process.env.HUBSPOT_READ_TOKEN; });

const n = Date.now() % 1e8;   // test-only HubSpot ids
const id = (k) => String(700000000 + n * 10 + k);
const copy = (wf, method, url, body, response) => ({ wf, node: 'Test node', hs: { method, url: 'https://api.hubapi.com' + url, body: JSON.stringify(body || {}), response: response || {} } });
const link = (to, typeId) => ({ to: { id: to }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }] });
const STAGE = { processed: '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03', shipped: 'aa99e8d0-0000', delivered: '3725360f-0000' };

test('a clinic, its contact (linked), the line items and the order: all from n8n\'s data, products included', async () => {
  await h.withDb(async (sql) => {
    const co = id(1), ct = id(2), li1 = id(3), li2 = id(4), or = id(5);
    // the onboarding form makes the clinic, then the contact linked to it
    let r = await I.intake(sql, copy('Onboarding', 'POST', '/crm/v3/objects/companies', { properties: { name: 'Direct Test Clinic', city: 'Brossard', state: 'QC', zip: 'J4Z0E5' } },
      { id: co, properties: { name: 'Direct Test Clinic', city: 'Brossard', state: 'QC', zip: 'J4Z0E5', createdate: new Date().toISOString() } }));
    assert.equal(r.table, 'clinics', JSON.stringify(r));
    r = await I.intake(sql, copy('Onboarding', 'POST', '/crm/v3/objects/contacts', { properties: { firstname: 'Dina', lastname: 'Directtest', email: 'dina.direct@demo.invalid', jobtitle: 'RN' }, associations: [link(co, 279)] },
      { id: ct, properties: { firstname: 'Dina', lastname: 'Directtest', email: 'dina.direct@demo.invalid', jobtitle: 'RN', createdate: new Date().toISOString() } }));
    assert.equal(r.table, 'contacts', JSON.stringify(r));
    const [c] = await sql`select c.id, c.first_name, c.role, cl.name as clinic from contacts c left join clinics cl on cl.id = c.clinic_id where c.legacy_id = ${ct}`;
    assert.deepEqual([c.first_name, c.role, c.clinic], ['Dina', 'injector', 'Direct Test Clinic']);
    // the sales form: line items first, then the order that links them, then a stamp
    await I.intake(sql, copy('[ISP] Internal Sales Form (Stripe)', 'POST', '/crm/v3/objects/line_items/batch/create',
      { inputs: [{ properties: { name: 'Magic Needle Cannula 22G 70MM Box of 25', hs_sku: 'MN2270', quantity: '4', price: '185' } }, { properties: { name: 'saypha lips Lidocaine 1 ml', hs_sku: 'SAL400', quantity: '2', price: '0' } }] },
      { status: 'COMPLETE', results: [{ id: li1, properties: { name: 'Magic Needle Cannula 22G 70MM Box of 25', hs_sku: 'MN2270', quantity: '4', price: '185' } }, { id: li2, properties: { name: 'saypha lips Lidocaine 1 ml', hs_sku: 'SAL400', quantity: '2', price: '0' } }] }));
    const now = new Date().toISOString();
    r = await I.intake(sql, copy('[ISP] Internal Sales Form (Stripe)', 'POST', '/crm/v3/objects/orders',
      { properties: { hs_order_name: '#D' + n, hs_pipeline_stage: STAGE.processed, hs_total_price: '740', hs_payment_status: 'Paid', hs_order_note: 'Internal Sales Order - Rep: Lucas Stockley (Lucas Stockley) | CARD ON FILE' },
        associations: [link(ct, 507), link(co, 509), link(li1, 513), link(li2, 513)] },
      { id: or, properties: { hs_order_name: '#D' + n, hs_pipeline_stage: STAGE.processed, hs_total_price: '740', hs_createdate: now } }));
    assert.equal(r.table, 'orders', JSON.stringify(r));
    const [o] = await sql`select o.id, o.status::text, o.channel::text, o.contact_id, (select string_agg(l.quantity || 'x ' || l.product_sku, ',' order by l.product_sku) from order_lines l where l.order_id = o.id) as lines
                            from orders o where o.legacy_id = ${or}`;
    assert.deepEqual([o.status, o.channel, o.contact_id, o.lines], ['paid', 'stripe', c.id, '4x MN2270,2x SAL400']);
    // a later change: QuickBooks number and payment type (the order's create is on file, so the whole record is rebuilt)
    r = await I.intake(sql, copy('[ISP] Internal Sales Form (Stripe)', 'PATCH', '/crm/v3/objects/orders/' + or, { properties: { qbo_id: '9911', payment_type: 'Credit Card' } },
      { id: or, properties: { qbo_id: '9911', payment_type: 'Credit Card', hs_lastmodifieddate: now } }));
    const [o2] = await sql`select quickbooks_invoice_id, status::text from orders where legacy_id = ${or}`;
    assert.deepEqual([o2.quickbooks_invoice_id, o2.status], ['9911', 'paid']);
    // the digest marks it delivered
    await I.intake(sql, copy('[DIGEST] Sales Rep Daily Digest', 'PATCH', '/crm/v3/objects/orders/' + or, { properties: { hs_pipeline_stage: STAGE.delivered } },
      { id: or, properties: { hs_pipeline_stage: STAGE.delivered, hs_lastmodifieddate: new Date(Date.now() + 1000).toISOString() } }));
    assert.equal((await sql`select status::text s from orders where legacy_id = ${or}`)[0].s, 'delivered');
  });
});

test('a change to an order made before the write steps (not on file): only its fields, the status only moves forward', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql);
    const c = await h.contact(sql, rep);
    const or = id(6);
    await sql`insert into orders (contact_id, rep_id, channel, status, submitted_at, legacy_id, order_number) values (${c}, ${rep.id}, 'stripe', 'paid', now(), ${or}, ${'#E' + n})`;
    let r = await I.intake(sql, copy('[HS] Order-Deal Association Sync', 'PATCH', '/crm/v3/objects/orders/' + or, { properties: { qbo_id: '4242', hs_pipeline_stage: STAGE.processed } },
      { id: or, properties: { qbo_id: '4242', hs_pipeline_stage: STAGE.processed } }));
    assert.equal(r.table, 'orders', JSON.stringify(r));
    let [o] = await sql`select quickbooks_invoice_id, status::text from orders where legacy_id = ${or}`;
    assert.deepEqual([o.quickbooks_invoice_id, o.status], ['4242', 'paid'], 'processed without "Paid" never takes a paid order back');
    await I.intake(sql, copy('[DIGEST] Sales Rep Daily Digest', 'PATCH', '/crm/v3/objects/orders/' + or, { properties: { hs_pipeline_stage: STAGE.shipped, tracking_number: 'TRK' + n } },
      { id: or, properties: { hs_pipeline_stage: STAGE.shipped, tracking_number: 'TRK' + n, hs_lastmodifieddate: new Date().toISOString() } }));
    [o] = await sql`select status::text, tracking_number from orders where legacy_id = ${or}`;
    assert.deepEqual([o.status, o.tracking_number], ['shipped', 'TRK' + n]);
    // an order v2 has never seen: left to the 5-minute pull
    r = await I.intake(sql, copy('[HS] Order-Deal Association Sync', 'PATCH', '/crm/v3/objects/orders/' + id(7), { properties: { qbo_id: '1' } }, { id: id(7), properties: { qbo_id: '1' } }));
    assert.equal(r.skipped, true);
  });
});

test('a call n8n logs goes on its contact; a link made on its own names the contact', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql);
    const c = await h.contact(sql, rep);
    const ct = id(8);
    await sql`update contacts set legacy_id = ${ct} where id = ${c}`;
    const call = id(9);
    await I.intake(sql, copy('Edge', 'POST', '/crm/v3/objects/calls', { properties: { hs_timestamp: new Date().toISOString(), hs_call_direction: 'OUTBOUND', hs_call_body: 'Talked lips' } },
      { id: call, properties: { hs_timestamp: new Date().toISOString(), hs_call_direction: 'OUTBOUND', hs_call_body: 'Talked lips', hs_lastmodifieddate: new Date().toISOString() } }));
    const r = await I.intake(sql, copy('Edge', 'PUT', '/crm/v4/objects/calls/' + call + '/associations/contacts/' + ct + '/194', {}, {}));
    assert.notEqual(r.skipped, true, JSON.stringify(r));
    const rows = await sql`select kind::text, body from interactions where contact_id = ${c} and deleted_at is null`;
    assert.ok(rows.some((x) => x.kind === 'call' && /Talked lips/.test(x.body || '')), JSON.stringify(rows));
  });
});
