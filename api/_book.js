// A rep's book, with everything My Fifty shows worked out from v2's records (nothing derived is stored,
// SOP section 9):
//
// Stages (Edge decisions 2026-10-21, shared with the data-model SOP; worked out, never stored):
//   stage      fifty      a (non-sample) order placed in the last 3 months (settings fifty_months), paid or not
//              candidate  has a sample order (every line free), and is not in the Fifty
//              lead       otherwise. Someone who left the Fifty (no order for 3 months) is a lead again and shows as
//                         a WARM lead (leadGroup), whatever their first source
//   goingCold  a Fifty person with no order and no visit (in person or video; a no-show is not a visit) in the last N days (settings, default 30)
//   isNew      a lead nobody has called, texted, emailed or visited yet
// Ordered and paid are different: "ordered" is every placed order that isn't cancelled or rejected; "paid" (used for
// rewards and Total bought) needs the money: a paid status or a succeeded payment, and for a wire order only its wire
// payment marked received (a wire order ships before it is paid, so its status says nothing about payment).
//
// Reached (Yousef 2026-10-21, Q9): a call or in-person visit counts towards the day goal, and takes the person off
// Today, only when they were reached: a no-answer call or a no-show visit does neither. An email never does; a text
// takes the person off Today but is not a touchpoint.
//
// Everything is scoped to contacts the person owns (owner_id), the same rule as row-level security.
const T = require('./_time');
const L = require('./_lists');

const NOT_REACHED = ['no_answer', 'voicemail', 'busy', 'no_show'];
const REACHED = (sql) => sql`(coalesce(i.outcome, 'connected') <> all(${NOT_REACHED}) and i.status is distinct from 'no_show')`;

const DEFAULTS = { daily_goal: 8, going_cold_days: 30, fifty_goal: 50, new_lead_hours: 24, fifty_months: 3 };

async function settings(sql) {
  const rows = await sql`select key, value from settings where key = any(${['my_fifty', 'holidays']})`;
  const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.assign({}, DEFAULTS, by.my_fifty || {}, { holidays: Array.isArray(by.holidays) ? by.holidays : [] });
}

const PAID_STATUSES = ['paid', 'sent_to_warehouse', 'shipped', 'delivered'];

// Every live order for a set of contacts, with its total (paid lines only), whether it is a sample order,
// whether it counts as paid, and when.
async function ordersFor(sql, contactIds) {
  if (!contactIds.length) return [];
  return sql`
    select o.id, o.contact_id, o.rep_id, o.status, o.order_number, o.payment_method, o.submitted_at, o.approved_at, o.md_contact_id,
           o.md_signed_at, o.invoiced_at, o.sent_to_warehouse_at, o.shipped_at, o.delivered_at, o.tracking_number, o.tracking_url,
           o.created_at,
           coalesce(l.total, 0)::float8 as total, coalesce(l.n, 0)::int as n_lines, coalesce(l.all_free, false) as all_free,
           l.summary,
           coalesce((o.payment_method is distinct from 'wire' and o.status = any(${PAID_STATUSES}))
             or exists (select 1 from payments p where p.order_id = o.id and p.kind = 'charge' and p.status = 'succeeded' and p.is_test is not true), false) as paid_flag,
           (select min(p.paid_at) from payments p where p.order_id = o.id and p.kind = 'charge' and p.status = 'succeeded' and p.is_test is not true) as paid_at
      from orders o
      left join lateral (
        select sum(case when coalesce(ol.is_free, false) then 0 else ol.quantity * coalesce(ol.unit_price, 0) end) as total,
               count(*) as n,
               bool_and(coalesce(ol.is_free, false) or coalesce(ol.unit_price, 0) = 0) as all_free,
               json_agg(json_build_object('sku', ol.sku, 'name', ol.name, 'qty', ol.quantity, 'price', ol.unit_price, 'free', coalesce(ol.is_free, false)) order by (ol.sku like 'SA%') desc, ol.quantity desc, ol.name) as summary
          from order_lines ol where ol.order_id = o.id
      ) l on true
     where o.contact_id = any(${contactIds}) and o.deleted_at is null and o.status not in ('rejected', 'cancelled')
     order by coalesce(o.submitted_at, o.created_at) desc`;
}

