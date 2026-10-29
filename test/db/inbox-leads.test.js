// info@ inbox leads (api/_inboxleads.js, owner 2026-10-29): info@'s new mail -> Claude marks the leads -> the territory
// rep gets the details by email. TEST database, rolled back; Google and claude-jobs are fakes, nothing leaves.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const { seal } = require('../../api/_crypto');
const IL = require('../../api/_inboxleads');

after(() => h.closeDb());
process.env.MYFIFTY_SECRET = process.env.MYFIFTY_SECRET || 'unit-secret';
process.env.CLAUDE_JOBS_URL = 'https://claude-jobs.unit.invalid/';
process.env.CLAUDE_JOBS_SECRET = 'unit';
const n = Date.now() % 1e8;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

// One fake mailbox: the messages, Google's answers, the emails sent, Claude's answers.
function google(messages, claude) {
  const sent = [], asked = [];
  const f = h.fakeFetch(async (url, init) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return { json: { access_token: 'at' } };
    if (url.includes('/messages?')) return { json: { messages: messages.map((m) => ({ id: m.id })).reverse() } };
    if (url.includes('/messages/send')) { sent.push(JSON.parse(init.body).raw); return { json: { id: 's' + sent.length } }; }
    const m = messages.find((x) => url.includes('/messages/' + x.id + '?'));
    if (m) return { json: { id: m.id, labelIds: ['INBOX'], snippet: '', payload: { mimeType: 'text/plain', body: { data: b64(m.body) },
      headers: [{ name: 'From', value: m.from }, { name: 'To', value: 'info@renellence.com' }, { name: 'Subject', value: m.subject }, { name: 'Date', value: 'Thu, 29 Oct 2026' }, { name: 'Message-ID', value: m.mid || '<' + m.id + '@mail.unit.invalid>' }] } } };
    if (url.startsWith(process.env.CLAUDE_JOBS_URL)) { const b = JSON.parse(init.body); asked.push(b); return claude(b); }
    return { status: 404, json: {} };
  });
  const mails = () => sent.map((raw) => Buffer.from(raw, 'base64url').toString('utf8'));
  return { f, mails, asked };
}

async function setup(sql) {
  await sql`update users set is_active = false where kind = 'rep'`;   // only this test's fictional reps
  const reps = {};
  for (const name of ['Brittany', 'Lucas', 'Emily']) reps[name] = await h.user(sql, { email: name.toLowerCase() + '.' + n + '@unit.invalid', name: name + ' Unittest' });
  let [info] = await sql`select id from users where lower(email) = 'info@renellence.com'`;
  if (!info) info = await h.user(sql, { email: 'info@renellence.com', name: 'Info Renellence', kind: 'admin' });
  await sql`update connections set status = 'off' where user_id = ${info.id} and provider = 'gmail'`;
  await sql`insert into connections (user_id, provider, external_account, credentials_encrypted, status) values (${info.id}, 'gmail', 'info@renellence.com', ${seal('refresh')}, 'connected')`;
  await sql`delete from settings where key = 'inbox_leads'`;
  return reps;
}
const result = (code, o) => Object.assign({ code, lead: true, kind: 'enquiry', name: '', clinic: '', email: '', phone: '', city: '', province: '', postal: '', registration: '', wants: '', summary: 'Wants to start.', location_source: '', location_url: '' }, o);

