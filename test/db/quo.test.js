// Quo -> v2 (api/quo.js + v2-014, owner 2026-10-27) on the TEST database, rolled back. Fictional numbers only (555-01xx).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('../helpers');
const Q = require('../../api/quo');

after(() => h.closeDb());
const t = Date.now();
const ev = (id, type, o) => ({ id: id + t, type, createdAt: new Date().toISOString(), data: { object: Object.assign({ createdAt: new Date().toISOString(), phoneNumberId: 'PNEka6s0zF' }, o) } });

test('a call from a known number goes on that person\'s history; its AI summary follows; the same event twice is a duplicate', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const c = await h.contact(sql, me, { phone: '+15550100101' });
    const call = ev('EVa', 'call.completed', { id: 'ACknown' + t, direction: 'incoming', from: '+1 (555) 010-0101', to: '+13657005795', status: 'completed', answeredAt: new Date().toISOString(), duration: 95 });
    const r = await Q.handle(sql, call);
    assert.equal(r.table, 'interactions');
    const [i] = await sql`select kind::text, direction::text, outcome, user_id, participants from interactions where contact_id = ${c} and external_id = ${'ACknown' + t}`;
    assert.equal(i.kind, 'call'); assert.equal(i.direction, 'in'); assert.equal(i.outcome, 'connected');
    assert.ok(i.user_id, 'the 365 line is Emily\'s');
    assert.deepEqual(await Q.handle(sql, call), { ok: true, duplicate: true });
    await Q.handle(sql, ev('EVb', 'call.summary.completed', { callId: 'ACknown' + t, summary: ['Wants lips pricing.'], nextSteps: ['Send pricing'] }));
    const [a] = await sql`select output_text from ai_outputs a join interactions i on i.id = a.interaction_id where i.external_id = ${'ACknown' + t}`;
    assert.equal(a.output_text, 'Wants lips pricing.\nNext: Send pricing');
  });
});

test('an unknown number is held (no contact is made) and attaches when a contact gets that number', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const [{ n: before }] = await sql`select count(*)::int n from contacts`;
    const r = await Q.handle(sql, ev('EVc', 'message.received', { id: 'ACnew' + t, direction: 'incoming', from: '+15550100102', to: '+13657005795' }));
    assert.equal(r.held, true);
    const [{ n: after1 }] = await sql`select count(*)::int n from contacts`;
    assert.equal(after1, before, 'Quo never creates a contact');
    const c = await h.contact(sql, me, { phone: '(555) 010-0102' });
    const [i] = await sql`select kind::text from interactions where contact_id = ${c} and external_id = ${'ACnew' + t}`;
    assert.equal(i.kind, 'text');
    const [q] = await sql`select attached_contact_id from quo_unmatched where quo_id = ${'ACnew' + t}`;
    assert.equal(q.attached_contact_id, c);
  });
});

test('outgoing texts on the 647 line (n8n\'s automated texts) are skipped; a bad signature is refused', async () => {
  await h.withDb(async (sql) => {
    const r = await Q.handle(sql, ev('EVd', 'message.delivered', { id: 'ACauto' + t, phoneNumberId: 'PNMnOzgxCz', direction: 'outgoing', from: '+16475840040', to: '+15550100103' }));
    assert.equal(r.skipped, true);
  });
  const key = Buffer.from('test-signing-key').toString('base64');
  process.env.QUO_WEBHOOK_SECRET = key;
  try {
    const raw = '{"id":"x"}', ts = String(Date.now());
    const sig = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(ts + '.' + raw).digest('base64');
    assert.equal(Q.signatureOk('hmac;1;' + ts + ';' + sig, raw), true);
    assert.equal(Q.signatureOk('hmac;1;' + ts + ';' + sig, raw + ' '), false);
    assert.equal(Q.signatureOk('hmac;1;' + (Date.now() - 3600e3) + ';' + sig, raw), false);
  } finally { delete process.env.QUO_WEBHOOK_SECRET; }
});
