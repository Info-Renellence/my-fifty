// The week in Pulse (Compass, db/v2-010-compass.sql): focus, Confirm my week, Done and Missed visits, calls, parked
// accounts, and access between reps. Rolled back, test database (v1) only. Fake rows are marked: users and people
// @demo.invalid, people legacy_id 'demo-test-…' (db/wipe-demo.sql removes them and their Compass rows).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');
const W = require('../../api/_week');
const A = require('../../api/act').OPS;
const D = require('../../api/data').OPS;
const T = require('../../api/_time');

after(h.closeDb);

const rep = (sql, o) => h.user(sql, Object.assign({ email: 'demo-test-week.' + h.uid() + '@demo.invalid', name: 'Testy Weekrep' }, o || {}));
async function person(sql, owner, o) {
  const id = await h.contact(sql, owner, Object.assign({ email: 'demo-test-week.' + h.uid() + '@demo.invalid' }, o || {}));
  await sql`update contacts set legacy_id = ${'demo-test-week-' + h.uid()} where id = ${id}`;
  return id;
}
// A saved weekly 1-on-1 for the rep's week (Monday `mon`, default this week), its focus goal and the agreed picks.
// picks: [[contactId, final_pick, purpose]]
async function week(sql, me, o) {
  const x = o || {};
  const mon = x.mon || W.weekOf().mon;
  const [ck] = await sql`insert into checkins (rep_id, week_start_date, submitted_at) values (${me.id}, ${mon}, now()) returning id`;
  const [s] = await sql`insert into one_on_ones (kind, rep_id, session_date, checkin_id, focus_action_target_count, completed_at)
    values ('weekly', ${me.id}, ${mon}, ${ck.id}, ${x.target === undefined ? 3 : x.target}, ${x.saved === false ? null : new Date()}) returning id`;
  if (x.goal !== null) {
    await sql`insert into tasks (assignee_id, created_by_id, title, kind, status, source, due_at, one_on_one_id)
      values (${me.id}, ${me.id}, ${x.goal || 'close'}, 'todo', 'open', 'one_on_one', ${T.atLocal(T.addDays(mon, 6), 23, 59)}, ${s.id})`;
  }
  const picks = {};
  for (const [cid, pick, purpose] of x.picks || []) {
    const [p] = await sql`insert into account_picks (checkin_id, contact_id, sort_group, suggested_pick, suggested_reason, rep_pick, final_pick, purpose)
      values (${ck.id}, ${cid}, 'candidate', ${pick}, 'Samples 20 days ago · no order yet', ${pick}, ${pick}, ${purpose || null}) returning id`;
    picks[cid] = p.id;
  }
  return { checkinId: ck.id, sessionId: s.id, picks };
}
const visitLog = (me, contactId, reached) => A.log(me, { kind: 'visit', contactId, note: 'Dropped by the clinic', followUp: 'tomorrow', reached: reached !== false });

test('focus: the goal name and "<n> <weekly action>", the counts, and nothing before the 1-on-1 is saved', () => h.withDb(async (sql) => {
  const me = await rep(sql);
  assert.equal(await W.view(sql, me), null, 'no session: no week block');
  const a = await person(sql, me, { first: 'Vera' }), b = await person(sql, me, { first: 'Walt' }), c = await person(sql, me, { first: 'Xena' });
  await week(sql, me, { goal: 'close', target: 3, picks: [[a, 'visit', 'Ask for the first order date'], [b, 'visit'], [c, 'call', 'Check stock']] });
  // A later goal for the same week wins (the latest row), as on Edge's Home.
  await sql`insert into tasks (assignee_id, created_by_id, title, kind, status, source, due_at) values (${me.id}, ${me.id}, 'warm', 'todo', 'open', 'one_on_one', ${new Date(W.weekOf().end - 60000)})`;
  await sql`update tasks set created_at = now() + interval '1 minute' where assignee_id = ${me.id} and title = 'warm'`;
  const w = await W.view(sql, me);
  assert.deepEqual(w.focus, { key: 'warm', name: 'Keep My Fifty warm', line: '3 quiet My Fifty accounts visited', target: 3 });
  assert.equal(w.confirmed, false);
  assert.equal(w.counts, '2 visits · 1 call');
  assert.deepEqual(w.visits.map((v) => [v.name.split(' ')[0], v.purpose, v.state]), [['Vera', 'Ask for the first order date', 'open'], ['Walt', '', 'open']]);
  assert.deepEqual(w.calls.map((v) => [v.name.split(' ')[0], v.purpose, v.state]), [['Xena', 'Check stock', 'open']]);
  const t = await D.today(sql, me);
  assert.equal(t.week.id, w.id, 'Today carries the week');
  // Nothing on the screen speaks of suggestions or changes.
  assert.doesNotMatch(JSON.stringify(t.week), /suggest|AI|changed/i);
}));

