// Real-data run 2026-10-22: database checks for what the real books showed (rolled back, test database only).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/act').OPS;

after(h.closeDb);

// RD10: a person merged into another is hidden, but "Add person" still found their email / phone and offered to open
// them, which led to "not found". The warning now points to the person they were merged into.
test('a duplicate on a merged-away person points to the person they were merged into', () => h.withDb(async (sql) => {
  const me = await h.user(sql), other = await h.user(sql);
  const keep = await h.contact(sql, me);
  const gone = await h.contact(sql, me, { email: 'merged.' + h.uid() + '@test.invalid', phone: '+16475550' + String(Date.now() % 1000).padStart(3, '0') });
  await sql`update contacts set merged_into_contact_id = ${keep} where id = ${gone}`;
  const [g] = await sql`select email, mobile_phone from contacts where id = ${gone}`;
  await assert.rejects(A.add_person(me, { firstName: 'X', email: g.email }), (e) => e.status === 409 && e.message === 'email_yours' && e.detail === keep);
  await assert.rejects(A.add_person(me, { firstName: 'X', phone: g.mobile_phone, sharedEmailOk: true }), (e) => e.status === 409 && e.message === 'already_yours' && e.detail === keep);
  // merged into someone else's person: theirs, no id given
  const theirs = await h.contact(sql, other);
  await sql`update contacts set merged_into_contact_id = ${theirs} where id = ${gone}`;
  await assert.rejects(A.add_person(me, { firstName: 'X', email: g.email }), (e) => e.status === 409 && e.message === 'email_someones' && !e.detail);
}));
