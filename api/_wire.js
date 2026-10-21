// Wire orders: sold when placed, collected later (Yousef 2026-10-21). One pending wire payment row is written when
// the order is placed; an admin marks it received (api/wire.js), which makes it succeeded with paid_at = the day the
// money arrived. The due date is worked out, never stored: invoice date (or the order date before invoicing) + the
// order's terms (orders.payment_terms_days, copied from the customer or the standard terms when it was placed).
//
// Follow-up (GET /api/cron?op=wires, called once a day by n8n): a heads-up to the rep 5 days before the due date,
// and once overdue an email to info@ and the rep, on day 1 and then every 7 days until it is received.
const crypto = require('crypto');
const T = require('./_time');

const DEFAULT_TERMS = 30;
const HEADS_UP_DAYS = 5;
const OVERDUE_EVERY = 7;
const LINK_DAYS = 30;

// The standard terms (settings 'payments'.default_terms_days).
async function defaultTerms(sql) {
  const [r] = await sql`select value from settings where key = ${'payments'}`;   // every query carries a value (F12)
  const n = r && r.value && Number(r.value.default_terms_days);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TERMS;
}

// The terms for a new wire order to this customer: theirs, or the standard.
async function termsFor(sql, contactId) {
  const [c] = await sql`select payment_terms_days from contacts where id = ${contactId}`;
  return c && Number.isInteger(c.payment_terms_days) ? c.payment_terms_days : defaultTerms(sql);
}

// Where a wire order stands. o: { payment_method, submitted_at, invoiced_at, created_at, payment_terms_days };
// pay: its wire payment row ({ status, paid_at }) or null. terms falls back to the standard (orders placed before
// terms existed).
function state(o, pay, fallbackTerms, now) {
  if (!o || o.payment_method !== 'wire') return null;
  const terms = Number.isInteger(o.payment_terms_days) ? o.payment_terms_days : (fallbackTerms == null ? DEFAULT_TERMS : fallbackTerms);
  const from = o.invoiced_at || o.submitted_at || o.created_at;
  const due = T.addDays(T.ymd(from), terms);
  const today = T.ymd(now || Date.now());
  const days = Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(due + 'T12:00:00Z')) / T.DAY);
  const dueText = T.short(due + 'T12:00:00Z');
  if (pay && pay.status === 'succeeded') {
    return { status: 'received', due, terms, receivedAt: pay.paid_at, text: 'Wire · received ' + T.short(pay.paid_at) };
  }
  if (days > 0) return { status: 'overdue', due, terms, daysLate: days, text: 'Wire · ' + days + (days === 1 ? ' day' : ' days') + ' overdue' };
  return { status: 'open', due, terms, daysToDue: -days, text: 'Wire · due ' + dueText };
}

// Today's follow-up for one open wire: 'heads_up' 5 days before the due date, 'overdue' on day 1 late and every 7
// days after, otherwise nothing.
function followUp(s) {
  if (!s || s.status === 'received') return null;
  if (s.status === 'open' && s.daysToDue === HEADS_UP_DAYS) return 'heads_up';
  if (s.status === 'overdue' && (s.daysLate - 1) % OVERDUE_EVERY === 0) return 'overdue';
  return null;
}

// "Mark as received" links: signed with a key derived from MYFIFTY_SECRET, for one order and one admin, valid 30 days.
function sign(orderId, userId, exp) {
  const key = require('./_crypto').derive('wire-received');
  return crypto.createHmac('sha256', key).update(orderId + '.' + userId + '.' + exp).digest('base64url');
}
function link(base, orderId, userId, now) {
  const exp = Math.floor((now || Date.now()) / 1000) + LINK_DAYS * 86400;
  return base.replace(/\/$/, '') + '/api/wire?o=' + orderId + '&u=' + userId + '&e=' + exp + '&s=' + sign(orderId, userId, exp);
}
function verify(q, now) {
  const o = String(q.o || ''), u = String(q.u || ''), e = Number(q.e), s = String(q.s || '');
  if (!o || !u || !Number.isInteger(e) || !s) return false;
  if (e * 1000 < (now || Date.now())) return false;
  const want = Buffer.from(sign(o, u, e)), got = Buffer.from(s);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

module.exports = { DEFAULT_TERMS, HEADS_UP_DAYS, OVERDUE_EVERY, defaultTerms, termsFor, state, followUp, sign, link, verify };
