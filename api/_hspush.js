// v2 -> HubSpot, for the days reps still work in HubSpot (owner 2026-10-30: "any new contacts/leads that come to v2 through
// n8n will show on hubspot as the reps are still using it"; turned off on switch day with the flag hubspot_push). The other
// direction is the 5-minute pull (api/intake.js sync); together they keep the two in step until HubSpot goes.
//
// Each timer tick (api/cron.js, part hubspot, before the pull):
//   1. new records n8n made through the v2 API (api/_hsapi.js: a 9 + 12-digit legacy_id) and people reps added in Pulse or
//      Edge since the sync started: clinics, then contacts (an existing HubSpot contact with that email is adopted, never
//      doubled), then orders with their line items, replaying the request n8n sent (kept in ingest_events) with HubSpot's ids.
//      The v2 row then takes HubSpot's id as its legacy_id, and the old id is remembered (settings hubspot_push.ids) so a
//      workflow still holding it is answered.
//   2. changes: every field v2 logged (change_logs) since the last tick from anyone but the pull itself (source import), on
//      records HubSpot has, sent as a PATCH of those fields.
// No loop: the pull answers HubSpot's copy of a change with the same values, which changes nothing in v2 and logs nothing.
// Needs HUBSPOT_WRITE_TOKEN (a private app token with CRM write scopes). Changes it makes in v2 are logged as source import.
'use strict';
const A = require('./_hsapi');
const M = require('./_hsmap');
const BASE = 'https://api.hubapi.com';
const NINE = /^9\d{12}$/;
const SOURCES = ['n8n', 'my_fifty', 'edge_app', 'compass', 'meta', 'quo_webhook', 'stripe_webhook'];
const PROVINCE_NAME = { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia',
  NB: 'New Brunswick', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island', YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut' };
const ROLE = { md: 'MD', np: 'NP', rn: 'RN', rpn: 'RPN', dds: 'Other', other: 'Other' };
const s = (v) => (v == null ? '' : String(v));

async function hs(method, path, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(BASE + path, { method, signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + process.env.HUBSPOT_WRITE_TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 && i < 3) { await new Promise((ok) => setTimeout(ok, 1200 * (i + 1))); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error('hubspot ' + r.status + ': ' + s(j.message).slice(0, 200)); e.status = r.status; e.body = j; throw e; }
    return j;
  }
}
const inTx = (sql, fn) => sql.begin(async (tx) => { await tx`select set_config('app.source', 'import', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`; return fn(tx); });

// The request n8n sent when it made this record (api/_hsapi.js kept it), or null.
async function madeBy(sql, type, id) {
  const [r] = await sql`select payload->'hs' as hs from ingest_events where source = 'n8n' and payload->'hs'->>'method' = 'POST'
    and payload->'hs'->>'url' like ${'%/objects/' + type + '%'} and (payload->'hs'->'response'->>'id' = ${id} or payload->'hs'->'response'->'results' @> (${JSON.stringify([{ id }])}::text)::jsonb)
    order by received_at limit 1`;
  if (!r) return null;
  const b = typeof r.hs.body === 'string' ? (() => { try { return JSON.parse(r.hs.body); } catch (e) { return {}; } })() : r.hs.body || {};
  return b;
}

const contactProps = (c, cl) => {
  const p = { email: s(c.email), firstname: s(c.first_name), lastname: s(c.last_name), phone: s(c.phone), mobilephone: s(c.mobile_phone), secondary_email: s(c.secondary_email),
    address: s(c.shipping_street), city: s(c.shipping_city), state: PROVINCE_NAME[c.shipping_province] || s(c.shipping_province), zip: s(c.shipping_postal_code),
    hubspot_owner_id: s(A.OWNER_OF[c.owner_id]), role: ROLE[c.designation] || '', company: cl ? s(cl.name) : '' };
  for (const k of Object.keys(p)) if (!p[k]) delete p[k];
  return p;
};
const clinicProps = (cl) => {
  const p = { name: s(cl.name), phone: s(cl.main_phone), website: s(cl.website), address: s(cl.street), city: s(cl.city), state: PROVINCE_NAME[cl.province] || s(cl.province),
    zip: s(cl.postal_code), country: 'Canada', hours_of_operation: s(cl.hours_of_operation) };
  for (const k of Object.keys(p)) if (!p[k]) delete p[k];
  return p;
};
// v2 field -> HubSpot property, for the changes in step 2 (value from the row as it is now)
const FIELD = {
  contacts: { first_name: 'firstname', last_name: 'lastname', email: 'email', secondary_email: 'secondary_email', phone: 'phone', mobile_phone: 'mobilephone',
    shipping_street: 'address', shipping_city: 'city', shipping_province: 'state', shipping_postal_code: 'zip', owner_id: 'hubspot_owner_id', designation: 'role' },
  clinics: { name: 'name', main_phone: 'phone', website: 'website', street: 'address', city: 'city', province: 'state', postal_code: 'zip', hours_of_operation: 'hours_of_operation' },
  orders: { status: 'hs_pipeline_stage', tracking_number: 'tracking_number', tracking_url: 'tracking_url', quickbooks_invoice_id: 'qbo_id' },
};
function valueFor(table, field, row) {
  const v = row[field];
  if (field === 'owner_id') return s(A.OWNER_OF[v]);
  if (field === 'designation') return ROLE[v] || '';
  if (field === 'shipping_province' || field === 'province') return PROVINCE_NAME[v] || s(v);
  if (table === 'orders' && field === 'status') return A.stageOf(v);
  return s(v);
}

