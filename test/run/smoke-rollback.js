// Runs test/smoke.js inside one database transaction that is rolled back at the end, so the smoke test's writes
// (a call, a snooze on the signed-in person, a new person) are never kept on real rows during the test run.
//   node --require ./test/run/no-network.js test/run/smoke-rollback.js [owner-email]
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const h = require(path.join(ROOT, 'test/helpers'));
const dbm = require(path.join(ROOT, 'api/_db'));

const ROLLBACK = new Error('rollback');
(async () => {
  const pool = dbm.db();
  let finished;
  const done = new Promise((r) => { finished = r; });
  try {
    await pool.begin(async (tx) => {
      const inner = h.inTx(tx);
      const sql = new Proxy(inner, { get(t, p) { if (p === 'end') return async () => finished(); return t[p]; } });
      dbm.setDb(sql);
      require(path.join(ROOT, 'test/smoke.js'));
      await done;
      throw ROLLBACK;
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }
  await pool.end({ timeout: 5 });
  console.log('smoke: rolled back, nothing kept');
})().catch((e) => { console.error(e); process.exitCode = 1; });
