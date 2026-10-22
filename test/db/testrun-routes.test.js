// Test run 2026-10-21: the two routes with sign-in stubbed (this file only; node --test runs each file in its own
// process). Unknown ops, built-in object names as ops or lead groups, and junk bodies must be a clean 400.
const { test, describe, after, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const auth = require('../../api/_auth');

let me = null;
auth.signedIn = async () => { if (!me) { const e = new Error('signed_out'); e.status = 401; throw e; } return me; };
const data = require('../../api/data');
const act = require('../../api/act');

after(h.closeDb);
const get = async (q) => { const res = h.fakeRes(); await data({ method: 'GET', url: '/api/data?' + q, headers: {} }, res); return res; };
const post = async (body) => { const res = h.fakeRes(); await act({ method: 'POST', url: '/api/act', headers: {}, body }, res); return res; };

describe('ops are looked up safely', () => {
  before(() => { me = { id: '00000000-0000-0000-0000-000000000000', email: 'nobody@demo.invalid', name: 'No Body', first: 'No', initials: 'NB', kind: 'rep', preferences: {} }; });
  for (const op of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
    test('read op "' + op + '" is refused', async () => {
      const res = await get('op=' + op);
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'unknown_op');
    });
    test('write op "' + op + '" is refused', async () => {
      const res = await post({ op });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'unknown_op');
    });
  }
  for (const g of ['__proto__', 'constructor', 'toString']) {
    test('lead group "' + g + '" is refused', () => h.withDb(async () => {
      const res = await get('op=leads&group=' + g);
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, 'bad_group');
    }));
  }
  test('SH: values that cannot become text are bad input (400), not a server error', () => h.withDb(async () => {
    const odd = { toString: 'x' };
    for (const body of [{ op: 'order', contactId: odd }, { op: 'log', contactId: odd }, { op: 'add_person', firstName: odd, lastName: odd }, { op: 'invoice_email', contactId: odd, email: odd }]) {
      const res = await post(body);
      assert.equal(res.statusCode, 400, JSON.stringify(body) + ' -> ' + res.statusCode);
    }
    const res = await post({ op: 'voice', contactId: odd, audio: odd, mime: odd });
    assert.ok(res.statusCode < 500, 'voice: ' + res.statusCode);
  }));
  test('a junk or list body is an unknown op, not a crash', async () => {
    for (const body of ['{not json', '[1,2,3]', 'null', '42']) {
      const res = await post(body);
      assert.equal(res.statusCode, 400, body);
    }
  });
});

describe('random input against every write and read (no 500s)', () => {
  const h2 = require('../helpers');
  const junk = [null, 0, -1, 1e309, 'x', '', ' ', 'a'.repeat(5000), [], [1, 'a', null], {}, { a: { b: 1 } }, true, '2026-02-30', '00000000-0000-0000-0000-000000000000', '<script>', '😀'];
  let seed = Number(process.env.FUZZ_SEED || 7);
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const FIELDS = ['contactId', 'kind', 'note', 'followUp', 'reached', 'interactionId', 'closedTaskIds', 'taskId', 'firstName', 'lastName', 'email', 'phone', 'clinic', 'role', 'warm',
    'date', 'fillers', 'prp', 'body', 'lines', 'payment', 'mdName', 'mdEmail', 'approvalNote', 'shippingNote', 'orderId', 'onboardingId', 'audio', 'mime', 'subject', 'text', 'to', 'subscription', 'refreshToken', 'aiOutputId'];
  const OPS = Object.keys(require('../../api/act').OPS);
  test('300 random write bodies: every answer is 2xx or 4xx', () => h2.withDb(async (sql) => {
    const u = await h2.user(sql);
    const c = await h2.contact(sql, u);
    me = { id: u.id, email: u.email, name: 'Fuzz Rep', first: 'Fuzz', initials: 'FR', kind: 'rep', preferences: {} };
    const bad = [];
    for (let i = 0; i < 300; i++) {
      const body = { op: OPS[rnd(OPS.length)] };
      for (const f of FIELDS) if (rnd(3) === 0) body[f] = rnd(4) === 0 ? c : junk[rnd(junk.length)];
      const res = await post(body);
      if (res.statusCode >= 500) bad.push(res.statusCode + ' ' + JSON.stringify(body).slice(0, 200) + ' -> ' + res.body.slice(0, 120));
    }
    assert.deepEqual(bad, []);
  }));
  test('random read queries: every answer is 2xx or 4xx', () => h2.withDb(async (sql) => {
    const u = await h2.user(sql);
    me = { id: u.id, email: u.email, name: 'Fuzz Rep', first: 'Fuzz', initials: 'FR', kind: 'rep', preferences: {} };
    const ops = Object.keys(require('../../api/data').OPS);
    const bad = [];
    for (let i = 0; i < 120; i++) {
      const q = new URLSearchParams({ op: ops[rnd(ops.length)], id: String(junk[rnd(junk.length)]), group: String(junk[rnd(junk.length)]), q: String(junk[rnd(junk.length)]) });
      const res = await get(q.toString());
      if (res.statusCode >= 500) bad.push(res.statusCode + ' ' + q + ' -> ' + res.body.slice(0, 120));
    }
    assert.deepEqual(bad, []);
  }));
});
