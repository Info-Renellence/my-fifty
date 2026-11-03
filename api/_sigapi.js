// SignatureAPI -> Supabase v2, live (owner 2026-10-27: "everything in pulse hooked up"), and "Remind MD to sign".
// Needs SIGNATUREAPI_KEY (the same live key Edge, the forms site and n8n use). Without it nothing runs.
//
// Every timer tick (api/cron.js):
//   1. new envelopes: SignatureAPI's list, newest first, back over the last 14 days (so one whose person reached v2
//      later is picked up on a later tick; data-flow audit 2026-10-28: with 3 days, one unmatched longer was never added). Live, non-test envelopes only. Each becomes an agreement with its
//      signers, and an onboarding envelope also an onboarding, by the same rules as the Oct 22 load
//      (renellence-ops migration-load/build.js): ids md5('…:agreement:<envelope id>'), kind from the title, the
//      person found by email. One v2 has no person for is left for a later tick (counted as unmatched).
//   2. waiting agreements: the oldest-checked ones are read again (up to 15 a tick), so signed, cancelled or failed
//      envelopes, and each signer's status, reach v2 (and the onboarding becomes signed / abandoned). Signer rows are kept
//      one per recipient (syncSigners), and a completed envelope's signed PDF goes to v2 Storage (keepSignedPdf).
//   3. completed agreements still without their signed PDF: a few a tick.
// change_logs source 'import' (there is no 'signatureapi' change_logs source; adding one is a v2 change to ask about).
'use strict';
const M = require('./_hsmap');
const API = 'https://api.signatureapi.com/v1/';
const WINDOW_MS = 14 * 86400000;
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
    // SignatureAPI allows about 8 requests a second; the sync's burst of envelope reads sometimes gets one 429 (2026-11-03).
    // A 429 was not carried out, so it is tried once more a second later.
    if (r.status === 429 && !o.retried) { await new Promise((ok) => setTimeout(ok, 1100)); return sa(path, { ...o, retried: true }); }
    if (!r.ok) { const e = new Error(s(j.detail || j.title || j.message) || 'signatureapi_' + r.status); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(t); }
}

const kindOf = (title) => (/Onboarding|ouverture de compte/i.test(title) ? 'onboarding' : /Product Distribution Record/i.test(title) ? 'md_pdr' : 'training');
const statusOf = (e) => (e.status === 'completed' ? 'completed' : e.status === 'canceled' ? 'cancelled' : e.status === 'failed' ? 'failed' : 'waiting');
// 'awaiting' is a later signer on a sequential envelope who has not been emailed yet (Yousef 2026-11-02, full audit: 30 MDs
// read as "sent" before the first signature).
const signerStatus = (r, e) => (r.status === 'completed' ? 'signed' : r.status === 'declined' || r.status === 'rejected' ? 'declined'
  : r.status === 'bounced' ? 'bounced' : e.status === 'canceled' || r.status === 'awaiting' ? 'not_sent' : 'sent');
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

