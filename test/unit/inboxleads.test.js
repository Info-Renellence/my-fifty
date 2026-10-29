// info@ inbox leads (api/_inboxleads.js, owner 2026-10-29): which rep a lead goes to, worked out in code, and what they get.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../api/_inboxleads')._;

// Fictional people; the rule names reps the short way, as api/_territory.js does.
const REPS = [
  { email: 'sam.almas@renellence.com', full_name: 'Samantha Almas' },
  { email: 'lucas.stockley@renellence.com', full_name: 'Lucas Stockley' },
  { email: 'emily@renellence.com', full_name: 'Emily Grace' },
  { email: 'brittany.houston@renellence.com', full_name: 'Brittany Houston' },
  { email: 'angela.tuzzolino@renellence.com', full_name: 'Angela Tuzzolino' },
];
const lead = (o) => Object.assign({ kind: 'enquiry', name: 'Test Person', clinic: 'Test Clinic', email: 'x@unit.invalid', phone: '', city: '', province: '', postal: '', registration: '', wants: '', summary: 'Wants pricing.' }, o);

test('someone already in the book goes to their owner', () => {
  const r = L.route(lead({ postal: 'V6B 1A1' }), { owner: 'Emily Grace', owner_email: 'emily@renellence.com', owner_active: true }, REPS);
  assert.deepEqual(r.to.map((x) => x.email), ['emily@renellence.com']);
  assert.match(r.why, /already in your book/);
});

test('the postal code decides, by the territory rules', () => {
  for (const [postal, rep] of [['V6B 1A1', 'brittany.houston@renellence.com'], ['H2X 1Y4', 'angela.tuzzolino@renellence.com']]) {
    assert.deepEqual(L.route(lead({ postal }), null, REPS).to.map((x) => x.email), [rep], postal);
  }
  const on = L.route(lead({ postal: 'M5V 2T6' }), null, REPS);
  assert.ok(on.to.length >= 1 && on.to.every((x) => REPS.some((r) => r.email === x.email)));
});

test('no postal code: the province or city for BC, Alberta and Quebec; else nobody', () => {
  assert.deepEqual(L.route(lead({ city: 'Calgary' }), null, REPS).to.map((x) => x.email), ['brittany.houston@renellence.com']);
  assert.deepEqual(L.route(lead({ province: 'QC' }), null, REPS).to.map((x) => x.email), ['angela.tuzzolino@renellence.com']);
  const none = L.route(lead({ city: 'Toronto' }), null, REPS);
  assert.deepEqual(none.to, []);
  assert.match(none.why, /no postal code/);
});

test('a rep who is not active never gets it', () => {
  const r = L.route(lead({}), { owner: 'Old Rep', owner_email: 'old@renellence.com', owner_active: false }, REPS);
  assert.deepEqual(r.to, []);
});

test('the email has the details, why this rep, and the original mail', () => {
  const t = L.details(lead({ kind: 'application', registration: '123', phone: '5550000000' }), { subject: 'New Account Application - Test Clinic', from: 'Info <info@renellence.com>', date: 'today', body: 'original text' },
    { to: [{ name: 'A' }, { name: 'B' }], why: 'postal area M5V (Toronto), a shared area' });
  assert.match(t, /^New account application/);
  for (const s of ['Clinic: Test Clinic', 'Registration #: 123', 'Phone: 5550000000', 'Why you: postal area M5V', 'Also sent to A and B', 'original text']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('City:'));
});

test('website notices from info@ are kept; ordinary subjects are not', () => {
  assert.ok(L.NOTICE.test('New Account Application - Refresh MD Spa'));
  assert.ok(!L.NOTICE.test('Your Renellence order has shipped'));
});
