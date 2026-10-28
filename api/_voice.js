// Voice notes (L3 "Say what happened and the next step"): the rep talks, Gemini writes the note and the next step.
//
// Yousef 2026-10-20: "we also want to include context data regarding the specific customer and clinic to ensure
// that any dictation mistakes dont impact the quality of the notes & next steps." So the prompt carries who the
// note is about (name, clinic, role, city), what they use and buy, the last few things logged, the rep's name and
// our product names, and Gemini is told to correct misheard names and products against that, never to invent.
//
// Nothing is saved to the person's history here: the draft comes back for the rep to read and change, and only
// Save in the Log sheet writes the interaction. The draft itself is kept in ai_outputs (kind voice_note), as the
// data model asks for every AI result (SOP section 4).
const gemini = require('./_gemini');
const T = require('./_time');
const { fail, clean } = require('./_http');

const MAX_AUDIO_B64 = 3600000;   // about 2.7 MB of sound; the platform refuses bodies over 4.5 MB
const MIMES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/m4a', 'audio/x-m4a'];
// Labels for the new and the old list names (v2 part B renames them; api/_lists.js).
const ROLE = { physician: 'physician', injector: 'injector', dentist: 'dentist', manager: 'manager', other: '', nurse_injector: 'injector', clinic_owner: 'manager' };
const FILLER = { saypha: 'saypha', juvederm: 'Juvéderm', restylane: 'Restylane', teoxane_rha: 'Teoxane (RHA)', belotero: 'Belotero', revanesse: 'Revanesse', stylage: 'Stylage', yvoire: 'Yvoire', other: 'another filler', none: '' };
const PRP = { eclipse_prp: 'Eclipse PRP', regenlab: 'RegenLab', arthrex_prf: 'Arthrex PRF', exprecell_prf: 'Exprecell PRF', alyssamed: 'AlyssaMed', cellenis: 'Cellenis', world_prp: 'World PRP',
  naturagel: 'NaturaGel', other: 'another PRP system', none: '', arthrex_angel: 'Arthrex PRF', exprecell: 'Exprecell PRF', emcyte: 'EmCyte' };

const SCHEMA = { type: 'OBJECT', properties: { note: { type: 'STRING' }, nextStep: { type: 'STRING' }, followUpDate: { type: 'STRING' }, transcript: { type: 'STRING' } },
  required: ['note', 'nextStep', 'followUpDate', 'transcript'] };

// Everything we know that helps hear the recording right.
async function context(sql, me, contactId) {
  const [c] = await sql`
    select c.first_name, c.last_name, c.role::text, c.fillers_used::text[] as fillers, c.prp_used::text[] as prp,
           cl.name as clinic, coalesce(c.shipping_city, cl.city) as city
      from contacts c left join clinics cl on cl.id = c.clinic_id
     where c.id = ${contactId} and c.owner_id = ${me.id} and c.deleted_at is null`;
  if (!c) throw fail(404, 'not_found');
  const others = await sql`
    select first_name, last_name, role::text from contacts
     where clinic_id = (select clinic_id from contacts where id = ${contactId}) and id <> ${contactId} and deleted_at is null
       and owner_id = ${me.id} limit 8`;   // only people in this rep's own book (never another rep's clients)
  const recent = await sql`
    select kind::text, occurred_at, left(coalesce(body, subject, ''), 300) as body from interactions
     where contact_id = ${contactId} and deleted_at is null and coalesce(body, subject, '') <> '' order by occurred_at desc limit 4`;
  const lines = await sql`
    select distinct l.product_name from order_lines l join orders o on o.id = l.order_id where o.contact_id = ${contactId} and o.deleted_at is null limit 12`;
  const products = await sql`select name from products where is_active = ${true} order by name`;
  return { c, others, recent, lines, products };
}

function prompt(me, x) {
  const c = x.c;
  const who = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const facts = [
    'Person: ' + who + (ROLE[c.role] ? ', ' + ROLE[c.role] : ''),
    c.clinic ? 'Clinic: ' + c.clinic + (c.city ? ' (' + c.city + ')' : '') : '',
    x.others.length ? 'Other people at this clinic: ' + x.others.map((o) => [o.first_name, o.last_name].filter(Boolean).join(' ')).join(', ') : '',
    (c.fillers || []).length ? 'Fillers they use: ' + c.fillers.map((f) => FILLER[f] || f).join(', ') : '',
    (c.prp || []).length ? 'PRP / PRF they use: ' + c.prp.map((f) => PRP[f] || f).join(', ') : '',
    x.lines.length ? 'Products they have bought or received: ' + x.lines.map((l) => l.product_name).join('; ') : '',
    x.recent.length ? 'Recent notes:\n' + x.recent.map((r) => '- ' + T.short(r.occurred_at) + ' (' + r.kind + '): ' + r.body.replace(/\s+/g, ' ')).join('\n') : '',
  ].filter(Boolean).join('\n');
  return 'This is a voice note recorded by ' + (me.name || 'a sales rep') + ', a sales rep at Renellence (aesthetic fillers, cannulas, needles, '
    + 'skin care and PRP systems sold to clinics in Canada), right after a call, visit or text with a client.\n\n'
    + 'What we know about the client (use it ONLY to spell names, clinics and products correctly when the recording '
    + 'is unclear or a word was misheard, e.g. "say far" is saypha; never add facts from it that the rep did not say):\n' + facts + '\n\n'
    + 'Our product names: ' + x.products.map((p) => p.name).join('; ') + '. Also: saypha lips, saypha volume, saypha volume plus, '
    + 'saypha filler, Magic Needle cannulas, Mesbio needles, Exprecell. Write "saypha" and its product names in lower case.\n\n'
    + 'Return:\n'
    + '- "note": what happened, 1 to 4 short sentences in the first person, in the language the rep spoke. Only what was said.\n'
    + '- "nextStep": the follow-up the rep said they will do, one short line, or "".\n'
    + '- "followUpDate": that follow-up as YYYY-MM-DD if a day was said (today is ' + T.ymd() + ', ' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][T.weekday(T.ymd())] + ', Toronto), else "".\n'
    + '- "transcript": what was said, word for word, with names and products spelled correctly.\n'
    + 'If the recording is silent or cannot be understood, return every field as "".';
}

