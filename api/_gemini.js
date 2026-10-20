// Google Gemini, used for one thing in My Fifty: turning a rep's spoken note (L3 "Tap the mic and talk") into a
// written note and next step (api/_voice.js). Copied from Edge (renellence-edge/api/_gemini.js), same key.
// Purpose: one small, defensive call - a prompt (and optionally a sound clip) in, a JSON object out.
// Inputs:  env GEMINI_API_KEY (Google AI Studio). Optional GEMINI_MODEL (default below).
// Outputs: json(...) resolves the parsed object, or throws { code } - callers always have a fallback.
//
// Nothing works, and nothing is sent anywhere, until GEMINI_API_KEY is set: available() is false and the
// callers fall back (keyword rules for calls; the voice button is not offered).
//
// What leaves Edge: the text handed to json() - call summaries, or a recording the rep chose to make. On
// Google's FREE tier that content may be used to improve their products; on a billed key it is not (their
// pricing page). Use a billed key for customer data.
const MODEL = () => String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
const KEY = () => String(process.env.GEMINI_API_KEY || '').trim();
const available = () => !!KEY();

// The text of an answer, wherever this API version puts it.
function textOf(j) {
  try {
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const t = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    if (t) return t;
  } catch (e) { /* fall through */ }
  if (typeof j.output_text === 'string' && j.output_text) return j.output_text;
  if (Array.isArray(j.outputs)) { const t = j.outputs.map((o) => (o && typeof o.text === 'string' ? o.text : '')).join(''); if (t) return t; }
  return '';
}
function parseJson(t) {
  const s = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch (e) { /* try the first {...} or [...] in it */ }
  const m = s.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* give up below */ } }
  const err = new Error('gemini_bad_json'); err.code = 502; throw err;
}

// prompt: string. opts: { schema, audio: { mime, data(base64) }, images: [{ mime, data(base64) }], timeoutMs, model, fallbackModel, config (extra generationConfig), fetch (tests) }.
// Google's models are sometimes briefly overloaded (503) or slow: one retry, on opts.fallbackModel when given.
async function json(prompt, opts) {
  const o = opts || {};
  if (!available()) { const e = new Error('gemini_not_configured'); e.code = 503; throw e; }
  try { return await once(prompt, o, o.model || MODEL()); }
  catch (e) {
    const again = e && (e.message === 'gemini_503' || e.message === 'gemini_500' || e.message === 'gemini_timeout' || e.message === 'gemini_unreachable');
    if (!again || o.noRetry) throw e;
    return once(prompt, o, o.fallbackModel || o.model || MODEL());
  }
}
async function once(prompt, o, model) {
  const parts = [{ text: String(prompt || '') }];
  if (o.audio && o.audio.data) parts.push({ inline_data: { mime_type: String(o.audio.mime || 'audio/webm'), data: String(o.audio.data) } });
  // Pictures to look at, in order (the New ad form's image check, api/_adsai.js).
  (o.images || []).forEach((im) => { if (im && im.data) parts.push({ inline_data: { mime_type: String(im.mime || 'image/jpeg'), data: String(im.data) } }); });
  const body = { contents: [{ role: 'user', parts }], generationConfig: Object.assign({ temperature: 0, responseMimeType: 'application/json' }, o.schema ? { responseSchema: o.schema } : {}, o.config || {}) };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 25000);
  let r, txt;
  try {
    r = await (o.fetch || fetch)('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY() }, body: JSON.stringify(body), signal: ctl.signal });
    txt = await r.text();
  } catch (e) { const err = new Error(e && e.name === 'AbortError' ? 'gemini_timeout' : 'gemini_unreachable'); err.code = 504; throw err; }
  finally { clearTimeout(timer); }
  let j = {}; try { j = JSON.parse(txt); } catch (e) { j = {}; }
  if (!r.ok) {
    const err = new Error(r.status === 429 ? 'gemini_rate_limited' : 'gemini_' + r.status); err.code = r.status === 429 ? 429 : 502;
    err.detail = String(((j.error || {}).message) || txt).slice(0, 300);
    throw err;
  }
  return parseJson(textOf(j));
}

module.exports = { available, json, _textOf: textOf, _parseJson: parseJson, _model: MODEL };
