// info@ inbox leads (owner 2026-10-29: "make a claude job that watches info@Renellence for potential leads", including
// the website's New Account Application notices: "we want it to be like they fill in application and then we filter it
// by rep and send the rep the details").
//
// Each timer tick (api/cron.js, core part):
//   1. info@'s new inbox mail and the application notices it sent (its Gmail connection in Pulse; the last 2 days, each
//      message once). Robots, our own mail
//      and existing customers who have ordered are dropped in code; our own website notices (New Account Application
//      and other form notices sent from info@) are kept.
//   2. the rest go to Claude (Supabase claude-jobs, job "inbox"), which says which are potential new customers and
//      pulls out their details. When the email has no postal code Claude searches the web for the clinic's address
//      (owner 2026-10-29: "if the location is unclear, google it"). If Claude can't be reached nothing is marked done,
//      so the next tick tries again.
//   3. the rep is worked out here, in code, never by Claude: the person's owner when they are already in the book
//      (by email or phone), else the territory rules from the postal code (api/_territory.js), else the province or
//      city (BC / Alberta / Quebec). A shared postal area goes to both reps. No rep found -> info@, to assign by hand.
//   4. the rep gets the details by email from info@ (Gmail, as Pulse's Email button sends).
// What was done is kept in settings 'inbox_leads' {seen: [gmail ids], log: [last 50 leads]}. Off switch: flags inbox_leads.
const G = require('./_gmail');
const T = require('./_territory');
const { open } = require('./_crypto');