async function rememberIds(sql, marks, pairs) {
  marks.ids = Object.assign({}, marks.ids || {}, pairs);
  const keys = Object.keys(marks.ids);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete marks.ids[k];
}
async function adopt(sql, table, row, hsId, marks) {
  await inTx(sql, (tx) => tx.unsafe(`update public.${table} set legacy_id = $1 where id = $2`, [s(hsId), row.id]));
  if (NINE.test(s(row.legacy_id))) await rememberIds(sql, marks, { [row.legacy_id]: s(hsId) });
}

async function pushNew(sql, marks, out, until) {
  // clinics
  for (const cl of await sql`select * from clinics where legacy_id ~ '^9[0-9]{12}$' and deleted_at is null order by created_at limit 50`) {
    if (Date.now() > until) return;
    const made = await hs('POST', '/crm/v3/objects/companies', { properties: Object.assign(clinicProps(cl), ((await madeBy(sql, 'companies', cl.legacy_id)) || {}).properties || {}) });
    await adopt(sql, 'clinics', cl, made.id, marks); out.clinics++;
  }
  // contacts: n8n's, and people reps added in Pulse / Edge since the sync began
  const people = await sql`select c.*, cl.name as clinic_name, cl.legacy_id as clinic_legacy from contacts c left join clinics cl on cl.id = c.clinic_id
    where c.deleted_at is null and c.merged_into_contact_id is null and (c.legacy_id ~ '^9[0-9]{12}$' or (c.legacy_id is null and c.created_at > ${marks.started_at}))
    order by c.created_at limit 50`;
  for (const c of people) {
    if (Date.now() > until) return;
    let id = null;
    if (c.email) {
      const f = await hs('POST', '/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: s(c.email) }] }], properties: ['email'], limit: 1 });
      if (f.results && f.results[0]) id = f.results[0].id;
    }
    if (!id) {
      const made = (NINE.test(s(c.legacy_id)) && (await madeBy(sql, 'contacts', c.legacy_id))) || {};
      const props = Object.assign({}, made.properties || {}, contactProps(c, c.clinic_name ? { name: c.clinic_name } : null));
      delete props.hs_object_id;
      try { id = (await hs('POST', '/crm/v3/objects/contacts', { properties: props })).id; }
      catch (e) { const m = /Existing ID: (\d+)/.exec(s(e.body && e.body.message)); if (e.status === 409 && m) id = m[1]; else throw e; }
    }
    if (c.clinic_legacy && /^\d{1,12}$/.test(c.clinic_legacy)) await hs('PUT', `/crm/v4/objects/contacts/${id}/associations/default/companies/${c.clinic_legacy}`).catch(() => null);
    await adopt(sql, 'contacts', c, id, marks); out.contacts++;
  }
  // orders n8n made: replay its request with HubSpot's ids for the customer and the line items
  for (const o of await sql`select o.*, c.legacy_id as contact_legacy, cl.legacy_id as clinic_legacy from orders o left join contacts c on c.id = o.contact_id left join clinics cl on cl.id = c.clinic_id
      where o.legacy_id ~ '^9[0-9]{12}$' and o.deleted_at is null order by o.created_at limit 30`) {
    if (Date.now() > until) return;
    if (!/^\d{1,12}$/.test(s(o.contact_legacy))) continue;   // its customer goes first (next tick)
    const body = (await madeBy(sql, 'orders', o.legacy_id)) || { properties: {} };
    const lines = await sql`select product_name, product_sku, quantity, unit_price from order_lines where order_id = ${o.id}`;
    const li = lines.length ? await hs('POST', '/crm/v3/objects/line_items/batch/create', { inputs: lines.map((l) => ({ properties: { name: s(l.product_name || l.product_sku), hs_sku: s(l.product_sku),
      quantity: String(l.quantity), price: String(l.unit_price), hs_line_item_currency_code: 'CAD' } })) }) : { results: [] };
    const props = Object.assign({}, body.properties || {}, { hs_order_name: s(o.order_number), hs_pipeline_stage: A.stageOf(o.status) });
    if (o.tracking_number) props.tracking_number = s(o.tracking_number);
    if (o.tracking_url) props.tracking_url = s(o.tracking_url);
    if (o.quickbooks_invoice_id) props.qbo_id = s(o.quickbooks_invoice_id);
    for (const k of Object.keys(props)) if (props[k] == null || props[k] === '') delete props[k];
    delete props.hs_object_id;
    const assoc = [{ to: { id: s(o.contact_legacy) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 507 }] }]
      .concat((li.results || []).map((x) => ({ to: { id: x.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 513 }] })))
      .concat(/^\d{1,12}$/.test(s(o.clinic_legacy)) ? [{ to: { id: s(o.clinic_legacy) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 509 }] }] : []);
    const made = await hs('POST', '/crm/v3/objects/orders', { properties: props, associations: assoc });
    await adopt(sql, 'orders', o, made.id, marks); out.orders++;
  }
}

