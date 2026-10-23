// Owner's answers 2026-10-23 (real-data RD3, RD4, RD11; head office): database checks, rolled back, test database only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');
const D = require('../../api/data')._;

after(h.closeDb);

const inbound = (sql, id) => sql`update interactions set direction = 'in' where id = ${id}`;

// RD3: only OUTBOUND calls, texts and emails are the rep's touches. An inbound one kept a lead from being "New", set the
// last touch, took them off Today and counted towards the day goal, and History showed it as "You".
test('RD3 inbound calls, texts and emails are not the rep\'s touches and show as from the person', () => h.withDb(async (sql) => {
  const me = await h.user(sql);
  const lead = await h.contact(sql, me, { first: 'Inga', source: 'social' });
  await inbound(sql, await h.touch(sql, lead, me.id, { kind: 'email', subject: 'Hello', outcome: null }));
  await inbound(sql, await h.touch(sql, lead, me.id, { kind: 'text', body: 'Hi there', outcome: null }));
  await inbound(sql, await h.touch(sql, lead, me.id, { kind: 'call' }));
  const before = (await B.book(sql, me, { contactId: lead })).people[0];
  assert.equal(before.isNew, true, 'still a New lead');
  assert.equal(before.touches, 0);
  assert.equal(before.lastTouchAt, null);
  assert.equal(before.touchedToday, false, 'stays on Today');
  const cfg = await B.settings(sql);
  assert.equal((await B.dayStats(sql, me, cfg)).done, 0, 'an inbound answered call is not a touchpoint');
  const hist = await D.historyOf(sql, me, before);
  assert.equal(hist.filter((e) => e.type === 'touch').length, 3);
  for (const e of hist.filter((x) => x.type === 'touch')) {
    assert.equal(e.by, 'Inga', 'from the person, never "You"');
    assert.match(e.title, / from Inga/);
    assert.equal(e.editable, false);
  }
  // An outbound one still counts, and so does one with no direction recorded (imported rows).
  const out = await h.touch(sql, lead, me.id, { kind: 'call' });
  await sql`update interactions set direction = null where id = ${out}`;
  const after = (await B.book(sql, me, { contactId: lead })).people[0];
  assert.equal(after.isNew, false);
  assert.equal(after.touches, 1);
  assert.equal(after.touchedToday, true);
  assert.equal((await B.dayStats(sql, me, cfg)).done, 1);
  const mine = (await D.historyOf(sql, me, after)).find((e) => e.type === 'touch' && e.by === 'You');
  assert.ok(mine && mine.title === 'Call · reached');
}));

// RD4 (owner 2026-10-23): an imported meeting with no type counts as a call everywhere: a touchpoint when they were
// reached, a "Call" in History and the last touch, and never a visit (it does not keep a Fifty person from going cold).
test('RD4 a meeting with no type is a call, not a visit', () => h.withDb(async (sql) => {
  const me = await h.user(sql);
  const c = await h.contact(sql, me);
  await h.order(sql, c, me, { days: 40, paid: true, status: 'paid' });
  const m = await h.touch(sql, c, me.id, { kind: 'meeting' });
  await sql`update interactions set mode = null where id = ${m}`;
  const p = (await B.book(sql, me, { contactId: c })).people[0];
  assert.equal(p.lastTouchKind, 'call');
  assert.equal(p.lastVisitAt, null, 'not a visit');
  assert.equal(p.goingCold, true, 'still going cold');
  assert.equal(p.touchedToday, true);
  assert.equal((await B.dayStats(sql, me, await B.settings(sql))).done, 1, 'a touchpoint, as a reached call');
  const e = (await D.historyOf(sql, me, p)).find((x) => x.type === 'touch');
  assert.deepEqual([e.kind, e.title], ['call', 'Call · reached']);
  assert.match(await D.lastHistoryLine(sql, p), /^Call · reached/);
}));
