// Academy interest sign-ups into v2 (api/_academy.js, owner 2026-10-29). Test database (v1), rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/_academy');

after(() => h.closeDb());

test('a new sign-up becomes an event lead with its message as a note; the same one again is a duplicate; someone v2 has keeps their record and gets the note', () => h.withDb(async (sql) => {
  const n = Date.now() % 1e8;
  const reg = { first_name: 'Ada', last_name: 'Academy' + n, email: 'ada' + n + '@demo.invalid', phone: '416555' + String(n).slice(-4), city: 'Calgary', clinic: 'Demo Clinic', message: 'Interested in the lips course', submitted_at: '2026-10-29T15:00:00Z' };
  const r = await A.academy(sql, { wf: 'Academy', kind: 'academy', reg });
  assert.equal(r.ok, true); assert.equal(r.added, true);
  const [c] = await sql`select lead_source::text, owner_id, shipping_city, first_name from contacts where id = ${r.id}`;
  assert.deepEqual([c.lead_source, c.shipping_city, c.first_name], ['event', 'Calgary', 'Ada']);
  assert.ok(c.owner_id, 'Calgary is one rep\'s area, so the lead has an owner');
  const [note] = await sql`select kind::text, body from interactions where contact_id = ${r.id}`;
  assert.equal(note.kind, 'note'); assert.match(note.body, /Demo Clinic/); assert.match(note.body, /lips course/);
  assert.equal((await A.academy(sql, { wf: 'Academy', kind: 'academy', reg })).duplicate, true, 'the same sign-up twice is kept once');

  const rep = await h.user(sql), known = await h.contact(sql, rep);
  await sql`update contacts set email = ${'known' + n + '@demo.invalid'} where id = ${known}`;
  const k = await A.academy(sql, { wf: 'Academy', kind: 'academy', reg: { first_name: 'Other', email: 'KNOWN' + n + '@demo.invalid', city: 'Toronto', submitted_at: '2026-10-29T16:00:00Z' } });
  assert.equal(k.id, known); assert.equal(k.added, false);
  const [{ n: notes }] = await sql`select count(*)::int n from interactions where contact_id = ${known} and kind = 'note'`;
  assert.equal(notes, 1);
  const t = await A.academy(sql, { wf: 'Academy', kind: 'academy', reg: { first_name: 'Tess', email: 'tess' + n + '@demo.invalid', city: 'Toronto', submitted_at: '2026-10-29T17:00:00Z' } });
  const [o] = await sql`select owner_id from contacts where id = ${t.id}`;
  assert.equal(o.owner_id, null, 'Ontario without a postal code: an admin assigns');
  assert.equal((await A.academy(sql, { wf: 'Academy', kind: 'academy', reg: { first_name: 'Nobody' } })).skipped, true, 'no email or phone: skipped');
}));