test('an application, an enquiry with no area, a person already in the book; customers and robots never reach Claude', async () => {
  await h.withDb(async (sql) => {
    const reps = await setup(sql);
    const customer = 'buyer.' + n + '@unit.invalid', inBook = 'inbook.' + n + '@unit.invalid';
    const cust = await h.contact(sql, reps.Emily, { email: customer });
    await h.order(sql, cust, reps.Emily, {});
    await h.contact(sql, reps.Lucas, { email: inBook });
    const msgs = [
      { id: 'a' + n, from: 'Info Renellence <info@renellence.com>', subject: 'New Account Application - Unit Spa', body: 'Clinic / Practice Unit Spa\nName Ann Unit\nEmail ann.' + n + '@unit.invalid' },
      { id: 'b' + n, from: 'Buyer <' + customer + '>', subject: 'Where is my order?', body: 'Order status please' },
      { id: 'c' + n, from: 'News <newsletter@unit.invalid>', subject: 'Weekly news', body: 'news' },
      { id: 'd' + n, from: 'Dana <dana.' + n + '@unit.invalid>', subject: 'Pricing', body: 'We are a clinic in Toronto, prices?' },
      { id: 'e' + n, from: 'In Book <' + inBook + '>', subject: 'Samples', body: 'Could we get samples?' },
      { id: 'f' + n, from: 'Info Renellence <info@renellence.com>', subject: 'Your Renellence order has shipped', body: 'shipped' },
      { id: 'g' + n, from: 'Web <web.' + n + '@unit.invalid>', subject: 'Found online', body: 'Hi, we are Web Clinic, interested' },
    ];
    const g = google(msgs, (b) => ({ json: { ok: true, costUsd: 0.01, results: b.emails.map((e) =>
      e.subject.startsWith('New Account') ? result(e.code, { kind: 'application', clinic: 'Unit Spa', name: 'Ann Unit', postal: 'V6B 1A1', registration: '999' })
        : e.subject === 'Pricing' ? result(e.code, { clinic: 'Dana Clinic', city: 'Toronto' })
        : e.subject === 'Found online' ? result(e.code, { clinic: 'Web Clinic', city: 'Calgary', province: 'AB', postal: 'T2P 1J9', location_source: 'web', location_url: 'https://web.unit.invalid/' })
        : result(e.code, { email: inBook })) } }));
    try {
      const out = await IL.run(sql, 50000);
      assert.equal(out.candidates, 4, JSON.stringify(out));
      assert.deepEqual(g.asked[0].emails.map((e) => e.subject).sort(), ['Found online', 'New Account Application - Unit Spa', 'Pricing', 'Samples']);
      assert.match(g.asked[0].emails.find((e) => e.subject === 'Samples').known, /in our book, owner Lucas Unittest/);
      assert.deepEqual([out.leads, out.sent, out.unassigned], [4, 4, 1]);
      const mails = g.mails();
      const to = (re) => mails.find((m) => re.test(m)) || '';
      assert.match(to(/Unit Spa/), new RegExp('To: ' + reps.Brittany.email));
      assert.match(to(/Unit Spa/), /Registration #: 999/);
      assert.match(to(/Unit Spa/), /Why you: postal area V6B/);
      assert.match(to(/Dana Clinic/), /To: info@renellence.com/);
      assert.match(to(/Dana Clinic/), /No rep found, please assign/);
      assert.match(to(/Samples/), new RegExp('To: ' + reps.Lucas.email));
      assert.match(to(/Web Clinic/), new RegExp('To: ' + reps.Brittany.email));
      assert.match(to(/Web Clinic/), /found online: https:\/\/web\.unit\.invalid\//);
      assert.ok(mails.every((m) => /^From: Renellence <info@renellence.com>/m.test(m)));
      const [st] = await sql`select value from settings where key = 'inbox_leads'`;
      assert.equal(new Set(st.value.seen).size, 7);
      assert.equal(st.value.log.length, 4);

      // the next tick: nothing new, Claude not asked, nothing sent again
      const again = await IL.run(sql, 50000);
      assert.deepEqual([again.new, again.candidates, g.asked.length, g.mails().length], [0, 0, 1, 4]);
    } finally { g.f.restore(); }
  });
});

test('Claude not reachable: nothing marked done, so the next tick tries the same mail again', async () => {
  await h.withDb(async (sql) => {
    await setup(sql);
    const msgs = [{ id: 'z' + n, from: 'Zed <zed.' + n + '@unit.invalid>', subject: 'Interested', body: 'Tell me more' }];
    const g = google(msgs, () => ({ status: 500, json: { ok: false, error: 'down' } }));
    try {
      const out = await IL.run(sql, 50000);
      assert.equal(out.error, 'down');
      const [st] = await sql`select value from settings where key = 'inbox_leads'`;
      assert.equal(st, undefined);
      assert.equal(g.mails().length, 0);
    } finally { g.f.restore(); }
  });
});

test('switched off: nothing read', async () => {
  await h.withDb(async (sql) => {
    await sql`insert into settings (key, value, updated_at) values ('flags', ${sql.json({ inbox_leads: false })}, now())
              on conflict (key) do update set value = settings.value || excluded.value`;
    require('../../api/_flags').clear();
    const out = await IL.run(sql, 50000);
    assert.deepEqual(out, { off: true });
  });
});

test('never reads its own alerts back, and emails a lead once (owner 2026-10-29: Emily got the same lead every 5 minutes)', async () => {
  await h.withDb(async (sql) => {
    require('../../api/_flags').clear();   // the switched-off test before this one left the cache off
    const reps = await setup(sql);
    const app = (id) => ({ id, from: 'Info Renellence <info@renellence.com>', subject: 'New Account Application - Loop Spa', body: 'Clinic Loop Spa, Email loop.' + n + '@unit.invalid' });
    const msgs = [
      app('l1' + n),
      // our own alert in info@'s Sent folder, as Gmail returns it for the application search
      { id: 'l2' + n, from: 'Renellence <info@renellence.com>', subject: 'New account application: Loop Spa', body: 'New account application from the info@ inbox.', mid: '<abc.def@myfifty.renellence.com>' },
      // the same application forwarded by someone
      { id: 'l3' + n, from: 'Info Renellence <info@renellence.com>', subject: 'Fwd: New Account Application - Loop Spa', body: 'Clinic Loop Spa, Email loop.' + n + '@unit.invalid' },
    ];
    const g = google(msgs, (b) => ({ json: { ok: true, results: b.emails.map((e) => result(e.code, { kind: 'application', clinic: 'Loop Spa', email: 'loop.' + n + '@unit.invalid', postal: 'V6B 1A1' })) } }));
    try {
      const out = await IL.run(sql, 50000);
      assert.equal(out.candidates, 2, 'our alert never goes to Claude');
      assert.ok(!g.asked[0].emails.some((e) => /^New account application:/.test(e.subject)));
      assert.equal(g.mails().length, 1, 'one email for the lead, not one per copy');
      assert.equal(out.repeats, 1);
      // the alert it just sent shows up in Sent on the next tick: still nothing
      msgs.push({ id: 'l4' + n, from: 'Renellence <info@renellence.com>', subject: 'New account application: Loop Spa', body: 'x', mid: '<zzz@myfifty.renellence.com>' });
      await IL.run(sql, 50000);
      assert.equal(g.mails().length, 1);
    } finally { g.f.restore(); }
  });
});
