// Test run 2026-10-21: rep vs rep and rep vs admin through the local servers (one per person, test/serve.js).
// Bravo (5202) tries every read and write on Alpha's (5201) people, orders and logs; then bad input everywhere.
//   node --require ./test/run/no-network.js test/run/access.js
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'test/helpers'));
const { db } = require(path.join(ROOT, 'api/_db'));

const ALPHA = 'http://localhost:5201', BRAVO = 'http://localhost:5202', ADMIN = 'http://localhost:5203';
let pass = 0, fail = 0;
const out = [];
function ok(c, what, extra) { if (c) pass++; else { fail++; out.push('FAIL ' + what + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : '')); } }
const get = (base, op, params) => fetch(base + '/api/data?' + new URLSearchParams(Object.assign({ op }, params || {})), { headers: { Authorization: 'Bearer x' } })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const post = (base, body, raw) => fetch(base + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw !== undefined ? raw : JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

(async () => {
  const sql = db();
  const [a] = await sql`select id from users where email = 'test.alpha@demo.invalid'`;
  const [b] = await sql`select id from users where email = 'test.bravo@demo.invalid'`;
  const alphaPeople = (await sql`select id, legacy_id from contacts where owner_id = ${a.id}`).filter((p) => p.legacy_id);
  const by = Object.fromEntries(alphaPeople.map((p) => [p.legacy_id.replace('demo-test-', ''), p.id]));
  const alphaOrders = await sql`select o.id, o.legacy_id from orders o join contacts c on c.id = o.contact_id where c.owner_id = ${a.id}`;
  const ord = Object.fromEntries(alphaOrders.filter((o) => o.legacy_id).map((o) => [o.legacy_id.replace('demo-test-order-', ''), o.id]));
  const [ai] = await sql`select id from interactions where user_id = ${a.id} and contact_id = ${by['a-fifty-visited']} limit 1`;
  const [task] = await sql`select id from tasks where assignee_id = ${a.id} limit 1`;
  const [onb] = await sql`select id from onboardings where primary_contact_id = ${by['a-onb-md']}`;
  const before = await sql`select (select count(*) from interactions where contact_id = any(${Object.values(by)}))::int i, (select count(*) from tasks where contact_id = any(${Object.values(by)}))::int t,
    (select count(*) from orders where contact_id = any(${Object.values(by)}))::int o, (select md5(string_agg(c::text, '' order by id)) from contacts c where id = any(${Object.values(by)})) h,
    (select settings::text from users where id = ${a.id}) s`;

  // ---- reads: Bravo on Alpha's things ----
  for (const op of ['person', 'history', 'products', 'onboarding']) {
    for (const k of ['a-fifty-card', 'a-cand-waiting', 'a-new-social', 'a-onb-md']) {
      const r = await get(BRAVO, op, { id: by[k] });
      ok(r.status === 404, 'bravo cannot read ' + op + ' of ' + k, r);
    }
  }
  for (const k of Object.keys(ord)) {
    const r = await get(BRAVO, 'order', { id: ord[k] });
    ok(r.status === 404, 'bravo cannot read order ' + k, r.status);
  }
  const s = await get(BRAVO, 'search', { q: 'test' });
  ok(s.status === 200 && !s.body.people.some((p) => Object.values(by).includes(p.id)), 'bravo search never shows alpha people');
  const s2 = await get(BRAVO, 'search', { q: '' });
  ok(!s2.body.people.some((p) => Object.values(by).includes(p.id)), 'bravo empty search never shows alpha people');
  for (const g of ['social', 'event', 'warm', 'cold']) {
    const r = await get(BRAVO, 'leads', { group: g });
    ok(!r.body.leads.some((p) => Object.values(by).includes(p.id)), 'bravo leads/' + g + ' has no alpha people');
  }
  const pb = await get(BRAVO, 'people');
  ok(!pb.body.all.some((p) => Object.values(by).includes(p.id)), 'bravo people list has no alpha people');
  const rb = await get(BRAVO, 'ready');
  ok(!rb.body.people.some((p) => Object.values(by).includes(p.id)), 'bravo ready list has no alpha people');
  const tb = await get(BRAVO, 'today');
  ok(!tb.body.list.some((p) => Object.values(by).includes(p.id)), 'bravo today has no alpha people');
  // The order Alpha is credited on, for a person who moved to Bravo: Alpha may see the order (the RLS rule does the same).
  const [moved] = await sql`select id from orders where legacy_id = 'demo-test-order-b-moved'`;
  const am = await get(ALPHA, 'order', { id: moved.id });
  ok(am.status === 200, 'alpha still sees the order she is credited on after the person moved', am.status);
  const amp = await get(ALPHA, 'person', { id: am.body && am.body.contactId });
  ok(amp.status === 404, 'but not the person themselves', amp.status);

  // ---- writes: Bravo on Alpha's things ----
  const W = [
    ['log', { contactId: by['a-warm'], kind: 'call', reached: true, followUp: 'tomorrow', note: 'Sneaky call' }],
    ['snooze', { contactId: by['a-overdue'], taskId: task.id }],
    ['set_follow_up', { contactId: by['a-warm'], date: '2030-01-01' }],
    ['set_uses', { contactId: by['a-warm'], fillers: ['saypha'] }],
    ['invoice_email', { contactId: by['a-warm'], email: 'steal@demo.invalid' }],
    ['order', { contactId: by['a-onb-done'], lines: [{ sku: 'SAF100', qty: 1 }] }],
    ['order', { contactId: by['a-onb-done'], kind: 'samples', lines: [{ sku: 'SAL400', qty: 1 }], mdName: 'Dr X', mdEmail: 'x@demo.invalid' }],
    ['resend_pay_link', { orderId: ord['a-card-2'] }],
    ['remind_md', { orderId: ord['a-cand-waiting'] }],
    ['remind_md', { onboardingId: onb.id }],
    ['voice', { contactId: by['a-warm'], audio: 'AAAA', mime: 'audio/webm' }],
    ['email', { contactId: by['a-warm'], subject: 'hi', text: 'hi' }],
    ['undo', { interactionId: ai.id }],
    ['edit_note', { interactionId: ai.id, body: 'Rewritten by someone else' }],
  ];
  for (const [op, body] of W) {
    const r = await post(BRAVO, Object.assign({ op }, body));
    ok([404, 503].includes(r.status) && !(r.body && r.body.ok), 'bravo cannot ' + op + ' on alpha', r);
  }
  // Admin (Charlie) also has only their own book in My Fifty
  const ar = await get(ADMIN, 'person', { id: by['a-fifty-card'] });
  out.push('INFO admin reading a rep\'s person in My Fifty: HTTP ' + ar.status);

  // ---- bad input ----
  const BAD = ['', 'x', '1 or 1=1', "'; drop table contacts; --", '00000000-0000-0000-0000-000000000000', 'ZZZZZZZZ-0000-0000-0000-000000000000', 'a'.repeat(5000)];
  for (const op of ['person', 'history', 'products', 'order', 'onboarding']) {
    for (const v of BAD) {
      const r = await get(ALPHA, op, { id: v });
      ok([400, 404].includes(r.status), 'bad id refused: ' + op + ' ' + v.slice(0, 20), r);
    }
  }
  for (const g of ['', 'SOCIAL', 'admin', '__proto__', 'constructor']) {
    const r = await get(ALPHA, 'leads', { group: g });
    ok(r.status === 400, 'bad lead group refused: ' + g, r);
  }
  for (const op of ['', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'config2']) {
    const r = await get(ALPHA, op);
    ok(r.status === 400, 'unknown read op refused: ' + op, r);
    const w = await post(ALPHA, { op });
    ok(w.status === 400, 'unknown write op refused: ' + op, w);
  }
  // Junk JSON bodies are tested on the handler itself (test/db/testrun-fixes.test.js): test/serve.js parses bodies itself and stops on junk.
  const sq = await get(ALPHA, 'search', { q: "%' or 1=1 --" });
  ok(sq.status === 200 && sq.body.people.length === 0, 'search with SQL text finds nothing and does not fail', sq.status);

  const after = await sql`select (select count(*) from interactions where contact_id = any(${Object.values(by)}))::int i, (select count(*) from tasks where contact_id = any(${Object.values(by)}))::int t,
    (select count(*) from orders where contact_id = any(${Object.values(by)}))::int o, (select md5(string_agg(c::text, '' order by id)) from contacts c where id = any(${Object.values(by)})) h,
    (select settings::text from users where id = ${a.id}) s`;
  ok(JSON.stringify(before) === JSON.stringify(after), 'nothing of alpha changed', { before: before[0], after: after[0] });
  console.log(out.join('\n'));
  console.log(pass + ' passed, ' + fail + ' failed');
  await sql.end();
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
