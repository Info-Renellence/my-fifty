// api/data.js: every read, against v2 (rolled back).
const { test, describe, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const data = require('../../api/data');
const D = data.OPS, X = data._;

after(h.closeDb);
const Q = (o) => new URLSearchParams(o || {});

describe('the route', () => {
  let f;
  afterEach(() => { if (f) f.restore(); f = null; });
  test('config needs no sign-in and gives the public settings', async () => {
    const res = h.fakeRes();
    await data({ method: 'GET', url: '/api/data?op=config', headers: {} }, res);
    const j = res.json();
    assert.equal(res.statusCode, 200);
    assert.ok('supabaseUrl' in j && 'supabaseAnonKey' in j);
    assert.match(j.vapidPublicKey, /^[A-Za-z0-9_-]+$/);
  });
  test('anything else needs sign-in', async () => {
    const res = h.fakeRes();
    await data({ method: 'GET', url: '/api/data?op=today', headers: {} }, res);
    assert.equal(res.statusCode, 401);
  });
  test('an unknown op is refused once signed in', () => h.withDb(async (sql) => {
    const u = await h.user(sql, { email: 'unit.route.' + h.uid() + '@renellence.com' });
    const authId = await h.authUser(sql, u);
    f = h.fakeFetch(() => ({ json: { id: authId, email: u.email } }));
    const res = h.fakeRes();
    await data({ method: 'GET', url: '/api/data?op=nope', headers: { authorization: 'Bearer t-' + h.uid() } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'unknown_op');
  }));
});

describe('boot', () => {
  test('first visit: no "joined" moment, Gmail off, my initials', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { name: 'Pat Unit' });
    const b = await D.boot(sql, Object.assign(me, { initials: 'PU' }));
    assert.equal(b.firstVisit, true);
    assert.equal(b.joined, null);
    assert.equal(b.gmail, 'off');
    assert.equal(b.me.initials, 'PU');
  }));
  test('someone whose first paid order came after the last visit "joined your Fifty"', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { settings: { fifty_seen_at: h.ago(2).toISOString() } });
    const old = await h.contact(sql, me), fresh = await h.contact(sql, me, { first: 'Newbie' });
    await h.order(sql, old, me, { status: 'shipped', days: 10 });
    await h.order(sql, fresh, me, { status: 'shipped', days: 1 });
    const b = await D.boot(sql, me);
    assert.equal(b.joined.id, fresh);
    assert.equal(b.joined.count, 2);
    assert.equal(b.joined.next, 5);
    assert.equal(b.firstVisit, false);
  }));
  test('nobody new since the last visit: no moment', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { settings: { fifty_seen_at: new Date().toISOString() } });
    await h.order(sql, await h.contact(sql, me), me, { status: 'shipped', days: 3 });
    assert.equal((await D.boot(sql, me)).joined, null);
  }));
  test('Gmail status comes from the latest connection', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await sql`insert into user_connections (user_id, kind, status, credentials) values (${me.id}, 'gmail', 'connected', 'x')`;
    assert.equal((await D.boot(sql, me)).gmail, 'connected');
  }));
});

describe('today', () => {
  test('gives the date, the day stats, the Fifty tile and the list', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await h.contact(sql, me, { source: 'social', detail: 'Instagram', createdAt: h.ago(0, 1) });
    for (let i = 0; i < 6; i++) await h.order(sql, await h.contact(sql, me), me, { status: 'shipped', days: 2 });
    const t = await D.today(sql, me);
    assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(t.day.goal, 8);
    assert.deepEqual(t.fifty, { count: 6, next: 10, goal: 50 });
    assert.equal(t.list[0].why, 'lead');
  }));
});

