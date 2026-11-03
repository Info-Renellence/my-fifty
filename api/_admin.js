// Pulse's Admin tab (owner 2026-11-03, "Admin and Developer Views": Pulse admin · Needs you, Assign a customer, Onboarding
// list, Review onboarding). Admins only (users.kind 'admin', never while viewing as a rep). The same rules as Edge's admin
// views (renellence-edge api/_edge/admin/views.js): keep the two in step.
//   reads   admin_needs        customers with no rep, onboardings stuck 5+ days on a signature, orders on hold (a declined card)
//           admin_assign_info  one customer and every rep to give them to: customers now, the area they cover, the best fit
//                              by the postal-area rules (api/_territory.js)
//           admin_onboarding   onboardings in progress, longest wait first (started in the last 60 days)
//           admin_onboarding_one  one onboarding's steps with dates
//   write   admin_assign       gives the customer to a rep (open tasks and this month's forecasts go too), a Pulse alert to
//                              the rep, and optionally a "First call" step for today
// Remind (onboarding) and Send pay link (order on hold) reuse act.js remind_md and resend_pay_link, which admins may use.
'use strict';
const T = require('./_time');
const { db, asUser } = require('./_db');
const { fail, isUuid } = require('./_http');
const R = require('./_territory');

const STUCK_DAYS = 5, OLD_DAYS = 60, ON_HOLD_DAYS = 45;
const nameOf = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unnamed';
const firstOf = (n) => String(n || '').split(/\s+/)[0] || '';
const day = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: T.TZ, month: 'short', day: 'numeric' }) : '');
const daysSince = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5)) : 0);
const ago = (d) => { const h = Math.floor((Date.now() - new Date(d).getTime()) / 36e5); return h < 1 ? 'just now' : h < 24 ? h + ' h ago' : Math.floor(h / 24) + ' d ago'; };
const repsOf = (sql) => sql`select u.id, u.full_name, (select count(*)::int from contacts c where c.owner_id = u.id and c.deleted_at is null) as n
  from users u where u.is_active and u.kind = 'rep' order by u.full_name`;
const onlyAdmin = (me) => { if (!me || me.kind !== 'admin' || me.viewer) throw fail(403, 'admins_only'); };

// The areas a rep covers, from the territory rules' groups ("Sam" matches Samantha).
function coverage(fullName) {
  const first = firstOf(fullName).toLowerCase();
  const mine = R.GROUPS.filter((g) => g.rep.split('|').some((r) => first.startsWith(r.toLowerCase())));
  if (/^brittany/.test(first)) return 'British Columbia and Alberta';
  if (/^angela/.test(first) && !mine.length) return 'Quebec';
  return mine.length ? mine.slice(0, 2).map((g) => g.area.split(':')[0]).join('; ') : '';
}

async function onboardingRows(sql) {
  const rows = await sql`
    select o.id, o.status::text as status, o.submitted_at, o.card_saved_at, o.primary_contact_id,
           c.first_name, c.last_name, cl.name as clinic, u.full_name as rep, a.id as agreement_id, a.signatureapi_envelope_id,
           (select max(s.signed_at) from agreement_signers s where s.agreement_id = a.id) as last_signed,
           (select max(s.signed_at) from agreement_signers s where s.agreement_id = a.id and s.role <> 'md' and s.status = 'signed') as clinic_signed_at,
           (select max(s.signed_at) from agreement_signers s where s.agreement_id = a.id and s.role = 'md' and s.status = 'signed') as md_signed_at,
           (select bool_or(s.status = 'signed') from agreement_signers s where s.agreement_id = a.id and s.role <> 'md') as clinic_signed,
           (select bool_or(s.status = 'signed') from agreement_signers s where s.agreement_id = a.id and s.role = 'md') as md_signed,
           (select bool_or(true) from agreement_signers s where s.agreement_id = a.id and s.role = 'md') as has_md
      from onboardings o left join contacts c on c.id = o.primary_contact_id left join clinics cl on cl.id = c.clinic_id
      left join users u on u.id = c.owner_id left join agreements a on a.id = o.agreement_id
     where (o.status = 'submitted' or (o.status = 'signed' and o.card_saved_at is null and o.submitted_at > now() - interval '30 days'))
       and o.submitted_at > now() - make_interval(days => ${OLD_DAYS})
     order by o.submitted_at`;
  return rows.map((r) => {
    const md = r.status === 'signed' || !r.has_md || !!r.md_signed;
    const steps = [true, r.status === 'signed' || !!r.clinic_signed, md, !!r.card_saved_at];
    const at = steps.findIndex((x) => !x);
    const status = at === 1 ? 'Waiting on clinic signature' : at === 2 ? 'Waiting on MD signature' : at === 3 ? 'Waiting on card on file' : 'Done';
    const days = daysSince(r.last_signed && r.last_signed > r.submitted_at ? r.last_signed : r.submitted_at);
    return { id: r.id, contactId: r.primary_contact_id, name: r.clinic ? r.clinic + ' · ' + nameOf(r) : nameOf(r), clinic: r.clinic || nameOf(r), person: nameOf(r),
      rep: firstOf(r.rep), steps, step: at < 0 ? 4 : at + 1, status, days, stuck: days >= STUCK_DAYS, canRemind: (at === 1 || at === 2) && !!r.signatureapi_envelope_id,
      started: day(r.submitted_at), dates: [day(r.submitted_at), day(r.clinic_signed_at), r.has_md ? day(r.md_signed_at) : 'No MD needed', day(r.card_saved_at)] };
  }).sort((a, b) => b.days - a.days);
}

