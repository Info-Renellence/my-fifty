// api/_time.js: Toronto dates, business days and day counts.
const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../api/_time');

afterEach(() => mock.timers.reset());
const freeze = (iso) => mock.timers.enable({ apis: ['Date'], now: new Date(iso) });

describe('ymd', () => {
  test('gives the Toronto calendar date, not the UTC one, late in the evening', () => {
    assert.equal(T.ymd(new Date('2026-10-21T03:30:00Z')), '2026-10-20');
  });
  test('uses the current time when no date is given', () => {
    freeze('2026-10-20T15:00:00Z');
    assert.equal(T.ymd(), '2026-10-20');
  });
  test('accepts a timestamp number', () => {
    assert.equal(T.ymd(Date.parse('2026-01-01T12:00:00Z')), '2026-01-01');
  });
});

describe('offsetMin', () => {
  test('is -240 minutes in summer (EDT)', () => assert.equal(T.offsetMin(Date.parse('2026-07-01T12:00:00Z')), -240));
  test('is -300 minutes in winter (EST)', () => assert.equal(T.offsetMin(Date.parse('2026-12-01T12:00:00Z')), -300));
});

describe('atLocal', () => {
  test('5 PM on a summer day is 21:00 UTC', () => assert.equal(T.atLocal('2026-10-20', 17, 0).toISOString(), '2026-10-20T21:00:00.000Z'));
  test('9 AM on a winter day is 14:00 UTC', () => assert.equal(T.atLocal('2026-12-01', 9, 0).toISOString(), '2026-12-01T14:00:00.000Z'));
  test('9 AM on the day clocks go back (Nov 1 2026) is already EST', () => assert.equal(T.atLocal('2026-11-01', 9, 0).toISOString(), '2026-11-01T14:00:00.000Z'));
  test('9 AM on the day clocks go forward (Mar 8 2026) is already EDT', () => assert.equal(T.atLocal('2026-03-08', 9, 0).toISOString(), '2026-03-08T13:00:00.000Z'));
  test('hours and minutes default to midnight', () => assert.equal(T.atLocal('2026-10-20').toISOString(), '2026-10-20T04:00:00.000Z'));
  test('keeps the minutes', () => assert.equal(T.atLocal('2026-10-20', 7, 30).toISOString(), '2026-10-20T11:30:00.000Z'));
});

describe('addDays', () => {
  test('crosses a month end', () => assert.equal(T.addDays('2026-10-31', 1), '2026-11-01'));
  test('crosses a year end', () => assert.equal(T.addDays('2026-12-31', 1), '2027-01-01'));
  test('goes backwards', () => assert.equal(T.addDays('2026-03-01', -1), '2026-02-28'));
  test('is not thrown off by the clock change', () => assert.equal(T.addDays('2026-11-01', 1), '2026-11-02'));
});

describe('weekday and isBusinessDay', () => {
  test('knows the day of the week', () => {
    assert.equal(T.weekday('2026-10-20'), 2);   // Tuesday
    assert.equal(T.weekday('2026-10-25'), 0);   // Sunday
  });
  test('weekdays are business days', () => assert.equal(T.isBusinessDay('2026-10-20', []), true));
  test('Saturday and Sunday are not', () => {
    assert.equal(T.isBusinessDay('2026-10-24', []), false);
    assert.equal(T.isBusinessDay('2026-10-25', []), false);
  });
  test('a holiday on the list is not', () => assert.equal(T.isBusinessDay('2026-10-12', ['2026-10-12']), false));
  test('works with no holiday list', () => assert.equal(T.isBusinessDay('2026-10-12'), true));
});

describe('daysBetween', () => {
  test('counts calendar days in Toronto', () => {
    freeze('2026-10-20T15:00:00Z');
    assert.equal(T.daysBetween(new Date('2026-10-17T15:00:00Z')), 3);
  });
  test('a late-evening time still counts as its Toronto day', () => {
    assert.equal(T.daysBetween(new Date('2026-10-20T02:00:00Z'), new Date('2026-10-20T15:00:00Z')), 1);
  });
  test('is 0 for the same day', () => assert.equal(T.daysBetween(new Date('2026-10-20T13:00:00Z'), new Date('2026-10-20T20:00:00Z')), 0));
  test('is whole days across the clock change', () => assert.equal(T.daysBetween(new Date('2026-10-30T16:00:00Z'), new Date('2026-11-03T17:00:00Z')), 4));
});

describe('short', () => {
  test('writes "Oct 20"', () => assert.equal(T.short(new Date('2026-10-20T15:00:00Z')), 'Oct 20'));
  test('uses the Toronto date', () => assert.equal(T.short(new Date('2026-11-01T02:00:00Z')), 'Oct 31'));
  test('writes January without a leading zero', () => assert.equal(T.short(new Date('2027-01-05T15:00:00Z')), 'Jan 5'));
});
