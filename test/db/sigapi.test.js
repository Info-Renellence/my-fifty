// SignatureAPI -> v2 (api/_sigapi.js, owner 2026-10-27) on the TEST database, rolled back; SignatureAPI faked.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const SIG = require('../../api/_sigapi');
const M = require('../../api/_hsmap');

after(() => h.closeDb());

test('a new onboarding envelope becomes an agreement, signers and an onboarding; a later read marks it signed; test envelopes are skipped', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const n = Date.now();
    const cust = await h.contact(sql, me, { email: 'sig.cust' + n + '@demo.invalid' });
    const env = { id: 'env-' + n, title: 'Renellence Onboarding Form', status: 'in_progress', mode: 'live', created_at: new Date().toISOString(), metadata: { customer_email: 'sig.cust' + n + '@demo.invalid' },
      recipients: [{ id: 'r1', key: 'delegate', name: 'Sig Cust', email: 'sig.cust' + n + '@demo.invalid', status: 'completed', completed_at: new Date().toISOString(), type: 'signer' },
        { id: 'r2', key: 'medical_director', name: 'Dr Demo', email: 'md' + n + '@demo.invalid', status: 'sent', type: 'signer' }] };
    const testEnv = Object.assign({}, env, { id: 'envt-' + n, mode: 'test' });
    let state = env, resent = null;
    const real = global.fetch;
    process.env.SIGNATUREAPI_KEY = 'unit';
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (/recipients\/r2\/resend/.test(u)) { resent = opts.method; return { ok: true, json: async () => ({}) }; }
      if (/envelopes\?/.test(u)) return { ok: true, json: async () => ({ data: [state, testEnv], links: {} }) };
      // only this test's envelope exists: the test database's other waiting agreements are left untouched
      if (u.endsWith('/envelopes/' + env.id)) return { ok: true, json: async () => state };
      return { ok: false, status: 404, json: async () => ({ title: 'not found' }) };
    };
    try {
      await sql`delete from settings where key = 'sigapi_sync'`;
      const r = await SIG.sync(sql, 10000);
      assert.equal(r.added, 1);
      const [a] = await sql`select id, kind::text, status::text, contact_id from agreements where signatureapi_envelope_id = ${env.id}`;
      assert.deepEqual([a.kind, a.status, a.contact_id, a.id], ['onboarding', 'waiting', cust, M.uid('agreement:' + env.id)]);
      const ss = await sql`select role, status::text from agreement_signers where agreement_id = ${a.id} order by signing_order`;
      assert.deepEqual(ss.map((x) => x.role + ':' + x.status), ['practitioner:signed', 'md:sent']);
      const [o] = await sql`select status::text, primary_contact_id from onboardings where agreement_id = ${a.id}`;
      assert.deepEqual([o.status, o.primary_contact_id], ['submitted', cust]);
      const [t] = await sql`select 1 from agreements where signatureapi_envelope_id = ${testEnv.id}`;
      assert.equal(t, undefined, 'test envelopes never land');

      const rm = await SIG.remind(env.id);
      assert.equal(rm.queued, true); assert.equal(resent, 'POST');

      state = Object.assign({}, env, { status: 'completed', completed_at: new Date().toISOString(), recipients: env.recipients.map((x) => Object.assign({}, x, { status: 'completed', completed_at: new Date().toISOString() })) });
      // the waiting queue's bookmark just before this agreement, so it is next in turn
      const [prev] = await sql`select max(id::text) as id from agreements where status = 'waiting' and signatureapi_envelope_id is not null and id < ${a.id}`;
      await sql`insert into settings (key, value) values ('sigapi_sync', ${sql.json({ after: (prev && prev.id) || '00000000-0000-0000-0000-000000000000' })})
                on conflict (key) do update set value = excluded.value`;
      const r2 = await SIG.sync(sql, 10000);
      assert.ok(r2.refreshed >= 1);
      const [a2] = await sql`select status::text from agreements where id = ${a.id}`;
      assert.equal(a2.status, 'completed');
      const [o2] = await sql`select status::text from onboardings where agreement_id = ${a.id}`;
      assert.equal(o2.status, 'signed');
    } finally { global.fetch = real; delete process.env.SIGNATUREAPI_KEY; }
  });
});
