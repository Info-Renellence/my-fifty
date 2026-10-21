// Test run 2026-10-21: the fake data that stays in Supabase v2 for the owner to look at.
// Every row is fictional and marked: users @demo.invalid; clinics, contacts, orders legacy_id 'demo-test-…';
// everything else hangs off those (or carries 'demo-test' in an external key / name). db/wipe-demo.sql removes it.
// Run once (it stops if the test users already exist):
//   node --require ./test/run/no-network.js test/run/seed-test-data.js
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const H = require(path.join(ROOT, 'test/helpers'));   // loads .env.local and the fixed test secret
const { db, asUser } = require(path.join(ROOT, 'api/_db'));
const { seal } = require(path.join(ROOT, 'api/_crypto'));
const T = require(path.join(ROOT, 'api/_time'));

const DAY = 86400000;
const ago = (d, hrs) => new Date(Date.now() - d * DAY - (hrs || 0) * 3600000);
const USERS = [
  ['test.alpha@demo.invalid', 'Alpha Testrep', 'rep', true],
  ['test.bravo@demo.invalid', 'Bravo Testrep', 'rep', true],
  ['test.charlie@demo.invalid', 'Charlie Testadmin', 'admin', true],
  ['test.delta@demo.invalid', 'Delta Offrep', 'rep', false],
  ['test.echo@demo.invalid', 'Echo Loadrep', 'rep', true],
  ['test.foxtrot@demo.invalid', 'Foxtrot Emptyrep', 'rep', true],
];

