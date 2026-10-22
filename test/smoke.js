// Smoke test against the real v2 database with the demo data (db/seed-demo.sql): every read, and the writes that
// can be undone (log + undo, snooze, follow-up, uses, a person who is then removed). Signs in as the demo owner
// without Google (reads users directly). Needs .env.local (vercel env pull).
//   node test/smoke.js [owner-email]
const fs = require('fs');
const path = require('path');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { db } = require('../api/_db');
const data = require('../api/data');
const act = require('../api/act');

let pass = 0, fail = 0;
function ok(cond, what, extra) { if (cond) pass++; else { fail++; console.log('FAIL', what, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } }

(async () => {
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
  ok(today.day.done === 4, 'done today (3 calls + Maya call)', today.day);
  ok(today.day.streak >= 6, 'streak >= 6', today.day);
  ok(today.list.length > 0 && today.list[0].why === 'lead', 'new lead first', today.list[0]);

  const people = await D.people(sql, me);
  console.log('people', JSON.stringify({ fifty: { count: people.fifty.count, warm: people.fifty.warmCount, cold: people.fifty.coldCount, open: people.fifty.open, cold1: people.fifty.cold.slice(0, 4) },
    cands: people.candidates.map((c) => c.name + ' ' + c.days), leads: people.leads }, null, 1));
  ok(people.fifty.coldCount === 4, 'four going cold', people.fifty.coldCount);
  ok(people.candidates.length >= 4, 'candidates');
  ok(people.leads.find((g) => g.key === 'social').count === 7, 'seven social leads', people.leads);

  const leads = await D.leads(sql, me, Q({ group: 'cold' }));
  console.log('cold leads', leads.leads.map((l) => l.name + ' | ' + l.sub + ' | ' + l.age + ' | ' + (l.isNew ? 'New' : l.last)));
  ok(leads.leads.some((l) => /Added by you/.test(l.sub)) && leads.leads.some((l) => /Added by Taylor/.test(l.sub)), 'added by you / Taylor');

  const [maya] = await sql`select id from contacts where legacy_id like 'demo-%' and owner_id = ${me.id} and first_name = 'Maya'`;
  const card = await D.person(sql, me, Q({ id: maya.id }));
  console.log('maya card', JSON.stringify(card));
  ok(card.label === 'MY FIFTY · GOING COLD', 'maya label', card.label);
  ok(card.status && card.status.label === 'Waiting on payment', 'maya status', card.status);
  ok(card.name === 'Dr. Maya Sample', 'Dr. prefix', card.name);

  const hist = await D.history(sql, me, Q({ id: maya.id }));
  console.log('history', hist.entries.map((e) => e.when + ' ' + e.type + ': ' + e.title + (e.status ? ' [' + e.status + ']' : '') + (e.next ? ' next=' + e.next : '')).join('\n  '));
  ok(hist.entries.some((e) => /^Moved to you from Jordan Demo/.test(e.title)), 'moved to you');
  ok(hist.entries.some((e) => e.type === 'note' && /Taylor/.test(e.title)), 'note from Taylor');

  const ord = await D.order(sql, me, Q({ id: card.status.id }));
  console.log('order', JSON.stringify(ord));
  ok(ord.action === 'resend_pay_link', 'resend pay link offered');

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
  ok(dupe === 'already_yours', 'duplicate email refused', dupe);
  // Remove the test person (it is not demo data): soft delete, as the app would.
  await sql`update tasks set deleted_at = now() where contact_id = ${added.id}`;
  await sql`update contacts set deleted_at = now(), legacy_id = 'demo-smoke-' || id::text where id = ${added.id}`;
  await sql`update users set settings = settings - 'snoozed' where id = ${me.id}`;

  const log = await sql`select source::text, actor_user_id, action, field from change_log where entity_id = ${added.id} order by at`;
  ok(log.length && log[0].source === 'my_fifty' && log[0].actor_user_id === me.id && log[0].action === 'create', 'change_log written by trigger', log[0]);

  console.log(pass + ' passed, ' + fail + ' failed');
  await sql.end();
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
