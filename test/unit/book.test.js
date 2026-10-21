// api/_book.js: the pure rules (no database). The database half is in test/db/book.test.js.
const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../api/_book');

const NOW = '2026-10-20T15:00:00Z';   // a Tuesday, 11 AM in Toronto
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date(NOW) }));
afterEach(() => mock.timers.reset());
const hoursAgo = (h) => new Date(Date.parse(NOW) - h * 3600000);
const cfg = Object.assign({}, B.DEFAULTS, { holidays: [] });

describe('order kinds', () => {
  test('an order with every line free is a sample order', () => assert.equal(B.isSample({ n_lines: 2, all_free: true }), true));
  test('an order with a paid line is not a sample order', () => assert.equal(B.isSample({ n_lines: 2, all_free: false }), false));
  test('an order with no lines is neither', () => {
    assert.equal(B.isSample({ n_lines: 0, all_free: true }), false);
    assert.equal(B.isPaid({ n_lines: 0, all_free: false, paid_flag: true }), false);
  });
  test('a paid order needs the paid flag', () => {
    assert.equal(B.isPaid({ n_lines: 1, all_free: false, paid_flag: true }), true);
    assert.equal(B.isPaid({ n_lines: 1, all_free: false, paid_flag: false }), false);
  });
  test('a sample order is never a paid order, even when flagged', () => assert.equal(B.isPaid({ n_lines: 1, all_free: true, paid_flag: true }), false));
  test('paidAt prefers the payment time, then submitted, then created', () => {
    const a = new Date('2026-10-01'), b = new Date('2026-10-02'), c = new Date('2026-10-03');
    assert.equal(B.paidAt({ paid_at: a, submitted_at: b, created_at: c }), a);
    assert.equal(B.paidAt({ paid_at: null, submitted_at: b, created_at: c }), b);
    assert.equal(B.paidAt({ created_at: c }), c);
  });
});

describe('names and addresses', () => {
  test('a doctor gets "Dr."', () => assert.equal(B.fullName({ first_name: 'Maya', last_name: 'Sample', designation: 'MD' }), 'Dr. Maya Sample'));
  test('DO, DDS and DMD get "Dr." too, in any case', () => {
    for (const d of ['DO', 'dds', 'DMD ']) assert.equal(B.fullName({ first_name: 'A', last_name: 'B', designation: d }), 'Dr. A B');
  });
  test('a nurse does not', () => assert.equal(B.fullName({ first_name: 'Ana', last_name: 'Lee', designation: 'RN' }), 'Ana Lee'));
  test('"Dr." is not doubled', () => assert.equal(B.fullName({ first_name: 'Dr. Ana', last_name: 'Lee', designation: 'MD' }), 'Dr. Ana Lee'));
  test('no name falls back to the email, then "No name"', () => {
    assert.equal(B.fullName({ email: 'a@b.c' }), 'a@b.c');
    assert.equal(B.fullName({}), 'No name');
  });
  test('only a first name', () => assert.equal(B.fullName({ first_name: 'Cher' }), 'Cher'));
  test('addr builds the parts and a short line', () => {
    const a = B.addr({ shipping_street: '1 A St', shipping_city: 'Town', shipping_province: 'ON', shipping_postal_code: 'A1A 1A1' }, 'shipping');
    assert.deepEqual(a, { street: '1 A St', city: 'Town', province: 'ON', postal: 'A1A 1A1', line: '1 A St, Town' });
  });
  test('addr of an empty address', () => assert.equal(B.addr({}, 'billing').line, ''));
  test('group puts rows under their key', () => assert.deepEqual(B.group([{ k: 1, v: 'a' }, { k: 2, v: 'b' }, { k: 1, v: 'c' }], 'k'), { 1: [{ k: 1, v: 'a' }, { k: 1, v: 'c' }], 2: [{ k: 2, v: 'b' }] }));
});

describe('ago and nextMilestone', () => {
  test('minutes, hours, days, weeks, months', () => {
    assert.equal(B.ago(hoursAgo(0.5)), '30m ago');
    assert.equal(B.ago(hoursAgo(2)), '2h ago');
    assert.equal(B.ago(hoursAgo(26)), '1d ago');
    assert.equal(B.ago(hoursAgo(24 * 15)), '2 wk ago');
    assert.equal(B.ago(hoursAgo(24 * 45)), '2 mo ago');
  });
  test('a time in the future reads as now', () => assert.equal(B.ago(hoursAgo(-1)), '0m ago'));
  test('the next milestone is the next multiple of 5', () => {
    assert.equal(B.nextMilestone(0), 5);
    assert.equal(B.nextMilestone(22), 25);
    assert.equal(B.nextMilestone(25), 30);
    assert.equal(B.nextMilestone(49), 50);
  });
});