test('focus: an unsaved session, or last week\'s, shows nothing; a session with no goal still shows the week', () => h.withDb(async (sql) => {
  const me = await rep(sql);
  await week(sql, me, { saved: false });
  assert.equal(await W.view(sql, me), null, 'not saved yet');
  const other = await rep(sql);
  await week(sql, other, { mon: T.addDays(W.weekOf().mon, -7) });
  assert.equal(await W.view(sql, other), null, 'last week');
  const third = await rep(sql);
  await week(sql, third, { goal: null, target: null });
  const w = await W.view(sql, third);
  assert.equal(w.focus, null);
  assert.equal(w.counts, '0 visits · 0 calls');
  assert.equal(W.focusLine('close', null), 'sampled clinics asked for an order date');
}));

test('confirm: the rep confirms their own week once (logged from my_fifty); nobody else can', () => h.withDb(async (sql) => {
  const me = await rep(sql), other = await rep(sql), admin = await rep(sql, { kind: 'admin' });
  const wk = await week(sql, me);
  await assert.rejects(A.confirm_week(other), (e) => e.status === 404 && e.message === 'no_week');
  await assert.rejects(A.confirm_week(admin), (e) => e.status === 404 && e.message === 'no_week', 'an admin cannot confirm a rep\'s week');
  assert.equal((await sql`select week_confirmed_at from one_on_ones where id = ${wk.sessionId}`)[0].week_confirmed_at, null);
  assert.deepEqual(await A.confirm_week(me), { ok: true });
  const [s] = await sql`select week_confirmed_at from one_on_ones where id = ${wk.sessionId}`;
  assert.ok(s.week_confirmed_at);
  const [l] = await sql`select actor_user_id, source::text from change_logs where entity_id = ${wk.sessionId} and action = 'update' and field_name = 'week_confirmed_at' order by changed_at desc limit 1`;
  assert.deepEqual([l.actor_user_id, l.source], [me.id, 'my_fifty']);
  await A.confirm_week(me);   // a second tap changes nothing
  assert.deepEqual((await sql`select week_confirmed_at from one_on_ones where id = ${wk.sessionId}`)[0], s);
  assert.equal((await W.view(sql, me)).confirmed, true);
}));

test('Done: a reached visit logged this week links the agreed visit; a no-show or a call does not; undo unlinks', () => h.withDb(async (sql) => {
  const me = await rep(sql);
  const a = await person(sql, me), b = await person(sql, me);
  const wk = await week(sql, me, { picks: [[a, 'visit', 'Bring samples'], [b, 'call']] });
  const noShow = await visitLog(me, a, false);
  assert.equal(noShow.weekVisitId, null, 'a no-show is not a visit');
  const call = await A.log(me, { kind: 'call', contactId: b, note: 'Called them', followUp: 'tomorrow', reached: true });
  assert.equal(call.weekVisitId, null);
  const r = await visitLog(me, a);
  assert.equal(r.weekVisitId, wk.picks[a]);
  const [p] = await sql`select visit_interaction_id, missed_at from account_picks where id = ${wk.picks[a]}`;
  assert.deepEqual(p, { visit_interaction_id: r.interactionId, missed_at: null });
  const [l] = await sql`select source::text from change_logs where entity_id = ${wk.picks[a]} and action = 'update' and field_name = 'visit_interaction_id' order by changed_at desc limit 1`;
  assert.equal(l.source, 'my_fifty');
  const w = await W.view(sql, me);
  assert.equal(w.visits[0].state, 'done');
  assert.equal(w.visits[0].when, W.dayName(new Date()));
  assert.equal(w.calls[0].state, 'done', 'the reached call shows as done');
  await A.undo(me, { interactionId: r.interactionId, closedTaskIds: r.closedTaskIds });
  assert.equal((await sql`select visit_interaction_id from account_picks where id = ${wk.picks[a]}`)[0].visit_interaction_id, null);
  assert.equal((await W.view(sql, me)).visits[0].state, 'open');
}));

