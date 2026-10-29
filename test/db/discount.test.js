// Order values less the order's discount (owner 2026-10-29: "subtract discounts", so Pulse matches HubSpot and the
// invoice). TEST database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');

after(h.closeDb);

test('total = paid lines less the discount, never below zero; samples stay free', () => h.withDb(async (sql) => {
  const me = await h.user(sql), c = await h.contact(sql, me);
  const o1 = await h.order(sql, c, me, { lines: [['SAF100', 4]], paid: true, days: 3 });
  const o2 = await h.order(sql, c, me, { lines: [['SAF100', 1]], paid: true, days: 1 });
  const [{ full }] = await sql`select sum(quantity * unit_price)::float8 full from order_lines where order_id = ${o1}`;
  await sql`update orders set discount_amount = 100 where id = ${o1}`;
  await sql`update orders set discount_amount = 999999 where id = ${o2}`;
  const [p] = (await B.book(sql, me, { contactId: c })).people;
  const by = Object.fromEntries(p.orders.map((o) => [o.id, o.total]));
  assert.equal(by[o1], full - 100);
  assert.equal(by[o2], 0);
  assert.equal(p.totalBought, full - 100);
}));
