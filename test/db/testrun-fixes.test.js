// Test run 2026-10-21: one block per bug fixed during the run (each failed before its fix). Rolled back, fictional data.
const { test, describe, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');
const T = require('../../api/_time');
const R = require('../../api/_rewards');
const A = require('../../api/act').OPS;

after(h.closeDb);
let f;
afterEach(() => { if (f) f.restore(); f = null; delete process.env.N8N_MYFIFTY_URL; });
const byId = async (sql, me) => Object.fromEntries((await B.book(sql, me)).people.map((p) => [p.id, p]));
async function ready(sql, me) {
  const c = await h.contact(sql, me);
  await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
  return c;
}
void T; void R;

describe('R24 wire orders: counted as paid, never a payment row', () => {
  test('placing a wire order writes no payment row, and the person is Fifty at once', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, payment: 'wire', lines: [{ sku: 'SAF100', qty: 2 }] });
    assert.equal((await sql`select count(*)::int n from payments where order_id = ${r.orderId}`)[0].n, 0, 'no payment row for a wire order');
    const [o] = await sql`select payment_method::text m from orders where id = ${r.orderId}`;
    assert.equal(o.m, 'wire');
    const p = (await byId(sql, me))[c];
    assert.equal(p.stage, 'fifty');
    assert.equal(p.totalBought, 450);
  }));
});