describe('people', () => {
  test('My Fifty, candidates and the four lead groups', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const warm = await h.contact(sql, me); await h.order(sql, warm, me, { status: 'shipped', days: 3 });
    const cold = await h.contact(sql, me); await h.order(sql, cold, me, { status: 'shipped', days: 45 });
    const cand = await h.contact(sql, me, { first: 'Cand', last: 'Idate' }); await h.order(sql, cand, me, { lines: [['SAL400', 1, true]], delivered: 15 });
    await h.contact(sql, me, { source: 'social' });
    const touched = await h.contact(sql, me, { source: 'social' }); await h.touch(sql, touched, me.id);
    await h.contact(sql, me, { source: 'cold' });
    const p = await D.people(sql, me);
    assert.deepEqual([p.fifty.count, p.fifty.warmCount, p.fifty.coldCount, p.fifty.open], [2, 1, 1, 48]);
    assert.match(p.fifty.cold[0].sub, /45 days$/);
    assert.match(p.fifty.warm[0].sub, /ordered Oct|ordered [A-Z][a-z]{2} \d+/);
    assert.deepEqual(p.candidates.map((c) => [c.initials, c.days, c.ring]), [['CI', 15, 0.5]]);
    const g = Object.fromEntries(p.leads.map((x) => [x.key, x]));
    assert.deepEqual([g.social.count, g.social.fresh, g.cold.count, g.event.count, g.warm.count], [2, 1, 1, 0, 0]);
    assert.equal(g.social.label, 'Social media leads');
    assert.equal(g.event.label, 'Event and training leads');
    assert.equal(p.all.length, 6);
  }));
  test('the candidate ring is full at 30 days and empty before shipping', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await h.order(sql, await h.contact(sql, me), me, { lines: [['SAL400', 1, true]], delivered: 45 });
    await h.order(sql, await h.contact(sql, me), me, { lines: [['SAL400', 1, true]] });
    const rings = (await D.people(sql, me)).candidates.map((c) => c.ring);
    assert.deepEqual(rings, [1, 0]);
  }));
});

describe('leads', () => {
  test('a bad group is refused', () => h.withDb(async (sql) => {
    await assert.rejects(D.leads(sql, await h.user(sql), Q({ group: 'hot' })), (e) => e.status === 400);
  }));
  test('newest first, with the source, age, New badge and last touch', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const old = await h.contact(sql, me, { source: 'social', detail: 'Facebook', first: 'Old', createdAt: h.ago(3) });
    await h.touch(sql, old, me.id, { kind: 'text', days: 1 });
    await h.contact(sql, me, { source: 'social', detail: 'Instagram', first: 'New', createdAt: h.ago(0, 2) });
    const l = await D.leads(sql, me, Q({ group: 'social' }));
    assert.equal(l.title, 'Social media');
    assert.deepEqual(l.leads.map((x) => x.name.split(' ')[0]), ['New', 'Old']);
    assert.equal(l.leads[0].isNew, true);
    assert.equal(l.leads[0].age, '2h ago');
    assert.match(l.leads[0].sub, /Instagram$/);
    assert.match(l.leads[1].last, /^Texted [A-Z][a-z]{2} \d+$/);
  }));
  test('cold and warm leads say who added them', () => h.withDb(async (sql) => {
    const me = await h.user(sql), boss = await h.user(sql, { name: 'Robin Boss' });
    const { asUser } = require('../../api/_db');
    await asUser(me.id, (tx) => tx`insert into contacts (owner_id, first_name, source_kind) values (${me.id}, 'Mine', 'cold')`);
    await asUser(boss.id, (tx) => tx`insert into contacts (owner_id, first_name, source_kind) values (${me.id}, 'Given', 'cold')`);
    const subs = Object.fromEntries((await D.leads(sql, me, Q({ group: 'cold' }))).leads.map((x) => [x.name, x.sub]));
    assert.equal(subs.Mine, 'Added by you');
    assert.equal(subs.Given, 'Added by Robin');
  }));
  test('people who ordered are not leads', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await h.order(sql, await h.contact(sql, me, { source: 'warm' }), me, { status: 'shipped' });
    assert.equal((await D.leads(sql, me, Q({ group: 'warm' }))).leads.length, 0);
  }));
});

