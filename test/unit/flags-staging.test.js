// Feature switches (api/_flags.js) and staging Pulse (api/_staging.js, staging.js), data map risk #3 (2026-10-23).
// No database: the settings read is faked.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fakeFetch, fakeRes } = require('../helpers');
const F = require('../../api/_flags');
const S = require('../../api/_staging');

// A fake sql tag: answers the flags row (or throws), and counts the reads.
function fakeSql(value, opts) {
  const o = opts || {};
  const f = async (strings, ...vals) => {
    f.reads++;
    assert.match(strings.join('?'), /from settings where key = \?/);
    assert.deepEqual(vals, ['flags']);
    if (o.throws) throw new Error('relation "settings" does not exist');
    return value === undefined ? [] : [{ value }];
  };
  f.reads = 0;
  return f;
}

describe('flags: defaults', () => {
  beforeEach(F.clear);
  test('live features are on and the unbuilt one is off', () => {
    assert.deepEqual({ ...F.DEFAULTS }, { week_view: true, voice_notes: true, order_dispatch: true, claude_suggestions: false, friday_checkin: true, hubspot_pull: true, edge_alerts: false });
  });
  test('no row: the defaults', async () => assert.deepEqual(await F.all(fakeSql(undefined)), { ...F.DEFAULTS }));
  test('a database error: the defaults, never a crash', async () => assert.deepEqual(await F.all(fakeSql(null, { throws: true })), { ...F.DEFAULTS }));
  test('only true/false count; other values and junk rows leave the default', async () => {
    assert.deepEqual(F.merge({ week_view: 'no', voice_notes: 0, claude_suggestions: null }), { ...F.DEFAULTS });
    assert.deepEqual(F.merge([false]), { ...F.DEFAULTS });
    assert.deepEqual(F.merge('x'), { ...F.DEFAULTS });
  });
  test('a stored switch wins over its default', async () => {
    const f = await F.all(fakeSql({ voice_notes: false, claude_suggestions: true }));
    assert.equal(f.voice_notes, false);
    assert.equal(f.claude_suggestions, true);
    assert.equal(f.week_view, true, 'a key not in the row keeps its default');
  });
  test('on(): only an exact true is on', async () => {
    const sql = fakeSql({ week_view: false });
    assert.equal(await F.on(sql, 'week_view'), false);
    assert.equal(await F.on(sql, 'voice_notes'), true);
    assert.equal(await F.on(sql, 'no_such_switch'), false);
  });
});

describe('flags: cache', () => {
  let realNow;
  beforeEach(() => { F.clear(); realNow = Date.now; });
  afterEach(() => { Date.now = realNow; F.clear(); });
  test('read once, then served from memory until the 30 seconds are up', async () => {
    let t = 1000000; Date.now = () => t;
    const sql = fakeSql({ voice_notes: false });
    await F.all(sql); await F.on(sql, 'voice_notes'); await F.all(sql);
    assert.equal(sql.reads, 1);
    t += F.TTL_MS - 1; await F.all(sql);
    assert.equal(sql.reads, 1, 'still cached just before the end');
    t += 2; await F.all(sql);
    assert.equal(sql.reads, 2, 'read again after');
  });
  test('a switch flipped in the database is seen once the cache runs out', async () => {
    let t = 5000000; Date.now = () => t;
    assert.equal(await F.on(fakeSql({ week_view: true }), 'week_view'), true);
    assert.equal(await F.on(fakeSql({ week_view: false }), 'week_view'), true, 'cached');
    t += F.TTL_MS + 1;
    assert.equal(await F.on(fakeSql({ week_view: false }), 'week_view'), false, 'off now');
  });
  test('a failed read is cached too (no hammering a broken database)', async () => {
    let t = 9000000; Date.now = () => t;
    const sql = fakeSql(null, { throws: true });
    await F.all(sql); await F.all(sql);
    assert.equal(sql.reads, 1);
  });
});

