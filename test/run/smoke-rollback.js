// Runs test/smoke.js inside one database transaction that is rolled back at the end, so the smoke test's writes
// (a call, a snooze on the signed-in person, a new person) are never kept on real rows during the test run.
//   node --require ./test/run/no-network.js test/run/smoke-rollback.js [owner-email]
//
// It always rolls back and always ends the pool, also when smoke.js throws or hangs (2026-10-22: a smoke run that
// threw left its transaction "idle in transaction" on v2, holding read locks, because smoke.js never reached
// sql.end()). It waits for whichever comes first: smoke.js ending the connection, smoke.js's own promise settling
// (it is exported), or a time limit (SMOKE_LIMIT_MS, 4 minutes). It prints "N passed, M failed" only when smoke.js got
// to its end; after an error it says so and exits with 1. SMOKE_FILE runs another script instead (for its own test).
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const h = require(path.join(ROOT, 'test/helpers'));
const dbm = require(path.join(ROOT, 'api/_db'));

const ROLLBACK = new Error('rollback');
const LIMIT = Number(process.env.SMOKE_LIMIT_MS) || 240000;
const FILE = process.env.SMOKE_FILE ? path.resolve(process.env.SMOKE_FILE) : path.join(ROOT, 'test/smoke.js');

(async () => {
  const pool = dbm.db();
  let finished;
  const done = new Promise((r) => { finished = r; });
  let failed = null;
  try {
    await pool.begin(async (tx) => {
      const inner = h.inTx(tx);
      const sql = new Proxy(inner, { get(t, p) { if (p === 'end') return async () => finished(); return t[p]; } });
      dbm.setDb(sql);
      let timer;
      const limit = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('smoke did not finish within ' + LIMIT + ' ms')), LIMIT); });
      try {
        const run = require(FILE);
        const how = await Promise.race([done.then(() => 'ended'), Promise.resolve(run).then(() => 'returned'), limit]);
        if (how !== 'ended') throw new Error('smoke stopped before its end (see the error above)');
      } finally {
        clearTimeout(timer);
      }
      throw ROLLBACK;   // always: nothing the smoke test wrote is kept
    });
  } catch (e) {
    if (e !== ROLLBACK) failed = e;
  } finally {
    dbm.setDb(pool);
    await pool.end({ timeout: 5 });
  }
  if (failed) { console.error(failed); process.exitCode = 1; console.log('smoke: stopped with an error; rolled back, nothing kept'); }
  else console.log('smoke: rolled back, nothing kept');
})().catch((e) => { console.error(e); process.exitCode = 1; });
