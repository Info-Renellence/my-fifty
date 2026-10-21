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
  before(() => { me = { id: '00000000-0000-0000-0000-000000000000', email: 'nobody@demo.invalid', name: 'No Body', first: 'No', initials: 'NB', kind: 'rep', settings: {} }; });
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
  test('a junk or list body is an unknown op, not a crash', async () => {
    for (const body of ['{not json', '[1,2,3]', 'null', '42']) {
      const res = await post(body);
      assert.equal(res.statusCode, 400, body);
    }
  });
});
