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
test('a delivered wire order not marked received shows every step done (owner 2026-10-28: wires show as paid)', () => {
  const steps = D.orderSteps({ submitted_at: placed, status: 'delivered', payment_method: 'wire' }, { paid_flag: false }, [], { text: 'Wire · 3 days overdue' });
  assert.deepEqual(steps.map((s) => s.done), [true, true, true, true, true]);
});
test('an approved order with no approval time is approved; a submitted one still waits', () => {
  assert.equal(D.orderSteps({ submitted_at: placed, status: 'approved' }, { paid_flag: false }, [])[1].done, true);
  const s = D.orderSteps({ submitted_at: placed, status: 'submitted' }, { paid_flag: false }, []);
  assert.equal(s[1].done, false);
  assert.equal(s[1].current, true);
});

// RD2: real emails carry long links with no spaces, a person with no name shows their email as the name, and clinic
// names are kept on one line (lib.js nb); long ones pushed History, the person card and L9 wider than the phone.
// break-word only breaks text that would not fit on its own line, so normal layouts are unchanged.
// Browser check on the real books: the read-only screen pass (no page wider than 390 px).
test('long words (links, emails used as a name, long clinic names) wrap instead of widening the page', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app.css'), 'utf8');
  const rule = css.match(/(^|\n)\s*html,\s*body\s*\{([^}]*)\}/);
  assert.ok(rule, 'the html, body rule');
  assert.match(rule[2], /overflow-wrap:\s*(break-word|anywhere)/);
});

// RD8: 18 real people have no first name. "No phone number for  yet." named nobody; the full name (or the email,
// when there is no name at all) is used instead.
test('the no-phone / no-email messages name the person even with no first name', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app.js'), 'utf8');
  for (const m of app.match(/toast\('No (phone number|email address) for ' \+ [^)]*\)/g) || ['missing']) assert.match(m, /p\.first \|\| p\.name/);
});
