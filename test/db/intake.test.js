// n8n -> v2 (api/intake.js, owner 2026-10-27) on the TEST database, rolled back. HubSpot is faked (no network): each test
// says what HubSpot holds; the intake re-reads it like it does in production.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const I = require('../../api/intake');
const M = require('../../api/_hsmap');

after(() => h.closeDb());
process.env.HUBSPOT_READ_TOKEN = 'test-token';

// A fake HubSpot: { contacts: {id: {properties, companies:[]}}, companies: {...}, orders: {id: {properties, contacts:[], line_items:[]}}, line_items: {...} }
function fakeHubspot(db) {
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    const u = new URL(url);
    const ok = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) });
    let m;
    if ((m = u.pathname.match(/\/crm\/v3\/objects\/(contacts|companies|orders)\/(\d+)$/))) {
      const rec = (db[m[1]] || {})[m[2]];
      if (!rec) return { ok: false, status: 404, text: async () => '' };
      const assoc = {};
      for (const k of ['companies', 'contacts', 'line_items']) if (rec[k]) assoc[k] = { results: rec[k].map((id) => ({ id })) };
      return ok({ id: m[2], properties: rec.properties, associations: assoc });
    }
    if (/line_items\/batch\/read$/.test(u.pathname)) {
      const ids = JSON.parse(opts.body).inputs.map((x) => x.id);
      return ok({ results: ids.filter((id) => (db.line_items || {})[id]).map((id) => ({ id, properties: db.line_items[id] })) });
    }
    throw new Error('unexpected HubSpot call ' + url);
  };
  return () => { global.fetch = real; };
}
const n = Date.now() % 1e9;   // test-only HubSpot ids, never real ones
const copy = (method, url, body, response) => ({ wf: 'Test workflow', node: 'Test node', hs: { method, url: 'https://api.hubapi.com' + url, body: JSON.stringify(body || {}), response: response || {} } });

test('a contact n8n creates is added, with its clinic; the same copy again is a duplicate', async () => {
  await h.withDb(async (sql) => {
    const cid = String(800000000 + n), co = String(810000000 + n);
    const undo = fakeHubspot({ contacts: { [cid]: { properties: { firstname: 'Testa', lastname: 'Intake', email: 'testa.intake@demo.invalid', jobtitle: 'RN', hubspot_owner_id: '265024690' }, companies: [co] } },
      companies: { [co]: { properties: { name: 'Intake Test Clinic', city: 'Toronto', state: 'ON' } } } });
    try {
      const c1 = copy('POST', '/crm/v3/objects/contacts', { properties: { email: 'testa.intake@demo.invalid' } }, { id: cid });
      const r = await I.intake(sql, c1);
      assert.equal(r.ok, true); assert.equal(r.table, 'contacts'); assert.equal(r.created, true);
      const [c] = await sql`select c.id, c.first_name, c.role, c.owner_id, cl.name as clinic from contacts c left join clinics cl on cl.id = c.clinic_id where c.legacy_id = ${cid}`;
      assert.equal(c.id, M.uid('contact:' + cid));
      assert.equal(c.first_name, 'Testa'); assert.equal(c.role, 'injector'); assert.equal(c.owner_id, M.STAFF.info); assert.equal(c.clinic, 'Intake Test Clinic');
      assert.deepEqual(await I.intake(sql, c1), { ok: true, duplicate: true });
      const [ev] = await sql`select status, result_table from ingest_events where source = 'n8n' and result_id = ${c.id}`;
      assert.equal(ev.status, 'done');
      const [log] = await sql`select source::text from change_logs where entity_id = ${c.id} order by changed_at limit 1`;
      assert.equal(log.source, 'n8n');
    } finally { undo(); }
  });
});

test('a PATCH changes only the fields n8n changed; a PATCH to someone not in v2 is skipped', async () => {
  await h.withDb(async (sql) => {
    const cid = String(820000000 + n);
    const hs = { contacts: { [cid]: { properties: { firstname: 'Patcha', lastname: 'Intake', email: 'patcha@demo.invalid', hubspot_owner_id: '265024690', city: 'Ottawa' } } } };
    const undo = fakeHubspot(hs);
    try {
      await I.intake(sql, copy('POST', '/crm/v3/objects/contacts', {}, { id: cid }));
      await sql`update contacts set shipping_city = 'Kept in v2' where legacy_id = ${cid}`;
      hs.contacts[cid].properties = Object.assign({}, hs.contacts[cid].properties, { hubspot_owner_id: '268233660', city: 'Changed in HubSpot' });
      const r = await I.intake(sql, copy('PATCH', '/crm/v3/objects/contacts/' + cid, { properties: { hubspot_owner_id: '268233660' } }));
      assert.equal(r.ok, true);
      const [c] = await sql`select owner_id, shipping_city from contacts where legacy_id = ${cid}`;
      assert.equal(c.owner_id, M.uid('user:sam.almas@renellence.com'), 'the owner n8n changed');
      assert.equal(c.shipping_city, 'Kept in v2', 'a field n8n did not change stays');
      const s = await I.intake(sql, copy('PATCH', '/crm/v3/objects/contacts/' + (cid + '9'), { properties: { city: 'X' } }));
      assert.equal(s.skipped, true);
    } finally { undo(); }
  });
});

