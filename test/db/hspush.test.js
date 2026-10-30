// v2 -> HubSpot copy (api/_hspush.js, owner 2026-10-30), with HubSpot faked: what n8n made through the v2 API reaches
// HubSpot once, takes HubSpot's id, later changes are sent as PATCHes, an old id still answers, and nothing loops. Rolled back.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/_hsapi');
const P = require('../../api/_hspush');
const ctx = { wf: 'unit', node: 'unit' };
const call = (sql, method, path, body) => A.handle(sql, method, path, new URLSearchParams(), body || {}, ctx);

function fakeHubSpot() {
  let n = 100000000000;
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init) => {
    const u = String(url), m = (init && init.method) || 'GET', b = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ m, path: u.replace('https://api.hubapi.com', ''), b });
    let j = {};
    if (/\/search$/.test(u)) j = { total: 0, results: [] };
    else if (/batch\/create$/.test(u)) j = { status: 'COMPLETE', results: b.inputs.map(() => ({ id: String(++n) })) };
    else if (m === 'POST') j = { id: String(++n) };
    else j = { id: 'x' };
    return { ok: true, status: 200, json: async () => j };
  };
  return { calls, restore: () => { global.fetch = real; } };
}

test('new contact, clinic and order reach HubSpot once with HubSpot ids; a change follows; an old id still answers', async () => {
  process.env.HUBSPOT_WRITE_TOKEN = 'unit';
  try { await h.withDb(async (sql) => {
    await sql`delete from settings where key = 'hubspot_push'`;
    await P.push(sql, 5000);   // the first tick only starts the clock (nothing older is copied)
    await sql`update settings set value = jsonb_set(value, '{started_at}', to_jsonb((now() - interval '1 minute')::text)) where key = 'hubspot_push'`;
    const email = 'push.' + h.uid() + '@demo.invalid';
    const co = await call(sql, 'POST', 'crm/v3/objects/companies', { properties: { name: 'Push Unit Clinic ' + h.uid(), city: 'Testville' } });
    const c = await call(sql, 'POST', 'crm/v3/objects/contacts', { properties: { email, firstname: 'Pia', what_is_your_clinic_name: 'Push Unit' } });
    await call(sql, 'PUT', `crm/v3/objects/contacts/${c.id}/associations/company/${co.id}/contact_to_company`);
    const li = await call(sql, 'POST', 'crm/v3/objects/line_items/batch/create', { inputs: [{ properties: { name: 'saypha lips', hs_sku: 'SAL400', quantity: '2', price: '225' } }] });
    const name = '#98' + String(Date.now()).slice(-7);
    const o = await call(sql, 'POST', 'crm/v3/objects/orders', { properties: { hs_order_name: name, hs_order_note: 'Internal Sales Order - Rep: Emily Grace | CARD', hs_pipeline: '14a2e10e-5471-408a-906e-c51f3b04369e', hs_pipeline_stage: A.STAGE.processed, hs_payment_status: 'Paid', hs_total_price: '450' },
      associations: [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 507 }] }, { to: { id: li.results[0].id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 513 }] }] });

    const f = fakeHubSpot();
    let r;
    try { r = await P.push(sql, 10000); } finally { f.restore(); }
    assert.deepEqual([r.clinics, r.contacts, r.orders], [1, 1, 1], JSON.stringify(r));
    const [cr] = await sql`select legacy_id from contacts where email = ${email}`;
    assert.match(cr.legacy_id, /^1\d{11}$/, 'the contact took HubSpot\'s id');
    const orderCall = f.calls.find((x) => x.m === 'POST' && x.path === '/crm/v3/objects/orders');
    assert.equal(orderCall.b.properties.hs_order_name, name, 'the order n8n sent, replayed');
    assert.equal(orderCall.b.properties.hs_pipeline, '14a2e10e-5471-408a-906e-c51f3b04369e');
    assert.ok(orderCall.b.associations.some((a) => a.to.id === cr.legacy_id), 'linked to the customer\'s HubSpot id');
    assert.ok(f.calls.some((x) => x.path.includes('/line_items/batch/create')), 'its line items made first');
    assert.equal(f.calls.filter((x) => x.m === 'POST' && x.path === '/crm/v3/objects/contacts').length, 1, 'one contact create');

    // a second tick copies nothing new; a change made now goes as a PATCH (one test transaction has one now(): wind the cursor back)
    await sql`update settings set value = jsonb_set(value, '{cursor}', to_jsonb((now() - interval '1 minute')::text)) where key = 'hubspot_push'`;
    const g = fakeHubSpot();
    try {
      await call(sql, 'PATCH', 'crm/v3/objects/contacts/' + c.id, { properties: { city: 'Newtown' } });   // the OLD id: still answers
      r = await P.push(sql, 10000);
    } finally { g.restore(); }
    assert.deepEqual([r.contacts, r.orders], [0, 0], 'nothing created twice');
    const patch = g.calls.find((x) => x.m === 'PATCH' && x.path === '/crm/v3/objects/contacts/' + cr.legacy_id);
    assert.ok(patch, 'the change sent to HubSpot: ' + JSON.stringify(g.calls.map((x) => x.m + ' ' + x.path)));
    assert.equal(patch.b.properties.city, 'Newtown');
  }); } finally { delete process.env.HUBSPOT_WRITE_TOKEN; }
});

test('no token: the copy does nothing', async () => {
  await h.withDb(async (sql) => { assert.deepEqual(await P.push(sql, 1000), { skipped: 'hubspot_write_not_set_up' }); });
});
