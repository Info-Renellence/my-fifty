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

test('Rewards has two leaderboards, Trip to Vienna and Race to 25, switched by two tabs or a sideways swipe', () => {
  const fn = app.slice(app.indexOf('function boardSection'), app.indexOf('function screenRewards'));
  assert.ok(fn.includes("['trip', r.trip.name], ['race', r.race ? r.race.name : '']"), 'the two tabs');
  assert.ok(fn.includes('data-board-tab'), 'tabs switch the board');
  assert.ok(/touchend[\s\S]*showBoard\(dx < 0 \? 'race' : 'trip'\)/.test(fn), 'a swipe left shows Race to 25, right Trip to Vienna');
  assert.ok(fn.includes('role="progressbar"') && fn.includes("/' + b.goal"), 'each rep: a count out of 25 and a progress bar');
  assert.ok(fn.includes("'Reached ' + b.goal"), 'a rep at 25 shows as reached');
  assert.ok(fn.includes('Math.min(100'), 'the bar never runs past full');
  const screen = app.slice(app.indexOf('function screenRewards'), app.indexOf('L1 Reminders'));
  assert.ok(screen.includes('+ boardSection(r)') && !screen.includes('r.trip.rows'), 'the screen draws the boards in one place');
});

test('the morning notification reads "N days in a row", without "plan done", like the Today tile', () => {
  const cron = require('../../api/cron');
  assert.equal(cron._.morningTitle(6), '6 days in a row');
  assert.equal(cron._.morningTitle(1), '1 day in a row');
  assert.equal(cron._.morningTitle(0), 'Good morning');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'api', 'cron.js'), 'utf8');
  assert.ok(!/plan done/i.test(src), 'no "plan done" anywhere in the cron, comments included');
});

// RD12 (owner 2026-10-23): long notes and emails in History show three lines with "More" / "Less".
test('History folds a long note or email to three lines with More / Less', () => {
  const L = require('../../lib');
  assert.equal(L.longText('Short note'), false);
  assert.equal(L.longText('one\ntwo\nthree'), false);
  assert.equal(L.longText('one\ntwo\nthree\nfour'), true);
  assert.equal(L.longText('x'.repeat(21000)), true);
  const at = app.indexOf('function historyBody'); const fn = app.slice(at, app.indexOf('function screenHistory', at));
  assert.match(fn, /clamp3/); assert.match(fn, /data-hmore/); assert.match(fn, />More</);
  assert.match(app, /classList\.toggle\('clamp3'\)[^\n]*'Less' : 'More'/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'app.css'), 'utf8'), /\.clamp3 \{[^}]*-webkit-line-clamp: 3/);
});
