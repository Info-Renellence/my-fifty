// Pulse orders -> the live Internal Sales Form workflow (owner 2026-10-27: "Reuse the Internal Sales Form"). Pulse sends
// each order exactly as the sales form on renellence.com / Edge's New order sends it (renellence-page
// public/assets/js/sales-form.js payload, renellence-edge main api/isf.js relay), so approval, the card charge or pay
// link, the MD signature, QuickBooks, the warehouse and the texts all run unchanged. The HubSpot order that workflow
// writes comes back into v2 through the Mirrors (api/intake.js) and is linked to this Pulse order, not added twice.
// The token: n8n signs "<ts>.<HMAC(ts-<email>-internal-sales)>" for a caller holding a key. Pulse has its own door, /pulse-isf-token
// with its own n8n Header Auth credential (owner 2026-10-27: Edge's key can't be read back), key PULSE_ISF_KEY; Edge's
// /edge-isf-token + EDGE_ISF_SECRET still works if that is set instead.
'use strict';
const N8N = 'https://renellence.app.n8n.cloud/webhook';
// The sales person on the order, as the sales form's staff list has it (renellence-edge main api/isf.js STAFF).
const STAFF = {
  'emily@renellence.com': { name: 'Emily Weber', rep: 'Emily Weber' }, 'brittany.houston@renellence.com': { name: 'Brittany Houston', rep: 'Brittany Houston' },
  'sam.almas@renellence.com': { name: 'Sam Almas', rep: 'Sam Almas' }, 'lucas.stockley@renellence.com': { name: 'Lucas Stockley', rep: 'Lucas Stockley' },
  'angela.tuzzolino@renellence.com': { name: 'Angela Tuzzolino', rep: 'Angela Tuzzolino' }, 'info@renellence.com': { name: 'Renellence', rep: 'internal' },
  'admin@renellence.com': { name: 'Renellence Admin', rep: 'internal' }, 'aria.moghimi@renellence.com': { name: 'Aria Moghimi', rep: 'internal' },
  'caterina.paggos@renellence.com': { name: 'Caterina Paggos', rep: 'internal' },
};
const KEY = () => String(process.env.PULSE_ISF_KEY || process.env.EDGE_ISF_SECRET || '').trim();
const configured = () => !!KEY();

