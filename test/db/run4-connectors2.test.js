// Run 4 (2026-10-27), part 2: Internal Sales Form / pay link / SignatureAPI / Gmail / the timer, with stubbed replies only.
// Test database (v1), every test rolled back, fictional rows only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

after(() => h.closeDb());
const t = Date.now();

test('ISF payload: paid order, sample order, wire, custom price, a placer who is not on the staff list', async () => {
  const isf = require('../../api/_isf');
  await h.withDb(async (sql) => {
    const rep = await h.user(sql, { email: 'emily@renellence.com'.replace('emily', 'r4.nobody' + t) + '' });   // not on the sales form's staff list
    const c = await h.contact(sql, rep);
    const paid = await h.order(sql, c, rep, { lines: [['SAF100', 2], ['SAL400', 1, true]], method: 'wire' });
    await sql`update order_lines set unit_price = 147.5 where order_id = ${paid} and not is_free`;
    const p = await isf.payloadFor(sql, paid);
    assert.equal(p.payment_method, 'wire_transfer');
    assert.equal(p.send_signature, false);
    assert.equal(p.sales_person.email, 'info@renellence.com', 'an unknown placer falls back to the office, never to a made-up address');
    const l = p.products.find((x) => x.sku === 'SAF100');
    assert.ok(l, JSON.stringify(p.products)); assert.equal(l.price, '147.50'); assert.ok(Number(l.originalPrice) >= 147.5);
    assert.equal(p.products.find((x) => x.sample).price, '0.00');
    assert.ok(/Pulse order /.test(p.management_notes));
    const samples = await h.order(sql, c, rep, { lines: [['SAF100', 1, true]] });
    const ps = await isf.payloadFor(sql, samples);
    assert.equal(ps.send_signature, true); assert.equal(ps.payment_method, 'card_on_file');
    await assert.rejects(isf.payloadFor(sql, '00000000-0000-0000-0000-000000000000'), /order_not_found/);
  });
});

