// Feature switches in Pulse (api/_flags.js, data map risk #3, 2026-10-23): with the settings row 'flags' turning a
// switch off, the feature is gone for the rep; without the row everything stays as it is today. On the TEST database
// (v1) only, each test rolled back; the order-dispatch columns (renellence-edge/db/v2-011-order-dispatch.sql, not applied
// anywhere) are applied inside each test's transaction (V2_PRACTICE_SQL), as in dispatch.test.js. n8n is faked.
//   node --test test/db/flags.test.js
const path = require('path');
process.env.V2_PRACTICE_SQL = process.env.V2_PRACTICE_SQL || path.join(__dirname, '..', '..', '..', 'renellence-edge', 'db', 'v2-011-order-dispatch.sql');
const { test, describe, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const F = require('../../api/_flags');
const W = require('../../api/_week');
const A = require('../../api/act').OPS;
const Dt = require('../../api/data').OPS;
const cron = require('../../api/cron')._;

let f;
beforeEach(F.clear);
afterEach(() => { F.clear(); if (f) f.restore(); f = null; delete process.env.N8N_MYFIFTY_URL; delete process.env.GEMINI_API_KEY; });
after(() => h.closeDb());

const tag = () => 'demo-test-flags-' + h.uid();
const rep = (sql) => h.user(sql, { email: 'demo-test-flags.' + h.uid() + '@demo.invalid', name: 'Testy Flagrep' });
async function setFlags(sql, v) {
  await sql`insert into settings (key, value) values ('flags', ${sql.json(v)}) on conflict (key) do update set value = excluded.value`;
  F.clear();
}
// A saved weekly 1-on-1 with one agreed visit, so Today has a week block.
async function week(sql, me) {
  const c = await h.contact(sql, me);
  await sql`update contacts set legacy_id = ${tag()} where id = ${c}`;
  const mon = W.weekOf().mon;
  const [ck] = await sql`insert into checkins (rep_id, week_start_date, submitted_at) values (${me.id}, ${mon}, now()) returning id`;
  await sql`insert into one_on_ones (kind, rep_id, session_date, checkin_id, focus_action_target_count, completed_at) values ('weekly', ${me.id}, ${mon}, ${ck.id}, 3, now())`;
  await sql`insert into account_picks (checkin_id, contact_id, sort_group, suggested_pick, suggested_reason, rep_pick, final_pick)
    values (${ck.id}, ${c}, 'candidate', 'visit', 'test', 'visit', 'visit')`;
  return c;
}
async function ready(sql, me) {
  const c = await h.contact(sql, me);
  await sql`update contacts set legacy_id = ${tag()} where id = ${c}`;
  await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
  return c;
}
const dispatchOn = (sql) => sql`update settings set value = value || ${sql.json({ pulse: true })} where key = 'order_dispatch'`;

describe('flags in Pulse', () => {
  test('no flags row: the week shows, voice is offered, all as today', () => h.withDb(async (sql) => {
    await sql`delete from settings where key = 'flags'`;
    process.env.GEMINI_API_KEY = 'test-key';
    const me = await rep(sql);
    await week(sql, me);
    assert.ok((await Dt.today(sql, me)).week, 'week block on Today');
    const b = await Dt.boot(sql, me);
    assert.equal(b.voice, true);
    assert.deepEqual(b.features, { weekView: true, voiceNotes: true, claudeSuggestions: false });
  }));

  test('week_view off: no week block on Today, and Confirm my week is refused', () => h.withDb(async (sql) => {
    const me = await rep(sql);
    await week(sql, me);
    await setFlags(sql, { week_view: false });
    const t = await Dt.today(sql, me);
    assert.equal(t.week, null);
    assert.ok(Array.isArray(t.list), 'the rest of Today is unchanged');
    await assert.rejects(A.confirm_week(me), (e) => e.status === 404 && e.message === 'feature_off');
    await setFlags(sql, { week_view: true });
    assert.ok((await Dt.today(sql, me)).week, 'back on: the week is back');
  }));

  test('week_view off: Missed on a week visit is refused too, and works again once it is back on (R3B-2)', () => h.withDb(async (sql) => {
    const me = await rep(sql);
    const c = await week(sql, me);
    const [p] = await sql`select ap.id from account_picks ap join checkins ck on ck.id = ap.checkin_id where ck.rep_id = ${me.id} and ap.contact_id = ${c}`;
    await setFlags(sql, { week_view: false });
    await assert.rejects(A.visit_missed(me, { pickId: p.id }), (e) => e.status === 404 && e.message === 'feature_off');
    const [still] = await sql`select missed_at from account_picks where id = ${p.id}`;
    assert.equal(still.missed_at, null, 'nothing written');
    await setFlags(sql, { week_view: true });
    assert.deepEqual(await A.visit_missed(me, { pickId: p.id }), { ok: true });
  }));

  test('voice_notes off: the mic is not offered and a recording is refused', () => h.withDb(async (sql) => {
    process.env.GEMINI_API_KEY = 'test-key';
    const me = await rep(sql);
    const c = await h.contact(sql, me);
    await setFlags(sql, { voice_notes: false });
    const b = await Dt.boot(sql, me);
    assert.equal(b.voice, false);
    assert.equal(b.features.voiceNotes, false);
    await assert.rejects(A.voice(me, { contactId: c, audio: 'AAAA', mime: 'audio/webm' }), (e) => e.status === 404 && e.message === 'feature_off');
  }));

  test('claude_suggestions: off until turned on', () => h.withDb(async (sql) => {
    const me = await rep(sql);
    await sql`delete from settings where key = 'flags'`;
    assert.equal((await Dt.boot(sql, me)).features.claudeSuggestions, false);
    await setFlags(sql, { claude_suggestions: true });
    assert.equal((await Dt.boot(sql, me)).features.claudeSuggestions, true);
  }));

  test('order_dispatch off: the old send even with order_dispatch.pulse on; the tick skips dispatch retries', () => h.withDb(async (sql) => {
    await dispatchOn(sql);
    await setFlags(sql, { order_dispatch: false });
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await rep(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, true);
    assert.equal(r.queued, undefined, 'not the dispatch answer');
    const [s] = await sql`select dispatch_status::text s, dispatch_attempts n from orders where id = ${r.orderId}`;
    assert.equal(s.s, null); assert.equal(s.n, 0);
    const out = await cron.sendOrders(sql);
    assert.equal(out.dispatch, 'off_by_flag');
  }));

  test('order_dispatch on (the default) leaves the dispatch switch in charge', () => h.withDb(async (sql) => {
    await dispatchOn(sql);
    await sql`delete from settings where key = 'flags'`;
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await rep(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    const [s] = await sql`select dispatch_status::text s from orders where id = ${r.orderId}`;
    assert.equal(s.s, 'sent', 'the dispatch path ran');
  }));

});
