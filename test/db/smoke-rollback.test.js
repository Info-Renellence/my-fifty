// test/run/smoke-rollback.js always rolls back and ends its connection, also when the smoke script throws
// (2026-10-22: a smoke run that threw left an "idle in transaction" session on v2).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('../helpers');

after(h.closeDb);
test('a smoke script that throws: the run stops, says so, keeps nothing and leaves no open session', () => h.withDb(async (sql) => {
  const mark = 'demo-test-smoke-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'run', 'smoke-rollback.js')], {
    env: Object.assign({}, process.env, { SMOKE_FILE: path.join(__dirname, '..', 'run', 'fixtures', 'smoke-throws.js'), SMOKE_MARK: mark, SMOKE_LIMIT_MS: '30000' }),
    encoding: 'utf8', timeout: 60000 });
  assert.equal(r.signal, null, 'it finished by itself (was not killed by the timeout)');
  assert.equal(r.status, 1, 'exit code 1');
  assert.match(r.stdout, /stopped with an error; rolled back, nothing kept/);
  assert.doesNotMatch(r.stdout, /passed, \d+ failed/);
  const kept = await sql`select 1 from clinics where legacy_id = ${mark}`;
  assert.equal(kept.length, 0, 'the row it wrote was rolled back');
}));
