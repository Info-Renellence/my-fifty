// Test run 2026-10-21: many reads at once on one server instance (read only, on the real connection pool, no writes).
// Through Supabase's transaction pooler (port 6543), queries that carry no parameters sometimes never came back when
// several ran at once; every query the app runs now carries at least one parameter.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
require('../helpers');
const { db } = require('../../api/_db');
const B = require('../../api/_book');
const D = require('../../api/data').OPS;
const R = require('../../api/_rewards');

after(() => db().end({ timeout: 5 }));
const within = (p, ms) => Promise.race([p.then(() => 'ok'), new Promise((r) => setTimeout(() => r('hung'), ms))]);
const someone = async () => {
  const [u] = await db()`select id, email, name, kind from users where email like ${'%@demo.invalid'} order by email limit 1`;
  return Object.assign(u, { first: 'Test', initials: 'TT', settings: {} });
};

describe('reads at once', () => {
  test('ten Today screens at once all answer', async () => {
    const me = await someone();
    const r = await Promise.all(Array.from({ length: 10 }, () => within(D.today(db(), me), 15000)));
    assert.deepEqual(r, Array(10).fill('ok'));
  });
  test('settings, products, rewards and the timer\'s lists, several at once, all answer', async () => {
    const me = await someone();
    const jobs = [];
    for (let i = 0; i < 3; i++) jobs.push(B.settings(db()), R.rewards(db(), me), D.products(db(), me, new URLSearchParams()).catch(() => null));
    const r = await Promise.all(jobs.map((j) => within(Promise.resolve(j), 15000)));
    assert.ok(r.every((x) => x === 'ok'), JSON.stringify(r));
  });
});