test('Missed: marks an open visit missed, undo takes it back; a visit logged later makes it Done; a Done visit cannot be missed', () => h.withDb(async (sql) => {
  const me = await rep(sql);
  const a = await person(sql, me), b = await person(sql, me), c = await person(sql, me);
  const wk = await week(sql, me, { picks: [[a, 'visit'], [b, 'visit'], [c, 'call']] });
  await assert.rejects(A.visit_missed(me, { pickId: 'nope' }), (e) => e.status === 400);
  await assert.rejects(A.visit_missed(me, { pickId: wk.picks[c] }), (e) => e.status === 404, 'only visits');
  assert.deepEqual(await A.visit_missed(me, { pickId: wk.picks[a] }), { ok: true });
  assert.ok((await sql`select missed_at from account_picks where id = ${wk.picks[a]}`)[0].missed_at);
  assert.equal((await W.view(sql, me)).visits.find((v) => v.contactId === a).state, 'missed');
  await A.visit_missed(me, { pickId: wk.picks[a], undo: true });
  assert.equal((await sql`select missed_at from account_picks where id = ${wk.picks[a]}`)[0].missed_at, null);
  assert.equal((await W.view(sql, me)).visits.find((v) => v.contactId === a).state, 'open');
  // Missed, then visited after all: Done.
  await A.visit_missed(me, { pickId: wk.picks[b] });
  const r = await visitLog(me, b);
  assert.deepEqual(await sql`select visit_interaction_id, missed_at from account_picks where id = ${wk.picks[b]}`.then((x) => x[0]), { visit_interaction_id: r.interactionId, missed_at: null });
  await assert.rejects(A.visit_missed(me, { pickId: wk.picks[b] }), (e) => e.status === 409 && e.message === 'already_done');
}));

test('parked: the latest agreed pick "park" hides them from Today until the Monday + park_days', () => h.withDb(async (sql) => {
  const me = await rep(sql);
  // Two Fifty people going cold: both would be on Today.
  const a = await person(sql, me, { first: 'Parky' }), b = await person(sql, me, { first: 'Freddy' });
  for (const c of [a, b]) await h.order(sql, c, me, { days: 45, paid: true, status: 'paid' });
  const before = (await D.today(sql, me)).list.map((x) => x.id);
  assert.ok(before.includes(a) && before.includes(b));
  const mon = W.weekOf().mon;
  await week(sql, me, { picks: [[a, 'park']] });
  const parked = await B.parkedUntil(sql, [a, b]);
  const [cfg] = await sql`select value from settings where key = 'compass'`;
  const days = (cfg && cfg.value.park_days) || 30;
  assert.deepEqual(parked, { [a]: T.addDays(mon, days) });
  const list = (await D.today(sql, me)).list.map((x) => x.id);
  assert.ok(!list.includes(a), 'parked: hidden');
  assert.ok(list.includes(b));
  assert.deepEqual(await B.parkedUntil(sql, [a], { today: T.addDays(mon, days) }), {}, 'back on their date');
  assert.deepEqual(await B.parkedUntil(sql, [a], { days: 3, today: T.addDays(mon, 2) }), { [a]: T.addDays(mon, 3) });
  // A pick with no final_pick yet (the next Friday, not agreed) does not end it; an agreed later pick does.
  const next = T.addDays(mon, 7);
  const [ck] = await sql`insert into checkins (rep_id, week_start_date) values (${me.id}, ${next}) returning id`;
  const [p] = await sql`insert into account_picks (checkin_id, contact_id, sort_group, suggested_pick, suggested_reason, rep_pick)
    values (${ck.id}, ${a}, 'fifty', 'visit', 'Going quiet', 'visit') returning id`;
  assert.ok((await B.parkedUntil(sql, [a]))[a], 'not agreed yet: still parked');
  await sql`update account_picks set final_pick = 'visit' where id = ${p.id}`;
  assert.deepEqual(await B.parkedUntil(sql, [a]), {}, 'agreed Visit: not parked');
  // An old park (40 days ago) has run out.
  const c = await person(sql, me);
  const old = await rep(sql);
  await week(sql, old, { mon: T.addDays(mon, -42), picks: [[c, 'park']] });
  assert.deepEqual(await B.parkedUntil(sql, [c]), {});
  assert.deepEqual(await B.parkedUntil(sql, []), {});
}));

