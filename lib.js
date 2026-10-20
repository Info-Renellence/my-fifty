/* My Fifty: the page's small pure helpers (no screen drawing), shared by app.js and the unit tests
   (test/unit/lib.test.js). Loaded before app.js as window.MFLib; in Node it is a module. */
(function (root) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LONG_DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var LONG_MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Escaped, with spaces that never break ("Sample Clinic B" stays on one line, as in the mockup).
  function nb(s) { return esc(s).replace(/ /g, '&nbsp;'); }

  // 'YYYY-MM-DD' in Toronto time.
  function ymd(d) { return (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); }
  function addDays(date, n) { return new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  // '2026-10-21' -> 'Oct 21'
  function shortDate(date) { return MONTHS[+date.slice(5, 7) - 1] + ' ' + (+date.slice(8, 10)); }
  // L2's date line: 'TUESDAY, OCTOBER 20'
  function longDate(date) { return LONG_DAYS[new Date(date + 'T12:00:00Z').getUTCDay()] + ', ' + LONG_MONTHS[+date.slice(5, 7) - 1] + ' ' + (+date.slice(8, 10)); }

  var ERR = {
    note_required: 'Say or type what happened first.', pick_a_follow_up: 'Pick a follow-up date.', name_required: 'Add a name.',
    bad_email: 'That email doesn’t look right.', bad_phone: 'That phone number doesn’t look right.',
    already_yours: 'This person is already in your book.', already_someones: 'This person is already in someone else’s book.',
    no_products: 'Add products first.', md_required: 'Add the medical director’s name and email.', not_ready_to_order: 'They need to finish onboarding before ordering.',
    voice_not_set_up: 'Voice notes aren’t set up yet. Tap Type.', recording_too_long: 'That recording is too long. Try a shorter one.',
    gmail_not_connected: 'Connect Gmail first.', gmail_reconnect: 'Gmail needs to be connected again.', reminded_recently: 'Already reminded in the last hour.',
    subject_and_message_required: 'Add a subject and a message.', not_set_up: 'Your account isn’t set up in My Fifty yet. Ask an admin.',
    not_renellence: 'Sign in with your @renellence.com Google account.', nothing_to_charge: 'Add at least one paid product.',
  };
  function errText(e) { return ERR[e && e.message] || 'Something went wrong. Try again.'; }

  // 'Dr. Maya Sample' -> 'MS'
  function initials(name) { return String(name || '').replace(/^Dr\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-CA'); }

  // A progress ring's stroke-dasharray for done of goal on a circle of radius r ('' when nothing is done).
  function ringDash(r, done, goal) {
    var c = 2 * Math.PI * r, frac = goal > 0 ? Math.min(1, Math.max(0, done / goal)) : 0;
    return done > 0 ? (c * frac).toFixed(1) + ' ' + c.toFixed(1) : '';
  }
  // The MY FIFTY tile (L2): the last 10 dots towards the next milestone.
  function fiftyTile(count, next) { var toNext = Math.max(0, next - count); return { toNext: toNext, filled: Math.max(0, 10 - toNext) }; }
  // L2 under the ring.
  function dayLeftText(done, goal) { var left = Math.max(0, goal - done); return left ? left + ' more and today is done' : 'Today is done'; }
  // L4's sentence.
  function winLine(name, followUp, done, goal) {
    var left = Math.max(0, goal - done);
    return 'Logged for ' + name + '. Follow-up saved for ' + followUp + '. ' + (left ? left + ' more ' + (left === 1 ? 'finishes' : 'finish') + ' today.' : 'Today is done.');
  }
  // L6 Candidates pill: days since the samples arrived (Yousef 2026-10-20: no "Ask now").
  function candidatePill(days) { return days == null ? 'Not shipped' : days + (days === 1 ? ' day' : ' days'); }
  // #12 product row's grey line.
  function productSub(p, kind) {
    var sub = p.last != null ? 'Last order: ' + p.last + (p.unit ? ' ' + p.unit + (p.last === 1 ? '' : 'es') : '') : 'New for them';
    if (kind === 'order') sub += p.alwaysFree ? ' · Free' : ' · ' + money(p.price);
    return sub;
  }
  // Products shown in #12: in Samples everything; in Order the free-only items are hidden unless already added.
  function visibleProducts(products, qty, kind) { return products.filter(function (p) { return kind === 'samples' || !p.alwaysFree || qty[p.sku]; }); }
  // Item count and money of a draft order (samples and free items never cost anything).
  function draftTotals(products, qty, kind) {
    var count = 0, total = 0;
    products.forEach(function (p) { var q = qty[p.sku] || 0; count += q; if (kind === 'order' && !p.alwaysFree) total += q * p.price; });
    return { count: count, total: total };
  }
  // "Same as last order": the quantities of the last paid order.
  function sameAsLast(lines) { var qty = {}; lines.forEach(function (l) { qty[l.sku] = (qty[l.sku] || 0) + l.qty; }); return qty; }
  // L10 Billing row: the same as shipping when there is no billing street or it matches.
  function billingSame(who) { return !who.billing.street || (who.billing.street === who.shipping.street && who.billing.city === who.shipping.city); }
  // A note without its "Next:" line (History shows that line on its own).
  function stripNext(body) { return String(body || '').replace(/\n\s*next(?: step)?\s*:[\s\S]*$/i, ''); }
  // A web-push key (base64url) as bytes.
  function b64ToBytes(s) {
    var p = '='.repeat((4 - s.length % 4) % 4);
    var raw = (typeof atob === 'function' ? atob : function (x) { return Buffer.from(x, 'base64').toString('binary'); })((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  var L = { MONTHS: MONTHS, LONG_DAYS: LONG_DAYS, LONG_MONTHS: LONG_MONTHS, esc: esc, nb: nb, ymd: ymd, addDays: addDays, shortDate: shortDate, longDate: longDate,
    ERR: ERR, errText: errText, initials: initials, money: money, ringDash: ringDash, fiftyTile: fiftyTile, dayLeftText: dayLeftText, winLine: winLine,
    candidatePill: candidatePill, productSub: productSub, visibleProducts: visibleProducts, draftTotals: draftTotals, sameAsLast: sameAsLast,
    billingSame: billingSame, stripNext: stripNext, b64ToBytes: b64ToBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  else root.MFLib = L;
})(this);
