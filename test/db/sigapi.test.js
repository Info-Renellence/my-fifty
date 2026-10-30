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

test('an envelope whose person reaches v2 days later is still added (14-day window, not 3); one older than that is left', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const n = Date.now();
    const email = 'sig.late' + n + '@demo.invalid';
    const at = (days) => new Date(n - days * 86400000).toISOString();
    const late = { id: 'envl-' + n, title: 'Renellence Onboarding Form', status: 'completed', mode: 'live', created_at: at(10), completed_at: at(10),
      recipients: [{ id: 'r1', key: 'delegate', name: 'Sig Late', email, status: 'completed', completed_at: at(10), type: 'signer' }] };
    const old = Object.assign({}, late, { id: 'envo-' + n, created_at: at(20), completed_at: at(20) });
    const real = global.fetch;
    process.env.SIGNATUREAPI_KEY = 'unit';
    global.fetch = async (url) => /envelopes\?/.test(String(url)) ? { ok: true, json: async () => ({ data: [late, old], links: {} }) }
      : { ok: false, status: 404, json: async () => ({ title: 'not found' }) };
    try {
      const r1 = await SIG.sync(sql, 10000);
      assert.equal(r1.unmatched, 1, 'no person yet: counted, not added');
      await h.contact(sql, me, { email });
      const r2 = await SIG.sync(sql, 10000);
      assert.equal(r2.added, 1);
      const [a] = await sql`select status::text from agreements where signatureapi_envelope_id = ${late.id}`;
      assert.equal(a.status, 'completed');
      const [o] = await sql`select 1 from agreements where signatureapi_envelope_id = ${old.id}`;
      assert.equal(o, undefined, 'older than the window: not read');
    } finally { global.fetch = real; delete process.env.SIGNATUREAPI_KEY; }
  });
});

test('a model form with nobody in v2 is still kept (training, no customer) and linked once the person arrives (final audit 2026-10-30)', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const n = Date.now();
    const email = 'sig.model' + n + '@demo.invalid';
    const env = { id: 'envm-' + n, title: 'Renellence — Photo Permission (Pat Model)', status: 'completed', mode: 'live', created_at: new Date(n - 86400000).toISOString(),
      completed_at: new Date(n - 86400000).toISOString(), metadata: { participant_email: email },
      recipients: [{ id: 'r1', key: 'participant', name: 'Pat Model', email, status: 'completed', completed_at: new Date(n - 86400000).toISOString(), type: 'signer' }] };
    const real = global.fetch;
    process.env.SIGNATUREAPI_KEY = 'unit';
    global.fetch = async (url) => /envelopes\?/.test(String(url)) ? { ok: true, json: async () => ({ data: [env], links: {} }) }
      : { ok: false, status: 404, json: async () => ({ title: 'not found' }) };
    try {
      await SIG.sync(sql, 10000);
      const [a] = await sql`select kind::text, contact_id, status::text from agreements where signatureapi_envelope_id = ${env.id}`;
      assert.deepEqual([a.kind, a.contact_id, a.status], ['training', null, 'completed']);
      const c = await h.contact(sql, me, { email });
      await sql`update agreements set status = 'waiting' where signatureapi_envelope_id = ${env.id}`;   // so the refresh reads it again
      await SIG.upsert(sql, env);
      const [b] = await sql`select contact_id from agreements where signatureapi_envelope_id = ${env.id}`;
      assert.equal(b.contact_id, c.id || c, 'linked once the person is in v2');
    } finally { global.fetch = real; delete process.env.SIGNATUREAPI_KEY; }
  });
});
