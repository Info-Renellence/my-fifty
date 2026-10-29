// Live Edge's own records -> v2 (owner 2026-10-29: "every change that is made in old edge (forecasts, commitments,
// whatever else) needs to translate into new pulse and new edge until the old edge is shut off"). Live Edge keeps these
// in its KV store, never in HubSpot, so only these copies carry them (HubSpot records come through the 5-minute pull).
// Live Edge (api/_v2copy.js) sends every write of one of these keys, with its new value, through /api/intake:
//   { wf: 'Edge', kind, key, mode: 'save' | 'catchup', by, value }      value null = the key was deleted
//   kind event       teamEvents/<id>               -> events            (owner's choice: same ids as Oct 22)
//   kind event_list  teamEventRep:<id>:<rep>, teamEventRsvp:<id>  -> attendees (a person v2 lacks becomes a contact,
//                    owned by the rep, lead source that event; owner 2026-10-29 "create the contact")
//   kind marketing   mkt:req:<id>                  -> marketing_requests
//   kind commitment  commitTerms:<HubSpot contact> -> forecasts, one per scheduled delivery from today on (owner
//                    2026-10-29: "each date = a forecast", skipped when the rep already has a forecast for that customer
//                    that month). Cadence-only terms (no dated schedule) have no dates to copy and are skipped.
// What changed is worked out against the previous copy of the same key (kept in ingest_events), so only real changes
// are applied and an edit made in v2 (Pulse, new Edge, admin) is not overwritten by an unchanged old-Edge record. With
// no previous copy (the first one, or the once-per-key catch-up) a record v2 lacks is added and one v2 still holds
// exactly as loaded on Oct 22 is brought up to date; nothing is deleted.
'use strict';
const crypto = require('crypto');

const MIGRATED_AT = '2026-10-22T23:00:00Z';
const uid = (key) => {
  const h = crypto.createHash('md5').update('renellence-migration-2026-10-22:' + key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const iso = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString() : null; };
const lc = (s) => String(s || '').trim().toLowerCase();
const e164 = (p) => { const x = String(p || '').replace(/\D/g, ''); if (x.length === 10) return '+1' + x; if (x.length === 11 && x[0] === '1') return '+' + x; return null; };
// Key order does not count (v2 hands jsonb back with its keys reordered).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a == null ? null : a)) === JSON.stringify(canon(b == null ? null : b));
const TEST = /\btest\b|demo|fake|patrick chen|asdf/i;
const RANK = { attended: 5, rsvp: 4, invited: 3, no_show: 2, cancelled: 1 };
const todayToronto = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());

async function userId(tx, email) {
  const e = lc(email);
  if (!e || e === 'admin@renellence.com') return null;
  const [u] = await tx`select id from users where lower(email) = ${e}`;
  return u ? u.id : null;
}
// A HubSpot contact id -> the v2 contact, following merges.
async function byHs(tx, hsId) {
  if (!hsId) return null;
  let [c] = await tx`select id, merged_into_contact_id as into, deleted_at from contacts where legacy_id = ${String(hsId)} limit 1`;
  for (let n = 0; c && c.into && n < 5; n++) [c] = await tx`select id, merged_into_contact_id as into, deleted_at from contacts where id = ${c.into}`;
  return c && !c.deleted_at ? c.id : null;
}

// ---- events ----------------------------------------------------------------------------------------------------
function eventRow(shell, users) {
  const cost_lines = (shell.costItems && shell.costItems.length) ? shell.costItems.map((x) => ({ item: x.item || x.name || x.label || 'Cost', amount: Number(x.amount || x.cost || 0) }))
    : shell.cost != null ? [{ item: 'Cost', amount: Number(shell.cost) }] : [];
  return { name: shell.name, starts_at: new Date(shell.date + 'T16:00:00Z').toISOString(), cost_lines, rep_ids: (shell.reps || []).map((e) => users[lc(e)]).filter(Boolean) };
}
async function usersByEmail(tx) {
  return Object.fromEntries((await tx`select id, lower(email) as e from users`).map((u) => [u.e, u.id]));
}
async function applyEvent(tx, c, prev, actor) {
  const shellId = c.key.split('/')[1];
  const id = uid('event:' + shellId);
  if (!c.value) {
    const n = (await tx`update events set deleted_at = now() where id = ${id} and deleted_at is null returning id`).length;
    return { table: 'events', id, deleted: n };
  }
  const users = await usersByEmail(tx);
  const row = eventRow(c.value, users);
  if (!c.value.name || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.value.date || ''))) return { skipped: true, why: 'event has no name or date' };
  const [cur] = await tx`select id, updated_at from events where id = ${id}`;
  if (!cur) {
    await tx`insert into events ${tx({ id, kind: /launch/i.test(row.name) ? 'launch' : 'training', created_by_id: users[lc(c.value.createdBy)] || actor, ...row,
      cost_lines: tx.json(row.cost_lines) })}`;
    return { table: 'events', id, written: 1 };
  }
  // Changed in old Edge since the last copy: the fields that changed. No previous copy: only a row untouched since Oct 22.
  const was = prev ? eventRow(prev, users) : null;
  const set = {};
  for (const k of Object.keys(row)) if (was ? !same(was[k], row[k]) : true) set[k] = row[k];
  if (!prev && new Date(cur.updated_at).toISOString() !== new Date(MIGRATED_AT).toISOString()) return { table: 'events', id, unchanged: 1 };
  if (!Object.keys(set).length) return { table: 'events', id, unchanged: 1 };
  if (set.cost_lines) set.cost_lines = tx.json(set.cost_lines);
  await tx`update events set ${tx(set)}, deleted_at = null where id = ${id}`;
  return { table: 'events', id, written: 1 };
}

