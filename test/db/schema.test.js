// The v2 changes in db/001-my-fifty.sql, checked on v2 itself (every test rolls back).
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const { asUser } = require('../../api/_db');

after(h.closeDb);

describe('the test harness', () => {
  test('writes inside a test are rolled back', async () => {
    let email;
    await h.withDb(async (sql) => { email = (await h.user(sql)).email; });
    await h.withDb(async (sql) => {
      const rows = await sql`select 1 from users where email = ${email}`;
      assert.equal(rows.length, 0);
    });
  });
});

describe('fields and lists', () => {
  test('role only takes the five fixed values (v2 part B names)', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    for (const r of ['physician', 'injector', 'dentist', 'manager', 'other']) await h.contact(sql, me, { role: r });
    await assert.rejects(sql.savepoint((s) => s`insert into contacts (owner_id, role) values (${me.id}, 'nurse_injector')`), /invalid input value for enum/);
    await assert.rejects(sql.savepoint((s) => s`insert into contacts (owner_id, role) values (${me.id}, 'surgeon')`), /invalid input value for enum/);
  }));
  test('lead_source is social, event, warm or cold, and the old meta_ad is gone', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    for (const k of ['social', 'event', 'warm', 'cold']) await h.contact(sql, me, { source: k });
    await assert.rejects(sql.savepoint((s) => s`insert into contacts (owner_id, lead_source) values (${me.id}, 'meta_ad')`), /invalid input value/);
  }));
  test('fillers_used and prp_used are fixed lists that start empty', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const id = await h.contact(sql, me);
    const [c] = await sql`select fillers_used::text[] f, prp_used::text[] p from contacts where id = ${id}`;
    assert.deepEqual([c.f, c.p], [[], []]);
    await sql`update contacts set fillers_used = '{saypha,teoxane_rha}', prp_used = '{exprecell_prf,none}' where id = ${id}`;
    await assert.rejects(sql.savepoint((s) => s`update contacts set fillers_used = '{botox}' where id = ${id}`), /invalid input value/);
  }));
  test('orders have approval_note and shipping_note, and no notes', () => h.withDb(async (sql) => {
    const cols = (await sql`select column_name from information_schema.columns where table_name = 'orders' and column_name in ('notes', 'approval_note', 'shipping_note')`).map((r) => r.column_name).sort();
    assert.deepEqual(cols, ['approval_note', 'shipping_note']);
  }));
  test('the new list values exist', () => h.withDb(async (sql) => {
    const has = async (type, v) => (await sql`select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = ${type} and e.enumlabel = ${v}`).length === 1;
    assert.ok(await has('interactions_source', 'my_fifty'));
    assert.ok(await has('change_logs_source', 'my_fifty'));
    assert.ok(await has('notifications_kind', 'new_lead'));
  }));
});

describe('triggers', () => {
  test('updated_at moves on every update', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const id = await h.contact(sql, me);
    await sql`update contacts set updated_at = '2020-01-01' where id = ${id}`;
    const [c] = await sql`select updated_at from contacts where id = ${id}`;
    assert.ok(c.updated_at > new Date('2025-01-01'), 'the trigger overwrote the old value');
  }));
  test('a change made as a user is logged once per field, with who and My Fifty as the source', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const id = await h.contact(sql, me, { first: 'Old' });
    await asUser(me.id, (tx) => tx`update contacts set first_name = 'New', role = 'manager' where id = ${id}`);
    const rows = await sql`select field_name, old_value, new_value, actor_user_id, actor_kind::text, source::text, action, contact_id from change_logs where entity_id = ${id} and action = 'update' order by field_name`;
    assert.deepEqual(rows.map((r) => r.field_name), ['first_name', 'role']);
    assert.equal(rows[0].old_value, 'Old');
    assert.equal(rows[0].new_value, 'New');
    assert.equal(rows[0].actor_user_id, me.id);
    assert.equal(rows[0].actor_kind, 'user');
    assert.equal(rows[0].source, 'my_fifty');
    assert.equal(rows[0].contact_id, id);
  }));
  test('a change with nobody set is logged as an integration from the database', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const id = await h.contact(sql, me);
    const [r] = await sql`select actor_user_id, actor_kind::text, source::text, action from change_logs where entity_id = ${id}`;
    assert.deepEqual([r.actor_user_id, r.actor_kind, r.source, r.action], [null, 'integration', 'db_trigger', 'create']);
  }));
  test('changing the owner is logged as a reassign', () => h.withDb(async (sql) => {
    const a = await h.user(sql), b = await h.user(sql);
    const id = await h.contact(sql, a);
    await sql`update contacts set owner_id = ${b.id} where id = ${id}`;
    const [r] = await sql`select action from change_logs where entity_id = ${id} and field_name = 'owner_id'`;
    assert.equal(r.action, 'reassign');
  }));
  test('an order line change is filed under the order’s contact', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const c = await h.contact(sql, me);
    const o = await h.order(sql, c, me);
    const [r] = await sql`select contact_id from change_logs where entity_type = 'order_lines' and action = 'create' and contact_id = ${c}`;
    assert.ok(r);
    void o;
  }));
  test('Gmail and push credentials are masked in the log', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const [uc] = await sql`insert into connections (user_id, provider, credentials_encrypted, status) values (${me.id}, 'gmail', 'secret-1', 'connected') returning id`;
    await sql`update connections set credentials_encrypted = 'secret-2' where id = ${uc.id}`;
    const [r] = await sql`select old_value, new_value, is_sensitive from change_logs where entity_id = ${uc.id} and field_name = 'credentials_encrypted'`;
    assert.deepEqual([r.old_value, r.new_value, r.is_sensitive], ['***', '***', true]);
  }));
  test('settings changes are logged by key', () => h.withDb(async (sql) => {
    await sql`insert into settings (key, value) values ('unit_test_key', '{"a":1}'::jsonb)`;
    const [r] = await sql`select field_name, action from change_logs where entity_type = 'settings' and field_name = 'unit_test_key'`;
    assert.deepEqual([r.field_name, r.action], ['unit_test_key', 'insert']);
  }));
  test('the change log cannot be edited or deleted, and sets its own time', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const id = await h.contact(sql, me);
    const [r] = await sql`select id, changed_at from change_logs where entity_id = ${id}`;
    assert.ok(Math.abs(new Date(r.changed_at) - Date.now()) < 120000);
    await assert.rejects(sql.savepoint((s) => s`update change_logs set note = 'x' where id = ${r.id}`), /append-only/);
    await assert.rejects(sql.savepoint((s) => s`delete from change_logs where id = ${r.id}`), /append-only/);
    const [ins] = await sql`insert into change_logs (changed_at, action, entity_type) values ('2000-01-01', 'test', 'x') returning changed_at`;
    assert.ok(new Date(ins.changed_at) > new Date('2025-01-01'));
  }));
});

