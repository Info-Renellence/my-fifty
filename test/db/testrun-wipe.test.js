// Test run 2026-10-21: db/wipe-demo.sql picks up every fake row and nothing real (rolled back).
// The deletes themselves need `session_replication_role`, which the test login may not set, so this checks the part
// that decides WHAT is removed: the demo_users / demo_contacts / demo_orders selections and the extra test-run deletes.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('../helpers');

after(h.closeDb);
const WIPE = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'wipe-demo.sql'), 'utf8');
const temps = WIPE.match(/create temp table [\s\S]*?;/g);

describe('wipe-demo.sql selections', () => {
  test('the script still makes the three selections', () => assert.equal(temps.length, 3));
  test('every selected row is fake, every fake row is selected, real staff never are', () => h.withDb(async (sql) => {
    // A person added through the app by a test rep (no legacy_id) and an MD added by email are caught too.
    const [rep] = await sql`select id from users where email = 'test.alpha@demo.invalid'`;
    if (!rep) return;   // test data not seeded
    const [added] = await sql`insert into contacts (owner_id, first_name, email, source_kind) values (${rep.id}, 'Added', 'added.in.app@test.invalid', 'warm') returning id`;
    const [md] = await sql`insert into contacts (first_name, email, is_medical_director) values ('Md', 'md.by.email@demo.invalid', true) returning id`;
    for (const t of temps) await sql.unsafe(t);
    const users = await sql`select u.email from users u join demo_users d on d.id = u.id`;
    assert.ok(users.every((u) => /@demo\.invalid$/.test(u.email)));
    assert.ok(!users.some((u) => /@renellence\.com$/.test(u.email)));
    assert.ok(users.some((u) => u.email === 'test.alpha@demo.invalid'));
    const contacts = await sql`select c.id, c.legacy_id, c.email::text, o.email as owner from contacts c join demo_contacts d on d.id = c.id left join users o on o.id = c.owner_id`;
    assert.ok(contacts.every((c) => /^demo-/.test(c.legacy_id || '') || /@demo\.invalid$/.test(c.email || '') || /@demo\.invalid$/.test(c.owner || '')));
    const ids = new Set(contacts.map((c) => c.id));
    assert.ok(ids.has(added.id) && ids.has(md.id));
    const [missed] = await sql`select count(*)::int n from contacts where legacy_id like 'demo-test-%' and id not in (select id from demo_contacts)`;
    assert.equal(missed.n, 0);
    const [real] = await sql`select count(*)::int n from contacts c join demo_contacts d on d.id = c.id
      where coalesce(c.legacy_id, '') not like 'demo-%' and coalesce(c.email::text, '') not like '%@demo.invalid'
        and c.owner_id not in (select id from users where email like '%@demo.invalid')`;
    assert.equal(real.n, 0);
    const [orders] = await sql`select count(*)::int n from orders where legacy_id like 'demo-test-%' and id not in (select id from demo_orders)`;
    assert.equal(orders.n, 0);
  }));
  test('the extra test-run deletes only touch marked rows', () => {
    assert.match(WIPE, /delete from ad_objects where meta_id like 'demo-test-%'/);
    assert.match(WIPE, /delete from ingest_events where external_key like '%demo-test%'/);
    assert.match(WIPE, /name like 'Testrun %' and not exists \(select 1 from contacts/);
  });
});
