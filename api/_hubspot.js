// HubSpot, READ ONLY: api/intake.js re-reads the record an n8n write touched, so v2 gets the whole record mapped by the
// migration's rules (api/_hsmap.js), not a partial copy. GET and batch/read only; anything else is refused here.
// Key: HUBSPOT_READ_TOKEN (a private app token; only its read scopes are used).
'use strict';
const BASE = 'https://api.hubapi.com';
const CONTACT_PROPS = ['firstname', 'lastname', 'email', 'secondary_email', 'phone', 'mobilephone', 'jobtitle', 'role', 'hubspot_owner_id', 'address', 'city', 'state',
  'province', 'zip', 'hs_analytics_source', 'createdate', 'associatedcompanyid'];
const COMPANY_PROPS = ['name', 'phone', 'website', 'domain', 'hours_of_operation', 'address', 'city', 'state', 'province', 'zip'];
const ORDER_PROPS = ['hs_order_name', 'hs_order_note', 'hubspot_owner_id', 'hs_pipeline_stage', 'payment_type', 'hs_payment_status', 'hs_is_canceled', 'hs_external_created_date',
  'hs_createdate', 'hs_total_price', 'hs_tax', 'hs_shipping_cost', 'hs_order_discount', 'tracking_url', 'tracking_number', 'hs_shipping_tracking_number', 'hs_closed_date',
  'hs_external_canceled_date', 'hs_processed_date', 'hs_object_source_detail_1', 'hs_external_order_id', 'qbo_id'];

async function call(method, path, body) {
  if (!(method === 'GET' || (method === 'POST' && /\/batch\/read$/.test(path)))) throw new Error('hubspot_read_only');
  const token = process.env.HUBSPOT_READ_TOKEN;
  if (!token) { const e = new Error('hubspot_not_set_up'); e.status = 503; throw e; }
  for (let i = 0; i < 4; i++) {
    const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status >= 500) { await new Promise((x) => setTimeout(x, 700 * (i + 1))); continue; }
    if (r.status === 404) return null;
    const t = await r.text();
    if (!r.ok) throw new Error('hubspot ' + r.status + ' ' + t.slice(0, 160));
    return t ? JSON.parse(t) : {};
  }
  throw new Error('hubspot_unavailable');
}

const contact = (id) => call('GET', `/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=${CONTACT_PROPS.join(',')}&associations=companies`);
const company = (id) => call('GET', `/crm/v3/objects/companies/${encodeURIComponent(id)}?properties=${COMPANY_PROPS.join(',')}`);
const order = (id) => call('GET', `/crm/v3/objects/orders/${encodeURIComponent(id)}?properties=${ORDER_PROPS.join(',')}&associations=contacts,line_items`);
async function lineItems(ids) {
  if (!ids.length) return [];
  const r = await call('POST', '/crm/v3/objects/line_items/batch/read', { inputs: ids.map((id) => ({ id: String(id) })), properties: ['name', 'hs_sku', 'quantity', 'price', 'amount'] });
  return (r && r.results) || [];
}
const assocIds = (rec, type) => (((rec && rec.associations && rec.associations[type]) || {}).results || []).map((x) => String(x.id));

module.exports = { contact, company, order, lineItems, assocIds, call };
