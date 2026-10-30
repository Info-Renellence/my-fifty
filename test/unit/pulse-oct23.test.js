// Pulse changes of 2026-10-23 (Yousef): the Today streak tile and the Rewards screen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

// F11 Rewards (Final Mockup (2), 2026-10-27): earned this quarter, Cha-ching, Race to Vienna. No syringe tiles or Race to 25.
// F2d (Final Mockup (3), 2026-10-28): the two tiles became one panel, the streak over My Fifty, with Nell and her line.
test('the Today panel shows the streak days and this week, My Fifty, and Nell’s line, without "plan done"', () => {
  const at = app.indexOf('function todayPanel'); const tile = app.slice(at, app.indexOf('function screenToday', at));
  assert.ok(tile.includes("day.streak + '</span><span class=\"tp-w\">day streak"), 'the streak number is shown');
  assert.ok(tile.includes('day.week'), 'Monday to Friday of this week');
  assert.ok(tile.includes("n + '/' + goal"), "today's ring counts towards the day goal");
  assert.ok(tile.includes('in My Fifty') && tile.includes('more to reach'), 'My Fifty under the streak');
  assert.ok(tile.includes('Perfect day!') && tile.includes('Streak saved!') && tile.includes('saves your streak!'), "Nell's three lines");
  assert.ok(!/plan done/i.test(tile), 'no "plan done" on the panel');
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
  assert.match(fn, /noShip = dft\.noShip = !\(who\.shipping\.street && who\.shipping\.city && who\.shipping\.postal\)/);   // postal too, as Edge (final audit 2026-10-30)
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

// 2026-10-28 (owner): the Race to Vienna podium shows 1st / 2nd / 3rd on fixed steps, not the reps' account counts.
test('the Race to Vienna podium has fixed steps with the place, and no account counts', () => {
  const at = app.indexOf('function podium'); const fn = app.slice(at, app.indexOf('function screenRewards', at));
  assert.ok(/STEP = \{ 1: \d+, 2: \d+, 3: \d+ \}/.test(fn), 'fixed step heights');
  assert.ok(!/x\.n\b/.test(fn), 'no account count shown or used for the height');
});
