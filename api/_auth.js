// Who is signed in.
//
// Sign-in is Supabase Auth with Google (Yousef 2026-10-20: "Google, @renellence.com"). The browser sends the
// Supabase access token as "Authorization: Bearer <token>"; it is checked with Supabase itself
// (GET /auth/v1/user), so nothing here needs the JWT secret. The person must:
//   - have a verified @renellence.com Google address, and
//   - have an active row in v2's `users` table (matched by auth_user_id, or by email the first time,
//     which then links auth_user_id).
// Anyone else gets 403 not_set_up: being in the Google Workspace is not enough to see the book.
// Head office (users.kind = 'head_office') doesn't use Pulse (Yousef 2026-10-23): 403 reps_only, and the app shows a polite
// "Pulse is for reps" screen. Admins keep their access (they see the whole company).
const { db } = require('./_db');

const SUPABASE_URL = () => String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = () => String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
const DOMAIN = /@renellence\.com$/i;

const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };

// A token checked in the last few minutes is not checked again (one function instance serves many requests).
const seen = new Map();
const TTL = 5 * 60 * 1000;

async function supabaseUser(token) {
  const hit = seen.get(token);
  if (hit && hit.at > Date.now() - TTL) return hit.user;
  const r = await fetch(SUPABASE_URL() + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + token, apikey: ANON() } });
  if (!r.ok) return null;
  const user = await r.json();
  if (seen.size > 500) seen.clear();
  seen.set(token, { at: Date.now(), user });
  return user;
}

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// -> { id, email, name, first, initials, kind, settings, authUserId } or throws { status }.
async function signedIn(req) {
  const token = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw fail(401, 'signed_out');
  const u = await supabaseUser(token).catch(() => null);
  if (!u || !u.id) throw fail(401, 'signed_out');
  const email = String(u.email || '').toLowerCase();
  if (!DOMAIN.test(email) || (u.user_metadata && u.user_metadata.email_verified === false)) throw fail(403, 'not_renellence');
  const sql = db();
  let [row] = await sql`select id, email, full_name, kind, is_active, preferences, auth_user_id from users where auth_user_id = ${u.id}`;
  if (!row) {
    [row] = await sql`select id, email, full_name, kind, is_active, preferences, auth_user_id from users where lower(email) = ${email}`;
    // Linked only for someone who may sign in; a switched-off account stays unlinked.
    if (row && row.is_active !== false && !row.auth_user_id) await sql`update users set auth_user_id = ${u.id} where id = ${row.id}`;
  }
  if (!row || row.is_active === false) throw fail(403, 'not_set_up');
  if (row.kind === 'head_office') throw fail(403, 'reps_only');
  return { id: row.id, email: row.email, name: row.full_name || email, first: String(row.full_name || email).split(/\s+/)[0],
    initials: initials(row.full_name || email), kind: row.kind, preferences: row.preferences && typeof row.preferences === 'object' && !Array.isArray(row.preferences) ? row.preferences : {}, authUserId: u.id };
}

module.exports = { signedIn, initials, SUPABASE_URL, ANON };
// Exposed for the unit tests only.
module.exports._ = { supabaseUser, seen };
