// Test run 2026-10-21: follow-up times and "today" around Toronto midnight and the November clock change (clock frozen).
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../api/_time');
const { followUpAt } = require('../../api/act')._;

const realNow = Date.now;
afterEach(() => { Date.now = realNow; });
const at = (iso) => { Date.now = () => Date.parse(iso); };

test('one minute before Toronto midnight is still the old day', () => {
  at('2026-10-31T03:59:00Z');                 // Oct 30, 11:59 PM in Toronto
  assert.equal(T.ymd(), '2026-10-30');
  assert.equal(followUpAt('eod').toISOString(), '2026-10-30T21:00:00.000Z');
  assert.equal(followUpAt('tomorrow').toISOString(), '2026-10-31T13:00:00.000Z');
});
test('just after midnight on the day the clocks go back (Nov 1): EOD is 5 PM standard time', () => {
  at('2026-11-01T04:30:00Z');                 // Nov 1, 12:30 AM EDT
  assert.equal(T.ymd(), '2026-11-01');
  assert.equal(followUpAt('eod').toISOString(), '2026-11-01T22:00:00.000Z');
  assert.equal(followUpAt('tomorrow').toISOString(), '2026-11-02T14:00:00.000Z');
  assert.equal(followUpAt('2026-11-01').toISOString(), '2026-11-01T14:00:00.000Z');   // today, picked: 9 AM standard time
});
test('a picked date in the past is refused; the last day of the quarter is fine', () => {
  at('2026-12-31T22:00:00Z');                 // Dec 31, 5 PM
  assert.equal(followUpAt('2026-12-30'), null);
  assert.equal(followUpAt('2026-12-31').toISOString(), '2026-12-31T14:00:00.000Z');
  assert.equal(followUpAt('2027-01-01').toISOString(), '2027-01-01T14:00:00.000Z');
});
test('the spring clock change (Mar 14 2027): 9 AM is 13:00 UTC', () => {
  at('2027-03-13T12:00:00Z');
  assert.equal(followUpAt('tomorrow').toISOString(), '2027-03-14T13:00:00.000Z');
});
