// Freshness alarms (owner 2026-10-28, data-flow improvement 6): an email to tech@ when a feed goes quiet for longer than
// normal or failures pile up, instead of finding out by looking. Run by the core part of the 5-minute tick. Everything
// is read from what v2 already keeps (ingest_events, change_logs, pg_net's copy of each tick's answer); nothing is written
// per tick. The email itself is sent by a line in n8n's [DIGEST] Sales Rep Daily Digest (N8N_ALARM_URL, called with the
// Pulse ISF key); until that is set the alarms only show in the tick's answer. The same alarm is sent at most once in
// 6 hours (settings 'alarms_sent').
//   gmail_quiet       weekdays 9 AM-7 PM Toronto: no rep email came in for 3 hours
//   quo_quiet         weekdays 10 AM-6 PM: no Quo call or text for 8 hours
//   n8n_quiet         no n8n write step reached Pulse for 24 hours
//   failed_copies     3 or more outside copies (n8n, Quo, Gmail, Stripe) failed in the last hour
//   stripe_waiting    a Stripe payment has waited more than a day for its order
//   missed_writes     an order reached v2 only through the HubSpot pull in the last hour (an n8n write step was missed)
//   part_silent       a part of the tick that was running has not answered for 20 minutes
//   part_failing      a part's last 3 answers all carried the same error (Meta, HubSpot pull, SignatureAPI, Gmail)
'use strict';

const RESEND_H = 6;
const TO = 'tech@renellence.com';

function torontoNow(now) {
  const d = new Date(now || Date.now());
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'short', hour: 'numeric', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: !['Sat', 'Sun'].includes(p.weekday), hour: Number(p.hour) % 24 };
}
const one = async (q) => { try { return (await q)[0] || {}; } catch (e) { return {}; } };

