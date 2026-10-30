// The HubSpot-shaped v2 API n8n calls instead of HubSpot (api/hs.js + api/_hsapi.js, owner 2026-10-30). On the test
// database, rolled back. Each test makes the calls the live workflows make and checks the v2 rows and HubSpot-shaped answers.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/_hsapi');
const ctx = { wf: 'unit', node: 'unit' };
const call = (sql, method, path, body, q) => A.handle(sql, method, path, new URLSearchParams(q || {}), body || {}, ctx);
const em = () => 'hsapi.' + h.uid() + '@demo.invalid';

test('contacts: create, find by email, refuse a duplicate, patch, and the MD link', async () => {
  await h.withDb(async (sql) => {
    const email = em();
    const c = await call(sql, 'POST', 'crm/v3/objects/contacts', { properties: { email, firstname: 'Pat', lastname: 'Unit', hubspot_owner_id: '90578348', jobtitle: 'Nurse Injector' } });
    assert.match(c.id, /^9\d{12}$/, 'a new 13-digit id');
    const [row] = await sql`select first_name, legacy_id, owner_id, designation from contacts where email = ${email}`;
    assert.deepEqual([row.first_name, row.legacy_id, row.designation], ['Pat', c.id, 'rn']);
    const s1 = await call(sql, 'POST', 'crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email.toUpperCase() }] }], properties: ['email', 'firstname', 'hubspot_owner_id', 'lifecyclestage'] });
    assert.equal(s1.total, 1);
    assert.deepEqual([s1.results[0].id, s1.results[0].properties.firstname, s1.results[0].properties.hubspot_owner_id, s1.results[0].properties.lifecyclestage], [c.id, 'Pat', '90578348', 'lead']);
    await assert.rejects(call(sql, 'POST', 'crm/v3/objects/contacts', { properties: { email } }), (e) => e.status === 409 && e.message.includes('Existing ID: ' + c.id));
    await call(sql, 'PATCH', 'crm/v3/objects/contacts/' + c.id, { properties: { city: 'Testville', zip: 'm5v1a1', lifecyclestage: 'opportunity' } });
    const [p] = await sql`select shipping_city, shipping_postal_code from contacts where email = ${email}`;
    assert.deepEqual([p.shipping_city, p.shipping_postal_code], ['Testville', 'M5V 1A1']);
    const md = await call(sql, 'POST', 'crm/v3/objects/contacts', { properties: { email: em(), firstname: 'Dr Mo', lastname: 'Unit' } });
    await call(sql, 'PUT', `crm/v4/objects/contacts/${c.id}/associations/contacts/${md.id}`, [{ associationCategory: 'USER_DEFINED', associationTypeId: 1 }]);
    const links = await call(sql, 'GET', `crm/v4/objects/contacts/${c.id}/associations/contacts`);
    assert.equal(links.results[0].toObjectId, Number(md.id));
    assert.equal(links.results[0].associationTypes[0].label, 'Medical Director', 'the MD label n8n trusts');
    const read = await call(sql, 'POST', 'crm/v3/objects/contacts/batch/read', { inputs: [{ id: c.id }, { id: md.id }], properties: ['email', 'role'] });
    assert.equal(read.results.length, 2);
  });
});

test('companies: create, link a contact, search by name and postal', async () => {
  await h.withDb(async (sql) => {
    const co = await call(sql, 'POST', 'crm/v3/objects/companies', { properties: { name: 'Unit Aesthetics ' + h.uid(), zip: 'L7T1A2', city: 'Burlington', state: 'Ontario' } });
    const c = await call(sql, 'POST', 'crm/v3/objects/contacts', { properties: { email: em(), firstname: 'Kai' } });
    await call(sql, 'PUT', `crm/v3/objects/contacts/${c.id}/associations/company/${co.id}/contact_to_company`);
    const back = await call(sql, 'GET', `crm/v4/objects/contacts/${c.id}/associations/companies`);
    assert.equal(String(back.results[0].toObjectId), co.id);
    const s = await call(sql, 'POST', 'crm/v3/objects/companies/search', { filterGroups: [{ filters: [{ propertyName: 'zip', operator: 'EQ', value: 'L7T 1A2' }] }, { filters: [{ propertyName: 'zip', operator: 'EQ', value: 'L7T1A2' }] }], properties: ['name', 'zip'], limit: 10 });
    assert.ok(s.results.some((r) => r.id === co.id), 'found by postal, either form');
    const [cl] = await sql`select province, postal_code from clinics where legacy_id = ${co.id}`;
    assert.deepEqual([cl.province, cl.postal_code], ['ON', 'L7T 1A2']);
  });
});

test('orders: line items + order with its customer (as the sales form makes it), then tracking, shipped and delivered', async () => {
  await h.withDb(async (sql) => {
    const c = await call(sql, 'POST', 'crm/v3/objects/contacts', { properties: { email: em(), firstname: 'Ola', hubspot_owner_id: '268233804' } });
    const li = await call(sql, 'POST', 'crm/v3/objects/line_items/batch/create', { inputs: [{ properties: { name: 'saypha lips', hs_sku: 'SAL400', quantity: '4', price: '225' } }] });
    const name = '#99' + String(Date.now()).slice(-7);
    const o = await call(sql, 'POST', 'crm/v3/objects/orders', { properties: { hs_order_name: name, hs_order_note: 'Internal Sales Order - Rep: Lucas Stockley | CARD', hs_pipeline_stage: A.STAGE.processed,
      hs_total_price: '900', hs_payment_status: 'Paid', hs_currency_code: 'CAD' },
      associations: [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 507 }] }, { to: { id: li.results[0].id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 513 }] }] });
    const [row] = await sql`select o.status::text, o.order_number, (select count(*)::int from order_lines l where l.order_id = o.id) n from orders o where o.legacy_id = ${o.id}`;
    assert.ok(row, 'the order is in v2');
    assert.deepEqual([row.status, row.order_number, row.n], ['paid', name, 1]);
    const found = await call(sql, 'POST', 'crm/v3/objects/orders/search', { filterGroups: [{ filters: [{ propertyName: 'hs_order_name', operator: 'CONTAINS_TOKEN', value: name.slice(1) }] }], properties: ['hs_order_name', 'hs_pipeline_stage'], limit: 1 });
    assert.equal(found.results[0].id, o.id);
    await call(sql, 'PATCH', 'crm/v3/objects/orders/' + o.id, { properties: { tracking_number: 'T123', tracking_url: 'https://atshealthcare.example/t/T123', hs_pipeline_stage: A.STAGE.shipped } });
    await call(sql, 'PATCH', 'crm/v3/objects/orders/' + o.id, { properties: { hs_pipeline_stage: A.STAGE.delivered } });
    const [after] = await sql`select status::text, tracking_number from orders where legacy_id = ${o.id}`;
    assert.deepEqual([after.status, after.tracking_number], ['delivered', 'T123']);
    const who = await call(sql, 'GET', `crm/v4/objects/orders/${o.id}/associations/contacts`, {}, { limit: '1' });
    assert.equal(String(who.results[0].toObjectId), c.id);
    const lines = await call(sql, 'GET', `crm/v4/objects/orders/${o.id}/associations/line_items`);
    const q = await call(sql, 'POST', 'crm/v3/objects/line_items/batch/read', { inputs: lines.results.map((r) => ({ id: r.toObjectId })), properties: ['quantity'] });
    assert.equal(q.results[0].properties.quantity, '4');
    const recent = await call(sql, 'POST', 'crm/v3/objects/orders/search', { filterGroups: [{ filters: [{ propertyName: 'hs_createdate', operator: 'GTE', value: String(Date.now() - 86400000) }, { propertyName: 'hs_pipeline_stage', operator: 'IN', values: [A.STAGE.delivered] }] }], properties: ['hs_order_name'], limit: 100 });
    assert.ok(recent.results.some((r) => r.id === o.id), 'date and stage filters');
  });
});

