// Final audit 2026-11-02 (Yousef): an n8n batch answer is paired with its request by the fields HubSpot echoes, not by
// position (api/_payload.js recordsIn), and Quo's own address never becomes a contact (api/_hsmap.js contactSkip).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../api/_payload');
const M = require('../../api/_hsmap');

test('line items in a batch answer keep their own products when HubSpot answers out of order', () => {
  const hs = { method: 'POST', url: 'https://api.hubapi.com/crm/v3/objects/line_items/batch/create',
    body: JSON.stringify({ inputs: [
      { properties: { hs_sku: 'SAF100', quantity: '9', price: '135' } },
      { properties: { hs_sku: 'SAV200', quantity: '8', price: '135' } },
      { properties: { hs_sku: 'SAVP300', quantity: '8', price: '135' } }] }),
    response: { results: [
      { id: '17', properties: { hs_sku: 'SAVP300', quantity: '8', price: '135.00' } },
      { id: '16', properties: { hs_sku: 'SAV200', quantity: '8', price: '135' } },
      { id: '18', properties: { hs_sku: 'SAF100', quantity: '9', price: '135' } }] } };
  const sku = Object.fromEntries(P.recordsIn(hs).map((r) => [r.id, r.properties.hs_sku + 'x' + r.properties.quantity]));
  assert.deepEqual(sku, { 16: 'SAV200x8', 17: 'SAVP300x8', 18: 'SAF100x9' });
});

test('an answer that echoes no fields still pairs by position', () => {
  const hs = { body: { inputs: [{ properties: { name: 'a' } }, { properties: { name: 'b' } }] }, response: { results: [{ id: '1' }, { id: '2' }] } };
  assert.deepEqual(P.recordsIn(hs).map((r) => r.properties.name), ['a', 'b']);
});

test('Quo itself is not a customer; a real lead from the inbox still is', () => {
  assert.ok(M.contactSkip({ email: 'quo@quo.com', firstname: 'The', lastname: 'Quo Team', hs_object_source: 'CONVERSATIONS' }));
  assert.equal(M.contactSkip({ email: 'isabella@college.ca', firstname: 'Isabella', hs_object_source: 'CONVERSATIONS' }), null);
});
