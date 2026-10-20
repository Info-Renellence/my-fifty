// db/wipe-demo.sql and db/seed-demo.sql (scripts/seed-demo.js), run on v2 inside a rolled-back transaction:
// the wipe removes every demo row and nothing real; the seed loads cleanly, is all fictional, and is marked.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('../helpers');

after(h.closeDb);
const file = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'db', n), 'utf8')
  .split(/\r?\n/).filter((l) => !/^\s*(begin|commit);\s*$/i.test(l)).join('\n');   // run inside the test's own transaction
// Real staff first names (the rule: demo data never uses them, not even first names).
const REAL = ['Yousef', 'Emily', 'Riaan', 'Brittany', 'Sam', 'Lucas', 'Angela', 'Aria', 'Caterina', 'Cat', 'Patrick'];

describe('demo data', () => {
  test('the wipe removes all demo rows and keeps products, settings and real staff', () => h.withDb(async (sql) => {
    const before = (await sql`select (select count(*) from products)::int p, (select count(*) from settings)::int s, (select count(*) from users where email not like '%@demo.invalid')::int u`)[0];
    await sql.unsafe(file('wipe-demo.sql'));
    await sql`set local session_replication_role = origin`;
    const after = (await sql`select (select count(*) from products)::int p, (select count(*) from settings)::int s, (select count(*) from users where email not like '%@demo.invalid')::int u,
      (select count(*) from contacts where legacy_id like 'demo-%')::int c, (select count(*) from orders where legacy_id like 'demo-%')::int o,
      (select count(*) from users where email like '%@demo.invalid')::int du, (select count(*) from clinics where legacy_id like 'demo-%')::int cl,
      (select count(*) from events where name like '% (demo)')::int e`)[0];
    assert.deepEqual(after, { p: before.p, s: before.s, u: before.u, c: 0, o: 0, du: 0, cl: 0, e: 0 });
    const [orphans] = await sql`select count(*)::int n from change_log l where l.contact_id is not null and not exists (select 1 from contacts c where c.id = l.contact_id)`;
    assert.equal(orphans.n, 0, 'no change_log row points at a removed person');
  }));
  test('the seed loads after a wipe, all marked as demo', () => h.withDb(async (sql) => {
    await sql.unsafe(file('wipe-demo.sql'));
    await sql`set local session_replication_role = origin`;
    await sql.unsafe(file('seed-demo.sql'));
    const [n] = await sql`select (select count(*) from users where email like '%@demo.invalid')::int du, (select count(*) from clinics where legacy_id like 'demo-%')::int cl,
      (select count(*) from contacts where legacy_id like 'demo-%')::int c, (select count(*) from contacts where legacy_id is null or legacy_id not like 'demo-%')::int unmarked,
      (select count(*) from orders where legacy_id like 'demo-%')::int o`;
    assert.equal(n.du, 4);
    assert.equal(n.cl, 26);
    assert.ok(n.c > 60 && n.o > 60);
    assert.equal(n.unmarked, 0, 'every person in v2 is demo data until go-live');
  }));
  test('no real staff first name appears anywhere in the demo data', () => h.withDb(async (sql) => {
    await sql.unsafe(file('wipe-demo.sql'));
    await sql`set local session_replication_role = origin`;
    await sql.unsafe(file('seed-demo.sql'));
    const names = await sql`select first_name || ' ' || coalesce(last_name, '') n from contacts where legacy_id like 'demo-%'
                            union all select name from users where email like '%@demo.invalid' union all select name from clinics where legacy_id like 'demo-%'`;
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'seed-demo.sql'), 'utf8');
    for (const real of REAL) {
      const word = new RegExp('\\b' + real + '\\b', 'i');
      assert.ok(!names.some((r) => word.test(r.n)), real + ' is used as a demo name');
      assert.ok(!new RegExp("'" + real + "[ ']", 'i').test(text), real + ' appears in the seed file');
    }
  }));
});
