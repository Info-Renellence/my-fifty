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
  test('every order status makes Fifty (ordered, paid or not); rejected/cancelled/deleted are ignored', () => h.withDb(async (sql) => {
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
    assert.deepEqual(fifty, ['submitted', 'approved', 'awaiting_md', 'invoiced', 'paid', 'sent_to_warehouse', 'shipped', 'delivered']);
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
  test('samples plus an order (even one paid only by a test payment) is Fifty: ordering is what counts', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { lines: [['SAL400', 1, true]], delivered: 4 });
    await h.order(sql, c, me, { status: 'approved', paid: true, testPayment: true });
    const p = (await byId(sql, me))[c];
    assert.deepEqual([p.stage, p.totalBought], ['fifty', 0], 'a test payment never counts as paid');
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
  test('a wire order earns nothing until its money is marked received, then counts on that day', () => h.withDb(async (sql) => {
    const back = around(T.addDays(T.ymd(), -5), T.addDays(T.ymd(), 5));
    try {
      const me = await h.user(sql), c = await h.contact(sql, me);
      const first = await h.order(sql, c, me, { status: 'shipped', method: 'wire', days: 20, lines: [['SAF100', 4]] });
      const second = await h.order(sql, c, me, { status: 'shipped', method: 'wire', days: 10, lines: [['SAF100', 4]] });
      assert.deepEqual([(await R.rewards(sql, me)).booster.onNew, (await R.rewards(sql, me)).booster.onReorders], ['$0', '$0'], 'unpaid wire orders earn nothing');
      const pay = (id, day) => sql`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test) values (${id}, 'charge', 'wire', 900, 'CAD', 'succeeded', 'wire', ${T.atLocal(day, 12, 0)}, false)`;
      await pay(first, T.addDays(T.ymd(), -8)); await pay(second, T.addDays(T.ymd(), -1));
      const r = await R.rewards(sql, me);
      assert.equal(r.booster.onNew, '$0', 'the first order\'s money arrived before the period');
      assert.equal(r.booster.onReorders, '$36', '4% of 900, counted on the day it was marked received');
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
      await sql`update users set is_active = false where kind = 'rep'`;
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
    me.preferences = { snoozed: { [hidden]: T.addDays(T.ymd(), 1) } };
    const cfg = await B.settings(sql);
    const list = B.todayList((await B.book(sql, me, { cfg })).people, me, cfg);
    assert.deepEqual(list.map((x) => [x.id, x.why]), [[lead, 'lead'], [fu, 'follow_up'], [cold, 'follow_up'], [cold2, 'going_cold'], [cand, 'candidate']]);
    assert.ok(!list.some((x) => x.id === oldLead));
  }));
});

describe('orders and money through the app (act.order)', () => {
  const ready2 = async (sql, me) => { const c = await h.contact(sql, me); await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`; return c; };
  test('quantities: 0, negative and junk lines are dropped; decimals round; unknown or inactive products are refused', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready2(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 2.6 }, { sku: 'SAL400', qty: 0 }, { sku: 'SAV200', qty: -3 }, { sku: 'SAF100', qty: 'x' }, null, 'junk'].filter(Boolean).map((l) => (typeof l === 'string' ? {} : l)) });
    const lines = await sql`select product_sku as sku, quantity from order_lines where order_id = ${r.orderId}`;
    assert.deepEqual([...lines], [{ sku: 'SAF100', quantity: 3 }]);
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'NOPE', qty: 1 }] }), (e) => e.message === 'unknown_product');
    const [p] = await sql`select sku from products where not is_active limit 1`;
    if (p) await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: p.sku, qty: 1 }] }), (e) => e.message === 'unknown_product');
  }));
  test('only free products make a sample order (MD needed); samples make every line free whatever the price', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready2(sql, me);
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'HDB100', qty: 1 }] }), (e) => e.message === 'md_required');
    const r = await A.order(me, { contactId: c, kind: 'samples', lines: [{ sku: 'SAF100', qty: 2 }], mdName: 'Dr. Testa Medic', mdEmail: 'testa.medic@demo.invalid' });
    const [x] = await sql`select bool_and(is_free) f, sum(unit_price)::float8 p from order_lines where order_id = ${r.orderId}`;
    assert.deepEqual([x.f, x.p], [true, 0]);
    const [md] = await sql`select first_name, last_name, designation, is_medical_director, owner_id from contacts where email = 'testa.medic@demo.invalid'`;
    assert.deepEqual([md.first_name, md.last_name, md.designation, md.is_medical_director], ['Testa', 'Medic', 'md', true]);
  }));
  test('not ready: no onboarding and only rejected or cancelled orders', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'rejected' });
    await h.order(sql, c, me, { status: 'cancelled' });
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] }), (e) => e.message === 'not_ready_to_order');
    assert.deepEqual((await D.ready(sql, me)).people, []);
  }));
  test('n8n replies: refused (500), timeout-like failure and success are reported as they are, the order is kept', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready2(sql, me);
    process.env.N8N_MYFIFTY_URL = 'http://localhost:9/n8n-fake';
    f = h.fakeFetch(() => ({ status: 500, text: 'Workflow could not be started' }));
    const r1 = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.deepEqual([r1.ok, r1.sentToN8n, r1.reason], [true, false, 'n8n_500']);
    f.restore();
    f = h.fakeFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    const r2 = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r2.reason, 'n8n_timeout');
    f.restore();
    f = h.fakeFetch(() => ({ status: 200, text: '<<not json>>' }));
    const r3 = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r3.sentToN8n, true);
    const body = JSON.parse(f.calls[0].body);
    assert.deepEqual(Object.keys(body).sort(), ['action', 'orderId']);
    assert.equal((await sql`select count(*)::int n from orders where contact_id = ${c}`)[0].n, 3);
  }));
});

describe('writes: log, undo, snooze, add a person, follow-ups (edge cases)', () => {
  test('log: a past date is refused; today is fine; text does not count towards the goal', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await assert.rejects(A.log(me, { contactId: c, kind: 'call', note: 'Hello there', followUp: T.addDays(T.ymd(), -1) }), (e) => e.message === 'pick_a_follow_up');
    const r = await A.log(me, { contactId: c, kind: 'text', note: 'Texted about lips', followUp: T.ymd() });
    assert.equal(r.counted, false);
    assert.equal(r.day.done, 0);
  }));
  test('log: a note that is only a "Next:" line becomes the follow-up title', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.log(me, { contactId: c, kind: 'visit', reached: true, note: 'Next: bring the volume samples', followUp: 'eod' });
    const [t] = await sql`select title, kind::text from tasks where id = ${r.taskId}`;
    assert.deepEqual([t.title, t.kind], ['bring the volume samples', 'visit']);
  }));
  test('undo twice: the second is refused and nothing else changes; an old log cannot be undone', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, note: 'Talked', followUp: 'tomorrow' });
    await A.undo(me, { interactionId: r.interactionId, closedTaskIds: r.closedTaskIds });
    await assert.rejects(A.undo(me, { interactionId: r.interactionId }), (e) => e.status === 404);
    const old = await h.touch(sql, c, me.id, { days: 2 });
    await assert.rejects(A.undo(me, { interactionId: old }), (e) => e.status === 404);
  }));
  test('snooze keeps other people snoozed and drops old snoozes', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { preferences: { snoozed: { old: '2020-01-01', keep: '2099-01-01' } } }), c = await h.contact(sql, me);
    await A.snooze(me, { contactId: c });
    const [u] = await sql`select preferences from users where id = ${me.id}`;
    assert.deepEqual(Object.keys(u.preferences.snoozed).sort(), [c, 'keep'].sort());
  }));
  test('add a person: phone formats, blank names, odd characters, very long text', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const r1 = await A.add_person(me, { firstName: '  Zoë  ', lastName: "O'Brien-Ñúñez 😀", phone: '(416) 555-0199', email: 'ZOE.Testrun@Demo.Invalid', clinic: 'Testrun Odd Clinic ' + 'x'.repeat(300) });
    const [c1] = await sql`select first_name, last_name, mobile_phone, email::text, length(cl.name) n from contacts c join clinics cl on cl.id = c.clinic_id where c.id = ${r1.id}`;
    assert.deepEqual([c1.first_name, c1.last_name, c1.mobile_phone, c1.email, c1.n], ['Zoë', "O'Brien-Ñúñez 😀", '+14165550199', 'zoe.testrun@demo.invalid', 160]);
    await assert.rejects(A.add_person(me, { firstName: '   ', lastName: '' }), (e) => e.message === 'name_required');
    await assert.rejects(A.add_person(me, { firstName: 'A', phone: '123' }), (e) => e.message === 'bad_phone');
    await assert.rejects(A.add_person(me, { firstName: 'A', email: 'not-an-email' }), (e) => e.message === 'bad_email');
    const r2 = await A.add_person(me, { firstName: 'Intl', phone: '+44 20 7946 0958' });
    assert.equal((await sql`select mobile_phone from contacts where id = ${r2.id}`)[0].mobile_phone, '+442079460958');
  }));
  test('add a person who is already in another rep\'s book: warned (email) or refused (phone), without telling who or which record', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    await h.contact(sql, other, { email: 'taken.testrun@demo.invalid', phone: '+14165550111' });
    await assert.rejects(A.add_person(me, { firstName: 'X', email: 'Taken.Testrun@demo.invalid' }), (e) => e.status === 409 && e.message === 'email_someones' && e.detail === undefined);
    await assert.rejects(A.add_person(me, { firstName: 'X', phone: '416 555 0111' }), (e) => e.status === 409 && e.message === 'already_someones' && e.detail === undefined);
  }));
  test('two reps adding the same new clinic name share one clinic', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const a = await A.add_person(me, { firstName: 'One', clinic: 'Testrun Shared Clinic' });
    const b = await A.add_person(other, { firstName: 'Two', clinic: 'testrun shared clinic' });
    const rows = await sql`select clinic_id from contacts where id in (${a.id}, ${b.id})`;
    assert.equal(new Set(rows.map((r) => r.clinic_id)).size, 1);
  }));
});

describe('the timer, called directly, with every outside service faked or failing', () => {
  const cron = require('../../api/cron');
  const call = async (key) => { const res = h.fakeRes(); await cron({ method: 'GET', url: '/api/cron?op=tick', headers: key === undefined ? {} : { 'x-cron-key': key } }, res); return res; };
  test('no key, a wrong key of the same length, a longer key: refused', async () => {
    for (const k of [undefined, '', 'x'.repeat(process.env.CRON_SECRET.length), process.env.CRON_SECRET + 'x']) assert.equal((await call(k)).statusCode, 401);
  });
  test('a full tick with junk Gmail answers and an unreachable push service still answers, and logs what failed', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const c = await h.contact(sql, me, { source: 'social', createdAt: h.ago(0, 1) });
    await sql`insert into connections (user_id, provider, external_account, credentials_encrypted, status) values (${me.id}, 'gmail', ${me.email}, ${require('../../api/_crypto').seal('fake-refresh')}, 'connected')`;
    await require('../../api/_push').subscribe(sql, me, { endpoint: 'https://push.demo.invalid/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } });
    f = h.fakeFetch((url) => (/oauth2/.test(url) ? { json: { access_token: 'at' } } : { status: 200, text: '<html>not json</html>' }));
    const res = await call(process.env.CRON_SECRET);
    assert.equal(res.statusCode, 200);
    const out = res.json();
    assert.ok(out.leads.found >= 1);
    assert.ok(out.gmail.errors >= 1, 'the junk Gmail answer is counted as an error, not a crash');
    const [n] = await sql`select status::text, error_message from notifications where dedupe_key = ${'new_lead:' + c}`;
    assert.equal(n.status, 'failed', 'the push that could not be delivered is logged as failed');
  }));
});
