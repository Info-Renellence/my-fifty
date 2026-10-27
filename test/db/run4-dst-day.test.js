// Run 4: the day count and streak across Toronto midnight and the clock change (Nov 1 2026, 2 AM EDT -> 1 AM EST). Test database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');

after(() => h.closeDb());
const realNow = Date.now;

test('visits either side of Toronto midnight and in the repeated 1 AM hour land on the right day; weekends do not break the streak', () => h.withDb(async (sql) => {
  const me = await h.user(sql), c = await h.contact(sql, me);
  const visit = (iso) => sql`insert into interactions (kind, contact_id, user_id, occurred_at, direction, mode, status, outcome, source, created_by_id)
    values ('meeting', ${c}, ${me.id}, ${iso}, 'out', 'in_person', 'completed', 'connected', 'my_fifty', ${me.id})`;
  const oct30 = ['2026-10-30T14:00:00Z', '2026-10-30T15:00:00Z', '2026-10-30T16:00:00Z', '2026-10-30T17:00:00Z', '2026-10-31T03:30:00Z'];   // the last is 11:30 PM Oct 30 EDT
  const nov1 = ['2026-11-01T04:10:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-01T12:00:00Z', '2026-11-02T04:59:00Z'];     // 12:10 AM EDT, 1:30 AM EDT, 1:30 AM EST, noon, 11:59 PM EST
  for (const t of oct30.concat(nov1, ['2026-11-01T03:59:00Z' /* 11:59 PM Oct 31 */, '2026-11-02T05:01:00Z' /* 12:01 AM Nov 2 */])) await visit(t);
  Date.now = () => Date.parse('2026-11-02T17:00:00Z');   // Monday Nov 2, noon EST
  try {
    const s = await B.dayStats(sql, me, { daily_goal: 5, holidays: [] });
    assert.equal(s.done, 1, 'only the 12:01 AM visit is today');
    assert.equal(s.streak, 2, 'Sun Nov 1 (5) and Fri Oct 30 (5); Saturday (1) is a weekend and does not break it; Thu breaks it');
    Date.now = () => Date.parse('2026-11-01T06:15:00Z');   // 1:15 AM EST, the second 1 AM
    const t = await B.dayStats(sql, me, { daily_goal: 5, holidays: [] });
    assert.equal(t.done, 5, 'all five rows stamped Nov 1 (Toronto) count for Nov 1, including both 1:30 AMs');
  } finally { Date.now = realNow; }
}));
