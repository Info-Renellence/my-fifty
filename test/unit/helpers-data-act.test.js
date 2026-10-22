// Pure helpers in api/data.js and api/act.js.
const { test, describe, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../api/data')._;
const A = require('../../api/act')._;

beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T15:00:00Z') }));
afterEach(() => mock.timers.reset());

describe('act: splitNote', () => {
  test('a "Next:" line becomes the next step', () => assert.deepEqual(A.splitNote('Wants to order.\nNext: call Monday'), { note: 'Wants to order.', next: 'call Monday' }));
  test('"Next step:" and any case work', () => assert.deepEqual(A.splitNote('Hi\nNEXT STEP: send pricing'), { note: 'Hi', next: 'send pricing' }));
  test('a note that starts with Next:', () => assert.deepEqual(A.splitNote('Next: visit Friday'), { note: '', next: 'visit Friday' }));
  test('"next" inside a sentence is not a next step', () => assert.deepEqual(A.splitNote('We talked about the next launch: lips.'), { note: 'We talked about the next launch: lips.', next: '' }));
  test('no Next line', () => assert.deepEqual(A.splitNote('Just a note'), { note: 'Just a note', next: '' }));
  test('the next step is cut to 300 characters', () => assert.equal(A.splitNote('a\nNext: ' + 'x'.repeat(400)).next.length, 300));
});

describe('act: followUpAt', () => {
  test('EOD is 5 PM today in Toronto', () => assert.equal(A.followUpAt('eod').toISOString(), '2026-10-20T21:00:00.000Z'));
  test('Tomorrow is 9 AM tomorrow', () => assert.equal(A.followUpAt('tomorrow').toISOString(), '2026-10-21T13:00:00.000Z'));
  test('a picked date is 9 AM that day', () => assert.equal(A.followUpAt('2026-12-01').toISOString(), '2026-12-01T14:00:00.000Z'));
  test('today can be picked', () => assert.ok(A.followUpAt('2026-10-20')));
  test('a past date, a bad date and nothing are refused', () => {
    assert.equal(A.followUpAt('2026-10-19'), null);
    assert.equal(A.followUpAt('next week'), null);
    assert.equal(A.followUpAt(undefined), null);
  });
});

describe('act: normalPhone', () => {
  test('ten digits become +1 and ten digits', () => assert.equal(A.normalPhone('(647) 555-1234'), '+16475551234'));
  test('eleven digits starting with 1', () => assert.equal(A.normalPhone('1 647 555 1234'), '+16475551234'));
  test('an international number keeps its country code', () => assert.equal(A.normalPhone('+44 20 7946 0958'), '+442079460958'));
  test('nothing gives nothing', () => assert.equal(A.normalPhone(''), ''));
  test('too short or nonsense is refused', () => {
    assert.equal(A.normalPhone('555-12'), '');
    assert.equal(A.normalPhone('call me'), '');
  });
});

describe('data: words', () => {
  test('money', () => assert.equal(D.money(6840.4), '$6,840'));
  test('initials skip Dr.', () => assert.equal(D.initials('Dr. Lee Sample'), 'LS'));
  test('short product names follow the mockup', () => {
    assert.equal(D.shortProduct('saypha® filler Lidocaine 1 ml'), 'saypha® filler');
    assert.equal(D.shortProduct('saypha® volume plus Lidocaine 1 ml'), 'saypha® volume plus');
    assert.equal(D.shortProduct('saypha® lips Lidocaine 1 ml'), 'saypha® lips');
    assert.equal(D.shortProduct('Magic Needle Cannula 25G 50MM Box of 25'), 'Magic Needle 25G 50mm');
    assert.equal(D.shortProduct('Mesbio Intradermal Hypodermic Needle 30G 12MM Box of 100'), 'Mesbio needle 30G 12mm');
    assert.equal(D.shortProduct('Exprecell Single Syringe System (5 Syringes/Box)'), 'Exprecell Single Syringe System');
    assert.equal(D.shortProduct('saypha Lip Balm'), 'saypha Lip Balm');
    assert.equal(D.shortProduct(null), '');
  });
  test('boxes are cannulas, needles and Exprecell', () => {
    assert.equal(D.unitWord('MN2550'), 'box');
    assert.equal(D.unitWord('MES3012'), 'box');
    assert.equal(D.unitWord('EXPRECELL'), 'box');
    assert.equal(D.unitWord('SAF100'), '');
  });
  test('history short names', () => {
    assert.equal(D.shortName('saypha® volume plus Lidocaine 1 ml'), 'volume plus');
    assert.equal(D.shortName('saypha® volume Lidocaine 1 ml'), 'volume');
    assert.equal(D.shortName('saypha® lips Lidocaine 1 ml'), 'lips');
    assert.equal(D.shortName('saypha® filler Lidocaine 1 ml'), 'filler');
    assert.equal(D.shortName('Magic Needle Cannula 25G'), 'cannulas');
    assert.equal(D.shortName('Mesbio Needle 30G'), 'needles');
    assert.equal(D.shortName('Face Mask Box of 10'), 'Face Mask');
  });
  test('lineSummary: paid lines for an order, every line for samples', () => {
    const lines = [{ qty: 10, name: 'saypha® filler Lidocaine 1 ml', free: false }, { qty: 1, name: 'saypha Headband', free: true }];
    assert.equal(D.lineSummary({ summary: lines, n_lines: 2, all_free: false }), '10 filler');
    assert.equal(D.lineSummary({ summary: [{ qty: 2, name: 'saypha® lips Lidocaine 1 ml', free: true }], n_lines: 1, all_free: true }), '2 lips');
    assert.equal(D.lineSummary({ summary: null, n_lines: 0 }), '');
  });
  test('outcomeWord', () => {
    assert.equal(D.outcomeWord({ kind: 'call', outcome: 'connected' }), 'reached');
    assert.equal(D.outcomeWord({ kind: 'meeting', outcome: 'took_order' }), 'reached');
    assert.equal(D.outcomeWord({ kind: 'call', outcome: 'no_answer' }), 'no reply');
    assert.equal(D.outcomeWord({ kind: 'call', outcome: null }), '');
    assert.equal(D.outcomeWord({ kind: 'note', outcome: 'connected' }), '');
    assert.equal(D.outcomeWord({ kind: 'email', outcome: 'connected' }), '');
  });
  test('when: "today" or the date', () => {
    assert.equal(D.when(new Date('2026-10-20T13:00:00Z')), 'today');
    assert.equal(D.when(new Date('2026-10-15T13:00:00Z')), 'Oct 15');
  });
  test('fmtTime: "Today 8:47" or "Oct 15, 9:12"', () => {
    assert.equal(D.fmtTime(new Date('2026-10-20T12:47:00Z')), 'Today 8:47');
    assert.equal(D.fmtTime(new Date('2026-10-15T13:12:00Z')), 'Oct 15, 9:12');
  });
  test('sourceText: the event, then who added them; nothing for a Meta lead', () => {
    assert.equal(D.sourceText({ sourceKind: 'social' }), '');
    assert.equal(D.sourceText({ sourceKind: 'event', eventName: 'Lips webinar' }), 'Lips webinar');
    assert.equal(D.sourceText({ sourceKind: 'cold' }, 'you'), 'Added by you');
    assert.equal(D.sourceText({ sourceKind: 'cold' }), '');
  });
});

describe('data: order words and steps', () => {
  const o = (x) => Object.assign({ n_lines: 1, all_free: false, paid_flag: false, status: 'approved' }, x);
  test('ORDER_WORD for every stage', () => {
    assert.deepEqual(D.ORDER_WORD(o({ status: 'cancelled' })), ['Cancelled', 'grey']);
    assert.deepEqual(D.ORDER_WORD(o({ delivered_at: new Date() })), ['Delivered', 'green']);
    assert.deepEqual(D.ORDER_WORD(o({ shipped_at: new Date() })), ['Shipped', 'green']);
    assert.deepEqual(D.ORDER_WORD(o({ status: 'submitted' })), ['Waiting on approval', 'amber']);
    assert.deepEqual(D.ORDER_WORD(o({ status: 'awaiting_md' })), ['Waiting on MD signature', 'amber']);
    assert.deepEqual(D.ORDER_WORD(o({})), ['Waiting on payment', 'amber']);
    assert.deepEqual(D.ORDER_WORD(o({ paid_flag: true })), ['Preparing to ship', 'blue']);
    assert.deepEqual(D.ORDER_WORD(o({ all_free: true })), ['Preparing to ship', 'blue']);
  });
  test('markCurrent marks the first step not done and fills its text', () => {
    const steps = D.markCurrent([{ done: true, when: 'a' }, { done: false, when: '' }, { done: false, when: '' }], () => 'Waiting');
    assert.equal(steps[1].current, true);
    assert.equal(steps[1].when, 'Waiting');
    assert.equal(steps[2].current, undefined);
  });
  test('markCurrent keeps existing text and handles all done', () => {
    assert.equal(D.markCurrent([{ done: false, when: 'link sent' }], () => 'Waiting')[0].when, 'link sent');
    assert.equal(D.markCurrent([{ done: true }], () => 'x').some((s) => s.current), false);
  });
  const placed = new Date('2026-10-20T12:47:00Z');
  test('orderSteps: waiting on a pay link', () => {
    const steps = D.orderSteps({ submitted_at: placed, approved_at: new Date('2026-10-20T13:12:00Z') }, { paid_flag: false },
      [{ method: 'pay_link', status: 'pending', created_at: new Date('2026-10-20T14:05:00Z') }]);
    assert.deepEqual(steps.map((s) => s.label), ['Order placed', 'Approved', 'Payment', 'Preparing to ship', 'Shipped']);
    assert.equal(steps[0].when, 'Today 8:47');
    assert.equal(steps[2].current, true);
    assert.equal(steps[2].when, 'No card on file · link sent 10:05');
  });
  test('orderSteps: a declined card says so', () => {
    const steps = D.orderSteps({ submitted_at: placed, approved_at: placed }, { paid_flag: false }, [{ method: 'card_on_file', status: 'failed', created_at: placed }]);
    assert.equal(steps[2].when, 'Card declined');
  });
  test('orderSteps: a wire order is paid only once received; until then the Payment step waits', () => {
    const open = D.orderSteps({ submitted_at: placed, approved_at: placed, payment_method: 'wire' }, { paid_flag: false }, [], { text: 'Wire · net 30, due Nov 20' });
    assert.deepEqual([open[2].done, open[2].current, open[2].when], [false, true, 'Wire · net 30, due Nov 20']);
    const paid = D.orderSteps({ submitted_at: placed, approved_at: placed, payment_method: 'wire' }, { paid_flag: true }, [], { text: 'Wire · received Nov 18' });
    assert.deepEqual([paid[2].done, paid[2].when], [true, 'Wire · received Nov 18']);
  });
  test('orderSteps: a wire order shows where its payment stands', () => {
    const steps = D.orderSteps({ submitted_at: placed, approved_at: placed, payment_method: 'wire' }, { paid_flag: true }, [], { text: 'Wire · 3 days overdue' });
    assert.equal(steps[2].done, true);
    assert.equal(steps[2].when, 'Wire · 3 days overdue');
  });
  test('orderSteps: shipped with tracking', () => {
    const steps = D.orderSteps({ submitted_at: placed, approved_at: placed, sent_to_warehouse_at: placed, shipped_at: placed, tracking_number: '1Z9' }, { paid_flag: true }, [{ status: 'succeeded', paid_at: placed }]);
    assert.ok(steps.every((s) => s.done));
    assert.match(steps[4].when, /1Z9$/);
  });
  test('orderSteps: not approved yet', () => {
    const steps = D.orderSteps({ submitted_at: placed }, { paid_flag: false }, []);
    assert.equal(steps[1].current, true);
    assert.equal(steps[1].when, 'Waiting');
  });
  test('sampleSteps: waiting on the MD names them', () => {
    const steps = D.sampleSteps({ submitted_at: placed, approved_at: placed }, { first_name: 'Lee', last_name: 'Sample', designation: 'MD' }, { sent_at: new Date('2026-10-20T13:12:00Z') });
    assert.deepEqual(steps.map((s) => s.label), ['Order placed', 'Approved', 'MD signature', 'Preparing to ship', 'Shipped']);
    assert.equal(steps[2].when, 'Sent to Dr. Lee Sample 9:12');
    assert.equal(steps[2].current, true);
  });
  test('sampleSteps: signed and shipped', () => {
    const steps = D.sampleSteps({ submitted_at: placed, approved_at: placed, medical_director_signed_at: placed, shipped_at: placed }, null, null);
    assert.equal(steps[2].done, true);
    assert.equal(steps[4].done, true);
  });
  test('sampleSteps: no MD envelope yet', () => assert.equal(D.sampleSteps({ submitted_at: placed, approved_at: placed }, null, null)[2].when, 'Waiting'));
});
