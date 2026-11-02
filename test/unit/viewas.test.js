// View as a rep (api/_auth.js, Yousef 2026-11-02): only info@ may look as a rep, only at an active rep, and the answer
// carries `viewer` so api/act.js refuses every write. Fake database and a faked Supabase sign-in check.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const USERS = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'info@renellence.com', full_name: 'Info Renellence', kind: 'admin', is_active: true, auth_user_id: 'a-info' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'emily@renellence.com', full_name: 'Emily Grace', kind: 'rep', is_active: true, auth_user_id: 'a-emily' },
  { id: '33333333-3333-4333-8333-333333333333', email: 'admin@renellence.com', full_name: 'Yousef Kamel', kind: 'admin', is_active: true, auth_user_id: 'a-admin' },
  { id: '44444444-4444-4444-8444-444444444444', email: 'gone@renellence.com', full_name: 'Gone Rep', kind: 'rep', is_active: false, auth_user_id: null },
];
const sql = (strings, ...vals) => {
  const q = strings.join('?');
  if (/where auth_user_id = \?/.test(q)) return Promise.resolve(USERS.filter((u) => u.auth_user_id === vals[0]));
  if (/where id = \? and kind = 'rep' and is_active is not false/.test(q)) return Promise.resolve(USERS.filter((u) => u.id === vals[0] && u.kind === 'rep' && u.is_active));
  return Promise.resolve([]);
};
const realLoad = Module._load;
Module._load = function (req) {
  if (req === './_db') return { db: () => sql };
  if (req === './_staging') return { on: () => false };
  return realLoad.apply(this, arguments);
};
process.env.SUPABASE_URL = 'https://example.invalid';
const TOKENS = { info: { id: 'a-info', email: 'info@renellence.com' }, admin: { id: 'a-admin', email: 'admin@renellence.com' } };
global.fetch = async (url, o) => ({ ok: true, json: async () => TOKENS[String(o.headers.Authorization).slice(7)] });
const A = require('../../api/_auth');
const req = (who, as) => ({ headers: Object.assign({ authorization: 'Bearer ' + who }, as ? { 'x-view-as': as } : {}) });

test('info@ sees as an active rep, with viewer set', async () => {
  const me = await A.signedIn(req('info', USERS[1].id));
  assert.equal(me.email, 'emily@renellence.com');
  assert.equal(me.kind, 'rep');
  assert.equal(me.viewer.email, 'info@renellence.com');
});

test('info@ alone, or asking for an admin, a switched-off rep or a bad id, stays info@', async () => {
  for (const as of [null, USERS[2].id, USERS[3].id, 'nope']) {
    const me = await A.signedIn(req('info', as));
    assert.equal(me.email, 'info@renellence.com');
    assert.equal(me.viewer, undefined);
  }
});

test('nobody but info@ can view as', async () => {
  const me = await A.signedIn(req('admin', USERS[1].id));
  assert.equal(me.email, 'admin@renellence.com');
  assert.equal(me.viewer, undefined);
  assert.equal(A.canViewAs({ email: 'INFO@renellence.com' }), true);
  assert.equal(A.canViewAs({ email: 'admin@renellence.com' }), false);
});
