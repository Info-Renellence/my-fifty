// api/_book.js against v2: settings, orders, the book (stages, going cold, candidates), the day goal and the streak.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');
const T = require('../../api/_time');

after(h.closeDb);
const noon = (date) => T.atLocal(date, 12, 0);
// The last n business days before today (no weekends, none of `holidays`), newest first.
function lastBusinessDays(n, holidays) {
  const out = [];
  for (let d = T.addDays(T.ymd(), -1); out.length < n; d = T.addDays(d, -1)) if (T.isBusinessDay(d, holidays)) out.push(d);
  return out;
}

describe('settings', () => {
  test('stored settings override the defaults and holidays come back as a list', () => h.withDb(async (sql) => {
    await sql`update settings set value = '{"daily_goal": 6}'::jsonb where key = 'my_fifty'`;
    await sql`update settings set value = '["2026-12-25"]'::jsonb where key = 'holidays'`;
    const s = await B.settings(sql);
    assert.equal(s.daily_goal, 6);
    assert.equal(s.going_cold_days, 30);
    assert.deepEqual(s.holidays, ['2026-12-25']);
  }));
  test('with nothing stored, the defaults are used and there are no holidays', () => h.withDb(async (sql) => {
    await sql`delete from settings where key in ('my_fifty', 'holidays')`;
    const s = await B.settings(sql);
    assert.deepEqual([s.daily_goal, s.going_cold_days, s.fifty_goal, s.new_lead_hours, s.holidays], [8, 30, 50, 24, []]);
  }));
  test('holidays that are not a list are ignored', () => h.withDb(async (sql) => {
    await sql`update settings set value = '"oops"'::jsonb where key = 'holidays'`;
    assert.deepEqual((await B.settings(sql)).holidays, []);
  }));
});

describe('ordersFor', () => {
  test('nothing asked, nothing returned', () => h.withDb(async (sql) => assert.deepEqual(await B.ordersFor(sql, []), [])));
  test('totals count paid lines only, and a sample order is all free', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { lines: [['SAF100', 2], ['HDB100', 1, true]] });
    await h.order(sql, c, me, { lines: [['SAL400', 2, true]], days: 1 });
    const [newest, older] = await B.ordersFor(sql, [c]);
    assert.equal(newest.total, 450);
    assert.equal(B.isSample(newest), false);
    assert.equal(older.total, 0);
    assert.equal(B.isSample(older), true);
    assert.equal(newest.summary[0].sku, 'SAF100', 'saypha lines come first');
  }));
  test('paid: a paid status, a wire order, or a real succeeded payment; not a test payment, not a bare order', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const ids = {
      shipped: await h.order(sql, c, me, { status: 'shipped' }),
      wire: await h.order(sql, c, me, { status: 'submitted', method: 'wire' }),
      card: await h.order(sql, c, me, { status: 'approved', paid: true }),
      test: await h.order(sql, c, me, { status: 'approved', paid: true, testPayment: true }),
      open: await h.order(sql, c, me, { status: 'approved' }),
    };
    const by = Object.fromEntries((await B.ordersFor(sql, [c])).map((o) => [o.id, o]));
    assert.deepEqual(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, by[id].paid_flag])), { shipped: true, wire: true, card: true, test: false, open: false });
    assert.ok(by[ids.card].paid_at, 'the payment time is read');
  }));
  test('cancelled, rejected and deleted orders are left out', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'cancelled' });
    await h.order(sql, c, me, { status: 'rejected' });
    const d = await h.order(sql, c, me, { status: 'shipped' });
    await sql`update orders set deleted_at = now() where id = ${d}`;
    assert.equal((await B.ordersFor(sql, [c])).length, 0);
  }));
});

