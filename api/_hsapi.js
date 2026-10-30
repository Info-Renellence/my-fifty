// v2 behind HubSpot's API shape (owner 2026-10-30: "everything that writes to hubspot will now only write to v2, everything
// that reads from hubspot will now only read from v2"). n8n's HubSpot steps keep their logic and only change their address
// from https://api.hubapi.com to https://my-fifty.vercel.app/api/hs (api/hs.js); nothing here calls HubSpot.
//
// Reads (search, get, batch read, associations) answer from v2 in HubSpot's shape. The books are small (hundreds of rows),
// so each read loads the live rows of one type and filters them here with HubSpot's operators.
// Writes: contacts and companies (clinics) are written here with the same field rules as the migration (api/_hsmap.js);
// orders, line items and activities go through api/intake.js (the path the n8n Mirror steps proved since Oct 27), with an
// answer made here instead of HubSpot's. Deals are not in v2 (data model; owner Q8): their calls answer harmlessly.
//
// Ids: a record from HubSpot keeps its HubSpot id (legacy_id). A record n8n creates here gets a new 13-digit id starting
// with 9 (HubSpot's are 12 digits) as its legacy_id. A record made in Pulse or Edge (no numeric legacy_id) is shown under a
// stable alias: 8 + 12 digits from its v2 id, never stored. Every write is kept in ingest_events (source n8n) like a Mirror copy.
'use strict';
const crypto = require('crypto');
const M = require('./_hsmap');
const I = require('./intake');

const fail = (status, message, category) => { const e = new Error(message); e.status = status; e.hs = { status: 'error', message, category: category || 'VALIDATION_ERROR' }; return e; };
const s = (v) => (v == null ? '' : String(v));
const numeric = (v) => /^\d+$/.test(s(v));
const alias = (uuid) => '8' + String(parseInt(crypto.createHash('sha1').update(s(uuid)).digest('hex').slice(0, 12), 16) % 1e12).padStart(12, '0');
const newId = () => '9' + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
const iso = (d) => (d ? new Date(d).toISOString() : null);

// HubSpot owner id <-> v2 user (api/_hsmap.js OWNER_EMAIL and the staff ids).
const OWNERS = { 90578348: 'emily@renellence.com', 262421813: 'aria.moghimi@renellence.com', 266396716: 'brittany.houston@renellence.com',
  268233660: 'sam.almas@renellence.com', 268233804: 'lucas.stockley@renellence.com', 269812022: 'angela.tuzzolino@renellence.com' };
const OWNER_OF = {};
for (const [k, e] of Object.entries(OWNERS)) OWNER_OF[M.uid('user:' + e)] = k;
OWNER_OF[M.STAFF.admin] = '265024667'; OWNER_OF[M.STAFF.info] = '265024690';
// HubSpot order pipeline stages (the Internal Sales Form's) for v2 statuses.
const STAGE = { processed: '937ea84d-0a4f-4dcf-9028-3f9c2aafbf03', shipped: 'aa99e8d0-c1d5-4071-b915-d240bbb1aed9',
  delivered: '3725360f-519b-4b18-a593-494d60a29c9f', cancelled: '3c85a297-e9ce-400b-b42e-9f16853d69d6' };
const stageOf = (st) => (st === 'delivered' ? STAGE.delivered : st === 'shipped' ? STAGE.shipped : ['cancelled', 'rejected'].includes(st) ? STAGE.cancelled : STAGE.processed);
const ROLE = { md: 'MD', np: 'NP', rn: 'RN', rpn: 'RPN', dds: 'Other', other: 'Other' };
const PROVINCE_NAME = { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia',
  NB: 'New Brunswick', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island', YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut' };

// ---- v2 rows -> HubSpot-shaped records ---------------------------------------------------------------------------------
const idFor = (row) => (numeric(row.legacy_id) ? s(row.legacy_id) : alias(row.id));
const rec = (row, props) => ({ id: idFor(row), properties: Object.assign({ hs_object_id: idFor(row) }, props), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) || iso(row.created_at), archived: false });

