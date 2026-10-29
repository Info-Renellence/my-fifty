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
      headers: [{ name: 'From', value: m.from }, { name: 'To', value: 'info@renellence.com' }, { name: 'Subject', value: m.subject }, { name: 'Date', value: 'Thu, 29 Oct 2026' }] } } };
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
const result = (code, o) => Object.assign({ code, lead: true, kind: 'enquiry', name: '', clinic: '', email: '', phone: '', city: '', province: '', postal: '', registration: '', wants: '', summary: 'Wants to start.' }, o);

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
    ];
    const g = google(msgs, (b) => ({ json: { ok: true, costUsd: 0.01, results: b.emails.map((e) =>
      e.subject.startsWith('New Account') ? result(e.code, { kind: 'application', clinic: 'Unit Spa', name: 'Ann Unit', postal: 'V6B 1A1', registration: '999' })
        : e.subject === 'Pricing' ? result(e.code, { clinic: 'Dana Clinic', city: 'Toronto' })
        : result(e.code, { email: inBook })) } }));
    try {
      const out = await IL.run(sql, 50000);
      assert.equal(out.candidates, 3, JSON.stringify(out));
      assert.deepEqual(g.asked[0].emails.map((e) => e.subject).sort(), ['New Account Application - Unit Spa', 'Pricing', 'Samples']);
      assert.match(g.asked[0].emails.find((e) => e.subject === 'Samples').known, /in our book, owner Lucas Unittest/);
      assert.deepEqual([out.leads, out.sent, out.unassigned], [3, 3, 1]);
      const mails = g.mails();
      const to = (re) => mails.find((m) => re.test(m)) || '';
      assert.match(to(/Unit Spa/), new RegExp('To: ' + reps.Brittany.email));
      assert.match(to(/Unit Spa/), /Registration #: 999/);
      assert.match(to(/Unit Spa/), /Why you: postal area V6B/);
      assert.match(to(/Dana Clinic/), /To: info@renellence.com/);
      assert.match(to(/Dana Clinic/), /No rep found, please assign/);
      assert.match(to(/Samples/), new RegExp('To: ' + reps.Lucas.email));
      assert.ok(mails.every((m) => /^From: Renellence <info@renellence.com>/m.test(m)));
      const [st] = await sql`select value from settings where key = 'inbox_leads'`;
      assert.equal(st.value.seen.length, 6);
      assert.equal(st.value.log.length, 3);

      // the next tick: nothing new, Claude not asked, nothing sent again
      const again = await IL.run(sql, 50000);
      assert.deepEqual([again.new, again.candidates, g.asked.length, g.mails().length], [0, 0, 1, 3]);
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