test('an Internal Sales Form order becomes an order with lines and a payment; a later PATCH moves it on', async () => {
  await h.withDb(async (sql) => {
    const cid = String(830000000 + n), oid = String(840000000 + n), li = String(850000000 + n);
    const hs = { contacts: { [cid]: { properties: { firstname: 'Orda', lastname: 'Intake', email: 'orda@demo.invalid', hubspot_owner_id: '268233804' } } },
      orders: { [oid]: { properties: { hs_order_name: '#T' + n, hs_pipeline_stage: '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03', hs_payment_status: 'Paid', hs_total_price: '450',
        hs_order_note: 'Internal Sales Order - Rep: Lucas Stockley (1) | CARD ON FILE (Stripe pi_x)', hs_external_created_date: new Date().toISOString() }, contacts: [cid], line_items: [li] } },
      line_items: { [li]: { name: 'saypha filler', hs_sku: 'SAF100', quantity: '2', price: '225' } } };
    const undo = fakeHubspot(hs);
    try {
      const r = await I.intake(sql, copy('POST', '/crm/v3/objects/orders', {}, { id: oid }));
      assert.equal(r.table, 'orders'); assert.equal(r.created, true);
      const [o] = await sql`select o.status::text, o.payment_method::text, (select count(*)::int from order_lines l where l.order_id = o.id) as lines,
                                   (select status::text from payments p where p.order_id = o.id) as pay, c.legacy_id as customer
                              from orders o join contacts c on c.id = o.contact_id where o.legacy_id = ${oid}`;
      assert.deepEqual([o.status, o.payment_method, o.lines, o.pay, o.customer], ['paid', 'card_on_file', 1, 'succeeded', cid]);
      hs.orders[oid].properties = Object.assign({}, hs.orders[oid].properties, { hs_pipeline_stage: '3725360f-x', tracking_number: 'TRK1' });
      await I.intake(sql, copy('PATCH', '/crm/v3/objects/orders/' + oid, { properties: { hs_pipeline_stage: '3725360f-x' } }));
      const [o2] = await sql`select status::text, tracking_number from orders where legacy_id = ${oid}`;
      assert.deepEqual([o2.status, o2.tracking_number], ['delivered', 'TRK1']);
    } finally { undo(); }
  });
});

test('live Edge: a rep\'s note goes on the contact\'s history (n8n\'s same note would not), and deleting it in Edge removes it', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const c = await h.contact(sql, me);
    const cHs = String(893000000 + n), note = String(894000000 + n);
    await sql`update contacts set legacy_id = ${cHs} where id = ${c}`;
    const real = global.fetch;
    global.fetch = async (url) => {
      if (new URL(url).pathname.endsWith('/notes/' + note)) return { ok: true, status: 200, text: async () => JSON.stringify({ id: note,
        properties: { hs_note_body: 'Dropped off the lips kit', hs_timestamp: new Date().toISOString(), hs_object_source: 'INTEGRATION' }, associations: { contacts: { results: [{ id: cHs }] } } }) };
      throw new Error('unexpected ' + url);
    };
    try {
      const fromN8n = await I.intake(sql, copy('POST', '/crm/v3/objects/notes', {}, { id: note }));
      assert.equal(fromN8n.skipped, true);
      const e = copy('POST', '/crm/v3/objects/notes', {}, { id: note });
      e.wf = 'Edge'; e.node = 'POST /crm/v3/objects/notes';
      const r = await I.intake(sql, e);
      assert.equal(r.table, 'interactions');
      const [i] = await sql`select body from interactions where contact_id = ${c} and external_id = ${'hubspot:note:' + note} and deleted_at is null`;
      assert.equal(i.body, 'Dropped off the lips kit');
      const d = copy('DELETE', '/crm/v3/objects/notes/' + note, null, {});
      d.wf = 'Edge'; d.node = 'DELETE';
      await I.intake(sql, d);
      const [{ n: left }] = await sql`select count(*)::int n from interactions where external_id = ${'hubspot:note:' + note} and deleted_at is null`;
      assert.equal(left, 0);
    } finally { global.fetch = real; }
  });
});

test('deals, automated notes and files are kept in the log as skipped, never applied', async () => {
  await h.withDb(async (sql) => {
    const r = await I.intake(sql, copy('POST', '/crm/v3/objects/deals', { properties: { dealname: 'x' } }, { id: String(860000000 + n) }));
    assert.equal(r.skipped, true);
    const [ev] = await sql`select status::text from ingest_events where source = 'n8n' and payload->'hs'->>'url' like '%objects/deals%' order by received_at desc limit 1`;
    assert.equal(ev.status, 'skipped');
  });
});
