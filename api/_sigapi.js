// SignatureAPI -> Supabase v2, live (owner 2026-10-27: "everything in pulse hooked up"), and "Remind MD to sign".
// Needs SIGNATUREAPI_KEY (the same live key Edge, the forms site and n8n use). Without it nothing runs.
//
// Every timer tick (api/cron.js):
//   1. new envelopes: SignatureAPI's list, newest first, back over the last 3 days (so one whose person reached v2 a
//      little later is picked up on a later tick). Live, non-test envelopes only. Each becomes an agreement with its
//      signers, and an onboarding envelope also an onboarding, by the same rules as the Oct 22 load
//      (renellence-ops migration-load/build.js): ids md5('…:agreement:<envelope id>'), kind from the title, the
//      person found by email. One v2 has no person for is left for a later tick (counted as unmatched).
//   2. waiting agreements: the oldest-checked ones are read again (up to 15 a tick), so signed, cancelled or failed
//      envelopes, and each signer's status, reach v2 (and the onboarding becomes signed / abandoned).
// change_logs source 'import' (there is no 'signatureapi' change_logs source; adding one is a v2 change to ask about).
'use strict';
const M = require('./_hsmap');
const API = 'https://api.signatureapi.com/v1/';
const WINDOW_MS = 3 * 86400000;
const REFRESH = 15;
const s = (v) => (v == null ? '' : String(v).trim());
const iso = (v) => { const t = Date.parse(v); return isNaN(t) ? null : new Date(t).toISOString(); };
const key = () => process.env.SIGNATUREAPI_KEY || process.env.SIGNATURE_API_KEY || '';

async function sa(path, opts) {
  const o = opts || {};
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), o.timeout || 15000);
  try {
    const r = await fetch(path.startsWith('http') ? path : API + path, { method: o.method || 'GET', signal: ctl.signal,
      headers: { 'X-API-Key': key(), Accept: 'application/json', ...(o.body ? { 'Content-Type': 'application/json' } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(s(j.detail || j.title || j.message) || 'signatureapi_' + r.status); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(t); }
}

const kindOf = (title) => (/Onboarding|ouverture de compte/i.test(title) ? 'onboarding' : /Product Distribution Record/i.test(title) ? 'md_pdr' : 'training');
const statusOf = (e) => (e.status === 'completed' ? 'completed' : e.status === 'canceled' ? 'cancelled' : e.status === 'failed' ? 'failed' : 'waiting');
const signerStatus = (r, e) => (r.status === 'completed' ? 'signed' : r.status === 'declined' || r.status === 'rejected' ? 'declined'
  : r.status === 'bounced' ? 'bounced' : e.status === 'canceled' ? 'not_sent' : 'sent');
const signerRole = (k) => (k === 'delegate' ? 'practitioner' : k === 'medical_director' || k === 'md' ? 'md' : k || null);
const isTest = (e) => e.mode !== 'live' || (e.metadata && (e.metadata.test === true || e.metadata.test === 'true'));

async function byEmail(tx, v) {
  const e = M.email(v);
  if (!e) return null;
  const [c] = await tx`select id from contacts where deleted_at is null and merged_into_contact_id is null
                         and (lower(email::text) = ${e} or lower(secondary_email::text) = ${e}) order by created_at limit 1`;
  return c ? c.id : null;
}
async function contactFor(tx, e, kind) {
  const md = e.metadata || {}, rs = e.recipients || [];
  const tries = kind === 'onboarding' ? [md.customer_email, (rs.find((r) => r.key === 'delegate') || {}).email]
    : kind === 'md_pdr' ? [md.customer_email, md.md_email]
      : [md.participant_email, md.customer_email, md.model_email, md.patient_email, md.provider_email, md.clinic_email].concat(rs.map((r) => r.email));
  for (const x of tries) { const id = await byEmail(tx, x); if (id) return id; }
  return null;
}

// One envelope into v2 (new or refreshed). Returns 'added', 'updated' or 'unmatched'.
async function upsert(tx, e) {
  const [have] = await tx`select id, contact_id, kind::text from agreements where signatureapi_envelope_id = ${e.id}`;
  const kind = have ? have.kind : kindOf(s(e.title));
  const contact = have ? have.contact_id : await contactFor(tx, e, kind);
  if (!contact) return 'unmatched';
  const status = statusOf(e), rs = e.recipients || [];
  const cancelledAt = status === 'cancelled' ? iso(rs.map((r) => r.status_updated_at).filter(Boolean).sort().pop()) : null;
  const aid = have ? have.id : M.uid('agreement:' + e.id);
  if (have) {
    await tx`update agreements set status = ${status}, completed_at = ${iso(e.completed_at)}, cancelled_at = coalesce(cancelled_at, ${cancelledAt}), updated_at = now()
              where id = ${aid} and (status::text is distinct from ${status} or completed_at is distinct from ${iso(e.completed_at)})`;
  } else {
    await tx`insert into agreements (id, kind, contact_id, signatureapi_envelope_id, status, sent_at, completed_at, cancelled_at, training_name, created_at, updated_at)
             values (${aid}, ${kind}, ${contact}, ${e.id}, ${status}, ${iso(e.created_at)}, ${iso(e.completed_at)}, ${cancelledAt},
                     ${kind === 'training' ? s(e.title) || null : null}, ${iso(e.created_at) || new Date().toISOString()}, now())`;
  }
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], sid = M.uid('signer:' + e.id + ':' + (r.id || i));
    await tx`insert into agreement_signers (id, agreement_id, contact_id, name, email, role, signing_order, status, signed_at)
             values (${sid}, ${aid}, ${await byEmail(tx, r.email)}, ${s(r.name) || null}, ${M.email(r.email)}, ${signerRole(r.key)}, ${i + 1}, ${signerStatus(r, e)}, ${iso(r.completed_at)})
             on conflict (id) do update set status = excluded.status, signed_at = excluded.signed_at
             where agreement_signers.status is distinct from excluded.status or agreement_signers.signed_at is distinct from excluded.signed_at`;
  }
  if (kind === 'onboarding') {
    const ob = status === 'completed' ? 'signed' : status === 'cancelled' ? 'abandoned' : 'submitted';
    const [onb] = await tx`select id, status::text from onboardings where agreement_id = ${aid}`;
    if (onb) {
      // never step back: 'complete' (card saved, set elsewhere) stays
      if (onb.status !== 'complete' && onb.status !== ob) await tx`update onboardings set status = ${ob}, completed_at = ${status === 'completed' ? iso(e.completed_at) : null}, updated_at = now() where id = ${onb.id}`;
    } else {
      const deleg = rs.find((r) => r.key === 'delegate'), mdr = rs.find((r) => r.key === 'medical_director');
      const inj = (deleg && await byEmail(tx, deleg.email)) || contact;
      const mdc = mdr ? await byEmail(tx, mdr.email) : null;
      await tx`insert into onboardings (id, injector_contact_id, primary_contact_id, medical_director_contact_id, submitted_at, form_answers, agreement_id, status, completed_at, created_at, updated_at)
               values (${M.uid('onboarding:' + e.id)}, ${inj}, ${contact}, ${mdc === contact ? null : mdc}, ${iso(e.created_at)},
                       ${(e.documents || [])[0] && e.documents[0].data ? tx.json(e.documents[0].data) : null}, ${aid}, ${ob},
                       ${status === 'completed' ? iso(e.completed_at) : null}, ${iso(e.created_at) || new Date().toISOString()}, now())
               on conflict (id) do nothing`;
    }
  }
  return have ? 'updated' : 'added';
}

async function inTx(sql, fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'import', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
    return fn(tx);
  });
}

