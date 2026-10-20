// api/_gemini.js (one JSON answer from Gemini) and api/_n8n.js (the order webhook).
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { fakeFetch } = require('../helpers');
const G = require('../../api/_gemini');
const N = require('../../api/_n8n');

const answer = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });

describe('gemini textOf and parseJson', () => {
  test('reads the usual candidates shape', () => assert.equal(G._textOf({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab'));
  test('reads output_text', () => assert.equal(G._textOf({ output_text: 'x' }), 'x'));
  test('reads outputs[]', () => assert.equal(G._textOf({ outputs: [{ text: 'y' }, { text: 'z' }] }), 'yz'));
  test('is empty when there is nothing', () => assert.equal(G._textOf({}), ''));
  test('parses plain JSON', () => assert.deepEqual(G._parseJson('{"a":1}'), { a: 1 }));
  test('parses JSON inside a code fence', () => assert.deepEqual(G._parseJson('```json\n{"a":2}\n```'), { a: 2 }));
  test('finds the JSON inside other words', () => assert.deepEqual(G._parseJson('Sure! {"a":3} done'), { a: 3 }));
  test('fails with 502 when there is no JSON', () => assert.throws(() => G._parseJson('no json'), (e) => e.code === 502 && e.message === 'gemini_bad_json'));
});

describe('gemini json', () => {
  let f;
  beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
  afterEach(() => { if (f) f.restore(); f = null; });

  test('is not available without a key, and refuses with 503', async () => {
    delete process.env.GEMINI_API_KEY;
    assert.equal(G.available(), false);
    await assert.rejects(G.json('hi'), (e) => e.code === 503);
  });
  test('sends the prompt, the audio and the key, and returns the object', async () => {
    f = fakeFetch(() => answer({ note: 'ok' }));
    const out = await G.json('prompt', { audio: { mime: 'audio/webm', data: 'AAAA' }, schema: { type: 'OBJECT' } });
    assert.deepEqual(out, { note: 'ok' });
    const sent = JSON.parse(f.calls[0].body);
    assert.equal(sent.contents[0].parts[0].text, 'prompt');
    assert.equal(sent.contents[0].parts[1].inline_data.mime_type, 'audio/webm');
    assert.equal(sent.generationConfig.responseMimeType, 'application/json');
    assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'test-key');
  });
  test('sends pictures too', async () => {
    f = fakeFetch(() => answer({}));
    await G.json('p', { images: [{ mime: 'image/png', data: 'BB' }, null] });
    assert.equal(JSON.parse(f.calls[0].body).contents[0].parts.length, 2);
  });
  test('tries once more on a 503, on the fallback model', async () => {
    let n = 0;
    f = fakeFetch(() => (++n === 1 ? { status: 503, json: { error: { message: 'busy' } } } : answer({ ok: 1 })));
    assert.deepEqual(await G.json('p', { fallbackModel: 'gemini-lite' }), { ok: 1 });
    assert.match(f.calls[1].url, /gemini-lite/);
  });
  test('does not try again after a 429 (rate limited)', async () => {
    f = fakeFetch(() => ({ status: 429, json: {} }));
    await assert.rejects(G.json('p'), (e) => e.code === 429 && e.message === 'gemini_rate_limited');
    assert.equal(f.calls.length, 1);
  });
  test('does not try again when told not to', async () => {
    f = fakeFetch(() => ({ status: 500, json: {} }));
    await assert.rejects(G.json('p', { noRetry: true }), (e) => e.message === 'gemini_500');
    assert.equal(f.calls.length, 1);
  });
  test('an unreachable server is a 504 after one retry', async () => {
    f = fakeFetch(() => { throw new Error('ECONNRESET'); });
    await assert.rejects(G.json('p'), (e) => e.code === 504 && e.message === 'gemini_unreachable');
    assert.equal(f.calls.length, 2);
  });
  test('a slow answer times out', async () => {
    f = fakeFetch((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); })));
    await assert.rejects(G.json('p', { timeoutMs: 20, noRetry: true }), (e) => e.message === 'gemini_timeout');
  });
  test('an error answer keeps Google’s message as detail', async () => {
    f = fakeFetch(() => ({ status: 400, json: { error: { message: 'bad audio' } } }));
    await assert.rejects(G.json('p'), (e) => e.detail === 'bad audio' && e.code === 502);
  });
});

describe('n8n call', () => {
  let f;
  afterEach(() => { if (f) f.restore(); f = null; delete process.env.N8N_MYFIFTY_URL; delete process.env.N8N_MYFIFTY_KEY; });

  test('does nothing and says so when the webhook is not set', async () => {
    f = fakeFetch(() => ({}));
    assert.deepEqual(await N.call('order', { orderId: 'x' }), { queued: false, reason: 'n8n_not_connected' });
    assert.equal(f.calls.length, 0);
  });
  test('posts the action and payload with the key', async () => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/webhook/my-fifty';
    process.env.N8N_MYFIFTY_KEY = 'k1';
    f = fakeFetch(() => ({ json: { ok: true } }));
    assert.deepEqual(await N.call('order', { orderId: 'o1' }), { queued: true });
    assert.equal(f.calls[0].url, 'https://n8n.test/webhook/my-fifty');
    assert.equal(f.calls[0].init.headers['X-My-Fifty-Key'], 'k1');
    assert.deepEqual(JSON.parse(f.calls[0].body), { action: 'order', orderId: 'o1' });
  });
  test('an error status is reported, not thrown', async () => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/x';
    f = fakeFetch(() => ({ status: 401, text: 'bad key' }));
    assert.deepEqual(await N.call('remind_md', {}), { queued: false, reason: 'n8n_401', detail: 'bad key' });
  });
  test('an unreachable n8n is reported', async () => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/x';
    f = fakeFetch(() => { throw new Error('down'); });
    assert.equal((await N.call('order', {})).reason, 'n8n_unreachable');
  });
  test('a timeout is reported', async () => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/x';
    f = fakeFetch(() => { const e = new Error('t'); e.name = 'AbortError'; throw e; });
    assert.equal((await N.call('order', {})).reason, 'n8n_timeout');
  });
});