describe('person', () => {
  test('a bad id, someone else’s person, and nobody are refused', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    await assert.rejects(D.person(sql, me, Q({ id: 'x' })), (e) => e.status === 400);
    await assert.rejects(D.person(sql, me, Q({ id: await h.contact(sql, other) })), (e) => e.status === 404);
    await assert.rejects(D.person(sql, me, Q({ id: '00000000-0000-4000-8000-000000000000' })), (e) => e.status === 404);
  }));
  test('a Fifty person going cold, waiting on payment (L7)', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const c = await h.contact(sql, me, { designation: 'MD', first: 'Maya', last: 'Unit' });
    await h.order(sql, c, me, { status: 'shipped', days: 40, lines: [['SAF100', 4]] });
    const open = await h.order(sql, c, me, { status: 'approved', approved: true, method: 'card_on_file', lines: [['SAF100', 2]] });
    await sql`update contacts set fillers_used = '{saypha,restylane}', prp_used = '{eclipse_prp}' where id = ${c}`;
    await h.touch(sql, c, me.id, { at: new Date() });
    await h.task(sql, c, me.id, { due: h.ago(-2), title: 'Call back' });
    const p = await D.person(sql, me, Q({ id: c }));
    assert.equal(p.label, 'MY FIFTY', 'the order placed today keeps her warm (an order counts, paid or not)');
    assert.equal(p.name, 'Dr. Maya Unit');
    assert.equal(p.totalBought, '$900');
    assert.equal(p.lastOrder.total, '$900');
    assert.deepEqual(p.status, { kind: 'order', id: open, label: 'Waiting on payment', sub: 'Order · $450' });
    assert.deepEqual(p.fillers, ['saypha', 'restylane']);
    assert.equal(p.followUp.title, 'Call back');
    assert.equal(p.last, 'Call · reached · today');
  }));
  test('a candidate waiting on the MD for onboarding (L8)', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const c = await h.contact(sql, me), md = await h.contact(sql, null, { owner: null, md: true });
    await h.order(sql, c, me, { lines: [['SAL400', 1, true]], shipped: 5, delivered: 4, mdId: md, mdSigned: true, status: 'delivered' });
    const [ag] = await sql`insert into agreements (kind, contact_id, status, sent_at) values ('onboarding', ${c}, 'waiting', now() - interval '2 days') returning id`;
    await sql`insert into agreement_signers (agreement_id, contact_id, role, sign_order, status, signed_at) values (${ag.id}, ${c}, 'practitioner', 1, 'signed', now()), (${ag.id}, ${md}, 'md', 2, 'sent', null)`;
    await sql`insert into onboardings (primary_contact_id, injector_contact_id, submitted_at, status, agreement_id) values (${c}, ${c}, now(), 'submitted', ${ag.id})`;
    const p = await D.person(sql, me, Q({ id: c }));
    assert.equal(p.label, 'CANDIDATE');
    assert.deepEqual([p.status.kind, p.status.label, p.status.sub], ['onboarding', 'Waiting on MD signature', 'Onboarding']);
    assert.equal(p.totalBought, null);
  }));
  test('waiting on the first signature, then nothing once onboarding is signed', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const [ag] = await sql`insert into agreements (kind, contact_id, status) values ('onboarding', ${c}, 'waiting') returning id`;
    await sql`insert into agreement_signers (agreement_id, contact_id, role, sign_order, status) values (${ag.id}, ${c}, 'practitioner', 1, 'sent')`;
    const [onb] = await sql`insert into onboardings (primary_contact_id, submitted_at, status, agreement_id) values (${c}, now(), 'submitted', ${ag.id}) returning id`;
    assert.equal((await D.person(sql, me, Q({ id: c }))).status.label, 'Waiting on signature');
    await sql`update onboardings set status = 'complete' where id = ${onb.id}`;
    assert.equal((await D.person(sql, me, Q({ id: c }))).status, null);
  }));
  test('lead labels name the group; a brand-new lead’s history line is "Nothing yet"', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const p = await D.person(sql, me, Q({ id: await h.contact(sql, me, { source: 'event' }) }));
    assert.equal(p.label, 'LEAD · EVENT AND TRAINING');
    assert.equal(p.last, 'Nothing yet');
  }));
  test('status row for each open order stage', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const one = async (o) => { const c = await h.contact(sql, me); await h.order(sql, c, me, o); return (await D.person(sql, me, Q({ id: c }))).status; };
    assert.equal((await one({ status: 'submitted' })).label, 'Waiting on approval');
    assert.equal((await one({ status: 'awaiting_md', lines: [['SAL400', 1, true]] })).label, 'Waiting on MD signature');
    assert.equal((await one({ status: 'approved', method: 'wire' })).label, 'Waiting on payment', 'a wire order waits until the money is marked received');
    const s = await one({ status: 'approved', lines: [['SAL400', 1, true]] });
    assert.deepEqual([s.kind, s.label, s.sub], ['samples', 'Preparing to ship', 'Samples · Free']);
    assert.equal(await one({ status: 'shipped', shipped: 1 }), null);
  }));
});