describe('todayList', () => {
  const me = { id: 'me', settings: {} };
  const lead = (id, o) => Object.assign({ id, name: id, clinic: 'C', stage: 'lead', isNew: true, sourceKind: 'social', createdAt: hoursAgo(2) }, o);
  const fifty = (id, o) => Object.assign({ id, name: id, clinic: 'C', stage: 'fifty', goingCold: true, coldDays: 35 }, o);
  const cand = (id, o) => Object.assign({ id, name: id, clinic: 'C', stage: 'candidate', samplesAt: hoursAgo(24 * 10), sampleDays: 10, touchedSinceSamples: false }, o);
  const withTask = (p, dueHoursAgo, type) => Object.assign(p, { followUp: { id: 't-' + p.id, title: 'Call back', type: type || 'call', due_at: hoursAgo(dueHoursAgo) } });

  test('the order is new leads, follow-ups, going cold, then candidates', () => {
    const list = B.todayList([cand('c1'), fifty('f1'), withTask(fifty('f2', { goingCold: false }), 1), lead('l1')], me, cfg);
    assert.deepEqual(list.map((x) => x.why), ['lead', 'follow_up', 'going_cold', 'candidate']);
  });
  test('a new lead reads "new Meta lead · 2h ago" and is a call', () => {
    const [x] = B.todayList([lead('l1')], me, cfg);
    assert.equal(x.detail, 'new Meta lead · 2h ago');
    assert.equal(x.action, 'call');
  });
  test('newest leads come first', () => {
    const list = B.todayList([lead('old', { createdAt: hoursAgo(10) }), lead('new', { createdAt: hoursAgo(1) })], me, cfg);
    assert.deepEqual(list.map((x) => x.id), ['new', 'old']);
  });
  test('a lead older than 24 hours, already touched, or not from social media is left out', () => {
    const list = B.todayList([lead('a', { createdAt: hoursAgo(25) }), lead('b', { isNew: false }), lead('c', { sourceKind: 'event' })], me, cfg);
    assert.equal(list.length, 0);
  });
  test('follow-ups due today or overdue show, oldest first; later ones do not', () => {
    const list = B.todayList([withTask(fifty('later', { goingCold: false }), -40), withTask(fifty('a', { goingCold: false }), 1), withTask(fifty('b', { goingCold: false }), 50)], me, cfg);
    assert.deepEqual(list.map((x) => x.id), ['b', 'a']);
  });
  test('a follow-up due at 5 PM today (EOD) counts as today', () => {
    const list = B.todayList([withTask(fifty('eod', { goingCold: false }), -6)], me, cfg);
    assert.equal(list.length, 1);
  });
  test('a follow-up carries its task, title and kind', () => {
    const [x] = B.todayList([withTask(fifty('v', { goingCold: false }), 1, 'visit')], me, cfg);
    assert.deepEqual([x.taskId, x.detail, x.action], ['t-v', 'Call back', 'visit']);
  });
  test('going cold: longest first, as visits', () => {
    const list = B.todayList([fifty('a', { coldDays: 31 }), fifty('b', { coldDays: 40 })], me, cfg);
    assert.deepEqual(list.map((x) => x.id), ['b', 'a']);
    assert.equal(list[0].action, 'visit');
    assert.equal(list[0].detail, 'going cold · 40 days');
  });
  test('candidates show only once samples arrived and nobody has touched them since, oldest samples first', () => {
    const list = B.todayList([cand('a', { sampleDays: 3 }), cand('b', { sampleDays: 12 }), cand('c', { samplesAt: null }), cand('d', { touchedSinceSamples: true })], me, cfg);
    assert.deepEqual(list.map((x) => x.id), ['b', 'a']);
    assert.equal(list[0].detail, 'samples 12 days ago');
  });
  test('someone reached today drops off', () => assert.equal(B.todayList([lead('l', { touchedToday: true })], me, cfg).length, 0));
  test('someone snoozed until tomorrow is hidden; an old snooze is not', () => {
    const m = { id: 'me', settings: { snoozed: { a: '2026-10-21', b: '2026-10-20' } } };
    assert.deepEqual(B.todayList([fifty('a'), fifty('b')], m, cfg).map((x) => x.id), ['b']);
  });
  test('a person shows once even when two rules match', () => {
    const p = withTask(fifty('x'), 1);
    assert.equal(B.todayList([p], me, cfg).length, 1);
    assert.equal(B.todayList([p], me, cfg)[0].why, 'follow_up');
  });
  test('the new-lead window comes from settings', () => {
    assert.equal(B.todayList([lead('l', { createdAt: hoursAgo(30) })], me, Object.assign({}, cfg, { new_lead_hours: 48 })).length, 1);
  });
  test('an empty book gives an empty list', () => assert.deepEqual(B.todayList([], me, cfg), []));
  test('a person with no settings at all on the user', () => assert.equal(B.todayList([fifty('a')], { id: 'me' }, cfg).length, 1));
});
