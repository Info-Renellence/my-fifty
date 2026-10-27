// n8n: what happens after My Fifty saves an order, and the two "nudge" buttons.
//
// Yousef 2026-10-20 ("Save to v2 + new n8n branch"): My Fifty writes the order to v2 (orders, order_lines), then
// calls a new branch of the existing sales-form workflow, which does approval, the MD signature, QuickBooks, the
// Stripe card / pay link and ATS, and writes each step back to v2. No HubSpot.
//
// One webhook, N8N_MYFIFTY_URL, with an action:
//   order            { orderId }        a new order or sample order to approve
//   resend_pay_link  { orderId }        L19 "Resend pay link"
//   remind_md        { orderId } | { onboardingId }   L20 / L21 "Remind MD to sign"
// Each call carries X-My-Fifty-Key (N8N_MYFIFTY_KEY), which the n8n branch checks.
//
// Until N8N_MYFIFTY_URL is set the call is skipped and the caller is told (queued: false), so an order stays
// "Waiting on approval" in v2 and nothing pretends it was sent.
//
// An order n8n did not accept (down, timed out, refused) is sent again by the timer (api/cron.js resendOrders,
// Yousef 2026-10-21, F22). Every order call carries a once-only key, X-Idempotency-Key: order:<id>, the same on
// every try, so the n8n branch approves an order once however many times it arrives; an order n8n accepted is
// recorded in change_logs (action 'send') and never sent again.
async function call(action, payload) {
  // Staging (STAGING=1, api/_staging.js): never calls n8n, so no email, text or invoice goes out from test data.
  if (require('./_staging').blocked()) return { queued: false, reason: 'staging' };
  const url = String(process.env.N8N_MYFIFTY_URL || '').trim();
  // Owner 2026-10-27: orders go to the live Internal Sales Form workflow, the same one Edge's New order uses (api/_isf.js).
  if (!url && action === 'order' && payload && payload.orderId) return require('./_isf').send(require('./_db').db(), payload.orderId);
  if (!url) return { queued: false, reason: 'n8n_not_connected' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  const headers = { 'Content-Type': 'application/json', 'X-My-Fifty-Key': process.env.N8N_MYFIFTY_KEY || '' };
  if (action === 'order' && payload && payload.orderId) headers['X-Idempotency-Key'] = 'order:' + payload.orderId;
  try {
    const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers,
      body: JSON.stringify(Object.assign({ action }, payload)) });
    const text = await r.text();
    if (!r.ok) return { queued: false, reason: 'n8n_' + r.status, detail: text.slice(0, 300) };
    return { queued: true };
  } catch (e) {
    return { queued: false, reason: e && e.name === 'AbortError' ? 'n8n_timeout' : 'n8n_unreachable' };
  } finally { clearTimeout(t); }
}

module.exports = { call };