async function sync(sql, budgetMs) {
  if (!key()) return { skipped: 'not_set_up' };
  const until = Date.now() + (budgetMs || 15000);
  const out = { seen: 0, added: 0, updated: 0, unmatched: 0, refreshed: 0, errors: 0 };
  // 1. new envelopes, newest first, back over the window
  const since = Date.now() - WINDOW_MS;
  let cursor = '', pages = 0;
  try {
    while (pages++ < 10 && Date.now() < until) {
      const j = await sa('envelopes?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      const list = j.data || [];
      let older = false;
      for (const e of list) {
        if (Date.parse(e.created_at) < since) { older = true; break; }
        out.seen++;
        if (isTest(e)) continue;
        const [known] = await sql`select 1 from agreements where signatureapi_envelope_id = ${e.id}`;
        if (known) continue;   // refreshed by step 2 while it is waiting
        try { out[await inTx(sql, (tx) => upsert(tx, e))]++; } catch (x) { out.errors++; }
      }
      cursor = j.links && j.links.next ? ((/[?&]cursor=([^&]+)/.exec(j.links.next) || [])[1] || '') : '';
      if (older || !cursor) break;
    }
  } catch (e) { out.listError = e.message; }
  // 2. waiting agreements, in turn: a bookmark (settings 'sigapi_sync' { after: agreement id }) walks them in id order and
  //    wraps around, so every one is checked every few ticks without writing to the rows that did not change
  const [bm] = await sql`select value from settings where key = 'sigapi_sync'`;
  const after = (bm && bm.value && bm.value.after) || '00000000-0000-0000-0000-000000000000';
  let waiting = await sql`select id, signatureapi_envelope_id as env from agreements
                           where status = 'waiting' and signatureapi_envelope_id is not null and id > ${after} order by id limit ${REFRESH}`;
  if (!waiting.length) waiting = await sql`select id, signatureapi_envelope_id as env from agreements
                                            where status = 'waiting' and signatureapi_envelope_id is not null order by id limit ${REFRESH}`;
  let last = null;
  for (const w of waiting) {
    if (Date.now() > until) break;
    last = w.id;
    try {
      const e = await sa('envelopes/' + encodeURIComponent(w.env));
      await inTx(sql, (tx) => upsert(tx, e));
      out.refreshed++;
    } catch (x) { out.errors++; }
  }
  if (last) await sql`insert into settings (key, value) values ('sigapi_sync', ${sql.json({ after: last })}) on conflict (key) do update set value = excluded.value`;
  return out;
}

// "Remind MD to sign" (L20 / L21): resend the signing email to whoever on the envelope has not signed yet. SignatureAPI
// allows it for a recipient at sent / soft_bounced on an in-progress envelope, and spaces resends out itself.
async function remind(envelopeId) {
  if (!key()) return { queued: false, reason: 'signatureapi_not_connected' };
  try {
    const e = await sa('envelopes/' + encodeURIComponent(envelopeId));
    if (e.status !== 'in_progress') return { queued: false, reason: 'not_waiting' };
    const r = (e.recipients || []).find((x) => x.type !== 'viewer' && (x.status === 'sent' || x.status === 'soft_bounced'));
    if (!r) return { queued: false, reason: 'nobody_to_remind' };
    await sa('recipients/' + encodeURIComponent(r.id) + '/resend', { method: 'POST', body: {} });
    return { queued: true, to: s(r.name) || s(r.email) };
  } catch (e) {
    return { queued: false, reason: e.status === 409 || e.status === 429 || e.status === 422 ? 'reminded_recently' : 'signatureapi_error', detail: e.message };
  }
}

module.exports = { sync, remind, upsert, _: { kindOf, statusOf, signerStatus } };
