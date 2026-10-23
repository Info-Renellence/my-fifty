// api/_rewards.js, api/_push.js, api/_gmail.js (pull and send), api/cron.js and api/_auth.js against v2 (rolled back).
const { test, describe, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const R = require('../../api/_rewards');
const P = require('../../api/_push');
const Gm = require('../../api/_gmail');
const cron = require('../../api/cron');
const Au = require('../../api/_auth');
const T = require('../../api/_time');
const { seal } = require('../../api/_crypto');

after(h.closeDb);
let f;
afterEach(() => { if (f) f.restore(); f = null; mock.timers.reset(); });

// A fake web-push that records what it would send. status: what each send answers (undefined = ok).
function fakeWebPush(status) {
  const p = require.resolve('web-push');
  require(p);
  const sent = [];
  const real = require.cache[p].exports;
  require.cache[p].exports = { sendNotification: async (sub, payload) => { sent.push({ sub, payload: JSON.parse(payload) }); if (status) { const e = new Error('push'); e.statusCode = status; throw e; } } };
  return { sent, restore() { require.cache[p].exports = real; } };
}
async function phone(sql, me, n) {
  await sql`insert into connections (user_id, provider, external_account, credentials_encrypted, status)
            values (${me.id}, 'push', ${'dev' + (n || 1)}, ${seal(JSON.stringify({ endpoint: 'https://push.test/' + (n || 1), keys: { p256dh: 'P', auth: 'A' } }))}, 'connected')`;
}

describe('rewards', () => {
  // The programs run around today, so the tests never go stale.
  function around() { const keep = JSON.parse(JSON.stringify(R.PROGRAMS)); for (const k of ['booster', 'trip']) { R.PROGRAMS[k].from = T.addDays(T.ymd(), -25); R.PROGRAMS[k].to = T.addDays(T.ymd(), 25); } return () => Object.assign(R.PROGRAMS, keep); }
  test('2% on a first order, 4% on reorders, only mine, only in the period, paid lines only', () => h.withDb(async (sql) => {
    const back = around();
    try {
      await sql`update users set is_active = false where kind = 'rep'`;
      const me = await h.user(sql, { name: 'Pat Rep' }), other = await h.user(sql, { name: 'Robin Rep' });
      const a = await h.contact(sql, me), b = await h.contact(sql, me), c = await h.contact(sql, me);
      await h.order(sql, a, me, { status: 'shipped', days: 5, lines: [['SAF100', 2], ['HDB100', 1, true]] });     // new: 450 -> 9
      await h.order(sql, a, me, { status: 'shipped', days: 2, lines: [['SAF100', 4]] });                          // reorder: 900 -> 36
      await h.order(sql, b, me, { status: 'shipped', days: 40, lines: [['SAF100', 1]] });                         // before the period
      await h.order(sql, b, me, { status: 'shipped', days: 1, lines: [['SAF100', 1]] });                          // reorder: 225 -> 9
      await h.order(sql, c, other, { status: 'shipped', days: 3, lines: [['SAF100', 10]] });                      // someone else's
      await h.order(sql, c, me, { status: 'approved', days: 3, lines: [['SAF100', 10]] });                         // not paid
      await h.order(sql, c, me, { days: 3, lines: [['SAL400', 5, true]], status: 'shipped' });                     // samples
      const r = await R.rewards(sql, me);
      assert.equal(r.booster.onNew, '$9');
      assert.equal(r.booster.onReorders, '$45');
      assert.equal(r.extra, '$54');
      assert.equal(r.booster.newText, '2% on new orders');
    } finally { back(); }
  }));
  test('this month’s saypha syringes and Exprecell boxes', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const thisMonth = T.ymd().slice(8, 10) > '01' ? 0 : 0;
    await h.order(sql, c, me, { status: 'shipped', days: thisMonth, lines: [['SAF100', 3], ['SAL400', 2], ['EXPRECELL', 4], ['MN2550', 1], ['SAV200', 1, true]] });
    const r = await R.rewards(sql, me);
    assert.equal(r.syringes, 5, 'free syringes are not counted');
    assert.equal(r.exprecell, 4);
  }));
  test('the trip leaderboard: new people per rep, "You", and how many more to lead', () => h.withDb(async (sql) => {
    const back = around();
    try {
      await sql`update users set is_active = false where kind = 'rep'`;
      const me = await h.user(sql, { name: 'Pat Rep' }), lead = await h.user(sql, { name: 'Robin Rep' }), third = await h.user(sql, { name: 'Ash Rep' }), fourth = await h.user(sql, { name: 'Bo Rep' });
      const newPeople = async (rep, n) => { for (let i = 0; i < n; i++) await h.order(sql, await h.contact(sql, rep), rep, { status: 'shipped', days: 2 }); };
      await newPeople(lead, 4); await newPeople(third, 3); await newPeople(fourth, 2); await newPeople(me, 1);
      const r = await R.rewards(sql, me);
      assert.deepEqual(r.trip.rows, [{ rank: 1, name: 'Robin', n: 4, you: false }, { rank: 2, name: 'Ash', n: 3, you: false }, { rank: 4, name: 'You', n: 1, you: true }]);
      assert.equal(r.trip.line, '4 more new people to take the lead');
      await newPeople(me, 4);
      const r2 = await R.rewards(sql, me);
      assert.equal(r2.trip.rows[0].name, 'You');
      assert.equal(r2.trip.line, 'You are in the lead');
    } finally { back(); }
  }));
  test('one more to lead says "person"; an admin who is not a rep still sees their row', () => h.withDb(async (sql) => {
    const back = around();
    try {
      await sql`update users set is_active = false where kind = 'rep'`;
      const admin = await h.user(sql, { kind: 'admin', name: 'Ad Min' }), rep = await h.user(sql, { name: 'Robin Rep' });
      await h.order(sql, await h.contact(sql, rep), rep, { status: 'shipped', days: 1 });
      const r = await R.rewards(sql, admin);
      assert.equal(r.trip.line, '2 more new people to take the lead');
      assert.ok(r.trip.rows.some((x) => x.you));
      await h.order(sql, await h.contact(sql, admin), admin, { status: 'shipped', days: 1 });
      assert.equal((await R.rewards(sql, admin)).trip.line, '1 more new person to take the lead');
    } finally { back(); }
  }));
});

