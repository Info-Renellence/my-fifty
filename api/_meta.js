// Meta lead-form leads -> Supabase v2, directly (Yousef 2026-10-27: "meta ad leads need to go straight into supabase").
// Every timer tick (api/cron.js) reads the leads since the last one from live Edge's ad-leads feed
// (edge.renellence.com/api/reports?kind=adleads-feed, renellence-edge main api/_ads.js metaLeads: every lead form of every
// Page, read with the Page token; the rep worked out by Edge from the postal code / province / the reps' lead sheets and
// Yousef's REP_SAID list). Edge accepts Pulse's key there (PULSE_INTAKE_SECRET = Pulse's N8N_INTAKE_SECRET).
//   - a lead already in v2 (contacts.meta_lead_id) is left alone
//   - someone v2 already has (same email or phone) gets the lead id and their blank fields filled; nothing else changes
//   - anyone else becomes a contact: lead_source social (one of the four sources), owned by the rep Edge found, or by
//     nobody when Edge says two reps share the area ("Lucas or Sam": an admin assigns them, as Edge shows it)
// The new-lead push (api/cron.js newLeads) then tells the rep. Bookmark: settings 'meta_sync' { sinceMs }.
// Since 2026-10-28 (owner: "pulse reads meta directly") the leads come from Meta itself (api/_metaleads.js) once Pulse has
// META_ADS_TOKEN; until then from Edge's feed as before, so nothing stops in between.
'use strict';
const M = require('./_hsmap');
const FEED = 'https://edge.renellence.com/api/reports?kind=adleads-feed';
const START_MS = Date.parse('2026-10-27T19:00:00Z');   // leads before this came in with the Oct 27 backfill
const REP = { sam: 'sam.almas@renellence.com', samantha: 'sam.almas@renellence.com', emily: 'emily@renellence.com', lucas: 'lucas.stockley@renellence.com',
  angela: 'angela.tuzzolino@renellence.com', brittany: 'brittany.houston@renellence.com' };
const s = (v) => (v == null ? '' : String(v).trim());
function ownerOf(rep) {
  const r = s(rep);
  if (!r || / or /i.test(r)) return null;   // nobody, or a shared area: left for an admin
  const e = REP[r.split(/\s+/)[0].toLowerCase()];
  return e ? M.uid('user:' + e) : null;
}
const digits10 = (p) => { const d = s(p).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const postal = (v) => { const x = s(v).toUpperCase().replace(/\s+/g, ''); return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(x) ? x.slice(0, 3) + ' ' + x.slice(3) : s(v) || null; };

async function sync(sql) {
  const direct = require('./_metaleads');
  const key = process.env.N8N_INTAKE_SECRET;
  if (!direct.ready() && !key) return { skipped: 'not_set_up' };
  const [row] = await sql`select value from settings where key = 'meta_sync'`;
  const since = Number(row && row.value && row.value.sinceMs) || START_MS;
  const feed = direct.ready() ? await direct.leadsSince(since).catch((e) => ({ error: e.message })) : await fromEdge(key, since);
  if (feed.error) return { error: feed.error, from: direct.ready() ? 'meta' : 'edge' };
  return Object.assign(await save(sql, feed, since), { from: direct.ready() ? 'meta' : 'edge' });
}

// The old way: live Edge's ad-leads feed (until Pulse has META_ADS_TOKEN).
async function fromEdge(key, since) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  let feed;
  try {
    const r = await fetch(FEED + '&sinceMs=' + since, { headers: { 'X-Intake-Secret': key }, signal: ctl.signal });
    if (!r.ok) return { error: 'feed_' + r.status };
    feed = await r.json();
  } catch (e) { return { error: e.name === 'AbortError' ? 'feed_timeout' : 'feed_unreachable' }; } finally { clearTimeout(t); }
  return feed || {};
}

