// Pulse changes of 2026-10-23 (Yousef): the Today streak tile and the Rewards screen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

test('the Today streak tile shows the days only, without "plan done"', () => {
  const at = app.indexOf("STREAK ' + FLAME"); const tile = app.slice(at, app.indexOf('MY FIFTY', at));
  assert.ok(tile.includes('day.streak'), 'the streak number is still shown');
  assert.match(tile, /'day' : 'days'/);
  assert.ok(!/plan done/i.test(tile), 'no "plan done" on the tile');
});
