// Test run 2026-10-21: fake outside services for a local server (preload AFTER no-network.js).
// Answers like the real ones would, for made-up hosts only; anything else still goes to the guard (and is refused).
//   n8n.demo.invalid             the n8n order branch: 200 {"ok":true}, or FAKE_N8N=500 / timeout
//   generativelanguage.googleapis.com   Gemini: a voice-note draft (FAKE_GEMINI=junk gives text that is not JSON)
//   oauth2.googleapis.com, gmail.googleapis.com   Gmail: a token, a sent message
'use strict';
const guarded = global.fetch;
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
global.__FAKE_CALLS__ = [];
global.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
  if (host === 'n8n.demo.invalid') {
    global.__FAKE_CALLS__.push({ url, body: init && init.body });
    if (process.env.FAKE_N8N === '500') return reply(500, 'Workflow failed');
    if (process.env.FAKE_N8N === 'timeout') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return reply(200, { ok: true, queued: true });
  }
  if (host === 'generativelanguage.googleapis.com') {
    global.__FAKE_CALLS__.push({ url });
    if (process.env.FAKE_GEMINI === 'junk') return reply(200, { candidates: [{ content: { parts: [{ text: 'Sorry, I could not do that.' }] } }] });
    const out = { note: 'Visited the clinic; she wants to try Saypha Lips next month.', nextStep: 'Bring two saypha lips samples', followUpDate: '', transcript: 'visited the clinic she wants to try saypha lips next month' };
    return reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
  }
  if (host === 'oauth2.googleapis.com') return reply(200, { access_token: 'fake-access-token', expires_in: 3600 });
  if (host === 'gmail.googleapis.com') return reply(200, { id: 'fake-msg-1', threadId: 'fake-thread-1' });
  return guarded(input, init);
};
