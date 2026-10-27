// Pulse changes of 2026-10-23 (Yousef): the Today streak tile and the Rewards screen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

// Rebuilt to "Edge – Final Mockup (2)" on 2026-10-27: the F2 streak tile (days and this week's Monday to Friday),
// and F11 Rewards (earned this quarter, Cha-ching, Race to Vienna). The syringe tiles and Race to 25 are not in it.
test('the Today streak tile shows the streak days and this week, without "plan done"', () => {
  const at = app.indexOf('function streakTile'); const tile = app.slice(at, app.indexOf('function fiftyTile', at));
  assert.ok(tile.includes("day.streak + '</span><span class=\"tile-w\">day streak"), 'the streak number is shown');
  assert.ok(tile.includes('day.week'), 'Monday to Friday of this week');
  assert.ok(tile.includes("n + '/' + goal"), "today's ring counts towards the day goal");
  assert.ok(!/plan done/i.test(tile), 'no "plan done" on the tile');
});

test('Rewards shows what was earned this quarter, the wins, and the Race to Vienna podium', () => {
  const at = app.indexOf('function screenRewards'); const fn = app.slice(at, app.indexOf('function screenWins', at));
  assert.ok(fn.includes('Earned this quarter') && fn.includes('r.earned'), 'earned this quarter');
  assert.ok(fn.includes('Cha-ching') && fn.includes('/rewards/wins'), 'Cha-ching with See all');
  assert.ok(fn.includes('Race to Vienna') && fn.includes('podium(t)'), 'the Race to Vienna podium');
  assert.ok(!/r\.syringes|Race to 25/.test(fn), 'the old boxes and the second board are gone');
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

// RD11 (owner 2026-10-23): Review with no shipping address says so, holds Send and offers "+ Add a shipping address".
test('Review holds Send without a shipping address and offers to add one', () => {
  const L = require('../../lib');
  assert.equal(L.errText({ message: 'no_shipping_address' }), 'Add a shipping address before sending this order.');
  const at = app.indexOf('function screenReview'); const fn = app.slice(at, app.indexOf('$app.addEventListener', at));
  assert.match(fn, /noShip = dft\.noShip = !\(who\.shipping\.street && who\.shipping\.city\)/);
  assert.match(fn, /ic\('plus', 14\) \+ ' Add a shipping address/);   // the "+" is drawn as an icon (UI polish 2026-10-23)
  assert.match(fn, /Add a shipping address to send this order\./);
  assert.match(app, /if \(draft\.noShip\) \{ toast\(errText\(\{ message: 'no_shipping_address' \}\)\); shippingSheet\(draft\.contactId\); return; \}/);
  assert.match(app, /act\('shipping_address', \{ contactId: contactId, street: v\('street'\), city: v\('city'\)/);
});

// Head office (owner 2026-10-23): the app shows "Pulse is for reps" with Sign out, not the sign-in error.
test('a head office sign-in shows the polite "Pulse is for reps" screen', () => {
  const L = require('../../lib');
  assert.match(L.errText({ message: 'reps_only' }), /Pulse is the reps’ app/);
  assert.match(app, /if \(e && e\.message === 'reps_only'\) return showRepsOnly\(\);/);
  const at = app.indexOf('function showRepsOnly'); const fn = app.slice(at, app.indexOf('\n  }', at));
  assert.match(fn, /Pulse is for reps/); assert.match(fn, /data-repsout/); assert.match(fn, />Sign out</);
});

// Head office doesn't use Pulse (owner 2026-10-23): signedIn answers 403 reps_only for users.kind = 'head_office'; admins
// and reps sign in as before. (A fake database: the test copy refuses reads of users to the test login.)
test('head office gets reps_only; admins and reps still sign in', async () => {
  const D = require('../../api/_db');
  const Au = require('../../api/_auth');
  const realFetch = global.fetch;
  try {
    for (const [kind, want] of [['head_office', 'reps_only'], ['admin', 'admin'], ['rep', 'rep']]) {
      const authId = 'a-' + kind;
      D.setDb(async () => [{ id: 'u-' + kind, email: kind + '@renellence.com', full_name: 'Unit ' + kind, kind, is_active: true, preferences: {}, auth_user_id: authId }]);
      global.fetch = async () => ({ ok: true, json: async () => ({ id: authId, email: kind + '@renellence.com' }) });
      const got = await Au.signedIn({ headers: { authorization: 'Bearer ho-' + kind + Math.random() } }).then((me) => me.kind, (e) => e.status + ' ' + e.message);
      assert.equal(got, want === 'reps_only' ? '403 reps_only' : want, kind);
    }
  } finally { global.fetch = realFetch; D.setDb(null); }
});