describe('staging: off by default', () => {
  test('without STAGING=1 nothing is blocked and fetch passes through', async () => {
    delete process.env.STAGING;
    assert.equal(S.on(), false);
    assert.equal(S.blocked(), '');
    const seen = [];
    const g = S.wrap(async (u) => { seen.push(String(u)); return { ok: true }; });
    await g('https://renellence.app.n8n.cloud/webhook/x', { method: 'POST' });
    assert.deepEqual(seen, ['https://renellence.app.n8n.cloud/webhook/x']);
    S.refuseV2('postgres://x@db.' + S.V2_REF + '.supabase.co/postgres');   // production may use v2
  });
  test('the production page config says staging: false', async () => {
    delete process.env.STAGING;
    const res = fakeRes();
    await require('../../api/data')({ method: 'GET', url: '/api/data?op=config', headers: {} }, res);
    assert.equal(res.json().staging, false);
  });
});

describe('staging: STAGING=1', () => {
  let f;
  beforeEach(() => { process.env.STAGING = '1'; });
  afterEach(() => { delete process.env.STAGING; delete process.env.N8N_MYFIFTY_URL; if (f) f.restore(); f = null; });

  test('the page config says staging: true', async () => {
    const keep = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://tkgcinmmqbtdiqbhsgtk.supabase.co';
    try {
      const res = fakeRes();
      await require('../../api/data')({ method: 'GET', url: '/api/data?op=config', headers: {} }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().staging, true);
    } finally { if (keep === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = keep; }
  });

  test('a v2 address is refused, database and sign-in alike', async () => {
    assert.throws(() => S.refuseV2('postgres://x@db.' + S.V2_REF + '.supabase.co/postgres'), (e) => e.status === 503 && e.message === 'staging_points_at_v2');
    S.refuseV2('postgres://x@db.tkgcinmmqbtdiqbhsgtk.supabase.co/postgres');   // v1 is fine
    const keep = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://' + S.V2_REF + '.supabase.co';
    try {
      const res = fakeRes();
      await require('../../api/data')({ method: 'GET', url: '/api/data?op=config', headers: {} }, res);
      assert.equal(res.statusCode, 503);
    } finally { if (keep === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = keep; }
  });

  test('n8n is never called (orders, pay links, MD reminders)', async () => {
    process.env.N8N_MYFIFTY_URL = 'https://renellence.app.n8n.cloud/webhook/my-fifty';
    f = fakeFetch(() => ({ json: {} }));
    for (const a of ['order', 'resend_pay_link', 'remind_md']) assert.deepEqual(await require('../../api/_n8n').call(a, { orderId: 'x' }), { queued: false, reason: 'staging' });
    assert.equal(f.calls.length, 0);
  });

  test('no Gmail send and no phone notification', async () => {
    f = fakeFetch(() => ({ json: {} }));
    await assert.rejects(require('../../api/_gmail').send(null, { id: 'u' }, { to: 'a@b.c', subject: 's', text: 't' }), (e) => e.status === 409 && e.message === 'staging_no_outward');
    assert.deepEqual(await require('../../api/_push').notify(null, 'u', { kind: 'new_lead' }), { sent: 0, staging: true });
    assert.equal(f.calls.length, 0);
  });

  test('the fetch guard holds anything else that writes outside (the dispatcher\'s n8n call included)', async () => {
    const seen = [];
    const g = S.wrap(async (u) => { seen.push(String(u)); return { ok: true, status: 200, text: async () => '{}' }; });
    const held = await g('https://renellence.app.n8n.cloud/webhook/my-fifty', { method: 'POST', body: '{}' });
    assert.deepEqual(JSON.parse(await held.text()), { sandbox: true, staging: true }, 'answered like Edge\'s sandbox, which _dispatch.js treats as not sent');
    await g('https://api.openphone.com/v1/messages', { method: 'POST' });
    await g('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST' });
    assert.deepEqual(seen, [], 'nothing went out');
    await g('https://tkgcinmmqbtdiqbhsgtk.supabase.co/auth/v1/user');
    await g('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent', { method: 'POST' });
    await g('https://oauth2.googleapis.com/token', { method: 'POST' });
    assert.equal(seen.length, 3, 'sign-in, the voice-note model and Google tokens still work');
  });

  test('the dispatcher reads a held call as "not sent"', async () => {
    process.env.N8N_MYFIFTY_URL = 'https://renellence.app.n8n.cloud/webhook/my-fifty';
    const real = global.fetch;
    global.fetch = S.wrap(async () => { throw new Error('must not be called'); });
    try {
      const r = await require('../../api/_dispatch').post('o-1', 'pulse', 1, { timeout_ms: 1000 });
      assert.deepEqual(r, { ok: false, error: 'held_in_sandbox' });
    } finally { global.fetch = real; }
  });
});

describe('staging: admins only', () => {
  const Au = require('../../api/_auth');
  const dbm = require('../../api/_db');
  let f;
  // A fake database with one users row of the given kind, already linked to the Supabase account.
  const withUser = (kind) => dbm.setDb(async () => [{ id: 'u-1', email: 'pat@renellence.com', full_name: 'Pat Test', kind, is_active: true, preferences: {}, auth_user_id: 'a-1' }]);
  const req = () => ({ headers: { authorization: 'Bearer tok-' + Math.random() } });
  beforeEach(() => { f = fakeFetch(() => ({ json: { id: 'a-1', email: 'pat@renellence.com' } })); });
  afterEach(() => { f.restore(); dbm.setDb(null); Au._.seen.clear(); delete process.env.STAGING; });
  test('STAGING=1: a rep is refused, an admin signs in', async () => {
    process.env.STAGING = '1';
    withUser('rep');
    await assert.rejects(Au.signedIn(req()), (e) => e.status === 403 && e.message === 'staging_admins_only');
    withUser('admin');
    assert.equal((await Au.signedIn(req())).kind, 'admin');
  });
  test('production: a rep signs in as before', async () => {
    withUser('rep');
    assert.equal((await Au.signedIn(req())).kind, 'rep');
  });
});

describe('staging banner (staging.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'staging.js'), 'utf8');
  async function run(config) {
    const body = { children: [], style: {}, appendChild(el) { this.children.push(el); } };
    const doc = { title: 'My Fifty', body,
      getElementById: (id) => body.children.find((c) => c.id === id) || null,
      createElement: () => ({ style: {}, setAttribute(k, v) { this[k] = v; } }) };
    const ctx = { document: doc, fetch: async (u) => { assert.equal(u, '/api/data?op=config'); return { json: async () => config }; } };
    vm.runInNewContext(src, ctx);
    await new Promise((r) => setTimeout(r, 10));
    return doc;
  }
  test('staging: a "Staging · test data" strip on every screen and in the tab title', async () => {
    const d = await run({ staging: true });
    assert.equal(d.body.children.length, 1);
    assert.equal(d.body.children[0].textContent, 'Staging · test data');
    assert.match(d.body.children[0].style.cssText, /position:fixed/);
    assert.equal(d.title, 'STAGING · My Fifty');
  });
  test('staging: the page moves down by the strip, so it covers nothing (R3B-6)', async () => {
    const d = await run({ staging: true });
    assert.equal(d.body.style.paddingTop, '26px');
    assert.equal((await run({ staging: false })).body.style.paddingTop, undefined, 'production: unchanged');
  });
  test('production: nothing', async () => {
    assert.equal((await run({ staging: false })).body.children.length, 0);
    assert.equal((await run({})).body.children.length, 0);
  });
  test('index.html loads it, and it is never cached stale', () => {
    const root = path.join(__dirname, '..', '..');
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /<script src="\/staging.js"><\/script>/);
    assert.match(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'), /staging\.js\)"/);
  });
  test('every route turns the guard on first', () => {
    for (const r of ['data', 'act', 'cron', 'wire']) {
      const t = fs.readFileSync(path.join(__dirname, '..', '..', 'api', r + '.js'), 'utf8');
      assert.match(t, /^require\('\.\/_staging'\);/, r + '.js');
    }
  });
});
