require('./_staging'); // first: with STAGING=1 nothing goes out (api/_staging.js)
// n8n -> v2 (owner 2026-10-27: "wherever n8n writes to HubSpot, it now needs to write to v2"). Every HubSpot write in the
// live n8n workflows has a "Mirror" node right after it that POSTs a copy here:
//   POST /api/intake   X-Intake-Secret: <N8N_INTAKE_SECRET>
//   { wf, node, hs: { method, url, body, response } }
// 1. The copy is kept in ingest_events (source n8n, once: the same copy again is answered "duplicate"), so it can be
//    replayed later (status failed/pending).
// 2. It is applied to v2 from n8n's own data (owner 2026-10-28, Option B: v2 and HubSpot are written at the same time;
//    HubSpot is never read back for it): the request and HubSpot's answer, plus the earlier writes kept in ingest_events
//    (api/_payload.js), mapped with the migration's rules and ids (api/_hsmap.js). A record n8n never wrote is left to
//    the 5-minute HubSpot pull below (the bridge), the only part that reads HubSpot. Deals, automated notes and files are
//    skipped (not in the data model / not kept on Oct 22).
// Rules (owner 2026-10-27): a record n8n creates is added; a field n8n changes (PATCH) is updated; a record n8n creates
// that v2 already has only gets its blank fields filled ("v2 wins"). A PATCH to a record v2 does not have is skipped
// (it was left out on purpose on Oct 22). Changes are logged with source n8n (change_logs).
// Answers 200 even when the copy cannot be applied (it stays in ingest_events as failed), so n8n never fails a live run
// because of v2; 401 only for a wrong secret.
const crypto = require('crypto');
const { db } = require('./_db');
const { send, body, route, fail } = require('./_http');
const M = require('./_hsmap');
const H = require('./_hubspot');
const P = require('./_payload');
// Where a record comes from: HubSpot (the bridge: the 5-minute pull and its repairs) or n8n's own data (api/_payload.js).
const HS = { contact: (id) => H.contact(id), company: (id) => H.company(id), order: (id) => H.order(id), activity: (t, id) => H.activity(t, id, PROPS[t]),
  lineItems: (ids) => H.lineItems(ids) };

function authorised(req) {
  const want = String(process.env.N8N_INTAKE_SECRET || '');
  const got = String(req.headers['x-intake-secret'] || '');
  const a = Buffer.from(got), b = Buffer.from(want);
  return !!want && a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = route(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'method_not_allowed');
  if (!authorised(req)) throw fail(401, 'unauthorized');
  const b = await body(req);
  if (!b.hs || typeof b.hs !== 'object') throw fail(400, 'bad_input');
  send(res, 200, await intake(db(), b));
});

// Kept apart from the route so tests (and a replay script) can call it with a database.
async function intake(sql, b) {
  const hs = b.hs;
  const resp = typeof hs.response === 'string' ? safeJson(hs.response) : hs.response || {};
  const external = crypto.createHash('sha256').update([b.wf, b.node, hs.method, hs.url, typeof hs.body === 'string' ? hs.body : JSON.stringify(hs.body || null),
    resp && resp.id ? resp.id : JSON.stringify(resp || null),
    // HubSpot's own modified time (run 4): the same change made, undone and made again (A, B, A) is three copies, not one repeated.
    (resp && (resp.updatedAt || (resp.properties && (resp.properties.hs_lastmodifieddate || resp.properties.lastmodifieddate)))) || ''].join('|')).digest('hex');
  const [ev] = await sql`
    insert into ingest_events (source, external_id, payload, received_via, status, attempts, received_at)
    values ('n8n', ${external}, ${sql.json({ wf: b.wf || '', node: b.node || '', hs: Object.assign({}, hs, { response: resp }) })}, 'n8n', 'pending', 0, now())
    on conflict (source, external_id) do nothing returning id`;
  if (!ev) return { ok: true, duplicate: true };
  try {
    const r = await apply(sql, Object.assign({}, hs, { response: resp }), { fromEdge: b.wf === 'Edge' });
    await sql`update ingest_events set status = ${r.skipped ? 'skipped' : 'done'}, attempts = 1, processed_at = now(), error_message = ${r.why || null},
                result_table = ${r.table || null}, result_id = ${r.id || null} where id = ${ev.id}`;
    return Object.assign({ ok: true }, r);
  } catch (e) {
    console.error('INTAKE', b.wf, b.node, e.message);
    await sql`update ingest_events set status = 'failed', attempts = 1, error_message = ${String(e.message).slice(0, 500)} where id = ${ev.id}`;
    return { ok: false, failed: true, error: String(e.message).slice(0, 200) };
  }
}
const safeJson = (t) => { try { return JSON.parse(t); } catch (e) { return {}; } };

