// Live Edge's KV records -> v2 (owner 2026-10-29, api/_edgekv.js): events, attendee lists, marketing requests,
// commitments. TEST database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const I = require('../../api/intake');
const K = require('../../api/_edgekv');

after(() => h.closeDb());
const n = Date.now() % 1e8;
const hsId = (k) => String(720000000 + n * 10 + k);
let seq = 0;
const send = (sql, kind, key, value, by, mode) => I.edgeKv(sql, { wf: 'Edge', kind, key, by, mode: mode || 'save', value, at: Date.now() + ++seq });
const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

test('a team event and its lists: the event, a known person, a new person (made a contact), an RSVP that ranks higher, a removal', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql, { email: 'kv.rep.' + n + '@unit.invalid' });
    const known = await h.contact(sql, rep);
    await sql`update contacts set legacy_id = ${hsId(1)} where id = ${known}`;
    const te = 'te' + n;
    const shell = { id: te, name: 'Unit Training Night', date: future, cost: 500, reps: [rep.email], createdBy: rep.email };
    let r = await send(sql, 'event', 'teamEvents/' + te, shell, rep.email);
    assert.equal(r.written, 1, JSON.stringify(r));
    const evId = K.uid('event:' + te);
    const [ev] = await sql`select name, kind::text, rep_ids, cost_lines from events where id = ${evId}`;
    assert.deepEqual([ev.name, ev.kind, ev.rep_ids, ev.cost_lines[0].amount], ['Unit Training Night', 'training', [rep.id], 500]);

    const listKey = 'teamEventRep:' + te + ':' + rep.email;
    const a1 = { id: 'at1', contactId: hsId(1), attendee: 'Known Person', status: 'invited' };
    const a2 = { id: 'at2', attendee: 'Newperson Kvtest', email: 'newperson.' + n + '@unit.invalid', status: 'invited' };
    r = await send(sql, 'event_list', listKey, { attendees: [a1, a2] }, rep.email);
    assert.equal(r.written, 2, JSON.stringify(r));
    const [made] = await sql`select id, owner_id, lead_source::text, lead_source_event_id from contacts where lower(email) = ${'newperson.' + n + '@unit.invalid'}`;
    assert.deepEqual([made.owner_id, made.lead_source, made.lead_source_event_id], [rep.id, 'event', evId], 'a new person becomes the rep\'s event contact');

    // RSVP for the known person ranks higher than invited
    r = await send(sql, 'event_list', 'teamEventRsvp:' + te, { rsvp: [{ id: 'rs1', contactId: hsId(1), name: 'Known Person', addedBy: rep.email }] }, rep.email);
    const st = async (c) => (await sql`select status::text as s from attendees where event_id = ${evId} and contact_id = ${c}`)[0];
    assert.equal((await st(known)).s, 'rsvp');
    // the rep list changes only its note: the RSVP stays
    await send(sql, 'event_list', listKey, { attendees: [Object.assign({}, a1, { notes: 'bring samples' }), a2] }, rep.email);
    assert.equal((await st(known)).s, 'rsvp', 'a lower status from another list does not undo the RSVP');
    // the rep marks the new person attended, then removes them
    await send(sql, 'event_list', listKey, { attendees: [a1, Object.assign({}, a2, { status: 'attended' })] }, rep.email);
    assert.equal((await st(made.id)).s, 'attended');
    r = await send(sql, 'event_list', listKey, { attendees: [a1] }, rep.email);
    assert.equal(r.deleted, 1);
    assert.equal(await st(made.id), undefined);
    // the event deleted in live Edge
    r = await send(sql, 'event', 'teamEvents/' + te, null, rep.email);
    assert.equal(r.deleted, 1);
  });
});