async function contacts(sql) {
  const rows = await sql`
    select c.*, cl.name as clinic_name, cl.legacy_id as clinic_legacy, cl.id as clinic_uuid,
           exists (select 1 from orders o join order_lines l on l.order_id = o.id where o.contact_id = c.id and o.deleted_at is null
                     and o.status::text not in ('cancelled','rejected') and l.is_free is not true) as bought,
           (select o.status::text from onboardings o where o.primary_contact_id = c.id or o.injector_contact_id = c.id order by o.created_at desc limit 1) as onboarding
      from contacts c left join clinics cl on cl.id = c.clinic_id
     where c.deleted_at is null and c.merged_into_contact_id is null`;
  return rows.map((c) => Object.assign(rec(c, {
    email: s(c.email), firstname: s(c.first_name), lastname: s(c.last_name), phone: s(c.phone), mobilephone: s(c.mobile_phone), secondary_email: s(c.secondary_email),
    company: s(c.clinic_name), clinic_name: s(c.clinic_name), what_is_your_clinic_name: s(c.clinic_name),
    associatedcompanyid: c.clinic_uuid ? (numeric(c.clinic_legacy) ? s(c.clinic_legacy) : alias(c.clinic_uuid)) : '',
    address: s(c.shipping_street), city: s(c.shipping_city), state: PROVINCE_NAME[c.shipping_province] || s(c.shipping_province), province: s(c.shipping_province), zip: s(c.shipping_postal_code),
    hubspot_owner_id: s(OWNER_OF[c.owner_id]), role: ROLE[c.designation] || '', jobtitle: c.is_medical_director ? 'Medical Director' : '',
    lifecyclestage: c.bought ? 'customer' : c.onboarding ? 'opportunity' : 'lead', hs_lead_status: '',
    hs_analytics_source: c.lead_source === 'social' ? 'PAID_SOCIAL' : 'OFFLINE', hs_analytics_source_data_2: '',
    status_notes: '', commitment: 'false', contact_name: [c.first_name, c.last_name].filter(Boolean).join(' '),
    createdate: iso(c.created_at), lastmodifieddate: iso(c.updated_at) || iso(c.created_at),
  }), { _uuid: c.id, _md: c.medical_director_contact_id, _clinic: c.clinic_uuid }));
}
async function companies(sql) {
  const rows = await sql`select * from clinics where deleted_at is null`;
  return rows.map((cl) => rec(cl, { name: s(cl.name), phone: s(cl.main_phone), website: s(cl.website), domain: s(cl.website).replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    address: s(cl.street), city: s(cl.city), state: PROVINCE_NAME[cl.province] || s(cl.province), province: s(cl.province), zip: s(cl.postal_code), country: 'Canada',
    hours_of_operation: s(cl.hours_of_operation), createdate: iso(cl.created_at), lastmodifieddate: iso(cl.updated_at) || iso(cl.created_at) }))
    .map((r, i) => Object.assign(r, { _uuid: rows[i].id }));
}
async function orders(sql) {
  const rows = await sql`
    select o.*, c.first_name, c.last_name, c.id as contact_uuid, c.legacy_id as contact_legacy, cl.id as clinic_uuid, cl.legacy_id as clinic_legacy,
           coalesce((select sum(l.quantity * l.unit_price) from order_lines l where l.order_id = o.id), 0)::float8 as subtotal,
           (select p.status::text from payments p where p.order_id = o.id order by p.created_at desc limit 1) as pay_status
      from orders o left join contacts c on c.id = o.contact_id left join clinics cl on cl.id = c.clinic_id
     where o.deleted_at is null`;
  return rows.map((o) => {
    const total = Math.max(0, o.subtotal - Number(o.discount_amount || 0)) + Number(o.tax_amount || 0) + Number(o.shipping_amount || 0);
    return Object.assign(rec(o, {
      hs_order_name: s(o.order_number), hs_order_note: s(o.approval_note), tracking_number: s(o.tracking_number), tracking_url: s(o.tracking_url),
      hs_pipeline_stage: stageOf(o.status), hs_external_order_id: s(o.shopify_order_id), hs_createdate: iso(o.created_at), createdate: iso(o.created_at),
      hs_external_created_date: iso(o.submitted_at || o.created_at), hs_subtotal_price: String(o.subtotal), hs_total_price: String(Math.round(total * 100) / 100),
      hs_tax: s(o.tax_amount), hs_shipping_cost: s(o.shipping_amount), hs_order_discount: s(o.discount_amount),
      hs_billing_address_name: [o.first_name, o.last_name].filter(Boolean).join(' '), qbo_id: s(o.quickbooks_invoice_id),
      payment_type: o.payment_method === 'wire' ? 'Payment Terms' : o.payment_method ? 'Card on File' : '',
      hs_payment_status: o.pay_status === 'succeeded' ? 'Paid' : o.pay_status === 'pending' ? 'Payment Pending' : '',
      hs_is_canceled: String(o.status === 'cancelled'), hs_closed_date: iso(o.delivered_at || o.cancelled_at), hubspot_owner_id: s(OWNER_OF[o.rep_id]),
      hs_lastmodifieddate: iso(o.updated_at),
    }), { _uuid: o.id, _contact: o.contact_uuid ? (numeric(o.contact_legacy) ? s(o.contact_legacy) : alias(o.contact_uuid)) : null,
      _clinic: o.clinic_uuid ? (numeric(o.clinic_legacy) ? s(o.clinic_legacy) : alias(o.clinic_uuid)) : null });
  });
}
async function lineItems(sql) {
  const rows = await sql`select l.*, o.id as order_uuid, o.legacy_id as order_legacy from order_lines l join orders o on o.id = l.order_id where o.deleted_at is null`;
  return rows.map((l) => {
    const id = /^hubspot:\d+$/.test(s(l.external_id)) ? s(l.external_id).slice(8) : alias(l.id);
    return { id, properties: { hs_object_id: id, name: s(l.product_name), hs_sku: s(l.product_sku), quantity: String(l.quantity), price: String(l.unit_price),
      amount: String(Number(l.quantity) * Number(l.unit_price)) }, createdAt: iso(l.created_at), updatedAt: iso(l.created_at), archived: false,
      _order: numeric(l.order_legacy) ? s(l.order_legacy) : alias(l.order_uuid) };
  });
}
const LOAD = { contacts, companies, orders, line_items: lineItems };

