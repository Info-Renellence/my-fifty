// Staging Pulse (data map risk #3, 2026-10-23; renellence-ops/ops/release/STAGING.md). Off unless the deployment says
// STAGING=1, which is set only in the Vercel project pulse-staging (pointed at v1, the test database). Production Pulse
// never has it, so nothing here changes what reps see.
//
// With STAGING=1:
//   - the page shows a "Staging · test data" banner (api/data.js op=config answers staging: true; app.js draws it);
//   - nothing goes out: no n8n calls (orders, pay links, MD reminders, which become emails and texts), no Gmail sends,
//     no phone notifications. Each of those checks blocked() itself (api/_n8n.js, api/_gmail.js, api/_push.js), and
//     install() also wraps fetch so anything else that writes outside (api/_dispatch.js's n8n call included) is held
//     and answered 200 { sandbox: true, staging: true }, which _dispatch.js already treats as "not sent".
//   Allowed: Supabase (sign-in and the test database's own API), Google sign-in tokens, and the Gemini voice note
//   (a recording in, a draft out; nothing reaches a customer).
// Every route requires this file first.
'use strict';

const on = () => process.env.STAGING === '1';

// The reason an outward call is refused, or '' when it may go.
const blocked = () => (on() ? 'staging' : '');

function host(u) { try { return new URL(String(u)).hostname.toLowerCase(); } catch (e) { return ''; } }
const ends = (h, d) => h === d || h.endsWith('.' + d);

function allowed(url) {
  const h = host(url);
  return ends(h, 'supabase.co') || h === 'oauth2.googleapis.com' || ends(h, 'generativelanguage.googleapis.com')
    || h === 'localhost' || h === '127.0.0.1';
}

// A fetch that holds every call to a host not allowed above while STAGING=1, and passes everything through otherwise.
function wrap(real) {
  return function stagingFetch(url, init) {
    const target = url && typeof url === 'object' && url.url ? url.url : url;
    if (!on() || allowed(target)) return real.apply(this, arguments);
    console.log('STAGING_HELD', host(target));   // the host only, never the address or the body
    const text = JSON.stringify({ sandbox: true, staging: true });
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => text, json: async () => JSON.parse(text) });
  };
}

// Staging must never open the real data: with STAGING=1 a database or Supabase address that names v2 is refused
// (api/_db.js, api/data.js op=config), so a wrong environment variable fails loudly instead of showing real customers.
const V2_REF = 'ojphplepzuwchjtuycpv';
function refuseV2(url) {
  if (on() && String(url || '').includes(V2_REF)) { const e = new Error('staging_points_at_v2'); e.status = 503; throw e; }
}

let installed = false;
function install() {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  globalThis.fetch = wrap(globalThis.fetch);
}
install();

module.exports = { on, blocked, allowed, wrap, install, refuseV2, V2_REF };