// The envelope's signers are the agreement's signer rows, one row per recipient (Yousef 2026-11-02, full audit: a customer
// had a stale "sent" row next to their "signed" one, so Edge asked to resend a form they had signed). Rows came in three ways
// with different ids: this sync (md5 of the recipient id), the Oct 22 / Oct 27 loads, and Edge's Send forms (random ids); and
// SignatureAPI gives a recipient a new id when their email is corrected. So a recipient's row is: its own id, else an unclaimed
// row for the same step with the same email, else one with the same email, else the same step's row of a recipient that is no
// longer on the envelope (the corrected one). Rows left over stand for nobody on the envelope and are removed. A name or a
// contact already set in v2 stays (v2 wins: names were cleaned and signers linked by hand); blanks are filled.
async function syncSigners(tx, aid, e) {
  const rs = e.recipients || [];
  const own = rs.map((r, i) => M.uid('signer:' + e.id + ':' + (r.id || i)));
  const rows = await tx`select id, name, email, signing_order, contact_id from agreement_signers where agreement_id = ${aid}`;
  const kept = new Set();
  const free = (x) => !kept.has(x.id) && !own.includes(x.id);
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], em = M.email(r.email);
    const row = rows.find((x) => x.id === own[i])
      || (em && rows.find((x) => free(x) && x.signing_order === i + 1 && M.email(x.email) === em))
      || (em && rows.find((x) => free(x) && M.email(x.email) === em))
      || rows.find((x) => free(x) && x.signing_order === i + 1 && !rs.some((y) => M.email(y.email) && M.email(y.email) === M.email(x.email)));
    const st = signerStatus(r, e), at = iso(r.completed_at);
    if (row) {
      kept.add(row.id);
      const contact = row.contact_id || await byEmail(tx, r.email);
      await tx`update agreement_signers set name = coalesce(name, ${s(r.name) || null}), email = coalesce(${em}, email), role = ${signerRole(r.key)},
                 signing_order = ${i + 1}, status = ${st}, signed_at = ${at}, contact_id = ${contact}
               where id = ${row.id} and (status::text is distinct from ${st} or signed_at is distinct from ${at} or signing_order is distinct from ${i + 1}
                 or email is distinct from coalesce(${em}, email) or role is distinct from ${signerRole(r.key)} or contact_id is distinct from ${contact}
                 or (name is null and ${s(r.name) || null}::text is not null))`;
    } else {
      kept.add(own[i]);
      await tx`insert into agreement_signers (id, agreement_id, contact_id, name, email, role, signing_order, status, signed_at)
               values (${own[i]}, ${aid}, ${await byEmail(tx, r.email)}, ${s(r.name) || null}, ${em}, ${signerRole(r.key)}, ${i + 1}, ${st}, ${at})
               on conflict (id) do nothing`;
    }
  }
  const gone = rows.filter((x) => !kept.has(x.id));
  if (!gone.length || !rs.length) return;
  // a contact someone linked on a row that goes (the MD before her email was corrected) moves to the same step's row
  for (const g of gone) if (g.contact_id) await tx`update agreement_signers set contact_id = ${g.contact_id} where agreement_id = ${aid} and signing_order = ${g.signing_order} and contact_id is null and id in ${tx([...kept])}`;
  await tx`delete from agreement_signers where agreement_id = ${aid} and id in ${tx(gone.map((x) => x.id))}`;
}

// The signed PDF into v2 Storage (Yousef 2026-11-02, full audit: no agreement had its signed file). SignatureAPI's deliverable
// of a completed envelope is a short-lived link; the file goes to the private bucket `files` by the naming rule in _files.js
// (agreements/<agreement id>/<file id>.pdf, file id fixed per envelope so a retry overwrites), one files row, and
// agreements.signed_file_id. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (v2), as the n8n file upload does; else skipped.
async function keepSignedPdf(tx, aid, e) {
  const base = s(process.env.SUPABASE_URL).replace(/\/$/, ''), skey = s(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const d = e.deliverable || {};
  if (!base || !skey || d.status !== 'generated' || !d.url) return false;
  const [a] = await tx`select signed_file_id from agreements where id = ${aid}`;
  if (!a || a.signed_file_id) return false;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(d.url, { signal: ctl.signal });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.slice(0, 4).toString() !== '%PDF') return false;
    const F = require('./_files');
    const fileId = M.uid('signedpdf:' + e.id);
    // the name SignatureAPI gives the download (encoded twice inside the link), else the envelope's title
    const dec = (x) => { try { return decodeURIComponent(x); } catch (_) { return x; } };
    const original = (dec(dec((/filename%3D([^&]+)/i.exec(d.url) || [])[1] || '')).replace(/\+/g, ' ').match(/^([^/\\]*\.pdf)$/i) || [])[1] || (s(e.title) || 'Signed agreement') + '.pdf';
    const { storagePath } = F.fileNames({ table: 'agreements', parentId: aid, fileId, originalName: original, mimeType: 'application/pdf' });
    const up = await fetch(base + '/storage/v1/object/files/' + storagePath, { method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + skey, apikey: skey, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: buf });
    if (!up.ok) return false;
    await tx`insert into files (id, storage_path, file_name, mime_type, size_bytes, agreement_id)
             values (${fileId}, ${storagePath}, ${original.slice(0, 200)}, 'application/pdf', ${buf.length}, ${aid}) on conflict (id) do nothing`;
    await tx`update agreements set signed_file_id = ${fileId}, updated_at = now() where id = ${aid} and signed_file_id is null`;
    return true;
  } finally { clearTimeout(t); }
}

