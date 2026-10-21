// Test run 2026-10-21: page helpers (lib.js) edge cases found during the run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../lib');

test('a note that is only a "Next:" line shows no body in History (the next step is shown on its own line)', () => {
  assert.equal(L.stripNext('Next: bring the volume samples'), '');
  assert.equal(L.stripNext('  next step: call Friday'), '');
  assert.equal(L.stripNext('Wants to order.\nNext: call Monday'), 'Wants to order.');
  assert.equal(L.stripNext('Nextdoor clinic was closed'), 'Nextdoor clinic was closed');
});