const isSample = (o) => o.n_lines > 0 && o.all_free;
const isPaid = (o) => !isSample(o) && o.n_lines > 0 && o.paid_flag;
const paidAt = (o) => o.paid_at || o.submitted_at || o.created_at;   // a wire order: the day the money was marked received
const placedAt = (o) => o.submitted_at || o.created_at;
const isOrder = (o) => !isSample(o) && o.n_lines > 0;   // "ordered": placed, not cancelled or rejected, not samples

// The whole book of one person. opts.contactId limits it to one contact (still owned by them).
async function book(sql, me, opts) {
  const o = opts || {};
  const cfg = o.cfg || await settings(sql);
  const contacts = await sql`
    select c.id, c.first_name, c.last_name, c.designation, c.email, c.secondary_email, c.role, c.phone, c.mobile, c.clinic_id, cl.name as clinic,
           c.source_kind, c.source_ad_id, c.source_event_id, ev.name as event_name, c.created_at,
           c.fillers_used::text[] as fillers_used, c.prp_used::text[] as prp_used,
           c.shipping_street, c.shipping_city, c.shipping_province, c.shipping_postal_code,
           c.billing_street, c.billing_city, c.billing_province, c.billing_postal_code
      from contacts c
      left join clinics cl on cl.id = c.clinic_id
      left join events ev on ev.id = c.source_event_id
     where c.owner_id = ${me.id} and c.deleted_at is null and c.merged_into_id is null
       ${o.contactId ? sql`and c.id = ${o.contactId}` : sql``}`;
  const ids = contacts.map((c) => c.id);
  if (!ids.length) return { cfg, people: [] };
  const [orders, touches, tasks] = await Promise.all([
    ordersFor(sql, ids),
    sql`
      select i.contact_id,
             max(i.occurred_at) filter (where i.kind <> 'note') as last_touch_at,
             (array_agg(i.kind::text order by i.occurred_at desc) filter (where i.kind <> 'note'))[1] as last_touch_kind,
             max(i.occurred_at) filter (where i.kind = 'meeting' and i.mode in ('in_person', 'video') and i.status is distinct from 'cancelled'
                                         and ${REACHED(sql)}) as last_visit_at,   -- a video call counts as a visit; a no-show does not (S1, Yousef 2026-10-22)
             count(*) filter (where i.kind <> 'note') as touches,
             bool_or(i.user_id = ${me.id} and (i.kind = 'text' or (i.kind in ('call', 'meeting') and ${REACHED(sql)}))
                     and (i.occurred_at at time zone 'America/Toronto')::date = (now() at time zone 'America/Toronto')::date) as touched_today
        from interactions i
       where i.contact_id = any(${ids}) and i.deleted_at is null and i.status is distinct from 'scheduled' and i.status is distinct from 'cancelled'
       group by i.contact_id`,
    sql`
      select distinct on (t.contact_id) t.id, t.contact_id, t.title, t.type, t.due_at
        from tasks t
       where t.contact_id = any(${ids}) and t.assignee_id = ${me.id} and t.status = 'open' and t.deleted_at is null
       order by t.contact_id, t.due_at nulls last`,
  ]);
  const ordersBy = group(orders, 'contact_id');
  const touchBy = Object.fromEntries(touches.map((t) => [t.contact_id, t]));
  const taskBy = Object.fromEntries(tasks.map((t) => [t.contact_id, t]));
  const now = Date.now();
  const people = contacts.map((c) => {
    const os = ordersBy[c.id] || [];
    const paid = os.filter(isPaid);
    const ordered = os.filter(isOrder);
    const samples = os.filter(isSample);
    const t = touchBy[c.id] || {};
    const p = {
      id: c.id, name: fullName(c), first: c.first_name || '', clinic: c.clinic || '', clinicId: c.clinic_id,
      email: c.email || '', secondaryEmail: c.secondary_email || '', phone: c.mobile || c.phone || '', role: L.canon('contacts_role', c.role),
      sourceKind: c.source_kind, eventName: c.event_name || '', createdAt: c.created_at,
      // Old list names read as the new ones (v2 part B renames; api/_lists.js).
      fillers: L.canonAll('contacts_filler', c.fillers_used), prp: L.canonAll('contacts_prp', c.prp_used),
      shipping: addr(c, 'shipping'), billing: addr(c, 'billing'),
      orders: os, paidOrders: paid.length, sampleOrders: samples.length,
      totalBought: paid.reduce((a, x) => a + x.total, 0),
      lastPaid: paid.length ? paid.reduce((a, x) => (paidAt(x) > paidAt(a) ? x : a)) : null,
      firstPaidAt: paid.length ? paid.map(paidAt).reduce((a, x) => (x < a ? x : a)) : null,
      lastTouchAt: t.last_touch_at || null, lastTouchKind: t.last_touch_kind || null, lastVisitAt: t.last_visit_at || null,
      touches: Number(t.touches || 0), touchedToday: !!t.touched_today,
      followUp: taskBy[c.id] || null,
    };
    const lastOrderAt = ordered.length ? ordered.map(placedAt).reduce((a, x) => (x > a ? x : a)) : null;
    p.lastOrderAt = lastOrderAt;
    p.firstOrderAt = ordered.length ? ordered.map(placedAt).reduce((a, x) => (x < a ? x : a)) : null;
    const inFifty = lastOrderAt && new Date(lastOrderAt) > monthsAgo(cfg.fifty_months, now);
    p.stage = inFifty ? 'fifty' : samples.length && !ordered.length ? 'candidate' : 'lead';
    p.leadGroup = ordered.length ? 'warm' : p.sourceKind;   // left the Fifty: a warm lead
    if (p.stage === 'fifty') {
      const lastActive = [lastOrderAt, p.lastVisitAt].filter(Boolean).reduce((a, x) => (x > a ? x : a));
      p.lastActiveAt = lastActive;
      p.lastActiveKind = p.lastVisitAt && p.lastVisitAt >= lastOrderAt ? 'visited' : 'ordered';
      p.coldDays = T.daysBetween(lastActive, now);
      p.goingCold = p.coldDays > cfg.going_cold_days;
    }
    if (p.stage === 'candidate') {
      const s = samples.find((x) => x.delivered_at || x.shipped_at) || samples[0];   // the newest samples that arrived; else the newest on the way
      p.sampleOrder = s;
      p.samplesAt = s.delivered_at || s.shipped_at || null;
      p.sampleDays = p.samplesAt ? T.daysBetween(p.samplesAt, now) : null;
      p.touchedSinceSamples = !!(p.samplesAt && p.lastTouchAt && p.lastTouchAt > p.samplesAt);
    }
    if (p.stage === 'lead') p.isNew = p.touches === 0;
    return p;
  });
  return { cfg, people };
}

