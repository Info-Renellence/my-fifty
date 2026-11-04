// The test account (owner 2026-11-04, api/_demo.js): admin@ signs in to a made-up rep book in memory. No v2 address is
// set here, so anything that reached v2 would fail. Supabase's sign-in check is the one outside call allowed (it comes
// before test mode); every other outgoing fetch is counted.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL']) delete process.env[k];
process.env.SUPABASE_URL = 'https://ojphplepzuwchjtuycpv.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
let outside = 0;
globalThis.fetch = async (u) => {
  if (String(u).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', email: 'admin@renellence.com', user_metadata: {} }));
  outside++;
  return new Response('{}');
};
const data = require('../../api/data');
const act = require('../../api/act');

after(() => require('../../api/_demo').close());

function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = { method, url, headers: { authorization: 'Bearer t' }, body };
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode, body: t ? JSON.parse(t) : null }); } };
    handler(req, res);
  });
}

test('admin@ is a rep on made-up data, and nothing leaves', { timeout: 60000 }, async () => {
  const boot = await call(data, 'GET', '/api/data?op=boot');
  assert.equal(boot.status, 200, JSON.stringify(boot.body));
  assert.equal(boot.body.test, true);
  assert.equal(boot.body.me.admin, false);
  assert.equal(boot.body.me.name, 'Test Account');

  const ready = await call(data, 'GET', '/api/data?op=ready');
  assert.equal(ready.status, 200);
  const id = (JSON.stringify(ready.body).match(/"id":"([0-9a-f-]{36})"/) || [])[1];
  assert.ok(id, 'the made-up book has people ready to order');

  const order = await call(act, 'POST', '/api/act', { op: 'order', contactId: id, lines: [{ sku: 'SAL400', qty: 1 }], payment: 'card_on_file' });
  assert.equal(order.status, 200, JSON.stringify(order.body));
  assert.equal(order.body.test, true);
  assert.equal(order.body.sentToN8n, false);
  assert.equal(outside, 0, 'no outside calls');
});

test('anyone else is not in test mode', () => {
  const demo = require('../../api/_demo');
  assert.equal(demo.isTestEmail('ADMIN@renellence.com'), true);
  assert.equal(demo.isTestEmail('info@renellence.com'), false);
  assert.equal(demo.active(), false);
});
