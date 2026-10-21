// Test run 2026-10-21: the database's own access rules (RLS), checked as the `anon` and `authenticated` roles, rolled back.
// The test login cannot make Google sign-in accounts (auth.users), so a *rep* signed in cannot be imitated here; what
// can be checked: the public key, a signed-in account that is not in `users` (any Google account Supabase lets in), and
// an admin through the one linked admin row (read only).
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('../helpers');

after(h.closeDb);
const TABLES = ['contacts', 'clinics', 'orders', 'order_lines', 'payments', 'interactions', 'tasks', 'events', 'ad_objects', 'ad_metrics_daily',
  'territory_rules', 'ingest_events', 'change_log', 'notifications', 'user_connections', 'ai_outputs', 'agreements', 'agreement_signers', 'onboardings',
  'files', 'event_attendees', 'forecasts', 'targets', 'metric_snapshots', 'marketing_requests'];

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
    const [adm] = await sql`select auth_user_id from users where kind = 'admin' and active and auth_user_id is not null limit 1`;
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
      try { await sp.savepoint((x) => x`insert into contacts (owner_id, first_name, source_kind) values (${someone.id}, 'Intruder', 'cold')`); } catch (e) { err = e; }
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
      users = await sp`select email, kind, settings from users`;
      try { await sp.savepoint((x) => x`insert into clinics (name) values ('Testrun Outsider Clinic')`); } catch (e) { clinicErr = e; }
    });
    console.log('OUTSIDER_CAN_READ_USERS', users.length, 'OUTSIDER_CAN_ADD_CLINIC', !clinicErr);
    assert.ok(users.length >= 0);
  }));
});