describe('book', () => {
  test('an empty book', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    assert.deepEqual((await B.book(sql, me)).people, []);
  }));
  test('only my live people: not someone else’s, not deleted, not merged', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const mine = await h.contact(sql, me);
    await h.contact(sql, other);
    const del = await h.contact(sql, me); await sql`update contacts set deleted_at = now() where id = ${del}`;
    const mer = await h.contact(sql, me); await sql`update contacts set merged_into_id = ${mine} where id = ${mer}`;
    assert.deepEqual((await B.book(sql, me)).people.map((p) => p.id), [mine]);
  }));
  test('stages: no orders = lead, samples only = candidate, a paid order = Fifty', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const lead = await h.contact(sql, me), cand = await h.contact(sql, me), fifty = await h.contact(sql, me);
    await h.order(sql, cand, me, { lines: [['SAL400', 2, true]], shipped: 5, delivered: 3 });
    await h.order(sql, fifty, me, { status: 'shipped', days: 2 });
    const by = Object.fromEntries((await B.book(sql, me)).people.map((p) => [p.id, p]));
    assert.deepEqual([by[lead].stage, by[cand].stage, by[fifty].stage], ['lead', 'candidate', 'fifty']);
    assert.equal(by[cand].sampleDays, 3, 'days since the samples were delivered');
    assert.equal(by[fifty].totalBought, 450);
  }));
  test('an unpaid order alone does not make someone Fifty', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'approved' });
    assert.equal((await B.book(sql, me)).people[0].stage, 'lead');
  }));
  test('going cold after 30 days with no paid order and no visit', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const cold = await h.contact(sql, me), warm = await h.contact(sql, me), visited = await h.contact(sql, me), edge = await h.contact(sql, me);
    await h.order(sql, cold, me, { status: 'shipped', days: 31 });
    await h.order(sql, warm, me, { status: 'shipped', days: 29 });
    await h.order(sql, visited, me, { status: 'shipped', days: 60 });
    await h.touch(sql, visited, me.id, { kind: 'meeting', days: 3 });
    await h.order(sql, edge, me, { status: 'shipped', days: 30 });
    const by = Object.fromEntries((await B.book(sql, me)).people.map((p) => [p.id, p]));
    assert.equal(by[cold].goingCold, true);
    assert.equal(by[cold].coldDays, 31);
    assert.equal(by[warm].goingCold, false);
    assert.equal(by[visited].goingCold, false);
    assert.equal(by[visited].lastActiveKind, 'visited');
    assert.equal(by[edge].goingCold, false, 'exactly 30 days is not yet cold');
  }));
  test('a call does not stop someone going cold; a video call is not a visit', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'shipped', days: 40 });
    await h.touch(sql, c, me.id, { kind: 'call', days: 1 });
    await h.touch(sql, c, me.id, { kind: 'meeting', mode: 'video', days: 1 });
    assert.equal((await B.book(sql, me)).people[0].goingCold, true);
  }));
  test('a lead is new until anyone calls, texts, emails or visits; notes do not count', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const a = await h.contact(sql, me), b = await h.contact(sql, me);
    await h.touch(sql, a, me.id, { kind: 'note', outcome: null });
    await h.touch(sql, b, me.id, { kind: 'text' });
    const by = Object.fromEntries((await B.book(sql, me)).people.map((p) => [p.id, p]));
    assert.equal(by[a].isNew, true);
    assert.equal(by[b].isNew, false);
    assert.equal(by[b].lastTouchKind, 'text');
  }));
  test('deleted and scheduled interactions do not count', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const i = await h.touch(sql, c, me.id);
    await sql`update interactions set deleted_at = now() where id = ${i}`;
    await h.touch(sql, c, me.id, { status: 'scheduled' });
    assert.equal((await B.book(sql, me)).people[0].isNew, true);
  }));
  test('touched today means I called, texted, emailed or visited them today', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const a = await h.contact(sql, me), b = await h.contact(sql, me), c = await h.contact(sql, me);
    await h.touch(sql, a, me.id, { at: new Date() });
    await h.touch(sql, b, other.id, { at: new Date() });
    await h.touch(sql, c, me.id, { days: 1 });
    const by = Object.fromEntries((await B.book(sql, me)).people.map((p) => [p.id, p]));
    assert.deepEqual([by[a].touchedToday, by[b].touchedToday, by[c].touchedToday], [true, false, false]);
  }));
  test('the follow-up is my earliest open task for them', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    await h.task(sql, c, me.id, { title: 'later', due: h.ago(-5) });
    await h.task(sql, c, me.id, { title: 'soon', due: h.ago(-1) });
    await h.task(sql, c, me.id, { title: 'done', due: h.ago(3), status: 'done' });
    await h.task(sql, c, other.id, { title: 'theirs', due: h.ago(9) });
    assert.equal((await B.book(sql, me)).people[0].followUp.title, 'soon');
  }));
  test('candidates know whether anyone touched them since the samples arrived', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const a = await h.contact(sql, me), b = await h.contact(sql, me), notShipped = await h.contact(sql, me);
    await h.order(sql, a, me, { lines: [['SAL400', 1, true]], delivered: 6 });
    await h.order(sql, b, me, { lines: [['SAL400', 1, true]], delivered: 6 });
    await h.touch(sql, b, me.id, { days: 2 });
    await h.order(sql, notShipped, me, { lines: [['SAL400', 1, true]] });
    const by = Object.fromEntries((await B.book(sql, me)).people.map((p) => [p.id, p]));
    assert.equal(by[a].touchedSinceSamples, false);
    assert.equal(by[b].touchedSinceSamples, true);
    assert.equal(by[notShipped].sampleDays, null);
  }));
  test('one contact can be asked for on its own', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await h.contact(sql, me);
    const c = await h.contact(sql, me, { first: 'Only' });
    const { people } = await B.book(sql, me, { contactId: c });
    assert.deepEqual(people.map((p) => p.first), ['Only']);
  }));
  test('names, clinic, event and addresses are filled in', () => h.withDb(async (sql) => {
    const me = await h.user(sql), cl = await h.clinic(sql, { name: 'Unit Clinic Z' });
    const [ev] = await sql`insert into events (name, kind) values ('Unit webinar', 'webinar') returning id`;
    await h.contact(sql, me, { clinicId: cl.id, designation: 'MD', first: 'Ana', last: 'Lee', eventId: ev.id, source: 'event', phone: '+16475550000' });
    const [p] = (await B.book(sql, me)).people;
    assert.deepEqual([p.name, p.clinic, p.eventName, p.phone, p.shipping.line], ['Dr. Ana Lee', 'Unit Clinic Z', 'Unit webinar', '+16475550000', '2 Test St, Testville']);
  }));
});

