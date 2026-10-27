// Run 4: odd input to the order write (custom prices, quantities, lines) and to push_subscribe: always a clean 4xx or a saved row, never a 500.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const auth = require('../../api/_auth');

after(() => h.closeDb());
let me = null;
auth.signedIn = async () => me;
const act = require('../../api/act');
const post = async (body) => { const res = h.fakeRes(); await act({ method: 'POST', url: '/api/act', headers: {}, body }, res); return res; };

test('order lines and prices: odd values are a clean answer, never a server error; no junk row is saved', () => h.withDb(async (sql) => {
  delete process.env.N8N_MYFIFTY_URL; delete process.env.PULSE_ISF_KEY; delete process.env.EDGE_ISF_SECRET;
  me = await h.user(sql);
  const c = await h.contact(sql, me);
  await sql`insert into onboardings (primary_contact_id, status, submitted_at) values (${c}, 'signed', now())`;
  const odd = [-1, 0, 0.001, 1e12, 1e308, 'abc', '', null, NaN, Infinity, '1e3', {}, [], true, '$135', 147.555];
  const qtys = [0, -1, 1.5, 1000, 'x', null, '2', 99999999999, {}, []];
  let saved = 0;
  for (const price of odd) {
    const r = await post({ op: 'order', contactId: c, payment: 'card_on_file', lines: [{ sku: 'SAF100', qty: 1, price }] });
    assert.notEqual(r.statusCode, 401); assert.ok(r.statusCode < 500, 'price ' + JSON.stringify(price) + ' answered ' + r.statusCode + ' ' + r.body);
    if (r.statusCode === 200) saved++;
  }
  for (const qty of qtys) {
    const r = await post({ op: 'order', contactId: c, payment: 'card_on_file', lines: [{ sku: 'SAF100', qty }] });
    assert.ok(r.statusCode < 500, 'qty ' + JSON.stringify(qty) + ' answered ' + r.statusCode + ' ' + r.body);
  }
  for (const lines of [null, 'x', [], [null], [{}], [{ sku: {} }], [{ sku: 'NOPE', qty: 1 }], Array(300).fill({ sku: 'SAF100', qty: 1 }), { length: 3 }]) {
    const r = await post({ op: 'order', contactId: c, payment: 'card_on_file', lines });
    assert.ok(r.statusCode < 500, 'lines ' + JSON.stringify(lines).slice(0, 40) + ' answered ' + r.statusCode + ' ' + r.body);
  }
  const bad = await sql`select count(*)::int n from order_lines l join orders o on o.id = l.order_id where o.contact_id = ${c} and (l.unit_price < 0 or l.unit_price > 1000000 or l.quantity <= 0)`;
  assert.equal(bad[0].n, 0, 'no negative, absurd or empty line was saved');
}));

test('push_subscribe: junk subscriptions are refused cleanly; a real-shaped fake one is saved once', () => h.withDb(async (sql) => {
  me = await h.user(sql);
  for (const sub of [null, 'x', {}, { endpoint: 'http://insecure.test/x', keys: { p256dh: 'P', auth: 'A' } }, { endpoint: 'javascript:alert(1)', keys: {} },
    { endpoint: 'https://' + 'a'.repeat(2000), keys: { p256dh: 'P', auth: 'A' } }, { endpoint: 'https://push.test/abcdefghij', keys: { p256dh: 5, auth: [] } }, [], 5]) {
    const r = await post({ op: 'push_subscribe', subscription: sub });
    assert.ok(r.statusCode < 500, 'sub ' + JSON.stringify(sub).slice(0, 40) + ' answered ' + r.statusCode + ' ' + r.body);
  }
  const [{ n }] = await sql`select count(*)::int n from connections where user_id = ${me.id} and provider = 'push'`;
  assert.equal(n, 0, 'nothing junk was saved');
  const ok = await post({ op: 'push_subscribe', subscription: { endpoint: 'https://push.test/abcdefghij', keys: { p256dh: 'P', auth: 'A' } } });
  assert.equal(ok.statusCode, 200, ok.body);
}));