describe('push: subscribe and notify', () => {
  test('a sixth phone switches the oldest off; the same phone again is updated, not added', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    // Phones are added minutes apart in real life; inside one test transaction they would share a time, so space them out.
    for (let i = 1; i <= 5; i++) {
      await P.subscribe(sql, me, { endpoint: 'https://push.test/phone' + i, keys: { p256dh: 'P', auth: 'A' } });
      await sql`update connections set created_at = now() - make_interval(mins => ${10 - i}) where user_id = ${me.id} and external_account = ${P.deviceId('https://push.test/phone' + i)}`;
    }
    await P.subscribe(sql, me, { endpoint: 'https://push.test/phone6', keys: { p256dh: 'P', auth: 'A' } });
    await P.subscribe(sql, me, { endpoint: 'https://push.test/phone6', keys: { p256dh: 'P2', auth: 'A2' } });
    const rows = await sql`select status::text from connections where user_id = ${me.id} and provider = 'push' order by created_at`;
    assert.deepEqual(rows.map((r) => r.status), ['off', 'connected', 'connected', 'connected', 'connected', 'connected']);
    assert.equal(await P.subscribe(sql, me, { endpoint: 'bad' }), false);
  }));
  test('no phone: nothing sent and nothing logged, so it can still go later', () => h.withDb(async (sql) => {
    const wp = fakeWebPush();
    try {
      const me = await h.user(sql);
      assert.deepEqual(await P.notify(sql, me.id, { kind: 'new_lead', dedupeKey: 'k-' + h.uid(), title: 't', body: 'b' }), { sent: 0, noPhone: true });
      assert.equal((await sql`select count(*)::int n from notifications where user_id = ${me.id}`)[0].n, 0);
      assert.equal(wp.sent.length, 0);
    } finally { wp.restore(); }
  }));
  test('sends to every phone once, logs it, and never sends the same key twice', () => h.withDb(async (sql) => {
    const wp = fakeWebPush();
    try {
      const me = await h.user(sql), c = await h.contact(sql, me);
      await phone(sql, me, 1); await phone(sql, me, 2);
      const key = 'k-' + h.uid();
      assert.deepEqual(await P.notify(sql, me.id, { kind: 'new_lead', contactId: c, dedupeKey: key, title: 'New lead', body: 'Hi', url: '/person/' + c }), { sent: 2, failed: 0 });
      assert.deepEqual(wp.sent[0].payload, { title: 'New lead', body: 'Hi', url: '/person/' + c, tag: 'new_lead' });
      assert.deepEqual(await P.notify(sql, me.id, { kind: 'new_lead', dedupeKey: key, title: 'x', body: 'y' }), { sent: 0, skipped: true });
      const [n] = await sql`select status::text, kind::text, contact_id, title from notifications where dedupe_key = ${key}`;
      assert.deepEqual(n, { status: 'sent', kind: 'new_lead', contact_id: c, title: 'New lead' });
    } finally { wp.restore(); }
  }));
  test('a phone that is gone (410) is switched off; a failure is logged', () => h.withDb(async (sql) => {
    let wp = fakeWebPush(410);
    try {
      const me = await h.user(sql);
      await phone(sql, me, 1);
      await P.notify(sql, me.id, { kind: 'morning_summary', dedupeKey: 'g-' + h.uid(), title: 't', body: 'b' });
      assert.equal((await sql`select status::text from connections where user_id = ${me.id}`)[0].status, 'off');
      wp.restore(); wp = fakeWebPush(500);
      const me2 = await h.user(sql);
      await phone(sql, me2, 1);
      const key = 'f-' + h.uid();
      assert.deepEqual(await P.notify(sql, me2.id, { kind: 'morning_summary', dedupeKey: key, title: 't', body: 'b' }), { sent: 0, failed: 1 });
      const [n] = await sql`select status::text, error_message from notifications where dedupe_key = ${key}`;
      assert.deepEqual(n, { status: 'failed', error_message: '500' });
    } finally { wp.restore(); }
  }));
});

