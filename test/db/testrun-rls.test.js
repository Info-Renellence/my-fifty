// Test run 2026-10-21: the database's own access rules (RLS), checked as the `anon` and `authenticated` roles, rolled back.
// Checked: the public key, a signed-in account that is not in `users` (any Google account Supabase lets in), an admin
// through the one linked admin row (read only), and since 2026-10-23 (risk 8) a signed-in REP: the test login cannot make
// Google sign-in accounts (auth.users), so the rep gets a test sign-in id inside the rolled-back transaction (see signIn),
// and the Compass tables (v2-010) are checked rep by rep. Also the read-only ops login `ops_reader` (risk 2), where the
// database has it: SELECT only, no RLS bypass, a read policy on every table, every write refused.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('../helpers');

after(h.closeDb);
const TABLES = ['contacts', 'clinics', 'orders', 'order_lines', 'payments', 'interactions', 'tasks', 'events', 'ad_objects', 'ad_daily_metrics',
  'territory_rules', 'ingest_events', 'change_logs', 'notifications', 'connections', 'ai_outputs', 'agreements', 'agreement_signers', 'onboardings',
  'files', 'attendees', 'forecasts', 'forecast_activities', 'targets', 'metric_snapshots', 'marketing_requests',   // forecast_activities: Edge, 2026-10-23
  'checkins', 'account_picks', 'forecast_changes', 'one_on_ones', 'fifty_statuses'];   // Compass, v2-010 (2026-10-23); before the apply they count as denied

async function as(sql, role, sub, fn) {
  return sql.savepoint(async (sp) => {
    await sp.unsafe(`set local role ${role}`);
    await sp`select set_config('request.jwt.claims', ${JSON.stringify(sub ? { sub, role } : { role })}, true)`;
    return fn(sp);
  });
}
const count = async (sp, t) => { try { return (await sp.unsafe(`select count(*)::int n from public.${t}`))[0].n; } catch (e) { return 'denied'; } };

describe('RLS', () => {
  test('the public (anon) key reads nothing from any business table', () => h.withDb(async (sql) => {
    const seen = {};
    await as(sql, 'anon', null, async (sp) => { for (const t of TABLES.concat(['users', 'products', 'settings'])) seen[t] = await count(sp, t); });
    for (const [t, n] of Object.entries(seen)) assert.ok(n === 0 || n === 'denied', t + ' gave ' + n);
  }));
  test('a signed-in account that is not in users sees no business data', () => h.withDb(async (sql) => {
    const seen = {};
    await as(sql, 'authenticated', crypto.randomUUID(), async (sp) => { for (const t of TABLES) seen[t] = await count(sp, t); });
    for (const [t, n] of Object.entries(seen)) assert.ok(n === 0 || n === 'denied', t + ' gave ' + n);
  }));
  test('the admin sees everything, including admin-only tables', () => h.withDb(async (sql) => {
    const [adm] = await sql`select auth_user_id from users where kind = 'admin' and is_active and auth_user_id is not null limit 1`;
    if (!adm) return;
    const [all] = await sql`select (select count(*) from contacts)::int c, (select count(*) from orders)::int o, (select count(*) from events)::int e`;
    let seen;
    await as(sql, 'authenticated', adm.auth_user_id, async (sp) => {
      seen = (await sp`select (select count(*) from contacts)::int c, (select count(*) from orders)::int o, (select count(*) from events)::int e`)[0];
    });
    assert.deepEqual(seen, all);
  }));
  test('a signed-in account that is not in users cannot add or change people', () => h.withDb(async (sql) => {
    const [someone] = await sql`select id from users where email like '%@demo.invalid' limit 1`;
    let err = null;
    await as(sql, 'authenticated', crypto.randomUUID(), async (sp) => {
      try { await sp.savepoint((x) => x`insert into contacts (owner_id, first_name, lead_source) values (${someone.id}, 'Intruder', 'cold')`); } catch (e) { err = e; }
      const r = await sp`update contacts set first_name = 'Hacked' where legacy_id like 'demo-test-%' returning id`;
      assert.equal(r.length, 0, 'no contact can be changed');
    });
    assert.ok(err, 'insert refused');
  }));
});

