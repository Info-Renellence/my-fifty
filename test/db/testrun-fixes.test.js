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
describe('R18 rewards: the day an order was paid ignores test payments', () => {
  function around(from, to) { const keep = JSON.parse(JSON.stringify(R.PROGRAMS)); for (const k of ['booster', 'trip']) { R.PROGRAMS[k].from = from; R.PROGRAMS[k].to = to; } return () => { for (const k of ['booster', 'trip']) Object.assign(R.PROGRAMS[k], keep[k]); }; }
  test('an order counts on the day it was really paid, not the day of an earlier test payment', () => h.withDb(async (sql) => {
    const back = around(T.addDays(T.ymd(), -5), T.addDays(T.ymd(), 5));
    try {
      const me = await h.user(sql), c = await h.contact(sql, me);
      const o = await h.order(sql, c, me, { status: 'approved', days: 20, lines: [['SAF100', 2]] });
      await sql`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test) values (${o}, 'charge', 'card_on_file', 1, 'CAD', 'succeeded', 'stripe', ${h.ago(20)}, true)`;
      await sql`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test) values (${o}, 'charge', 'card_on_file', 450, 'CAD', 'succeeded', 'stripe', ${h.ago(1)}, false)`;
      const r = await R.rewards(sql, me);
      assert.equal(r.booster.onNew, '$9', 'paid yesterday (in the period): 2% of 450');
    } finally { back(); }
  }));
});

describe('orders: a line over the 999 limit', () => {
  test('a line over 999 is not dropped without a word', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    let err = null, r = null;
    try { r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 2 }, { sku: 'MN2550', qty: 1000 }] }); } catch (e) { err = e; }
    const n = r ? (await sql`select count(*)::int n from order_lines where order_id = ${r.orderId}`)[0].n : 0;
    assert.ok(err || n === 2, 'either refused, or both lines kept (got ' + n + ' line(s))');
  }));
});

describe('follow-up dates that do not exist', () => {
  test('a follow-up date that does not exist is refused, not a server error', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    for (const d of ['2026-13-45', '2026-02-30', '9999-99-99']) {
      await assert.rejects(A.set_follow_up(me, { contactId: c, date: d }), (e) => e.status === 400, d);
      await assert.rejects(A.log(me, { contactId: c, kind: 'call', note: 'Hello', followUp: d }), (e) => e.status === 400, d);
    }
  }));
});

describe('voice notes (Gemini stubbed)', () => {
  const fakeGemini = (out, seen) => ({ available: () => true, json: async (prompt, o) => { if (seen) seen.push({ prompt, o }); return out; } });
  test('the prompt never carries people from another rep\'s book at the same clinic', () => h.withDb(async (sql) => {
    const V = require('../../api/_voice');
    const me = await h.user(sql), other = await h.user(sql), cl = await h.clinic(sql);
    const c = await h.contact(sql, me, { clinicId: cl.id, first: 'Mine', last: 'Testperson' });
    await h.contact(sql, me, { clinicId: cl.id, first: 'Colleague', last: 'Ofmine' });
    await h.contact(sql, other, { clinicId: cl.id, first: 'Secret', last: 'Otherrepclient' });
    const seen = [];
    await V.transcribe(sql, me, { contactId: c, audio: 'AAAA', mime: 'audio/webm;codecs=opus' }, { gemini: fakeGemini({ note: 'ok', nextStep: '', followUpDate: '', transcript: 'ok' }, seen) });
    assert.match(seen[0].prompt, /Colleague Ofmine/);
    assert.doesNotMatch(seen[0].prompt, /Otherrepclient/);
  }));
  test('the draft writes saypha and its product names in lower case', () => h.withDb(async (sql) => {
    const V = require('../../api/_voice');
    const me = await h.user(sql), c = await h.contact(sql, me);
    const out = { note: 'She loved Saypha Lips and wants SAYPHA Volume Plus. Lidocaine is fine.', nextStep: 'Bring Saypha® Filler', followUpDate: '2020-01-01', transcript: 'saypha lips, Saypha volume' };
    const d = await V.transcribe(sql, me, { contactId: c, audio: 'AAAA', mime: 'audio/mp4' }, { gemini: fakeGemini(out) });
    assert.equal(d.note, 'She loved saypha lips and wants saypha volume plus. Lidocaine is fine.');
    assert.equal(d.nextStep, 'Bring saypha® filler');
    assert.equal(d.transcript, 'saypha lips, saypha volume');
    assert.equal(d.followUpDate, '', 'a date in the past is dropped');
  }));
});