async function main() {
  const sql = db();
  const [have] = await sql`select count(*)::int n from users where email like 'test.%@demo.invalid'`;
  if (have.n) { console.log('test users already exist (' + have.n + '); nothing done'); return; }
  const U = {};
  for (const [email, name, kind, active] of USERS) {
    const [u] = await sql`insert into users (email, name, kind, active, settings) values (${email}, ${name}, ${kind}, ${active}, '{}'::jsonb) returning id`;
    U[email.split('.')[1].split('@')[0]] = u.id;
  }
  const A = U.alpha, Bv = U.bravo;
  await asUser(U.charlie, async (tx) => {
    const clinic = async (key, name, city) => (await tx`insert into clinics (name, street, city, province, postal_code, legacy_id) values (${name}, ${'1 ' + key + ' Testing Way'}, ${city}, 'ON', 'Z9Z 9Z9', ${'demo-test-clinic-' + key}) returning id`)[0].id;
    const cl1 = await clinic('one', 'Testrun Clinic One', 'Testburg');
    const cl2 = await clinic('two', 'Testrun Clinic Two', 'Mockville');
    const clLong = await clinic('long', 'Testrun Clinic With A Very Long Name ' + 'Lorem ipsum dolor sit amet '.repeat(6).trim(), 'Edgecase Falls');
    const [ev] = await tx`insert into events (name, kind, starts_at, place) values ('Testrun Lips Workshop (demo)', 'training', ${ago(9)}, 'Testburg') returning id`;
    const [camp] = await tx`insert into ad_objects (level, meta_id, ad_account, name, goal, status) values ('campaign', 'demo-test-camp-1', 'act_demo-test', 'Testrun Lips Campaign (demo-test)', 'leads', 'ACTIVE') returning id`;
    const [ad] = await tx`insert into ad_objects (level, parent_id, meta_id, ad_account, name, status) values ('ad', ${camp.id}, 'demo-test-ad-1', 'act_demo-test', 'Testrun Lips Ad (demo-test)', 'ACTIVE') returning id`;

    let n = 0;
    const person = async (owner, o) => {
      n++;
      const [c] = await tx`insert into contacts (owner_id, clinic_id, first_name, last_name, email, mobile, role, designation, source_kind, source_ad_id, source_event_id,
          shipping_street, shipping_city, shipping_province, shipping_postal_code, legacy_id, created_at)
        values (${owner}, ${o.clinic || cl1}, ${o.first === undefined ? 'Test' : o.first}, ${o.last === undefined ? 'Person' + n : o.last},
          ${o.email === undefined ? 'person' + n + '.' + (o.tag || 'x') + '@demo.invalid' : o.email}, ${o.phone === undefined ? '+1555010' + String(1000 + n).slice(1) : o.phone},
          ${o.role || null}, ${o.designation || null}, ${o.source || 'warm'}, ${o.adId || null}, ${o.eventId || null},
          '1 Testing Way', 'Testburg', 'ON', 'Z9Z 9Z9', ${'demo-test-' + (o.tag || 'p' + n)}, ${o.created || ago(90)}) returning id`;
      return c.id;
    };
    const order = async (contactId, rep, o) => {
      const placed = o.placed || ago(o.days || 0);
      const [r] = await tx`insert into orders (contact_id, rep_id, placed_by, channel, status, submitted_at, approved_at, payment_method, shipped_at, delivered_at, md_contact_id, md_signed_at, approval_note, shipping_note, legacy_id, created_at)
        values (${contactId}, ${rep}, ${rep}, 'stripe', ${o.status || 'submitted'}, ${placed}, ${o.approved ? placed : null}, ${o.method || null},
          ${o.shipped != null ? ago(o.shipped) : null}, ${o.delivered != null ? ago(o.delivered) : null}, ${o.md || null}, ${o.mdSigned ? placed : null},
          ${o.note || null}, ${o.shipNote || null}, ${'demo-test-order-' + o.tag}, ${placed}) returning id`;
      for (const [sku, qty, free, zero] of o.lines) {
        await tx`insert into order_lines (order_id, product_id, sku, name, quantity, unit_price, list_price, is_free)
          select ${r.id}, id, sku, name, ${qty}, ${free || zero ? 0 : tx`list_price`}, list_price, ${!!free} from products where sku = ${sku}`;
      }
      return r.id;
    };
    const pay = (orderId, o) => tx`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test, card_brand, card_last4, pay_link_url, failure_reason, created_at)
        values (${orderId}, 'charge', ${o.method || 'card_on_file'}, ${o.amount}, 'CAD', ${o.status || 'succeeded'}, 'stripe', ${o.status === 'succeeded' || !o.status ? o.at : null}, false,
          ${o.brand || null}, ${o.last4 || null}, ${o.link || null}, ${o.reason || null}, ${o.at})`;
    const touch = (contactId, user, o) => tx`insert into interactions (kind, contact_id, user_id, occurred_at, direction, mode, status, outcome, body, subject, source, external_id, created_by, thread_id)
        values (${o.kind || 'call'}, ${contactId}, ${user}, ${o.at}, ${o.dir || 'out'}, ${o.kind === 'meeting' ? 'in_person' : (o.kind || 'call') === 'call' ? 'phone' : null}, ${o.status || 'completed'},
          ${o.outcome === undefined ? 'connected' : o.outcome}, ${o.body || null}, ${o.subject || null}, ${o.source || 'my_fifty'}, ${o.ext || null}, ${user}, ${o.thread || null}) returning id`;
    const task = (contactId, user, due, title) => tx`insert into tasks (contact_id, assignee_id, created_by, title, type, due_at, status, source) values (${contactId}, ${user}, ${user}, ${title || 'Follow up'}, 'call', ${due}, 'open', 'manual')`;

    // ---- Alpha's book: one of everything ----
    const a = {};
    a.newSocial = await person(A, { tag: 'a-new-social', first: 'Nova', last: 'Leadtest', source: 'social', detail: 'Instagram', adId: ad.id, created: ago(0, 2) });
    a.oldSocial = await person(A, { tag: 'a-old-social', first: 'Olde', last: 'Leadtest', source: 'social', detail: 'Facebook', adId: ad.id, created: ago(1, 6) });
    a.event = await person(A, { tag: 'a-event', first: 'Evie', last: 'Eventtest', source: 'event', eventId: ev.id, created: ago(9) });
    a.warm = await person(A, { tag: 'a-warm', first: 'Wren', last: 'Warmtest', source: 'warm', detail: 'Referral' });
    a.noName = await person(A, { tag: 'a-noname', first: null, last: null, source: 'cold', phone: null });
    a.candFresh = await person(A, { tag: 'a-cand-fresh', first: 'Cass', last: 'Candtest', clinic: cl2 });
    a.candTouched = await person(A, { tag: 'a-cand-touched', first: 'Cleo', last: 'Candtest', clinic: cl2 });
    a.candWaiting = await person(A, { tag: 'a-cand-waiting', first: 'Cyd', last: 'Candtest', clinic: cl2 });
    a.md = await person(null, { tag: 'a-md', first: 'Medi', last: 'Directortest', designation: 'md', role: 'physician', clinic: cl2 });
    a.fiftyCard = await person(A, { tag: 'a-fifty-card', first: 'Faye', last: 'Fiftytest', designation: 'md', role: 'physician' });
    a.fiftyCold = await person(A, { tag: 'a-fifty-cold', first: 'Colt', last: 'Fiftytest' });
    a.fiftyWire = await person(A, { tag: 'a-fifty-wire', first: 'Wade', last: 'Fiftytest' });
    a.fiftyVisited = await person(A, { tag: 'a-fifty-visited', first: 'Vera', last: 'Fiftytest' });
    a.overdue = await person(A, { tag: 'a-overdue', first: 'Otto', last: 'Duetest' });
    a.odd = await person(A, { tag: 'a-odd', first: 'Zoë <script>alert(1)</script>', last: "O'Brien-Ñúñez 😀 \"quoted\" & co", clinic: clLong, email: 'odd.chars+tag@demo.invalid' });
    a.onbMd = await person(A, { tag: 'a-onb-md', first: 'Ona', last: 'Onboardtest' });
    a.onbDone = await person(A, { tag: 'a-onb-done', first: 'Olly', last: 'Onboardtest' });
    a.mixed = await person(A, { tag: 'a-mixed', first: 'Mix', last: 'Ordertest' });
    a.gmail = await person(A, { tag: 'a-gmail', first: 'Gemma', last: 'Mailtest', source: 'social', detail: 'Instagram', created: ago(20) });
    a.unpaidOnly = await person(A, { tag: 'a-unpaid-only', first: 'Una', last: 'Unpaidtest' });

    await order(a.candFresh, A, { tag: 'a-cand-fresh', status: 'delivered', approved: true, days: 10, shipped: 8, delivered: 6, md: a.md, mdSigned: true, lines: [['SAL400', 2, true], ['MN2550', 1, true]] });
    await order(a.candTouched, A, { tag: 'a-cand-touched', status: 'delivered', approved: true, days: 15, shipped: 13, delivered: 12, md: a.md, mdSigned: true, lines: [['SAF100', 1, true]] });
    await touch(a.candTouched, A, { kind: 'text', at: ago(2), source: 'quo', ext: 'demo-test-quo-text-1', body: 'Hi Cleo, did the saypha samples arrive?' });
    const oWait = await order(a.candWaiting, A, { tag: 'a-cand-waiting', status: 'awaiting_md', approved: true, days: 3, md: a.md, lines: [['SAL400', 1, true]] });
    await tx`insert into agreements (kind, contact_id, order_id, envelope_id, status, sent_at) values ('md_pdr', ${a.candWaiting}, ${oWait}, 'demo-test-env-1', 'waiting', ${ago(3)})`;

    const oCard = await order(a.fiftyCard, A, { tag: 'a-card-1', status: 'delivered', approved: true, method: 'card_on_file', days: 5, shipped: 4, delivered: 2, lines: [['SAF100', 2], ['SAL400', 1], ['HDB100', 1, true]] });
    await pay(oCard, { amount: 675, at: ago(5), brand: 'visa', last4: '4242' });
    const oLink = await order(a.fiftyCard, A, { tag: 'a-card-2', status: 'approved', approved: true, method: 'pay_link', days: 1, lines: [['SAV200', 2]] });
    await pay(oLink, { method: 'pay_link', status: 'pending', amount: 500, at: ago(1), link: 'https://pay.demo.invalid/demo-test-link-1' });
    await tx`insert into ai_outputs (kind, contact_id, input, output, output_data, model, created_by)
      values ('voice_note', ${a.fiftyCard}, 'Saw Faye, she wants two saypha lips next week. Next: call Friday', 'Saw Faye; she wants two saypha lips next week.',
        ${tx.json({ note: 'Saw Faye; she wants two saypha lips next week.', nextStep: 'Call Friday', followUpDate: '', transcript: 'Saw Faye, she wants two saypha lips next week. Next: call Friday' })}, 'gemini-2.5-flash (fake)', ${A})`;
    await order(a.fiftyCold, A, { tag: 'a-cold', status: 'delivered', approved: true, method: 'card_on_file', days: 45, shipped: 44, delivered: 43, lines: [['SAF100', 3]] });
    await order(a.fiftyWire, A, { tag: 'a-wire', status: 'submitted', method: 'wire', days: 10, lines: [['SAV200', 4]], note: 'Wire coming Friday' });
    await order(a.fiftyVisited, A, { tag: 'a-visited', status: 'shipped', approved: true, method: 'card_on_file', days: 60, shipped: 59, lines: [['SAF100', 1]] });
    await touch(a.fiftyVisited, A, { kind: 'meeting', at: ago(3), body: 'Dropped by with the new lips brochure.' });
    await task(a.overdue, A, ago(2), 'Send the price list');
    await order(a.mixed, A, { tag: 'a-mixed-ok', status: 'delivered', approved: true, method: 'card_on_file', days: 20, delivered: 18, lines: [['SAF100', 2], ['SAL400', 2, true], ['HDB100', 3, false, true]] });
    await order(a.mixed, A, { tag: 'a-mixed-rejected', status: 'rejected', days: 25, lines: [['SAF100', 10]] });
    await order(a.mixed, A, { tag: 'a-mixed-cancelled', status: 'cancelled', days: 22, lines: [['SAF100', 5]] });
    await order(a.unpaidOnly, A, { tag: 'a-unpaid-only', status: 'approved', approved: true, method: 'card_on_file', days: 2, lines: [['SAF100', 1]] });
    await touch(a.warm, A, { kind: 'call', at: ago(3), source: 'quo', ext: 'demo-test-quo-call-1', body: 'Call recording summary (fake Quo): interested in volume.' });
    await touch(a.odd, A, { kind: 'call', at: ago(4), body: ('Very long note ' + 'with odd text <b>bold</b> & "quotes" 😀 '.repeat(80)).slice(0, 3900) + '\nNext: call back about <script>x</script>' });
    // Onboardings
    const [ag1] = await tx`insert into agreements (kind, contact_id, envelope_id, status, sent_at) values ('onboarding', ${a.onbMd}, 'demo-test-env-2', 'waiting', ${ago(4)}) returning id`;
    await tx`insert into agreement_signers (agreement_id, contact_id, name, email, role, sign_order, status, signed_at) values
      (${ag1.id}, ${a.onbMd}, 'Ona Onboardtest', 'person.ona@demo.invalid', 'injector', 1, 'signed', ${ago(3)}),
      (${ag1.id}, ${a.md}, 'Medi Directortest', 'person.md@demo.invalid', 'md', 2, 'sent', null)`;
    await tx`insert into onboardings (primary_contact_id, md_contact_id, submitted_at, status, agreement_id) values (${a.onbMd}, ${a.md}, ${ago(4)}, 'submitted', ${ag1.id})`;
    await tx`insert into onboardings (primary_contact_id, submitted_at, status, completed_at, card_saved_at) values (${a.onbDone}, ${ago(8)}, 'complete', ${ago(6)}, ${ago(6)})`;
    // Gmail: a pulled client email (fake Gmail) and its ingest row
    await tx`insert into ingest_events (source, external_key, payload, received_via, received_at, status, attempts, processed_at, result_table)
      values ('gmail', '<demo-test-msg-1@demo.invalid>', ${tx.json({ mailbox: 'test.alpha@demo.invalid', id: 'demo-test-gm-1', subject: 'Re: saypha pricing', from: 'Gemma Mailtest <person.gemma@demo.invalid>' })}, 'pull', ${ago(1)}, 'done', 1, ${ago(1)}, 'interactions')`;
    await touch(a.gmail, null, { kind: 'email', dir: 'in', at: ago(1), source: 'gmail', ext: '<demo-test-msg-1@demo.invalid>', subject: 'Re: saypha pricing', body: 'Thanks, can you send the price list?', outcome: null, thread: 'demo-test-thread-1' });
    // Streak: 8 Quo calls on each of the last 3 business days
    const cfg = { holidays: (await tx`select value from settings where key = 'holidays'`)[0].value };
    let d = T.addDays(T.ymd(), -1), done = 0, k = 0;
    const callees = [a.fiftyCard, a.fiftyCold, a.fiftyWire, a.fiftyVisited, a.warm, a.overdue, a.mixed, a.odd];
    while (done < 3) {
      if (T.isBusinessDay(d, cfg.holidays)) {
        for (let i = 0; i < 8; i++) await touch(callees[i], A, { kind: 'call', at: T.atLocal(d, 10, i * 5), source: 'quo', ext: 'demo-test-quo-streak-' + (++k), outcome: i % 3 ? 'connected' : 'no_answer' });
        done++;
      }
      d = T.addDays(d, -1);
    }
    // Push: a fake phone subscription and a sent new-lead notification
    await tx`insert into user_connections (user_id, kind, account, credentials, status) values (${A}, 'push', 'demo-test-phone-1',
      ${seal(JSON.stringify({ endpoint: 'https://push.demo.invalid/demo-test-endpoint-1', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }))}, 'connected')`;
    await tx`insert into notifications (user_id, kind, contact_id, dedupe_key, title, body, status, sent_at) values (${A}, 'new_lead', ${a.newSocial}, ${'new_lead:' + a.newSocial},
      'New Instagram lead: Nova Leadtest', 'Reach out within 24 hours. It''s at the top of your Today.', 'sent', now())`;

    // ---- Bravo: same clinic as Alpha ----
    const b1 = await person(Bv, { tag: 'b-fifty', first: 'Bea', last: 'Bravoclient', clinic: cl1 });
    await order(b1, Bv, { tag: 'b-fifty', status: 'delivered', approved: true, method: 'card_on_file', days: 7, delivered: 5, lines: [['SAF100', 6]] });
    await person(Bv, { tag: 'b-lead', first: 'Bo', last: 'Bravoclient', clinic: cl1, source: 'social', detail: 'Instagram', created: ago(0, 1) });
    // An order Alpha is credited on for a person who has since moved to Bravo
    const moved = await person(Bv, { tag: 'b-moved', first: 'Mo', last: 'Movedtest' });
    await order(moved, A, { tag: 'b-moved', status: 'shipped', approved: true, method: 'card_on_file', days: 12, shipped: 10, lines: [['SAF100', 1]] });
    // ---- Charlie (admin) and Delta (switched off) ----
    await person(U.charlie, { tag: 'c-lead', first: 'Cam', last: 'Adminclient' });
    await person(U.delta, { tag: 'd-lead', first: 'Dot', last: 'Offclient' });
    // ---- Echo: 300 people, 150 with orders ----
    await tx`insert into contacts (owner_id, clinic_id, first_name, last_name, email, source_kind, legacy_id, created_at)
      select ${U.echo}, ${cl2}, 'Load' || g, 'Testperson', 'load' || g || '@demo.invalid', (array['social','event','warm','cold'])[1 + g % 4]::contacts_source_kind, 'demo-test-load-' || g, now() - (g || ' hours')::interval
        from generate_series(1, 300) g`;
    await tx`insert into orders (contact_id, rep_id, placed_by, channel, status, submitted_at, payment_method, legacy_id, created_at)
      select c.id, ${U.echo}, ${U.echo}, 'stripe', (case when g % 3 = 0 then 'delivered' when g % 3 = 1 then 'shipped' else 'approved' end)::orders_status,
             now() - ((g % 60) || ' days')::interval, 'card_on_file', 'demo-test-load-order-' || g, now() - ((g % 60) || ' days')::interval
        from generate_series(1, 150) g join contacts c on c.legacy_id = 'demo-test-load-' || g`;
    await tx`insert into order_lines (order_id, product_id, sku, name, quantity, unit_price, list_price, is_free)
      select o.id, p.id, p.sku, p.name, 2, p.list_price, p.list_price, false from orders o, products p where o.legacy_id like 'demo-test-load-order-%' and p.sku = 'SAF100'`;
  }, { source: 'import' });
  const [c] = await sql`select (select count(*) from contacts where legacy_id like 'demo-test-%')::int contacts, (select count(*) from orders where legacy_id like 'demo-test-%')::int orders`;
  console.log('seeded', JSON.stringify(U), JSON.stringify(c));
}
// DRY=1 runs everything inside a transaction that is rolled back (nothing kept).
(process.env.DRY ? H.withDb(main).then(() => { console.log('dry run: rolled back'); return H.closeDb(); }) : main().then(() => db().end()))
  .catch((e) => { console.error(e); process.exit(1); });
