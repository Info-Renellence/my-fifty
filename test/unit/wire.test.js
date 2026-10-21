// api/_wire.js: due dates, follow-up days and the signed "Mark as received" links (no database).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
require('../helpers');
const W = require('../../api/_wire');
const T = require('../../api/_time');

const placed = T.atLocal('2026-10-01', 10, 0);
const at = (day) => T.atLocal(day, 12, 0);
const order = (o) => Object.assign({ payment_method: 'wire', submitted_at: placed, invoiced_at: null, created_at: placed, payment_terms_days: 30 }, o);

describe('wire state', () => {
  test('not a wire order: nothing', () => assert.equal(W.state(order({ payment_method: 'card_on_file' }), null, 30, at('2026-10-05')), null));
  test('due date = order date + the order\'s terms', () => {
    const s = W.state(order(), null, 30, at('2026-10-05'));
    assert.deepEqual([s.status, s.due, s.daysToDue, s.text], ['open', '2026-10-31', 26, 'Wire · net 30, due Oct 31']);
  });
  test('counted from the invoice date once invoiced', () => assert.equal(W.state(order({ invoiced_at: T.atLocal('2026-10-04', 9, 0) }), null, 30).due, '2026-11-03'));
  test('the order\'s own terms win; orders placed before terms existed use the standard', () => {
    assert.equal(W.state(order({ payment_terms_days: 45 }), null, 30).due, '2026-11-15');
    assert.equal(W.state(order({ payment_terms_days: null }), null, 60).due, '2026-11-30');
  });
  test('due today is still open; the day after is 1 day overdue', () => {
    assert.equal(W.state(order(), null, 30, at('2026-10-31')).status, 'open');
    const s = W.state(order(), null, 30, at('2026-11-01'));
    assert.deepEqual([s.status, s.daysLate, s.text], ['overdue', 1, 'Wire · 1 day overdue']);
    assert.equal(W.state(order(), null, 30, at('2026-11-03')).text, 'Wire · 3 days overdue');
  });
  test('received: shows the day the money arrived, never overdue', () => {
    const s = W.state(order(), { status: 'succeeded', paid_at: T.atLocal('2026-11-10', 12, 0) }, 30, at('2026-12-01'));
    assert.deepEqual([s.status, s.text], ['received', 'Wire · received Nov 10']);
  });
});

describe('wire follow-up days', () => {
  const on = (day) => W.followUp(W.state(order(), null, 30, at(day)));
  test('heads-up exactly 5 days before the due date', () => {
    assert.equal(on('2026-10-26'), 'heads_up');
    assert.equal(on('2026-10-25'), null);
    assert.equal(on('2026-10-27'), null);
  });
  test('overdue on day 1, then every 7 days', () => {
    assert.deepEqual(['2026-11-01', '2026-11-02', '2026-11-07', '2026-11-08', '2026-11-15'].map(on), ['overdue', null, null, 'overdue', 'overdue']);
  });
  test('nothing once received', () => assert.equal(W.followUp(W.state(order(), { status: 'succeeded', paid_at: placed }, 30, at('2026-11-01'))), null));
});

describe('Mark as received links', () => {
  const o = '11111111-1111-4111-8111-111111111111', u = '22222222-2222-4222-8222-222222222222';
  const params = (url) => Object.fromEntries(new URL(url).searchParams);
  test('a link checks out for 30 days, for that order and admin only', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    const url = W.link('https://my-fifty.vercel.app/', o, u, now);
    assert.match(url, /^https:\/\/my-fifty\.vercel\.app\/api\/wire\?o=/);
    const q = params(url);
    assert.equal(W.verify(q, now), true);
    assert.equal(W.verify(q, now + 29 * 86400000), true);
    assert.equal(W.verify(q, now + 31 * 86400000), false, 'expired');
    assert.equal(W.verify(Object.assign({}, q, { o: u }), now), false, 'another order');
    assert.equal(W.verify(Object.assign({}, q, { u: o }), now), false, 'another person');
    assert.equal(W.verify(Object.assign({}, q, { e: String(Number(q.e) + 86400) }), now), false, 'a longer life');
    assert.equal(W.verify(Object.assign({}, q, { s: 'x' }), now), false);
    assert.equal(W.verify({}, now), false);
  });
});
