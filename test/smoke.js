// Smoke test against the real v2 database with the demo data (db/seed-demo.sql): every read, and the writes that
// can be undone (log + undo, snooze, follow-up, uses, a person who is then removed). Signs in as the demo owner
// without Google (reads users directly). Needs .env.local (vercel env pull).
//   node test/smoke.js [owner-email]     (runs itself through test/run/smoke-rollback.js: nothing it writes is kept)
//
// Date-proof (2026-10-22): the checks that depend on today (done today, streak, the new Meta lead, four going cold,
// a going-cold customer waiting on payment with a pay link to resend) run on fresh fake rows it makes for a fake rep,
// dated from today, so they never depend on the aging demo data or on rows other testing changed.
const fs = require('fs');
const path = require('path');
if (require.main === module) {   // the fake rows must be rolled back: always run inside the harness's transaction
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'run', 'smoke-rollback.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = r.status == null ? 1 : r.status;
  return;
}
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { db } = require('../api/_db');
const data = require('../api/data');
const act = require('../api/act');
const T = require('../api/_time');

// Fresh fake rows for the date checks (marked demo-smoke-..., @demo.invalid; rolled back by the harness).
async function dateRows(sql) {
  const tag = 'demo-smoke-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const [u] = await sql`insert into users (email, name, kind, active, settings) values (${tag + '@demo.invalid'}, 'Smoke Testrep', 'rep', true, '{}'::jsonb)
    returning id, email, name, kind, settings`;
  const sm = { id: u.id, email: u.email, name: u.name, first: 'Smoke', initials: 'ST', kind: u.kind, settings: {} };
  let n = 0;
  const person = async (o) => (await sql`insert into contacts (owner_id, first_name, last_name, email, designation, source_kind, created_at, legacy_id)
    values (${sm.id}, ${o.first}, 'Smokecase', ${tag + '.' + (++n) + '@demo.invalid'}, ${o.designation || null}, ${o.source || 'warm'}, ${o.createdAt || new Date()}, ${tag + '-c' + n}) returning id`)[0].id;
  const order = async (contactId, days, o) => {
    const at = new Date(Date.now() - days * 86400000);
    const [r] = await sql`insert into orders (contact_id, rep_id, placed_by, channel, status, submitted_at, approved_at, payment_method, delivered_at, created_at, legacy_id)
      values (${contactId}, ${sm.id}, ${sm.id}, 'stripe', ${o.status}, ${at}, ${at}, ${o.method}, ${o.status === 'delivered' ? at : null}, ${at}, ${tag + '-o' + (++n)}) returning id`;
    await sql`insert into order_lines (order_id, product_id, sku, name, quantity, unit_price, list_price, is_free)
      select ${r.id}, id, sku, name, 2, list_price, list_price, false from products where sku = 'SAF100'`;
    if (o.payLink) await sql`insert into payments (order_id, kind, method, amount, currency, status, provider, pay_link_url, is_test)
      values (${r.id}, 'charge', 'pay_link', 450, 'CAD', 'pending', 'stripe', 'https://pay.demo.invalid/smoke', false)`;
    return r.id;
  };
  const call = (contactId, at) => sql`insert into interactions (kind, contact_id, user_id, occurred_at, direction, mode, status, outcome, source, created_by)
    values ('call', ${contactId}, ${sm.id}, ${at}, 'out', 'phone', 'completed', 'connected', 'my_fifty', ${sm.id})`;
  // 4 reached calls today and 8 on each of the 8 days before (the goal is 8): done today 4, a streak of 8.
  const called = await person({ first: 'Calledq' });
  for (let i = 0; i < 4; i++) await call(called, new Date());
  for (let d = 1; d <= 8; d++) for (let i = 0; i < 8; i++) await call(called, T.atLocal(T.addDays(T.ymd(), -d), 12, i));
  // A new Meta lead, an hour old, nobody has touched.
  await person({ first: 'Newleadq', source: 'social', createdAt: new Date(Date.now() - 3600000) });
  // Four going cold (an order 40 days ago, no visit since): three delivered, and a Maya-like doctor whose order is
  // approved but unpaid, with a pay link waiting.
  for (const first of ['Coldaq', 'Coldbq', 'Coldcq']) await order(await person({ first }), 40, { status: 'delivered', method: 'card_on_file' });
  const maya = await person({ first: 'Mayaq', designation: 'md' });
  await order(maya, 40, { status: 'approved', method: 'pay_link', payLink: true });
  return { sm, maya };
}

let pass = 0, fail = 0;
function ok(cond, what, extra) { if (cond) pass++; else { fail++; console.log('FAIL', what, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } }

module.exports = (async () => {   // exported so test/run/smoke-rollback.js can tell when it has finished, also after an error
  const sql = db();
  const email = process.argv[2] || 'admin@renellence.com';
  const [u] = await sql`select id, email, name, kind, settings from users where email = ${email}`;
  const me = { id: u.id, email: u.email, name: u.name, first: u.name.split(' ')[0], initials: 'YK', kind: u.kind, settings: u.settings || {} };
  const Q = (o) => new URLSearchParams(o || {});
  const D = data.OPS, A = act.OPS;

  const boot = await D.boot(sql, me);
  ok(boot.me.id === me.id, 'boot me');

  const today = await D.today(sql, me);
  console.log('today', JSON.stringify({ day: today.day, fifty: today.fifty, list: today.list.map((x) => x.name + ' / ' + x.why + ' / ' + x.detail) }, null, 1));
  ok(today.day.goal === 8, 'goal 8');

  // ---- the checks that depend on today, on fresh rows dated from today ----
  const fx = await dateRows(sql);
  const fxToday = await D.today(sql, fx.sm);
  console.log('date rows today', JSON.stringify({ day: fxToday.day, list: fxToday.list.map((x) => x.name + ' / ' + x.why + ' / ' + x.detail) }));
  ok(fxToday.day.done === 4, 'done today (4 reached calls today)', fxToday.day);
  ok(fxToday.day.streak >= 6, 'streak >= 6', fxToday.day);
  ok(fxToday.list.length > 0 && fxToday.list[0].why === 'lead', 'new lead first', fxToday.list[0]);
  const fxPeople = await D.people(sql, fx.sm);
  ok(fxPeople.fifty.coldCount === 4, 'four going cold', fxPeople.fifty.coldCount);
  const mCard = await D.person(sql, fx.sm, Q({ id: fx.maya }));
  ok(mCard.label === 'MY FIFTY · GOING COLD', 'maya label', mCard.label);
  ok(mCard.status && mCard.status.label === 'Waiting on payment', 'maya status', mCard.status);
  const mOrd = mCard.status ? await D.order(sql, fx.sm, Q({ id: mCard.status.id })) : {};
  ok(mOrd.action === 'resend_pay_link', 'resend pay link offered', mOrd.action);

  const people = await D.people(sql, me);
  console.log('people', JSON.stringify({ fifty: { count: people.fifty.count, warm: people.fifty.warmCount, cold: people.fifty.coldCount, open: people.fifty.open, cold1: people.fifty.cold.slice(0, 4) },
    cands: people.candidates.map((c) => c.name + ' ' + c.days), leads: people.leads }, null, 1));
  ok(people.candidates.length >= 4, 'candidates');
  ok(people.leads.find((g) => g.key === 'social').count === 7, 'seven social leads', people.leads);

  const leads = await D.leads(sql, me, Q({ group: 'cold' }));
  console.log('cold leads', leads.leads.map((l) => l.name + ' | ' + l.sub + ' | ' + l.age + ' | ' + (l.isNew ? 'New' : l.last)));
  ok(leads.leads.some((l) => /Added by you/.test(l.sub)) && leads.leads.some((l) => /Added by Taylor/.test(l.sub)), 'added by you / Taylor');

  const [maya] = await sql`select id from contacts where legacy_id like 'demo-%' and owner_id = ${me.id} and first_name = 'Maya'`;
  const card = await D.person(sql, me, Q({ id: maya.id }));
  console.log('maya card', JSON.stringify(card));
  ok(card.name === 'Dr. Maya Sample', 'Dr. prefix', card.name);

  const hist = await D.history(sql, me, Q({ id: maya.id }));
  console.log('history', hist.entries.map((e) => e.when + ' ' + e.type + ': ' + e.title + (e.status ? ' [' + e.status + ']' : '') + (e.next ? ' next=' + e.next : '')).join('\n  '));
  ok(hist.entries.some((e) => /^Moved to you from Jordan Demo/.test(e.title)), 'moved to you');
  ok(hist.entries.some((e) => e.type === 'note' && /Taylor/.test(e.title)), 'note from Taylor');


  const [sara] = await sql`select id from contacts where legacy_id like 'demo-%' and owner_id = ${me.id} and first_name = 'Sara'`;
  const sCard = await D.person(sql, me, Q({ id: sara.id }));
  ok(sCard.status && sCard.status.label === 'Waiting on MD signature' && sCard.status.sub === 'Onboarding', 'sara onboarding status', sCard.status);
  const onb = await D.onboarding(sql, me, Q({ id: sara.id }));
  console.log('onboarding', JSON.stringify(onb));
  ok(onb.action === 'remind_md', 'remind md');

  const [nina] = await sql`select id from contacts where legacy_id like 'demo-%' and owner_id = ${me.id} and first_name = 'Nina'`;
  const nCard = await D.person(sql, me, Q({ id: nina.id }));
  const nOrd = await D.order(sql, me, Q({ id: nCard.status.id }));
  console.log('samples', JSON.stringify(nOrd));
  ok(nOrd.sample && nOrd.action === 'remind_md', 'sample remind md');

  const ready = await D.ready(sql, me);
  ok(ready.people.length > 20, 'ready list', ready.people.length);
  const prods = await D.products(sql, me, Q({ id: maya.id }));
  ok(prods.products.length > 30 && prods.cats.length === 6, 'products in categories');
  console.log('card', prods.card, 'first products', prods.products.slice(0, 4).map((p) => p.cat + ' ' + p.name + ' ' + p.price));

  const rewards = await D.rewards(sql, me);
  console.log('rewards', JSON.stringify(rewards));
  ok(/^\$/.test(rewards.extra), 'rewards extra');

  const search = await D.search(sql, me, Q({ q: 'maya' }));
  ok(search.people.length === 1, 'search');

  // ---- writes ----
  const [ben] = await sql`select id from contacts where legacy_id like 'demo-%' and owner_id = ${me.id} and first_name = 'Ben'`;
  const logged = await A.log(me, { contactId: ben.id, kind: 'call', reached: true, followUp: 'tomorrow', note: 'Smoke test call.\nNext: smoke test follow-up' });
  ok(logged.day.done === today.day.done + 1, 'log counts', logged.day);
  const [task] = await sql`select title, status from tasks where from_interaction_id = ${logged.interactionId}`;
  ok(task && task.title === 'smoke test follow-up', 'next step became the task', task);
  const undone = await A.undo(me, { interactionId: logged.interactionId, closedTaskIds: logged.closedTaskIds });
  ok(undone.day.done === today.day.done, 'undo', undone.day);
  const [reopened] = await sql`select status from tasks where id = any(${logged.closedTaskIds})`;
  ok(!logged.closedTaskIds.length || (reopened && reopened.status === 'open'), 'closed follow-up reopened');

  const added = await A.add_person(me, { firstName: 'Smoke', lastName: 'Test', clinic: 'Sample Clinic A', phone: '555 030 9999', email: 'smoke.test@example.invalid', role: 'manager', warm: false });
  const [p] = await sql`select source_kind::text, owner_id, mobile, shipping_city from contacts where id = ${added.id}`;
  ok(p.source_kind === 'cold' && p.owner_id === me.id && p.mobile === '+15550309999' && p.shipping_city === 'Sampleton', 'add person', p);
  const cold2 = await D.leads(sql, me, Q({ group: 'cold' }));
  ok(cold2.leads[0].name === 'Smoke Test' && /Added by you/.test(cold2.leads[0].sub), 'added shows first', cold2.leads[0]);
  await A.set_uses(me, { contactId: added.id, fillers: ['saypha', 'belotero', 'nope'] });
  const [uses] = await sql`select fillers_used::text[] f from contacts where id = ${added.id}`;
  ok(uses.f.join() === 'saypha,belotero', 'uses saved', uses);
  const fu = await A.set_follow_up(me, { contactId: added.id, date: '2030-01-15' });
  ok(fu.label === 'Jan 15', 'follow up', fu);
  await A.snooze({ ...me }, { contactId: added.id });
  let dupe = null; try { await A.add_person(me, { firstName: 'Again', email: 'smoke.test@example.invalid' }); } catch (e) { dupe = e.message; }
  ok(dupe === 'email_yours', 'duplicate email refused', dupe);   // the code's name since v2 part B (was already_yours)
  // Remove the test person (it is not demo data): soft delete, as the app would.
  await sql`update tasks set deleted_at = now() where contact_id = ${added.id}`;
  await sql`update contacts set deleted_at = now(), legacy_id = 'demo-smoke-' || id::text where id = ${added.id}`;
  await sql`update users set settings = settings - 'snoozed' where id = ${me.id}`;

  // The row the trigger wrote when the person was made, picked by entity and action (in one transaction every row has the
  // same time, so "first by time" could be any of them).
  const log = await sql`select source::text, actor_user_id, action, field from change_log where entity_type = 'contacts' and entity_id = ${added.id} and action = 'create'`;
  ok(log.length === 1 && log[0].source === 'my_fifty' && log[0].actor_user_id === me.id, 'change_log written by trigger', log);

  console.log(pass + ' passed, ' + fail + ' failed');
  await sql.end();
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
