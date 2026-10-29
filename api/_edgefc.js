// Live Edge (main) forecasts -> v2 (owner 2026-10-29: "if they make a new forecast on old edge will it show on pulse and
// new edge" ... "do #2, its necessary for now"). Live Edge keeps a rep's forecasts in its own key-value store
// (territory:<rep email> -> forecastRows), never in HubSpot, so neither the 5-minute pull nor the HubSpot mirror carries
// them. Live Edge now sends them here through /api/intake (same key as its other copies):
//   { wf: 'Edge', kind: 'forecasts', mode: 'save' | 'catchup', rep, by, prev: [rows], rows: [rows] }
// Each row keeps the id the Oct 22 migration gave it (ops/migration/build.js: the rep + the row's rowId), so a row
// loaded then and changed in live Edge now updates the same v2 forecast, and Pulse/new Edge see one forecast, not two.
//   save     what this save changed: rows added or edited are written, rows removed are deleted (deleted_at). Rows the
//            save did not touch are left alone, so a later edit made in Pulse or new Edge is never overwritten.
//   catchup  once per rep (live Edge sends it the first time the rep's forecasts are read after this change): rows v2
//            lacks are added; rows v2 still holds exactly as loaded on Oct 22 are brought up to date or, when gone from
//            live Edge, deleted. Anything edited in v2 since Oct 22 is left as it is.
// The migration's skip rules apply: no quantity, no date, test rows, a contact v2 doesn't have, admin@'s own rows.
'use strict';
const crypto = require('crypto');

const MIGRATED_AT = '2026-10-22T23:00:00Z';   // created_at / updated_at of every forecast loaded on Oct 22
const TEST = /\btest\b|demo|fake|patrick chen/i;