// ---- HubSpot's search ---------------------------------------------------------------------------------------------------
const asNum = (v) => { if (v == null || v === '') return NaN; if (numeric(v)) return Number(v); const t = Date.parse(v); return isNaN(t) ? Number(v) : t; };
function matches(r, f) {
  const v = r.properties[f.propertyName] != null ? s(r.properties[f.propertyName]) : f.propertyName === 'hs_object_id' ? r.id : '';
  const lv = v.toLowerCase(), want = s(f.value).toLowerCase();
  switch (String(f.operator || 'EQ').toUpperCase()) {
    case 'EQ': return lv === want;
    case 'NEQ': return lv !== want;
    case 'IN': return (f.values || []).map((x) => s(x).toLowerCase()).includes(lv);
    case 'NOT_IN': return !(f.values || []).map((x) => s(x).toLowerCase()).includes(lv);
    case 'HAS_PROPERTY': return v !== '';
    case 'NOT_HAS_PROPERTY': return v === '';
    case 'CONTAINS_TOKEN': return want.replace(/\*/g, '') !== '' && lv.includes(want.replace(/\*/g, ''));
    case 'NOT_CONTAINS_TOKEN': return !lv.includes(want.replace(/\*/g, ''));
    case 'GT': return asNum(v) > asNum(f.value);
    case 'GTE': return asNum(v) >= asNum(f.value);
    case 'LT': return asNum(v) < asNum(f.value);
    case 'LTE': return asNum(v) <= asNum(f.value);
    case 'BETWEEN': return asNum(v) >= asNum(f.value) && asNum(v) <= asNum(f.highValue);
    default: return false;
  }
}
const pick = (r, props) => {
  const keep = ['hs_object_id', 'createdate', 'lastmodifieddate'].concat(props || []);
  const p = {};
  for (const k of keep) if (k in r.properties) p[k] = r.properties[k] === '' ? null : r.properties[k];
  return { id: r.id, properties: p, createdAt: r.createdAt, updatedAt: r.updatedAt, archived: false };
};
function search(rows, b) {
  const groups = (b.filterGroups || []).filter((g) => (g.filters || []).length);
  // a filter on an association (deals by contact) has no v2 answer: nothing matches
  let out = rows.filter((r) => !groups.length || groups.some((g) => g.filters.every((f) => !/^associations\./.test(s(f.propertyName)) && matches(r, f))));
  if (b.query) { const q = s(b.query).toLowerCase(); out = out.filter((r) => Object.values(r.properties).some((v) => s(v).toLowerCase().includes(q))); }
  const sort = (b.sorts || [])[0];
  if (sort) {
    const k = typeof sort === 'string' ? sort.replace(/^-/, '') : sort.propertyName, desc = typeof sort === 'string' ? sort.startsWith('-') : String(sort.direction).toUpperCase() === 'DESCENDING';
    out.sort((a, c) => { const x = asNum(a.properties[k]), y = asNum(c.properties[k]); const d = !isNaN(x) && !isNaN(y) ? x - y : s(a.properties[k]).localeCompare(s(c.properties[k])); return desc ? -d : d; });
  }
  const limit = Math.min(Math.max(Number(b.limit) || 10, 1), 200), after = Number(b.after) || 0;
  const page = out.slice(after, after + limit).map((r) => pick(r, b.properties));
  return Object.assign({ total: out.length, results: page }, after + limit < out.length ? { paging: { next: { after: String(after + limit) } } } : {});
}
const find = (rows, id) => rows.find((r) => r.id === s(id) || r._uuid === s(id)) || null;

