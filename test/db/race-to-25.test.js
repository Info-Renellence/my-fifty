// Rewards: the second leaderboard, Race to 25 (Yousef 2026-10-23). Each rep's count is the people in their Fifty right
// now, worked out by the shared book (_book.js: an order that isn't samples in the last 3 months, paid or not).
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const R = require('../../api/_rewards');
const B = require('../../api/_book');

after(h.closeDb);

// n people in rep's Fifty: each with one order (not samples) placed `days` ago.
async function fifty(sql, rep, n, o = {}) {
  for (let i = 0; i < n; i++) await h.order(sql, await h.contact(sql, rep), rep, { status: o.status || 'shipped', days: o.days || 3, lines: o.lines });
}

describe('Race to 25', () => {
  test('counts the people in each rep\'s Fifty now, by the book\'s rule; samples, old orders and other books do not count', () => h.withDb(async (sql) => {
    await sql`update users set is_active = false where kind = 'rep'`;
    const me = await h.user(sql, { name: 'Pat Rep' }), robin = await h.user(sql, { name: 'Robin Rep' }), ash = await h.user(sql, { name: 'Ash Rep' }), bo = await h.user(sql, { name: 'Bo Rep' });
    await fifty(sql, me, 3);                                            // in my Fifty
    await fifty(sql, me, 1, { status: 'submitted' });                   // placed, not paid yet: still in the Fifty (book rule)
    await fifty(sql, me, 2, { lines: [['SAL400', 5, true]] });           // samples only: candidates, not the Fifty
    await fifty(sql, me, 1, { days: 120 });                             // last order over 3 months ago: left the Fifty
    const mine = await h.contact(sql, me);
    await h.order(sql, mine, robin, { status: 'shipped', days: 2 });   // my customer, credited to Robin: counts in MY Fifty (owner)
    await fifty(sql, robin, 6); await fifty(sql, ash, 2); await fifty(sql, bo, 1);
    const r = await R.rewards(sql, me);
    const { people } = await B.book(sql, me, {});
    assert.equal(people.filter((p) => p.stage === 'fifty').length, 5, 'the book says 5');
    assert.equal(r.race.name, 'Race to 25');
    assert.equal(r.race.goal, 25);
    assert.deepEqual(r.race.rows, [
      { rank: 1, name: 'Robin', n: 6, you: false, done: false },
      { rank: 2, name: 'You', n: 5, you: true, done: false },
      { rank: 3, name: 'Ash', n: 2, you: false, done: false },
    ]);
    assert.equal(r.race.line, '20 more to reach 25');
    // The count goes down when someone leaves the Fifty (no order for 3 months).
    await sql`update orders set submitted_at = now() - interval '200 days', created_at = now() - interval '200 days' where contact_id = ${mine}`;
    assert.equal((await R.rewards(sql, me)).race.rows.find((x) => x.you).n, 4);
  }));

  test('a rep who reaches 25 is done; my row stays in third place when I am not in the top three', () => h.withDb(async (sql) => {
    await sql`update users set is_active = false where kind = 'rep'`;
    const me = await h.user(sql, { name: 'Pat Rep' }), a = await h.user(sql, { name: 'Ash Rep' }), b = await h.user(sql, { name: 'Bo Rep' }), c = await h.user(sql, { name: 'Cy Rep' });
    await fifty(sql, a, 26); await fifty(sql, b, 25); await fifty(sql, c, 3); await fifty(sql, me, 1);
    const r = await R.rewards(sql, me);
    assert.deepEqual(r.race.rows, [
      { rank: 1, name: 'Ash', n: 26, you: false, done: true },
      { rank: 2, name: 'Bo', n: 25, you: false, done: true },
      { rank: 4, name: 'You', n: 1, you: true, done: false },
    ]);
    await fifty(sql, me, 24);
    const r2 = await R.rewards(sql, me);
    assert.equal(r2.race.line, 'You reached 25');
    assert.ok(r2.race.rows.find((x) => x.you).done);
  }));

  test('only first names and counts: no other rep\'s people, ids or emails; an admin who is not a rep sees their own row', () => h.withDb(async (sql) => {
    await sql`update users set is_active = false where kind = 'rep'`;
    const admin = await h.user(sql, { kind: 'admin', name: 'Ad Min' }), rep = await h.user(sql, { name: 'Robin Rep' });
    const theirs = await h.contact(sql, rep, { first: 'Secret', last: 'Customer' });
    await h.order(sql, theirs, rep, { status: 'shipped', days: 1 });
    await fifty(sql, admin, 2);
    const r = await R.rewards(sql, admin);
    for (const row of r.race.rows) assert.deepEqual(Object.keys(row).sort(), ['done', 'n', 'name', 'rank', 'you']);
    const text = JSON.stringify(r.race);
    assert.ok(!text.includes('Secret') && !text.includes(theirs) && !text.includes(rep.id) && !text.includes('@'), 'nothing about the other rep\'s people');
    assert.deepEqual(r.race.rows.map((x) => [x.name, x.n]), [['You', 2], ['Robin', 1]], 'the admin counts the people they own, not the whole company');
  }));
});