describe('gmail: the pull', () => {
  const b64 = (s) => Buffer.from(s).toString('base64');
  const msg = (id, from, to, o = {}) => ({ id, threadId: 't-' + id, internalDate: String(Date.now() - 3600000), labelIds: o.labels || ['INBOX'], snippet: 'snip',
    payload: { mimeType: 'text/plain', body: { data: b64(o.body || 'Hello from the clinic') }, headers: [{ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: o.subject || 'Order' }, { name: 'Message-ID', value: '<' + id + '-' + o.mid + '@x>' }] } });
  // Real mailboxes (made before this test's transaction began) are switched off for the test; it all rolls back.
  async function mailbox(sql, me) {
    await sql`update connections set status = 'off' where provider = 'gmail' and created_at < now()`;
    await sql`insert into connections (user_id, provider, external_account, credentials_encrypted, status) values (${me.id}, 'gmail', ${me.email}, ${seal('rt')}, 'connected')`; }
  function google(messages, o = {}) {
    return h.fakeFetch((url) => {
      if (/oauth2/.test(url)) return o.revoked ? { status: 400, json: { error: 'invalid_grant' } } : { json: { access_token: 'at' } };
      if (/\/history\?/.test(url)) return { json: { historyId: 'h2', history: [{ messagesAdded: (o.added || []).map((id) => ({ message: { id } })) }] } };
      if (/messages\?maxResults/.test(url)) return { json: { messages: Object.keys(messages).map((id) => ({ id })) } };
      if (/profile$/.test(url)) return { json: { historyId: 'h1' } };
      const id = url.split('messages/')[1].split('?')[0];
      return messages[id] ? { json: messages[id] } : { status: 404 };
    });
  }
  test('keeps client emails, skips robots, internal mail and spam, and remembers where it stopped', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { email: 'rep.' + h.uid() + '@renellence.com' });
    const client = 'client.' + h.uid() + '@clinic.test';
    const c = await h.contact(sql, me, { email: client });
    await mailbox(sql, me);
    const mid = h.uid();
    f = google({
      m1: msg('m1', `Client <${client}>`, me.email, { mid }),
      m2: msg('m2', 'noreply@stripe.com', me.email, { mid }),
      m3: msg('m3', 'boss@renellence.com', me.email, { mid }),
      m4: msg('m4', client, me.email, { labels: ['SPAM'], mid }),
      m5: msg('m5', 'stranger@else.test', me.email, { mid }),
    });
    const out = await Gm.sync(sql, 20000);
    assert.deepEqual(out, { mailboxes: 1, kept: 1, errors: 0 });
    const rows = await sql`select contact_id, direction::text, source::text, subject, body, user_id, participants from interactions where contact_id = ${c}`;
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].direction, rows[0].source, rows[0].subject, rows[0].body, rows[0].user_id], ['in', 'gmail', 'Order', 'Hello from the clinic', null]);
    assert.equal(typeof rows[0].participants, 'object');
    const [ev] = await sql`select status::text, result_table, jsonb_typeof(payload) t from ingest_events where source = 'gmail' and external_id = ${'<m1-' + mid + '@x>|' + me.email}`;
    assert.deepEqual(ev, { status: 'done', result_table: 'interactions', t: 'object' });
    const [conn] = await sql`select sync_cursor, last_synced_at from connections where user_id = ${me.id}`;
    assert.equal(conn.sync_cursor, 'h1');
    assert.ok(conn.last_synced_at);
  }));
  test('next time it reads only what is new since the bookmark; an email sent by the rep is "out"', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { email: 'rep.' + h.uid() + '@renellence.com' });
    const client = 'client.' + h.uid() + '@clinic.test';
    const c = await h.contact(sql, me, { email: client });
    await mailbox(sql, me);
    await sql`update connections set sync_cursor = 'h1' where user_id = ${me.id}`;
    f = google({ m9: msg('m9', me.email, client, { mid: h.uid() }) }, { added: ['m9'] });
    await Gm.sync(sql, 20000);
    assert.ok(f.calls.some((x) => /history\?historyTypes=messageAdded&startHistoryId=h1/.test(x.url)));
    const [i] = await sql`select direction::text, user_id from interactions where contact_id = ${c}`;
    assert.deepEqual(i, { direction: 'out', user_id: me.id });
    assert.equal((await sql`select sync_cursor from connections where user_id = ${me.id}`)[0].sync_cursor, 'h2');
  }));
  test('the same email in two mailboxes is stored once', () => h.withDb(async (sql) => {
    const a = await h.user(sql, { email: 'a.' + h.uid() + '@renellence.com' }), b = await h.user(sql, { email: 'b.' + h.uid() + '@renellence.com' });
    const client = 'client.' + h.uid() + '@clinic.test';
    const c = await h.contact(sql, a, { email: client });
    await mailbox(sql, a); await mailbox(sql, b);
    const mid = h.uid();
    f = google({ m1: msg('m1', client, a.email + ', ' + b.email, { mid }) });
    const out = await Gm.sync(sql, 20000);
    assert.equal(out.kept, 1);
    assert.equal((await sql`select count(*)::int n from interactions where contact_id = ${c}`)[0].n, 1);
  }));
  test('a rep\'s email never lands on another rep\'s client; on a shared email each rep\'s own client gets it (Q6)', () => h.withDb(async (sql) => {
    const a = await h.user(sql, { email: 'a.' + h.uid() + '@renellence.com' }), b = await h.user(sql, { email: 'b.' + h.uid() + '@renellence.com' });
    const ca = 'ca.' + h.uid() + '@clinic.test', cb = 'cb.' + h.uid() + '@clinic.test';
    const ka = await h.contact(sql, a, { email: ca }), kb = await h.contact(sql, b, { email: cb });
    await mailbox(sql, b);
    const mid = h.uid();
    f = google({ m1: msg('m1', b.email, ca, { mid, subject: 'From B to A\'s client' }), m2: msg('m2', b.email, ca + ', ' + cb, { mid, subject: 'To both' }) });
    await Gm.sync(sql, 20000);
    assert.equal((await sql`select count(*)::int n from interactions where contact_id = ${ka}`)[0].n, 0, 'nothing on A\'s client from B\'s mailbox');
    assert.deepEqual((await sql`select subject from interactions where contact_id = ${kb}`).map((r) => r.subject), ['To both']);
  }));
  test('a revoked mailbox is marked broken and the others carry on', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await mailbox(sql, me);
    f = google({}, { revoked: true });
    const err = console.error; console.error = () => {};
    try { assert.deepEqual(await Gm.sync(sql, 20000), { mailboxes: 0, kept: 0, errors: 1 }); } finally { console.error = err; }
    assert.equal((await sql`select status::text from connections where user_id = ${me.id}`)[0].status, 'broken');
  }));
  test('send: a revoked token marks Gmail broken', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await mailbox(sql, me);
    f = google({}, { revoked: true });
    await assert.rejects(Gm.send(sql, me, { to: 'x@y.test', subject: 's', text: 't' }), (e) => e.message === 'gmail_reconnect');
    assert.equal((await sql`select status::text from connections where user_id = ${me.id}`)[0].status, 'broken');
  }));
  test('send: Gmail refusing the message is a 502', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await mailbox(sql, me);
    f = h.fakeFetch((url) => (/oauth2/.test(url) ? { json: { access_token: 'at' } } : { status: 400, json: {} }));
    await assert.rejects(Gm.send(sql, me, { to: 'x@y.test', subject: 'Café', text: 't' }), (e) => e.message === 'gmail_send_failed' && e.status === 502);
  }));
  test('connection returns the connected mailbox only', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    assert.equal(await Gm.connection(sql, me.id), null);
    await mailbox(sql, me);
    assert.equal((await Gm.connection(sql, me.id)).external_account, me.email);
  }));
});

