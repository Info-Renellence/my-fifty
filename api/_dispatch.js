// Order dispatch: handing a saved order to n8n (approval -> QuickBooks invoice -> Stripe charge or pay link), with
// tracking and retry (data map risk #4, owner 2026-10-23 "make those fixes").
//
// SHARED FILE: my-fifty api/_dispatch.js and renellence-edge api/_edge/dispatch.js must stay byte-identical. It requires
// nothing, so the same text works in both apps; each caller passes its own database and transaction runner.
//
// Behind a switch, OFF by default: settings row 'order_dispatch' (renellence-edge db/v2-011-order-dispatch.sql), flags
// `pulse` and `edge`. With a flag off (or no row, or the columns not added yet) the app behaves as before.
//
// With a flag on:
//   1. "Send for approval" saves the order with dispatch_status 'queued' in the same transaction as the order (queue).
//   2. It then tries n8n once (attempt). Accepted: 'sent' + dispatched_at, and the change_logs 'send' row Pulse already
//      writes. Not accepted: stays 'queued', with dispatch_error_message and dispatch_attempts.
//   3. The timer (Pulse api/cron.js tick, every 5 minutes from pg_cron) re-sends any queued order whose last try is more
//      than retry_after_minutes old (retry). After max_attempts it is marked 'failed' and info@ gets a task (the alert).
// Every try carries X-Idempotency-Key: order:<id>, the same on every try, so n8n handles an order once however many
// times it arrives (renellence-ops/ops/n8n/order-dispatch-proposal.md). A try is claimed in the database first
// (attempts + 1 where still queued), so two tries never go out at once from our side.
'use strict';

const DEFAULTS = { pulse: false, edge: false, max_attempts: 5, retry_after_minutes: 15, timeout_ms: 20000,
  alert_email: 'info@renellence.com' };

async function config(sql) {
  const [row] = await sql`select value from settings where key = ${'order_dispatch'}`;
  const v = row && row.value && typeof row.value === 'object' && !Array.isArray(row.value) ? row.value : null;
  return v ? Object.assign({}, DEFAULTS, v) : null;
}

// The settings for `app` ('pulse' or 'edge') when its switch is on, else null. Any problem reading it = off.
async function enabled(sql, app) {
  try { const c = await config(sql); return c && c[app] === true ? c : null; } catch (e) { return null; }
}
async function anyOn(sql) {
  try { const c = await config(sql); return c && (c.pulse === true || c.edge === true) ? c : null; } catch (e) { return null; }
}

// Inside the transaction that saves the order.
async function queue(tx, orderId) {
  await tx`update orders set dispatch_status = 'queued', dispatch_attempts = 0, dispatch_error_message = null
            where id = ${orderId} and dispatch_status is null`;
}

// One call to n8n. Never throws; answers { ok, error }.
async function post(orderId, from, attempt, cfg) {
  const url = String(process.env.N8N_MYFIFTY_URL || '').trim();
  if (!url) return { ok: false, error: 'n8n_not_connected' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), (cfg && cfg.timeout_ms) || DEFAULTS.timeout_ms);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'X-My-Fifty-Key': process.env.N8N_MYFIFTY_KEY || '',
        'X-Idempotency-Key': 'order:' + orderId },
      body: JSON.stringify({ action: 'order', orderId, from, attempt }) });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: ('n8n_' + r.status + ' ' + text.slice(0, 200)).trim() };
    // Edge's sandbox guard holds the call and answers 200 {sandbox:true}: n8n never saw it, so it is not sent.
    let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
    if (j && j.sandbox === true) return { ok: false, error: 'held_in_sandbox' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'n8n_timeout' : 'n8n_unreachable' };
  } finally { clearTimeout(t); }
}