// Doctors show as "Dr. Maya Sample" (the mockup's wording), from their designation.
function fullName(c) {
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ');
  if (!n) return c.email || 'No name';
  return /^(MD|DO|DDS|DMD)$/i.test(String(c.designation || '').trim()) && !/^dr\.?\s/i.test(n) ? 'Dr. ' + n : n;
}
function addr(c, k) {
  const a = { street: c[k + '_street'] || '', city: c[k + '_city'] || '', province: c[k + '_province'] || '', postal: c[k + '_postal_code'] || '' };
  a.line = [a.street, a.city].filter(Boolean).join(', ');
  return a;
}
// The moment n months before now (calendar months, Toronto day).
function monthsAgo(n, now) { const d = new Date(now); d.setMonth(d.getMonth() - (Number(n) || 3)); return d; }
function group(rows, key) { const out = {}; for (const r of rows) (out[r[key]] = out[r[key]] || []).push(r); return out; }

// The day goal and streak: a touchpoint is a call or an in-person visit the person logged where they were reached
// (Yousef 2026-10-21, Q9: no-answer calls and no-show visits don't count; emails and texts never do).
// The streak counts days in a row with at least the goal, ending yesterday, plus today once today's goal is met.
// A business day short of the goal breaks it; a weekend or holiday (settings) never breaks it but adds one when
// the goal was met on it (Yousef 2026-10-21, Q10).
async function dayStats(sql, me, cfg) {
  const rows = await sql`
    select (i.occurred_at at time zone 'America/Toronto')::date::text as day, count(*)::int as n
      from interactions i
     where i.user_id = ${me.id} and i.deleted_at is null and i.status is distinct from 'cancelled' and i.status is distinct from 'scheduled'
       and (i.kind = 'call' or (i.kind = 'meeting' and i.mode = 'in_person')) and ${REACHED(sql)}
       and i.occurred_at > now() - interval '400 days'
     group by 1`;
  const by = Object.fromEntries(rows.map((r) => [r.day, r.n]));
  const today = T.ymd();
  const done = by[today] || 0;
  let streak = 0;
  let d = T.addDays(today, -1);
  for (let i = 0; i < 400; i++) {
    const met = (by[d] || 0) >= cfg.daily_goal;
    if (met) streak++;
    else if (T.isBusinessDay(d, cfg.holidays)) break;
    d = T.addDays(d, -1);
  }
  if (done >= cfg.daily_goal) streak++;
  return { done, goal: cfg.daily_goal, streak };
}