// The migration's id: ops/migration/build.js uid('forecast:territory:<email>:<rowId or id+date>').
function idFor(rep, r) {
  const h = crypto.createHash('md5').update('renellence-migration-2026-10-22:forecast:territory:' + rep + ':' + (r.rowId || String(r.id) + r.date)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const key = (r) => (r.rowId || String(r.id) + r.date);
// What a row says about the forecast (to tell an edited row from an untouched one).
const sig = (r) => [r.id, r.date || '', int(r.fillers), num(r.price), int(r.needles), num(r.needlePrice), int(r.cannulas), num(r.cannulaPrice)].join('|');
const usable = (r) => r && r.id && r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) && (int(r.fillers) || int(r.needles) || int(r.cannulas))
  && !TEST.test((r.name || '') + ' ' + (r.company || ''));

// The v2 contact for a HubSpot contact id, following a merge (merged_into_contact_id) to the contact that was kept.
async function contactOf(tx, hsId) {
  let [c] = await tx`select id, merged_into_contact_id as into, deleted_at from contacts where legacy_id = ${String(hsId)} limit 1`;
  for (let n = 0; c && c.into && n < 5; n++) [c] = await tx`select id, merged_into_contact_id as into, deleted_at from contacts where id = ${c.into}`;
  return c && !c.deleted_at ? c.id : null;
}

async function apply(sql, b) {
  const rep = String(b.rep || '').trim().toLowerCase();
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 300) : [];
  const prev = Array.isArray(b.prev) ? b.prev.slice(0, 300) : [];
  const mode = b.mode === 'catchup' ? 'catchup' : 'save';
  if (!rep || rep === 'admin@renellence.com') return { skipped: true, why: 'forecaster has no user' };
  const [u] = await sql`select id from users where lower(email) = ${rep}`;
  if (!u) return { skipped: true, why: 'forecaster has no user' };
  const [by] = b.by ? await sql`select id from users where lower(email) = ${String(b.by).trim().toLowerCase()}` : [];
  const actor = (by && by.id) || u.id;
  const out = { table: 'forecasts', mode, written: 0, deleted: 0, unchanged: 0, skipped: 0 };
  return sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'edge_app', true), set_config('app.user_id', ${actor}, true), set_config('app.batch_id', '', true)`;
    await tx`select pg_advisory_xact_lock(hashtext(${'edge-forecasts:' + rep}))`;
    const before = new Map(prev.map((r) => [key(r), r]));
    const now = new Set(rows.map(key));
    for (const r of rows) {
      const old = before.get(key(r));
      const id = idFor(rep, r);
      const same = mode === 'save' && old && sig(old) === sig(r);
      const contact = usable(r) ? await contactOf(tx, r.id) : null;
      // Not changed by this save: added only if v2 has never had it (an earlier copy that never arrived); a forecast
      // edited or deleted in Pulse/new Edge keeps what was done there.
      if (same) {
        if (contact) {
          const f0 = { id, created_by_id: actor, contact_id: contact, rep_id: u.id, due_date: r.date, syringes: int(r.fillers), syringe_price: num(r.price),
            needle_boxes: int(r.needles), needle_box_price: num(r.needlePrice), cannula_boxes: int(r.cannulas), cannula_box_price: num(r.cannulaPrice) };
          if ((await tx`insert into forecasts ${tx(f0)} on conflict (id) do nothing returning id`).length) { out.written++; continue; }
        }
        out.unchanged++;
        continue;
      }
      if (!contact) {
        // Emptied or no longer usable: what v2 has for it goes (a save only; a catch-up never deletes for this).
        if (mode === 'save' && old) out.deleted += (await tx`update forecasts set deleted_at = now() where id = ${id} and deleted_at is null returning id`).length;
        out.skipped++;
        continue;
      }
      const f = { contact_id: contact, rep_id: u.id, due_date: r.date, syringes: int(r.fillers), syringe_price: num(r.price), needle_boxes: int(r.needles),
        needle_box_price: num(r.needlePrice), cannula_boxes: int(r.cannulas), cannula_box_price: num(r.cannulaPrice) };
      const done = mode === 'save'
        ? await tx`insert into forecasts ${tx(Object.assign({ id, created_by_id: actor }, f))}
            on conflict (id) do update set contact_id = excluded.contact_id, rep_id = excluded.rep_id, due_date = excluded.due_date, syringes = excluded.syringes,
              syringe_price = excluded.syringe_price, needle_boxes = excluded.needle_boxes, needle_box_price = excluded.needle_box_price,
              cannula_boxes = excluded.cannula_boxes, cannula_box_price = excluded.cannula_box_price, deleted_at = null returning id`
        : await tx`insert into forecasts ${tx(Object.assign({ id, created_by_id: actor }, f))}
            on conflict (id) do update set due_date = excluded.due_date, syringes = excluded.syringes, syringe_price = excluded.syringe_price,
              needle_boxes = excluded.needle_boxes, needle_box_price = excluded.needle_box_price, cannula_boxes = excluded.cannula_boxes,
              cannula_box_price = excluded.cannula_box_price
            where forecasts.updated_at = ${MIGRATED_AT} and forecasts.deleted_at is null
              and (forecasts.due_date, forecasts.syringes, forecasts.syringe_price, forecasts.needle_boxes, forecasts.needle_box_price, forecasts.cannula_boxes, forecasts.cannula_box_price)
                is distinct from (excluded.due_date, excluded.syringes, excluded.syringe_price, excluded.needle_boxes, excluded.needle_box_price, excluded.cannula_boxes, excluded.cannula_box_price)
            returning id`;
      if (done.length) out.written++; else out.unchanged++;
    }
    if (mode === 'save') {
      for (const [k, r] of before) if (!now.has(k)) out.deleted += (await tx`update forecasts set deleted_at = now() where id = ${idFor(rep, r)} and deleted_at is null returning id`).length;
    } else if (rows.length) {   // an empty list never clears a rep's forecasts
      // Loaded on Oct 22 from this rep's list, never touched in v2 since, and no longer in live Edge: removed there.
      const keep = rows.map((r) => idFor(rep, r));
      out.deleted += (await tx`update forecasts set deleted_at = now() where rep_id = ${u.id} and deleted_at is null
        and created_at = ${MIGRATED_AT} and updated_at = ${MIGRATED_AT} and id <> all(${keep}::uuid[]) returning id`).length;
    }
    return out;
  });
}

module.exports = { apply, idFor, sig, usable, MIGRATED_AT };
