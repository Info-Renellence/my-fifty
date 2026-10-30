// Go-live 2026-10-30: the new Edge asks Pulse to send its orders, pay-link resends and Gmail (POST /api/cron?op=edge_send with
// the shared intake secret), because Edge cannot hold Pulse's sensitive keys. Only the right secret opens it; bad input is a
// clear 400/404; an email goes out through Pulse's own Gmail send as that rep (here: no connection -> 409).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const cron = require('../../api/cron')._;

test('edge_send: only the intake secret opens it', () => {
  process.env.N8N_INTAKE_SECRET = 'unit-intake';
  assert.equal(cron.intakeKey({ headers: { 'x-intake-secret': 'unit-intake' } }), true);
  assert.equal(cron.intakeKey({ headers: { 'x-intake-secret': 'wrong-value' } }), false);
  assert.equal(cron.intakeKey({ headers: {} }), false);
  delete process.env.N8N_INTAKE_SECRET;
  assert.equal(cron.intakeKey({ headers: { 'x-intake-secret': '' } }), false, 'no secret set: closed');
});

test('edge_send: bad input is refused; an email for a rep with no Gmail says so', async () => {
  await h.withDb(async (sql) => {
    await assert.rejects(cron.edgeSend(sql, { what: 'nope' }), (e) => e.status === 400 || e.code === 400 || /bad_what/.test(e.message));
    await assert.rejects(cron.edgeSend(sql, { what: 'order', orderId: 'x' }), /bad_id/);
    await assert.rejects(cron.edgeSend(sql, { what: 'email', userId: '00000000-0000-4000-8000-000000000009', to: 'a@unit.invalid' }), /not_found/);
    const rep = await h.user(sql);
    await assert.rejects(cron.edgeSend(sql, { what: 'email', userId: rep.id, to: 'a@unit.invalid', subject: 's', text: 't' }), /gmail_not_connected|staging_no_outward/);
  });
});
