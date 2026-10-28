// Pulse reads Meta leads itself (api/_metaleads.js, owner 2026-10-28) on the TEST database, rolled back; Meta's Graph API faked.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const META = require('../../api/_meta');
const ML = require('../../api/_metaleads');
const M = require('../../api/_hsmap');

after(() => h.closeDb());

// A fake Graph API: one Page, one form, the leads given.
function fakeMeta(leads) {
  const asked = [];
  const fetch = async (url) => {
    const u = String(url);
    asked.push(u);
    const json = /\/promote_pages\?/.test(u) ? { data: [{ id: 'p1', name: 'Unit Page' }] }
      : /\/p1\?fields=access_token/.test(u) ? { access_token: 'page-token' }
      : /\/p1\/leadgen_forms\?/.test(u) ? { data: [{ id: 'f1', name: 'Interest Form v2', leads_count: leads.length }] }
      : /\/f1\/leads\?/.test(u) ? { data: leads } : { error: { code: 100, message: 'unexpected ' + u } };
    return { ok: !json.error, status: json.error ? 400 : 200, json: async () => json };
  };
  return { fetch, asked };
}
const field = (name, v) => ({ name, values: [v] });

test('leadRow: the rep from the postal area, else the province; a hand-assigned email wins; a shared area is both', () => {
  const row = (fd) => ML.leadRow({ id: 'x', created_time: '2026-10-28T12:00:00+0000', field_data: fd }, { name: 'F' }, { name: 'P' });
  assert.equal(row([field('post_code', 'L3R 0A1')]).rep, 'Lucas');
  assert.equal(row([field('province', 'Alberta')]).rep, 'Brittany');
  assert.equal(row([field('province', 'Nova Scotia')]).rep, 'Emily');
  assert.equal(row([field('post_code', 'L4S 1A1')]).rep, 'Lucas or Sam');
  assert.equal(row([field('email', 'latifiannazila@gmail.com'), field('post_code', 'L3R 0A1')]).rep, 'Sam');
  const r = row([field('first_name', 'Mira'), field('last_name', 'Metalead'), field('what_is_your_clinic_name?', 'Unit Clinic'), field('city', 'Markham')]);
  assert.deepEqual([r.name, r.clinic, r.city, r.ts > 0], ['Mira Metalead', 'Unit Clinic', 'Markham', true]);
});

test('with META_ADS_TOKEN the sync reads Meta itself (not Edge), with the Page token and the since filter', async () => {
  await h.withDb(async (sql) => {
    await sql`delete from settings where key = 'meta_sync'`;
    const n = Date.now();
    const f = fakeMeta([{ id: 'ML1' + n, created_time: new Date().toISOString(), field_data: [field('full_name', 'Nova Directlead'), field('email', 'nova.direct@demo.invalid'), field('post_code', 'M5V1A1'), field('province', 'ON')] }]);
    const real = global.fetch;
    process.env.META_ADS_TOKEN = 'unit-token';
    global.fetch = f.fetch;
    try {
      const r = await META.sync(sql);
      assert.equal(r.from, 'meta');
      assert.equal(r.added, 1, JSON.stringify(r));
      assert.ok(!f.asked.some((u) => /renellence\.com/.test(u)), 'never asks Edge');
      assert.ok(f.asked.some((u) => /\/f1\/leads\?/.test(u) && /access_token=page-token/.test(u) && /time_created/.test(u)), 'Page token and since');
      const [c] = await sql`select owner_id, lead_source::text, shipping_postal_code from contacts where meta_lead_id = ${'ML1' + n}`;
      assert.deepEqual([c.owner_id, c.lead_source, c.shipping_postal_code], [M.uid('user:lucas.stockley@renellence.com'), 'social', 'M5V 1A1']);
    } finally { global.fetch = real; delete process.env.META_ADS_TOKEN; }
  });
});

test('the n8n feed op: the Pulse ISF key, since checked, 503 without Meta', async () => {
  const cron = require('../../api/cron');
  const { Readable } = require('stream');
  const call = async (qs, key) => {
    const req = Readable.from([]); req.method = 'GET'; req.url = '/api/cron?' + qs; req.headers = key ? { 'x-edge-isf': key } : {};
    const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ''; } };
    await cron(req, res);
    return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : {} };
  };
  process.env.PULSE_ISF_KEY = 'unit-isf';
  const real = global.fetch;
  try {
    assert.notEqual((await call('op=adleads_feed', 'wrong')).status, 200);
    assert.equal((await call('op=adleads_feed', 'unit-isf')).status, 503, 'no Meta token');
    process.env.META_ADS_TOKEN = 'unit-token';
    assert.equal((await call('op=adleads_feed&since=2026-13', 'unit-isf')).status, 400);
    global.fetch = fakeMeta([{ id: 'ML2', created_time: '2026-10-28T12:00:00+0000', field_data: [field('email', 'feed@demo.invalid')] }]).fetch;
    const ok = await call('op=adleads_feed&since=2026-10-05', 'unit-isf');
    assert.equal(ok.status, 200);
    assert.equal(ok.data.leads[0].id, 'ML2');
  } finally { global.fetch = real; delete process.env.META_ADS_TOKEN; delete process.env.PULSE_ISF_KEY; }
});