describe('history', () => {
  test('calls with next steps, notes from others, orders, samples, moves and where they came from, newest first', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { name: 'Pat Rep' }), boss = await h.user(sql, { name: 'Robin Boss' }), prev = await h.user(sql, { name: 'Jo Before' });
    const [ev] = await sql`insert into events (name, kind) values ('Unit training', 'training') returning id`;
    const c = await h.contact(sql, prev, { source: 'event', eventId: ev.id, createdAt: h.ago(60) });
    await h.order(sql, c, prev, { lines: [['SAL400', 2, true]], days: 50, shipped: 49 });
    await sql`update contacts set owner_id = ${me.id} where id = ${c}`;
    await h.order(sql, c, me, { status: 'shipped', shipped: 9, days: 10, lines: [['SAF100', 6], ['SAL400', 3]] });
    const call = await h.touch(sql, c, me.id, { days: 1, body: 'Wants to order.\nNext: send pricing' });
    await h.touch(sql, c, me.id, { days: 2, body: 'Visit', kind: 'meeting' });
    await h.task(sql, c, me.id, { title: 'Check back in a week', from: (await sql`select id from interactions where contact_id = ${c} and kind = 'meeting'`)[0].id });
    await h.touch(sql, c, boss.id, { kind: 'note', outcome: null, body: 'Bring the demo kit.', days: 3 });
    await h.touch(sql, c, me.id, { kind: 'email', subject: 'Pricing', body: 'Here it is', days: 4 });
    const { entries } = await D.history(sql, me, Q({ id: c }));
    const by = (t) => entries.filter((e) => e.type === t);
    const callE = entries.find((e) => e.id === call);
    assert.equal(callE.title, 'Call · reached');
    assert.equal(callE.next, 'send pricing', 'the written Next: line');
    assert.equal(callE.editable, true);
    assert.equal(entries.find((e) => e.kind === 'meeting').next, 'Check back in a week', 'the follow-up made from the visit');
    assert.equal(by('note')[0].title, 'Note from Robin');
    assert.equal(entries.find((e) => e.kind === 'email').editable, false);
    assert.equal(entries.find((e) => e.kind === 'email').body, 'Pricing — Here it is');
    assert.equal(by('order')[0].title, 'Order · $2,025');
    assert.equal(by('order')[0].body, '6 filler · 3 lips');
    assert.deepEqual([by('order')[0].status, by('order')[0].tone], ['Shipped', 'green']);
    assert.deepEqual([by('samples')[0].title, by('samples')[0].body], ['Samples', '2 lips']);
    assert.equal(by('event')[0].title, 'Moved to you from Jo Before');
    assert.equal(entries[entries.length - 1].title, 'Met at Unit training');
    const times = entries.map((e) => new Date(e.at).getTime());
    assert.deepEqual(times, times.slice().sort((a, b) => b - a), 'newest first');
    assert.match(entries[0].month, /^[A-Z][a-z]+$/);
  }));
  test('rejected and cancelled orders show in History, and still count for nothing (Q7)', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'rejected', days: 3, lines: [['SAF100', 2]] });
    await h.order(sql, c, me, { status: 'cancelled', days: 2, lines: [['SAL400', 1]] });
    const { entries } = await D.history(sql, me, Q({ id: c }));
    const orders = entries.filter((e) => e.type === 'order');
    assert.deepEqual(orders.map((e) => [e.title, e.status, e.tone]), [['Order · $225', 'Cancelled', 'grey'], ['Order · $450', 'Rejected', 'grey']]);
    assert.equal((await D.person(sql, me, Q({ id: c }))).stage, 'lead', 'they still count for nothing');
  }));
  test('origin lines for social and other sources', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const s = await h.contact(sql, me, { source: 'social', detail: 'Instagram' });
    const fb = await h.contact(sql, me, { source: 'social', detail: 'Facebook' });
    const plain = await h.contact(sql, me, { source: 'social' });
    const w = await h.contact(sql, me, { source: 'warm', detail: 'Referral' });
    const c = await h.contact(sql, me, { source: 'cold' });
    const last = async (id) => { const e = (await D.history(sql, me, Q({ id }))).entries; return e[e.length - 1].title; };
    assert.equal(await last(s), 'Came from an Instagram ad');
    assert.equal(await last(fb), 'Came from a Facebook ad');
    assert.equal(await last(plain), 'Came from a social media ad');
    assert.equal(await last(w), 'Came from Referral');
    assert.equal(await last(c), 'Added to My Fifty');
  }));
});