describe('row-level security', () => {
  // Acts as a signed-in Supabase user (the role and claims PostgREST would set), inside a savepoint.
  async function as(sql, authUserId, fn) {
    return sql.savepoint(async (s) => {
      await s`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authUserId, role: 'authenticated' })}, true)`;
      await s`set local role authenticated`;
      const out = await fn(s);
      await s`reset role`;
      return out;
    });
  }
  async function setup(sql) {
    const repA = await h.user(sql), repB = await h.user(sql), admin = await h.user(sql, { kind: 'admin' });
    const ids = {};
    for (const u of [repA, repB, admin]) {
      ids[u.id] = await h.authUser(sql, u);
    }
    const a1 = await h.contact(sql, repA), b1 = await h.contact(sql, repB);
    await h.order(sql, a1, repA); await h.order(sql, b1, repB);
    await h.touch(sql, a1, repA.id); await h.touch(sql, b1, repB.id);
    return { repA, repB, admin, ids, a1, b1 };
  }
  test('a rep sees their own people and what hangs off them, not another rep’s', () => h.withDb(async (sql) => {
    const x = await setup(sql);
    await as(sql, x.ids[x.repA.id], async (s) => {
      const people = (await s`select id from contacts where id in (${x.a1}, ${x.b1})`).map((r) => r.id);
      assert.deepEqual(people, [x.a1]);
      assert.equal((await s`select 1 from orders where contact_id = ${x.b1}`).length, 0);
      assert.equal((await s`select 1 from interactions where contact_id = ${x.b1}`).length, 0);
      assert.equal((await s`select 1 from orders where contact_id = ${x.a1}`).length, 1);
    });
  }));
  test('a rep cannot give themselves someone else’s person', () => h.withDb(async (sql) => {
    const x = await setup(sql);
    await as(sql, x.ids[x.repA.id], async (s) => {
      const r = await s`update contacts set first_name = 'Mine' where id = ${x.b1} returning id`;
      assert.equal(r.length, 0);
    });
  }));
  test('an admin sees everyone', () => h.withDb(async (sql) => {
    const x = await setup(sql);
    await as(sql, x.ids[x.admin.id], async (s) => {
      assert.equal((await s`select id from contacts where id in (${x.a1}, ${x.b1})`).length, 2);
    });
  }));
  test('the public (anon) key sees nothing', () => h.withDb(async (sql) => {
    const x = await setup(sql);
    await sql.savepoint(async (s) => {
      await s`set local role anon`;
      assert.equal((await s`select 1 from contacts where id = ${x.a1}`).length, 0);
      assert.equal((await s`select 1 from products`).length, 0);
      await s`reset role`;
    });
  }));
  test('a rep cannot read ingest data or edit settings', () => h.withDb(async (sql) => {
    const x = await setup(sql);
    await as(sql, x.ids[x.repA.id], async (s) => {
      assert.equal((await s`select 1 from ingest_events limit 1`).length, 0);
      await assert.rejects(s.savepoint((t) => t`insert into settings (key, value) values ('rep_try', '{}')`), /row-level security/);
    });
  }));
});