async function pushChanges(sql, marks, out, until) {
  // two minutes back each time: a write that committed late (its change_logs time is when it started) is never missed;
  // sending an unchanged value again is harmless
  const since = new Date(new Date(marks.cursor || marks.started_at).getTime() - 120000).toISOString();
  const rows = await sql`select entity_type, entity_id, field_name, max(changed_at) as at from change_logs
    where changed_at > ${since} and action = 'update' and source::text = any(${SOURCES}) and entity_type in ('contacts', 'clinics', 'orders') and field_name is not null
    group by 1, 2, 3 order by max(changed_at) limit 400`;
  const by = new Map();
  let latest = marks.cursor || marks.started_at;
  for (const r of rows) {
    if (!FIELD[r.entity_type][r.field_name]) { if (r.at > latest) latest = r.at; continue; }
    const k = r.entity_type + ':' + r.entity_id;
    if (!by.has(k)) by.set(k, { table: r.entity_type, id: r.entity_id, fields: new Set() });
    by.get(k).fields.add(r.field_name);
    if (new Date(r.at) > new Date(latest)) latest = r.at;
  }
  const PATH = { contacts: 'contacts', clinics: 'companies', orders: 'orders' };
  for (const x of by.values()) {
    if (Date.now() > until) return;   // the cursor stays: the rest goes next tick
    const [row] = await sql.unsafe(`select * from public.${x.table} where id = $1`, [x.id]);
    if (!row || !/^\d{1,12}$/.test(s(row.legacy_id))) continue;   // HubSpot does not have it (new ones go in step 1)
    const props = {};
    for (const f of x.fields) props[FIELD[x.table][f]] = valueFor(x.table, f, row);
    try { await hs('PATCH', `/crm/v3/objects/${PATH[x.table]}/${row.legacy_id}`, { properties: props }); out.changes++; }
    catch (e) { if (e.status !== 404) throw e; }   // gone from HubSpot: nothing to update
  }
  marks.cursor = new Date(latest).toISOString();
}

async function push(sql, budgetMs) {
  if (!process.env.HUBSPOT_WRITE_TOKEN) return { skipped: 'hubspot_write_not_set_up' };
  const until = Date.now() + (budgetMs || 20000);
  const [row] = await sql`select value from settings where key = 'hubspot_push'`;
  const marks = Object.assign({}, (row && row.value) || {});
  if (!marks.started_at) marks.started_at = new Date().toISOString();   // the first tick: from now on, nothing older
  const out = { clinics: 0, contacts: 0, orders: 0, changes: 0 };
  try {
    await pushNew(sql, marks, out, until);
    await pushChanges(sql, marks, out, until);
  } catch (e) { out.error = String(e.message).slice(0, 200); console.error('HUBSPOT_PUSH', e.message); }
  await sql`insert into settings (key, value) values ('hubspot_push', (${JSON.stringify(marks)}::text)::jsonb) on conflict (key) do update set value = excluded.value`;
  return out;
}

module.exports = { push, contactProps, clinicProps, valueFor, FIELD };