const READS = {
  async admin_needs(sql, me) {
    onlyAdmin(me);
    const items = [];
    const noRep = await sql`select c.id, c.first_name, c.last_name, c.created_at, c.lead_source::text as lead_source, coalesce(nullif(trim(c.shipping_city), ''), cl.city) as city
      from contacts c left join clinics cl on cl.id = c.clinic_id
      where c.owner_id is null and c.deleted_at is null and c.merged_into_contact_id is null order by c.created_at desc limit 50`;
    for (const c of noRep) items.push({ kind: 'no_rep', id: c.id, contactId: c.id, name: nameOf(c),
      detail: [c.lead_source === 'social' ? 'Instagram lead' : c.lead_source ? c.lead_source[0].toUpperCase() + c.lead_source.slice(1) + ' lead' : 'New lead', c.city, ago(c.created_at)].filter(Boolean).join(' · ') });
    for (const o of (await onboardingRows(sql)).filter((x) => x.stuck && x.canRemind))
      items.push({ kind: 'onboarding', id: o.id, contactId: o.contactId, name: o.name, detail: o.status + ' · ' + o.days + ' days' + (o.rep ? ' · ' + o.rep + "'s" : '') });
    const held = await sql`select o.id, o.order_number, o.contact_id, c.first_name, c.last_name, cl.name as clinic, u.full_name as rep
      from orders o join contacts c on c.id = o.contact_id left join clinics cl on cl.id = c.clinic_id left join users u on u.id = o.rep_id
      where o.deleted_at is null and o.status::text not in ('cancelled', 'rejected', 'paid') and o.submitted_at > now() - make_interval(days => ${ON_HOLD_DAYS})
        and exists (select 1 from payments p where p.order_id = o.id and p.status = 'failed')
        and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'succeeded') order by o.submitted_at`;
    for (const o of held) items.push({ kind: 'on_hold', id: o.id, contactId: o.contact_id, name: o.clinic || nameOf(o),
      detail: 'Card declined' + (o.rep ? ' · ' + firstOf(o.rep) + "'s customer" : '') });
    const count = (k) => items.filter((x) => x.kind === k).length;
    return { total: items.length, groups: { noRep: count('no_rep'), onboarding: count('onboarding'), onHold: count('on_hold') }, items,
      date: new Date().toLocaleDateString('en-CA', { timeZone: T.TZ, weekday: 'long', month: 'long', day: 'numeric' }) };
  },

  async admin_assign_info(sql, me, q) {
    onlyAdmin(me);
    const id = q.get('id');
    if (!isUuid(id)) throw fail(404, 'not_found');
    const [c] = await sql`select c.id, c.first_name, c.last_name, c.owner_id, c.created_at, c.lead_source::text as lead_source, cl.name as clinic,
        coalesce(nullif(trim(c.shipping_city), ''), cl.city) as city, coalesce(nullif(trim(c.shipping_province), ''), cl.province) as province,
        coalesce(nullif(trim(c.shipping_postal_code), ''), cl.postal_code) as postal, u.full_name as owner,
        (select count(*)::int from interactions i where i.contact_id = c.id and i.deleted_at is null and i.kind = 'call') as calls,
        (select i.body from interactions i where i.contact_id = c.id and i.deleted_at is null and i.direction = 'in' order by i.occurred_at desc limit 1) as last_in
      from contacts c left join clinics cl on cl.id = c.clinic_id left join users u on u.id = c.owner_id where c.id = ${id} and c.deleted_at is null`;
    if (!c) throw fail(404, 'not_found');
    const rule = R.ruleFor(R.fsaOf(c.postal)) || R.placeRule(c.province, c.city);
    const fit = rule && !rule.split ? rule.reps[0].toLowerCase() : '';
    const reps = (await repsOf(sql)).map((u) => ({ id: u.id, name: firstOf(u.full_name), count: u.n, covers: coverage(u.full_name),
      best: !!fit && firstOf(u.full_name).toLowerCase().startsWith(fit) }));
    return { person: { id: c.id, name: c.clinic || nameOf(c), who: c.clinic ? nameOf(c) : '', ownerId: c.owner_id, owner: firstOf(c.owner),
      source: [c.lead_source === 'social' ? 'Instagram lead' : c.lead_source ? c.lead_source[0].toUpperCase() + c.lead_source.slice(1) + ' lead' : 'Lead', c.city].filter(Boolean).join(' · '),
      context: [c.last_in ? 'Last message: “' + String(c.last_in).slice(0, 140) + '”' : '', c.calls ? c.calls + ' calls so far.' : 'No calls yet.'].filter(Boolean).join(' '),
      area: rule ? rule.area : '' }, reps };
  },

  async admin_onboarding(sql, me) {
    onlyAdmin(me);
    const rows = await onboardingRows(sql);
    // Needs a look first (stuck on a signature), then the rest by wait (design: review first, then stuck, then ready).
    rows.sort((a, b) => (b.stuck && b.canRemind) - (a.stuck && a.canRemind) || b.days - a.days);
    return { rows, counts: { all: rows.length, stuck: rows.filter((r) => r.stuck).length, card: rows.filter((r) => r.step === 4).length } };
  },

  async admin_onboarding_one(sql, me, q) {
    onlyAdmin(me);
    const id = q.get('id');
    const o = (await onboardingRows(sql)).find((x) => x.id === id);
    if (!o) throw fail(404, 'not_found');
    return o;
  },
};

