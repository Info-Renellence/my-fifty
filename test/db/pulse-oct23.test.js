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