// ---- attendees -------------------------------------------------------------------------------------------------
// The person for a list entry: their HubSpot contact, else one contact with that email or phone, else a new contact
// (owned by the rep, lead source event), as the Oct 22 move did. create=false only looks.
async function personFor(tx, a, ctx, create) {
  const c = await byHs(tx, a.contactId);
  if (c) return c;
  const email = lc(a.email), phone = e164(a.phone);
  if (email) {
    const r = await tx`select id from contacts where deleted_at is null and merged_into_contact_id is null and (lower(email) = ${email} or lower(secondary_email) = ${email}) limit 2`;
    if (r.length === 1) return r[0].id;
  }
  if (phone) {
    const r = await tx`select id from contacts where deleted_at is null and merged_into_contact_id is null and (phone = ${phone} or mobile_phone = ${phone}) limit 2`;
    if (r.length === 1) return r[0].id;
  }
  // Someone the Oct 22 move (or an earlier copy) already made a contact for, from this same list entry.
  const legacy = 'edge-attendee:' + ctx.shellId + '/' + a.id;
  if (ctx.shellId) {
    let [x] = await tx`select id, merged_into_contact_id as into, deleted_at from contacts where legacy_id = ${legacy} limit 1`;
    for (let n = 0; x && x.into && n < 5; n++) [x] = await tx`select id, merged_into_contact_id as into, deleted_at from contacts where id = ${x.into}`;
    if (x) return x.deleted_at ? null : x.id;
  }
  const nm = String(a.attendee || a.name || '').trim();
  if (!create || (!nm && !email && !phone)) return null;
  const key = 'evc:' + (email || phone || nm.toLowerCase().replace(/[^a-z]/g, ''));
  const id = uid('contact:' + key);
  const parts = nm.replace(/^dr\.?\s+/i, '').split(/\s+/).filter(Boolean);
  const md = /^dr\.?\s/i.test(nm);
  const [made] = await tx`insert into contacts ${tx({ id, owner_id: ctx.owner, first_name: parts[0] || null, last_name: parts.slice(1).join(' ') || null, email: email || null, phone,
    designation: md ? 'md' : null, role: md ? 'physician' : null, lead_source: 'event', lead_source_event_id: ctx.eventId, legacy_id: legacy })}
    on conflict do nothing returning id`;
  return made ? made.id : null;   // another unique field already taken: left out, never a failed list
}
function statusOf(a, list, past) {
  let s = list === 'rsvp' ? 'rsvp' : (RANK[a.status] ? a.status : 'attended');
  if (past && s === 'invited') s = 'no_show';
  return s;
}
async function applyList(tx, c, prev, actor) {
  // key teamEventRep:<event>:<rep> | teamEventRsvp:<event>
  const m = /^teamEvent(Rep|Rsvp):([^:]+)(?::(.+))?$/.exec(c.key);
  if (!m) return { skipped: true, why: 'unknown key' };
  const shellId = m[2], list = m[1] === 'Rsvp' ? 'rsvp' : 'rep', repEmail = m[3] || null;
  const eventId = uid('event:' + shellId);
  const [ev] = await tx`select id, starts_at from events where id = ${eventId}`;
  if (!ev) return { failed: true, why: 'event not in v2 yet' };   // kept failed: replayed once the event's copy lands
  const past = new Date(ev.starts_at).toISOString().slice(0, 10) < todayToronto();
  const entries = (v) => (v ? (list === 'rsvp' ? v.rsvp : v.attendees) || [] : []).filter((a) => a && a.id && !TEST.test((a.attendee || a.name || '') + ' ' + (a.email || '')));
  const now = entries(c.value), before = prev ? entries(prev) : [];
  const beforeById = new Map(before.map((a) => [a.id, a])), nowIds = new Set(now.map((a) => a.id));
  const out = { table: 'attendees', written: 0, deleted: 0, unchanged: 0, left: 0 };
  for (const a of now) {
    const old = beforeById.get(a.id);
    if (old && same(old, a)) { out.unchanged++; continue; }
    const inviter = await userId(tx, list === 'rsvp' ? a.addedBy : repEmail);
    const contact = await personFor(tx, a, { owner: inviter, eventId, shellId }, true);
    if (!contact) { out.left++; continue; }
    const status = statusOf(a, list, past);
    const [cur] = await tx`select id, status::text as status, updated_at from attendees where event_id = ${eventId} and contact_id = ${contact}`;
    if (!cur) {
      await tx`insert into attendees ${tx({ id: uid('attendee:' + shellId + '|' + contact), event_id: eventId, contact_id: contact, status,
        guest_count: Number(a.plusOnes || 0) || null, invited_by_id: inviter, note: a.notes || null })} on conflict (event_id, contact_id) do nothing`;
      out.written++;
      continue;
    }
    // No previous copy: only a row untouched since Oct 22 moves, and only up. Otherwise this list's change wins when it
    // set the row's current status (or ranks higher); a better status from another list or from v2 stays.
    if (c.mode === 'catchup' && new Date(cur.updated_at).toISOString() !== new Date(MIGRATED_AT).toISOString()) { out.unchanged++; continue; }
    const owned = old && statusOf(old, list, past) === cur.status;
    const next = owned || RANK[status] > RANK[cur.status] ? status : cur.status;
    await tx`update attendees set status = ${next}, guest_count = ${Number(a.plusOnes || 0) || null}, note = coalesce(${a.notes || null}, note) where id = ${cur.id}`;
    out.written++;
  }
  if (prev) {
    for (const [id, a] of beforeById) {
      if (nowIds.has(id)) continue;
      const contact = await personFor(tx, a, { shellId }, false);
      if (!contact) continue;
      const inviter = await userId(tx, list === 'rsvp' ? a.addedBy : repEmail);
      out.deleted += (await tx`delete from attendees where event_id = ${eventId} and contact_id = ${contact} and status = ${statusOf(a, list, past)}
        and (invited_by_id is null or invited_by_id = ${inviter}) returning id`).length;
    }
  }
  return out;
}

