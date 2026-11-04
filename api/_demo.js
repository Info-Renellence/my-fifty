// The test account (owner 2026-11-04): admin@renellence.com is not an admin in Edge or Pulse but a rep on made-up data,
// and nothing it does reaches the real world: no v2 (Supabase), no n8n, Stripe, SignatureAPI, Gmail, texts or pushes.
//
// How: every signed-in route (api/data.js, api/act.js) runs each request inside run(). Once sign-in finds a test email, enter() switches that
// request to an in-memory Postgres (PGlite) holding v2's structure (db/demo/schema.sql), the product catalogue and
// settings (db/demo/reference.sql) and a made-up book for admin@ (scripts/seed-demo.js, db/demo/edge-rows.sql). db()
// (api/_db.js) hands out that database for the rest of the request, and every outgoing fetch is answered here with
// 200 { sandbox: true, demo: true }, which the callers already treat as "held, not sent".
// Owner's choice: in memory only. Each server copy builds its own book when it starts, so what the test account changes
// lasts while that copy runs and is gone after.
// A copy of renellence-edge api/_edge/demo.js; keep the two in step.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const EMAILS = new Set(['admin@renellence.com']);
const USER_ID = 'de0000ad-0000-4000-8000-000000000001';
const DIR = path.join(__dirname, '..', 'db');

const als = new AsyncLocalStorage();
const isTestEmail = (email) => EMAILS.has(String(email || '').toLowerCase());
// Runs one request; enter() inside it switches that request (and only it) to the test database.
const run = (fn) => als.run({ demo: false }, fn);
const active = () => { const s = als.getStore(); return !!(s && s.demo); };

// The database for this request while it is in test mode (the open transaction first), else null.
function current() {
  const s = als.getStore();
  return s && s.demo ? s.tx || s.db : null;
}
// Inside a test-mode transaction, plain db() calls use that transaction: the in-memory database has one connection,
// so a second one would wait for the transaction forever.
function inTx(tx, fn) {
  const s = als.getStore();
  return s && s.demo ? als.run(Object.assign({}, s, { tx }), fn) : fn();
}

let ready = null;
function open(options) {
  if (!ready) ready = start(options).catch((e) => { ready = null; throw e; });
  return ready;
}

async function start(options) {
  const { PGlite } = require('@electric-sql/pglite');
  const { citext } = require('@electric-sql/pglite/contrib/citext');
  const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
  const t0 = Date.now();
  const pg = await PGlite.create({ extensions: { citext } });
  await pg.exec(fs.readFileSync(path.join(DIR, 'demo', 'schema.sql'), 'utf8'));
  await pg.exec(fs.readFileSync(path.join(DIR, 'demo', 'reference.sql'), 'utf8'));
  await pg.exec(`insert into users (id, email, full_name, kind, is_active, language_code)
    values ('${USER_ID}', 'admin@renellence.com', 'Test Account', 'rep', true, 'en')`);
  await pg.exec(require('../scripts/seed-demo'));
  await pg.exec(fs.readFileSync(path.join(DIR, 'demo', 'edge-rows.sql'), 'utf8'));
  const server = new PGLiteSocketServer({ db: pg, port: 0, host: '127.0.0.1' });
  await server.start();
  const [host, port] = server.getServerConn().split(':');
  const postgres = require('postgres');
  const sql = postgres(Object.assign({}, options, { host, port: Number(port), database: 'postgres', username: 'postgres', password: 'x', max: 1, ssl: false }));
  console.log('DEMO_DB_READY', Date.now() - t0, 'ms');
  parts = { sql, server, pg };
  return sql;
}

// Tests: shut the in-memory database so the process can end.
let parts = null;
async function close() {
  if (!parts) return;
  const p = parts; parts = null; ready = null;
  await p.sql.end({ timeout: 1 }); await p.server.stop(); await p.pg.close();
}

// Sign-in found a test email: this request uses the test database from here on.
async function enter(options) {
  const s = als.getStore();
  if (!s) { const e = new Error('demo_outside_request'); e.status = 500; throw e; }
  s.db = await open(options);
  s.demo = true;
}

// Every outgoing call made for the test account is held. Calls for everyone else pass straight through.
function wrap(real) {
  return function demoFetch(url) {
    if (!active()) return real.apply(this, arguments);
    let host = '';
    try { host = new URL(url && typeof url === 'object' && url.url ? url.url : String(url)).hostname; } catch (e) { /* not a URL */ }
    console.log('DEMO_HELD', host);   // the host only, never the address or the body
    return Promise.resolve(new Response(JSON.stringify({ sandbox: true, demo: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
}
let installed = false;
function install() {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  globalThis.fetch = wrap(globalThis.fetch);
}
install();

module.exports = { EMAILS, USER_ID, isTestEmail, run, active, current, inTx, enter, open, close, wrap, install };