test('deals answer harmlessly; a note attaching an uploaded file puts it on the customer', async () => {
  await h.withDb(async (sql) => {
    assert.deepEqual(await call(sql, 'POST', 'crm/v3/objects/deals/search', { filterGroups: [{ filters: [{ propertyName: 'associations.contact', operator: 'EQ', value: '1' }] }] }), { total: 0, results: [] });
    const d = await call(sql, 'POST', 'crm/v3/objects/deals', { properties: { dealname: 'x' } });
    assert.ok(d.id);
    const c = await call(sql, 'POST', 'crm/v3/objects/contacts', { properties: { email: em(), firstname: 'Fia' } });
    const [f] = await sql`insert into files (storage_path, file_name, mime_type, size_bytes) values (${'unfiled/unit-' + h.uid() + '.pdf'}, 'signed.pdf', 'application/pdf', 10) returning id`;
    await call(sql, 'POST', 'crm/v3/objects/notes', { properties: { hs_note_body: 'Signed form', hs_attachment_ids: A.alias(f.id), hs_timestamp: new Date().toISOString() },
      associations: [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] });
    const [after] = await sql`select contact_id from files where id = ${f.id}`;
    const [cr] = await sql`select id from contacts where legacy_id = ${c.id}`;
    assert.equal(after.contact_id, cr.id);
  });
});

test('a contact made in Pulse (no HubSpot id) is shown under a stable alias and can be changed by it', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql);
    const p = await h.contact(sql, rep, { email: em() });
    const pid = p.id || p;
    const [c] = await sql`select email::text from contacts where id = ${pid}`;
    const s = await call(sql, 'POST', 'crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: c.email }] }], properties: ['email'] });
    assert.match(s.results[0].id, /^8\d{12}$/);
    assert.equal(s.results[0].id, A.alias(pid), 'stable');
    await call(sql, 'PATCH', 'crm/v3/objects/contacts/' + s.results[0].id, { properties: { secondary_email: 'second.' + c.email } });
    const [x] = await sql`select secondary_email::text, legacy_id from contacts where id = ${pid}`;
    assert.equal(x.secondary_email, 'second.' + c.email);
  });
});
