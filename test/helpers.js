// Shared test helpers.
//
// Database tests run on the TEST database, Supabase v1 (Yousef 2026-10-22: v2 holds the real data now; see
// test/test-db.js and TEST_DATABASE_URL in .env.test), each one
// inside its own transaction that is ROLLED BACK at the end, so nothing a test writes is ever kept and the demo data
// is never changed. While a test runs, api/_db.js hands the code that transaction (its `begin` becomes a savepoint),
// so asUser() and the change_logs triggers behave exactly as in production.
//
// Fixtures make their own users, clinics, people and orders (fictional, never real names), so tests don't depend on
// the demo data either.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv();
// Never v2: the test database's address replaces every database address .env.local brought.
require('./test-db').useTestDb();
// Fixed, test-only secrets (never the real ones).
process.env.MYFIFTY_SECRET = 'test-secret-for-unit-tests-only';
process.env.CRON_SECRET = 'test-cron-key';

const dbm = require('../api/_db');
const ROLLBACK = new Error('rollback');

// Wraps a transaction so code that calls sql.begin() gets a savepoint inside it, and sql.end() does nothing.
function inTx(tx) {
  return new Proxy(tx, {
    get(t, p) {
      if (p === 'begin') return (fn) => t.savepoint(fn);
      if (p === 'end') return async () => {};
      return t[p];
    },
  });
}

