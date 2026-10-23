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

// RD11 (owner 2026-10-23): a ready-to-order person with no shipping address can't send an order; Review asks for one,
// and saving it (billing copies it when empty) lets Send go through.
test('RD11 no shipping address, no order: Send waits until the address is added', () => h.withDb(async (sql) => {
  const A = require('../../api/act').OPS;
  const me = await h.user(sql), other = await h.user(sql);
  const c = await h.contact(sql, me);
  await sql`update contacts set shipping_street = null, shipping_city = null, billing_street = null, billing_city = null where id = ${c}`;
  await sql`insert into onboardings (primary_contact_id, status) values (${c}, 'complete')`;
  const order = () => A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }], payment: 'wire' });
  await assert.rejects(order(), (e) => e.status === 409 && e.message === 'no_shipping_address');
  assert.equal((await sql`select count(*)::int as n from orders where contact_id = ${c}`)[0].n, 0, 'nothing written');
  await assert.rejects(A.shipping_address(me, { contactId: c, street: ' ', city: 'Toronto' }), (e) => e.status === 400 && e.message === 'address_required');
  await assert.rejects(A.shipping_address(other, { contactId: c, street: '1 Unit St', city: 'Toronto' }), (e) => e.status === 404);
  assert.deepEqual(await A.shipping_address(me, { contactId: c, street: ' 1 Unit St ', city: 'Toronto', province: 'ON', postal: 'm5v 1a1' }), { ok: true });
  const [r] = await sql`select shipping_street, shipping_city, shipping_province, shipping_postal_code, billing_street, billing_city from contacts where id = ${c}`;
  assert.deepEqual(r, { shipping_street: '1 Unit St', shipping_city: 'Toronto', shipping_province: 'ON', shipping_postal_code: 'M5V 1A1', billing_street: '1 Unit St', billing_city: 'Toronto' });
  const done = await order();
  assert.ok(done.orderId);
  // A billing address already there is kept.
  await sql`update contacts set billing_street = '9 Bill Rd', billing_city = 'Ottawa' where id = ${c}`;
  await A.shipping_address(me, { contactId: c, street: '2 Unit St', city: 'Toronto' });
  const [r2] = await sql`select billing_street, billing_city from contacts where id = ${c}`;
  assert.deepEqual(r2, { billing_street: '9 Bill Rd', billing_city: 'Ottawa' });
}));