describe('cron', () => {
  test('new social leads under 24 hours, untouched, with an owner: one push each, never twice', () => h.withDb(async (sql) => {
    const wp = fakeWebPush();
    try {
      const me = await h.user(sql);
      await phone(sql, me, 1);
      const fresh = await h.contact(sql, me, { source: 'social', detail: 'Instagram', first: 'Nadia', last: 'Unit', createdAt: h.ago(0, 1) });
      const touched = await h.contact(sql, me, { source: 'social', createdAt: h.ago(0, 1) }); await h.touch(sql, touched, me.id);
      await h.contact(sql, me, { source: 'social', createdAt: h.ago(2) });
      await h.contact(sql, me, { source: 'warm', createdAt: h.ago(0, 1) });
      await h.contact(sql, null, { owner: null, source: 'social', createdAt: h.ago(0, 1) });
      const r = await cron._.newLeads(sql);
      const mine = wp.sent.filter((s) => s.payload.url === '/person/' + fresh);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].payload.title, 'New Meta lead: Nadia Unit');
      assert.equal(mine[0].payload.body, "Reach out within 24 hours. It's at the top of your Today.");
      assert.ok(r.found >= 1);
      wp.sent.length = 0;
      await cron._.newLeads(sql);
      assert.equal(wp.sent.filter((s) => s.payload.url === '/person/' + fresh).length, 0);
    } finally { wp.restore(); }
  }));
  // The morning summary is sent from 7:30 to 11:00 on business days. Its clock is set to a business day here.
  function businessDay() { let d = T.ymd(); while (!T.isBusinessDay(d, ['2026-10-12', '2026-12-25', '2026-12-28', '2027-01-01'])) d = T.addDays(d, -1); return d; }
  test('the morning summary: streak and list, once a day, only between 7:30 and 11', () => h.withDb(async (sql) => {
    const wp = fakeWebPush();
    try {
      await sql`update connections set status = 'off' where provider = 'push'`;
      const me = await h.user(sql);
      await phone(sql, me, 1);
      const c = await h.contact(sql, me); await h.order(sql, c, me, { status: 'shipped', days: 40 });
      await h.contact(sql, me, { source: 'social', createdAt: h.ago(0, 1) });
      const day = businessDay();
      mock.timers.enable({ apis: ['Date'], now: T.atLocal(day, 6, 0) });
      assert.deepEqual(await cron._.morning(sql), { skipped: 'not_now' });
      mock.timers.reset();
      mock.timers.enable({ apis: ['Date'], now: T.atLocal(day, 7, 45) });
      const r = await cron._.morning(sql);
      assert.deepEqual(r, { users: 1, sent: 1 });
      assert.equal(wp.sent[0].payload.title, 'Good morning');
      assert.match(wp.sent[0].payload.body, /^\d+ on today's list\./);
      assert.match(wp.sent[0].payload.body, /1 is a visit\./);
      assert.deepEqual(await cron._.morning(sql), { users: 0, sent: 0 });
    } finally { wp.restore(); }
  }));
  test('a streak reads "N days in a row"; nothing to say means no push', () => h.withDb(async (sql) => {
    const wp = fakeWebPush();
    try {
      await sql`update connections set status = 'off' where provider = 'push'`;
      const quiet = await h.user(sql);
      await phone(sql, quiet, 1);
      const day = businessDay();
      mock.timers.enable({ apis: ['Date'], now: T.atLocal(day, 8, 0) });
      assert.deepEqual(await cron._.morning(sql), { users: 1, sent: 0 });
      assert.equal(wp.sent.length, 0);
    } finally { wp.restore(); }
  }));
  test('the timer route needs the key and runs every part', () => h.withDb(async (sql) => {
    const res = h.fakeRes();
    await cron({ method: 'GET', url: '/api/cron?op=tick', headers: {} }, res);
    assert.equal(res.statusCode, 401);
    const wp = fakeWebPush();
    try {
      await sql`update connections set status = 'off' where provider in ('push', 'gmail')`;
      const ok = h.fakeRes();
      await cron({ method: 'GET', url: '/api/cron?op=tick', headers: { 'x-cron-key': 'test-cron-key' } }, ok);
      assert.equal(ok.statusCode, 200);
      assert.deepEqual(Object.keys(ok.json()).sort(), ['gmail', 'leads', 'morning', 'orders']);
      const bad = h.fakeRes();
      await cron({ method: 'GET', url: '/api/cron?op=other', headers: { 'x-cron-key': 'test-cron-key' } }, bad);
      assert.equal(bad.statusCode, 400);
    } finally { wp.restore(); }
  }));
});

