// Run 4 (2026-10-27): the connectors with stubbed replies, odd input. Test database only (v1), every test rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

after(() => h.closeDb());
const t = Date.now();
const FEED_OK = (leads) => () => ({ json: { leads } });

test('a key with a multi-byte character is a clean 401 on quo, intake and cron (not a 500)', async () => {
  process.env.N8N_INTAKE_SECRET = 'abcdefgh'; process.env.CRON_SECRET = 'abcdefgh';
  const quo = require('../../api/quo'), intake = require('../../api/intake'), cron = require('../../api/cron');
  const bad = 'abcdefgé';   // 8 characters, 9 bytes
  for (const [name, fn, req] of [
    ['quo', quo, { method: 'POST', url: '/api/quo?key=' + encodeURIComponent(bad), headers: {}, body: '{}' }],
    ['intake', intake, { method: 'POST', url: '/api/intake', headers: { 'x-intake-secret': bad }, body: {} }],
    ['cron', cron, { method: 'GET', url: '/api/cron?op=tick', headers: { 'x-cron-key': bad } }],
  ]) {
    const res = h.fakeRes();
    await fn(req, res);
    assert.equal(res.statusCode, 401, name + ' answered ' + res.statusCode);
  }
});

test('meta: one bad lead in the feed does not block the leads after it, and the bookmark moves on', async () => {
  process.env.N8N_INTAKE_SECRET = 'test-intake-key';
  const meta = require('../../api/_meta');
  await h.withDb(async (sql) => {
    const base = Date.now() + 5000;
    const f = h.fakeFetch(FEED_OK([
      { id: 'demo-test-r4-m1-' + t, name: 'Zed Probefour', email: 'zed.r4.' + t + '@demo.invalid', phone: '(555) 010-0191', city: 'Testville', postal: 'm5v2t6', province: 'on', rep: 'Lucas or Sam', ts: base, at: 'not a date' },
      { id: 'demo-test-r4-m2-' + t, name: 'Yara Probefour', email: 'yara.r4.' + t + '@demo.invalid', phone: '(555) 010-0192', city: 'Testville', postal: 'M5V 2T6', province: 'ON', rep: 'Emily', ts: base + 1, at: new Date().toISOString() },
    ]));
    try {
      const r = await meta.sync(sql);
      assert.ok(!r.error, 'sync threw: ' + JSON.stringify(r));
      assert.equal(r.seen, 2);
      const rows = await sql`select meta_lead_id from contacts where meta_lead_id in (${'demo-test-r4-m1-' + t}, ${'demo-test-r4-m2-' + t})`;
      assert.equal(rows.length, 2, 'both leads are saved');
      const [b] = await sql`select value from settings where key = 'meta_sync'`;
      assert.ok(b.value.sinceMs > base, 'the bookmark moved past the feed');
    } finally { f.restore(); }
  });
});

test('meta: normal feed: added, known on repeat, matched by email, shared area has no owner, odd names', async () => {
  process.env.N8N_INTAKE_SECRET = 'test-intake-key';
  const meta = require('../../api/_meta');
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    await h.contact(sql, me, { email: 'known.r4.' + t + '@demo.invalid' });
    const base = Date.now() + 9000;
    const leads = [
      { id: 'demo-test-r4-a-' + t, name: 'No name', email: 'a.r4.' + t + '@demo.invalid', phone: '', city: '', postal: '', rep: 'Lucas or Sam', ts: base, at: new Date().toISOString() },
      { id: 'demo-test-r4-b-' + t, name: '<b>Bold</b> Élodie O\'Brien-Smith', email: 'known.r4.' + t + '@DEMO.invalid', phone: '555-010-0193', rep: 'Emily', ts: base + 1 },
      { id: 'demo-test-r4-c-' + t, name: '', email: '', phone: '', rep: '', ts: base + 2 },
      { id: '', name: 'No id', ts: base + 3 },
    ];
    const f = h.fakeFetch(FEED_OK(leads));
    try {
      const r = await meta.sync(sql);
      assert.equal(r.added, 2); assert.equal(r.matched, 1); assert.equal(r.known, 1);
      const [a] = await sql`select owner_id, lead_source::text s, first_name from contacts where meta_lead_id = ${'demo-test-r4-a-' + t}`;
      assert.equal(a.owner_id, null); assert.equal(a.s, 'social'); assert.equal(a.first_name, null);
      await sql`update settings set value = '{"sinceMs": 1}'::jsonb where key = 'meta_sync'`;
      const r2 = await meta.sync(sql);
      assert.equal(r2.added, 0, 'the same leads again add nothing');
      assert.equal(f.calls[0].init.headers['X-Intake-Secret'], 'test-intake-key');
      assert.ok(/^https:\/\/edge\.renellence\.com\//.test(f.calls[0].url));
    } finally { f.restore(); }
  });
});

test('meta: the feed down, slow answers and junk are an error word, never a throw', async () => {
  process.env.N8N_INTAKE_SECRET = 'test-intake-key';
  const meta = require('../../api/_meta');
  await h.withDb(async (sql) => {
    for (const [handler, want] of [[() => ({ status: 500 }), 'feed_500'], [() => ({ status: 401 }), 'feed_401'], [() => { throw new Error('down'); }, 'feed_unreachable'], [() => ({ text: 'not json' }), 'feed_unreachable']]) {
      const f = h.fakeFetch(handler);
      try { assert.deepEqual(await meta.sync(sql), { error: want, from: 'edge' }); } finally { f.restore(); }   // from: Edge's feed until META_ADS_TOKEN (2026-10-28)
    }
    const f = h.fakeFetch(() => ({ json: null }));
    try { const r = await meta.sync(sql); assert.equal(r.seen, 0); } finally { f.restore(); }
  });
});

test('quo: odd events never throw: bad date, numeric ids, empty data, array numbers', async () => {
  const Q = require('../../api/quo');
  await h.withDb(async (sql) => {
    const evs = [
      { id: 'r4a' + t, type: 'call.completed', data: { object: { id: 'r4ca' + t, direction: 'incoming', from: '+15550100191', createdAt: 'garbage' } } },
      { id: t, type: 'message.received', data: { object: { id: 'r4cb' + t, direction: 'incoming', from: ['+15550100192'] } } },
      { id: 'r4c' + t, type: 'call.completed' },
      { id: 'r4d' + t, type: 'call.completed', data: { object: { direction: 'outgoing', to: '' } } },
      { id: 'r4e' + t, type: 'call.summary.completed', data: { object: { callId: 'nope' + t, summary: ['x'] } } },
      { id: 'r4f' + t, type: 'weird.type', data: {} },
      null, {}, { id: 'only-id' },
    ];
    for (const e of evs) {
      const r = await Q.handle(sql, e);
      assert.ok(r && r.ok !== undefined, 'answered: ' + JSON.stringify(e));
    }
  });
});