// V2_PRACTICE_SQL=<migration file>: every test transaction first applies that migration (its begin/commit dropped) and
// is then rolled back as always, so the suite runs against the changed schema without changing v2 (2026-10-22, the
// naming migration db/v2-008: code and schema checked together before the real apply). Tests that open a second
// connection see the real schema, so they can only pass once the migration is applied for real.
function practiceSql() {
  const f = process.env.V2_PRACTICE_SQL;
  if (!f) return null;
  return require('fs').readFileSync(f, 'utf8').replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
}
let pool = null;
// Runs fn(sql) inside a transaction on the test database that is always rolled back.
async function withDb(fn) {
  pool = pool || dbm.db();
  let result;
  try {
    await pool.begin(async (tx) => {
      const practice = practiceSql();
      if (practice) { await tx`set local lock_timeout = '60s'`; await tx.unsafe(practice); }
      const sql = inTx(tx);
      dbm.setDb(sql);
      try { result = await fn(sql); } finally { dbm.setDb(pool); }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return result;
}
async function closeDb() { if (pool) { await pool.end({ timeout: 5 }); pool = null; } }

// ---- fixtures (all fictional) -------------------------------------------------------------------------
let n = 0;
const uid = () => (++n) + '-' + Math.random().toString(36).slice(2, 8);
const ago = (days, hours) => new Date(Date.now() - (days || 0) * 86400000 - (hours || 0) * 3600000);

async function user(sql, o = {}) {
  const [u] = await sql`insert into users (email, full_name, kind, is_active, preferences)
    values (${o.email || 'unit.' + uid() + '@test.invalid'}, ${o.name || 'Test Rep'}, ${o.kind || 'rep'}, ${o.active === false ? false : true}, ${sql.json(o.preferences || {})})
    returning id, email, full_name, kind, preferences`;
  return { id: u.id, email: u.email, name: u.full_name, first: u.full_name.split(' ')[0], initials: 'TR', kind: u.kind, preferences: u.preferences || {} };
}
// A Supabase sign-in account (auth.users) linked to the user, as Google sign-in would make. Rolled back like the rest.
async function authUser(sql, u) {
  const [a] = await sql`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email}, '{}'::jsonb, now(), now()) returning id`;
  await sql`update users set auth_user_id = ${a.id} where id = ${u.id}`;
  return a.id;
}
async function clinic(sql, o = {}) {
  const [c] = await sql`insert into clinics (name, street, city, province, postal_code) values (${o.name || 'Unit Clinic ' + uid()}, ${o.street || '1 Test St'}, ${o.city || 'Testville'}, 'ON', 'Z0Z 0Z0') returning id, name`;
  return c;
}
async function contact(sql, owner, o = {}) {
  const [c] = await sql`insert into contacts (owner_id, clinic_id, first_name, last_name, email, mobile_phone, role, designation, lead_source, lead_source_event_id,
      shipping_street, shipping_city, shipping_postal_code, billing_street, billing_city, is_medical_director, created_at)
    values (${o.owner === null ? null : (owner && owner.id) || owner}, ${o.clinicId || null}, ${o.first || 'Pat'}, ${o.last || 'Unit'}, ${o.email === undefined ? 'p.' + uid() + '@test.invalid' : o.email},
      ${o.phone || null}, ${o.role || null}, ${o.designation || null}, ${o.source || 'warm'}, ${o.eventId || null},
      ${o.shipStreet || '2 Test St'}, ${o.shipCity || 'Testville'}, ${o.shipPostal === undefined ? 'M5V 1A1' : o.shipPostal}, ${o.billStreet || null}, ${o.billCity || null}, ${o.md || null}, ${o.createdAt || new Date()})
    returning id`;
  return c.id;
}
// lines: [[sku, qty, free?]]. o: { rep, status, method, paid (true writes a succeeded payment), days, shipped, delivered, mdId, mdSigned, approved }
async function order(sql, contactId, rep, o = {}) {
  const placed = ago(o.days || 0);
  const [r] = await sql`insert into orders (contact_id, rep_id, placed_by_id, channel, status, submitted_at, approved_at, payment_method, shipped_at, delivered_at, medical_director_contact_id, medical_director_signed_at, created_at)
    values (${contactId}, ${(rep && rep.id) || rep}, ${(rep && rep.id) || rep}, 'stripe', ${o.status || 'submitted'}, ${placed}, ${o.approved ? placed : null}, ${o.method || null},
      ${o.shipped != null ? ago(o.shipped) : null}, ${o.delivered != null ? ago(o.delivered) : null}, ${o.mdId || null}, ${o.mdSigned ? placed : null}, ${placed})
    returning id`;
  for (const [sku, qty, free] of o.lines || [['SAF100', 2]]) {
    await sql`insert into order_lines (order_id, product_id, product_sku, product_name, quantity, unit_price, list_price, is_free)
      select ${r.id}, id, sku, name, ${qty}, ${free ? 0 : sql`list_price`}, list_price, ${!!free} from products where sku = ${sku}`;
  }
  if (o.paid) {
    await sql`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test, card_brand, card_last4)
      values (${r.id}, 'charge', ${o.method || 'card_on_file'}, 100, 'CAD', 'succeeded', 'stripe', ${o.paidAt || placed}, ${o.testPayment || false}, ${o.brand || null}, ${o.last4 || null})`;
  }
  return r.id;
}
async function touch(sql, contactId, userId, o = {}) {
  const [i] = await sql`insert into interactions (kind, contact_id, user_id, occurred_at, direction, mode, status, outcome, body, subject, source, created_by_id)
    values (${o.kind || 'call'}, ${contactId}, ${userId}, ${o.at || ago(o.days || 0, o.hours || 0)}, 'out', ${o.mode || (o.kind === 'meeting' ? 'in_person' : o.kind === 'call' || !o.kind ? 'phone' : null)},
      ${o.status || 'completed'}, ${o.outcome === undefined ? 'connected' : o.outcome}, ${o.body || null}, ${o.subject || null}, ${o.source || 'my_fifty'}, ${userId})
    returning id`;
  return i.id;
}
async function task(sql, contactId, userId, o = {}) {
  const [t] = await sql`insert into tasks (contact_id, assignee_id, created_by_id, title, kind, due_at, status, source, from_interaction_id)
    values (${contactId}, ${userId}, ${userId}, ${o.title || 'Follow up'}, ${o.kind || o.type || 'call'}, ${o.due || new Date()}, ${o.status || 'open'}, 'manual', ${o.from || null}) returning id`;
  return t.id;
}

// ---- fakes for outside services ------------------------------------------------------------------------
// Replaces global fetch. handler(url, init) -> { status, json } | { status, text } | throws. Records every call.
function fakeFetch(handler) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {}, body: init && init.body });
    const r = await handler(String(url), init || {});
    const status = r.status || 200;
    const text = r.text !== undefined ? r.text : JSON.stringify(r.json === undefined ? {} : r.json);
    return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
  };
  return { calls, restore() { global.fetch = real; } };
}

// A minimal response object for route handlers.
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b) => { res.body = b; res.done = true; };
  res.json = () => JSON.parse(res.body);
  return res;
}

const rejects = async (p, message) => { await assert.rejects(p, (e) => { assert.equal(e.message, message); return true; }); };

module.exports = { practiceSql, withDb, closeDb, user, authUser, clinic, contact, order, touch, task, ago, uid, fakeFetch, fakeRes, rejects, inTx };
