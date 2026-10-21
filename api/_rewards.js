// Rewards (L11). The programs are written here in code for now (Yousef 2026-10-20: "Hard-code for now");
// reward programs are deferred in the data model (SOP section 6), so nothing about them is stored.
// Every number is worked out from orders:
//   - a "new" order is a person's first paid order ever; every later paid order is a reorder
//   - an order counts for the rep credited on it (orders.rep_id), on the day it was paid (or placed, for wire)
//   - money is the paid lines only (free lines and samples never count)
const B = require('./_book');
const T = require('./_time');

const PROGRAMS = {
  booster: { name: 'Q4 Booster', from: '2026-10-01', to: '2026-12-31', newRate: 0.02, reorderRate: 0.04 },
  trip: { name: 'Trip to Vienna', from: '2026-10-01', to: '2026-12-31', metric: 'New people' },
};

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-CA');
const inRange = (at, p) => { const d = T.ymd(at); return d >= p.from && d <= p.to; };

async function rewards(sql, me) {
  // Every paid order of every contact that has one, so "first ever" is right across reps.
  const rows = await sql`select distinct o.contact_id from orders o where o.deleted_at is null and o.status <> all(${['rejected', 'cancelled']}::orders_status[])`;
  const orders = (await B.ordersFor(sql, rows.map((r) => r.contact_id))).filter(B.isPaid);
  const firstBy = {};
  for (const o of orders) { const at = B.paidAt(o); if (!firstBy[o.contact_id] || at < B.paidAt(firstBy[o.contact_id])) firstBy[o.contact_id] = o; }

  const b = PROGRAMS.booster;
  let onNew = 0, onReorders = 0;
  for (const o of orders) {
    if (o.rep_id !== me.id || !inRange(B.paidAt(o), b)) continue;
    if (firstBy[o.contact_id].id === o.id) onNew += o.total * b.newRate;
    else onReorders += o.total * b.reorderRate;
  }

  // This month's saypha syringes and Exprecell boxes on the rep's paid orders.
  const month = T.ymd().slice(0, 7);
  let syringes = 0, exprecell = 0;
  for (const o of orders) {
    if (o.rep_id !== me.id || T.ymd(B.paidAt(o)).slice(0, 7) !== month) continue;
    for (const l of o.summary || []) {
      if (l.free || !(Number(l.price) > 0)) continue;   // paid lines only: no-charge items (headbands, ice packs, fact sheets) never count
      if (/^SA/i.test(l.sku || '') || /saypha/i.test(l.name || '')) syringes += Number(l.qty) || 0;
      if (/exprecell/i.test(l.sku || '') || /exprecell/i.test(l.name || '')) exprecell += Number(l.qty) || 0;
    }
  }

  // Trip to Vienna: new people per rep in the period.
  const t = PROGRAMS.trip;
  const perRep = {};
  for (const o of Object.values(firstBy)) if (o.rep_id && inRange(B.paidAt(o), t)) perRep[o.rep_id] = (perRep[o.rep_id] || 0) + 1;
  const reps = await sql`select id, name from users where kind = ${'rep'} and active is not false`;
  const board = reps.map((r) => ({ id: r.id, name: String(r.name || '').split(/\s+/)[0], n: perRep[r.id] || 0 }));
  if (!board.some((r) => r.id === me.id)) board.push({ id: me.id, name: me.first, n: perRep[me.id] || 0 });
  board.sort((a, b2) => b2.n - a.n || a.name.localeCompare(b2.name));
  board.forEach((r, i) => { r.rank = i + 1; r.you = r.id === me.id; });
  const mine = board.find((r) => r.you);
  const top = board.slice(0, 3);
  if (!top.includes(mine)) top[2] = mine;
  // A tie for first is not the lead: it takes one more than the best of the others.
  const bestOther = board.filter((r) => !r.you).reduce((a, r) => Math.max(a, r.n), 0);
  const toLead = mine.n > bestOther ? 0 : bestOther - mine.n + 1;

  return {
    extra: money(onNew + onReorders),
    syringes, exprecell,
    trip: { name: t.name, sub: t.metric + ' · ends ' + T.short(t.to + 'T12:00:00Z'),
      line: toLead ? toLead + ' more new ' + (toLead === 1 ? 'person' : 'people') + ' to take the lead' : 'You are in the lead',
      rows: top.map((r) => ({ rank: r.rank, name: r.you ? 'You' : r.name, n: r.n, you: r.you })) },
    booster: { name: b.name, onNew: money(onNew), onReorders: money(onReorders), newText: Math.round(b.newRate * 100) + '% on new orders', reorderText: Math.round(b.reorderRate * 100) + '% on reorders' },
  };
}

module.exports = { rewards, PROGRAMS };
