// What n8n looks up, from v2 (api/_lookup.js, data-flow improvement 4, owner 2026-10-28). TEST database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const L = require('../../api/_lookup');

after(() => h.closeDb());

test('splitHours drops the time-zone line and names its zone', () => {
  assert.deepEqual(L.splitHours('Monday: 9 AM - 5 PM\nTuesday: Closed\n(Pacific Time (PT))'), { hours: 'Monday: 9 AM - 5 PM\nTuesday: Closed', tz: 'Pacific Time (PT)' });
  assert.deepEqual(L.splitHours('Monday: 9 AM - 5 PM'), { hours: 'Monday: 9 AM - 5 PM', tz: '' });
});

test('clinic hours by the customer\'s email (or second email), else by clinic name; nothing found is found:false', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql);
    const n = h.uid();
    const [cl] = await sql`insert into clinics (name, city, province, hours_of_operation) values (${'Hours Unit Clinic ' + n}, 'Toronto', 'ON', 'Monday: 9:00 AM - 5:00 PM\nTuesday: Closed') returning id, name`;
    const c = await h.contact(sql, rep, { email: 'hours.' + n + '@demo.invalid' });
    await sql`update contacts set clinic_id = ${cl.id}, secondary_email = ${'second.' + n + '@demo.invalid'} where id = ${c}`;
    const a = await L.clinicHours(sql, 'HOURS.' + n + '@demo.invalid', '');
    assert.deepEqual(a, { found: true, clinic: cl.name, hours: 'Monday: 9:00 AM - 5:00 PM\nTuesday: Closed', tz: 'Eastern Time (ET)' });
    assert.equal((await L.clinicHours(sql, 'second.' + n + '@demo.invalid', '')).found, true);
    assert.equal((await L.clinicHours(sql, 'nobody.' + n + '@demo.invalid', cl.name)).clinic, cl.name, 'by the order\'s clinic name');
    assert.equal((await L.clinicHours(sql, 'nobody.' + n + '@demo.invalid', '')).found, false);
  });
});

test('owner name in HubSpot\'s owner shape; an unknown owner is found:false', async () => {
  await h.withDb(async (sql) => {
    const a = await L.ownerName(sql, '268233804');
    if (a.found) assert.equal(typeof a.firstName, 'string');
    assert.deepEqual(await L.ownerName(sql, '1'), { found: false, name: '', email: '' });
  });
});

test('onboarded: a signed onboarding or an earlier order that went through; the order being checked does not count (Yousef 2026-11-04)', async () => {
  await h.withDb(async (sql) => {
    const rep = await h.user(sql);
    const n = h.uid();
    const signed = await h.contact(sql, rep, { email: 'onb.signed.' + n + '@demo.invalid' });
    await sql`insert into onboardings (primary_contact_id, status) values (${signed}, 'signed')`;
    assert.deepEqual(await L.onboarded(sql, 'ONB.signed.' + n + '@demo.invalid'), { found: true, onboarded: true });
    const lead = await h.contact(sql, rep, { email: 'onb.lead.' + n + '@demo.invalid' });
    assert.deepEqual(await L.onboarded(sql, 'onb.lead.' + n + '@demo.invalid'), { found: true, onboarded: false }, 'no onboarding, no order');
    const first = await h.order(sql, lead, rep, { status: 'submitted' });
    assert.equal((await L.onboarded(sql, 'onb.lead.' + n + '@demo.invalid', first)).onboarded, false, 'its own first order does not make it onboarded');
    await h.order(sql, lead, rep, { status: 'cancelled' });
    assert.equal((await L.onboarded(sql, 'onb.lead.' + n + '@demo.invalid', first)).onboarded, false, 'a cancelled order does not count');
    await h.order(sql, lead, rep, { status: 'delivered' });
    assert.equal((await L.onboarded(sql, 'onb.lead.' + n + '@demo.invalid', first)).onboarded, true, 'an earlier order that went through counts');
    assert.deepEqual(await L.onboarded(sql, 'nobody.' + n + '@demo.invalid'), { found: false, onboarded: false });
    assert.deepEqual(await L.onboarded(sql, ''), { found: false, onboarded: false });
  });
});
