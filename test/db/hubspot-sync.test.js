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

test('a rep\'s call brings in someone left out on Oct 22; an automated task does not; a merged-away id lands on the kept contact; someone v2 removed stays out', async () => {
  await h.withDb(async (sql) => {
    const n = Date.now() % 1e8;
    const rep = await h.user(sql);
    const kept = await h.contact(sql, rep), gone = await h.contact(sql, rep);
    const keptHs = String(893000000 + n), mergedHs = String(894000000 + n), oldHs = String(895000000 + n), autoHs = String(896000000 + n), goneHs = String(897000000 + n);
    await sql`update contacts set legacy_id = ${keptHs} where id = ${kept}`;
    await sql`update contacts set legacy_id = ${goneHs}, deleted_at = now() where id = ${gone}`;
    await sql`delete from settings where key = 'hubspot_sync'`;
    const now = new Date().toISOString(), info = '265024690';
    const person = (id, first) => ({ id, properties: { firstname: first, lastname: 'Leftout', email: first.toLowerCase() + '.' + n + '@demo.invalid', createdate: '2026-05-01T00:00:00Z', lastmodifieddate: now } });
    const people = { [oldHs]: person(oldHs, 'Worked'), [autoHs]: person(autoHs, 'Automated'), [goneHs]: person(goneHs, 'Removed'), [keptHs]: person(keptHs, 'Kept') };
    const call = (id, contact) => ({ id, contact, properties: { hs_timestamp: now, hs_call_direction: 'OUTBOUND', hs_call_body: 'Checked in', hs_object_source: 'CRM_UI', hubspot_owner_id: info, hs_lastmodifieddate: now } });
    const db = {
      contacts: [],
      calls: [call('W' + n, oldHs), call('M' + n, mergedHs), call('G' + n, goneHs)],
      tasks: [{ id: 'X' + n, contact: autoHs, properties: { hs_task_subject: 'Auto follow-up', hs_task_status: 'NOT_STARTED', hs_timestamp: now, hs_createdate: now, hubspot_owner_id: info,
        hs_object_source_detail_1: 'Automation Platform Flow', hs_lastmodifieddate: now } }],
    };
    const all = db.calls.concat(db.tasks);
    const real = global.fetch;
    process.env.HUBSPOT_READ_TOKEN = 'unit';
    global.fetch = async (url, opts) => {
      const u = new URL(url);
      const ok = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) });
      let m;
      if ((m = u.pathname.match(/\/crm\/v3\/objects\/(\w+)\/search$/))) return ok({ results: (db[m[1]] || []).map(({ id, properties }) => ({ id, properties })) });
      if ((m = u.pathname.match(/\/crm\/v4\/associations\/(\w+)\/contacts\/batch\/read$/))) return ok({ results: JSON.parse(opts.body).inputs.map((x) => ({ from: { id: x.id }, to: [{ toObjectId: all.find((a) => a.id === x.id).contact }] })) });
      if ((m = u.pathname.match(/\/crm\/v3\/objects\/contacts\/(\d+)$/))) { const c = people[m[1] === mergedHs ? keptHs : m[1]]; return ok({ id: c.id, properties: c.properties, associations: {} }); }
      throw new Error('unexpected ' + url);
    };
    try {
      await I.sync(sql, 20000);
      const [back] = await sql`select id, deleted_at from contacts where legacy_id = ${oldHs}`;
      assert.ok(back && !back.deleted_at, 'the person the rep called is in v2 now');
      const [{ n: calls }] = await sql`select count(*)::int n from interactions where contact_id = ${back.id} and kind = 'call'`;
      assert.equal(calls, 1, 'with the call');
      const [{ n: auto }] = await sql`select count(*)::int n from contacts where legacy_id = ${autoHs}`;
      assert.equal(auto, 0, 'an automation\'s task brings no one back');
      const [{ n: merged }] = await sql`select count(*)::int n from interactions where contact_id = ${kept} and external_id = ${'hubspot:call:M' + n}`;
      assert.equal(merged, 1, 'the call on the merged-away id is on the kept contact');
      const [{ n: dup }] = await sql`select count(*)::int n from contacts where legacy_id = ${mergedHs}`;
      assert.equal(dup, 0, 'no second contact for the merged-away id');
      const [{ n: removed }] = await sql`select count(*)::int n from interactions where contact_id = ${gone}`;
      assert.equal(removed, 0, 'someone v2 removed stays out, and gets nothing');
    } finally { global.fetch = real; }
  });
});