// ---- associations (v2's links, in HubSpot's v4 shape) -------------------------------------------------------------------
const LABEL = { contacts: { companies: [1, 'Primary'], contacts: [449, 'Medical Director'] }, companies: { contacts: [2, null], orders: [510, null] },
  orders: { contacts: [507, null], companies: [509, null], line_items: [513, null] } };
const linkOf = (from, to, id) => { const t = (LABEL[from] || {})[to] || [0, null]; return { toObjectId: Number(id) || id, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: t[0], label: t[1] }] }; };
async function associated(sql, from, id, to) {
  if (to === 'deals') return [];
  const L = await LOAD[from](sql);
  const r = find(L, id);
  if (!r) return [];
  if (from === 'contacts' && to === 'companies') return r.properties.associatedcompanyid ? [r.properties.associatedcompanyid] : [];
  if (from === 'contacts' && to === 'contacts') {
    const C = L, out = [];
    if (r._md) { const md = C.find((x) => x._uuid === r._md); if (md) out.push(md.id); }
    for (const x of C) if (x._md === r._uuid) out.push(x.id);   // the people this MD signs for
    return out;
  }
  if (from === 'contacts' && to === 'orders') return (await orders(sql)).filter((o) => o._contact === r.id).map((o) => o.id);
  if (from === 'companies' && to === 'contacts') return (await contacts(sql)).filter((c) => c.properties.associatedcompanyid === r.id).map((c) => c.id);
  if (from === 'companies' && to === 'orders') return (await orders(sql)).filter((o) => o._clinic === r.id).map((o) => o.id);
  if (from === 'orders' && to === 'contacts') return r._contact ? [r._contact] : [];
  if (from === 'orders' && to === 'companies') return r._clinic ? [r._clinic] : [];
  if (from === 'orders' && to === 'line_items') return (await lineItems(sql)).filter((l) => l._order === r.id).map((l) => l.id);
  return [];
}

// ---- writes ---------------------------------------------------------------------------------------------------------------
async function keep(sql, ctx, hs) {   // every write on file, like a Mirror copy (and api/_payload.js reads them back)
  const external = 'v2api:' + crypto.createHash('sha256').update([ctx.wf, ctx.node, hs.method, hs.url, JSON.stringify(hs.body || null), JSON.stringify(hs.response || null), Date.now(), Math.random()].join('|')).digest('hex');
  const [ev] = await sql`insert into ingest_events (source, external_id, payload, received_via, status, attempts, received_at, processed_at)
    values ('n8n', ${external}, ${sql.json({ wf: ctx.wf || '', node: ctx.node || '', hs, via: 'v2api' })}, 'n8n', 'done', 1, now(), now()) returning id`;
  return ev.id;
}
// The v2 row behind a HubSpot-shaped id (legacy, alias or uuid).
async function rowOf(sql, table, id) {
  id = s(id);
  if (numeric(id) && id[0] !== '8') { const [r] = await sql.unsafe(`select * from public.${table} where legacy_id = $1 and deleted_at is null limit 1`, [id]); if (r) return r; }
  if (/^[0-9a-f-]{36}$/i.test(id)) { const [r] = await sql.unsafe(`select * from public.${table} where id = $1 and deleted_at is null`, [id]); return r || null; }
  if (/^8\d{12}$/.test(id)) {
    const rows = await sql.unsafe(`select * from public.${table} where deleted_at is null and (legacy_id is null or legacy_id !~ '^[0-9]+$')`);
    return rows.find((r) => alias(r.id) === id) || null;
  }
  return null;
}
const txOf = (sql, fn) => sql.begin(async (tx) => { await tx`select set_config('app.source', 'n8n', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`; return fn(tx); });
function clean(row) { for (const k of Object.keys(row)) if (row[k] == null) delete row[k]; return row; }

