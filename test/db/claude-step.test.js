// The Next step box shows Claude's next step from the latest summarised call (owner 2026-10-29, Dr Colin Hong's call)
// when the rep's own follow-up is only a plain "Follow up" or there is none. TEST database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const D = require('../../api/data').OPS;
const A = require('../../api/act').OPS;
const T = require('../../api/_time');

after(h.closeDb);
const Q = (o) => new URLSearchParams(o);
const read = (sql, me, id) => D.person(sql, me, Q({ id }));

test('Claude\'s step shows with no follow-up; the rep\'s own step wins; a newer follow-up hides an older Claude step', () => h.withDb(async (sql) => {
  const me = await h.user(sql), c = await h.contact(sql, me);
  const call = await h.touch(sql, c, me.id, { kind: 'call', source: 'quo' });
  await sql`insert into ai_outputs (kind, contact_id, interaction_id, output_text, output_json, created_at)
            values ('call_summary', ${c}, ${call}, 'Spoke with the office.', ${sql.json({ next_step: 'Book the Nov 23 meeting.' })}, now() - interval '1 hour')`;
  let p = await read(sql, me, c);
  assert.equal(p.claudeStep.text, 'Book the Nov 23 meeting.');
  await A.set_follow_up(me, { contactId: c, date: T.addDays(T.ymd(), 3), title: 'Call the office back' });
  p = await read(sql, me, c);
  assert.equal(p.claudeStep, null, 'the rep\'s own words win');
  const d = await h.contact(sql, me);
  const call2 = await h.touch(sql, d, me.id, { kind: 'call', source: 'quo' });
  await sql`insert into ai_outputs (kind, contact_id, interaction_id, output_json, created_at)
            values ('call_summary', ${d}, ${call2}, ${sql.json({ next_step: 'Old step.' })}, now() - interval '2 days')`;
  await A.set_follow_up(me, { contactId: d, date: T.addDays(T.ymd(), 3) });   // a plain follow-up made after it
  p = await read(sql, me, d);
  assert.equal(p.claudeStep, null);
}));
