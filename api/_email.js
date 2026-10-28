// An email as History shows it (owner 2026-10-28: "we need to fix emails logging like this, i want it to be more pretty"):
// only what was written this time. The quoted thread ("On ... wrote:", "> ..." lines, "From: ... Sent: ..." blocks), the
// signature (from the sign-off: "Warmly," "Best," ... keeping the sign-off and the name under it), signature images,
// the HubSpot "Prefer fewer emails" footer and tracking links are left out; "Text<https://...>" and "Text: https://..."
// read as just "Text"; a bare link reads as its site ("hubspot.com"); runs of blank lines become one. The full email is
// still there (History's "Show the whole email"). Pure; tested in test/unit/email.test.js.
'use strict';

const SIGN_OFF = /^(warmly|warm regards|best|best regards|kind regards|regards|thanks|thank you|many thanks|cheers|sincerely|all the best|talk soon|xo)[,.!]?\s*$/i;
const QUOTE_HEAD = [
  /^\s*On\b.{0,200}\bwrote:\s*$/i,                      // On Tue, Oct 20, 2026 ... wrote:
  /^\s*Le\b.{0,200}\ba écrit\s*:\s*$/i,                   // French clients
  /^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i,
  /^\s*From:\s.+$/i,                                      // Outlook: From: / Sent: / To: / Subject:
  /^\s*>/,                                                // the first quoted line
  /^\s*Sent from my (iPhone|iPad|Android|mobile)/i,
];
const FOOTER = /prefer fewer emails|unsubscribe|hs-sales-(sub|engage)\.com|manage (your )?preferences/i;

function site(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; }
}

function cleanEmail(text) {
  const all = String(text || '').replace(/\r\n?/g, '\n');
  let lines = all.split('\n');
  // 1. Stop at the quoted thread. "On ... wrote:" can be split over two lines by the mail app.
  for (let i = 0; i < lines.length; i++) {
    const two = lines[i] + ' ' + (lines[i + 1] || '');
    if (QUOTE_HEAD.some((r) => r.test(lines[i])) || (/^\s*On\b/i.test(lines[i]) && /\bwrote:\s*$/i.test(two) && !/wrote:/i.test(lines[i]))) {
      // Outlook's "From:" only counts when "Sent:" or "Date:" follows within three lines (a "From:" in the text stays).
      if (/^\s*From:/i.test(lines[i]) && !lines.slice(i + 1, i + 4).some((l) => /^\s*(Sent|Date):/i.test(l))) continue;
      lines = lines.slice(0, i);
      break;
    }
  }
  // 2. The signature: from the last sign-off, keep it and the next non-empty line (the name), drop the rest.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SIGN_OFF.test(lines[i].trim())) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const name = j < lines.length && lines[j].trim().length <= 60 && !/https?:|@/.test(lines[j]) ? lines[j].trim() : '';
      lines = lines.slice(0, i).concat([lines[i].trim() + (name ? '\n' + name : '')]);
      break;
    }
  }
  // 3. The "-- " signature line and anything after it; footers anywhere.
  const dash = lines.findIndex((l) => /^--\s*$/.test(l));
  if (dash >= 0) lines = lines.slice(0, dash);
  lines = lines.filter((l) => !FOOTER.test(l));
  let out = lines.join('\n')
    .replace(/\[(?:cid:|https?:\/\/)[^\]]*\]/g, '')                               // [image] / [https://...signature image]
    .replace(/([^\s<>:][^<>\n]*?)\s*<(?:https?:\/\/|mailto:)[^>]+>/g, '$1')        // Text<https://...> -> Text
    .replace(/([^\s:][^:\n]*?):\s*(?:https?:\/\/|mailto:)\S+/g, '$1')            // Text: https://... -> Text
    .replace(/https?:\/\/\S+/g, (u) => site(u.replace(/[).,]+$/, '')))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!out) out = all.trim();
  return out;
}

// What History shows for an email: { subject, body, full } (full only when something was left out).
function forHistory(subject, body) {
  const clean = cleanEmail(body);
  const full = String(body || '').trim();
  return { subject: String(subject || '').trim(), body: clean, full: clean.replace(/\s+/g, ' ') !== full.replace(/\s+/g, ' ') ? full.slice(0, 8000) : '' };
}

module.exports = { cleanEmail, forHistory };
