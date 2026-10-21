// Test run 2026-10-21: section-1 rules and edge cases the earlier suites did not cover (rolled back, fictional data).
const { test, describe, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');
const T = require('../../api/_time');
const R = require('../../api/_rewards');
const D = require('../../api/data').OPS;
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




describe('R1-R4 stages, odd orders', () => {
  test('every order status: only paid ones make Fifty; rejected/cancelled/deleted are ignored', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const out = {};
    for (const s of ['submitted', 'approved', 'rejected', 'awaiting_md', 'invoiced', 'paid', 'sent_to_warehouse', 'shipped', 'delivered', 'cancelled']) {
      const c = await h.contact(sql, me);
      await h.order(sql, c, me, { status: s });
      out[s] = c;
    }
    const d = await h.contact(sql, me);
    const od = await h.order(sql, d, me, { status: 'shipped' });
    await sql`update orders set deleted_at = now() where id = ${od}`;
    const by = await byId(sql, me);
    const fifty = Object.entries(out).filter(([, c]) => by[c].stage === 'fifty').map(([s]) => s);
    assert.deepEqual(fifty, ['paid', 'sent_to_warehouse', 'shipped', 'delivered']);
    assert.equal(by[out.rejected].stage, 'lead');
    assert.equal(by[out.cancelled].stage, 'lead');
    assert.equal(by[d].stage, 'lead');
  }));
  test('mixed free + paid lines with a zero-price line: Fifty, money counts paid lines only', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'shipped', lines: [['SAF100', 1], ['SAL400', 3, true], ['HDB100', 2]] });
    const p = (await byId(sql, me))[c];
    assert.equal(p.stage, 'fifty');
    assert.equal(p.totalBought, 225);
  }));
  test('a sample order marked shipped/paid is still samples (candidate), never Fifty', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'delivered', delivered: 2, lines: [['SAL400', 2, true]], paid: true });
    assert.equal((await byId(sql, me))[c].stage, 'candidate');
  }));
  test('samples plus an unpaid order stays a candidate; a test payment never makes Fifty', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { lines: [['SAL400', 1, true]], delivered: 4 });
    await h.order(sql, c, me, { status: 'approved', paid: true, testPayment: true });
    assert.equal((await byId(sql, me))[c].stage, 'candidate');
  }));
});

describe('R6 going cold, R14 milestones', () => {
  test('a cancelled visit does not keep someone warm', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'shipped', days: 40 });
    await h.touch(sql, c, me.id, { kind: 'meeting', status: 'cancelled', days: 2 });
    assert.equal((await byId(sql, me))[c].goingCold, true);
  }));
  test('the going-cold setting is used (20 days)', () => h.withDb(async (sql) => {
    await sql`update settings set value = value || '{"going_cold_days": 20}'::jsonb where key = 'my_fifty'`;
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'shipped', days: 21 });
    assert.equal((await byId(sql, me))[c].goingCold, true);
  }));
  test('milestones every 5', () => {
    assert.deepEqual([0, 4, 5, 9, 49, 50].map(B.nextMilestone), [5, 5, 10, 10, 50, 55]);
  });
});

describe('R8 / R9 day goal and streak', () => {
  test('cancelled and scheduled calls and visits are not touchpoints; texts and video calls neither', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const now = new Date();
    await h.touch(sql, c, me.id, { kind: 'call', at: now });
    await h.touch(sql, c, me.id, { kind: 'meeting', at: now });
    await h.touch(sql, c, me.id, { kind: 'call', status: 'cancelled', at: now });
    await h.touch(sql, c, me.id, { kind: 'meeting', status: 'scheduled', at: now });
    await h.touch(sql, c, me.id, { kind: 'text', at: now });
    await h.touch(sql, c, me.id, { kind: 'meeting', mode: 'video', at: now });
    const d = await B.dayStats(sql, me, await B.settings(sql));
    assert.equal(d.done, 2);
  }));
  test('a call at 11:30 PM Toronto counts for that Toronto day, not the next (UTC) day', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const yesterday = T.addDays(T.ymd(), -1);
    await h.touch(sql, c, me.id, { kind: 'call', at: T.atLocal(yesterday, 23, 30) });
    const d = await B.dayStats(sql, me, await B.settings(sql));
    assert.equal(d.done, 0, 'yesterday 11:30 PM is not today');
  }));
});

describe('R10 Toronto time across daylight saving', () => {
  test('9 AM and 5 PM are right on the days the clocks change', () => {
    assert.equal(T.atLocal('2026-11-01', 9, 0).toISOString(), '2026-11-01T14:00:00.000Z');
    assert.equal(T.atLocal('2026-10-31', 17, 0).toISOString(), '2026-10-31T21:00:00.000Z');
    assert.equal(T.atLocal('2027-03-14', 9, 0).toISOString(), '2027-03-14T13:00:00.000Z');
    assert.equal(T.atLocal('2027-03-13', 23, 59).toISOString(), '2027-03-14T04:59:00.000Z');
    assert.equal(T.ymd(new Date('2026-11-01T04:30:00Z')), '2026-11-01');
    assert.equal(T.ymd(new Date('2026-11-01T03:59:00Z')), '2026-10-31');
    assert.equal(T.daysBetween(new Date('2026-10-31T12:00:00Z'), new Date('2026-11-02T12:00:00Z')), 2);
  });
});