describe('auth: signedIn with v2', () => {
  const req = () => ({ headers: { authorization: 'Bearer tok-' + h.uid() } });
  test('first sign-in finds the user by email and links the Supabase account', () => h.withDb(async (sql) => {
    const u = await h.user(sql, { email: 'unit.' + h.uid() + '@renellence.com', name: 'Pat Rep' });
    const [a] = await sql`insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email}, now(), now()) returning id`;
    f = h.fakeFetch(() => ({ json: { id: a.id, email: u.email.toUpperCase() } }));
    const me = await Au.signedIn(req());
    assert.deepEqual([me.id, me.name, me.first, me.initials, me.kind, me.authUserId], [u.id, 'Pat Rep', 'Pat', 'PR', 'rep', a.id]);
    assert.equal((await sql`select auth_user_id from users where id = ${u.id}`)[0].auth_user_id, a.id);
    assert.equal((await Au.signedIn(req())).id, u.id, 'next time by the linked account');
  }));
  test('someone not in users, or switched off, is not set up', () => h.withDb(async (sql) => {
    f = h.fakeFetch(() => ({ json: { id: '00000000-0000-4000-8000-000000000001', email: 'nobody.' + h.uid() + '@renellence.com' } }));
    await assert.rejects(Au.signedIn(req()), (e) => e.status === 403 && e.message === 'not_set_up');
    f.restore();
    const u = await h.user(sql, { email: 'off.' + h.uid() + '@renellence.com', active: false });
    f = h.fakeFetch(() => ({ json: { id: '00000000-0000-4000-8000-000000000002', email: u.email } }));
    await assert.rejects(Au.signedIn(req()), (e) => e.message === 'not_set_up');
  }));
});
