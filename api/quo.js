require('./_staging'); // first: with STAGING=1 nothing goes out (api/_staging.js)
// Quo -> v2 (owner 2026-10-27). Quo's webhooks post every call, text and AI call summary here:
//   POST /api/quo?key=<N8N_INTAKE_SECRET>          (+ Quo's 'openphone-signature', checked when QUO_WEBHOOK_SECRET is set)
// Each event is kept once in ingest_events (source quo). Then, by the outside number:
//   - a contact has it   -> the call or text goes on that contact's history (interactions, source quo, external_id = Quo's
//                           id, the same rows the Oct 22 load made), and a call's AI summary into ai_outputs
//   - nobody has it      -> it waits in quo_unmatched, never shown to reps; the database attaches it when a contact gets
//                           that number (v2-014). Quo never creates a contact (owner 2026-10-23, option 2).
// The 647 line is n8n's automated customer texts: its outgoing texts are skipped (as on Oct 22).
// Answers 200 for everything it accepted (also when it skipped it), so Quo doesn't retry; 401 for a bad key or signature.
const crypto = require('crypto');
const { db } = require('./_db');
const { send, route, fail } = require('./_http');
const M = require('./_hsmap');

// Which rep uses each Quo line (phone number id). Lines not listed are logged with no rep.
const LINE_REP = { PNEka6s0zF: 'emily@renellence.com' };
const AUTOMATED_LINE = 'PNMnOzgxCz';   // +1 647 584 0040, n8n's customer texts
const s = (v) => (v == null ? '' : String(v));
const digits10 = (p) => { const d = s(p).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

function keyOk(req) {
  const want = s(process.env.N8N_INTAKE_SECRET), got = s(new URL(req.url, 'http://x').searchParams.get('key'));
  return !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
// Quo's signature: 'hmac;1;<timestamp>;<base64 HMAC-SHA256 of "<timestamp>.<raw body>" with the base64 signing key>'.
function signatureOk(header, raw, now = Date.now()) {
  const secret = s(process.env.QUO_WEBHOOK_SECRET).trim();
  if (!secret) return true;   // not set up yet: the key in the URL is the check
  const parts = s(header).split(';');
  if (parts.length < 4 || parts[0] !== 'hmac') return false;
  let at = Number(parts[2]);
  if (!isFinite(at)) return false;
  if (at < 1e12) at *= 1000;
  if (Math.abs(now - at) > 10 * 60 * 1000) return false;
  const want = crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(parts[2] + '.' + raw).digest('base64');
  const got = parts.slice(3).join(';').trim();
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

module.exports = route(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'method_not_allowed');
  const raw = await new Promise((ok) => { if (typeof req.body === 'string') return ok(req.body); if (req.body && typeof req.body === 'object') return ok(JSON.stringify(req.body));
    const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch).toString('utf8'))); });
  if (!keyOk(req) || !signatureOk(req.headers['openphone-signature'], raw)) throw fail(401, 'unauthorized');
  let ev; try { ev = JSON.parse(raw); } catch (e) { throw fail(400, 'bad_json'); }
  send(res, 200, await handle(db(), ev));
});

async function handle(sql, ev) {
  if (!ev || !ev.id || !ev.type) return { ok: true, ignored: 'not_an_event' };
  const [row] = await sql`insert into ingest_events (source, external_id, payload, received_via, status, attempts)
                          values ('quo', ${s(ev.id)}, ${sql.json(ev)}, 'webhook', 'pending', 0) on conflict (source, external_id) do nothing returning id`;
  if (!row) return { ok: true, duplicate: true };
  try {
    const r = await apply(sql, ev);
    await sql`update ingest_events set status = ${r.skipped ? 'skipped' : 'done'}, attempts = 1, processed_at = now(), error_message = ${r.why || null},
                result_table = ${r.table || null}, result_id = ${r.id || null} where id = ${row.id}`;
    return Object.assign({ ok: true }, r);
  } catch (e) {
    console.error('QUO', ev.type, e.message);
    await sql`update ingest_events set status = 'failed', attempts = 1, error_message = ${s(e.message).slice(0, 500)} where id = ${row.id}`;
    return { ok: false, failed: true };
  }
}

