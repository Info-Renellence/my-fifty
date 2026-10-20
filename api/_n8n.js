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
async function call(action, payload) {
  const url = String(process.env.N8N_MYFIFTY_URL || '').trim();
  if (!url) return { queued: false, reason: 'n8n_not_connected' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'X-My-Fifty-Key': process.env.N8N_MYFIFTY_KEY || '' },
      body: JSON.stringify(Object.assign({ action }, payload)) });
    const text = await r.text();
    if (!r.ok) return { queued: false, reason: 'n8n_' + r.status, detail: text.slice(0, 300) };
    return { queued: true };
  } catch (e) {
    return { queued: false, reason: e && e.name === 'AbortError' ? 'n8n_timeout' : 'n8n_unreachable' };
  } finally { clearTimeout(t); }
}

module.exports = { call };