// One HubSpot write -> v2. Returns { table, id } or { skipped: true, why }.
async function apply(sql, hs, opts = {}) {
  const c = M.classify(hs, opts);
  if (c.kind === 'skip' || c.kind === 'unknown') return { skipped: true, why: c.why };
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'n8n', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
    const src = opts.src || P.source(tx, hs);
    if (c.kind === 'contact') {
      let last = null;
      for (const id of c.ids) last = await syncContact(tx, id, c.create ? null : c.props, src);
      return last || { skipped: true, why: 'contact not in v2 (left out on Oct 22)' };
    }
    if (c.kind === 'company') {
      let last = null;
      for (const id of c.ids) last = await syncClinic(tx, id, c.create ? null : c.props, src);
      return last || { skipped: true, why: 'clinic not in v2' };
    }
    if (c.kind === 'contact_clinic') {
      const contactId = await idOf(tx, 'contacts', c.contact);
      if (!contactId) return { skipped: true, why: 'contact not in v2' };
      const clinic = (await idOf(tx, 'clinics', c.company)) || ((await syncClinic(tx, c.company, null, src)) || {}).id;
      if (!clinic) return { skipped: true, why: 'clinic not in v2 yet (the 5-minute pull brings it)' };
      await tx`update contacts set clinic_id = ${clinic} where id = ${contactId} and clinic_id is distinct from ${clinic}`;
      return { table: 'contacts', id: contactId };
    }
    if (c.kind === 'contact_md') {
      const [a, md] = [await idOf(tx, 'contacts', c.contact), await idOf(tx, 'contacts', c.md)];
      if (!a || !md) return { skipped: true, why: 'practitioner or MD not in v2' };
      await tx`update contacts set medical_director_contact_id = ${md} where id = ${a} and medical_director_contact_id is distinct from ${md}`;
      await tx`update contacts set is_medical_director = true where id = ${md} and is_medical_director is not true`;
      return { table: 'contacts', id: a };
    }
    // Live Edge's Data Cleaner (owner 2026-10-28): what HubSpot does, done the v2 way (SOP: soft delete, merged_into).
    if (c.kind === 'contact_clinic_remove') {
      const contactId = await idOf(tx, 'contacts', c.contact), clinic = await idOf(tx, 'clinics', c.company);
      if (!contactId || !clinic) return { skipped: true, why: 'contact or clinic not in v2' };
      await tx`update contacts set clinic_id = null where id = ${contactId} and clinic_id = ${clinic}`;
      return { table: 'contacts', id: contactId, unlinked: true };
    }
    if (c.kind === 'contact_md_remove') {
      const [a, md] = [await idOf(tx, 'contacts', c.contact), await idOf(tx, 'contacts', c.md)];
      if (!a || !md) return { skipped: true, why: 'practitioner or MD not in v2' };
      await tx`update contacts set medical_director_contact_id = null where id = ${a} and medical_director_contact_id = ${md}`;
      return { table: 'contacts', id: a, unlinked: true };
    }
    if (c.kind === 'delete') {
      const table = c.type === 'contacts' ? 'contacts' : 'clinics';
      const rows = await tx.unsafe(`update public.${table} set deleted_at = now() where legacy_id = any($1::text[]) and deleted_at is null returning id`, [c.ids]);
      return rows.length ? { table, deleted: rows.length } : { skipped: true, why: table + ' not in v2' };
    }
    if (c.kind === 'merge') return merge(tx, c);
    if (c.kind === 'order') {
      let last = null;
      for (const id of c.ids) last = await syncOrder(tx, id, src);
      return last || { skipped: true, why: 'order not among n8n writes (the 5-minute pull brings it)' };
    }
    // a call, meeting, note or task (live Edge, n8n): the record with its contacts, then the sync's rules (syncOne). A link
    // made on its own (associations/contacts) names the contact in its address or body.
    if (c.kind === 'activity') {
      let last = null;
      for (const id of c.ids) {
        const rec = await src.activity(c.type, id);
        if (!rec) continue;
        const linked = H.assocIds(rec, 'contacts').concat(c.contacts || []);
        const r = await syncOne(tx, c.type, rec, [...new Set(linked)], { person: !!opts.fromEdge, src });
        last = r === 'skipped' ? last || { skipped: true, why: 'not on a contact in v2, or not kept' } : { table: c.type === 'tasks' ? 'tasks' : 'interactions', result: r };
      }
      return last || { skipped: true, why: 'not among n8n writes (the 5-minute pull brings it)' };
    }
    if (c.kind === 'activity_delete') {
      if (c.type === 'tasks') await tx`update tasks set deleted_at = now() where id = any(${c.ids.map((id) => M.uid('task:' + id))}) and deleted_at is null`;
      else await tx`update interactions set deleted_at = now() where source = 'import' and external_id = any(${c.ids.map((id) => 'hubspot:' + c.type.replace(/s$/, '') + ':' + id)}) and deleted_at is null`;
      return { table: c.type === 'tasks' ? 'tasks' : 'interactions', deleted: c.ids.length };
    }
    return { skipped: true, why: 'nothing to do' };
  });
}

