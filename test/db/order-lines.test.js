// Orders' products from HubSpot (owner check 2026-10-28: every order since Oct 27 came in with none). HubSpot answers an
// order read with associations under "line items" (a space); the timer also re-reads recent orders that still have no
// products. TEST database, rolled back; HubSpot faked.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const I = require('../../api/intake');
const H = require('../../api/_hubspot');

after(() => h.closeDb());

test('assocIds reads "line items" as well as line_items', () => {
  assert.deepEqual(H.assocIds({ associations: { 'line items': { results: [{ id: 1 }, { id: 2 }] } } }, 'line_items'), ['1', '2']);
  assert.deepEqual(H.assocIds({ associations: { contacts: { results: [{ id: 9 }] } } }, 'contacts'), ['9']);
  assert.deepEqual(H.assocIds({}, 'line_items'), []);
});

test('an order that came in with no products gets them on the next tick', async () => {
  await h.withDb(async (sql) => {
    const n = Date.now() % 1e8;
    const rep = await h.user(sql);
    const c = await h.contact(sql, rep);
    const cHs = String(880000000 + n), oHs = String(881000000 + n);
    await sql`update contacts set legacy_id = ${cHs} where id = ${c}`;
    const [o] = await sql`insert into orders (contact_id, rep_id, channel, status, submitted_at, legacy_id, order_number) values (${c}, ${rep.id}, 'shopify', 'shipped', now(), ${oHs}, ${'#U' + n}) returning id`;
    const now = new Date().toISOString();
    await sql`insert into settings (key, value) values ('hubspot_sync', ${sql.json({ contacts: now, companies: now, orders: now, calls: now, meetings: now, notes: now, tasks: now })})
      on conflict (key) do update set value = excluded.value`;
    const real = global.fetch;
    process.env.HUBSPOT_READ_TOKEN = 'unit';
    global.fetch = async (url) => {
      const u = new URL(url);
      const ok = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) });
      if (/\/search$/.test(u.pathname)) return ok({ results: [] });
      if (u.pathname === '/crm/v3/objects/orders/' + oHs) {
        return ok({ id: oHs, properties: { hs_order_name: '#U' + n, hs_pipeline_stage: '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03', hs_total_price: '740', hs_createdate: now, hs_external_created_date: now },
          associations: { contacts: { results: [{ id: cHs }] }, 'line items': { results: [{ id: 'LI' + n }] } } });
      }
      if (u.pathname === '/crm/v3/objects/line_items/batch/read') return ok({ results: [{ id: 'LI' + n, properties: { name: 'Magic Needle Cannula 22G 70MM Box of 25', hs_sku: 'MN2270', quantity: '4', price: '185' } }] });
      throw new Error('unexpected ' + url);
    };
    try {
      const r = await I.sync(sql, 20000);
      assert.ok(r.orderLines && r.orderLines.filled >= 1, JSON.stringify(r.orderLines));   // the test database may hold other empty orders too
      const lines = await sql`select product_sku, quantity, unit_price::float8 p from order_lines where order_id = ${o.id}`;
      assert.deepEqual(lines.map((l) => [l.product_sku, l.quantity, l.p]), [['MN2270', 4, 185]]);
      const left = await sql`select count(*)::int n from orders o where o.id = ${o.id} and not exists (select 1 from order_lines l where l.order_id = o.id)`;
      assert.equal(left[0].n, 0, 'nothing left to fill on this order');
    } finally { global.fetch = real; delete process.env.HUBSPOT_READ_TOKEN; }
  });
});
