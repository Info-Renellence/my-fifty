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
    already_yours: 'This person is already in your book.', email_yours: 'Someone in your book already has this email.', email_someones: 'Someone in another rep’s book already has this email.', already_someones: 'This person is already in someone else’s book.',
    no_products: 'Add products first.', md_required: 'Add the medical director’s name and email.', not_ready_to_order: 'They need to finish onboarding before ordering.',
    no_shipping_address: 'Add a shipping address before sending this order.', address_required: 'Add the street and city.',
    voice_not_set_up: 'Voice notes aren’t set up yet. Tap Type.', recording_too_long: 'That recording is too long. Try a shorter one.',
    gmail_not_connected: 'Connect Gmail first.', gmail_reconnect: 'Gmail needs to be connected again.', reminded_recently: 'Already reminded in the last hour.', resent_recently: 'Pay link already resent in the last hour.',
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
  // The MY FIFTY tile (L2): 10 dots ending at the next milestone, one per real person (with fewer than 10 people
  // the dots start at the first person, so no dot is ever filled for someone who does not exist; F11).
  function fiftyTile(count, next) {
    var toNext = Math.max(0, next - count);
    return { toNext: toNext, filled: Math.max(0, Math.min(10, count - Math.max(0, next - 10))) };
  }
  // L2 under the ring.
  function dayLeftText(done, goal) { var left = Math.max(0, goal - done); return left ? left + ' more and today is done' : 'Today is done'; }
  // L4's sentence.
  function winLine(name, followUp, done, goal) {
    var left = Math.max(0, goal - done);
    return 'Logged for ' + name + '. Follow-up saved for ' + followUp + '. ' + (left ? left + ' more ' + (left === 1 ? 'finishes' : 'finish') + ' today.' : 'Today is done.');
  }
  // L6 Candidates pill: days since the samples arrived (Yousef 2026-10-20: no "Ask now").
  function candidatePill(days) { return days == null ? 'Not shipped' : days + (days === 1 ? ' day' : ' days'); }
  // L9 product step (the mockup's New order): a line's price is the rep's price, or the list price.
  function priceOf(p, draft) { var v = draft.price && draft.price[p.sku]; return v != null ? v : p.price; }
  // What the rep typed in a price box: a number of dollars (cents kept), never below 0; junk is 0.
  function parsePrice(s) { var v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return isNaN(v) ? 0 : Math.round(v * 100) / 100; }
  // The paid-quantity picker on the product step (Yousef 2026-10-22): 0 to 100 in the list, plus the current
  // quantity when it is above 100 so it still shows; "More than 100…" opens a box for a typed number.
  var QTY_LIST_MAX = 100, QTY_MAX = 999;   // QTY_MAX = the per-line cap the server enforces (act.js "too_many")
  function qtyOptions(current) {
    var out = [];
    for (var i = 0; i <= QTY_LIST_MAX; i++) out.push(i);
    var c = Number(current) || 0;
    if (c > QTY_LIST_MAX && c % 1 === 0) out.push(c);
    return out;
  }
  // A typed quantity: a whole number from 0 to the cap, else null (the box goes back to what it was).
  function parseQty(s) {
    var t = String(s == null ? '' : s).trim();
    if (!/^\d+$/.test(t)) return null;
    var v = parseInt(t, 10);
    return v <= QTY_MAX ? v : null;
  }
  // The bottom bar: paid items and money, free units, and whether it is a sample order (only free units: MD signs).
  function draftSummary(products, draft) {
    var paid = 0, free = 0, total = 0;
    products.forEach(function (p) {
      var q = (draft.qty && draft.qty[p.sku]) || 0, f = (draft.free && draft.free[p.sku]) || 0, pr = priceOf(p, draft);
      if (q) { if (p.freeOnly || !(pr > 0)) free += q; else { paid += q; total += q * pr; } }
      free += f;
    });
    var samples = paid === 0 && free > 0;
    return { paid: paid, free: free, total: Math.round(total * 100) / 100, samples: samples, empty: paid + free === 0,
      line: samples ? free + ' free sample' + (free === 1 ? '' : 's') : paid + (paid === 1 ? ' item' : ' items') + ' · ' + money(total),
      sub: samples ? 'MD signs after approval' : free ? '+ ' + free + ' free' : 'Paid order' };
  }
  // L10 Billing row: the same as shipping when there is no billing street or it matches.
  function billingSame(who) { return !who.billing.street || (who.billing.street === who.shipping.street && who.billing.city === who.shipping.city); }
  // History (RD12, Yousef 2026-10-23): a note or email longer than about three lines on a phone shows its first lines
  // with "More" / "Less".
  function longText(text) { var t = String(text || ''); return t.length > 180 || t.split('\n').length > 3; }
  // A note without its "Next:" line (History shows that line on its own).
  function stripNext(body) { return String(body || '').replace(/(?:^|\n)\s*next(?: step)?\s*:[\s\S]*$/i, ''); }
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
    candidatePill: candidatePill, priceOf: priceOf, parsePrice: parsePrice, draftSummary: draftSummary,
    QTY_LIST_MAX: QTY_LIST_MAX, QTY_MAX: QTY_MAX, qtyOptions: qtyOptions, parseQty: parseQty,
    billingSame: billingSame, stripNext: stripNext, longText: longText, b64ToBytes: b64ToBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  else root.MFLib = L;
})(this);