describe('Tomorrow on two people at once (two phones, or two quick taps)', () => {
  test('both stay hidden: the second save does not wipe the first', () => h.withDb(async (sql) => {
    const me = await h.user(sql), a = await h.contact(sql, me), b = await h.contact(sql, me);
    const stale = Object.assign({}, me, { settings: {} });     // both requests signed in before either saved
    await A.snooze(stale, { contactId: a });
    await A.snooze(stale, { contactId: b });
    const [u] = await sql`select settings from users where id = ${me.id}`;
    assert.deepEqual(Object.keys(u.settings.snoozed).sort(), [a, b].sort());
  }));
});

describe('Rewards: saypha syringes this month', () => {
  test('headbands, ice packs, fact sheets and other no-charge saypha items are not syringes', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const o = await h.order(sql, c, me, { status: 'shipped', lines: [['SAF100', 2]] });
    for (const [sku, q] of [['HDB100', 3], ['SAYPHA-PAMPHLET', 1], ['ICE102', 2], ['LIP100', 1]]) {
      await sql`insert into order_lines (order_id, product_id, sku, name, quantity, unit_price, list_price, is_free)
        select ${o}, id, sku, name, ${q}, 0, list_price, false from products where sku = ${sku}`;
    }
    const r = await R.rewards(sql, me);
    assert.equal(r.syringes, 2);
  }));
});

describe('Edit on History', () => {
  test('a sent or pulled email cannot be rewritten (History offers Edit only on calls, visits, texts and notes)', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const e = await h.touch(sql, c, me.id, { kind: 'email', subject: 'Prices', body: 'Here are the prices.', outcome: null });
    await assert.rejects(A.edit_note(me, { interactionId: e, body: 'Something I never sent' }), (x) => x.status === 404);
    assert.equal((await sql`select body from interactions where id = ${e}`)[0].body, 'Here are the prices.');
  }));
});

describe('Add a person whose email is already taken in the database', () => {
  test('an email kept by a removed (soft-deleted) person is a clear "already" answer, not a server error', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const gone = await h.contact(sql, other, { email: 'gone.testrun@demo.invalid' });
    await sql`update contacts set deleted_at = now() where id = ${gone}`;
    await assert.rejects(A.add_person(me, { firstName: 'Again', email: 'gone.testrun@demo.invalid' }), (e) => e.status === 409);
  }));
});

describe('Samples: the MD\'s email belongs to a removed person', () => {
  test('the order goes through, linked to that person, instead of a server error', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    const gone = await h.contact(sql, null, { owner: null, email: 'gone.md.testrun@demo.invalid' });
    await sql`update contacts set deleted_at = now() where id = ${gone}`;
    const r = await A.order(me, { contactId: c, kind: 'samples', lines: [{ sku: 'SAL400', qty: 1 }], mdName: 'Dr. Gone Testmd', mdEmail: 'gone.md.testrun@demo.invalid' });
    assert.equal((await sql`select md_contact_id from orders where id = ${r.orderId}`)[0].md_contact_id, gone);
  }));
});

describe('New-lead pushes to a switched-off rep', () => {
  test('a rep who has been switched off gets no new-lead push on their phone', () => h.withDb(async (sql) => {
    const cron = require('../../api/cron')._;
    const off = await h.user(sql, { active: false });
    const before = (await cron.newLeads(sql)).found;
    await h.contact(sql, off, { source: 'social', createdAt: h.ago(0, 1) });
    assert.equal((await cron.newLeads(sql)).found, before);
  }));
});

describe('L9 Ready to order and the injector on an onboarding', () => {
  test('the injector on a signed onboarding is on the list, as the order screen already lets them order', () => h.withDb(async (sql) => {
    const D = require('../../api/data').OPS;
    const me = await h.user(sql), owner = await h.contact(sql, me, { first: 'Owner' }), inj = await h.contact(sql, me, { first: 'Injector' });
    await sql`insert into onboardings (primary_contact_id, injector_contact_id, status, submitted_at) values (${owner}, ${inj}, 'signed', now())`;
    const ids = (await D.ready(sql, me)).people.map((p) => p.id).sort();
    assert.deepEqual(ids, [owner, inj].sort());
    await A.order(me, { contactId: inj, lines: [{ sku: 'SAF100', qty: 1 }] });
  }));
});

describe('Candidates with a second sample order on the way', () => {
  test('days since samples count from the samples that arrived; a newer, unshipped sample order does not hide them', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { lines: [['SAL400', 1, true]], days: 12, delivered: 9 });
    await h.order(sql, c, me, { lines: [['SAV200', 1, true]], days: 1 });
    const p = (await byId(sql, me))[c];
    assert.equal(p.stage, 'candidate');
    assert.equal(p.sampleDays, 9);
    const cfg = await B.settings(sql);
    const list = B.todayList((await B.book(sql, me, { cfg })).people, me, cfg);
    assert.deepEqual(list.map((x) => [x.id, x.why]), [[c, 'candidate']]);
  }));
});