// A HubSpot merge (live Edge's Data Cleaner): the merged-away record is soft-deleted (a contact also points at the one it
// went into, merged_into_contact_id) and what hung off it moves to the one kept: for a contact its calls, meetings,
// notes, tasks and orders; for a clinic its people. If v2 has only the merged-away one (the kept one was left out on
// Oct 22), it simply takes the kept one's HubSpot id, so later copies find it.
async function merge(tx, c) {
  const table = c.type === 'contacts' ? 'contacts' : 'clinics';
  const [keep, gone] = [await idOf(tx, table, c.primary), await idOf(tx, table, c.merged)];
  if (!gone) return { skipped: true, why: 'merged-away ' + table + ' not in v2' };
  if (!keep) {
    await tx.unsafe(`update public.${table} set legacy_id = $1 where id = $2`, [String(c.primary), gone]);
    return { table, id: gone, rekeyed: true };
  }
  if (table === 'contacts') {
    for (const t of ['interactions', 'tasks', 'orders']) await tx.unsafe(`update public.${t} set contact_id = $1 where contact_id = $2`, [keep, gone]);
    await tx`update contacts set medical_director_contact_id = ${keep} where medical_director_contact_id = ${gone}`;
    await tx`update contacts set merged_into_contact_id = ${keep}, deleted_at = now() where id = ${gone}`;
  } else {
    await tx`update contacts set clinic_id = ${keep} where clinic_id = ${gone}`;
    await tx`update clinics set deleted_at = now() where id = ${gone}`;
  }
  return { table, id: keep, merged: gone };
}

