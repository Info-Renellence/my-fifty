// Receipts from the expense bot (api/_expenseintake.js, 2026-11-02): amount, date and Drive id parsing, and the rep match.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const X = require('../../api/_expenseintake')._;

test('amounts: positive numbers only, cents kept', () => {
  assert.equal(X.amountOf('38.35'), 38.35);
  assert.equal(X.amountOf('$1,465.02'), 1465.02);
  assert.equal(X.amountOf(84), 84);
  assert.equal(X.amountOf(''), null);
  assert.equal(X.amountOf('0'), null);
});

test('dates: real days only (a misread "2026-00-00" is empty)', () => {
  assert.equal(X.dateOf('2026-11-02'), '2026-11-02');
  assert.equal(X.dateOf('2026-00-00'), null);
  assert.equal(X.dateOf('2026-02-30'), null);
  assert.equal(X.dateOf(''), null);
});

test('the Drive file id from a receipt link', () => {
  assert.equal(X.fileIdOf('https://drive.google.com/file/d/1sadCI4DG4yWw0k1o3kA-uOwVolGIvfUG/view'), '1sadCI4DG4yWw0k1o3kA-uOwVolGIvfUG');
  assert.equal(X.fileIdOf('not a link'), '');
});

test('rep names: full name, the sheet aliases, a first name only one user has; anyone else is nobody', async () => {
  const USERS = [{ id: '1', email: 'brittany.houston@renellence.com', full_name: 'Brittany Houston' }, { id: '2', email: 'emily@renellence.com', full_name: 'Emily Grace' },
    { id: '3', email: 'caterina.paggos@renellence.com', full_name: 'Caterina Paggos' }, { id: '4', email: 'lucas.stockley@renellence.com', full_name: 'Lucas Stockley' }];
  const sql = async () => USERS;
  const who = async (n) => ((await X.userFor(sql, n)) || {}).email || null;
  assert.equal(await who('Brittany Houston'), 'brittany.houston@renellence.com');
  assert.equal(await who('Emily Weber'), 'emily@renellence.com');
  assert.equal(await who('Caterina'), 'caterina.paggos@renellence.com');
  assert.equal(await who('Lucas'), 'lucas.stockley@renellence.com');
  assert.equal(await who('Lucas Smith'), null);
  assert.equal(await who('Riaan van Rooyen'), null);
  assert.equal(await who(''), null);
});