async function createContact(sql, ctx, body) {
  const p = Object.assign({}, body.properties || {});
  const em = M.email(p.email);
  if (em) {
    const [dup] = await sql`select id, legacy_id from contacts where deleted_at is null and (lower(email::text) = ${em} or lower(secondary_email::text) = ${em}) limit 1`;
    if (dup) throw fail(409, 'Contact already exists. Existing ID: ' + idFor(dup), 'CONFLICT');
  }
  const id = newId();
  const row = Object.assign({ id: M.uid('contact:' + id) }, M.contactRow(id, p));
  if (!row.owner_id) delete row.owner_id;
  if (p.lifecyclestage === 'lead' || p.hs_lead_status) row.lead_source = row.lead_source || 'warm';
  const coId = linkTo(body, 'companies');
  await txOf(sql, async (tx) => {
    if (coId) { const cl = await rowOf(tx, 'clinics', coId); if (cl) row.clinic_id = cl.id; }
    await tx`insert into contacts ${tx(clean(row))}`;
  });
  const out = { id, properties: Object.assign({ hs_object_id: id, createdate: new Date().toISOString(), lastmodifieddate: new Date().toISOString() }, p), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false };
  await keep(sql, ctx, { method: 'POST', url: '/crm/v3/objects/contacts', body, response: out });
  return out;
}
async function patchContact(sql, ctx, id, body) {
  const p = body.properties || {};
  const cur = await rowOf(sql, 'contacts', id);
  if (!cur) throw fail(404, 'resource not found', 'OBJECT_NOT_FOUND');
  const cols = M.columnsFor(M.CONTACT_PROPS, Object.keys(p));
  const row = M.contactRow(cur.legacy_id || id, p);
  const set = {};
  for (const k of cols) if (row[k] != null && s(cur[k]) !== s(row[k])) set[k] = row[k];
  if (Object.keys(set).length) await txOf(sql, (tx) => tx`update contacts set ${tx(set)} where id = ${cur.id}`);
  const out = { id: s(id), properties: Object.assign({ hs_object_id: s(id), lastmodifieddate: new Date().toISOString() }, p), updatedAt: new Date().toISOString(), archived: false };
  await keep(sql, ctx, { method: 'PATCH', url: '/crm/v3/objects/contacts/' + id, body, response: out });
  return out;
}
async function createCompany(sql, ctx, body) {
  const p = body.properties || {};
  const id = newId();
  const row = Object.assign({ id: M.uid('clinic:' + id) }, M.clinicRow(id, p));
  if (!row.name) throw fail(400, 'Property values were not valid: name is required');
  await txOf(sql, (tx) => tx`insert into clinics ${tx(clean(row))}`);
  const out = { id, properties: Object.assign({ hs_object_id: id, createdate: new Date().toISOString() }, p), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false };
  await keep(sql, ctx, { method: 'POST', url: '/crm/v3/objects/companies', body, response: out });
  return out;
}
async function patchCompany(sql, ctx, id, body) {
  const p = body.properties || {};
  const cur = await rowOf(sql, 'clinics', id);
  if (!cur) throw fail(404, 'resource not found', 'OBJECT_NOT_FOUND');
  const cols = M.columnsFor(M.COMPANY_PROPS, Object.keys(p));
  const row = M.clinicRow(cur.legacy_id || id, p);
  const set = {};
  for (const k of cols) if (row[k] != null && s(cur[k]) !== s(row[k])) set[k] = row[k];
  if (Object.keys(set).length) await txOf(sql, (tx) => tx`update clinics set ${tx(set)} where id = ${cur.id}`);
  const out = { id: s(id), properties: Object.assign({ hs_object_id: s(id) }, p), updatedAt: new Date().toISOString(), archived: false };
  await keep(sql, ctx, { method: 'PATCH', url: '/crm/v3/objects/companies/' + id, body, response: out });
  return out;
}
// contact -> clinic, contact -> MD; other links (company to company, deals) are not in v2.
async function link(sql, ctx, from, a, to, b, hsPath) {
  if (from === 'contacts' && to === 'companies') {
    const c = await rowOf(sql, 'contacts', a), cl = await rowOf(sql, 'clinics', b);
    if (c && cl) await txOf(sql, (tx) => tx`update contacts set clinic_id = ${cl.id} where id = ${c.id} and clinic_id is distinct from ${cl.id}`);
  } else if (from === 'contacts' && to === 'contacts') {
    const c = await rowOf(sql, 'contacts', a), md = await rowOf(sql, 'contacts', b);
    if (c && md && c.id !== md.id) await txOf(sql, async (tx) => {
      await tx`update contacts set medical_director_contact_id = ${md.id} where id = ${c.id} and medical_director_contact_id is distinct from ${md.id}`;
      await tx`update contacts set is_medical_director = true where id = ${md.id} and is_medical_director is not true`;
    });
  }
  await keep(sql, ctx, { method: 'PUT', url: hsPath, body: null, response: { ok: true } });
  return { fromObjectTypeId: from, fromObjectId: Number(a) || a, toObjectTypeId: to, toObjectId: Number(b) || b, labels: [] };
}
function linkTo(body, type) {   // body.associations [{ to: { id }, types: [{ associationTypeId }] }] -> the first id of that type
  const IDS = { companies: [1, 279], contacts: [3, 507, 202, 194], line_items: [514] };
  for (const a of body.associations || []) {
    const t = ((a.types || [])[0] || {}).associationTypeId;
    if ((IDS[type] || []).includes(Number(t))) return s(a.to && a.to.id);
  }
  return null;
}
// orders, line items, notes, calls, meetings, tasks: through api/intake.js with an answer made here (a new id per record).
async function viaIntake(sql, ctx, method, path, body, idFromPath) {
  const now = new Date().toISOString();
  let response;
  if (/\/batch\/(create|update)$/.test(path)) {
    response = { status: 'COMPLETE', results: (body.inputs || []).map((x) => ({ id: s(x.id) || newId(), properties: Object.assign({}, x.properties || {}), createdAt: now, updatedAt: now, archived: false })) };
  } else {
    const id = idFromPath || newId();
    response = { id, properties: Object.assign({ hs_object_id: id, hs_createdate: now, hs_lastmodifieddate: now }, body.properties || {}), createdAt: now, updatedAt: now, archived: false };
  }
  const r = await I.intake(sql, { wf: ctx.wf || 'n8n', node: (ctx.node || '') + ' (v2api)', hs: { method, url: 'https://api.hubapi.com' + path, body: JSON.stringify(body || {}), response } });
  if (r && r.failed) throw fail(500, 'v2 write failed: ' + (r.error || 'unknown'));
  return response;
}
// The id of a v2 order/contact behind an id the workflow holds, as api/intake.js expects it (a numeric HubSpot-style id).
async function ensureNumeric(sql, table, id) {
  if (numeric(id) && id[0] !== '8') return s(id);
  const r = await rowOf(sql, table, id);
  if (!r) return s(id);
  if (numeric(r.legacy_id)) return s(r.legacy_id);
  if (r.legacy_id) return s(id);   // a non-numeric legacy id (an old-Edge event person): left as it is
  const n = newId();
  await sql.unsafe(`update public.${table} set legacy_id = $1 where id = $2 and legacy_id is null`, [n, r.id]);
  return n;
}