async function save(sql, feed, since) {
  const out = { seen: 0, added: 0, matched: 0, known: 0 };
  let latest = since;
  for (const l of (feed && feed.leads) || []) {
    out.seen++;
    // One lead the database refuses (a bad date, a NUL character) must not block the leads after it every tick: it is counted and skipped.
    let r;
    try {
      r = await sql.begin(async (tx) => {
        await tx`select set_config('app.source', 'meta', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
        return one(tx, l);
      });
    } catch (e) { console.error('META lead', s(l.id), e.message); r = 'skipped'; }
    out[r] = (out[r] || 0) + 1;
    if (r === 'added') await welcome(l).catch((e) => console.error('META welcome', s(l.id), e.message));
    if (l.ts > latest) latest = l.ts;
  }
  await sql`insert into settings (key, value) values ('meta_sync', ${sql.json({ sinceMs: latest + 1 })}) on conflict (key) do update set value = excluded.value`;
  if (feed && feed.failed && feed.failed.length) out.failedForms = feed.failed.map((f) => f.form);
  return out;
}

// The 48-hour welcome email to a brand-new ad lead (owner 2026-10-14; it lives in n8n's [DIGEST] on /ad-lead-welcome, which
// sends each address once). HubSpot used to start it (renellence-onboarding enrich.js on a HubSpot webhook); with HubSpot
// going (owner 2026-10-30) Pulse starts it when it adds the lead, with the same fields. Only on Vercel (never from tests), and
// only for leads from the last two days, so a catch-up never mails old leads.
const WELCOME = () => process.env.LEAD_WELCOME_URL || (process.env.VERCEL ? 'https://renellence.app.n8n.cloud/webhook/ad-lead-welcome' : '');
async function welcome(l) {
  const url = WELCOME();
  const email = M.email(l.email);
  if (!url || !email || !(l.at && Date.now() - new Date(l.at).getTime() < 2 * 86400000)) return;
  const parts = s(l.name).replace(/^dr\.?\s+/i, '').split(/\s+/).filter(Boolean);
  const owner = ownerOf(l.rep);
  await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, firstName: parts[0] || '', lastName: parts.slice(1).join(' '), phone: s(l.phone), clinic: s(l.clinic), city: s(l.city),
      province: s(l.province), ownerId: owner ? s(require('./_hsapi').OWNER_OF[owner]) : '', source: 'pulse' }) });
}

async function one(tx, l) {
  const id = s(l.id);
  if (!id) return 'known';
  const [have] = await tx`select id from contacts where meta_lead_id = ${id}`;
  if (have) return 'known';
  const email = M.email(l.email), phone = M.e164(l.phone), d = digits10(l.phone);
  const prov = s(l.province) && /^[A-Za-z]{2}$/.test(s(l.province)) ? s(l.province).toUpperCase() : null;
  const [match] = await tx`select id from contacts where deleted_at is null and merged_into_contact_id is null and (
      (${email}::text is not null and (lower(email::text) = ${email} or lower(secondary_email::text) = ${email}))
      or (${d} <> '' and (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = ${d} or right(regexp_replace(coalesce(mobile_phone, ''), '\D', '', 'g'), 10) = ${d})))
    order by created_at limit 1`;
  if (match) {
    await tx`update contacts set meta_lead_id = coalesce(meta_lead_id, ${id}), email = coalesce(email, ${email}), mobile_phone = coalesce(mobile_phone, ${phone}),
               shipping_city = coalesce(shipping_city, ${s(l.city) || null}), shipping_postal_code = coalesce(shipping_postal_code, ${postal(l.postal)}),
               shipping_province = coalesce(shipping_province, ${prov}) where id = ${match.id}`;
    return 'matched';
  }
  const parts = s(l.name).replace(/^dr\.?\s+/i, '').split(/\s+/).filter(Boolean);
  const named = parts.length && !/@/.test(parts[0]) && s(l.name) !== 'No name';
  await tx`insert into contacts (owner_id, first_name, last_name, email, mobile_phone, lead_source, meta_lead_id,
             shipping_city, shipping_postal_code, shipping_province, billing_city, billing_postal_code, billing_province, created_at)
           values (${ownerOf(l.rep)}, ${named ? parts[0] : null}, ${named ? parts.slice(1).join(' ') || null : null}, ${email}, ${phone}, 'social', ${id},
             ${s(l.city) || null}, ${postal(l.postal)}, ${prov}, ${s(l.city) || null}, ${postal(l.postal)}, ${prov}, ${l.at && !isNaN(new Date(l.at)) ? new Date(l.at) : new Date()})`;
  return 'added';
}

module.exports = { sync, ownerOf };
