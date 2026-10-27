// The HubSpot sync in the timer (api/intake.js sync, owner 2026-10-27) on the TEST database, rolled back; HubSpot faked.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const I = require('../../api/intake');
const M = require('../../api/_hsmap');

after(() => h.closeDb());

test('a tick brings in a new lead, a rep\'s call and note on a known contact, a task, and skips old left-out people and automated notes', async () => {
  await h.withDb(async (sql) => {
    const n = Date.now() % 1e8;
    const rep = await h.user(sql);
    const known = await h.contact(sql, rep);
    const knownHs = String(890000000 + n);
    await sql`update contacts set legacy_id = ${knownHs} where id = ${known}`;
    await sql`delete from settings where key = 'hubspot_sync'`;
    const newHs = String(891000000 + n), oldHs = String(892000000 + n);
    const now = new Date().toISOString();
    const db = {
      contacts: [{ id: newHs, properties: { firstname: 'Nova', lastname: 'Synclead', email: 'nova.sync@demo.invalid', createdate: now, lastmodifieddate: now, hs_analytics_source: 'PAID_SOCIAL' } },
        { id: oldHs, properties: { firstname: 'Old', lastname: 'Leftout', email: 'old.left@demo.invalid', createdate: '2026-05-01T00:00:00Z', lastmodifieddate: now } }],
      calls: [{ id: 'C' + n, properties: { hs_timestamp: now, hs_call_direction: 'OUTBOUND', hs_call_disposition: 'f240bbac-87c9-4f6e-bf70-924b57d47db7', hs_call_body: 'Talked lips', hs_object_source: 'CRM_UI', hs_lastmodifieddate: now } }],
      notes: [{ id: 'N' + n, properties: { hs_note_body: '<p>Bring the demo kit</p>', hs_timestamp: now, hs_object_source: 'MOBILE_IOS', hs_lastmodifieddate: now } },
        { id: 'A' + n, properties: { hs_note_body: 'Lead clean: old values', hs_timestamp: now, hs_object_source: 'INTEGRATION', hs_lastmodifieddate: now } }],
      tasks: [{ id: 'T' + n, properties: { hs_task_subject: 'Call back Monday', hs_task_status: 'NOT_STARTED', hs_timestamp: now, hs_createdate: now, hs_lastmodifieddate: now } }],
    };
    const real = global.fetch;
    process.env.HUBSPOT_READ_TOKEN = 'unit';
    global.fetch = async (url, opts) => {
      const u = new URL(url);
      const ok = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) });
      let m;
      if ((m = u.pathname.match(/\/crm\/v3\/objects\/(\w+)\/search$/))) return ok({ results: db[m[1]] || [] });
      if ((m = u.pathname.match(/\/crm\/v4\/associations\/(\w+)\/contacts\/batch\/read$/))) return ok({ results: JSON.parse(opts.body).inputs.map((x) => ({ from: { id: x.id }, to: [{ toObjectId: knownHs }] })) });
      if ((m = u.pathname.match(/\/crm\/v3\/objects\/contacts\/(\d+)$/))) { const c = db.contacts.find((x) => x.id === m[1]); return ok({ id: m[1], properties: c.properties, associations: {} }); }
      throw new Error('unexpected ' + url);
    };
    try {
      const r = await I.sync(sql, 20000);
      assert.equal(r.contacts.added, 1, 'the new lead');
      const [lead] = await sql`select lead_source::text from contacts where legacy_id = ${newHs}`;
      assert.equal(lead.lead_source, 'social');
      const [{ n: old }] = await sql`select count(*)::int n from contacts where legacy_id = ${oldHs}`;
      assert.equal(old, 0, 'someone left out on Oct 22 stays out');
      const ints = await sql`select kind::text, body from interactions where contact_id = ${known} order by kind`;
      assert.deepEqual(ints.map((x) => x.kind), ['call', 'note']);
      assert.equal(ints.find((x) => x.kind === 'note').body, 'Bring the demo kit');
      const [t] = await sql`select title, status::text from tasks where id = ${M.uid('task:T' + n)}`;
      assert.deepEqual([t.title, t.status], ['Call back Monday', 'open']);
      const [s] = await sql`select value from settings where key = 'hubspot_sync'`;
      assert.ok(s.value.calls && s.value.notes, 'bookmarks saved');
      const again = await I.sync(sql, 20000);
      assert.equal(again.calls.added, 0, 'the same call is not added twice');
    } finally { global.fetch = real; }
  });
});
