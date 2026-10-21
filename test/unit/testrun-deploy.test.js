// Test run 2026-10-21: what Vercel publishes. Everything in the repository root is served as a public file unless
// .vercelignore leaves it out, so test scripts, SQL, the seed generator and the test-run reports (which describe
// security findings) must stay out, while every file the page loads stays in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const ignore = () => (fs.existsSync(path.join(ROOT, '.vercelignore')) ? fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8') : '')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const ignored = (p, rules) => rules.some((r) => {
  const rr = r.replace(/^\//, '').replace(/\/$/, '');
  if (rr.startsWith('*.')) return p.endsWith(rr.slice(1));
  return p === rr || p.startsWith(rr + '/');
});

test('tests, database scripts, the seed generator and reports are not published', () => {
  const rules = ignore();
  for (const p of ['test/run/seed-test-data.js', 'test/helpers.js', 'db/wipe-demo.sql', 'db/seed-demo.sql', 'scripts/seed-demo.js', 'docs/test-run/progress.md', 'docs/test-run-rules.md', 'CHANGELOG-v2.md', 'README.md', 'CLAUDE.md']) {
    assert.ok(ignored(p, rules), p + ' would be public');
  }
});
test('everything the app needs is still published', () => {
  const rules = ignore();
  for (const p of ['index.html', 'app.js', 'lib.js', 'app.css', 'sw.js', 'manifest.webmanifest', 'logo.png', 'logo-white.png', 'icons/icon-192.png', 'api/data.js', 'api/act.js', 'api/cron.js', 'api/_db.js', 'package.json', 'vercel.json']) {
    assert.ok(!ignored(p, rules), p + ' must be published');
  }
});
