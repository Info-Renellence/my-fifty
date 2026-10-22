// For test/db/smoke-rollback.test.js: a "smoke test" that writes a fake row and then throws, as smoke.js did on
// 2026-10-22 (it caught its own error and never ended the connection).
const { db } = require('../../../api/_db');
module.exports = (async () => {
  const sql = db();
  await sql`insert into clinics (name, legacy_id) values ('Smoke Throws Clinic (demo)', ${process.env.SMOKE_MARK})`;
  throw new Error('not_found');
})().catch((e) => { console.error(e); process.exitCode = 1; });
