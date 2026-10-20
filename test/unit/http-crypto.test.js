// api/_http.js (request and response helpers) and api/_crypto.js (secrets at rest).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { fakeRes } = require('../helpers');
const H = require('../../api/_http');
const C = require('../../api/_crypto');

describe('send', () => {
  test('writes JSON with the status and no caching', () => {
    const res = fakeRes();
    H.send(res, 201, { ok: true });
    assert.equal(res.statusCode, 201);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.json(), { ok: true });
  });
});

describe('body', () => {
  test('uses an already-parsed object', async () => assert.deepEqual(await H.body({ body: { a: 1 } }), { a: 1 }));
  test('parses a JSON string body', async () => assert.deepEqual(await H.body({ body: '{"a":2}' }), { a: 2 }));
  test('a bad JSON string becomes an empty object', async () => assert.deepEqual(await H.body({ body: '{nope' }), {}));
  test('reads a streamed body', async () => assert.deepEqual(await H.body(Readable.from([Buffer.from('{"a":'), Buffer.from('3}')])), { a: 3 }));
  test('an empty stream is an empty object', async () => assert.deepEqual(await H.body(Readable.from([])), {}));
  test('a bad streamed body is an empty object', async () => assert.deepEqual(await H.body(Readable.from([Buffer.from('x')])), {}));
});

describe('query', () => {
  test('reads the query string', () => assert.equal(H.query({ url: '/api/data?op=today&id=5' }).get('op'), 'today'));
});

describe('route', () => {
  test('passes a normal answer through', async () => {
    const res = fakeRes();
    await H.route(async (req, r) => H.send(r, 200, { fine: 1 }))({ method: 'GET', url: '/' }, res);
    assert.deepEqual(res.json(), { fine: 1 });
  });
  test('an error with a status becomes that status and its message', async () => {
    const res = fakeRes();
    await H.route(async () => { throw H.fail(404, 'not_found', 'gone'); })({ method: 'GET', url: '/' }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: 'not_found', detail: 'gone' });
  });
  test('an unexpected error becomes a 500', async () => {
    const res = fakeRes();
    const err = console.error; console.error = () => {};
    try { await H.route(async () => { throw new Error('boom'); })({ method: 'GET', url: '/' }, res); } finally { console.error = err; }
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error, 'boom');
  });
  test('a nonsense status is treated as a 500', async () => {
    const res = fakeRes();
    const err = console.error; console.error = () => {};
    try { await H.route(async () => { const e = new Error('x'); e.status = 999; throw e; })({ method: 'GET', url: '/' }, res); } finally { console.error = err; }
    assert.equal(res.statusCode, 500);
  });
});

describe('fail, isUuid, clean', () => {
  test('fail makes an error with a status and detail', () => {
    const e = H.fail(409, 'dupe', 'abc');
    assert.equal(e.status, 409); assert.equal(e.message, 'dupe'); assert.equal(e.detail, 'abc');
  });
  test('fail without detail has none', () => assert.equal(H.fail(400, 'x').detail, undefined));
  test('isUuid accepts a uuid in any case', () => {
    assert.equal(H.isUuid('de000000-0000-4000-8000-000000000022'), true);
    assert.equal(H.isUuid('DE000000-0000-4000-8000-000000000022'), true);
  });
  test('isUuid refuses anything else', () => {
    for (const x of ['', null, undefined, '123', 'de000000-0000-4000-8000-00000000002', "1' or '1'='1"]) assert.equal(H.isUuid(x), false);
  });
  test('clean trims, drops carriage returns and cuts to length', () => {
    assert.equal(H.clean('  a\r\nb  ', 10), 'a\nb');
    assert.equal(H.clean('abcdef', 3), 'abc');
    assert.equal(H.clean(null), '');
    assert.equal(H.clean('x'.repeat(600)).length, 500);
  });
});

describe('seal and open', () => {
  test('round-trips text', () => assert.equal(C.open(C.seal('refresh-token-123')), 'refresh-token-123'));
  test('round-trips unicode', () => assert.equal(C.open(C.seal('saypha® é')), 'saypha® é'));
  test('the same text seals differently each time', () => assert.notEqual(C.seal('a'), C.seal('a')));
  test('tampered data does not open', () => {
    const s = C.seal('secret');
    const bad = s.slice(0, -4) + (s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    assert.equal(C.open(bad), null);
  });
  test('text that was never sealed does not open', () => {
    assert.equal(C.open('plain'), null);
    assert.equal(C.open(''), null);
    assert.equal(C.open(null), null);
  });
  test('a different secret cannot open it', () => {
    const s = C.seal('secret');
    const keep = process.env.MYFIFTY_SECRET;
    process.env.MYFIFTY_SECRET = 'another-secret';
    try { assert.equal(C.open(s), null); } finally { process.env.MYFIFTY_SECRET = keep; }
  });
  test('sealing without a secret fails with 503', () => {
    const keep = process.env.MYFIFTY_SECRET;
    delete process.env.MYFIFTY_SECRET;
    try { assert.throws(() => C.seal('x'), (e) => e.status === 503 && e.message === 'secret_not_configured'); } finally { process.env.MYFIFTY_SECRET = keep; }
  });
  test('derive is stable per purpose and differs between purposes', () => {
    assert.deepEqual(C.derive('a'), C.derive('a'));
    assert.notDeepEqual(C.derive('a'), C.derive('b'));
    assert.equal(C.derive('a').length, 32);
  });
});
