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
describe('users.settings that are not an object (seen live on a real row)', () => {
  test('seen_fifty and snooze still work when settings were saved as a list', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await sql`update users set settings = '[{}, "{\\"fifty_seen_at\\":\\"2026-10-20T20:03:31.675Z\\"}"]'::jsonb where id = ${me.id}`;
    me.settings = (await sql`select settings from users where id = ${me.id}`)[0].settings;
    const c = await h.contact(sql, me);
    await A.seen_fifty(me);
    await A.snooze(me, { contactId: c });
    const [u] = await sql`select settings, jsonb_typeof(settings) t from users where id = ${me.id}`;
    assert.equal(u.t, 'object', 'settings are an object again');
    assert.ok(u.settings.fifty_seen_at, 'the bookmark is kept');
    assert.ok(u.settings.snoozed && u.settings.snoozed[c], 'the snooze is kept');
  }));
});
describe('R5 / R12 cancelled visits are not visits', () => {
  test('a lead whose only visit was cancelled is still a new lead', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.touch(sql, c, me.id, { kind: 'meeting', status: 'cancelled', days: 1 });
    assert.equal((await byId(sql, me))[c].isNew, true);
  }));
  test('a visit cancelled today does not take someone off today\'s list', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.task(sql, c, me.id, { due: h.ago(1) });
    await h.touch(sql, c, me.id, { kind: 'meeting', status: 'cancelled', at: new Date() });
    assert.equal((await byId(sql, me))[c].touchedToday, false);
  }));
});
describe('R5 cancelled visits: the new-lead push', () => {
  test('a new social lead whose only visit was cancelled is still found for the new-lead push', () => h.withDb(async (sql) => {
    const cron = require('../../api/cron')._;
    const me = await h.user(sql);
    await h.contact(sql, me, { source: 'social', createdAt: h.ago(0, 1) });
    const before = (await cron.newLeads(sql)).found;
    const c = await h.contact(sql, me, { source: 'social', createdAt: h.ago(0, 1) });
    await h.touch(sql, c, me.id, { kind: 'meeting', status: 'cancelled', at: new Date() });
    assert.equal((await cron.newLeads(sql)).found, before + 1);
  }));
});
