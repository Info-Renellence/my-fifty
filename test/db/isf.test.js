// Pulse orders -> the Internal Sales Form workflow (api/_isf.js, owner 2026-10-27) and back (api/intake.js links the
// workflow's HubSpot order to the Pulse order). TEST database, rolled back; n8n and HubSpot faked.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const ISF = require('../../api/_isf');
const I = require('../../api/intake');

after(() => h.closeDb());

test('a Pulse order is sent as the sales form sends it, with a token, and its HubSpot order comes back linked (no second order)', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql);
    await sql`update users set email = 'lucas.stockley@renellence.com' where id = ${rep.id} and not exists (select 1 from users where email = 'lucas.stockley@renellence.com')`;
    const [{ email: repEmail }] = await sql`select email from users where id = ${rep.id}`;
    const c = await h.contact(sql, rep, { email: 'isf.unit@demo.invalid', phone: '+15550100155', shipStreet: '5 Unit Rd', shipCity: 'Toronto' });
    const oid = await h.order(sql, c, rep, { status: 'submitted', lines: [['SAF100', 2], ['SAL400', 1, true]] });
    await sql`update orders set placed_by_id = ${rep.id}, payment_method = 'card_on_file', legacy_id = null where id = ${oid}`;
    const calls = [];
    const real = global.fetch;
    process.env.EDGE_ISF_SECRET = 'unit';
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), headers: opts.headers, body: opts.body && JSON.parse(opts.body) });
      if (/edge-isf-token$/.test(url)) return { ok: true, json: async () => ({ ok: true, token: '1.abc' }) };
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    };
    try {
      const r = await ISF.send(sql, oid);
      assert.deepEqual(r, { queued: true });
      const order = calls.find((x) => /internal-sales-form-cof$/.test(x.url));
      assert.equal(order.headers['X-CSRF-Token'], '1.abc');
      const b = order.body;
      assert.equal(b.customer.email, 'isf.unit@demo.invalid');
      assert.equal(b.payment_method, 'card_on_file');
      assert.deepEqual(b.products.map((p) => [p.sku, p.quantity, p.sample]), [['SAF100', 2, false], ['SAL400', 1, true]]);
      assert.match(b.management_notes, new RegExp('Pulse order ' + oid));
      assert.equal(b.shipping_address.street, '5 Unit Rd');
      if (repEmail === 'lucas.stockley@renellence.com') assert.equal(b.sales_person.name, 'Lucas Stockley');
    } finally { global.fetch = real; delete process.env.EDGE_ISF_SECRET; }

    // the workflow's HubSpot order (paid lines only) comes back through the write step, from n8n's own data (Option B,
    // owner 2026-10-28: HubSpot is never read): the line items first, then the order linking them and the customer
    const hsC = String(870000000 + (Date.now() % 1e8)), hsO = String(880000000 + (Date.now() % 1e8)), li = 'LU1' + (Date.now() % 1e8);
    await sql`update contacts set legacy_id = ${hsC} where id = ${c}`;
    global.fetch = async (url) => { throw new Error('HubSpot was called (Option B: never): ' + url); };
    const props = { hs_order_name: '#U1', hs_pipeline_stage: '937ea84d-x', hs_payment_status: 'Paid', hs_total_price: '450', hs_order_note: 'Internal Sales Order - Rep: Lucas Stockley (x) | CARD ON FILE (Stripe pi_u)' };
    const to = (id, t) => ({ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: t }] });
    try {
      await I.intake(sql, { wf: 'ISF', node: 'HS Order: Create Line Items', hs: { method: 'POST', url: 'https://api.hubapi.com/crm/v3/objects/line_items/batch/create', body: '{}',
        response: { results: [{ id: li, properties: { name: 'saypha filler', hs_sku: 'SAF100', quantity: '2', price: '225' } }] } } });
      const r = await I.intake(sql, { wf: 'ISF', node: 'HS Order: Create', hs: { method: 'POST', url: 'https://api.hubapi.com/crm/v3/objects/orders',
        body: JSON.stringify({ properties: props, associations: [to(hsC, 507), to(li, 513)] }), response: { id: hsO, properties: props } } });
      assert.equal(r.linked, 'pulse', JSON.stringify(r));
      assert.equal(r.id, oid);
      const [o] = await sql`select legacy_id, status::text, order_number, (select count(*)::int from order_lines where order_id = ${oid}) lines,
                              (select count(*)::int from orders where contact_id = ${c} and deleted_at is null) orders,
                              (select string_agg(status::text, ',') from payments where order_id = ${oid}) pays from orders where id = ${oid}`;
      assert.deepEqual([o.legacy_id, o.status, o.order_number, o.lines, o.orders, o.pays], [hsO, 'paid', '#U1', 2, 1, 'succeeded']);
    } finally { global.fetch = real; }
  });
});
