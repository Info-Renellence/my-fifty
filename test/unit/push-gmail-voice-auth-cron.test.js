// Pure parts of api/_push.js, api/_gmail.js, api/_voice.js, api/_auth.js and api/cron.js (outside services faked).
const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { fakeFetch } = require('../helpers');
const P = require('../../api/_push');
const Gm = require('../../api/_gmail');
const V = require('../../api/_voice');
const Au = require('../../api/_auth');
const Cr = require('../../api/cron')._;

let f;
afterEach(() => { if (f) f.restore(); f = null; mock.timers.reset(); });

describe('push', () => {
  test('VAPID keys come from the secret and stay the same', () => {
    const k = P.vapid();
    assert.match(k.publicKey, /^[A-Za-z0-9_-]{87}$/);
    assert.deepEqual(P.vapid(), k);
  });
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BKEY', auth: 'AUTH' } };
  test('a real subscription is kept, extra fields dropped', () => assert.deepEqual(P.cleanSubscription(Object.assign({ expirationTime: null }, good)), good));
  test('bad subscriptions are refused', () => {
    assert.equal(P.cleanSubscription(null), null);
    assert.equal(P.cleanSubscription({ endpoint: 'http://insecure.example/x', keys: good.keys }), null);
    assert.equal(P.cleanSubscription({ endpoint: good.endpoint, keys: {} }), null);
    assert.equal(P.cleanSubscription({ endpoint: good.endpoint, keys: { p256dh: 'x'.repeat(201), auth: 'a' } }), null);
    assert.equal(P.cleanSubscription('nope'), null);
  });
  test('deviceId is short, stable, and differs per phone', () => {
    assert.equal(P.deviceId('a').length, 20);
    assert.equal(P.deviceId('a'), P.deviceId('a'));
    assert.notEqual(P.deviceId('a'), P.deviceId('b'));
  });
});

