require('./_staging'); // first: with STAGING=1 nothing goes out (api/_staging.js)
// n8n -> v2 (owner 2026-10-27: "wherever n8n writes to HubSpot, it now needs to write to v2"). Every HubSpot write in the
// live n8n workflows has a "Mirror" node right after it that POSTs a copy here:
//   POST /api/intake   X-Intake-Secret: <N8N_INTAKE_SECRET>
//   { wf, node, hs: { method, url, body, response } }
// 1. The copy is kept in ingest_events (source n8n, once: the same copy again is answered "duplicate"), so it can be
//    replayed later (status failed/pending).
// 2. It is applied to v2: the touched contact, clinic or order is re-read from HubSpot (read only, api/_hubspot.js) and
//    mapped with the migration's rules and ids (api/_hsmap.js). Deals, automated notes and files are skipped (not in
//    the data model / not kept on Oct 22).
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

function authorised(req) {
  const want = String(process.env.N8N_INTAKE_SECRET || '');
  const got = String(req.headers['x-intake-secret'] || '');
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
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
    resp && resp.id ? resp.id : JSON.stringify(resp || null)].join('|')).digest('hex');
  const [ev] = await sql`
    insert into ingest_events (source, external_id, payload, received_via, status, attempts)
    values ('n8n', ${external}, ${sql.json({ wf: b.wf || '', node: b.node || '', hs: Object.assign({}, hs, { response: resp }) })}, 'n8n', 'pending', 0)
    on conflict (source, external_id) do nothing returning id`;
  if (!ev) return { ok: true, duplicate: true };
  try {
    const r = await apply(sql, Object.assign({}, hs, { response: resp }));
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
async function apply(sql, hs) {
  const c = M.classify(hs);
  if (c.kind === 'skip' || c.kind === 'unknown') return { skipped: true, why: c.why };
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'n8n', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
    if (c.kind === 'contact') {
      let last = null;
      for (const id of c.ids) last = await syncContact(tx, id, c.create ? null : c.props);
      return last || { skipped: true, why: 'contact not in v2 (left out on Oct 22)' };
    }
    if (c.kind === 'company') {
      let last = null;
      for (const id of c.ids) last = await syncClinic(tx, id, c.create ? null : c.props);
      return last || { skipped: true, why: 'clinic not in v2' };
    }
    if (c.kind === 'contact_clinic') {
      const contactId = await idOf(tx, 'contacts', c.contact);
      if (!contactId) return { skipped: true, why: 'contact not in v2' };
      const clinic = (await idOf(tx, 'clinics', c.company)) || ((await syncClinic(tx, c.company, null)) || {}).id;
      if (!clinic) return { skipped: true, why: 'clinic not found in HubSpot' };
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
    if (c.kind === 'order') {
      let last = null;
      for (const id of c.ids) last = await syncOrder(tx, id);
      return last || { skipped: true, why: 'order not found' };
    }
    return { skipped: true, why: 'nothing to do' };
  });
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

async function syncContact(tx, hsId, patched) {
  const exists = await idOf(tx, 'contacts', hsId);
  if (!exists && patched) return null;   // a change to someone left out of v2 on purpose
  const rec = await H.contact(hsId);
  if (!rec) return null;
  const row = Object.assign({ id: M.uid('contact:' + hsId) }, M.contactRow(hsId, rec.properties || {}));
  if (!exists && !row.owner_id) delete row.owner_id;
  // the clinic HubSpot links (created first when v2 does not have it yet)
  const co = H.assocIds(rec, 'companies')[0] || (rec.properties || {}).associatedcompanyid;
  if (co) row.clinic_id = (await idOf(tx, 'clinics', co)) || ((await syncClinic(tx, co, null)) || {}).id || undefined;
  if (!row.clinic_id) delete row.clinic_id;
  const cols = patched ? M.columnsFor(M.CONTACT_PROPS, patched) : null;
  const r = await upsert(tx, 'contacts', row, cols);
  return { table: 'contacts', id: r.id, created: r.created };
}

async function syncClinic(tx, hsId, patched) {
  const exists = await idOf(tx, 'clinics', hsId);
  if (!exists && patched) return null;
  const rec = await H.company(hsId);
  if (!rec) return null;
  const row = Object.assign({ id: M.uid('clinic:' + hsId) }, M.clinicRow(hsId, rec.properties || {}));
  if (!row.name) return null;
  const r = await upsert(tx, 'clinics', row, patched ? M.columnsFor(M.COMPANY_PROPS, patched) : null);
  return { table: 'clinics', id: r.id, created: r.created };
}

// HubSpot is where these orders live (the Internal Sales Form, the daily digest's tracking): its status, dates,
// tracking and QuickBooks id always win; lines and payments are added once.
const ORDER_OWNED = ['status', 'delivered_at', 'cancelled_at', 'tracking_number', 'tracking_url', 'quickbooks_invoice_id', 'shipment_method', 'payment_method', 'payment_terms_days',
  'tax_amount', 'shipping_amount', 'discount_amount', 'contact_id', 'rep_id', 'order_number'];
async function syncOrder(tx, hsId) {
  const rec = await H.order(hsId);
  if (!rec) return null;
  const cids = H.assocIds(rec, 'contacts');
  let contactId = null;
  for (const k of cids) { contactId = await idOf(tx, 'contacts', k); if (contactId) break; }
  if (!contactId && cids[0]) contactId = ((await syncContact(tx, cids[0], null)) || {}).id || null;   // a customer is always wanted
  if (!contactId) return { skipped: true, why: 'order has no customer' };
  const lis = await H.lineItems(H.assocIds(rec, 'line_items'));
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

module.exports.intake = intake;
module.exports.apply = apply;