// ---- marketing requests ----------------------------------------------------------------------------------------
// The six test requests left out on Oct 22 (data-audit/edge-live/flags.json), so a catch-up doesn't bring them back.
const TEST_MKT = new Set(['mkmv179ewid93e07', 'mkmv17zwdta8b8e4', 'mkmv19hwjtce5847', 'mkmv19w9c3a12f72', 'mkmv1agt6x1d0641', 'mkmv1ax6bvd73a5b']);
async function applyMarketing(tx, c, prev) {
  if (!c.value) return { skipped: true, why: 'removed in live Edge (kept in v2)' };
  const r = c.value;
  if (TEST_MKT.has(r.id) || TEST.test(String(r.label || ''))) return { skipped: true, why: 'test request' };
  const requester = await userId(tx, r.rep);
  if (!requester) return { skipped: true, why: 'requester has no user' };
  const st = { pending: 'sent', approved: 'in_design', declined: 'declined', cancelled: 'cancelled', ready: 'ready', done: 'delivered', delivered: 'delivered' }[r.status] || 'sent';
  const fl = r.fields || {};
  const details = [fl.clinic && 'Clinic: ' + fl.clinic, fl.date && 'Date: ' + fl.date, fl.time && 'Time: ' + fl.time, fl.place && 'Place: ' + fl.place, fl.host && 'Host: ' + fl.host,
    fl.handle && 'Handle: ' + fl.handle, fl.extra && 'Extra: ' + fl.extra, r.note && 'Note: ' + r.note].filter(Boolean).join('\n') || null;
  const row = { requester_id: requester, contact_id: await byHs(tx, r.contactId), product_line: r.sub || r.pillar || null, material: r.type || null, campaign: r.label || null,
    details, status: st, in_design_at: st === 'in_design' ? iso(r.decidedAt) : null, decided_by_id: r.decidedBy ? await userId(tx, r.decidedBy) : null, decided_at: iso(r.decidedAt),
    decline_reason: st === 'declined' ? (r.decision || null) : null };
  const id = uid('mkt:' + r.id);
  const [cur] = await tx`select id, updated_at from marketing_requests where id = ${id}`;
  if (!cur) { await tx`insert into marketing_requests ${tx({ id, created_at: iso(r.at) || new Date().toISOString(), ...row })}`; return { table: 'marketing_requests', id, written: 1 }; }
  if (prev ? same(prev, r) : new Date(cur.updated_at).toISOString() !== new Date(MIGRATED_AT).toISOString()) return { table: 'marketing_requests', id, unchanged: 1 };
  await tx`update marketing_requests set ${tx(row)} where id = ${id}`;
  return { table: 'marketing_requests', id, written: 1 };
}

