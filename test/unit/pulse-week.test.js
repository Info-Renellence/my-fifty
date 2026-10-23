// The week in Pulse (Compass): the pure parts. Parked accounts leave Today's list until their date; the week's Monday,
// the focus line and the counts. The database half is test/db/pulse-week.test.js.
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../api/_book');
const W = require('../../api/_week');

const NOW = '2026-10-21T15:00:00Z';   // a Wednesday, 11 AM in Toronto
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date(NOW) }));
afterEach(() => mock.timers.reset());
const cfg = Object.assign({}, B.DEFAULTS, { holidays: [] });
const me = { id: 'me', preferences: {} };
const fifty = (id) => ({ id, name: id, clinic: 'C', stage: 'fifty', goingCold: true, coldDays: 35 });
const withTask = (p) => Object.assign(p, { followUp: { id: 't-' + p.id, title: 'Call back', kind: 'call', due_at: new Date(Date.parse(NOW) - 3600000) } });

test('a parked account is left off Today until its date, follow-ups included', () => {
  const people = [fifty('a'), withTask(fifty('b')), fifty('c')];
  assert.deepEqual(B.todayList(people, me, cfg).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(B.todayList(people, me, cfg, { a: '2026-11-16', b: '2026-11-16' }).map((x) => x.id), ['c']);
  assert.deepEqual(B.todayList(people, me, cfg, { a: '2026-10-21' }).map((x) => x.id), ['b', 'a', 'c'], 'back on the day itself');
  assert.deepEqual(B.todayList(people, me, cfg, {}).length, 3);
});

test('the week runs Monday to Sunday in Toronto', () => {
  assert.equal(W.weekOf().mon, '2026-10-19');
  assert.equal(W.weekOf('2026-10-25').mon, '2026-10-19', 'Sunday');
  assert.equal(W.weekOf('2026-10-26').mon, '2026-10-26', 'Monday');
  assert.equal(W.weekOf('2026-10-19').start.toISOString(), '2026-10-19T04:00:00.000Z');
  assert.equal(W.weekOf('2026-10-19').end.toISOString(), '2026-10-26T04:00:00.000Z');
});

test('the focus line and the counts', () => {
  assert.equal(W.focusLine('close', 3), '3 sampled clinics asked for an order date');
  assert.equal(W.focusLine('events', 6), '6 customers invited in person');
  assert.equal(W.focusLine('nope', 3), '');
  assert.equal(W.countLine(1, 1), '1 visit · 1 call');
  assert.equal(W.countLine(5, 0), '5 visits · 0 calls');
  assert.equal(W.dayName('2026-10-21T15:00:00Z'), 'Wed');
  assert.deepEqual(Object.keys(W.GOALS), ['close', 'warm', 'grow', 'fill', 'events']);
});