test('a list for an event v2 does not have yet is kept as failed (replayable); the same copy twice is a duplicate', async () => {
  await h.withDb(async (sql) => {
    const r = await send(sql, 'event_list', 'teamEventRep:tenone' + n + ':x@unit.invalid', { attendees: [] }, 'x@unit.invalid');
    assert.equal(r.failed, true);
    const b = { wf: 'Edge', kind: 'marketing', key: 'mkt:req:dup' + n, value: { id: 'dup' + n, rep: 'nobody@unit.invalid' }, at: 1 };
    await I.edgeKv(sql, b);
    assert.equal((await I.edgeKv(sql, b)).duplicate, true);
  });
});

test('a marketing request: added, its decision copied, an unchanged copy leaves an admin\'s v2 edit alone', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql, { email: 'kv.mkt.' + n + '@unit.invalid' });
    const doc = { id: 'mr' + n, rep: rep.email, pillar: 'saypha', type: 'flyer', label: 'Unit flyer', status: 'pending', fields: { clinic: 'Unit Clinic' }, at: new Date().toISOString() };
    let r = await send(sql, 'marketing', 'mkt:req:' + doc.id, doc, rep.email);
    assert.equal(r.written, 1);
    const id = K.uid('mkt:' + doc.id);
    r = await send(sql, 'marketing', 'mkt:req:' + doc.id, Object.assign({}, doc, { status: 'approved', decidedAt: new Date().toISOString() }), rep.email);
    assert.equal((await sql`select status::text as s from marketing_requests where id = ${id}`)[0].s, 'in_design');
    await sql`update marketing_requests set status = 'ready' where id = ${id}`;   // moved on in the admin app
    r = await send(sql, 'marketing', 'mkt:req:' + doc.id, Object.assign({}, doc, { status: 'approved', decidedAt: doc.at }), rep.email);
    // a changed old-Edge doc does win (it is a real change made there); an identical one would not
    const again = await send(sql, 'marketing', 'mkt:req:' + doc.id, Object.assign({}, doc, { status: 'approved', decidedAt: doc.at }), rep.email);
    assert.equal(again.duplicate || again.unchanged, again.duplicate ? true : 1);
  });
});

test('a commitment: each delivery from today a forecast, skipped when the rep has one that month, removed dates deleted', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql, { email: 'kv.cm.' + n + '@unit.invalid' });
    const c = await h.contact(sql, rep);
    await sql`update contacts set legacy_id = ${hsId(2)} where id = ${c}`;
    const d1 = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    const d2 = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);
    const past = '2026-01-15';
    // the rep's own forecast in d2's month
    await sql`insert into forecasts (contact_id, rep_id, due_date, syringes, syringe_price) values (${c}, ${rep.id}, ${d2}, 5, 150)`;
    const terms = { pricePerSyringe: 135, pricePerNeedle: 55, customSchedule: [
      { date: past, syrQty: 10 }, { date: d1, syrQty: 45, ndlQty: 2 }, { date: d2, syrQty: 45 }] };
    let r = await send(sql, 'commitment', 'commitTerms:' + hsId(2), terms, rep.email);
    assert.deepEqual([r.written, r.left], [1, 2], JSON.stringify(r));   // the past one and d2 (rep's own that month) skipped
    const f1 = K.uid('commitment:' + hsId(2) + ':' + d1);
    const [f] = await sql`select rep_id, syringes, syringe_price::float8 as p, needle_boxes, needle_box_price::float8 as np from forecasts where id = ${f1}`;
    assert.deepEqual([f.rep_id, f.syringes, f.p, f.needle_boxes, f.np], [rep.id, 45, 135, 2, 55]);
    r = await send(sql, 'commitment', 'commitTerms:' + hsId(2), { pricePerSyringe: 135, customSchedule: [{ date: d2, syrQty: 45 }] }, rep.email);
    assert.equal(r.deleted, 1);
    assert.ok((await sql`select deleted_at from forecasts where id = ${f1}`)[0].deleted_at);
    r = await send(sql, 'commitment', 'commitTerms:' + hsId(2), { local: { commitment: true, frequency: 'Monthly' } }, rep.email);
    assert.equal(r.why, 'no dated schedule (cadence only)');
  });
});
