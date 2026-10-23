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

test('the saypha and Exprecell boxes are tighter, keep their text, and write "saypha" in lower case', () => {
  const at = app.indexOf('r.syringes'); const boxes = app.slice(app.lastIndexOf('<div style="display:grid', at), app.indexOf('Exprecell boxes', at) + 60);
  assert.ok(boxes.includes('saypha syringes · this month') && boxes.includes('Exprecell boxes · this month'));
  assert.ok(!/Saypha|SAYPHA/.test(boxes), 'saypha is lower case');
  assert.equal((boxes.match(/padding:10px 14px/g) || []).length, 2, 'both boxes use the tighter padding');
  assert.ok(!/padding:14px"/.test(boxes) && !/font-size:28px/.test(boxes), 'no longer the old tall boxes');
});