// ---- files (signed PDFs) into v2 Storage ----------------------------------------------------------------------------------
async function upload(sql, ctx, file) {
  const base = s(process.env.SUPABASE_URL).replace(/\/$/, ''), key = s(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!base || !key) throw fail(503, 'file storage not set up');
  const F = require('./_files');
  const fileId = crypto.randomUUID();
  const ext = F.extOf(file.filename, file.contentType);
  const path = 'unfiled/' + fileId + '.' + ext;   // moved onto the customer by the note that attaches it
  const r = await fetch(base + '/storage/v1/object/files/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': file.contentType || 'application/octet-stream' }, body: file.data });
  if (!r.ok) throw fail(502, 'file upload failed: ' + r.status);
  await sql`insert into files (id, storage_path, file_name, mime_type, size_bytes) values (${fileId}, ${path}, ${s(file.filename).slice(0, 200) || 'file.' + ext}, ${file.contentType || null}, ${file.data.length})`;
  const id = alias(fileId);
  await keep(sql, ctx, { method: 'POST', url: '/files/v3/files', body: { name: file.filename }, response: { id, v2: fileId } });
  return { id, name: file.filename, extension: ext, access: 'PRIVATE', size: file.data.length, url: base + '/storage/v1/object/files/' + path, createdAt: new Date().toISOString(), archived: false };
}
// A note that attaches uploaded files to a contact (or a company: its main contact): the files go on that person.
async function attachFiles(sql, body) {
  const ids = s((body.properties || {}).hs_attachment_ids).split(';').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) return;
  const cId = linkTo(body, 'contacts'), coId = linkTo(body, 'companies');
  let contact = cId ? await rowOf(sql, 'contacts', cId) : null;
  if (!contact && coId) { const cl = await rowOf(sql, 'clinics', coId); if (cl) [contact] = await sql`select * from contacts where clinic_id = ${cl.id} and deleted_at is null order by created_at limit 1`; }
  if (!contact) return;
  const files = await sql`select id from files where contact_id is null and storage_path like 'unfiled/%'`;
  for (const f of files) if (ids.includes(alias(f.id))) await sql`update files set contact_id = ${contact.id} where id = ${f.id}`;
}