const outside = (o) => { const pick = /^in/i.test(s(o.direction)) ? o.from : o.to; return s(Array.isArray(pick) ? pick[0] : pick) || s((o.participants || [])[0]); };
const contactsFor = (sql, p) => sql`select id from contacts where deleted_at is null and merged_into_contact_id is null
  and (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = ${digits10(p)} or right(regexp_replace(coalesce(mobile_phone, ''), '\D', '', 'g'), 10) = ${digits10(p)})`;

// A call or text as the interactions row it becomes (the Oct 22 load's shape).
function rowOf(type, o) {
  const call = /^call\./.test(type);
  const line = s(o.phoneNumberId);
  const rep = LINE_REP[line] ? M.uid('user:' + LINE_REP[line]) : null;
  const dir = /^in/i.test(s(o.direction)) ? 'in' : 'out';
  return { kind: call ? 'call' : 'text', user_id: rep, created_by_id: rep, occurred_at: new Date(o.createdAt || Date.now()).toISOString(), direction: dir,
    mode: call ? 'phone' : null, status: 'completed', outcome: call ? (o.status === 'completed' && o.answeredAt ? 'connected' : o.voicemail ? 'voicemail' : 'no_answer') : null,
    duration_seconds: call ? Number(o.duration) || null : null, recording_url: null, participants: { line, other: '' }, needs_review: false, source: 'quo', external_id: s(o.id) };
}

async function apply(sql, ev) {
  const o = (ev.data && ev.data.object) || {};
  if (ev.type === 'call.summary.completed') return summary(sql, o);
  if (!['call.completed', 'message.received', 'message.delivered'].includes(ev.type)) return { skipped: true, why: 'not kept: ' + ev.type };
  if (s(o.phoneNumberId) === AUTOMATED_LINE && ev.type === 'message.delivered') return { skipped: true, why: 'automated customer text (647 line)' };
  const phone = outside(o);
  if (!digits10(phone)) return { skipped: true, why: 'no outside number' };
  const r = rowOf(ev.type, o);
  r.participants.other = M.e164(phone) || phone;
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'quo_webhook', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
    const cs = await contactsFor(tx, phone);
    if (!cs.length) {
      await tx`insert into quo_unmatched (phone, kind, direction, quo_id, line_id, occurred_at, payload)
               values (${r.participants.other}, ${r.kind}, ${r.direction}, ${r.external_id}, ${r.participants.line}, ${r.occurred_at}, ${tx.json(r)})
               on conflict (quo_id) do nothing`;
      return { table: 'quo_unmatched', held: true };
    }
    let first = null;
    for (const c of cs) {
      const id = M.uid('int:quo|' + r.external_id + '|' + c.id);
      const full = Object.assign({ id, contact_id: c.id }, r);
      await tx.unsafe(`insert into public.interactions (${Object.keys(full).map((k) => `"${k}"`).join(', ')}) select ${Object.keys(full).map((k) => `"${k}"`).join(', ')}
                       from json_populate_record(null::public.interactions, $1::text::json) on conflict do nothing`, [JSON.stringify(full)]);
      first = first || id;
    }
    return { table: 'interactions', id: first };
  });
}

// Quo's AI summary of a call: on the call's interactions (ai_outputs), or kept with the held call until it attaches.
async function summary(sql, o) {
  const text = [].concat(o.summary || []).map(s).filter(Boolean).join('\n') + ((o.nextSteps || []).length ? '\nNext: ' + [].concat(o.nextSteps).map(s).join('; ') : '');
  if (!text.trim() || !o.callId) return { skipped: true, why: 'empty summary' };
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'quo_webhook', true), set_config('app.user_id', '', true), set_config('app.batch_id', '', true)`;
    const ints = await tx`select id, occurred_at from interactions where source = 'quo' and external_id = ${s(o.callId)} and deleted_at is null`;
    for (const i of ints) await tx`insert into ai_outputs (id, kind, interaction_id, output_text, model_name, created_at) values (${M.uid('ai:' + i.id)}, 'call_summary', ${i.id}, ${text}, 'quo', ${i.occurred_at})
                                   on conflict do nothing`;
    if (ints.length) return { table: 'ai_outputs', id: M.uid('ai:' + ints[0].id) };
    const [h] = await tx`update quo_unmatched set payload = payload || ${tx.json({ _summary: text })} where quo_id = ${s(o.callId)} and attached_at is null returning id`;
    return h ? { table: 'quo_unmatched', id: h.id } : { skipped: true, why: 'call not received yet' };
  });
}

module.exports.handle = handle;
module.exports.signatureOk = signatureOk;