describe('dayStats: the day goal and the streak', () => {
  async function day(sql, me, date, n, o = {}) { for (let i = 0; i < n; i++) await h.touch(sql, (o.c), me.id, Object.assign({ at: new Date(+noon(date) + i * 60000) }, o)); }
  test('today counts my calls and in-person visits only', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    const now = new Date();
    await h.touch(sql, c, me.id, { at: now });
    await h.touch(sql, c, me.id, { at: now, kind: 'meeting' });
    await h.touch(sql, c, me.id, { at: now, kind: 'text' });
    await h.touch(sql, c, me.id, { at: now, kind: 'email' });
    await h.touch(sql, c, me.id, { at: now, kind: 'meeting', mode: 'video' });
    await h.touch(sql, c, me.id, { at: now, status: 'cancelled' });
    await h.touch(sql, c, other.id, { at: now });
    const s = await B.dayStats(sql, me, await B.settings(sql));
    assert.equal(s.done, 2);
  }));
  test('the streak counts business days in a row with the goal, skipping weekends and holidays', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const days = lastBusinessDays(4, []);
    const holiday = days[1];
    await sql`update settings set value = ${sql.json([holiday])} where key = 'holidays'`;
    const cfg = Object.assign(await B.settings(sql), { daily_goal: 3 });
    // Goal met on days[0], [2] and [3]; days[1] is a holiday with nothing; the day before days[3] has 1.
    for (const d of [days[0], days[2], days[3]]) await day(sql, me, d, 3, { c });
    const before = lastBusinessDays(5, [holiday])[4];
    await day(sql, me, before, 1, { c });
    assert.equal((await B.dayStats(sql, me, cfg)).streak, 3);
  }));
  test('a day short of the goal breaks the streak', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const days = lastBusinessDays(3, []);
    const cfg = Object.assign(await B.settings(sql), { daily_goal: 2, holidays: [] });
    await day(sql, me, days[0], 2, { c });
    await day(sql, me, days[1], 1, { c });
    await day(sql, me, days[2], 2, { c });
    assert.equal((await B.dayStats(sql, me, cfg)).streak, 1);
  }));
  test('today adds to the streak only once the goal is reached', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const cfg = Object.assign(await B.settings(sql), { daily_goal: 2, holidays: [] });
    const [y] = lastBusinessDays(1, []);
    await day(sql, me, y, 2, { c });
    await h.touch(sql, c, me.id, { at: new Date() });
    assert.deepEqual(await B.dayStats(sql, me, cfg), { done: 1, goal: 2, streak: 1 });
    await h.touch(sql, c, me.id, { at: new Date() });
    assert.deepEqual(await B.dayStats(sql, me, cfg), { done: 2, goal: 2, streak: 2 });
  }));
  test('nothing logged: zero done, no streak', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    assert.deepEqual(await B.dayStats(sql, me, Object.assign({}, B.DEFAULTS, { holidays: [] })), { done: 0, goal: 8, streak: 0 });
  }));
});
