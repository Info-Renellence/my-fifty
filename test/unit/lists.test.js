// api/_lists.js: My Fifty speaks the new list names and writes whichever names v2 has, before and after part B.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../api/_lists');

// A stand-in for the database that only answers "which values does this list have".
function fakeDb(values) { return async (strings, type) => (values[type] || []).map((v) => ({ v })); }
const BEFORE = { contacts_role: ['physician', 'nurse_injector', 'clinic_owner', 'manager', 'other', 'dentist'],
  contacts_prp: ['eclipse_prp', 'regenlab', 'arthrex_angel', 'emcyte', 'exprecell', 'other', 'alyssamed', 'cellenis', 'world_prp', 'naturagel', 'none'] };
const AFTER = { contacts_role: ['physician', 'injector', 'dentist', 'manager', 'other'],
  contacts_prp: ['eclipse_prp', 'regenlab', 'arthrex_prf', 'exprecell_prf', 'alyssamed', 'cellenis', 'world_prp', 'naturagel', 'other', 'none'] };

beforeEach(() => L.forgetValues());

describe('reading', () => {
  test('old names read as the new ones; unknown names are kept', () => {
    assert.equal(L.canon('contacts_role', 'nurse_injector'), 'injector');
    assert.equal(L.canon('contacts_role', 'clinic_owner'), 'manager');
    assert.deepEqual(L.canonAll('contacts_prp', ['exprecell', 'arthrex_angel', 'exprecell_prf', 'emcyte']), ['exprecell_prf', 'arthrex_prf', 'emcyte']);
    assert.deepEqual(L.canonAll('contacts_prp', null), []);
  });
});

describe('writing', () => {
  test('before part B: the new names are written under the old ones', async () => {
    const sql = fakeDb(BEFORE);
    assert.equal(await L.toDb(sql, 'contacts_role', 'injector'), 'nurse_injector');
    assert.equal(await L.toDb(sql, 'contacts_role', 'dentist'), 'dentist');
    assert.equal(await L.toDb(sql, 'contacts_role', 'clinic_owner'), 'manager', 'an old name the app no longer offers maps to its new home');
    assert.deepEqual(await L.listToDb(sql, 'contacts_prp', ['exprecell_prf', 'arthrex_prf', 'emcyte', 'junk']), ['exprecell', 'arthrex_angel']);
  });
  test('after part B: the new names are written as they are', async () => {
    const sql = fakeDb(AFTER);
    assert.equal(await L.toDb(sql, 'contacts_role', 'injector'), 'injector');
    assert.equal(await L.toDb(sql, 'contacts_role', 'nurse_injector'), 'injector', 'an old app version still works');
    assert.deepEqual(await L.listToDb(sql, 'contacts_prp', ['exprecell', 'none', 'cellenis']), ['exprecell_prf', 'cellenis']);
    assert.deepEqual(await L.listToDb(sql, 'contacts_prp', ['none']), ['none']);
    assert.equal(await L.toDb(sql, 'contacts_role', 'surgeon'), null);
  });
});
