// The week in Pulse (Compass, db/v2-010-compass.sql; compass/docs/compass-data-proposal.md section 7): after the weekly
// 1-on-1 is saved, Today shows this week's focus, the agreed visits (each ends Done or Missed) and the agreed calls.
//
//   this week   the Toronto week, Monday to Sunday (checkins.week_start_date is its Monday)
//   the session the rep's own weekly one_on_ones row for this week's check-in, saved (completed_at); nothing shows before
//   the focus   the latest tasks row with source one_on_one and title = a goal key, assigned to the rep and due this week
//               (the same rule as Edge's Home focus card); the number is the session's focus_action_target_count
//   Done        account_picks.visit_interaction_id: set when the rep logs a reached visit for that contact this week
//   Missed      account_picks.missed_at: the rep's tap (no reason asked, owner 2026-10-23), which can be undone
// Every read and write here is the rep's own week only (rep_id = me), admins included: only the rep confirms their week.
// Until Compass's tables exist on a database (B.hasCompass), there is no week and nothing here touches them.
const T = require('./_time');
const B = require('./_book');

// The five weekly goals: the keys and names are Edge's (api/_edge/view.js GOALS), the weekly action is Compass's
// (compass/src/data/catalog.js). Keep the three in sync.
const GOALS = {
  close: { name: 'Close sampled clinics', action: 'sampled clinics asked for an order date' },
  warm: { name: 'Keep My Fifty warm', action: 'quiet My Fifty accounts visited' },
  grow: { name: 'Grow current accounts', action: 'current accounts shown a second line' },
  fill: { name: 'Fill the pipeline', action: 'warm leads given samples or onboarding' },
  events: { name: 'Fill the next event', action: 'customers invited in person' },
};

// The Monday of the Toronto week a day is in, and the moments the week starts and ends.
function weekOf(day) {
  const d = day || T.ymd();
  const mon = T.addDays(d, -((T.weekday(d) + 6) % 7));
  return { mon, start: T.atLocal(mon, 0, 0), end: T.atLocal(T.addDays(mon, 7), 0, 0) };
}

// "3 sampled clinics asked for an order date" (no number when the session has none).
function focusLine(key, n) {
  const g = GOALS[key];
  if (!g) return '';
  return (n ? n + ' ' : '') + g.action;
}

// "5 visits · 3 calls"
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const countLine = (visits, calls) => plural(visits, 'visit', 'visits') + ' · ' + plural(calls, 'call', 'calls');

// This week's saved weekly session for the rep, or null.
async function session(sql, me, day) {
  if (!(await B.hasCompass(sql))) return null;
  const wk = weekOf(day);
  const [s] = await sql`
    select o.id, o.checkin_id, o.focus_action_target_count, o.week_confirmed_at
      from one_on_ones o join checkins ck on ck.id = o.checkin_id
     where o.rep_id = ${me.id} and ck.rep_id = ${me.id} and o.kind = 'weekly' and o.deleted_at is null and o.completed_at is not null
       and ck.week_start_date = ${wk.mon}
     order by o.session_date desc, o.created_at desc limit 1`;
  return s || null;
}

// Today's week block: null when there is no saved session this week.
async function view(sql, me) {
  const s = await session(sql, me);
  if (!s) return null;
  const wk = weekOf();
  // The focus: a goal key (set on Edge Home), or since 2026-10-27 the typed focus from the 1-on-1 (title = the line).
  const [goal] = await sql`
    select title from tasks where assignee_id = ${me.id} and source = 'one_on_one' and deleted_at is null
       and (title = any(${Object.keys(GOALS)}) or one_on_one_id is not null) and due_at >= ${wk.start} and due_at < ${wk.end}
     order by created_at desc limit 1`;
  const picks = await sql`
    select ap.id, ap.contact_id, ap.final_pick::text as pick, ap.purpose, ap.missed_at, ap.visit_interaction_id,
           c.first_name, c.last_name, c.designation, c.email, cl.name as clinic, i.occurred_at as done_at
      from account_picks ap
      join contacts c on c.id = ap.contact_id
      left join clinics cl on cl.id = c.clinic_id
      left join interactions i on i.id = ap.visit_interaction_id and i.deleted_at is null
     where ap.checkin_id = ${s.checkin_id} and ap.final_pick in ('visit', 'call') and c.deleted_at is null
     order by c.first_name, c.last_name, ap.id`;
  const callIds = picks.filter((p) => p.pick === 'call').map((p) => p.contact_id);
  // A call is shown as done once the rep reached them by phone this week (read only; logging works as always).
  const called = callIds.length ? await sql`
    select i.contact_id, max(i.occurred_at) as at from interactions i
     where i.contact_id = any(${callIds}) and i.user_id = ${me.id} and i.deleted_at is null and i.occurred_at >= ${wk.start}
       and i.status is distinct from 'scheduled' and i.status is distinct from 'cancelled'
       and ${B.CALL(sql)} and not ${B.INBOUND(sql)} and ${B.REACHED(sql)}
     group by i.contact_id` : [];
  const calledAt = Object.fromEntries(called.map((r) => [r.contact_id, r.at]));
  const row = (p) => ({ id: p.id, contactId: p.contact_id, name: B.fullName(p), clinic: p.clinic || '', purpose: p.purpose || '' });
  const visits = picks.filter((p) => p.pick === 'visit').map((p) => Object.assign(row(p), {
    state: p.visit_interaction_id && p.done_at ? 'done' : p.missed_at ? 'missed' : 'open',
    when: p.visit_interaction_id && p.done_at ? dayName(p.done_at) : p.missed_at ? dayName(p.missed_at) : '',
  }));
  const calls = picks.filter((p) => p.pick === 'call').map((p) => Object.assign(row(p), {
    state: calledAt[p.contact_id] ? 'done' : 'open', when: calledAt[p.contact_id] ? dayName(calledAt[p.contact_id]) : '',
  }));
  const g = goal ? GOALS[goal.title] : null;
  return {
    id: s.id, confirmed: !!s.week_confirmed_at,
    focus: g ? { key: goal.title, name: g.name, line: focusLine(goal.title, s.focus_action_target_count), target: s.focus_action_target_count || null }
      : goal ? { key: 'custom', name: 'This week’s focus', line: goal.title, target: null } : null,
    counts: countLine(visits.length, calls.length), visits, calls,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = (at) => DAYS[T.weekday(T.ymd(at))];

// Done: a reached visit the rep just logged closes this week's agreed visit for that contact (inside the log's
// transaction). A visit marked Missed earlier in the week becomes Done (it happened after all).
async function linkVisit(tx, me, contactId, interactionId) {
  const s = await session(tx, me);
  if (!s) return null;
  const [r] = await tx`
    update account_picks set visit_interaction_id = ${interactionId}, missed_at = null
     where checkin_id = ${s.checkin_id} and contact_id = ${contactId} and final_pick = 'visit' and visit_interaction_id is null
     returning id`;
  return r ? r.id : null;
}

// Undoing the log takes the Done back.
async function unlinkVisit(tx, interactionId) {
  if (!(await B.hasCompass(tx))) return;
  await tx`update account_picks set visit_interaction_id = null where visit_interaction_id = ${interactionId}`;
}

module.exports = { GOALS, weekOf, focusLine, countLine, session, view, linkVisit, unlinkVisit, dayName };
