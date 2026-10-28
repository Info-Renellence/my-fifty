// Payments straight from Stripe (owner 2026-10-28, data-flow improvement 1). Stripe decides money now, so a charge,
// a refund or a failed charge reaches v2 the moment Stripe has it, not only inside n8n's order write.
//   POST /api/stripe   (Stripe's webhook; Stripe-Signature checked with STRIPE_WEBHOOK_SECRET, 5 minutes' tolerance)
// Each event is kept once in ingest_events (source stripe, by Stripe's event id), then:
//   charge.succeeded               a succeeded payment on its order (card brand, last 4, receipt); an order that already has
//                                  the same charge from HubSpot without a Stripe id gets the id added, never a second row
//   charge.refunded                a refund row against that payment
//   payment_intent.payment_failed  a failed charge on its order, with Stripe's reason
// The order is found by the Stripe payment id: already on one of its payments, or in the order note the sales form writes
// ("CARD ON FILE (Stripe pi_...)"), or by the order number Stripe carries in its metadata. The sales form charges the card
// BEFORE it creates the order, so an event whose order is not in v2 yet waits (status pending) and every tick tries it
// again for 14 days (retryPending). Nothing here writes to Stripe.
'use strict';
const crypto = require('crypto');

const TOLERANCE_S = 300;
const s = (v) => (v == null ? '' : String(v).trim());
const money = (cents) => Math.round(Number(cents) || 0) / 100;
const when = (sec) => (sec ? new Date(Number(sec) * 1000).toISOString() : new Date().toISOString());

// Stripe-Signature: 't=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">' (several v1 allowed).
function signatureOk(header, raw, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = {}; const v1 = [];
  for (const kv of String(header).split(',')) { const [k, v] = kv.split('='); if (k === 'v1') v1.push(v); else parts[k] = v; }
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > TOLERANCE_S) return false;
  const want = Buffer.from(crypto.createHmac('sha256', secret).update(t + '.' + raw).digest('hex'));
  return v1.some((x) => { const got = Buffer.from(String(x || '')); return got.length === want.length && crypto.timingSafeEqual(got, want); });
}

async function orderFor(tx, pi, meta) {
  if (pi) {
    const [p] = await tx`select order_id from payments where external_id = ${pi} limit 1`;
    if (p) return p.order_id;
    const [o] = await tx`select id from orders where deleted_at is null and approval_note like ${'%' + pi + '%'} order by created_at desc limit 1`;
    if (o) return o.id;
  }
  const num = s(meta && (meta.order_number || meta.orderNumber));
  if (num) {
    const [o] = await tx`select id from orders where deleted_at is null and order_number = ${num.startsWith('#') ? num : '#' + num} order by created_at desc limit 1`;
    if (o) return o.id;
  }
  return null;
}