describe('ready, products and search', () => {
  test('ready to order: onboarded or ordered before, alphabetical', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const onboarded = await h.contact(sql, me, { first: 'Bea' });
    await sql`insert into onboardings (primary_contact_id, status) values (${onboarded}, 'signed')`;
    const ordered = await h.contact(sql, me, { first: 'Ace' }); await h.order(sql, ordered, me, { status: 'submitted' });
    const pending = await h.contact(sql, me, { first: 'Cy' }); await sql`insert into onboardings (primary_contact_id, status) values (${pending}, 'submitted')`;
    await h.contact(sql, me, { first: 'Dee' });
    assert.deepEqual((await D.ready(sql, me)).people.map((p) => p.name.split(' ')[0]), ['Ace', 'Bea']);
  }));
  test('ready to order with an empty book', () => h.withDb(async (sql) => assert.deepEqual((await D.ready(sql, await h.user(sql))).people, [])));
  test('products in the mockup\'s categories and order, sizes as names, free-only extras, Exprecell unavailable, the card on file', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'shipped', days: 20, lines: [['SAF100', 4], ['MN2550', 1]], paid: true, brand: 'Visa', last4: '4242', method: 'card_on_file' });
    const p = await D.products(sql, me, Q({ id: c }));
    assert.deepEqual(p.cats.map((x) => x.label), ['saypha', 'Magic Needle', 'Mesbio', 'Skin care', 'Exprecell', 'Other']);
    assert.deepEqual(p.card, { saved: true, text: 'Visa •••• 4242' });
    assert.equal(p.sameAsLast, undefined, 'no Same as last order (the mockup has none)');
    assert.deepEqual(p.products.filter((x) => x.cat === 'saypha').map((x) => x.sku), ['SAF100', 'SAL400', 'SAV200', 'SAVP300']);
    const mn = p.products.find((x) => x.sku === 'MN2550');
    assert.deepEqual([mn.cat, mn.name, mn.fullName, mn.price], ['cannula', '25G 50mm', 'Magic Needle 25G 50mm', 185]);
    assert.deepEqual(p.products.filter((x) => x.cat === 'mesbio').slice(0, 3).map((x) => x.name), ['27G 4mm', '27G 8mm', '27G 12mm']);
    const hb = p.products.find((x) => x.sku === 'HDB100');
    assert.deepEqual([hb.cat, hb.freeOnly], ['other', true]);
    const ex = p.products.find((x) => x.sku === 'EXPRECELL');
    assert.deepEqual([ex.cat, ex.unavailable], ['prp', true], 'Exprecell is shown as Unavailable');
    assert.ok(p.products.filter((x) => x.unavailable).every((x) => x.cat === 'prp'), 'no other inactive product is shown');
  }));
  test('a saved card from onboarding counts as card on file; otherwise none', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const a = await h.contact(sql, me), b = await h.contact(sql, me);
    await sql`insert into onboardings (primary_contact_id, status, card_saved_at) values (${a}, 'complete', now())`;
    assert.deepEqual((await D.products(sql, me, Q({ id: a }))).card, { saved: true, text: 'Card on file' });
    assert.deepEqual((await D.products(sql, me, Q({ id: b }))).card, { saved: false, text: '' });
  }));
  test('search finds by name, clinic, email or phone, in my book only', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const cl = await h.clinic(sql, { name: 'Zebra Clinic' });
    await h.contact(sql, me, { first: 'Quinn', clinicId: cl.id, phone: '+16475559999' });
    await h.contact(sql, other, { first: 'Quinn' });
    assert.equal((await D.search(sql, me, Q({ q: 'quinn' }))).people.length, 1);
    assert.equal((await D.search(sql, me, Q({ q: 'zebra' }))).people.length, 1);
    assert.equal((await D.search(sql, me, Q({ q: '5559999' }))).people.length, 1);
    assert.equal((await D.search(sql, me, Q({ q: 'nobody-here' }))).people.length, 0);
    assert.equal((await D.search(sql, me, Q({}))).people.length, 1);
  }));
});