// ---- commitments -> forecasts ----------------------------------------------------------------------------------
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
function deliveries(t) {
  if (!t || !Array.isArray(t.customSchedule)) return [];
  return t.customSchedule.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date))).map((r) => ({
    date: r.date, syringes: int(r.syrQty != null ? r.syrQty : r.qty), syringe_price: num(r.syrPrice != null ? r.syrPrice : t.pricePerSyringe),
    needle_boxes: int(r.ndlQty), needle_box_price: num(r.ndlPrice != null ? r.ndlPrice : t.pricePerNeedle),
    cannula_boxes: int(r.canQty), cannula_box_price: num(r.canPrice != null ? r.canPrice : t.pricePerCannula) }));
}
async function applyCommitment(tx, c, prev, actor) {
  const hsId = c.key.split(':')[1];
  const contact = await byHs(tx, hsId);
  if (!contact) return { skipped: true, why: 'customer not in v2' };
  const [ct] = await tx`select owner_id from contacts where id = ${contact}`;
  const rep = (ct && ct.owner_id) || actor;
  const idFor = (date) => uid('commitment:' + hsId + ':' + date);
  const now = deliveries(c.value), before = deliveries(prev);
  const out = { table: 'forecasts', written: 0, deleted: 0, unchanged: 0, left: 0 };
  if (c.value && !now.length) out.why = 'no dated schedule (cadence only)';
  // Dates taken off the schedule (or the whole commitment cleared): their forecasts go.
  const nowDates = new Set(now.map((d) => d.date));
  for (const d of before) if (!nowDates.has(d.date)) out.deleted += (await tx`update forecasts set deleted_at = now() where id = ${idFor(d.date)} and deleted_at is null returning id`).length;
  const today = todayToronto();
  const beforeBy = new Map(before.map((d) => [d.date, d]));
  const mine = new Set(now.map((d) => idFor(d.date)));
  for (const d of now) {
    if (d.date < today || !(d.syringes || d.needle_boxes || d.cannula_boxes)) { out.left++; continue; }
    const id = idFor(d.date);
    if (prev && same(beforeBy.get(d.date), d)) {
      // unchanged: only added if v2 never had it (an earlier copy that didn't arrive)
      const [has] = await tx`select id from forecasts where id = ${id}`;
      if (has) { out.unchanged++; continue; }
    }
    const [other] = await tx`select id from forecasts where contact_id = ${contact} and deleted_at is null and id <> all(${[...mine]}::uuid[])
      and date_trunc('month', due_date) = date_trunc('month', ${d.date}::date) limit 1`;
    if (other) { out.left++; continue; }   // the rep's own forecast that month counts instead
    const { date, ...q } = d;
    await tx`insert into forecasts ${tx({ id, contact_id: contact, rep_id: rep, due_date: date, created_by_id: actor, ...q })}
      on conflict (id) do update set due_date = excluded.due_date, syringes = excluded.syringes, syringe_price = excluded.syringe_price,
        needle_boxes = excluded.needle_boxes, needle_box_price = excluded.needle_box_price, cannula_boxes = excluded.cannula_boxes,
        cannula_box_price = excluded.cannula_box_price, deleted_at = null`;
    out.written++;
  }
  return out;
}

const APPLY = { event: applyEvent, event_list: applyList, marketing: applyMarketing, commitment: applyCommitment };

// c = the copy; prev = the value of the previous copy of the same key (undefined when there is none).
async function apply(sql, c, prev) {
  const fn = APPLY[c.kind];
  if (!fn) return { skipped: true, why: 'unknown kind' };
  return sql.begin(async (tx) => {
    const actor = (await userId(tx, c.by)) || null;
    await tx`select set_config('app.source', 'edge_app', true), set_config('app.user_id', ${actor || ''}, true), set_config('app.batch_id', '', true)`;
    await tx`select pg_advisory_xact_lock(hashtext(${'edge-kv:' + c.key}))`;
    return fn(tx, c, prev === undefined ? null : prev, actor);
  });
}

module.exports = { apply, uid, deliveries, KINDS: Object.keys(APPLY), MIGRATED_AT };
