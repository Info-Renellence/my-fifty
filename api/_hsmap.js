// HubSpot record -> v2 row, with the same rules and the same ids as the Oct 22 load and the Oct 27 backfill
// (renellence-ops/ops/migration/build.js + data-audit/migration-scope/clean/clean.js). Used by api/intake.js, which
// receives n8n's copies of its HubSpot writes (owner 2026-10-27: "wherever n8n writes to HubSpot, it now needs to
// write to v2"). Pure functions only: no network, no database.
//
// Ids: every row that came from HubSpot has a fixed id made from its HubSpot id (uid below, the migration's own
// namespace), so a record loaded on Oct 22, backfilled on Oct 27 or arriving through n8n is always the same row.
'use strict';
const crypto = require('crypto');

const uid = (key) => {
  const h = crypto.createHash('md5').update('renellence-migration-2026-10-22:' + key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// HubSpot owner id -> v2 user id (the migration's users; info@ and admin@ keep their staff ids).
const STAFF = { admin: 'e6e0ca09-1fc7-4e07-9097-5a3f9c9697d6', info: '2c2a9af5-a45a-4973-ad24-1d51c9ca0833' };
const OWNER_EMAIL = { 90578348: 'emily@renellence.com', 262421813: 'aria.moghimi@renellence.com', 266396716: 'brittany.houston@renellence.com',
  268233660: 'sam.almas@renellence.com', 268233804: 'lucas.stockley@renellence.com', 269812022: 'angela.tuzzolino@renellence.com' };
function ownerUser(hsOwnerId) {
  const k = String(hsOwnerId || '');
  if (k === '265024667') return STAFF.admin;
  if (k === '265024690') return STAFF.info;
  return OWNER_EMAIL[k] ? uid('user:' + OWNER_EMAIL[k]) : null;
}
// The "Rep:" name in an Internal Sales Form order note.
const REP_NAME = { 'Info Renellence': 'info', Renellence: 'info', 'Emily Weber': 'emily@renellence.com', 'Emily Grace': 'emily@renellence.com',
  'Sam Almas': 'sam.almas@renellence.com', 'Samantha Almas': 'sam.almas@renellence.com', 'Lucas Stockley': 'lucas.stockley@renellence.com',
  'Brittany Houston': 'brittany.houston@renellence.com', 'Angela Tuzzolino': 'angela.tuzzolino@renellence.com', 'Aria Moghimi': 'aria.moghimi@renellence.com' };
const repFromName = (n) => { const e = REP_NAME[String(n || '').trim()]; return !e ? null : e === 'info' ? STAFF.info : uid('user:' + e); };

const s = (v) => (v == null ? '' : String(v).trim());
const orNull = (v) => (s(v) ? s(v) : null);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (v) => (v ? new Date(/^\d+$/.test(String(v)) ? Number(v) : v).toISOString() : null);
const email = (v) => { const e = s(v).toLowerCase().replace(/^mailto:/, ''); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) ? e : null; };
function e164(v) {
  let d = s(v).replace(/(ext|x|#).*$/i, '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 && /^[2-9]\d\d[2-9]/.test(d) ? '+1' + d : null;
}
const PROVINCES = { ontario: 'ON', quebec: 'QC', 'québec': 'QC', 'british columbia': 'BC', alberta: 'AB', manitoba: 'MB', saskatchewan: 'SK', 'nova scotia': 'NS',
  'new brunswick': 'NB', 'newfoundland and labrador': 'NL', newfoundland: 'NL', 'prince edward island': 'PE', yukon: 'YT', 'northwest territories': 'NT', nunavut: 'NU' };
function province(v) {
  const x = s(v); if (!x) return null;
  if (/^[A-Za-z]{2}$/.test(x)) return x.toUpperCase();
  return PROVINCES[x.toLowerCase()] || x;
}
const postal = (v) => { const x = s(v).toUpperCase().replace(/\s+/g, ''); return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(x) ? x.slice(0, 3) + ' ' + x.slice(3) : orNull(v); };

// Designation from a job title (clean.js fromTitle, the designation part).
function titleDesignation(t) {
  const x = s(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!x) return null;
  if (/dentist|\bdds\b|\bdmd\b|dental/.test(x)) return 'dds';
  if (/nurse practitioner|\bnp\b|np-phc|\bdnp\b|infirmiere praticienne/.test(x)) return 'np';
  if (/\brpn\b|registered practical|practical nurse/.test(x)) return 'rpn';
  if (/\brn\b|registered nurse|\bnurse\b|infirmi|bscn/.test(x)) return 'rn';
  if (/internationa\w* (trained|educated)|\bimg\b|foreign trained/.test(x)) return 'other';
  if (/\bmd\b|m\.d|doctor|physician|dermatolog|surgeon|ophthalmolog|\bdr\b|\bdoc\b|\bgp\b|family med|medecin/.test(x)) return 'md';
  if (/esthetician|aesthetician|cosmetolog|medical aesthetician|laser tech|naturopath|\bnd\b|pharmacist|physiotherap|chiropract/.test(x)) return 'other';
  return null;
}
const ROLE_PROP = { MD: 'md', NP: 'np', RN: 'rn', RPN: 'rpn', IMG: 'other', Other: 'other' };

// A HubSpot contact's properties -> contacts columns (clean.js + owner-answers.js rules, without the one-off repairs of
// old hand-typed data). Only columns with a value are returned.
function contactRow(hsId, p) {
  const designation = ROLE_PROP[p.role] || titleDesignation(p.jobtitle) || (/^dr\.?\s/i.test(s(p.firstname)) ? 'md' : null);
  const title = s(p.jobtitle).toLowerCase();
  let role = null;
  if (designation === 'md') role = 'physician';
  else if (designation === 'dds') role = 'dentist';
  else if (['rn', 'rpn', 'np'].includes(designation)) role = 'injector';
  else if (/inject/.test(title)) role = 'injector';
  else if (/owner|ceo|founder|manager|administrator|reception|front desk|coordinator|director|president|partner/.test(title) && !/medical director/.test(title)) role = 'manager';
  else if (designation === 'other' || title) role = 'other';
  // Lead source: Meta (paid social), an inbound source, else warm (a contact created by a rep or a form: owner 2026-10-22).
  const src = s(p.hs_analytics_source);
  const lead_source = src === 'PAID_SOCIAL' ? 'social' : 'warm';
  const ship = { street: orNull(p.address), city: orNull(p.city), province: province(p.state || p.province), postal: postal(p.zip) };
  const r = {
    first_name: orNull(s(p.firstname).replace(/^dr\.?\s+/i, '')), last_name: orNull(p.lastname), email: email(p.email), secondary_email: email(p.secondary_email),
    phone: e164(p.phone), mobile_phone: e164(p.mobilephone), designation, role, lead_source,
    shipping_street: ship.street, shipping_city: ship.city, shipping_province: ship.province, shipping_postal_code: ship.postal,
    // billing copies shipping when no billing address is known (owner 2026-10-22)
    billing_street: ship.street, billing_city: ship.city, billing_province: ship.province, billing_postal_code: ship.postal,
    is_medical_director: /medical director/i.test(s(p.jobtitle)) ? true : null,
    owner_id: ownerUser(p.hubspot_owner_id), legacy_id: String(hsId),
  };
  for (const k of Object.keys(r)) if (r[k] == null) delete r[k];
  return r;
}

// The v2 columns each HubSpot contact property feeds (a PATCH from n8n changes only these).
const CONTACT_PROPS = { firstname: ['first_name'], lastname: ['last_name'], email: ['email'], secondary_email: ['secondary_email'], phone: ['phone'], mobilephone: ['mobile_phone'],
  jobtitle: ['designation', 'role', 'is_medical_director'], role: ['designation', 'role'], hubspot_owner_id: ['owner_id'],
  address: ['shipping_street', 'billing_street'], city: ['shipping_city', 'billing_city'], state: ['shipping_province', 'billing_province'], province: ['shipping_province', 'billing_province'],
  zip: ['shipping_postal_code', 'billing_postal_code'] };
const COMPANY_PROPS = { name: ['name'], phone: ['main_phone'], website: ['website'], domain: ['website'], hours_of_operation: ['hours_of_operation'], address: ['street'],
  city: ['city'], state: ['province'], province: ['province'], zip: ['postal_code'] };
const columnsFor = (map, props) => [...new Set((props || []).flatMap((k) => map[k] || []))];

function clinicRow(hsId, p) {
  const web = s(p.website || p.domain);
  const r = { name: orNull(p.name), main_phone: e164(p.phone), website: web ? (/^https?:/i.test(web) ? web : 'https://' + web) : null,
    hours_of_operation: orNull(p.hours_of_operation), street: orNull(p.address), city: orNull(p.city), province: province(p.state || p.province), postal_code: postal(p.zip),
    legacy_id: String(hsId) };
  for (const k of Object.keys(r)) if (r[k] == null) delete r[k];
  return r;
}

// An order and its line items -> { order, lines, payments } (build.js order rules; channel shopify = came through HubSpot).
const stageOf = (x) => { const v = s(x); return v.startsWith('4b27b500') ? 'open' : v.startsWith('937ea84d') ? 'processed' : v.startsWith('aa99e8d0') ? 'shipped'
  : v.startsWith('3725360f') ? 'delivered' : v.startsWith('3c85a297') ? 'cancelled' : 'unknown'; };
function orderRows(hsId, p, lineItems, contactId) {
  const note = s(p.hs_order_note);
  const m = note.match(/Rep:\s*([^|(]+?)\s*(?:\(([^)]*)\))?\s*(\||$)/);
  const rep = ownerUser(p.hubspot_owner_id) || (m ? repFromName(m[1]) : null);
  const stage = stageOf(p.hs_pipeline_stage);
  const wire = /WIRE|E-?TRANSFER/i.test(note) || p.payment_type === 'Payment Terms';
  const pay = p.hs_payment_status;
  const cancelled = stage === 'cancelled' || p.hs_is_canceled === 'true';
  const submitted = iso(p.hs_external_created_date) || iso(p.hs_createdate);
  const status = cancelled ? 'cancelled' : stage === 'delivered' ? 'delivered' : stage === 'shipped' ? 'shipped'
    : stage === 'processed' ? (pay === 'Paid' ? 'paid' : 'invoiced') : 'submitted';
  const id = uid('order:' + hsId);
  const total = num(p.hs_total_price);
  const isShopify = p.hs_object_source_detail_1 === 'Shopify';
  const order = { id, contact_id: contactId, rep_id: rep, channel: 'shopify', order_number: orNull(p.hs_order_name), status, submitted_at: submitted,
    quickbooks_invoice_id: orNull(p.qbo_id), payment_method: total > 0 ? (wire ? 'wire' : 'card_on_file') : null, payment_terms_days: wire && total > 0 ? 30 : null,
    tax_amount: num(p.hs_tax), shipping_amount: num(p.hs_shipping_cost), discount_amount: num(p.hs_order_discount),
    shipment_method: /atshealthcare/i.test(s(p.tracking_url)) ? 'ats' : /Manual Shipment/i.test(note) ? 'manual' : null,
    delivered_at: status === 'delivered' ? iso(p.hs_closed_date) : null, cancelled_at: cancelled ? iso(p.hs_external_canceled_date) || iso(p.hs_closed_date) : null,
    tracking_number: orNull(p.tracking_number || p.hs_shipping_tracking_number), tracking_url: orNull(p.tracking_url),
    shopify_order_id: isShopify ? orNull(p.hs_external_order_id) : null, approval_note: note || null, legacy_id: String(hsId),
    created_at: iso(p.hs_createdate) || new Date().toISOString() };
  const lines = [];
  for (const li of lineItems || []) {
    const lp = li.properties || {};
    const nm = s(lp.name); const sku = s(lp.hs_sku || nm.replace(/^(Dermal Filler|Lot|Skin Care):/, ''));
    if (/^(QST|GST|HST|PST)$/i.test(sku) || /^Shipping/i.test(nm)) continue;   // kept on the order as tax/shipping
    const price = num(lp.price) || 0;
    lines.push({ id: uid('line:' + li.id), order_id: id, product_sku: sku, product_name: nm, quantity: Math.round(num(lp.quantity) || 0), unit_price: price,
      is_free: price === 0, external_id: 'hubspot:' + li.id });
  }
  const payments = [];
  const paidAt = iso(p.hs_processed_date) || submitted;
  if (pay === 'Paid' && total > 0) payments.push({ id: uid('pay:' + hsId), order_id: id, kind: 'charge', method: wire ? 'wire' : 'card_on_file', amount: total, currency: 'CAD', status: 'succeeded', provider: wire ? 'wire' : null, paid_at: paidAt, is_test: false });
  else if (pay === 'Payment Pending' && total > 0) payments.push({ id: uid('pay:' + hsId), order_id: id, kind: 'charge', method: 'wire', amount: total, currency: 'CAD', status: 'pending', provider: 'wire', paid_at: null, is_test: false });
  if (payments.some((x) => x.status === 'pending')) { order.payment_method = 'wire'; order.payment_terms_days = order.payment_terms_days || 30; }
  return { order, lines, payments };
}

// What an n8n HubSpot write was, from its method and URL. -> { kind, ids, props } or { kind: 'skip', why }
function classify(hs) {
  const method = s(hs.method).toUpperCase(), url = s(hs.url).replace(/^https?:\/\/api\.hubapi\.com/, '').replace(/\?.*$/, '');
  const b = hs.body && typeof hs.body === 'string' ? (() => { try { return JSON.parse(hs.body); } catch (e) { return {}; } })() : hs.body || {};
  const r = hs.response || {};
  const keys = (o) => Object.keys((o && o.properties) || {});
  let m;
  if ((m = url.match(/^\/crm\/v3\/objects\/contacts\/?$/)) && method === 'POST') return { kind: 'contact', ids: [r.id].filter(Boolean), create: true, props: keys(b) };
  if ((m = url.match(/^\/crm\/v3\/objects\/contacts\/(\d+)$/)) && method === 'PATCH') return { kind: 'contact', ids: [m[1]], props: keys(b) };
  if (url === '/crm/v3/objects/contacts/batch/update') return { kind: 'contact', ids: (b.inputs || []).map((x) => x.id).filter(Boolean), props: [...new Set((b.inputs || []).flatMap(keys))] };
  if ((m = url.match(/^\/crm\/v3\/objects\/companies\/?$/)) && method === 'POST') return { kind: 'company', ids: [r.id].filter(Boolean), create: true, props: keys(b) };
  if ((m = url.match(/^\/crm\/v3\/objects\/companies\/(\d+)$/)) && method === 'PATCH') return { kind: 'company', ids: [m[1]], props: keys(b) };
  if ((m = url.match(/^\/crm\/v[34]\/objects\/contacts\/(\d+)\/associations\/companies\/(\d+)/))) return { kind: 'contact_clinic', contact: m[1], company: m[2] };
  if ((m = url.match(/^\/crm\/v[34]\/objects\/contacts\/(\d+)\/associations\/contacts\/(\d+)/))) return { kind: 'contact_md', contact: m[1], md: m[2] };
  if ((m = url.match(/^\/crm\/v3\/objects\/orders\/?$/)) && method === 'POST') return { kind: 'order', ids: [r.id].filter(Boolean) };
  if ((m = url.match(/^\/crm\/v3\/objects\/orders\/(\d+)$/)) && method === 'PATCH') return { kind: 'order', ids: [m[1]] };
  if (/\/objects\/line_items\/batch\/create/.test(url)) return { kind: 'skip', why: 'line items: saved with their order' };
  if (/\/objects\/deals|\/associations\/(deals|orders)\/|\/objects\/orders\/deals|deals\//.test(url)) return { kind: 'skip', why: 'deals are not in v2 (data model 2026-10-19)' };
  if (/\/objects\/notes/.test(url)) return { kind: 'skip', why: 'automated note (only notes a rep writes are kept, as on Oct 22)' };
  if (/^\/files\//.test(url)) return { kind: 'skip', why: 'file upload' };
  if (/\/associations\/companies\//.test(url) || /\/objects\/companies\/\d+\/associations/.test(url)) return { kind: 'skip', why: 'company to company link (brand / location)' };
  if (/\/batch\/read|\/search/.test(url)) return { kind: 'skip', why: 'a read' };
  return { kind: 'unknown', why: method + ' ' + url };
}

module.exports = { uid, ownerUser, repFromName, contactRow, clinicRow, orderRows, classify, columnsFor, CONTACT_PROPS, COMPANY_PROPS, e164, email, STAFF, titleDesignation };