describe('order, onboarding and rewards screens', () => {
  test('order progress: someone else’s order is not found', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const o = await h.order(sql, await h.contact(sql, other), other);
    await assert.rejects(D.order(sql, me, Q({ id: o })), (e) => e.status === 404);
    await assert.rejects(D.order(sql, me, Q({ id: 'bad' })), (e) => e.status === 400);
  }));
  test('an order I am credited on is visible even after the person moved', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const o = await h.order(sql, await h.contact(sql, other), me, { status: 'shipped' });
    assert.equal((await D.order(sql, me, Q({ id: o }))).id, o);
  }));
  test('waiting on a pay link offers Resend; onboarding row shows', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me, { designation: 'MD' });
    const o = await h.order(sql, c, me, { status: 'approved', approved: true, method: 'pay_link' });
    await sql`insert into payments (order_id, kind, method, amount, status, provider, pay_link_url) values (${o}, 'charge', 'pay_link', 450, 'pending', 'stripe', 'https://pay.test')`;
    await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'complete', now())`;
    const r = await D.order(sql, me, Q({ id: o }));
    assert.equal(r.action, 'resend_pay_link');
    assert.equal(r.total, '$450');
    assert.match(r.name, /^Dr\. /);
    assert.equal(r.onboarding.done, true);
    assert.match(r.onboarding.value, /^Signed /);
  }));
  test('paid orders offer nothing; samples waiting on the MD offer Remind', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me), md = await h.contact(sql, null, { owner: null, md: true, first: 'Lee', designation: 'MD' });
    const paid = await h.order(sql, c, me, { status: 'paid' });
    assert.equal((await D.order(sql, me, Q({ id: paid }))).action, null);
    const s = await h.order(sql, c, me, { status: 'awaiting_md', approved: true, mdId: md, lines: [['SAL400', 2, true]] });
    await sql`insert into agreements (kind, contact_id, order_id, status, sent_at) values ('md_pdr', ${c}, ${s}, 'waiting', now())`;
    const r = await D.order(sql, me, Q({ id: s }));
    assert.deepEqual([r.sample, r.total, r.action, r.onboarding], [true, 'Free', 'remind_md', null]);
    assert.deepEqual(r.lines, [{ name: 'saypha® lips', qty: 2 }]);
    assert.match(r.steps[2].when, /^Sent to Dr\. Lee /);
  }));
  test('onboarding progress (L20) and no form yet', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me), md = await h.contact(sql, null, { owner: null });
    assert.deepEqual(await D.onboarding(sql, me, Q({ id: c })).then((r) => r.none), true);
    const [ag] = await sql`insert into agreements (kind, contact_id, status, sent_at) values ('onboarding', ${c}, 'waiting', now() - interval '2 days') returning id`;
    await sql`insert into agreement_signers (agreement_id, contact_id, role, sign_order, status, signed_at) values (${ag.id}, ${c}, 'practitioner', 1, 'signed', now()), (${ag.id}, ${md}, 'md', 2, 'sent', null)`;
    const [onb] = await sql`insert into onboardings (primary_contact_id, submitted_at, status, agreement_id, card_saved_at) values (${c}, now(), 'submitted', ${ag.id}, now()) returning id`;
    const r = await D.onboarding(sql, me, Q({ id: c }));
    assert.deepEqual(r.steps.map((s) => [s.label, s.done]), [['Form submitted', true], ['Initial signature', true], ['MD signature', false], ['Ready to order', false]]);
    assert.equal(r.steps[2].when, 'Waiting · 2 days');
    assert.equal(r.action, 'remind_md');
    assert.equal(r.onboardingId, onb.id);
    assert.match(r.card, /^Saved /);
  }));
  test('an abandoned onboarding is ignored', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await sql`insert into onboardings (primary_contact_id, status) values (${c}, 'abandoned')`;
    assert.equal((await D.onboarding(sql, me, Q({ id: c }))).none, true);
  }));
  test('rewards answers (the rules are tested in rewards.test.js)', () => h.withDb(async (sql) => {
    const r = await D.rewards(sql, await h.user(sql));
    assert.match(r.extra, /^\$/);
  }));
});