async function token(email) {
  const path = process.env.PULSE_ISF_KEY ? '/pulse-isf-token' : '/edge-isf-token';
  const r = await fetch(N8N + path, { method: 'POST', headers: { 'X-Edge-ISF': KEY(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('token_' + r.status);
  const j = await r.json();
  if (!j || !j.ok || !j.token) throw new Error('token_refused');
  return j.token;
}

// The sales form's payload for one v2 order.
async function payloadFor(sql, orderId) {
  const [o] = await sql`
    select o.id, o.payment_method::text as method, o.approval_note, o.shipping_note, o.medical_director_contact_id as md_id,
           c.first_name, c.last_name, c.email, c.secondary_email, c.phone, c.mobile_phone, c.quickbooks_customer_id,
           c.shipping_street, c.shipping_city, c.shipping_province, c.shipping_postal_code, c.billing_street, c.billing_city, c.billing_province, c.billing_postal_code,
           cl.name as clinic, u.email as placed_by, ow.email as owner
      from orders o join contacts c on c.id = o.contact_id left join clinics cl on cl.id = c.clinic_id
      left join users u on u.id = o.placed_by_id left join users ow on ow.id = o.rep_id
     where o.id = ${orderId}`;
  if (!o) throw new Error('order_not_found');
  const lines = await sql`select product_sku, product_name, quantity, unit_price::float8 as price, list_price::float8 as list, is_free from order_lines where order_id = ${orderId} order by is_free, product_sku`;
  const [md] = o.md_id ? await sql`select first_name, last_name, email from contacts where id = ${o.md_id}` : [];
  // Who orders: the person signed in to Pulse if they are on the sales form's staff list, else the clinic's rep.
  const email = STAFF[o.placed_by] ? o.placed_by : STAFF[o.owner] ? o.owner : 'info@renellence.com';
  const who = STAFF[email];
  const ship = { street: o.shipping_street || '', street2: '', city: o.shipping_city || '', province: o.shipping_province || '', postal_code: o.shipping_postal_code || '', country: 'CA' };
  const bill = o.billing_street ? { street: o.billing_street, street2: '', city: o.billing_city || '', province: o.billing_province || '', postal_code: o.billing_postal_code || '', country: 'CA' } : ship;
  const sample = lines.every((l) => l.is_free);
  return {
    form_source: 'internal_sales_order', submitted_via: 'pulse', submitted_at: new Date().toISOString(), sample_order: false,
    customer: { email: o.email || '', name: [o.first_name, o.last_name].filter(Boolean).join(' '), phone: o.mobile_phone || o.phone || '', company: o.clinic || '',
      qbo_customer_id: o.quickbooks_customer_id || '', license: '', designation: '', additional_emails: o.secondary_email ? [o.secondary_email] : [] },
    billing_same_as_shipping: bill === ship || (bill.street === ship.street && bill.city === ship.city),
    billing_address: bill, shipping_address: ship,
    products: lines.map((l) => ({ product: l.product_name, sku: l.product_sku, variant_id: null, quantity: l.quantity, price: (l.is_free ? 0 : l.price).toFixed(2),
      originalPrice: Math.max(l.is_free ? 0 : l.price, l.list || 0).toFixed(2), image: null, sample: !!l.is_free, lot: '', expiry: '' })),
    // The Pulse order id rides along in the note management sees, so the order can be found from either side.
    management_notes: [o.approval_note, 'Pulse order ' + o.id].filter(Boolean).join(' | '),
    shipping_notes: o.shipping_note || '',
    shipping_options: { ship_date: 'today', manual_shipment: false },
    rep_payment: false,
    payment_method: o.method === 'wire' ? 'wire_transfer' : 'card_on_file',
    send_signature: sample,
    medical_director: { name: md ? [md.first_name, md.last_name].filter(Boolean).join(' ') : '', email: md ? md.email || '' : '' },
    hs_deal_id: '',
    csrf_customer_id: email, sales_person: { name: who.name, email, id: who.rep },
  };
}

// -> { queued: true } | { queued: false, reason }
async function send(sql, orderId) {
  if (!configured()) return { queued: false, reason: 'n8n_not_connected' };
  try {
    const body = await payloadFor(sql, orderId);
    const r = await fetch(N8N + '/internal-sales-form-cof', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await token(body.csrf_customer_id) },
      body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) return { queued: false, reason: 'n8n_' + r.status, detail: text.slice(0, 300) };
    return { queued: true };
  } catch (e) {
    return { queued: false, reason: String(e && e.message || 'n8n_unreachable').slice(0, 60) };
  }
}

// "Resend pay link" (L19, owner 2026-10-27): the sales-form workflow's /pulse-resend-paylink branch finds the order's
// open Stripe pay link (the one the waiting order resumes on when it is paid) and emails it to the customer again.
// Nothing new is made in Stripe. Same key as the token door (X-Edge-ISF, PULSE_ISF_KEY).
async function resendPayLink(sql, orderId) {
  if (!process.env.PULSE_ISF_KEY) return { queued: false, reason: 'n8n_not_connected' };
  const [o] = await sql`select o.order_number, c.first_name, c.email, c.secondary_email from orders o join contacts c on c.id = o.contact_id where o.id = ${orderId}`;
  if (!o || !o.order_number) return { queued: false, reason: 'no_order_number' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(N8N + '/pulse-resend-paylink', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Edge-ISF': KEY() },
      body: JSON.stringify({ orderNumber: String(o.order_number), firstName: o.first_name || '', emails: [o.email, o.secondary_email].filter(Boolean) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { queued: false, reason: 'n8n_' + r.status };
    return j.sent ? { queued: true } : { queued: false, reason: j.reason || 'no_open_link' };
  } catch (e) {
    return { queued: false, reason: e && e.name === 'AbortError' ? 'n8n_timeout' : 'n8n_unreachable' };
  } finally { clearTimeout(t); }
}

module.exports = { send, payloadFor, configured, resendPayLink, STAFF };
