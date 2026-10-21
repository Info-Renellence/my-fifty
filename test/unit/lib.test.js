// lib.js: the page's pure helpers.
const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../lib.js');

afterEach(() => mock.timers.reset());

describe('escaping', () => {
  test('esc escapes the five HTML characters', () => assert.equal(L.esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));
  test('esc turns null and undefined into nothing', () => { assert.equal(L.esc(null), ''); assert.equal(L.esc(undefined), ''); });
  test('esc keeps numbers', () => assert.equal(L.esc(0), '0'));
  test('nb escapes and keeps words together', () => assert.equal(L.nb('Sample <Clinic> B'), 'Sample&nbsp;&lt;Clinic&gt;&nbsp;B'));
});

describe('dates', () => {
  test('ymd is the Toronto date', () => assert.equal(L.ymd(new Date('2026-10-21T02:00:00Z')), '2026-10-20'));
  test('ymd defaults to now', () => { mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T15:00:00Z') }); assert.equal(L.ymd(), '2026-10-20'); });
  test('addDays crosses months', () => assert.equal(L.addDays('2026-10-31', 1), '2026-11-01'));
  test('shortDate', () => { assert.equal(L.shortDate('2026-10-21'), 'Oct 21'); assert.equal(L.shortDate('2027-01-05'), 'Jan 5'); });
  test('longDate is the L2 heading', () => assert.equal(L.longDate('2026-10-20'), 'TUESDAY, OCTOBER 20'));
});

describe('errText', () => {
  test('gives the plain-words message for a known error', () => assert.equal(L.errText(new Error('note_required')), 'Say or type what happened first.'));
  test('gives a general message for anything else', () => {
    assert.equal(L.errText(new Error('weird')), 'Something went wrong. Try again.');
    assert.equal(L.errText(null), 'Something went wrong. Try again.');
  });
  test('every message is plain text without CRM words', () => {
    for (const m of Object.values(L.ERR)) assert.doesNotMatch(m, /contact record|deal|pipeline|owner_id/i);
  });
});

describe('initials and money', () => {
  test('initials skip "Dr."', () => assert.equal(L.initials('Dr. Maya Sample'), 'MS'));
  test('initials of one word', () => assert.equal(L.initials('cher'), 'C'));
  test('initials of nothing', () => assert.equal(L.initials(''), ''));
  test('initials use the first two words', () => assert.equal(L.initials('Ana Maria Lopez'), 'AM'));
  test('money rounds to whole dollars with commas', () => { assert.equal(L.money(2530.4), '$2,530'); assert.equal(L.money(0), '$0'); assert.equal(L.money('x'), '$0'); });
});

describe('Today pieces', () => {
  test('ringDash is empty when nothing is done', () => assert.equal(L.ringDash(38, 0, 8), ''));
  test('ringDash fills by the share done', () => {
    const c = 2 * Math.PI * 38;
    assert.equal(L.ringDash(38, 4, 8), (c / 2).toFixed(1) + ' ' + c.toFixed(1));
  });
  test('ringDash never goes past full', () => { const c = (2 * Math.PI * 70).toFixed(1); assert.equal(L.ringDash(70, 12, 8), c + ' ' + c); });
  test('ringDash with no goal does not divide by zero', () => assert.match(L.ringDash(38, 3, 0), /^0\.0 /));
  test('fiftyTile: 22 of the way to 25 fills 7 dots', () => assert.deepEqual(L.fiftyTile(22, 25), { toNext: 3, filled: 7 }));
  test('fiftyTile at 0 shows 5 more to 5 and no filled dot (F11)', () => assert.deepEqual(L.fiftyTile(0, 5), { toNext: 5, filled: 0 }));
  test('fiftyTile below 10 people fills one dot per person (F11)', () => {
    assert.deepEqual([1, 3, 4, 5, 9].map((n) => L.fiftyTile(n, Math.floor(n / 5) * 5 + 5).filled), [1, 3, 4, 5, 9]);
    assert.deepEqual(L.fiftyTile(10, 15), { toNext: 5, filled: 5 }, 'from 10 on: the last 10 dots towards the milestone');
  });
  test('dayLeftText counts down and finishes', () => {
    assert.equal(L.dayLeftText(3, 8), '5 more and today is done');
    assert.equal(L.dayLeftText(8, 8), 'Today is done');
    assert.equal(L.dayLeftText(10, 8), 'Today is done');
  });
  test('winLine reads like L4', () => {
    assert.equal(L.winLine('Nadia Sample', 'Oct 21', 4, 7), 'Logged for Nadia Sample. Follow-up saved for Oct 21. 3 more finish today.');
    assert.equal(L.winLine('A', 'Oct 21', 7, 8), 'Logged for A. Follow-up saved for Oct 21. 1 more finishes today.');
    assert.equal(L.winLine('A', 'Oct 21', 8, 8), 'Logged for A. Follow-up saved for Oct 21. Today is done.');
  });
  test('candidatePill shows days since the samples arrived', () => {
    assert.equal(L.candidatePill(7), '7 days');
    assert.equal(L.candidatePill(1), '1 day');
    assert.equal(L.candidatePill(0), '0 days');
    assert.equal(L.candidatePill(null), 'Not shipped');
  });
});

describe('ordering pieces', () => {
  const products = [
    { sku: 'SAF100', price: 225, alwaysFree: false, last: 10, unit: '' },
    { sku: 'MN2550', price: 185, alwaysFree: false, last: 1, unit: 'box' },
    { sku: 'MN1490', price: 185, alwaysFree: false, last: 2, unit: 'box' },
    { sku: 'HDB100', price: 0, alwaysFree: true, last: null, unit: '' },
  ];
  test('productSub for an order shows last order and price', () => {
    assert.equal(L.productSub(products[0], 'order'), 'Last order: 10 · $225');
    assert.equal(L.productSub(products[1], 'order'), 'Last order: 1 box · $185');
    assert.equal(L.productSub(products[2], 'order'), 'Last order: 2 boxes · $185');
  });
  test('productSub marks free items and new products', () => assert.equal(L.productSub(products[3], 'order'), 'New for them · Free'));
  test('productSub for samples shows no price', () => assert.equal(L.productSub(products[0], 'samples'), 'Last order: 10'));
  test('visibleProducts hides free-only items from an order unless added', () => {
    assert.deepEqual(L.visibleProducts(products, {}, 'order').map((p) => p.sku), ['SAF100', 'MN2550', 'MN1490']);
    assert.equal(L.visibleProducts(products, { HDB100: 1 }, 'order').length, 4);
    assert.equal(L.visibleProducts(products, {}, 'samples').length, 4);
  });
  test('draftTotals counts items and paid money only', () => {
    assert.deepEqual(L.draftTotals(products, { SAF100: 2, MN2550: 1, HDB100: 3 }, 'order'), { count: 6, total: 635 });
    assert.deepEqual(L.draftTotals(products, { SAF100: 2 }, 'samples'), { count: 2, total: 0 });
    assert.deepEqual(L.draftTotals(products, {}, 'order'), { count: 0, total: 0 });
  });
  test('sameAsLast adds up the last order, joining repeated products', () => assert.deepEqual(L.sameAsLast([{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }, { sku: 'A', qty: 3 }]), { A: 5, B: 1 }));
  test('billingSame when there is no billing address or it matches', () => {
    assert.equal(L.billingSame({ billing: { street: '' }, shipping: { street: '1 A', city: 'X' } }), true);
    assert.equal(L.billingSame({ billing: { street: '1 A', city: 'X' }, shipping: { street: '1 A', city: 'X' } }), true);
    assert.equal(L.billingSame({ billing: { street: '9 B', city: 'X' }, shipping: { street: '1 A', city: 'X' } }), false);
  });
});

describe('stripNext and b64ToBytes', () => {
  test('stripNext removes the Next: line and everything after', () => assert.equal(L.stripNext('Wants to order.\nNext: call Monday'), 'Wants to order.'));
  test('stripNext keeps notes without one', () => assert.equal(L.stripNext('Just a note'), 'Just a note'));
  test('stripNext handles "Next step:" and case', () => assert.equal(L.stripNext('A\nNEXT STEP: b'), 'A'));
  test('stripNext of nothing', () => assert.equal(L.stripNext(null), ''));
  test('b64ToBytes decodes base64url without padding', () => assert.deepEqual([...L.b64ToBytes('AQID_-8')], [1, 2, 3, 255, 239]));
});
