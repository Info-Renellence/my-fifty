// Run 4: Pulse and Edge (a HubSpot copy through api/intake.js) writing the same contact at the same time, and Pulse double taps.
// COMMITS fake rows to the test database (v1): a fake rep and one fake contact (email @demo.invalid, numeric fake HubSpot id).
//   node --require ./test/run/no-network.js test/run/race-r4.js
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'test/helpers'));       // loads env, forces the test database, never v2
const { db } = require(path.join(ROOT, 'api/_db'));
const A = require(path.join(ROOT, 'api/act')).OPS;
const I = require(path.join(ROOT, 'api/intake'));
const M = require(path.join(ROOT, 'api/_hsmap'));
const t = Date.now();
let pass = 0, fail = 0;
const ok = (c, w) => { if (c) { pass++; console.log('ok   ', w); } else { fail++; console.log('FAIL ', w); } };

(async () => {
  const sql = db();
  const hsId = String(790000000 + (t % 1e7));
  const [u] = await sql`insert into users (email, full_name, kind, is_active) values (${'demo-test-r4-race-' + t + '@demo.invalid'}, 'Race Fiction', 'rep', true) returning id, email, full_name`;
  const me = { id: u.id, email: u.email, name: u.full_name, first: 'Race', initials: 'RF', kind: 'rep', preferences: {} };
  const [c] = await sql`insert into contacts (id, owner_id, first_name, last_name, email, legacy_id, lead_source, shipping_street, shipping_city)
    values (${M.uid('contact:' + hsId)}, ${u.id}, 'Raceo', 'Fiction', ${'race.' + t + '@demo.invalid'}, ${hsId}, 'warm', '1 Fake St', 'Testville') returning id`;
  // HubSpot stub: the contact as HubSpot holds it
  const hub = { firstname: 'Raceo', lastname: 'Fiction', email: 'race.' + t + '@demo.invalid', jobtitle: 'RN', hubspot_owner_id: '265024690' };
  const real = global.fetch;
  global.fetch = async (url) => {
    const m = new URL(url).pathname.match(/\/crm\/v3\/objects\/contacts\/(\d+)$/);
    if (m && m[1] === hsId) return { ok: true, status: 200, text: async () => JSON.stringify({ id: hsId, properties: hub, associations: {} }) };
    throw new Error('unexpected outside call ' + url);
  };
  process.env.HUBSPOT_READ_TOKEN = 'fake';
  const errs = [];
  const wrap = (p) => p.catch((e) => { errs.push(e.message); return null; });
  const jobs = [];
  for (let i = 0; i < 8; i++) {
    hub.jobtitle = 'RN' + i;
    jobs.push(wrap(A.shipping_address(me, { contactId: c.id, street: i + ' Race St', city: 'Raceville' })));
    jobs.push(wrap(A.invoice_email(me, { contactId: c.id, email: 'inv' + i + '.' + t + '@demo.invalid' })));
    jobs.push(wrap(A.set_uses(me, { contactId: c.id, fillers: [] })));
    jobs.push(wrap(I.intake(sql, { wf: 'Edge', node: 'race' + i, hs: { method: 'PATCH', url: 'https://api.hubapi.com/crm/v3/objects/contacts/' + hsId, body: JSON.stringify({ properties: { jobtitle: 'RN' + i } }), response: { id: hsId, updatedAt: new Date(t + i * 1000).toISOString() } } })));
    jobs.push(wrap(A.log(me, { contactId: c.id, kind: 'call', reached: true, followUp: 'tomorrow', note: 'Race call ' + i + '. Next: none' })));
  }
  // double taps: the same log twice at once
  jobs.push(wrap(A.log(me, { contactId: c.id, kind: 'visit', reached: true, followUp: 'tomorrow', note: 'Double tap visit' })), wrap(A.log(me, { contactId: c.id, kind: 'visit', reached: true, followUp: 'tomorrow', note: 'Double tap visit' })));
  await Promise.all(jobs);
  global.fetch = real;
  ok(errs.length === 0, 'no operation failed or deadlocked (' + errs.length + ' errors' + (errs[0] ? ': ' + errs[0].slice(0, 120) : '') + ')');
  const [row] = await sql`select shipping_street, secondary_email::text se, email::text e from contacts where id = ${c.id}`;
  ok(/^\d Race St$/.test(row.shipping_street) && /^inv\d\./.test(row.se), 'the address and invoice email are one whole, consistent value each (' + row.shipping_street + ', ' + row.se.slice(0, 8) + ')');
  ok(row.e === 'race.' + t + '@demo.invalid', 'the email Edge did not change is untouched');
  const [n] = await sql`select count(*)::int n from interactions where contact_id = ${c.id} and deleted_at is null`;
  ok(n.n === 8 + 2, 'every call logged once; the two double-tap visits both saved (' + n.n + ' interactions): a double tap makes two logs (undo is the guard)');
  const [dup] = await sql`select count(*)::int n from ingest_events where source = 'n8n' and payload->>'node' like 'race%' and (payload->'hs'->>'url') like ${'%' + hsId}`;
  ok(dup.n === 8, 'eight different Edge copies kept (' + dup.n + ')');
  console.log(pass + ' passed, ' + fail + ' failed. Fake rep ' + u.email + ' and contact ' + hsId + ' left in v1.');
  await sql.end({ timeout: 5 });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('stopped with an error', e); process.exit(1); });
