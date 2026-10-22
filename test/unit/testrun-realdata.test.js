// Real-data run 2026-10-22: what the real books showed that the demo data did not.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../api/data')._;

// RD6: orders brought over from Shopify are shipped or delivered with no approved / warehouse / shipped times. The
// order screen (L19/L21) showed such a delivered order as "Approved · Waiting" while History said "Delivered".
const placed = new Date('2026-08-07T16:37:00Z');
test('a delivered order with no step times shows every step done (L19)', () => {
  const steps = D.orderSteps({ submitted_at: placed, status: 'delivered', payment_method: 'card_on_file' }, { paid_flag: true }, []);
  assert.deepEqual(steps.map((s) => s.done), [true, true, true, true, true]);
  assert.ok(!steps.some((s) => s.current), 'nothing is waiting');
  assert.equal(steps[1].when, '', 'no made-up date');
});
test('a delivered sample order with no step times shows every step done (L21)', () => {
  const steps = D.sampleSteps({ submitted_at: placed, status: 'delivered' }, null, null);
  assert.ok(steps.every((s) => s.done));
});
test('a shipped wire order that is not received yet still waits on the payment only', () => {
  const steps = D.orderSteps({ submitted_at: placed, status: 'delivered', payment_method: 'wire' }, { paid_flag: false }, [], { text: 'Wire · 3 days overdue' });
  assert.deepEqual(steps.map((s) => s.done), [true, true, false, true, true]);
  assert.equal(steps[2].current, true);
});
test('an approved order with no approval time is approved; a submitted one still waits', () => {
  assert.equal(D.orderSteps({ submitted_at: placed, status: 'approved' }, { paid_flag: false }, [])[1].done, true);
  const s = D.orderSteps({ submitted_at: placed, status: 'submitted' }, { paid_flag: false }, []);
  assert.equal(s[1].done, false);
  assert.equal(s[1].current, true);
});