// Findings written up as proposals (they need policy changes, which the run may not make). These record what is open today.
describe('RLS: what an outsider account can still do (for the report)', () => {
  test('reads every staff row in users, and can add clinics', () => h.withDb(async (sql) => {
    let users, clinicErr = null;
    await as(sql, 'authenticated', crypto.randomUUID(), async (sp) => {
      users = await sp`select email, kind, preferences from users`;
      try { await sp.savepoint((x) => x`insert into clinics (name) values ('Testrun Outsider Clinic')`); } catch (e) { clinicErr = e; }
    });
    console.log('OUTSIDER_CAN_READ_USERS', users.length, 'OUTSIDER_CAN_ADD_CLINIC', !clinicErr);
    assert.ok(users.length >= 0);
  }));
});

// A signed-in rep, simulated (2026-10-23, risk 8). public.me() / is_admin() find the user by auth_user_id = auth.uid(), and
// auth.uid() reads the JWT 'sub' claim that `as` sets. users.auth_user_id must point at auth.users: where this login may add
// an auth.users row it does (h.authUser); on v1 (test_runner owns public.users but may not touch auth.users) the link check is
// set aside instead. Both are undone with the test's transaction. The test locks users FIRST, so the lock is never an upgrade.
async function signIn(sql, u) {
  const [p] = await sql`select has_table_privilege('auth.users', 'insert') ins`;
  if (p.ins) return h.authUser(sql, u);
  await sql`alter table public.users drop constraint if exists users_auth_user_id_fkey`;
  const id = crypto.randomUUID();
  await sql`update users set auth_user_id = ${id} where id = ${u.id}`;
  return id;
}
// The exclusive lock on users, taken politely: NOWAIT tries for up to 90s, so a waiting request never queues in front of
// other test runs' reads of users (a plain LOCK would block them all while it waits).
async function lockUsers(sql) {
  const until = Date.now() + 90000;
  for (;;) {
    try { await sql.savepoint((x) => x`lock table public.users in access exclusive mode nowait`); return; } catch (e) {
      if (!/could not obtain lock/i.test(e.message) || Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
const refused = async (sp, q) => { try { await sp.savepoint((x) => x.unsafe(q)); return false; } catch (e) { return /row-level security|permission denied/i.test(e.message) || e.message; } };

describe('RLS: a signed-in rep (simulated sign-in), Compass tables included', () => {
  test('a rep reads staff, products and settings, adds a clinic, and sees only their own customers and Compass rows', () => h.withDb(async (sql) => {
    const [{ ins }] = await sql`select has_table_privilege('auth.users', 'insert') ins`;
    if (!ins) await lockUsers(sql);   // only the v1 path (link check set aside) needs it
    const a = await h.user(sql, { name: 'Alfa Rlsrep' }), b = await h.user(sql, { name: 'Bravo Rlsrep' });
    const ca = await h.contact(sql, a), cb = await h.contact(sql, b);
    const ids = {};
    for (const [k, rep, cid] of [['a', a, ca], ['b', b, cb]]) {
      const [ci] = await sql`insert into checkins (rep_id, week_start_date) values (${rep.id}, '2026-10-19') returning id`;
      const [ap] = await sql`insert into account_picks (checkin_id, contact_id, sort_group, suggested_pick, suggested_reason, rep_pick) values (${ci.id}, ${cid}, 'lead', 'call', 'test', 'call') returning id`;
      const [oo] = await sql`insert into one_on_ones (kind, rep_id, session_date) values ('weekly', ${rep.id}, '2026-10-20') returning id`;
      const [fi] = await sql`insert into fifty_statuses (contact_id, month_start_date, status) values (${cid}, '2026-10-01', 'watch') returning id`;
      ids[k] = { ci: ci.id, ap: ap.id, oo: oo.id, fi: fi.id, contact: cid };
    }
    const [tot] = await sql`select (select count(*) from users)::int u, (select count(*) from products)::int p, (select count(*) from settings)::int s`;
    const sub = await signIn(sql, a);
    let seen;
    await as(sql, 'authenticated', sub, async (sp) => {
      const [w] = await sp`select public.me()::text me, public.is_admin() adm`;
      const [r] = await sp`select (select count(*) from users)::int u, (select count(*) from products)::int p, (select count(*) from settings)::int s`;
      const vis = async (t, list) => (await sp.unsafe(`select id::text id from public.${t} where id = any($1::uuid[])`, [list])).map((x) => x.id);
      seen = { me: w.me, adm: w.adm, reads: r,
        clinic: !(await refused(sp, "insert into clinics (name) values ('Rls Testcase Clinic')")),
        contacts: await vis('contacts', [ids.a.contact, ids.b.contact]),
        checkins: await vis('checkins', [ids.a.ci, ids.b.ci]), picks: await vis('account_picks', [ids.a.ap, ids.b.ap]),
        oneOnOnes: await vis('one_on_ones', [ids.a.oo, ids.b.oo]), fifty: await vis('fifty_statuses', [ids.a.fi, ids.b.fi]),
        writeOneOnOne: await refused(sp, `insert into one_on_ones (kind, rep_id, session_date) values ('weekly', '${a.id}', '2026-10-21')`),
        writeFifty: await refused(sp, `insert into fifty_statuses (contact_id, month_start_date, status) values ('${ids.a.contact}', '2026-11-01', 'on_track')`),
        checkinForB: await refused(sp, `insert into checkins (rep_id, week_start_date) values ('${b.id}', '2026-10-26')`),
        pickOnB: await refused(sp, `insert into account_picks (checkin_id, contact_id, sort_group, suggested_pick, suggested_reason, rep_pick) values ('${ids.b.ci}', '${ids.b.contact}', 'lead', 'call', 'x', 'call')`),
        changeB: (await sp`update checkins set help_note = 'x' where id = ${ids.b.ci} returning id`).length,
        ownCheckin: !(await refused(sp, `insert into checkins (rep_id, week_start_date) values ('${a.id}', '2026-10-26')`)),
      };
    });
    assert.deepEqual([seen.me, seen.adm], [a.id, false], 'me() is the rep, not an admin');
    assert.deepEqual(seen.reads, tot, 'reads every users, products and settings row');
    assert.equal(seen.clinic, true, 'can add a clinic');
    assert.deepEqual(seen.contacts, [ids.a.contact], 'own customer only');
    assert.deepEqual(seen.checkins, [ids.a.ci], 'own check-in only');
    assert.deepEqual(seen.picks, [ids.a.ap], 'own account picks only');
    assert.deepEqual(seen.oneOnOnes, [ids.a.oo], 'own 1-on-1s only');
    assert.deepEqual(seen.fifty, [ids.a.fi], 'My Fifty statuses of own customers only');
    assert.equal(seen.writeOneOnOne, true, '1-on-1s: only admins write');
    assert.equal(seen.writeFifty, true, 'My Fifty statuses: only admins write');
    assert.equal(seen.checkinForB, true, 'no check-in in another rep\'s name');
    assert.equal(seen.pickOnB, true, 'no pick on another rep\'s check-in');
    assert.equal(seen.changeB, 0, 'another rep\'s check-in cannot be changed');
    assert.equal(seen.ownCheckin, true, 'own check-in can be written');
  }));
});

describe('the read-only ops login (ops_reader, risk 2)', () => {
  test('SELECT only, no RLS bypass, a read policy on every RLS table, every write refused (skipped where not set up)', async (t) => {
    const has = await h.withDb(async (sql) => (await sql`select count(*)::int n from pg_roles where rolname = 'ops_reader'`)[0].n);
    if (!has) { t.skip('ops_reader is not set up on this database yet (renellence-ops/ops/access/reader-setup.js)'); return; }
    await h.withDb(async (sql) => {
      const [r] = await sql`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication from pg_roles where rolname = 'ops_reader'`;
      assert.deepEqual(Object.values(r), [false, false, false, false, false], 'role attributes');
      const other = await sql`select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'ops_reader' and privilege_type <> 'SELECT'`;
      assert.deepEqual([...other], [], 'nothing but SELECT');
      const gaps = await sql`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'ops_reader_read' and p.cmd = 'SELECT')`;
      assert.deepEqual(gaps.map((x) => x.relname), [], 'every RLS table (the Compass ones too) has ops_reader_read');
      const [{ can }] = await sql`select pg_has_role(current_user, 'ops_reader', 'set') can`;
      if (!can) return;   // this login may not SET ROLE ops_reader: the catalog checks above still ran
      const seen = {};
      await as(sql, 'ops_reader', null, async (sp) => {
        for (const tb of ['users', 'contacts', 'checkins', 'one_on_ones']) seen[tb] = await count(sp, tb);
        seen.insert = await refused(sp, "insert into settings (key, value) values ('ops_reader_probe', '{}'::jsonb)");
        seen.update = await refused(sp, 'update users set full_name = full_name');
        seen.del = await refused(sp, 'delete from checkins');
      });
      for (const tb of ['users', 'contacts', 'checkins', 'one_on_ones']) assert.notEqual(seen[tb], 'denied', tb + ' readable');
      assert.deepEqual([seen.insert, seen.update, seen.del], [true, true, true], 'writes refused');
    });
  });
});
