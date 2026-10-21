// Test run helper: a new fake Instagram lead for the test rep Alpha, as the Meta feed would write it (stays in v2, marked demo-test).
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'test/helpers'));
const { db } = require(path.join(ROOT, 'api/_db'));
(async () => {
  const sql = db();
  const n = Date.now().toString(36);
  await sql`insert into contacts (owner_id, first_name, last_name, email, source_kind, source_detail, legacy_id, created_at)
    select id, 'Late', ${process.env.LATE_LAST || 'Leadtest'}, ${'late.' + n + '@demo.invalid'}, 'social', 'Instagram', ${'demo-test-a-late-lead-' + n}, now() from users where email = ${'test.alpha@demo.invalid'}`;
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
