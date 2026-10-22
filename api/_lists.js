// The fixed lists for people (role, fillers, PRP/PRF), as the Edge redesign agreed them (Yousef 2026-10-21, v2
// part B). Part B renames values in the database; until it is applied the old names are still the only ones v2
// accepts. So My Fifty speaks the NEW names everywhere, reads old ones as their new names, and writes whichever
// name the database has right now (checked once a minute), which keeps it working before and after the switch.
//   role:   nurse_injector -> injector, clinic_owner -> manager
//   prp:    exprecell -> exprecell_prf, arthrex_angel -> arthrex_prf, emcyte removed (still shown if stored)
const ROLES = ['physician', 'injector', 'dentist', 'manager', 'other'];
// In the rules' order (Edge test-run rules section 1; Yousef 2026-10-22, LO).
const FILLERS = ['saypha', 'restylane', 'juvederm', 'belotero', 'teoxane_rha', 'revanesse', 'stylage', 'yvoire', 'other', 'none'];
const PRPS = ['exprecell_prf', 'arthrex_prf', 'alyssamed', 'regenlab', 'eclipse_prp', 'cellenis', 'world_prp', 'naturagel', 'other', 'none'];
const RENAMED = {
  contacts_role: { nurse_injector: 'injector', clinic_owner: 'manager' },
  contacts_prp_used: { exprecell: 'exprecell_prf', arthrex_angel: 'arthrex_prf' },
  contacts_fillers_used: {},
};
// Keyed by the list's type name in v2, <table>_<column> (db/v2-008, 2026-10-22: contacts_filler -> contacts_fillers_used,
// contacts_prp -> contacts_prp_used).
const LIST = { contacts_role: ROLES, contacts_fillers_used: FILLERS, contacts_prp_used: PRPS };

// An old or new name as its new name (unknown names are kept, so nothing stored is ever hidden).
const canon = (type, v) => (v == null ? v : (RENAMED[type] && RENAMED[type][v]) || v);
const canonAll = (type, list) => [...new Set((list || []).map((v) => canon(type, v)))];

// The values the database's list has right now (cached for a minute; part B changes them).
let cache = { at: 0, by: {} };
async function dbValues(sql, type) {
  if (Date.now() - cache.at > 60000) cache = { at: Date.now(), by: {} };
  if (!cache.by[type]) {
    const rows = await sql`select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = ${type}`;
    cache.by[type] = rows.map((r) => r.v);
  }
  return cache.by[type];
}
function forgetValues() { cache = { at: 0, by: {} }; }

// A value from the app (new or old name) as the name the database takes now; null if it isn't on the list.
async function toDb(sql, type, v) {
  const n = canon(type, v);
  if (!LIST[type].includes(n)) return null;
  const have = await dbValues(sql, type);
  if (have.includes(n)) return n;
  const old = Object.keys(RENAMED[type]).find((o) => RENAMED[type][o] === n && have.includes(o));
  return old || null;
}
// A picked list (fillers / PRP) for the database: known values only, no duplicates, and "none" only on its own.
async function listToDb(sql, type, values) {
  let picked = canonAll(type, Array.isArray(values) ? values : []).filter((v) => LIST[type].includes(v));
  if (picked.includes('none') && picked.length > 1) picked = picked.filter((v) => v !== 'none');
  const out = [];
  for (const v of picked) { const d = await toDb(sql, type, v); if (d && !out.includes(d)) out.push(d); }
  return out;
}

module.exports = { ROLES, FILLERS, PRPS, RENAMED, canon, canonAll, dbValues, toDb, listToDb, forgetValues };
