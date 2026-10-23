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

  test('only first names and counts: no other rep\'s people, ids or emails',() => h.withDb(async (sql) => {
    await sql`update users set is_active = false where kind = 'rep'`;
    const admin = await h.user(sql, { kind: 'admin', name: 'Ad Min' }), rep = await h.user(sql, { name: 'Robin Rep' });
    const theirs = await h.contact(sql, rep, { first: 'Secret', last: 'Customer' });
    await h.order(sql, theirs, rep, { status: 'shipped', days: 1 });
    await fifty(sql, admin, 2);
    const r = await R.rewards(sql, admin);
    for (const row of r.race.rows) assert.deepEqual(Object.keys(row).sort(), ['done', 'n', 'name', 'rank', 'you']);
    const text = JSON.stringify(r.race);
    assert.ok(!text.includes('Secret') && !text.includes(theirs) && !text.includes(rep.id) && !text.includes('@'), 'nothing about the other rep\'s people');
    assert.deepEqual(r.race.rows.map((x) => [x.name, x.n]), [['Robin', 1]], 'reps only: the admin has no row of their own');
  }));

  test('reps only (Yousef 2026-10-23): an admin or head-office user sees the reps\' ranking with no row of their own', () => h.withDb(async (sql) => {
    await sql`update users set is_active = false where kind = 'rep'`;
    const admin = await h.user(sql, { kind: 'admin', name: 'Ad Min' }), office = await h.user(sql, { kind: 'head_office', name: 'Head Office' });
    const a = await h.user(sql, { name: 'Ash Rep' }), b = await h.user(sql, { name: 'Bo Rep' }), c = await h.user(sql, { name: 'Cy Rep' }), d = await h.user(sql, { name: 'Di Rep' });
    await fifty(sql, admin, 9); await fifty(sql, office, 8);          // they own customers, more than any rep, and still are not ranked
    await fifty(sql, a, 4); await fifty(sql, b, 3); await fifty(sql, c, 2);
    await fifty(sql, d, 1, { days: 45 });                               // going cold (no order for 45 days) still counts
    const reps = [
      { rank: 1, name: 'Ash', n: 4, you: false, done: false },
      { rank: 2, name: 'Bo', n: 3, you: false, done: false },
      { rank: 3, name: 'Cy', n: 2, you: false, done: false },
    ];
    for (const who of [admin, office]) {
      const r = await R.rewards(sql, who);
      assert.deepEqual(r.race.rows, reps, who.kind + ': the top three reps, no own row');
      assert.ok(!r.race.rows.some((x) => x.you || ['You', 'Ad', 'Head'].includes(x.name)), who.kind + ' is never on the board');
      assert.equal(r.race.line, '', who.kind + ': no "N more to reach 25" for someone who is not in the race');
    }
    // A rep asking sees the same counts and their own row, the going-cold customer included.
    const asD = await R.rewards(sql, d);
    assert.ok((await B.book(sql, d, {})).people.some((p) => p.stage === 'fifty' && p.goingCold), 'the book calls it going cold');
    assert.deepEqual(asD.race.rows.map((x) => [x.rank, x.name, x.n]), [[1, 'Ash', 4], [2, 'Bo', 3], [4, 'You', 1]]);
    assert.equal(asD.race.line, '24 more to reach 25');
  }));
});
