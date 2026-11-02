// Stripe customers and saved cards -> v2, on the 5-minute timer (owner 2026-11-02, audit item 7). Nothing in the webhook
// (api/_stripe.js: charges only) sets contacts.stripe_customer_id or onboardings.card_saved_at, so they went stale after the
// one-off backfill of 2026-11-02 (CHANGELOG #53). Each tick, read only:
//   setup intents that succeeded since the last tick -> the contact with that customer's email (exactly one live contact,
//                                                       none linked yet) gets the customer id; its onboardings get
//                                                       card_saved_at = when the card was saved (first one only)
//   customers created since the last tick            -> the same email link, card or not
// Needs STRIPE_READ_KEY (a restricted key with read access to Customers and SetupIntents); without it the step is skipped.
// Bookmark: settings 'stripe_links' { since: unix seconds }. Writes are logged with source stripe_webhook. Nothing goes to Stripe.
'use strict';

const API = 'https://api.stripe.com/v1/';
const START = Math.floor(Date.parse('2026-11-02T00:00:00Z') / 1000);   // the backfill covered everything before this
const TEST = /zauceenvy@|epicssword1234@|yousefkkamel@|aquicktiktok@|@demo\.invalid/i;
const s = (v) => (v == null ? '' : String(v).trim());

async function list(key, path, since, until) {
  const out = []; let after = '';
  for (let page = 0; page < 10 && Date.now() < until; page++) {
    const r = await fetch(API + path + '?limit=100&created[gte]=' + since + (after ? '&starting_after=' + after : ''),
      { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (!r.ok) throw new Error('stripe ' + r.status + ': ' + s(j.error && j.error.message).slice(0, 120));
    out.push(...j.data);
    if (!j.has_more) break;
    after = j.data[j.data.length - 1].id;
  }
  return out;
}
async function customer(key, id) {
  const r = await fetch(API + 'customers/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
  return r.ok ? r.json() : null;
}

// The one live contact with this email (main or second), or null when there is none or more than one.
async function contactFor(tx, email) {
  const em = s(email).toLowerCase();
  if (!em || TEST.test(em)) return null;
  const rows = await tx`select id, stripe_customer_id from contacts where deleted_at is null and merged_into_contact_id is null
    and (lower(email::text) = ${em} or lower(secondary_email::text) = ${em}) limit 2`;
  return rows.length === 1 ? rows[0] : null;
}

async function sync(sql, budgetMs) {
  const key = process.env.STRIPE_READ_KEY;
  if (!key) return { skipped: 'stripe_read_key_not_set' };
  const until = Date.now() + (budgetMs || 8000);
  const [row] = await sql`select value from settings where key = 'stripe_links'`;
  const since = Math.max(START, Number(((row && row.value) || {}).since) || START) - 600;   // 10 minutes back: nothing missed
  const tickAt = Math.floor(Date.now() / 1000);
  const setups = (await list(key, 'setup_intents', since, until)).filter((x) => x.livemode && x.status === 'succeeded' && x.customer);
  const custs = (await list(key, 'customers', since, until)).filter((x) => x.livemode && x.email);
  const byId = new Map(custs.map((c) => [c.id, c]));
  const out = { linked: 0, cardSaved: 0, setups: setups.length, customers: custs.length };
  await sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'stripe_webhook', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
    const link = async (c) => {
      const k = await contactFor(tx, c.email);
      if (!k) return null;
      if (!k.stripe_customer_id) {
        const [taken] = await tx`select 1 from contacts where stripe_customer_id = ${c.id} limit 1`;
        if (!taken) { await tx`update contacts set stripe_customer_id = ${c.id} where id = ${k.id} and stripe_customer_id is null`; out.linked++; }
      }
      return k.id;
    };
    for (const si of setups.sort((a, b) => a.created - b.created)) {
      const c = byId.get(si.customer) || (await customer(key, si.customer));
      if (!c || c.deleted || !c.email) continue;
      const contactId = await link(c);
      if (!contactId) continue;
      const at = new Date(si.created * 1000).toISOString();
      const done = await tx`update onboardings set card_saved_at = ${at} where card_saved_at is null
        and (injector_contact_id = ${contactId} or primary_contact_id = ${contactId}) returning id`;
      out.cardSaved += done.length;
    }
    for (const c of custs) await link(c);
    await tx`insert into settings (key, value) values ('stripe_links', ${tx.json({ since: tickAt })})
      on conflict (key) do update set value = excluded.value`;
  });
  return out;
}

module.exports = { sync };