describe('R15-R19 rewards edge cases', () => {
  function around(from, to) { const keep = JSON.parse(JSON.stringify(R.PROGRAMS)); for (const k of ['booster', 'trip']) { R.PROGRAMS[k].from = from; R.PROGRAMS[k].to = to; } return () => { for (const k of ['booster', 'trip']) Object.assign(R.PROGRAMS[k], keep[k]); }; }
  test('a wire order counts on the day it was placed', () => h.withDb(async (sql) => {
    const back = around(T.addDays(T.ymd(), -5), T.addDays(T.ymd(), 5));
    try {
      const me = await h.user(sql), c = await h.contact(sql, me);
      await h.order(sql, c, me, { status: 'submitted', method: 'wire', days: 2, lines: [['SAF100', 4]] });
      await h.order(sql, c, me, { status: 'submitted', method: 'wire', days: 10, lines: [['SAF100', 4]] });
      const r = await R.rewards(sql, me);
      assert.equal(r.booster.onNew, '$0', 'the first order was placed before the period');
      assert.equal(r.booster.onReorders, '$36', '4% of 900');
    } finally { back(); }
  }));
  test('the last evening of the quarter (Dec 31, 11:30 PM Toronto) is still in the Q4 Booster', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const o = await h.order(sql, c, me, { status: 'approved', lines: [['SAF100', 2]] });
    await sql`update orders set submitted_at = ${T.atLocal('2026-12-31', 23, 30)} where id = ${o}`;
    await sql`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test) values (${o}, 'charge', 'card_on_file', 450, 'CAD', 'succeeded', 'stripe', ${T.atLocal('2026-12-31', 23, 30)}, false)`;
    const o2 = await h.order(sql, c, me, { status: 'approved', lines: [['SAF100', 4]] });
    await sql`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test) values (${o2}, 'charge', 'card_on_file', 900, 'CAD', 'succeeded', 'stripe', ${T.atLocal('2027-01-01', 0, 30)}, false)`;
    const r = await R.rewards(sql, me);
    assert.equal(r.booster.onNew, '$9');
    assert.equal(r.booster.onReorders, '$0', 'Jan 1 is after the quarter');
  }));
  test('a reorder for me after another rep made the first sale is a reorder, and their new person is theirs', () => h.withDb(async (sql) => {
    const back = around(T.addDays(T.ymd(), -30), T.addDays(T.ymd(), 5));
    try {
      await sql`update users set active = false where kind = 'rep'`;
      const me = await h.user(sql, { name: 'Pat Rep' }), other = await h.user(sql, { name: 'Robin Rep' }), c = await h.contact(sql, me);
      await h.order(sql, c, other, { status: 'shipped', days: 10, lines: [['SAF100', 2]] });
      await h.order(sql, c, me, { status: 'shipped', days: 2, lines: [['SAF100', 2]] });
      const r = await R.rewards(sql, me);
      assert.equal(r.booster.onNew, '$0');
      assert.equal(r.booster.onReorders, '$18');
      assert.deepEqual(r.trip.rows.map((x) => [x.name, x.n]), [['Robin', 1], ['You', 0]]);
    } finally { back(); }
  }));
});

describe('R11 today\'s list', () => {
  test('order of the four groups, each person once, reached-today and snoozed people drop off', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const lead = await h.contact(sql, me, { source: 'social', detail: 'Instagram', createdAt: h.ago(0, 2) });
    const oldLead = await h.contact(sql, me, { source: 'social', createdAt: h.ago(0, 25) });
    const fu = await h.contact(sql, me); await h.task(sql, fu, me.id, { due: h.ago(2) });
    const cold = await h.contact(sql, me); await h.order(sql, cold, me, { status: 'shipped', days: 50 });
    await h.task(sql, cold, me.id, { due: h.ago(1) });   // also due: shows once, as a follow-up
    const cold2 = await h.contact(sql, me); await h.order(sql, cold2, me, { status: 'shipped', days: 45 });
    const cand = await h.contact(sql, me); await h.order(sql, cand, me, { lines: [['SAL400', 1, true]], delivered: 5 });
    const reached = await h.contact(sql, me); await h.order(sql, reached, me, { status: 'shipped', days: 60 }); await h.touch(sql, reached, me.id, { at: new Date() });
    const hidden = await h.contact(sql, me); await h.order(sql, hidden, me, { status: 'shipped', days: 70 });
    me.settings = { snoozed: { [hidden]: T.addDays(T.ymd(), 1) } };
    const cfg = await B.settings(sql);
    const list = B.todayList((await B.book(sql, me, { cfg })).people, me, cfg);
    assert.deepEqual(list.map((x) => [x.id, x.why]), [[lead, 'lead'], [fu, 'follow_up'], [cold, 'follow_up'], [cold2, 'going_cold'], [cand, 'candidate']]);
    assert.ok(!list.some((x) => x.id === oldLead));
  }));
});
