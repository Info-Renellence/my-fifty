// Meta leads straight into v2 (api/_meta.js, Yousef 2026-10-27) on the TEST database, rolled back; Edge's feed faked.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const META = require('../../api/_meta');
const M = require('../../api/_hsmap');

after(() => h.closeDb());

test('a new Meta lead becomes a social lead owned by Edge\'s rep; a known person is matched, not doubled; a shared area has no owner', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const known = await h.contact(sql, me, { email: 'known.meta@demo.invalid' });
    await sql`delete from settings where key = 'meta_sync'`;
    const n = Date.now();
    const leads = [
      { id: 'L1' + n, at: new Date().toISOString(), ts: n, name: 'Mira Metalead', email: 'mira.meta@demo.invalid', phone: '(555) 010-0177', city: 'Toronto', postal: 'm5v1a1', province: 'ON', rep: 'Lucas' },
      { id: 'L2' + n, at: new Date().toISOString(), ts: n + 1, name: 'Known Person', email: 'KNOWN.META@demo.invalid', phone: '', rep: 'Sam' },
      { id: 'L3' + n, at: new Date().toISOString(), ts: n + 2, name: 'Shared Area', email: 'shared.meta@demo.invalid', phone: '', rep: 'Lucas or Sam' },
    ];
    const real = global.fetch;
    process.env.N8N_INTAKE_SECRET = 'unit';
    let asked = null;
    global.fetch = async (url, opts) => { asked = { url: String(url), key: opts.headers['X-Intake-Secret'] }; return { ok: true, json: async () => ({ leads, failed: [] }) }; };
    try {
      const r = await META.sync(sql);
      assert.match(asked.url, /kind=adleads-feed&sinceMs=\d+/);
      assert.equal(asked.key, 'unit');
      assert.deepEqual([r.added, r.matched], [2, 1]);
      const [a] = await sql`select lead_source::text, owner_id, shipping_postal_code, first_name from contacts where meta_lead_id = ${'L1' + n}`;
      assert.deepEqual([a.lead_source, a.owner_id, a.shipping_postal_code, a.first_name], ['social', M.uid('user:lucas.stockley@renellence.com'), 'M5V 1A1', 'Mira']);
      const [k] = await sql`select meta_lead_id from contacts where id = ${known}`;
      assert.equal(k.meta_lead_id, 'L2' + n, 'the known person gets the lead id, no second contact');
      const [s] = await sql`select owner_id from contacts where meta_lead_id = ${'L3' + n}`;
      assert.equal(s.owner_id, null);
      const again = await META.sync(sql);
      assert.equal(again.added, 0, 'nothing twice');
    } finally { global.fetch = real; delete process.env.N8N_INTAKE_SECRET; }
  });
});
