// The person card's Lead / Candidate switch (contacts.rep_stage, v2-017) and the Next step (what + when), owner
// 2026-10-29. TEST database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const A = require('../../api/act').OPS;
const B = require('../../api/_book');
const T = require('../../api/_time');

after(h.closeDb);
const st = (status, message) => (e) => e.status === status && e.message === message;
const stageOf = async (sql, me, id) => (await B.book(sql, me, { contactId: id })).people[0].stage;

test('a rep marks a lead a candidate and back; Let Pulse decide clears it; samples still work as before', () => h.withDb(async (sql) => {
  const me = await h.user(sql), c = await h.contact(sql, me);
  assert.equal(await stageOf(sql, me, c), 'lead');
  let r = await A.set_stage(me, { contactId: c, stage: 'candidate' });
  assert.deepEqual([r.stage, r.byHand], ['candidate', true]);
  const [p] = (await B.book(sql, me, { contactId: c })).people;
  assert.deepEqual([p.stage, p.sampleOrder, p.samplesAt], ['candidate', null, null], 'a candidate by hand with no samples yet');
  const [log] = await sql`select new_value from change_logs where entity_id = ${c} and field_name = 'rep_stage' order by changed_at desc limit 1`;
  assert.ok(log, 'the change is in change_logs');
  r = await A.set_stage(me, { contactId: c, stage: 'auto' });
  assert.deepEqual([r.stage, r.byHand], ['lead', false]);
  await h.order(sql, c, me, { lines: [['SAF100', 2, true]], status: 'delivered', delivered: 3 });   // samples
  assert.equal(await stageOf(sql, me, c), 'candidate', 'samples still make a candidate');
  await A.set_stage(me, { contactId: c, stage: 'lead' });
  assert.equal(await stageOf(sql, me, c), 'lead', 'the rep\'s choice sticks over the samples');
}));

test('an order still makes them My Fifty; My Fifty can\'t be set by hand; bad values and other people refused', () => h.withDb(async (sql) => {
  const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me), theirs = await h.contact(sql, other);
  await A.set_stage(me, { contactId: c, stage: 'lead' });
  await h.order(sql, c, me, { days: 5 });
  assert.equal(await stageOf(sql, me, c), 'fifty');
  await assert.rejects(A.set_stage(me, { contactId: c, stage: 'candidate' }), st(409, 'in_fifty'));
  const d = await h.contact(sql, me);
  await assert.rejects(A.set_stage(me, { contactId: d, stage: 'fifty' }), st(400, 'bad_stage'));
  await assert.rejects(A.set_stage(me, { contactId: theirs, stage: 'lead' }));
}));

test('Next step: what and when, on the open follow-up or a new one; no words keeps the old ones', () => h.withDb(async (sql) => {
  const me = await h.user(sql), c = await h.contact(sql, me), d = await h.contact(sql, me);
  const later = T.addDays(T.ymd(), 4);
  let r = await A.set_follow_up(me, { contactId: c, date: later, title: '  Drop off   saypha lips samples ' });
  assert.equal(r.title, 'Drop off saypha lips samples');
  let [t] = await sql`select title, due_at from tasks where contact_id = ${c} and status = 'open'`;
  assert.deepEqual([t.title, t.due_at.toISOString()], ['Drop off saypha lips samples', T.atLocal(later, 9, 0).toISOString()]);
  await A.set_follow_up(me, { contactId: c, date: T.addDays(later, 1) });
  [t] = await sql`select title from tasks where contact_id = ${c} and status = 'open'`;
  assert.equal(t.title, 'Drop off saypha lips samples', 'a date-only change keeps the step');
  await A.set_follow_up(me, { contactId: d, date: later, title: '' });
  [t] = await sql`select title from tasks where contact_id = ${d} and status = 'open'`;
  assert.equal(t.title, 'Follow up');
  const [p] = (await B.book(sql, me, { contactId: c })).people;
  assert.equal(p.followUp.title, 'Drop off saypha lips samples');
}));
