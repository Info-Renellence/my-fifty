// Feature switches (data map risk #3, 2026-10-23): one settings row, key 'flags', a JSON object of on/off switches that
// Pulse and Edge both read (Edge's own reader: renellence-edge api/_edge/flags.js). Turning one off hides that feature
// for everyone within a minute, with no deploy (renellence-ops/ops/release/flags.js sets them; RELEASE.md says how).
//
// This is NOT a shared copy: each app keeps its own reader.
//
// Defaults: a feature that is already live is ON, a feature not built yet is OFF. So a missing row, a missing key, a
// value that is not true/false, or a database that cannot be read all leave reps exactly where they were.
//   week_view           Pulse Today: this week's focus, visits and calls (Compass weekly 1-on-1)          live -> on
//   voice_notes         Pulse log sheet: "Talk instead" / the mic -> a written note                       live -> on
//   order_dispatch      the tracked dispatch / retry path (api/_dispatch.js). This is only a kill switch:
//                       the path still needs its own settings row order_dispatch.pulse / .edge (OFF by
//                       default). Off here = the old send, whatever order_dispatch says.                  on (defers)
//   claude_suggestions  future Claude suggestions (not built yet)                                         off
//   friday_checkin      Edge's Friday Check In tab (read by Edge; listed so both apps agree)              live -> on
'use strict';

//   hubspot_pull        the timer's HubSpot -> v2 read (api/intake.js sync): the safety net while live Edge's own
//                       copies (renellence-edge main api/_mirror.js) are proven; off once they are             on
//   edge_alerts         the timer's visit reminders and new order / RSVP alerts (api/cron.js appAlerts), live Edge's alerts on
//                       v2; off until the Edge cut-over, so info@ is not told twice (owner 2026-10-28)           not yet -> off
//   inbox_leads         the timer's info@ inbox leads -> the territory rep by email (api/_inboxleads.js, owner 2026-10-29) live -> on
const DEFAULTS = Object.freeze({ week_view: true, voice_notes: true, order_dispatch: true, claude_suggestions: false, friday_checkin: true, hubspot_pull: true, edge_alerts: false, inbox_leads: true });
const TTL_MS = 30 * 1000;   // a switch flipped in the database is seen within 30 seconds

let cache = null;   // { at, flags }

// The stored row merged over the defaults; only true/false values count.
function merge(value) {
  const out = Object.assign({}, DEFAULTS);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of Object.keys(value)) if (typeof value[k] === 'boolean') out[k] = value[k];
  }
  return out;
}

// All switches. sql: the plain connection or a transaction. Never throws: a read problem = the defaults.
async function all(sql) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.flags;
  let flags;
  try {
    const [row] = await sql`select value from settings where key = ${'flags'}`;
    flags = merge(row && row.value);
  } catch (e) {
    flags = merge(null);
  }
  cache = { at: Date.now(), flags };
  return flags;
}

async function on(sql, name) {
  const f = await all(sql);
  return f[name] === true;
}

function clear() { cache = null; }

module.exports = { DEFAULTS, TTL_MS, all, on, merge, clear };
