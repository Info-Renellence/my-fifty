// What n8n looks up, answered from v2 (owner 2026-10-28, data-flow improvement 4: "only if it won't mess anything up while
// we're still using HubSpot"). Only lookups whose answer goes into an email or a report move here; a lookup whose
// answer feeds a HubSpot write keeps reading HubSpot until HubSpot writes stop (n8n needs HubSpot's own id for those).
//   GET /api/cron?op=lookup&what=clinic_hours&email=<customer email>[&clinic=<clinic name>]
//        -> { found, clinic, hours, tz }  hours = the clinic's hours, one day per line, without the time-zone line v2 keeps
//           at the end; tz = that line's zone, else the rep's (Brittany Pacific, others Eastern). For the sales form's shipping emails, in place of
//           its 4 HubSpot steps (contact search, its companies, their hours, a clinic-name search). Same order of choice:
//           the customer's clinic, else a clinic with the order's clinic name.
//   GET /api/cron?op=lookup&what=owner_name&owner=<HubSpot owner id>  -> { found, name, email, id, firstName, lastName }   (onboarding emails; HubSpot's owner shape)
// Called by n8n with the Pulse ISF key (X-Edge-ISF). Read only.
'use strict';
const M = require('./_hsmap');

const TZ_LINE = /^\(?\s*((?:Eastern|Pacific|Central|Mountain|Atlantic|Newfoundland) Time \([A-Z]{2,3}\))\s*\)?$/i;
// "Monday: 9 AM - 5 PM\n...\n(Pacific Time (PT))" -> { hours: 'Monday: ...\n...', tz: 'Pacific Time (PT)' }
function splitHours(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  let tz = '';
  while (lines.length && TZ_LINE.test(lines[lines.length - 1])) tz = lines.pop().match(TZ_LINE)[1];
  return { hours: lines.join('\n'), tz };
}

async function clinicHours(sql, email, clinic) {
  const e = String(email || '').trim().toLowerCase();
  let row = null;
  if (e) {
    [row] = await sql`select cl.name, cl.hours_of_operation as h, u.email as owner from contacts c join clinics cl on cl.id = c.clinic_id and cl.deleted_at is null
      left join users u on u.id = c.owner_id
      where c.deleted_at is null and c.merged_into_contact_id is null and (lower(c.email) = ${e} or lower(c.secondary_email) = ${e})
        and coalesce(trim(cl.hours_of_operation), '') <> '' order by c.created_at limit 1`;
  }
  const name = String(clinic || '').trim();
  if (!row && name) {
    [row] = await sql`select name, hours_of_operation as h from clinics where deleted_at is null and lower(trim(name)) = ${name.toLowerCase()}
      and coalesce(trim(hours_of_operation), '') <> '' limit 1`;
  }
  if (!row) return { found: false, clinic: '', hours: '', tz: '' };
  // The time zone as the sales form picks it today: the one the hours name, else the rep's (Brittany = BC and Alberta =
  // Pacific, everyone else Eastern).
  const h = splitHours(row.h);
  return { found: true, clinic: row.name, hours: h.hours, tz: h.tz || (/^brittany\./i.test(row.owner || '') ? 'Pacific Time (PT)' : 'Eastern Time (ET)') };
}

async function ownerName(sql, owner) {
  const id = M.ownerUser(owner);
  if (!id) return { found: false, name: '', email: '' };
  const [u] = await sql`select full_name, email from users where id = ${id}`;
  if (!u) return { found: false, name: '', email: '' };
  // Also in HubSpot's owner shape (id, firstName, lastName, email), so the onboarding forms' steps read it unchanged.
  const parts = String(u.full_name || '').trim().split(/\s+/);
  return { found: true, name: u.full_name || '', email: u.email || '', id: String(owner), firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

async function lookup(sql, q) {
  const what = q.get('what');
  if (what === 'clinic_hours') return clinicHours(sql, q.get('email'), q.get('clinic'));
  if (what === 'owner_name') return ownerName(sql, q.get('owner'));
  const e = new Error('unknown_lookup'); e.status = 400; throw e;
}

module.exports = { lookup, clinicHours, ownerName, splitHours };
