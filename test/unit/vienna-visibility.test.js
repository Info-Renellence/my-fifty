// Race to Vienna visibility (Yousef 2026-11-02): a rep sees the name and initials of whoever is ahead of them on the podium,
// never of whoever is behind. The ranking itself does not change. Runs against Pulse's api/_rewards.js and, when present,
// Edge's copy (renellence-edge api/_edge/rewards.js) so the two stay the same.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COPIES = [['Pulse', path.join(__dirname, '../../api/_rewards.js')], ['Edge', path.join(__dirname, '../../../renellence-edge/api/_edge/rewards.js')]]
  .filter(([, p]) => fs.existsSync(p));

const REPS = [['a', 'Ann Alpha', 9], ['b', 'Ben Beta', 7], ['c', 'Cat Gamma', 5], ['d', 'Dee Delta', 3], ['e', 'Eve Echo', 1]];
const reps = REPS.map(([id, full_name]) => ({ id, full_name }));
const count = (id) => REPS.find((r) => r[0] === id)[2];
const me = (id) => ({ id, first: REPS.find((r) => r[0] === id)[1].split(' ')[0] });

for (const [label, file] of COPIES) {
  const R = require(file)._;
  const board = (id) => { const { top, mine } = R.leaderboard(reps, me(id), count); return top.map((r) => R.viennaRow(r, mine)); };

  test(label + ': 1st sees nobody behind them', () => {
    const rows = board('a');
    assert.deepEqual(rows.map((r) => [r.rank, r.name, r.initials, r.hidden]), [[1, 'You', 'AA', false], [2, '', '', true], [3, '', '', true]]);
  });
  test(label + ': 2nd sees 1st, not 3rd', () => {
    const rows = board('b');
    assert.deepEqual(rows.map((r) => [r.rank, r.name, r.initials, r.hidden]), [[1, 'Ann', 'AA', false], [2, 'You', 'BB', false], [3, '', '', true]]);
  });
  test(label + ': 3rd sees 1st and 2nd', () => {
    assert.deepEqual(board('c').map((r) => r.hidden), [false, false, false]);
  });
  test(label + ': outside the top three sees the two ahead and themselves', () => {
    const rows = board('e');
    assert.deepEqual(rows.map((r) => [r.rank, r.name, r.hidden]), [[1, 'Ann', false], [2, 'Ben', false], [5, 'You', false]]);
  });
  test(label + ': the order and counts are unchanged', () => {
    assert.deepEqual(board('a').map((r) => [r.rank, r.n]), [[1, 9], [2, 7], [3, 5]]);
  });
}