const idOf = async (tx, table, legacy) => {
  const [r] = await tx.unsafe(`select id from public.${table} where legacy_id = $1 and deleted_at is null`, [String(legacy)]);
  return r ? r.id : null;
};
// Insert a new row, or update an existing one: `cols` = the columns to overwrite (a PATCH), null = fill blanks only.
async function upsert(tx, table, row, cols) {
  const [cur] = await tx.unsafe(`select * from public.${table} where legacy_id = $1`, [row.legacy_id]);
  if (!cur) {
    const keys = Object.keys(row);
    await tx.unsafe(`insert into public.${table} (${keys.map((k) => `"${k}"`).join(', ')}) select ${keys.map((k) => `"${k}"`).join(', ')} from json_populate_record(null::public.${table}, $1::text::json)`, [JSON.stringify(row)]);
    return { id: row.id, created: true };
  }
  const set = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id' || k === 'legacy_id' || k === 'created_at' || v == null) continue;
    if (cols ? cols.includes(k) && String(cur[k]) !== String(v) : (cur[k] == null || cur[k] === '')) set[k] = v;
  }
  const ks = Object.keys(set);
  if (ks.length) await tx.unsafe(`update public.${table} set ${ks.map((k) => `"${k}" = (json_populate_record(null::public.${table}, $1::text::json))."${k}"`).join(', ')} where id = $2`, [JSON.stringify(set), cur.id]);
  return { id: cur.id, created: false, changed: ks };
}

async function syncContact(tx, hsId, patched, src = HS) {
  const exists = await idOf(tx, 'contacts', hsId);
  if (!exists && patched) return null;   // a change to someone left out of v2 on purpose
  const rec = await src.contact(hsId);
  if (!rec) return null;
  const row = Object.assign({ id: M.uid('contact:' + hsId) }, M.contactRow(hsId, rec.properties || {}));
  if (!exists && !row.owner_id) delete row.owner_id;
  // the clinic HubSpot links (created first when v2 does not have it yet)
  const co = H.assocIds(rec, 'companies')[0] || (rec.properties || {}).associatedcompanyid;
  if (co) row.clinic_id = (await idOf(tx, 'clinics', co)) || ((await syncClinic(tx, co, null, src)) || {}).id || undefined;
  if (!row.clinic_id) delete row.clinic_id;
  const cols = patched ? M.columnsFor(M.CONTACT_PROPS, patched) : null;
  const r = await upsert(tx, 'contacts', row, cols);
  return { table: 'contacts', id: r.id, created: r.created };
}

async function syncClinic(tx, hsId, patched, src = HS) {
  const exists = await idOf(tx, 'clinics', hsId);
  if (!exists && patched) return null;
  const rec = await src.company(hsId);
  if (!rec) return null;
  const row = Object.assign({ id: M.uid('clinic:' + hsId) }, M.clinicRow(hsId, rec.properties || {}));
  if (!row.name) return null;
  const r = await upsert(tx, 'clinics', row, patched ? M.columnsFor(M.COMPANY_PROPS, patched) : null);
  return { table: 'clinics', id: r.id, created: r.created };
}

// A change n8n made to an order whose create Pulse has not got on file (made before the write steps, or in HubSpot): only
// the fields the change carries, and the status only ever moves forward (never back from paid, never off rejected/cancelled).
const RANK = ['submitted', 'approved', 'awaiting_md', 'invoiced', 'paid', 'sent_to_warehouse', 'shipped', 'delivered'];
async function patchOrder(tx, hsId, p) {
  const [cur] = await tx`select id, status::text as status, payment_method::text as pm from orders where legacy_id = ${String(hsId)} and deleted_at is null`;
  if (!cur) return { skipped: true, why: 'order not in v2 yet (the 5-minute pull brings it)' };
  const set = {};
  if (p.qbo_id) set.quickbooks_invoice_id = String(p.qbo_id);
  const tn = p.tracking_number || p.hs_shipping_tracking_number;
  if (tn) set.tracking_number = String(tn);
  if (p.tracking_url) set.tracking_url = String(p.tracking_url);
  if (p.hs_order_note) set.approval_note = String(p.hs_order_note);
  const rep = p.hubspot_owner_id ? M.ownerUser(p.hubspot_owner_id) : null;
  if (rep) set.rep_id = rep;
  if (p.payment_type === 'Payment Terms') { set.payment_method = 'wire'; set.payment_terms_days = 30; } else if (p.payment_type && !cur.pm) set.payment_method = 'card_on_file';
  const wire = (set.payment_method || cur.pm) === 'wire';
  const stage = M.stageOf(p.hs_pipeline_stage);
  const to = stage === 'cancelled' || p.hs_is_canceled === 'true' ? 'cancelled' : stage === 'delivered' ? 'delivered' : stage === 'shipped' ? 'shipped'
    : stage === 'processed' ? (p.hs_payment_status === 'Paid' && !wire ? 'paid' : 'invoiced') : p.hs_payment_status === 'Paid' && !wire ? 'paid' : null;
  if (to && !['rejected', 'cancelled'].includes(cur.status)) {
    if (to === 'cancelled') { set.status = 'cancelled'; set.cancelled_at = new Date().toISOString(); }
    else if (RANK.indexOf(to) > RANK.indexOf(cur.status)) { set.status = to; if (to === 'delivered') set.delivered_at = p.hs_closed_date || new Date().toISOString(); }
  }
  if (!Object.keys(set).length) return { table: 'orders', id: cur.id, changed: [] };
  await tx`update orders set ${tx(set)} where id = ${cur.id}`;
  return { table: 'orders', id: cur.id, changed: Object.keys(set) };
}