describe('gmail parsing', () => {
  const G = Gm._;
  test('addrs finds every address, in lower case', () => assert.deepEqual(G.addrs('Maya <Maya@Clinic.ca>, bob@x.com'), ['maya@clinic.ca', 'bob@x.com']));
  test('addrs of nothing', () => assert.deepEqual(G.addrs(''), []));
  test('hdr reads a header by name, any case', () => {
    const m = { payload: { headers: [{ name: 'Subject', value: 'Hi' }] } };
    assert.equal(G.hdr(m, 'subject'), 'Hi');
    assert.equal(G.hdr(m, 'From'), '');
    assert.equal(G.hdr({}, 'From'), '');
  });
  test('bodyText finds the plain-text part, however deep', () => {
    const data = Buffer.from('Hello there').toString('base64');
    assert.equal(G.bodyText({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/html', body: {} }, { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data } }] }] }), 'Hello there');
    assert.equal(G.bodyText(null), '');
    assert.equal(G.bodyText({ mimeType: 'text/html', body: { data } }), '');
  });
  test('header removes line breaks (no header injection)', () => assert.equal(G.header('a\r\nBcc: evil@x.com'), 'a Bcc: evil@x.com'));
  test('encodeWord leaves plain text and encodes accents', () => {
    assert.equal(G.encodeWord('Hello'), 'Hello');
    assert.equal(G.encodeWord('Café'), '=?UTF-8?B?' + Buffer.from('Café').toString('base64') + '?=');
  });
  test('robots and notices are recognised', () => {
    for (const a of ['no-reply@clinic.ca', 'noreply@x.com', 'notifications@app.com', 'mailer-daemon@googlemail.com', 'billing@stripe.com']) assert.match(a, G.ROBOT);
    assert.doesNotMatch('maya@clinic.ca', G.ROBOT);
  });
  test('accessToken trades the refresh token', async () => {
    f = fakeFetch(() => ({ json: { access_token: 'at-1' } }));
    assert.equal(await G.accessToken('rt'), 'at-1');
    assert.match(f.calls[0].body.toString(), /refresh_token=rt/);
  });
  test('a revoked refresh token asks to reconnect', async () => {
    f = fakeFetch(() => ({ status: 400, json: { error: 'invalid_grant' } }));
    await assert.rejects(G.accessToken('rt'), (e) => e.message === 'gmail_reconnect' && e.status === 409);
  });
  test('another token failure is a 502', async () => {
    f = fakeFetch(() => ({ status: 500, json: {} }));
    await assert.rejects(G.accessToken('rt'), (e) => e.message === 'gmail_token_failed' && e.status === 502);
  });
  test('gget returns null on 404 and throws on other errors', async () => {
    f = fakeFetch((url) => (/missing/.test(url) ? { status: 404 } : /broken/.test(url) ? { status: 500 } : { json: { ok: 1 } }));
    assert.equal(await G.gget('at', 'missing'), null);
    await assert.rejects(G.gget('at', 'broken'), (e) => e.message === 'gmail_read_failed');
    assert.deepEqual(await G.gget('at', 'fine'), { ok: 1 });
  });
});

describe('voice prompt', () => {
  const x = {
    c: { first_name: 'Maya', last_name: 'Sample', role: 'physician', clinic: 'Sample Clinic B', city: 'Testville', fillers: ['saypha', 'restylane'], prp: ['eclipse_prp'] },
    others: [{ first_name: 'Lee', last_name: 'Sample' }],
    recent: [{ kind: 'call', occurred_at: new Date('2026-10-15T13:00:00Z'), body: 'Left a voicemail.' }],
    lines: [{ product_name: 'saypha® lips Lidocaine 1 ml' }],
    products: [{ name: 'saypha® filler Lidocaine 1 ml' }],
  };
  test('carries the person, clinic, colleagues, what they use, recent notes and products', () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T15:00:00Z') });
    const p = V._prompt({ name: 'Test Rep' }, x);
    for (const s of ['Maya Sample, physician', 'Sample Clinic B (Testville)', 'Lee Sample', 'saypha, Restylane', 'Eclipse PRP', 'Left a voicemail.', 'saypha® lips Lidocaine 1 ml', 'saypha® filler Lidocaine 1 ml', 'Test Rep', 'today is 2026-10-20, Tuesday']) {
      assert.ok(p.includes(s), 'missing: ' + s);
    }
  });
  test('says to use the details only to fix spelling, never to add facts', () => assert.match(V._prompt({ name: 'R' }, x), /never add facts/));
  test('leaves out what we do not know', () => {
    const p = V._prompt({ name: 'R' }, { c: { first_name: 'A', last_name: 'B', role: 'other', fillers: [], prp: [] }, others: [], recent: [], lines: [], products: [] });
    assert.doesNotMatch(p, /Clinic:|Fillers they use|Recent notes/);
    assert.match(p, /Person: A B\n/);
  });
});

describe('auth: the Supabase check', () => {
  test('a good token returns the Supabase user, and is cached', async () => {
    process.env.SUPABASE_URL = 'https://sb.test';
    f = fakeFetch(() => ({ json: { id: 'u1', email: 'a@renellence.com' } }));
    const tok = 'tok-' + Math.random();
    assert.equal((await Au._.supabaseUser(tok)).id, 'u1');
    await Au._.supabaseUser(tok);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://sb.test/auth/v1/user');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer ' + tok);
  });
  test('a bad token returns nothing and is not cached', async () => {
    f = fakeFetch(() => ({ status: 401 }));
    const tok = 'bad-' + Math.random();
    assert.equal(await Au._.supabaseUser(tok), null);
    await Au._.supabaseUser(tok);
    assert.equal(f.calls.length, 2);
  });
  test('initials', () => { assert.equal(Au.initials('Yousef Kamel'), 'YK'); assert.equal(Au.initials(''), ''); });
  test('no Authorization header is signed out', async () => {
    await assert.rejects(Au.signedIn({ headers: {} }), (e) => e.status === 401 && e.message === 'signed_out');
  });
  test('a token Supabase rejects is signed out', async () => {
    f = fakeFetch(() => ({ status: 401 }));
    await assert.rejects(Au.signedIn({ headers: { authorization: 'Bearer nope-' + Math.random() } }), (e) => e.status === 401);
  });
  test('a non-renellence Google account is refused', async () => {
    f = fakeFetch(() => ({ json: { id: 'u2', email: 'someone@gmail.com' } }));
    await assert.rejects(Au.signedIn({ headers: { authorization: 'Bearer g-' + Math.random() } }), (e) => e.status === 403 && e.message === 'not_renellence');
  });
  test('an unverified renellence email is refused', async () => {
    f = fakeFetch(() => ({ json: { id: 'u3', email: 'x@renellence.com', user_metadata: { email_verified: false } } }));
    await assert.rejects(Au.signedIn({ headers: { authorization: 'Bearer v-' + Math.random() } }), (e) => e.message === 'not_renellence');
  });
});

describe('cron: the timer key', () => {
  test('the right key in X-Cron-Key or Authorization is allowed', () => {
    assert.equal(Cr.authorised({ headers: { 'x-cron-key': 'test-cron-key' } }), true);
    assert.equal(Cr.authorised({ headers: { authorization: 'Bearer test-cron-key' } }), true);
  });
  test('a wrong, partial or missing key is refused', () => {
    assert.equal(Cr.authorised({ headers: { 'x-cron-key': 'test-cron-kez' } }), false);
    assert.equal(Cr.authorised({ headers: { 'x-cron-key': 'test' } }), false);
    assert.equal(Cr.authorised({ headers: {} }), false);
  });
  test('with no key configured nothing is allowed', () => {
    const keep = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
    try { assert.equal(Cr.authorised({ headers: { 'x-cron-key': '' } }), false); } finally { process.env.CRON_SECRET = keep; }
  });
});