test('ISF send: no key = not connected; token refused / 500 / junk, form 500 and a dead network are reasons, never throws; the form call carries the token', async () => {
  const isf = require('../../api/_isf');
  await h.withDb(async (sql) => {
    const rep = await h.user(sql); const c = await h.contact(sql, rep); const o = await h.order(sql, c, rep);
    delete process.env.PULSE_ISF_KEY; delete process.env.EDGE_ISF_SECRET;
    assert.deepEqual(await isf.send(sql, o), { queued: false, reason: 'n8n_not_connected' });
    process.env.PULSE_ISF_KEY = 'r4-fake-key';
    try {
      for (const [handler, want] of [
        [() => ({ status: 401, json: {} }), 'token_401'],
        [() => ({ json: { ok: false } }), 'token_refused'],
        [() => ({ text: 'not json' }), null],
        [() => { throw new Error('down'); }, 'down'],
      ]) {
        const f = h.fakeFetch(handler);
        try { const r = await isf.send(sql, o); assert.equal(r.queued, false); if (want) assert.equal(r.reason, want); } finally { f.restore(); }
      }
      let n = 0;
      const f = h.fakeFetch((url) => (/token/.test(url) ? { json: { ok: true, token: 'tok.' + (++n) } } : { status: 500, text: 'boom' }));
      try { const r = await isf.send(sql, o); assert.equal(r.reason, 'n8n_500'); assert.equal(f.calls[1].init.headers['X-CSRF-Token'], 'tok.1'); assert.ok(/^https:\/\/renellence\.app\.n8n\.cloud\//.test(f.calls[1].url)); } finally { f.restore(); }
      const g = h.fakeFetch((url) => (/token/.test(url) ? { json: { ok: true, token: 'tok' } } : { json: { ok: true } }));
      try { assert.deepEqual(await isf.send(sql, o), { queued: true }); } finally { g.restore(); }
    } finally { delete process.env.PULSE_ISF_KEY; }
  });
});

test('resend pay link: no order number, refused, nothing open, sent, slow: always an answer', async () => {
  const isf = require('../../api/_isf');
  await h.withDb(async (sql) => {
    const rep = await h.user(sql); const c = await h.contact(sql, rep); const o = await h.order(sql, c, rep);
    delete process.env.PULSE_ISF_KEY;
    assert.equal((await isf.resendPayLink(sql, o)).reason, 'n8n_not_connected');
    process.env.PULSE_ISF_KEY = 'r4-fake-key';
    try {
      await sql`update orders set order_number = null where id = ${o}`.catch(() => {});
      for (const [handler, want] of [
        [() => ({ status: 500 }), 'n8n_500'], [() => ({ json: { sent: false, reason: 'already_paid' } }), 'already_paid'],
        [() => ({ json: {} }), 'no_open_link'], [() => { const e = new Error('x'); e.name = 'AbortError'; throw e; }, 'n8n_timeout'], [() => { throw new Error('x'); }, 'n8n_unreachable'],
      ]) {
        await sql`update orders set order_number = ${'R4-' + t} where id = ${o}`;
        const f = h.fakeFetch(handler);
        try { assert.equal((await isf.resendPayLink(sql, o)).reason, want); } finally { f.restore(); }
      }
      await sql`update orders set order_number = ${'R4-' + t} where id = ${o}`;
      const f = h.fakeFetch(() => ({ json: { sent: true } }));
      try { assert.deepEqual(await isf.resendPayLink(sql, o), { queued: true }); assert.deepEqual(JSON.parse(f.calls[0].body).orderNumber, 'R4-' + t); } finally { f.restore(); }
    } finally { delete process.env.PULSE_ISF_KEY; }
  });
});

test('SignatureAPI sync: odd envelopes (no recipients, no metadata, unknown status, test mode) never throw; unmatched are counted', async () => {
  const S = require('../../api/_sigapi');
  process.env.SIGNATUREAPI_KEY = 'r4-fake-key';
  try {
    await h.withDb(async (sql) => {
      const rep = await h.user(sql);
      await h.contact(sql, rep, { email: 'sig.r4.' + t + '@demo.invalid' });
      const now = new Date().toISOString();
      const envs = [
        { id: 'r4env1' + t, title: 'Onboarding Agreement', status: 'in_progress', mode: 'live', created_at: now, metadata: { customer_email: 'sig.r4.' + t + '@demo.invalid' }, recipients: null },
        { id: 'r4env2' + t, title: 'x', status: 'weird', mode: 'live', created_at: now, metadata: null, recipients: [] },
        { id: 'r4env3' + t, title: 'Onboarding', status: 'completed', mode: 'test', created_at: now },
        { id: 'r4env4' + t, title: 'Training', status: 'completed', mode: 'live', created_at: 'garbage', metadata: { participant_email: 'nobody.' + t + '@demo.invalid' } },
      ];
      const f = h.fakeFetch((url) => (/envelopes\?/.test(url) ? { json: { data: envs, links: {} } } : { status: 404, json: { title: 'not found' } }));
      try {
        const r = await S.sync(sql, 20000);
        assert.ok(!r.listError, 'list ok: ' + JSON.stringify(r));
        assert.equal(r.added, 1); assert.equal(r.unmatched >= 1, true);
        assert.equal(f.calls[0].init.headers['X-API-Key'], 'r4-fake-key');
        assert.ok(f.calls.every((c) => /^https:\/\/api\.signatureapi\.com\//.test(c.url)));
        const r2 = await S.sync(sql, 20000);
        assert.equal(r2.added, 0);
      } finally { f.restore(); }
      // the list down / slow
      for (const hd of [() => ({ status: 500, json: {} }), () => { throw new Error('down'); }]) { const g = h.fakeFetch(hd); try { const r = await S.sync(sql, 5000); assert.ok(r.listError || r.refreshed >= 0); } finally { g.restore(); } }
      // remind: nobody waiting, reminded recently, a good one
      const cases = [
        [{ json: { status: 'completed' } }, 'not_waiting'], [{ json: { status: 'in_progress', recipients: [{ id: 'r1', type: 'signer', status: 'completed' }] } }, 'nobody_to_remind'],
      ];
      for (const [reply, want] of cases) { const g = h.fakeFetch(() => reply); try { assert.equal((await S.remind('env-x')).reason, want); } finally { g.restore(); } }
      const g = h.fakeFetch((url, init) => (init.method === 'POST' ? { status: 429, json: {} } : { json: { status: 'in_progress', recipients: [{ id: 'r1', type: 'signer', status: 'sent', name: 'Dr Fiction' }] } }));
      try { assert.equal((await S.remind('env-x')).reason, 'reminded_recently'); } finally { g.restore(); }
    });
  } finally { delete process.env.SIGNATUREAPI_KEY; }
});

test('Gmail send: a header-injection attempt in the subject or address cannot add a header; nothing goes without a connection', async () => {
  const G = require('../../api/_gmail');
  const { seal } = require('../../api/_crypto');
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    await assert.rejects(G.send(sql, me, { to: 'x@demo.invalid', subject: 's', text: 't' }), /gmail_not_connected/);
    await sql`insert into connections (user_id, provider, external_account, credentials_encrypted, status) values (${me.id}, 'gmail', ${me.email}, ${seal('fake-refresh')}, 'connected')`;
    const f = h.fakeFetch((url) => (/oauth2/.test(url) ? { json: { access_token: 'fake-at' } } : { json: { id: 'm1', threadId: 't1' } }));
    try {
      await G.send(sql, me, { to: 'a@demo.invalid\r\nBcc: spy@demo.invalid', subject: 'Hi\r\nBcc: spy@demo.invalid', text: 'body' });
      const sent = JSON.parse(f.calls[1].body).raw;
      const raw = Buffer.from(sent.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const head = raw.split('\r\n\r\n')[0].split('\r\n');
      assert.ok(!head.some((l) => /^Bcc:/i.test(l)), 'no injected header: ' + head.join(' / '));
      assert.ok(f.calls.every((c) => /googleapis\.com/.test(c.url)));
    } finally { f.restore(); }
    // a refused token (invalid_grant) marks the connection broken and says reconnect
    const g = h.fakeFetch((url) => (/oauth2/.test(url) ? { status: 400, json: { error: 'invalid_grant' } } : { json: {} }));
    try { await assert.rejects(G.send(sql, me, { to: 'a@demo.invalid', subject: 's', text: 't' }), /gmail_reconnect/); } finally { g.restore(); }
    const [c] = await sql`select status from connections where user_id = ${me.id}`;
    assert.equal(c.status, 'broken');
  });
});

test('the timer called directly: wrong key 401, unknown op 400, tick with every connector off or stubbed answers 200 and sends nothing', async () => {
  process.env.CRON_SECRET = 'test-cron-key';
  delete process.env.N8N_INTAKE_SECRET; delete process.env.SIGNATUREAPI_KEY; delete process.env.SIGNATURE_API_KEY; delete process.env.N8N_MYFIFTY_URL; delete process.env.PULSE_ISF_KEY;
  const cron = require('../../api/cron');
  await h.withDb(async () => {
    const call = async (url, headers) => { const res = h.fakeRes(); await cron({ method: 'GET', url, headers: headers || {} }, res); return res; };
    assert.equal((await call('/api/cron?op=tick')).statusCode, 401);
    assert.equal((await call('/api/cron?op=tick', { 'x-cron-key': 'wrong' })).statusCode, 401);
    assert.equal((await call('/api/cron?op=wires')).statusCode, 401);
    assert.equal((await call('/api/cron?op=nope', { 'x-cron-key': 'test-cron-key' })).statusCode, 400);
    assert.equal((await call('/api/cron?op=__proto__', { 'x-cron-key': 'test-cron-key' })).statusCode, 400);
    const f = h.fakeFetch(() => { throw new Error('the timer reached for the network with every connector off'); });
    try {
      const r = await call('/api/cron?op=tick', { 'x-cron-key': 'test-cron-key' });
      assert.equal(r.statusCode, 200, r.body);
      const j = r.json();
      assert.equal(j.meta.skipped, 'not_set_up'); assert.equal(j.signatureapi.skipped, 'not_set_up');
      assert.equal(f.calls.length, 0, 'no outside call: ' + JSON.stringify(f.calls.map((c) => c.url)));
    } finally { f.restore(); }
  });
});
