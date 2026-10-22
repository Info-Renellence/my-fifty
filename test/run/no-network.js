// Test-run guard (2026-10-21): nothing may leave this computer except to the test database (Supabase v1 since 2026-10-22).
// Preload it in every test process:   node --require ./test/run/no-network.js <script>
//
// It wraps fetch, http(s).request/get and raw sockets (net/tls connect, which postgres and web-push use).
// Allowed hosts: localhost / 127.0.0.1 / ::1, and the test database only (Supabase v1, tkgcinmmqbtdiqbhsgtk, and its
// connection pooler). Anything else throws NETWORK_BLOCKED before a single byte is sent.
// Tests that stub fetch on purpose (helpers.fakeFetch) replace global.fetch for themselves; the socket and
// http guards stay underneath, so even a stub that forgot to stub still cannot reach the internet.
'use strict';
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');

const PROJECT = 'tkgcinmmqbtdiqbhsgtk';   // v1, the test database (was v2 until 2026-10-22). The pooler host is shared,
// so test/test-db.js also refuses any v2 address.
const ALLOWED = [
  /^localhost$/i, /^127\.0\.0\.1$/, /^::1$/, /^\[::1\]$/,
  new RegExp('^' + PROJECT + '\\.supabase\\.co$', 'i'),
  /^aws-0-us-east-1\.pooler\.supabase\.com$/i,
  new RegExp('^db\\.' + PROJECT + '\\.supabase\\.co$', 'i'),
];
const blocked = [];
function allowed(host) { return ALLOWED.some((r) => r.test(String(host || '').trim())); }
function refuse(host, how) {
  blocked.push({ host: String(host), how, at: new Date().toISOString() });
  const e = new Error('NETWORK_BLOCKED: ' + how + ' to ' + host + ' is not allowed during the test run');
  e.code = 'NETWORK_BLOCKED';
  return e;
}
function hostOf(x) {
  try {
    if (x instanceof URL) return x.hostname;
    if (typeof x === 'string') return new URL(x).hostname;
    if (x && typeof x === 'object' && typeof x.url === 'string') return new URL(x.url).hostname; // Request
  } catch (e) { /* fall through */ }
  return '';
}

// fetch
const realFetch = global.fetch;
const guardedFetch = async function (input, init) {
  const host = hostOf(input);
  if (!allowed(host)) throw refuse(host || String(input), 'fetch');
  return realFetch(input, init);
};
global.fetch = guardedFetch;

// http / https
function wrapReq(mod, name) {
  for (const fn of ['request', 'get']) {
    const real = mod[fn];
    mod[fn] = function (a, b, c) {
      let host = '';
      if (typeof a === 'string' || a instanceof URL) host = hostOf(a);
      else if (a && typeof a === 'object') host = a.hostname || String(a.host || '').replace(/:\d+$/, '');
      if (!host) host = 'localhost';
      if (!allowed(host)) throw refuse(host, name + '.' + fn);
      return real.call(this, a, b, c);
    };
  }
}
wrapReq(http, 'http');
wrapReq(https, 'https');

// raw sockets (postgres driver, web-push's https agent underneath, anything else)
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let opts = args[0];
  let host = 'localhost';
  if (Array.isArray(opts)) opts = opts[0];
  if (opts && typeof opts === 'object') host = opts.host || opts.hostname || (opts.path ? 'localhost' : 'localhost');
  else if (typeof args[1] === 'string') host = args[1];
  if (!allowed(host)) {
    const e = refuse(host, 'socket');
    process.nextTick(() => this.destroy(e));
    return this;
  }
  return realConnect.apply(this, args);
};
const realTls = tls.connect;
tls.connect = function (...args) {
  const o = args.find((x) => x && typeof x === 'object') || {};
  const host = o.host || o.servername || (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (!allowed(host)) throw refuse(host, 'tls');
  return realTls.apply(this, args);
};

global.__NETWORK_GUARD__ = { allowed, blocked, guardedFetch };
if (!process.env.NO_NETWORK_QUIET) process.stderr.write('[no-network] guard on: only localhost and Supabase v2 (' + PROJECT + ') may be reached\n');
