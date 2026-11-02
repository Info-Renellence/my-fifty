// Receipts from the expense bot -> v2 expenses (Yousef 2026-11-02: link Edge's Expenses page; "change the n8n workflow, option 1").
// n8n "Renellence Invoice Organizer v2" still appends each receipt to the expense sheet and now also POSTs it here
// (POST /api/cron?op=expense_intake, the Pulse ISF key), so it shows in the rep's "To submit" list on Edge's Expenses page,
// where they pick the customer and type and submit it.
//   body { rep, date, amount, vendor, notes, receiptLink }   rep = the sheet's rep name ("Brittany Houston", "Caterina")
// Rules: the rep must be an active v2 user (by full name, or a first name only one user has), else nothing is saved and the
// answer says so; one row per Drive receipt (source expense_bot, external_id = the Drive file id), so a retry adds nothing.
'use strict';
const s = (v) => (v == null ? '' : String(v).trim());
// Sheet names that differ from the v2 user's name.
const ALIAS = { 'emily weber': 'emily@renellence.com', caterina: 'caterina.paggos@renellence.com', 'sam almas': 'sam.almas@renellence.com' };

function amountOf(v) {
  const n = Number(s(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
function dateOf(v) {
  const d = s(v).slice(0, 10);
  const t = Date.parse(d + 'T12:00:00Z');   // "2026-00-00" (a misread receipt) is not a date
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
}
const fileIdOf = (link) => (s(link).match(/\/d\/([A-Za-z0-9_-]{10,})/) || [])[1] || '';

async function userFor(sql, rep) {
  const name = s(rep).toLowerCase();
  if (!name) return null;
  const users = await sql`select id, email::text as email, full_name from users where is_active is not false`;
  if (ALIAS[name]) return users.find((u) => u.email === ALIAS[name]) || null;
  const full = users.filter((u) => s(u.full_name).toLowerCase() === name);
  if (full.length === 1) return full[0];
  const first = users.filter((u) => s(u.full_name).toLowerCase().split(/\s+/)[0] === name.split(/\s+/)[0]);
  return first.length === 1 && !name.includes(' ') ? first[0] : null;
}

async function intake(sql, b) {
  const fileId = fileIdOf(b && b.receiptLink);
  if (!fileId) return { saved: false, reason: 'no_receipt' };
  const amount = amountOf(b.amount);
  if (amount == null) return { saved: false, reason: 'no_amount' };
  const u = await userFor(sql, b.rep);
  if (!u) return { saved: false, reason: 'rep_not_in_v2', rep: s(b.rep) };
  const [have] = await sql`select id from expenses where external_id = ${fileId} and source in ('expense_bot', 'expense_sheet') limit 1`;
  if (have) return { saved: false, reason: 'already', id: have.id };
  let row;
  await sql.begin(async (tx) => {
    await tx`select set_config('app.source', 'n8n', true), set_config('app.user_id', ${u.id}, true), set_config('app.batch_id', '', true)`;
    [row] = await tx`insert into expenses (user_id, vendor, amount, currency, expense_date, description, status, source, external_id)
      values (${u.id}, ${s(b.vendor).slice(0, 200) || null}, ${amount}, 'CAD', ${dateOf(b.date)}, ${s(b.notes).slice(0, 1000) || null}, 'to_submit', 'expense_bot', ${fileId})
      returning id`;
  });
  return { saved: true, id: row.id, user: u.email };
}

module.exports = { intake };
module.exports._ = { amountOf, dateOf, fileIdOf, userFor };
