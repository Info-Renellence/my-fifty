// Academy interest sign-ups -> v2 (owner 2026-10-29, audit item 2: "do it only for academy"). The form on
// academy.renellence.com posts to n8n "[REG] Academy Interest Registration", which keeps its Google Sheet and also sends
// a copy here:  POST /api/intake  { wf: 'Academy', kind: 'academy', reg: { first_name, last_name, email, phone, city,
// clinic, message, source, submitted_at } }
// Like a Meta lead (api/_meta.js): someone v2 has (same email or phone) gets their blank fields filled; anyone else becomes
// a contact, lead source event, owned by the rep for their place when one rep has it (BC, Alberta, Quebec; Ontario needs
// a postal code, so an admin assigns), else nobody. The message goes on the contact as a note. Kept once in ingest_events.
'use strict';
const crypto = require('crypto');
const M = require('./_hsmap');
const T = require('./_territory');
const REP = { Brittany: 'brittany.houston@renellence.com', Angela: 'angela.tuzzolino@renellence.com' };
const s = (v) => (v == null ? '' : String(v).trim());
const digits10 = (p) => { const d = s(p).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

async function academy(sql, b) {
  const r = b.reg && typeof b.reg === 'object' ? b.reg : {};
  const copy = { wf: 'Academy', node: 'academy interest', reg: r };
  const external = 'academy:' + crypto.createHash('sha256').update([M.email(r.email) || '', digits10(r.phone), s(r.submitted_at)].join('|')).digest('hex');
  const [ev] = await sql`
    insert into ingest_events (source, external_id, payload, received_via, status, attempts, received_at)
    values ('n8n', ${external}, ${sql.json(copy)}, 'n8n', 'pending', 0, now())
    on conflict (source, external_id) do nothing returning id`;
  if (!ev) return { ok: true, duplicate: true };
  try {
    const out = await sql.begin(async (tx) => {
      await tx`select set_config('app.source', 'n8n', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
      return one(tx, r, ev.id);
    });
    await sql`update ingest_events set status = ${out.skipped ? 'skipped' : 'done'}, attempts = 1, processed_at = now(), error_message = ${out.why || null},
                result_table = 'contacts', result_id = ${out.id || null} where id = ${ev.id}`;
    return Object.assign({ ok: true }, out);
  } catch (e) {
    console.error('INTAKE_ACADEMY', e.message);
    await sql`update ingest_events set status = 'failed', attempts = 1, error_message = ${String(e.message).slice(0, 500)} where id = ${ev.id}`;
    return { ok: false, failed: true, error: String(e.message).slice(0, 200) };
  }
}

async function one(tx, r, eventId) {
  const email = M.email(r.email), phone = M.e164(r.phone), d = digits10(r.phone), city = s(r.city) || null;
  if (!email && !d) return { skipped: true, why: 'no email or phone' };
  const [match] = await tx`select id from contacts where deleted_at is null and merged_into_contact_id is null and (
      (${email}::text is not null and (lower(email::text) = ${email} or lower(secondary_email::text) = ${email}))
      or (${d} <> '' and (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = ${d} or right(regexp_replace(coalesce(mobile_phone, ''), '\D', '', 'g'), 10) = ${d})))
    order by created_at limit 1`;
  let id, added = false;
  if (match) {
    id = match.id;
    await tx`update contacts set first_name = coalesce(first_name, ${s(r.first_name) || null}), last_name = coalesce(last_name, ${s(r.last_name) || null}),
               email = coalesce(email, ${email}), mobile_phone = case when phone is null and mobile_phone is null then ${phone} else mobile_phone end,
               shipping_city = coalesce(shipping_city, ${city}) where id = ${id}`;
  } else {
    const rule = T.placeRule(null, city);
    const rep = rule && !rule.split && rule.reps.length === 1 ? REP[rule.reps[0]] : null;
    const [c] = await tx`insert into contacts (owner_id, first_name, last_name, email, mobile_phone, lead_source, shipping_city, billing_city)
      values (${rep ? M.uid('user:' + rep) : null}, ${s(r.first_name) || null}, ${s(r.last_name) || null}, ${email}, ${phone}, 'event', ${city}, ${city})
      returning id`;
    id = c.id; added = true;
  }
  const body = ['Academy interest sign-up' + (s(r.clinic) ? ' (clinic: ' + s(r.clinic) + ')' : '') + '.', s(r.message)].filter(Boolean).join('\n');
  const at = r.submitted_at && !isNaN(new Date(r.submitted_at)) ? new Date(r.submitted_at) : new Date();
  await tx`insert into interactions (contact_id, kind, occurred_at, body, source, external_id, needs_review, created_at)
           values (${id}, 'note', ${at}, ${body}, 'import', ${'academy:' + eventId}, false, ${at})`;
  return { table: 'contacts', id, added };
}

module.exports = { academy };