// HubSpot is where these orders live (the Internal Sales Form, the daily digest's tracking): its status, dates,
// tracking and QuickBooks id always win; lines and payments are added once.
const ORDER_OWNED = ['status', 'delivered_at', 'cancelled_at', 'tracking_number', 'tracking_url', 'quickbooks_invoice_id', 'shipment_method', 'payment_method', 'payment_terms_days',
  'tax_amount', 'shipping_amount', 'discount_amount', 'contact_id', 'rep_id', 'order_number'];
async function syncOrder(tx, hsId, src = HS) {
  const rec = await src.order(hsId);
  if (!rec) return null;
  if (rec.partial) return patchOrder(tx, hsId, rec.properties || {});   // only changes on file, not the create: those fields only
  const cids = H.assocIds(rec, 'contacts');
  let contactId = null;
  for (const k of cids) { contactId = await idOf(tx, 'contacts', k); if (contactId) break; }
  if (!contactId && cids[0]) contactId = ((await syncContact(tx, cids[0], null, src)) || {}).id || null;   // a customer is always wanted
  if (!contactId) return { skipped: true, why: 'order has no customer' };
  const lis = await src.lineItems(H.assocIds(rec, 'line_items'));
  const { order, lines, payments } = M.orderRows(hsId, rec.properties || {}, lis, contactId);
  for (const k of Object.keys(order)) if (order[k] == null) delete order[k];
  // A Pulse order sent to the Internal Sales Form (api/_isf.js) comes back here as a HubSpot order: link it to the Pulse
  // order (same customer, same paid items, placed in Pulse in the last week, not linked yet) instead of adding a second.
  // HubSpot holds only the paid lines of a paid order (free extras stay on the Pulse order), and every line of samples.
  let pulseOrder = null;
  if (!(await idOf(tx, 'orders', hsId))) {
    const want = lines.filter((l) => !l.is_free || lines.every((x) => x.is_free)).map((l) => l.product_sku + ':' + l.quantity).sort().join(',');
    const cands = await tx`
      select o.id, (select string_agg(l.product_sku || ':' || l.quantity, ',' order by l.product_sku || ':' || l.quantity) from order_lines l
                     where l.order_id = o.id and (not l.is_free or not exists (select 1 from order_lines x where x.order_id = o.id and not x.is_free))) as sig
        from orders o where o.contact_id = ${contactId} and o.legacy_id is null and o.placed_by_id is not null and o.deleted_at is null
         and o.created_at > now() - interval '7 days' order by o.created_at desc`;
    const hit = cands.find((x) => x.sig === want);
    if (hit) { pulseOrder = hit.id; await tx`update orders set legacy_id = ${String(hsId)} where id = ${hit.id}`; }
  }
  const r = await upsert(tx, 'orders', order, ORDER_OWNED);
  const orderId = r.id;
  if (pulseOrder) {
    // its lines are already there; its payment: a pending wire stays until marked received, a card charge is added once
    for (const pm of payments) {
      const [cur] = await tx`select id, status from payments where order_id = ${orderId} and kind = 'charge' order by created_at limit 1`;
      if (!cur) await tx.unsafe(`insert into public.payments (${Object.keys(pm).map((k) => `"${k}"`).join(', ')}) select ${Object.keys(pm).map((k) => `"${k}"`).join(', ')}
                                 from json_populate_record(null::public.payments, $1::text::json) on conflict do nothing`, [JSON.stringify(Object.assign({}, pm, { order_id: orderId }))]);
      else if (cur.status === 'pending' && pm.status === 'succeeded' && pm.method !== 'wire') await tx`update payments set status = 'succeeded', paid_at = ${pm.paid_at} where id = ${cur.id}`;
    }
    return { table: 'orders', id: orderId, linked: 'pulse' };
  }
  const prod = Object.fromEntries((await tx`select id, sku, list_price from products where sku = any(${lines.map((l) => l.product_sku)})`).map((p) => [p.sku, p]));
  for (const l of lines) {
    const p = prod[l.product_sku];
    const row = Object.assign({}, l, { order_id: orderId, product_id: p ? p.id : null, list_price: p ? p.list_price : null });
    await tx.unsafe(`insert into public.order_lines (${Object.keys(row).map((k) => `"${k}"`).join(', ')}) select ${Object.keys(row).map((k) => `"${k}"`).join(', ')}
                     from json_populate_record(null::public.order_lines, $1::text::json) on conflict do nothing`, [JSON.stringify(row)]);
  }
  for (const pm of payments) {
    const row = Object.assign({}, pm, { order_id: orderId });
    const [cur] = await tx`select id, status from payments where id = ${pm.id}`;
    if (!cur) await tx.unsafe(`insert into public.payments (${Object.keys(row).map((k) => `"${k}"`).join(', ')}) select ${Object.keys(row).map((k) => `"${k}"`).join(', ')}
                               from json_populate_record(null::public.payments, $1::text::json) on conflict do nothing`, [JSON.stringify(row)]);
    else if (cur.status === 'pending' && pm.status === 'succeeded') await tx`update payments set status = 'succeeded', paid_at = ${pm.paid_at}, method = ${pm.method} where id = ${cur.id}`;
  }
  return { table: 'orders', id: orderId, created: r.created };
}