// ---- the router -----------------------------------------------------------------------------------------------------------
const TYPES = { contacts: 'contacts', contact: 'contacts', companies: 'companies', company: 'companies', orders: 'orders', order: 'orders', line_items: 'line_items',
  deals: 'deals', deal: 'deals', notes: 'notes', calls: 'calls', meetings: 'meetings', tasks: 'tasks' };
const T = (x) => TYPES[s(x).toLowerCase()] || s(x).toLowerCase();
const ACT = ['notes', 'calls', 'meetings', 'tasks'];

async function handle(sql, method, path, query, body, ctx) {
  method = method.toUpperCase();
  path = '/' + s(path).replace(/^\/+/, '').replace(/\?.*$/, '');
  // An id this API gave that the HubSpot copy (api/_hspush.js) has since swapped for HubSpot's own: the new one.
  if (!body.__file && /9\d{12}/.test(path + JSON.stringify(body))) {
    const [r] = await sql`select value->'ids' as ids from settings where key = 'hubspot_push'`;
    const ids = (r && r.ids) || {};
    const swap = (t) => t.replace(/9\d{12}/g, (x) => ids[x] || x);
    path = swap(path); body = JSON.parse(swap(JSON.stringify(body)));
  }
  let m;
  const props = s(query.get && query.get('properties')).split(',').filter(Boolean);
  // files
  if (path === '/files/v3/files' && method === 'POST') return upload(sql, ctx, body.__file || {});
  // owners
  if (/^\/crm\/v3\/owners\/?$/.test(path)) return { results: Object.entries(OWNERS).map(([id, email]) => ({ id, email, userId: Number(id), archived: false })) };
  // v4 association batch read: POST /crm/v4/associations/{from}/{to}/batch/read
  if ((m = path.match(/^\/crm\/v4\/associations\/(\w+)\/(\w+)\/batch\/read$/))) {
    const from = T(m[1]), to = T(m[2]);
    const results = [];
    for (const x of body.inputs || []) { const ids = await associated(sql, from, x.id, to); if (ids.length) results.push({ from: { id: s(x.id) }, to: ids.map((i) => linkOf(from, to, i)) }); }
    return { status: 'COMPLETE', results };
  }
  if ((m = path.match(/^\/crm\/v4\/associations\/(\w+)\/(\w+)\/batch\/create$/))) return { status: 'COMPLETE', results: [] };   // order-deal links: not in v2
  if ((m = path.match(/^\/crm\/v4\/associations\/(\w+)\/(\w+)\/labels$/))) return { results: [{ category: 'HUBSPOT_DEFINED', typeId: 1, label: null }] };
  // GET associations: /crm/v3|v4/objects/{from}/{id}/associations/{to}
  if ((m = path.match(/^\/crm\/v[34]\/objects\/(\w+)\/([\w-]+)\/associations\/(\w+)\/?$/)) && method === 'GET') {
    const from = T(m[1]), to = T(m[3]);
    const ids = await associated(sql, from, m[2], to);
    return { results: ids.map((i) => (path.includes('/v4/') ? linkOf(from, to, i) : { id: s(i), type: from.replace(/s$/, '') + '_to_' + to.replace(/s$/, '') })) };
  }
  // PUT a link: /crm/v3/objects/{from}/{id}/associations/{to}/{toId}/{type} or /crm/v4/objects/{from}/{id}/associations/{to}/{toId}
  if ((m = path.match(/^\/crm\/v[34]\/objects\/(\w+)\/([\w-]+)\/associations\/(\w+)\/([\w-]+)/)) && method === 'PUT') return link(sql, ctx, T(m[1]), m[2], T(m[3]), m[4], path);
  if ((m = path.match(/^\/crm\/v[34]\/objects\/(\w+)\/([\w-]+)\/associations\/(\w+)\/([\w-]+)/)) && method === 'DELETE') return {};
  // deals: not in v2 (owner Q8) - an empty search, a harmless id
  if ((m = path.match(/^\/crm\/v3\/objects\/deals(?:\/(.*))?$/))) {
    if (m[1] === 'search') return { total: 0, results: [] };
    if (m[1] && m[1].startsWith('batch')) return { status: 'COMPLETE', results: [] };
    const id = m[1] || newId();
    await keep(sql, ctx, { method, url: path, body, response: { id, skipped: 'deals are not in v2' } });
    return { id: s(id), properties: Object.assign({ hs_object_id: s(id) }, (body && body.properties) || {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false };
  }
  // search
  if ((m = path.match(/^\/crm\/v3\/objects\/(\w+)\/search$/)) && method === 'POST') {
    const t = T(m[1]);
    if (!LOAD[t]) return { total: 0, results: [] };
    return search(await LOAD[t](sql), body);
  }
  // batch read
  if ((m = path.match(/^\/crm\/v3\/objects\/(\w+)\/batch\/read$/)) && method === 'POST') {
    const t = T(m[1]);
    if (!LOAD[t]) return { status: 'COMPLETE', results: [] };
    const L = await LOAD[t](sql);
    return { status: 'COMPLETE', results: (body.inputs || []).map((x) => find(L, x.id)).filter(Boolean).map((r) => pick(r, body.properties)) };
  }
  // batch update (contacts: Lead Clean)
  if ((m = path.match(/^\/crm\/v3\/objects\/(\w+)\/batch\/update$/)) && method === 'POST') {
    const t = T(m[1]);
    if (t === 'contacts' || t === 'companies') {
      const results = [];
      for (const x of body.inputs || []) results.push(t === 'contacts' ? await patchContact(sql, ctx, x.id, { properties: x.properties }) : await patchCompany(sql, ctx, x.id, { properties: x.properties }));
      return { status: 'COMPLETE', results };
    }
    return viaIntake(sql, ctx, 'POST', path, body);
  }
  // batch create (line items, notes)
  if ((m = path.match(/^\/crm\/v3\/objects\/(\w+)\/batch\/create$/)) && method === 'POST') {
    if (T(m[1]) === 'notes') for (const x of body.inputs || []) await attachFiles(sql, x);
    return viaIntake(sql, ctx, 'POST', path, body);
  }
  // get one
  if ((m = path.match(/^\/crm\/v3\/objects\/(\w+)\/([\w-]+)$/)) && method === 'GET') {
    const t = T(m[1]);
    if (!LOAD[t]) throw fail(404, 'resource not found', 'OBJECT_NOT_FOUND');
    const r = find(await LOAD[t](sql), m[2]);
    if (!r) throw fail(404, 'resource not found', 'OBJECT_NOT_FOUND');
    return pick(r, props);
  }
  // create
  if ((m = path.match(/^\/crm\/v3\/objects\/(\w+)\/?$/)) && method === 'POST') {
    const t = T(m[1]);
    if (t === 'contacts') return createContact(sql, ctx, body);
    if (t === 'companies') return createCompany(sql, ctx, body);
    if (t === 'notes') await attachFiles(sql, body);
    if (t === 'orders') {   // its customer and line items, as ids intake can follow
      for (const a of body.associations || []) if (a.to && a.to.id && Number(((a.types || [])[0] || {}).associationTypeId) === 507) a.to.id = await ensureNumeric(sql, 'contacts', a.to.id);
    }
    if (t === 'orders' || t === 'line_items' || ACT.includes(t)) return viaIntake(sql, ctx, 'POST', path, body);
    throw fail(400, 'unsupported object: ' + t);
  }
  // patch
  if ((m = path.match(/^\/crm\/v3\/objects\/(\w+)\/([\w-]+)$/)) && method === 'PATCH') {
    const t = T(m[1]);
    if (t === 'contacts') return patchContact(sql, ctx, m[2], body);
    if (t === 'companies') return patchCompany(sql, ctx, m[2], body);
    if (t === 'orders') { const id = await ensureNumeric(sql, 'orders', m[2]); return viaIntake(sql, ctx, 'PATCH', '/crm/v3/objects/orders/' + id, body, id); }
    if (ACT.includes(t)) return viaIntake(sql, ctx, 'PATCH', path, body, m[2]);
    throw fail(400, 'unsupported object: ' + t);
  }
  throw fail(404, 'unsupported path: ' + method + ' ' + path);
}

module.exports = { handle, search, matches, alias, newId, idFor, OWNER_OF, STAGE, stageOf, LOAD, associated };