const WRITES = {
  async admin_assign(me, b) {
    onlyAdmin(me);
    if (!isUuid(b.id) || !isUuid(b.to)) throw fail(400, 'bad_input');
    const sql = db();
    const [to] = await sql`select id, full_name from users where id = ${b.to} and is_active and kind in ('rep', 'admin')`;
    if (!to) throw fail(400, 'bad_rep');
    const [c] = await sql`select id, first_name, last_name, owner_id from contacts where id = ${b.id} and deleted_at is null`;
    if (!c) throw fail(404, 'not_found');
    const month = T.ymd().slice(0, 7) + '-01';
    await asUser(me.id, async (tx) => {
      await tx`update contacts set owner_id = ${to.id} where id = ${c.id}`;
      if (c.owner_id) {
        await tx`update tasks set assignee_id = ${to.id} where contact_id = ${c.id} and assignee_id = ${c.owner_id} and status = 'open' and deleted_at is null`;
        await tx`update forecasts set rep_id = ${to.id} where contact_id = ${c.id} and rep_id = ${c.owner_id} and deleted_at is null and due_date >= ${month}`;
      }
      if (b.firstCall) await tx`insert into tasks (contact_id, assignee_id, title, kind, status, source, due_at, created_by_id)
        values (${c.id}, ${to.id}, 'First call', 'call', 'open', 'manual', ${T.atLocal(T.ymd(), 17, 0)}, ${me.id})`;
    });
    let alert = 'no_phone';
    try {
      const r = await require('./_push').notify(sql, to.id, { kind: 'new_lead', title: 'New customer: ' + nameOf(c),
        body: (me.first || 'An admin') + ' gave you ' + nameOf(c) + (b.firstCall ? '. A first call is on your list for today.' : '.'), url: '/person/' + c.id,
        dedupeKey: 'assign:' + c.id + ':' + to.id + ':' + Date.now(), contactId: c.id });
      alert = r.sent ? 'sent' : 'no_phone';
    } catch (e) { alert = 'failed'; }
    return { ok: true, alert, rep: firstOf(to.full_name), name: c.first_name || nameOf(c) };
  },
};

module.exports = { READS, WRITES, onboardingRows, coverage };
