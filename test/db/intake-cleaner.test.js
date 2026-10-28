// Live Edge's Data Cleaner through the intake (owner 2026-10-28; run 4 R4-3 merges/deletes skipped, R4-4 a removed link
// read as added). No HubSpot read is needed for any of these: the copy says everything. Test database, rolled back.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const I = require('../../api/intake');

after(() => h.closeDb());
const copy = (method, url, body) => ({ method, url: 'https://api.hubapi.com' + url, body: JSON.stringify(body || {}), response: {} });
const legacy = (sql, table, id, hs) => sql.unsafe(`update public.${table} set legacy_id = $1 where id = $2`, [hs, id]);
const uniq = () => String(800000000000 + Math.floor(Math.random() * 1e9));

test('a contact merge moves the calls, tasks and orders to the one kept and soft-deletes the other', () => h.withDb(async (sql) => {
  const me = await h.user(sql), keep = await h.contact(sql, me), gone = await h.contact(sql, me);
  const [k, g] = [uniq(), uniq()];
  await legacy(sql, 'contacts', keep, k); await legacy(sql, 'contacts', gone, g);
  const call = await h.touch(sql, gone, me.id, {}), order = await h.order(sql, gone, me, {});
  const r = await I.apply(sql, copy('POST', '/crm/v3/objects/contacts/merge', { primaryObjectId: k, objectIdToMerge: g }), { fromEdge: true });
  assert.equal(r.merged, gone);
  const [x] = await sql`select deleted_at, merged_into_contact_id from contacts where id = ${gone}`;
  assert.ok(x.deleted_at, 'soft-deleted');
  assert.equal(x.merged_into_contact_id, keep);
  assert.equal((await sql`select contact_id from interactions where id = ${call}`)[0].contact_id, keep);
  assert.equal((await sql`select contact_id from orders where id = ${order}`)[0].contact_id, keep);
}));

test('a merge where v2 has only the merged-away contact gives it the kept HubSpot id', () => h.withDb(async (sql) => {
  const me = await h.user(sql), gone = await h.contact(sql, me), [k, g] = [uniq(), uniq()];
  await legacy(sql, 'contacts', gone, g);
  const r = await I.apply(sql, copy('POST', '/crm/v3/objects/contacts/merge', { primaryObjectId: k, objectIdToMerge: g }), { fromEdge: true });
  assert.ok(r.rekeyed);
  assert.equal((await sql`select legacy_id, deleted_at from contacts where id = ${gone}`)[0].legacy_id, k);
}));

test('a clinic merge moves its people; a delete or an archive soft-deletes', () => h.withDb(async (sql) => {
  const me = await h.user(sql), a = await h.clinic(sql), b = await h.clinic(sql), [ka, kb] = [uniq(), uniq()];
  await legacy(sql, 'clinics', a.id, ka); await legacy(sql, 'clinics', b.id, kb);
  const p = await h.contact(sql, me, { clinicId: b.id });
  await I.apply(sql, copy('POST', '/crm/v3/objects/companies/merge', { primaryObjectId: ka, objectIdToMerge: kb }), { fromEdge: true });
  assert.equal((await sql`select clinic_id from contacts where id = ${p}`)[0].clinic_id, a.id);
  assert.ok((await sql`select deleted_at from clinics where id = ${b.id}`)[0].deleted_at);

  const d1 = await h.contact(sql, me), d2 = await h.contact(sql, me), [k1, k2] = [uniq(), uniq()];
  await legacy(sql, 'contacts', d1, k1); await legacy(sql, 'contacts', d2, k2);
  assert.equal((await I.apply(sql, copy('DELETE', '/crm/v3/objects/contacts/' + k1), { fromEdge: true })).deleted, 1);
  assert.equal((await I.apply(sql, copy('POST', '/crm/v3/objects/contacts/batch/archive', { inputs: [{ id: k2 }] }), { fromEdge: true })).deleted, 1);
  assert.equal((await sql`select count(*)::int n from contacts where id = any(${[d1, d2]}) and deleted_at is not null`)[0].n, 2);
}));

test('removing a contact-clinic link clears it (it used to be read as adding it)', () => h.withDb(async (sql) => {
  const me = await h.user(sql), cl = await h.clinic(sql), p = await h.contact(sql, me, { clinicId: cl.id }), [kp, kc] = [uniq(), uniq()];
  await legacy(sql, 'contacts', p, kp); await legacy(sql, 'clinics', cl.id, kc);
  const r = await I.apply(sql, copy('DELETE', '/crm/v4/objects/contacts/' + kp + '/associations/companies/' + kc), { fromEdge: true });
  assert.ok(r.unlinked);
  assert.equal((await sql`select clinic_id from contacts where id = ${p}`)[0].clinic_id, null);
}));