// What is wrong right now: [{ key, title, detail }]
async function findings(sql, now = Date.now()) {
  const t = torontoNow(now), out = [];
  const hoursSince = (iso) => (iso ? (now - new Date(iso).getTime()) / 3600e3 : Infinity);
  const last = async (src) => (await one(sql`select max(received_at) as at from ingest_events where source = ${src}`)).at;
  if (t.weekday && t.hour >= 9 && t.hour < 19) {
    const g = await last('gmail');
    if (hoursSince(g) > 3) out.push({ key: 'gmail_quiet', title: 'No rep email has come in for ' + Math.floor(hoursSince(g)) + ' hours', detail: 'The Gmail pull may be failing or a rep\'s Gmail connection expired. Check the tick\'s gmail answer.' });
  }
  if (t.weekday && t.hour >= 10 && t.hour < 18) {
    const q = await last('quo');
    if (hoursSince(q) > 8) out.push({ key: 'quo_quiet', title: 'No Quo call or text for ' + Math.floor(hoursSince(q)) + ' hours', detail: 'Check the Quo webhook (pulse.renellence.com/api/quo) in Quo\'s settings.' });
  }
  const n = await last('n8n');
  if (hoursSince(n) > 24) out.push({ key: 'n8n_quiet', title: 'No n8n write step has reached Pulse for ' + Math.floor(hoursSince(n)) + ' hours', detail: 'Check that the n8n workflows are on and their write steps still point at /api/intake.' });
  const f = await one(sql`select count(*)::int as n, string_agg(distinct source::text, ', ') as src from ingest_events where status = 'failed' and received_at > now() - interval '1 hour'`);
  if (f.n >= 3) out.push({ key: 'failed_copies', title: f.n + ' outside copies failed in the last hour (' + f.src + ')', detail: 'The error is on each row of ingest_events (Logs in the admin app); replay with renellence-ops ops/ingest/replay.js.' });
  const st = await one(sql`select count(*)::int as n from ingest_events where source = 'stripe' and status = 'pending' and received_at < now() - interval '1 day'`);
  if (st.n) out.push({ key: 'stripe_waiting', title: st.n + ' Stripe payment' + (st.n === 1 ? ' has' : 's have') + ' waited over a day for an order', detail: 'Stripe charged but no order in v2 carries that payment id. Check the sales form run.' });
  const mw = await one(sql`select count(distinct entity_id)::int as n from change_logs where entity_type = 'orders' and action in ('create', 'insert') and source = 'import' and changed_at > now() - interval '1 hour'`);
  if (mw.n) out.push({ key: 'missed_writes', title: mw.n + ' order' + (mw.n === 1 ? '' : 's') + ' reached v2 only through the HubSpot pull', detail: 'An n8n write step did not reach Pulse for ' + (mw.n === 1 ? 'it' : 'them') + '. The bridge caught it; check the workflow run.' });
  // the tick's parts, from pg_net's copy of each answer (kept about 6 hours)
  let ticks = [];
  try { ticks = await sql`select created, content from net._http_response where created > now() - interval '6 hours' and content like '{"part"%' order by created desc limit 300`; } catch (e) { ticks = []; }
  const byPart = {};
  for (const r of ticks) { let j; try { j = JSON.parse(r.content); } catch (e) { continue; } (byPart[j.part] = byPart[j.part] || []).push({ at: r.created, j }); }
  for (const part of ['hubspot', 'sync']) {
    const runs = byPart[part];
    if (runs && runs.length && now - new Date(runs[0].at).getTime() > 20 * 60e3) out.push({ key: 'part_silent_' + part, title: 'The ' + part + ' part of the tick has not answered for ' + Math.round((now - new Date(runs[0].at).getTime()) / 60e3) + ' minutes', detail: 'Check pg_cron job my-fifty-tick-' + part + ' in Supabase v2 and the Vercel logs.' });
  }
  const STEPS = { core: ['meta'], hubspot: ['hubspot'], sync: ['signatureapi', 'gmail'], all: ['meta', 'hubspot', 'signatureapi', 'gmail'] };
  for (const [part, runs] of Object.entries(byPart)) {
    for (const k of STEPS[part] || []) {
      const errs = runs.slice(0, 3).map((r) => r.j[k] && r.j[k].error).filter(Boolean);
      if (runs.length >= 3 && errs.length === 3 && errs.every((e) => e === errs[0])) out.push({ key: 'part_failing_' + k, title: 'The ' + k + ' step has failed 3 times running: ' + String(errs[0]).slice(0, 120), detail: 'From the ' + part + ' part of the 5-minute tick.' });
    }
  }
  return out;
}

async function check(sql, opts = {}) {
  const found = await findings(sql, opts.now);
  if (!found.length) return { ok: true };
  const [row] = await sql`select value from settings where key = 'alarms_sent'`;
  const sent = Object.assign({}, (row && row.value) || {});
  const due = found.filter((a) => !sent[a.key] || Date.now() - new Date(sent[a.key]).getTime() > RESEND_H * 3600e3);
  const url = process.env.N8N_ALARM_URL;
  if (!due.length) return { alarms: found.map((a) => a.key), sent: 0 };
  if (!url) return { alarms: found.map((a) => a.key), sent: 0, why: 'N8N_ALARM_URL not set' };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Edge-ISF': process.env.PULSE_ISF_KEY || '' },
    body: JSON.stringify({ to: TO, subject: 'Pulse data alarm: ' + due.map((a) => a.title).join('; ').slice(0, 150), alarms: due }) }).catch((e) => ({ ok: false, status: e.message }));
  if (!r.ok) return { alarms: found.map((a) => a.key), sent: 0, error: 'alarm_send_' + r.status };
  for (const a of due) sent[a.key] = new Date().toISOString();
  await sql`insert into settings (key, value) values ('alarms_sent', ${sql.json(sent)}) on conflict (key) do update set value = excluded.value`;
  return { alarms: found.map((a) => a.key), sent: due.length };
}

module.exports = { check, findings, torontoNow };