// One envelope into v2 (new or refreshed). Returns 'added', 'updated' or 'unmatched'.
async function upsert(tx, e) {
  const [have] = await tx`select id, contact_id, kind::text from agreements where signatureapi_envelope_id = ${e.id}`;
  const kind = have ? have.kind : kindOf(s(e.title));
  // A training or model form is kept even when nobody on it is a customer (models are never contacts, owner 2026-10-30; Edge's
  // Send forms records them the same way), and is linked once one is (final audit 2026-10-30: 45 such envelopes were never in v2).
  const contact = have && have.contact_id ? have.contact_id : await contactFor(tx, e, kind);
  if (!contact && !(kind === 'training' && /^Renellence\b/i.test(s(e.title)))) return 'unmatched';   // only our own forms, never any envelope
  if (have && !have.contact_id && contact) await tx`update agreements set contact_id = ${contact}, updated_at = now() where id = ${have.id}`;
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
  await syncSigners(tx, aid, e);
  if (status === 'completed') await keepSignedPdf(tx, aid, e).catch(() => null);   // a missed PDF is caught up by a later tick
  if (kind === 'onboarding') {
    const ob = status === 'completed' ? 'signed' : status === 'cancelled' ? 'abandoned' : 'submitted';
    const [onb] = await tx`select id, status::text from onboardings where agreement_id = ${aid}`;
    if (onb) {
      // never step back: 'complete' (card saved, set elsewhere) stays
      if (onb.status !== 'complete' && onb.status !== ob) await tx`update onboardings set status = ${ob}, completed_at = ${status === 'completed' ? iso(e.completed_at) : null}, updated_at = now() where id = ${onb.id}`;
      // A signer who reached v2 after the form came in (Yousef 2026-11-02, full audit: 5 injectors left as the account, 3 MDs
      // blank): the injector that was only the account stand-in, and an empty MD, are filled; anything else set stays.
      const deleg = rs.find((r) => r.key === 'delegate'), mdr = rs.find((r) => r.key === 'medical_director');
      const inj = deleg ? await byEmail(tx, deleg.email) : null, mdc = mdr ? await byEmail(tx, mdr.email) : null;
      // not when the signer is the account under another email (George Addoumieh: his email sits on a second, nameless record)
      const nm = (v) => s(v).toLowerCase().replace(/^dr\.?\s+/, '').replace(/\s+/g, ' ');
      const [acct] = await tx`select first_name, last_name from contacts where id = ${contact}`;
      const self = acct && deleg && nm(deleg.name) === nm([acct.first_name, acct.last_name].filter(Boolean).join(' '));
      if (inj && !self) await tx`update onboardings set injector_contact_id = ${inj}, updated_at = now()
                         where id = ${onb.id} and injector_contact_id is not distinct from primary_contact_id and injector_contact_id is distinct from ${inj}`;
      if (mdc) await tx`update onboardings set medical_director_contact_id = ${mdc}, updated_at = now()
                         where id = ${onb.id} and medical_director_contact_id is null and primary_contact_id is distinct from ${mdc}`;
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
  // 3. signed PDFs that did not make it when the agreement completed (storage not set up, a timeout): a few a tick, in random
  //    order so one that keeps failing never holds the others back (Yousef 2026-11-02, full audit)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const done = await sql`select id, signatureapi_envelope_id as env from agreements where status = 'completed' and signed_file_id is null
                             and signatureapi_envelope_id is not null and completed_at > now() - interval '60 days' order by random() limit 3`;
    for (const d of done) {
      if (Date.now() > until) break;
      try { const e = await sa('envelopes/' + encodeURIComponent(d.env)); if (await inTx(sql, (tx) => keepSignedPdf(tx, d.id, e))) out.pdfs = (out.pdfs || 0) + 1; } catch (x) { out.errors++; }
    }
  }
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
    try {
      await sa('recipients/' + encodeURIComponent(r.id) + '/resend', { method: 'POST', body: {} });
    } catch (x) {
      // Our envelopes sign through our own link (SignatureAPI "custom" ceremony): SignatureAPI refuses to email a resend (409,
      // found 2026-11-03). The n8n [DIGEST] onboarding-remind webhook emails the pending signer their signing link instead.
      if (x.status !== 409 && x.status !== 422) throw x;
      const base = String(process.env.N8N_WEBHOOK_BASE || 'https://renellence.app.n8n.cloud/webhook').replace(/\/+$/, '');
      const resp = await fetch(base + '/onboarding-remind?envelope=' + encodeURIComponent(envelopeId), { signal: AbortSignal.timeout(30000) });
      const text = await resp.text();
      if (!resp.ok || /went wrong|could not build/i.test(text)) return { queued: false, reason: 'reminder_email_failed', detail: text.slice(0, 200) };
    }
    return { queued: true, to: s(r.name) || s(r.email) };
  } catch (e) {
    // only SignatureAPI's own rate limit means "too soon" (409 used to be read as reminded_recently too)
    return { queued: false, reason: e.status === 429 ? 'reminded_recently' : 'signatureapi_error', detail: e.message };
  }
}

module.exports = { sync, remind, upsert, syncSigners, keepSignedPdf, _: { kindOf, statusOf, signerStatus } };
