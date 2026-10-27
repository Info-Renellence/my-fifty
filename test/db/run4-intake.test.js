// Run 4: A->B->A (api/intake.js) on the TEST database, rolled back. HubSpot is faked (no network): each test
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


test('run 4: the same change made, undone and made again is not dropped as a duplicate; an exact repeat still is', async () => {
  await h.withDb(async (sql) => {
    const cid = String(860000000 + n);
    const A = '265024690', B = '268233660';
    const hs = { contacts: { [cid]: { properties: { firstname: 'Abba', lastname: 'Intake', email: 'abba.r4@demo.invalid', hubspot_owner_id: A } } } };
    const undo = fakeHubspot(hs);
    try {
      await I.intake(sql, copy('POST', '/crm/v3/objects/contacts', {}, { id: cid }));
      const patch = (owner, at) => I.intake(sql, copy('PATCH', '/crm/v3/objects/contacts/' + cid, { properties: { hubspot_owner_id: owner } }, { id: cid, updatedAt: at, properties: { hubspot_owner_id: owner } }));
      const owner = async () => (await sql`select owner_id from contacts where legacy_id = ${cid}`)[0].owner_id;
      await patch(A, '2026-10-27T19:55:00.000Z');
      hs.contacts[cid].properties.hubspot_owner_id = B; await patch(B, '2026-10-27T20:00:00.000Z');
      assert.equal(await owner(), M.uid('user:sam.almas@renellence.com'));
      hs.contacts[cid].properties.hubspot_owner_id = A; const third = await patch(A, '2026-10-27T20:05:00.000Z');
      assert.notEqual(third.duplicate, true, 'the third copy (back to A) is a new change');
      assert.equal(await owner(), M.STAFF.info, 'v2 follows back to A');
      hs.contacts[cid].properties.hubspot_owner_id = B; await patch(B, '2026-10-27T20:09:00.000Z');
      hs.contacts[cid].properties.hubspot_owner_id = A; await patch(A, '2026-10-27T20:12:00.000Z');
      assert.equal(await owner(), M.STAFF.info, 'back with A after A, B, A, B, A')
      assert.deepEqual(await patch(A, '2026-10-27T20:12:00.000Z'), { ok: true, duplicate: true }, 'the very same copy again is a duplicate');
    } finally { undo(); }
  });
});