// Today's list, in order (Yousef 2026-10-20): new ad leads (under 24 hours), follow-ups due today or
// overdue, Fifty people going cold, then candidates nobody has touched since their samples arrived.
// People already reached today drop off; "Tomorrow" hides someone until tomorrow (users.settings.snoozed).
function todayList(people, me, cfg) {
  const today = T.ymd();
  const endOfToday = T.atLocal(today, 23, 59).toISOString();
  const snoozed = (me.settings && me.settings.snoozed) || {};
  const out = [];
  const seen = new Set();
  const push = (p, item) => {
    if (seen.has(p.id) || p.touchedToday) return;
    if (snoozed[p.id] && snoozed[p.id] > today) return;
    seen.add(p.id);
    out.push(Object.assign({ id: p.id, name: p.name, clinic: p.clinic, phone: p.phone, email: p.email }, item));
  };
  const hours = cfg.new_lead_hours * 3600000;
  people.filter((p) => p.stage === 'lead' && p.isNew && p.sourceKind === 'social' && Date.now() - new Date(p.createdAt) < hours)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach((p) => push(p, { why: 'lead', action: 'call', detail: 'new Meta lead · ' + ago(p.createdAt) }));   // four sources only: social = Meta ads
  people.filter((p) => p.followUp && p.followUp.due_at && new Date(p.followUp.due_at).toISOString() <= endOfToday)
    .sort((a, b) => new Date(a.followUp.due_at) - new Date(b.followUp.due_at))
    .forEach((p) => push(p, { why: 'follow_up', taskId: p.followUp.id, action: p.followUp.type === 'visit' ? 'visit' : 'call', detail: p.followUp.title || 'Follow-up' }));
  people.filter((p) => p.stage === 'fifty' && p.goingCold).sort((a, b) => b.coldDays - a.coldDays)
    .forEach((p) => push(p, { why: 'going_cold', action: 'visit', detail: 'going cold · ' + p.coldDays + ' days' }));
  people.filter((p) => p.stage === 'candidate' && p.samplesAt && !p.touchedSinceSamples).sort((a, b) => b.sampleDays - a.sampleDays)
    .forEach((p) => push(p, { why: 'candidate', action: 'visit', detail: 'samples ' + p.sampleDays + ' days ago' }));
  return out;
}

function ago(at) {
  const m = Math.max(0, Math.round((Date.now() - new Date(at)) / 60000));
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24);
  if (d < 14) return d + 'd ago';
  if (d < 30) return Math.round(d / 7) + ' wk ago';
  return Math.round(d / 30) + ' mo ago';
}

// The next milestone: every 5 people (the Fifty tile shows the last 10 dots towards it).
const nextMilestone = (n) => Math.floor(n / 5) * 5 + 5;

module.exports = { settings, book, ordersFor, dayStats, todayList, isSample, isPaid, isOrder, paidAt, placedAt, fullName, ago, nextMilestone, DEFAULTS, addr, group };