const INFO = 'info@renellence.com';
const OURS = /@renellence\.com$/i;
// Our own website and form notices from info@ that carry someone else's details (New Account Application etc.).
const NOTICE = /account application|application|submission|enquiry|inquiry|interest form|contact form|sign[- ]?up|registration|register/i;
const MAX_SEEN = 600, MAX_LOG = 50, BATCH = 5;
// Our own alerts must never be read back as leads (2026-10-29: info@'s Sent copy of "New account application: Refresh MD
// Spa" matched the application search, so every tick emailed Emily the same lead again). They carry Pulse's Message-ID.
const OUR_ALERT = /^(new lead|new account application|no rep found, please assign):/i;
const PULSE_MSG = /@myfifty\.renellence\.com>?$/i;
// One email per lead: the same applicant (email) or clinic again within 30 days (a forward, a resubmitted form) is skipped.
const REPEAT_DAYS = 30;
const leadKey = (res, m) => {
  const e = String(res.email || '').trim().toLowerCase();
  if (e && !OURS.test(e)) return 'e:' + e;
  const c = String(res.clinic || res.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return c ? 'c:' + c : 'm:' + String(m.subject || '').toLowerCase();
};   // 5 a tick: web searches take time
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const first = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();

async function state(sql) {
  const [r] = await sql`select value from settings where key = 'inbox_leads'`;
  const v = (r && r.value) || {};
  return { seen: Array.isArray(v.seen) ? v.seen : [], log: Array.isArray(v.log) ? v.log : [], sent: v.sent && typeof v.sent === 'object' ? v.sent : {}, fresh: !r };
}
async function save(sql, st) {
  const cut = Date.now() - REPEAT_DAYS * 864e5;
  const sent = Object.fromEntries(Object.entries(st.sent || {}).filter(([, at]) => new Date(at).getTime() > cut));
  const value = { seen: st.seen.slice(-MAX_SEEN), log: st.log.slice(-MAX_LOG), sent };
  await sql`insert into settings (key, value, updated_at) values ('inbox_leads', ${sql.json(value)}, now())
            on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

// The person, if already in the book: by any of the addresses or the phone. Owner + whether they have ordered.
async function known(sql, emails, phone) {
  const list = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))].filter((e) => !OURS.test(e));
  const ph = digits(phone);
  if (!list.length && ph.length < 10) return null;
  const [c] = await sql`
    select c.id, c.first_name, c.last_name, u.full_name as owner, u.email as owner_email, u.is_active as owner_active,
           exists (select 1 from orders o where o.contact_id = c.id and o.deleted_at is null) as ordered
      from contacts c left join users u on u.id = c.owner_id
     where c.deleted_at is null and c.merged_into_contact_id is null
       and ((cardinality(${list}::text[]) > 0 and (lower(c.email::text) = any(${list}) or lower(c.secondary_email::text) = any(${list})))
         or (${ph.length === 10} and (right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10) = ${ph}
                                   or right(regexp_replace(coalesce(c.mobile_phone, ''), '\\D', '', 'g'), 10) = ${ph})))
     order by ordered desc, c.created_at limit 1`;
  return c || null;
}

// The reps a lead goes to: [{email, name}] plus why. reps = active rep users.
function route(lead, person, reps) {
  // Rules name reps the short way ("Sam"): match the first name or the email's (sam.almas@).
  const byFirst = new Map();
  for (const r of reps) { byFirst.set(first(r.full_name), r); byFirst.set(String(r.email).split('@')[0].split('.')[0].toLowerCase(), r); }
  const pick = (names) => names.map((n) => byFirst.get(first(n))).filter(Boolean);
  if (person && person.owner_email && person.owner_active !== false && reps.some((r) => r.email === person.owner_email)) {
    return { to: [{ email: person.owner_email, name: person.owner }], why: 'already in your book' };
  }
  const fsa = T.fsaOf(lead.postal);
  const rule = fsa ? T.ruleFor(fsa) : T.placeRule(lead.province, lead.city);
  if (rule) {
    const to = pick(rule.reps);
    if (to.length) return { to: to.map((r) => ({ email: r.email, name: r.full_name })),
      why: (fsa ? `postal area ${fsa}` : rule.place || 'province') + ` (${rule.area})` + (to.length > 1 ? ', a shared area' : '') };
  }
  return { to: [], why: fsa ? `postal area ${fsa} has no rep` : 'no postal code or province to go by' };
}

function details(lead, m, r) {
  const line = (k, v) => (v ? `${k}: ${v}\n` : '');
  return [
    `${lead.kind === 'application' ? 'New account application' : 'New lead'} from the info@ inbox.\n`,
    line('Clinic', lead.clinic) + line('Name', lead.name) + line('Email', lead.email) + line('Phone', lead.phone)
      + line('City', [lead.city, lead.province].filter(Boolean).join(', ')) + line('Postal code', lead.postal)
      + (lead.location_source === 'web' && lead.location_url ? `(The address was not in the email; found online: ${lead.location_url})\n` : '')
      + line('Registration #', lead.registration) + line('Wants', lead.wants),
    lead.summary ? `\n${lead.summary}\n` : '',
    `\nWhy you: ${r.why}.`,
    r.to.length > 1 ? `\nAlso sent to ${r.to.map((x) => x.name).join(' and ')}; agree between you who takes it.` : '',
    `\n\nThe email it came from: "${m.subject}" from ${m.from}, ${m.date}.\n---\n${String(m.body || '').slice(0, 1500)}`,
  ].join('');
}

async function askClaude(emails, timeoutMs) {
  const url = process.env.CLAUDE_JOBS_URL, secret = process.env.CLAUDE_JOBS_SECRET;
  if (!url || !secret) return { error: 'claude_jobs_not_set' };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Claude-Jobs-Secret': secret },
      body: JSON.stringify({ job: 'inbox', emails }), signal: AbortSignal.timeout(Math.max(10000, timeoutMs)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !Array.isArray(j.results)) return { error: j.error || j.skipped || j.stopped || j.blocked || `claude_jobs_${r.status}` };
    return j;
  } catch (e) { return { error: e.message }; }
}

async function run(sql, budgetMs = 45000) {
  const end = Date.now() + budgetMs;
  if (!(await require('./_flags').on(sql, 'inbox_leads'))) return { off: true };
  if (budgetMs < 40000) return { skipped: 'no_time' };   // Claude may search the web: the next tick has the time
  const [box] = await sql`select c.credentials_encrypted, u.id as user_id, u.full_name from connections c join users u on u.id = c.user_id
    where c.provider = 'gmail' and c.status = 'connected' and lower(u.email) = ${INFO} order by c.updated_at desc limit 1`;
  if (!box) return { skipped: 'info_gmail_not_connected' };
  const st = await state(sql);
  const seen = new Set(st.seen);
  const at = await G._.accessToken(open(box.credentials_encrypted));
  // First run: today's mail only. After that the last 2 days, each message once (seen).
  // The website's New Account Application notice is sent FROM info@ to staff (found 2026-10-29: to Emily, Aria and
  // Caterina), so in info@'s mailbox it is only in Sent: read those as well as the inbox.
  const q = `{in:inbox subject:"account application"} ${st.fresh ? 'newer_than:1d' : 'newer_than:2d'}`;
  const l = await G._.gget(at, 'messages?maxResults=50&q=' + encodeURIComponent(q));
  const ids = ((l && l.messages) || []).map((x) => x.id).filter((id) => !seen.has(id)).reverse();
  const out = { new: ids.length, candidates: 0, leads: 0, sent: 0, unassigned: 0 };
  const cands = [], done = [];
  for (const id of ids) {
    if (Date.now() > end - 35000 || cands.length >= BATCH) break;
    const m = await G._.gget(at, 'messages/' + id + '?format=full');
    done.push(id);
    if (!m || (m.labelIds || []).some((x) => x === 'SPAM' || x === 'TRASH' || x === 'DRAFT')) continue;
    const from = G._.addrs(G._.hdr(m, 'From')), subject = G._.hdr(m, 'Subject');
    const body = G._.bodyText(m.payload) || m.snippet || '';
    const ours = from.some((a) => OURS.test(a));
    if (PULSE_MSG.test(G._.hdr(m, 'Message-ID')) || (ours && OUR_ALERT.test(subject.trim()))) continue;   // our own lead alerts
    if (ours && !NOTICE.test(subject)) continue;                 // our own mail, not a form notice
    if (!ours && from.some((a) => G._.ROBOT.test(a))) continue;  // robots and newsletters
    const person = ours ? null : await known(sql, from, '');
    if (person && person.ordered) continue;                      // an existing customer, not a new lead
    cands.push({ id, m: { from: G._.hdr(m, 'From'), to: G._.hdr(m, 'To'), subject, date: G._.hdr(m, 'Date'), body },
      known: person ? `in our book, owner ${person.owner || 'nobody'}, has not ordered yet` : '' });
  }
  out.candidates = cands.length;
  if (cands.length) {
    const a = await askClaude(cands.map((c, i) => ({ code: 'e' + (i + 1), from: c.m.from, to: c.m.to, subject: c.m.subject, date: c.m.date,
      body: c.m.body.slice(0, 4000), known: c.known })), end - Date.now() - 3000);
    if (a.error) { out.error = a.error; return out; }           // nothing marked done: the next tick tries again
    out.costUsd = a.costUsd;
    const reps = await sql`select email, full_name from users where kind = 'rep' and is_active is not false`;
    for (const res of a.results) {
      const c = cands[Number(String(res.code).slice(1)) - 1];
      if (!c || !res.lead) continue;
      out.leads++;
      const person = await known(sql, [res.email].concat(G._.addrs(c.m.from)), res.phone);
      if (person && person.ordered) continue;
      const key = leadKey(res, c.m);
      if (st.sent[key]) { out.repeats = (out.repeats || 0) + 1; continue; }   // already sent to the rep: never again
      const r = route(res, person, reps);
      const to = r.to.length ? r.to : [{ email: INFO, name: 'info@' }];
      if (!r.to.length) out.unassigned++;
      const who = res.clinic || res.name || res.email || 'someone new';
      const subject = (r.to.length ? '' : 'No rep found, please assign: ') + (res.kind === 'application' ? 'New account application: ' : 'New lead: ') + who;
      let sent = 0;
      for (const t of to) {
        try { await G.send(sql, { id: box.user_id, email: INFO, name: 'Renellence' }, { to: t.email, subject, text: details(res, c.m, r) }); sent++; } catch (e) {
          console.error('INBOX_LEADS_SEND', t.email, e.message);
        }
      }
      out.sent += sent;
      st.log.push({ at: new Date().toISOString(), gmail: c.id, kind: res.kind, who, to: to.map((t) => t.email), why: r.why, sent,
        location: res.location_source || '' });
      st.seen.push(c.id);
      st.sent[key] = new Date().toISOString();
      await save(sql, st);   // after every lead, so a cut-off run never sends the same lead twice
    }
  }
  st.seen = st.seen.concat(done);
  await save(sql, st);
  return out;
}

module.exports = { run };
// Exposed for the unit tests only.
module.exports._ = { route, details, NOTICE, known, leadKey, OUR_ALERT };