// ---- the HubSpot sync (owner 2026-10-27: "everything in Pulse hooked up") ----------------------------------------------
// Reps still work in the live Edge, which writes their calls, meetings, notes, tasks and new leads to HubSpot only, and
// Meta leads land in HubSpot directly: none of that goes through n8n. Every timer tick (api/cron.js) reads what changed in
// HubSpot since the last tick (read only) and brings it into v2 with the Oct 22 rules and ids (api/_hsmap.js):
//   contacts  new since the Oct 22 export are added (not Quo-made, staff or test ones); people left out on Oct 22 are
//             never brought back by a later edit; existing ones only get blank fields filled ("v2 wins")
//   clinics   blank fields filled;  orders  as the n8n intake does (syncOrder)
//   calls, meetings, notes (a person's only), tasks   added once on the v2 contacts they belong to; a meeting's or task's
//             status and dates follow HubSpot
// Emails are left to the Gmail sync. The bookmark per type is settings 'hubspot_sync' ({ type: ISO }).
const EXPORT_AT = '2026-10-22T15:36:00Z';                  // the Oct 22 export: older contacts not in v2 were left out
const START_AT = '2026-10-27T19:00:00Z';                   // the Oct 27 backfill read HubSpot up to here
const PROPS = {
  contacts: H.CONTACT_PROPS.concat(['createdate', 'hs_object_source', 'hs_object_source_label', 'hs_object_source_detail_1', 'lastmodifieddate']),
  companies: ['name', 'phone', 'website', 'domain', 'hours_of_operation', 'address', 'city', 'state', 'province', 'zip', 'hs_lastmodifieddate'],
  orders: ['hs_lastmodifieddate'],
  calls: ['hs_timestamp', 'hs_call_direction', 'hs_call_disposition', 'hs_call_title', 'hs_call_body', 'hs_call_duration', 'hs_call_recording_url', 'hs_call_from_number',
    'hs_call_to_number', 'hubspot_owner_id', 'hs_object_source', 'hs_object_source_detail_1', 'hs_lastmodifieddate'],
  meetings: ['hs_meeting_start_time', 'hs_timestamp', 'hs_meeting_outcome', 'hs_video_conference_url', 'hs_video_conference_platform', 'hs_meeting_location_type', 'hs_meeting_location',
    'hs_meeting_body', 'hs_internal_meeting_notes', 'hs_meeting_title', 'hs_meeting_end_time', 'hubspot_owner_id', 'hs_object_source', 'hs_lastmodifieddate'],
  notes: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id', 'hs_object_source', 'hs_lastmodifieddate'],
  tasks: ['hs_task_status', 'hs_task_subject', 'hs_task_body', 'hs_task_type', 'hs_timestamp', 'hs_task_completion_date', 'hubspot_owner_id', 'hs_object_source_detail_1', 'hs_createdate', 'hs_lastmodifieddate'],
};
const ORDER = ['contacts', 'companies', 'orders', 'calls', 'meetings', 'notes', 'tasks'];
const modifiedOf = (type, rec) => (rec.properties || {})[type === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate'] || rec.updatedAt;

async function sync(sql, budgetMs) {
  if (!process.env.HUBSPOT_READ_TOKEN) return { skipped: 'hubspot_not_set_up' };
  const until = Date.now() + (budgetMs || 25000);
  const [row] = await sql`select value from settings where key = 'hubspot_sync'`;
  const marks = Object.assign({}, (row && row.value) || {});
  const out = {};
  for (const type of ORDER) {
    const res = (out[type] = { seen: 0, added: 0, updated: 0, skipped: 0 });
    let since = marks[type] || START_AT, after = null, latest = since;
    while (Date.now() < until) {
      const page = await H.changedSince(type, since, PROPS[type], after);
      if (!page.results.length) break;
      const links = ['calls', 'meetings', 'notes', 'tasks'].includes(type) ? await H.contactsOf(type, page.results.map((x) => x.id)) : {};
      for (const rec of page.results) {
        if (Date.now() > until) break;
        res.seen++;
        try {
          const r = await sql.begin(async (tx) => {
            await tx`select set_config('app.source', 'import', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
            return syncOne(tx, type, rec, links[String(rec.id)] || []);
          });
          if (r === 'added') res.added++; else if (r === 'updated') res.updated++; else res.skipped++;
        } catch (e) { res.skipped++; console.error('HUBSPOT_SYNC', type, rec.id, e.message); }
        const m = modifiedOf(type, rec);
        if (m && m > latest) latest = new Date(m).toISOString();
      }
      marks[type] = latest;
      await sql`insert into settings (key, value) values ('hubspot_sync', ${sql.json(marks)}) on conflict (key) do update set value = excluded.value`;
      if (!page.after) break;
      after = page.after;
    }
  }
  // Orders from the last 14 days that still have no products (read before their line items were found): read again, ten a
  // tick, until HubSpot gives them (owner check 2026-10-28).
  const empty = await sql`select o.legacy_id from orders o where o.legacy_id is not null and o.deleted_at is null and o.created_at > now() - interval '14 days'
    and not exists (select 1 from order_lines l where l.order_id = o.id) order by o.created_at desc limit 10`;
  if (empty.length) {
    const res = (out.orderLines = { tried: 0, filled: 0 });
    for (const e of empty) {
      if (Date.now() > until + 5000) break;
      res.tried++;
      try {
        await sql.begin(async (tx) => {
          await tx`select set_config('app.source', 'import', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
          await syncOrder(tx, e.legacy_id);
        });
        const [n] = await sql`select count(*)::int n from order_lines l join orders o on o.id = l.order_id where o.legacy_id = ${e.legacy_id}`;
        if (n.n) res.filled++;
      } catch (err) { console.error('HUBSPOT_ORDER_LINES', e.legacy_id, err.message); }
    }
  }
  return out;
}

async function syncOne(tx, type, rec, contactHs, o = {}) {
  const p = rec.properties || {};
  if (type === 'contacts') {
    const have = await idOf(tx, 'contacts', rec.id);
    if (!have) {
      if (!p.createdate || new Date(p.createdate) < new Date(EXPORT_AT) || M.contactSkip(p)) return 'skipped';
      return ((await syncContact(tx, rec.id, null)) || {}).created ? 'added' : 'skipped';
    }
    const row = Object.assign({ id: have }, M.contactRow(rec.id, p));
    delete row.owner_id;
    const r = await upsert(tx, 'contacts', row, null);
    return r.changed && r.changed.length ? 'updated' : 'skipped';
  }
  if (type === 'companies') {
    if (!(await idOf(tx, 'clinics', rec.id))) return 'skipped';   // a new clinic comes in with its contact
    const r = await upsert(tx, 'clinics', Object.assign({ id: M.uid('clinic:' + rec.id) }, M.clinicRow(rec.id, p)), null);
    return r.changed && r.changed.length ? 'updated' : 'skipped';
  }
  if (type === 'orders') {
    const r = await syncOrder(tx, rec.id);
    return r && r.created ? 'added' : r && !r.skipped ? 'updated' : 'skipped';
  }
  const contacts = [];
  for (const k of contactHs) { const id = await idOf(tx, 'contacts', k); if (id) contacts.push(id); }
  if (!contacts.length) return 'skipped';
  if (type === 'tasks') {
    const t = M.taskRow(rec.id, p).row;
    t.contact_id = contacts[0];
    if (!t.assignee_id) { const [o] = await tx`select owner_id from contacts where id = ${contacts[0]}`; t.assignee_id = o && o.owner_id; }
    const [cur] = await tx`select id, status::text, due_at, completed_at from tasks where id = ${t.id}`;
    if (!cur) { await insertRow(tx, 'tasks', t); return 'added'; }
    if (cur.status !== t.status || String(cur.due_at && new Date(cur.due_at).toISOString()) !== String(t.due_at)) {
      await tx`update tasks set status = ${t.status}, completed_at = ${t.completed_at}, due_at = ${t.due_at} where id = ${t.id}`;
      return 'updated';
    }
    return 'skipped';
  }
  const m = type === 'calls' ? M.callRow(rec.id, p, o) : type === 'meetings' ? M.meetingRow(rec.id, p) : M.noteRow(rec.id, p, o);
  if (m.skip) return 'skipped';
  let result = 'skipped';
  for (const c of contacts) {
    const id = M.intId(m.row.external_id, c);
    const [cur] = await tx`select id, status::text from interactions where id = ${id}`;
    if (!cur) {
      await insertRow(tx, 'interactions', Object.assign({ id, contact_id: c, created_by_id: m.row.user_id || null, created_at: m.row.occurred_at }, m.row));
      if (m.summary) await insertRow(tx, 'ai_outputs', { id: M.uid('ai:' + id), kind: 'call_summary', interaction_id: id, output_text: m.summary, model_name: 'quo/hubspot', created_at: m.row.occurred_at });
      result = 'added';
    } else if (type === 'meetings' && cur.status !== m.row.status) {
      await tx`update interactions set status = ${m.row.status}, ends_at = ${m.row.ends_at}, body = coalesce(${m.row.body}, body) where id = ${id}`;
      if (result === 'skipped') result = 'updated';
    }
  }
  return result;
}
async function insertRow(tx, table, row) {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  await tx.unsafe(`insert into public.${table} (${keys.map((k) => `"${k}"`).join(', ')}) select ${keys.map((k) => `"${k}"`).join(', ')}
                   from json_populate_record(null::public.${table}, $1::text::json) on conflict do nothing`, [JSON.stringify(row)]);
}

module.exports.intake = intake;
module.exports.apply = apply;
module.exports.sync = sync;