// One try for one order. run(fn) runs fn(tx) in a transaction tagged with the acting person (asUser), so the orders
// trigger logs every field change with who and from where. o: { from, source, actorId, cfg, retry }.
// retry: true (the timer) only claims an order whose last try is older than retry_after_minutes.
async function attempt(run, orderId, o) {
  const cfg = o.cfg || DEFAULTS;
  const wait = String(Number(cfg.retry_after_minutes) || DEFAULTS.retry_after_minutes) + ' minutes';
  const [claim] = await run((tx) => tx`
    update orders set dispatch_attempts = dispatch_attempts + 1, dispatch_last_attempt_at = now()
     where id = ${orderId} and dispatch_status = 'queued' and deleted_at is null
       and (${!o.retry}::boolean or dispatch_last_attempt_at is null or dispatch_last_attempt_at < now() - ${wait}::interval)
    returning dispatch_attempts, contact_id`);
  if (!claim) return { sent: false, skipped: true };
  const r = await post(orderId, o.from, claim.dispatch_attempts, cfg);
  const max = Number(cfg.max_attempts) || DEFAULTS.max_attempts;
  return run(async (tx) => {
    if (r.ok) {
      const [s] = await tx`update orders set dispatch_status = 'sent', dispatched_at = now(), dispatch_error_message = null
                            where id = ${orderId} and dispatch_status = 'queued' returning id`;
      if (s) await tx`insert into change_logs (actor_user_id, actor_kind, source, action, entity_type, entity_id, contact_id, note)
        values (${o.actorId || null}, ${o.actorId ? 'user' : 'system'}, ${o.source}, 'send', 'orders', ${orderId}, ${claim.contact_id},
                ${claim.dispatch_attempts > 1 ? 'Sent for approval (try ' + claim.dispatch_attempts + ')' : 'Sent for approval'})`;
      return { sent: true, attempts: claim.dispatch_attempts };
    }
    if (claim.dispatch_attempts >= max) {
      const [f] = await tx`update orders set dispatch_status = 'failed', dispatch_error_message = ${r.error}
                            where id = ${orderId} and dispatch_status = 'queued' returning id`;
      if (f) await alert(tx, orderId, claim, r.error, cfg);
      return { sent: false, failed: true, attempts: claim.dispatch_attempts, error: r.error };
    }
    await tx`update orders set dispatch_error_message = ${r.error} where id = ${orderId} and dispatch_status = 'queued'`;
    return { sent: false, attempts: claim.dispatch_attempts, error: r.error };
  });
}

// The alert when an order is given up on: a task for info@ (an admin) on the customer, so it shows on their list and
// in the daily reconciliation email. Written once: only the try that moved the order to 'failed' gets here.
async function alert(tx, orderId, claim, error, cfg) {
  const email = String(cfg.alert_email || DEFAULTS.alert_email).toLowerCase();
  const [who] = await tx`select id from users where lower(email::text) = ${email} and is_active is not false limit 1`;
  if (!who) return;
  await tx`insert into tasks (contact_id, assignee_id, title, body, kind, status, source, due_at)
    values (${claim.contact_id}, ${who.id}, ${'Order not sent for approval'},
            ${'n8n did not accept this order after ' + claim.dispatch_attempts + ' tries (last: ' + error + '). Order ' + orderId
              + '. Check n8n, then set the order back to queued (dispatch_status) or send it by hand.'},
            'todo', 'open', 'system', now())`;
}

// The timer: every queued order whose last try is older than retry_after_minutes, oldest first. Stops at the first
// failure (n8n is probably down; every try would wait for the timeout). Fictional rows (demo / test-run, @demo.invalid)
// are never sent from the timer unless o.includeFictional (tests only).
async function retry(sql, run, o) {
  const cfg = o.cfg || DEFAULTS;
  const wait = String(Number(cfg.retry_after_minutes) || DEFAULTS.retry_after_minutes) + ' minutes';
  const due = await sql`
    select o.id from orders o join contacts c on c.id = o.contact_id left join users u on u.id = o.rep_id
     where o.dispatch_status = 'queued' and o.deleted_at is null and o.status not in ('rejected', 'cancelled')
       and coalesce(o.dispatch_last_attempt_at, o.created_at) < now() - ${wait}::interval
       and (${!!o.includeFictional}::boolean or (coalesce(o.legacy_id, '') not like 'demo%' and coalesce(c.legacy_id, '') not like 'demo%'
            and coalesce(c.email::text, '') not like '%@demo.invalid' and coalesce(u.email::text, '') not like '%@demo.invalid'))
     order by o.dispatch_last_attempt_at nulls first, o.created_at limit ${Number(o.limit) || 10}`;
  const out = { due: due.length, sent: 0, failed: 0, waiting: 0 };
  for (const d of due) {
    const r = await attempt(run, d.id, { from: 'timer', source: o.source, actorId: null, cfg, retry: true });
    if (r.skipped) continue;
    if (r.sent) { out.sent++; continue; }
    if (r.failed) out.failed++; else out.waiting++;
    break;
  }
  return out;
}

module.exports = { DEFAULTS, config, enabled, anyOn, queue, post, attempt, retry };