// "saypha" and its product names are always lower case (only Lidocaine is capitalised), whatever the model wrote.
const brand = (s) => String(s || '').replace(/\bsaypha(®?)((?:\s+(?:volume\s+plus|volume|lips|filler))?)/gi, (m) => m.toLowerCase());

async function transcribe(sql, me, body, deps) {
  const gem = (deps && deps.gemini) || gemini;
  // 409, not 503: route() turns every 5xx into a bare "server_error" (test run F9), so the app could never show its
  // "Voice notes aren't set up yet" message. Found 2026-10-23 when a new op moved the random-input test onto it.
  if (!gem.available()) throw fail(409, 'voice_not_set_up');
  const audio = String((body && body.audio) || '');
  const mime = String((body && body.mime) || '').split(';')[0].trim().toLowerCase();
  if (!audio || !/^[A-Za-z0-9+/=]+$/.test(audio.slice(0, 2000))) throw fail(400, 'no_audio');
  if (audio.length > MAX_AUDIO_B64) throw fail(413, 'recording_too_long');
  if (!MIMES.includes(mime)) throw fail(400, 'bad_audio_type');
  const x = await context(sql, me, body.contactId);
  const out = await gem.json(prompt(me, x), { schema: SCHEMA, audio: { mime, data: audio }, timeoutMs: 40000, fallbackModel: 'gemini-2.5-flash-lite' });
  const okDate = (d) => { const s = clean(d, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= T.ymd() ? s : ''; };
  let draft = { note: brand(clean(out && out.note, 3000)), nextStep: brand(clean(out && out.nextStep, 300)),
    followUpDate: okDate(out && out.followUpDate), transcript: brand(clean(out && out.transcript, 6000)) };
  let model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  // Owner 2026-10-28: Gemini hears it, Claude writes it (the Data Map's voice prompt, Supabase claude-jobs). When Claude
  // isn't set up, is slow or fails, Gemini's own draft above is kept, so the mic never stops working.
  const claude = (deps && deps.claude) || claudeVoice;
  if (draft.transcript) {
    const c = await claude({ contactId: body.contactId, transcript: draft.transcript, kind: body.kind, reached: body.reached, repName: me.name });
    if (c && c.ok && c.output && clean(c.output.note, 3000)) {
      draft = Object.assign(draft, { note: brand(clean(c.output.note, 3000)), nextStep: brand(clean(c.output.next_step, 300)),
        followUpDate: okDate(c.output.follow_up_date), flags: Array.isArray(c.output.flags) ? c.output.flags.slice(0, 5).map((f) => clean(f, 200)) : [] });
      model = c.model || 'claude';
    }
  }
  const [ai] = await sql`
    insert into ai_outputs (kind, contact_id, input_text, output_text, output_json, model_name, created_by_id)
    values ('voice_note', ${body.contactId}, ${draft.transcript}, ${draft.note}, ${sql.json(draft)}, ${model}, ${me.id})
    returning id`;
  return Object.assign({ aiOutputId: ai.id }, draft);
}

// The Supabase function claude-jobs (job "voice"). CLAUDE_JOBS_URL + CLAUDE_JOBS_SECRET in Vercel; null when either is
// missing or the call fails or takes over 25 s (the rep is waiting; Gemini's draft is used instead).
async function claudeVoice(payload) {
  const url = process.env.CLAUDE_JOBS_URL, secret = process.env.CLAUDE_JOBS_SECRET;
  if (!url || !secret) return null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Claude-Jobs-Secret': secret },
      body: JSON.stringify(Object.assign({ job: 'voice' }, payload)), signal: AbortSignal.timeout(25000) });
    return r.ok ? await r.json() : null;
  } catch (e) {
    console.error('VOICE_CLAUDE', e.message);
    return null;
  }
}

module.exports = { transcribe, context, _prompt: prompt };