test('access: a rep sees and changes only their own week', () => h.withDb(async (sql) => {
  const me = await rep(sql), other = await rep(sql);
  const a = await person(sql, me), z = await person(sql, other);
  const mine = await week(sql, me, { picks: [[a, 'visit']] });
  const theirs = await week(sql, other, { goal: 'grow', picks: [[z, 'visit']] });
  const w = await W.view(sql, me);
  assert.deepEqual(w.visits.map((v) => v.contactId), [a], 'only my picks');
  assert.equal(w.focus.key, 'close', 'my goal, not theirs');
  await assert.rejects(A.visit_missed(me, { pickId: theirs.picks[z] }), (e) => e.status === 404);
  await assert.rejects(A.visit_missed(other, { pickId: mine.picks[a] }), (e) => e.status === 404);
  assert.equal((await sql`select missed_at from account_picks where id = ${mine.picks[a]}`)[0].missed_at, null);
  // Logging a visit to a contact on someone else's plan never closes their pick.
  await sql`update contacts set owner_id = ${me.id} where id = ${z}`;
  const r = await visitLog(me, z);
  assert.equal(r.weekVisitId, null);
  assert.equal((await sql`select visit_interaction_id from account_picks where id = ${theirs.picks[z]}`)[0].visit_interaction_id, null);
  await A.confirm_week(other);
  assert.equal((await W.view(sql, me)).confirmed, false, 'their confirmation is not mine');
}));

test('wipe-demo.sql removes the demo week rows (Compass tables) and nothing else', () => h.withDb(async (sql) => {
  const s = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'db', 'wipe-demo.sql'), 'utf8');
  const temps = s.match(/create temp table [\s\S]*?;/g);
  // change_logs is append-only for this login; the real wipe runs it with triggers off.
  const block = s.match(/do \$\$[\s\S]*?end \$\$;/)[0].replace(/^\s*delete from change_logs.*$/m, '');
  for (const t of ['checkins', 'one_on_ones', 'account_picks', 'forecast_changes', 'fifty_statuses']) assert.match(block, new RegExp('delete from ' + t + ' '));
  const me = await rep(sql);
  const real = await h.user(sql, { email: 'real.' + h.uid() + '@test.invalid' });
  const a = await person(sql, me), keep = await h.contact(sql, real);
  const mine = await week(sql, me, { picks: [[a, 'visit']] });
  const theirs = await week(sql, real, { picks: [[keep, 'call']] });
  for (const t of temps) await sql.unsafe(t);
  await sql.unsafe(block);
  assert.equal((await sql`select count(*)::int n from checkins where id = ${mine.checkinId}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int n from one_on_ones where id = ${mine.sessionId}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int n from tasks where one_on_one_id = ${mine.sessionId}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int n from account_picks where checkin_id = ${theirs.checkinId}`)[0].n, 1, 'real rows stay');
  assert.equal((await sql`select count(*)::int n from one_on_ones where id = ${theirs.sessionId}`)[0].n, 1);
}));