// One Stripe event -> v2. Returns { table, id } | { skipped, why } | { pending, why } (order not in v2 yet).
async function apply(sql, ev) {
  const o = (ev && ev.data && ev.data.object) || {};
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'stripe_webhook', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
    if (ev.type === 'charge.succeeded') {
      const pi = s(o.payment_intent) || s(o.id);
      const orderId = await orderFor(tx, pi, o.metadata);
      if (!orderId) return { pending: true, why: 'order not in v2 yet (the sales form charges before it makes the order)' };
      const card = (o.payment_method_details && o.payment_method_details.card) || {};
      const row = { status: 'succeeded', provider: 'stripe', external_id: pi, paid_at: when(o.created), card_brand: s(card.brand) || null, card_last4: s(card.last4) || null,
        receipt_url: s(o.receipt_url) || null, fee_amount: null };
      const [have] = await tx`select id from payments where external_id = ${pi}`;
      if (have) { await tx`update payments set ${tx(row)} where id = ${have.id}`; return { table: 'payments', id: have.id }; }
      // the same charge already came in from HubSpot (no Stripe id): add the id and the card, never a second row
      const [same] = await tx`select id from payments where order_id = ${orderId} and kind = 'charge' and external_id is null and status in ('succeeded', 'pending')
                                and abs(coalesce(amount, 0) - ${money(o.amount)}) < 1 order by created_at limit 1`;
      if (same) { await tx`update payments set ${tx(row)} where id = ${same.id}`; return { table: 'payments', id: same.id, matched: true }; }
      const method = /paylink|pay_link|checkout/i.test(s(o.metadata && o.metadata.source)) ? 'pay_link' : 'card_on_file';
      const [p] = await tx`insert into payments (order_id, kind, method, amount, currency, status, provider, external_id, paid_at, card_brand, card_last4, receipt_url, is_test)
        values (${orderId}, 'charge', ${method}, ${money(o.amount)}, ${s(o.currency).toUpperCase() || 'CAD'}, 'succeeded', 'stripe', ${pi}, ${row.paid_at}, ${row.card_brand}, ${row.card_last4},
                ${row.receipt_url}, ${o.livemode === false}) returning id`;
      return { table: 'payments', id: p.id, created: true };
    }
    if (ev.type === 'charge.refunded') {
      const pi = s(o.payment_intent) || s(o.id);
      const [paid] = await tx`select id, order_id from payments where external_id = ${pi} and kind = 'charge'`;
      if (!paid) return { pending: true, why: 'the charge is not in v2 yet' };
      const refunds = ((o.refunds && o.refunds.data) || []).filter((r) => r && r.id);
      let last = null;
      for (const r of refunds.length ? refunds : [{ id: 're_' + s(o.id), amount: o.amount_refunded, created: o.created }]) {
        const [x] = await tx`insert into payments (order_id, kind, method, amount, currency, status, provider, external_id, paid_at, is_test)
          values (${paid.order_id}, 'refund', 'card_on_file', ${money(r.amount)}, ${s(o.currency).toUpperCase() || 'CAD'}, 'succeeded', 'stripe', ${s(r.id)}, ${when(r.created)}, ${o.livemode === false})
          on conflict (external_id) do nothing returning id`;
        if (x) last = x.id;
      }
      return { table: 'payments', id: last, refund: true };
    }
    if (ev.type === 'payment_intent.payment_failed') {
      const pi = s(o.id);
      const orderId = await orderFor(tx, pi, o.metadata);
      if (!orderId) return { skipped: true, why: 'a failed charge with no order (the sales form sends a pay link instead)' };
      const reason = s(o.last_payment_error && (o.last_payment_error.message || o.last_payment_error.code)) || 'failed';
      const [x] = await tx`insert into payments (order_id, kind, method, amount, currency, status, failure_reason, provider, external_id, is_test)
        values (${orderId}, 'charge', 'card_on_file', ${money(o.amount)}, ${s(o.currency).toUpperCase() || 'CAD'}, 'failed', ${reason.slice(0, 300)}, 'stripe', ${pi + ':failed:' + s(ev.id)}, ${o.livemode === false})
        on conflict (external_id) do nothing returning id`;
      return { table: 'payments', id: x ? x.id : null, failed: true };
    }
    return { skipped: true, why: 'not a payment event (' + s(ev.type) + ')' };
  });
}

async function handle(sql, ev) {
  if (!ev || !ev.id || !ev.type) return { ok: true, ignored: 'not_an_event' };
  const [row] = await sql`insert into ingest_events (source, external_id, payload, received_via, status, attempts, received_at)
                          values ('stripe', ${s(ev.id)}, ${sql.json(ev)}, 'webhook', 'pending', 0, now()) on conflict (source, external_id) do nothing returning id`;
  if (!row) return { ok: true, duplicate: true };
  return settle(sql, row.id, ev);
}
async function settle(sql, id, ev) {
  try {
    const r = await apply(sql, ev);
    await sql`update ingest_events set status = ${r.pending ? 'pending' : r.skipped ? 'skipped' : 'done'}, attempts = attempts + 1, processed_at = ${r.pending ? null : new Date()},
                error_message = ${r.why || null}, result_table = ${r.table || null}, result_id = ${r.id || null} where id = ${id}`;
    return Object.assign({ ok: true }, r);
  } catch (e) {
    console.error('STRIPE', ev.type, e.message);
    await sql`update ingest_events set status = 'failed', attempts = attempts + 1, error_message = ${s(e.message).slice(0, 500)} where id = ${id}`;
    return { ok: false, failed: true };
  }
}
// The timer: events still waiting for their order (14 days at most, 25 a tick).
async function retryPending(sql) {
  const rows = await sql`select id, payload from ingest_events where source = 'stripe' and status = 'pending' and received_at > now() - interval '14 days'
                          order by received_at limit 25`;
  const out = { tried: rows.length, done: 0 };
  for (const r of rows) { const x = await settle(sql, r.id, r.payload); if (x.ok && !x.pending) out.done++; }
  return out;
}

module.exports = { signatureOk, apply, handle, retryPending };
