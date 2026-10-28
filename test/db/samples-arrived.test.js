// Samples marked delivered (or shipped) with no date count from the day they were placed (owner check 2026-10-28: Carolyn
// Agnew read "Samples on the way" though her samples were delivered). TEST database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');

after(() => h.closeDb());

test('delivered with no date: arrived on the day placed; a dated delivery still wins; submitted is still on the way', async () => {
  await h.withDb(async (sql) => {
    const me = await h.user(sql);
    const undated = await h.contact(sql, me), dated = await h.contact(sql, me), waiting = await h.contact(sql, me);
    await h.order(sql, undated, me, { status: 'delivered', days: 36, lines: [['SAF100', 2, true]] });
    await h.order(sql, dated, me, { status: 'delivered', days: 20, delivered: 9, lines: [['SAF100', 2, true]] });
    await h.order(sql, waiting, me, { status: 'submitted', days: 3, lines: [['SAF100', 2, true]] });
    const { people } = await B.book(sql, me);
    const by = (id) => people.find((p) => p.id === id);
    assert.deepEqual([by(undated).stage, by(undated).sampleDays], ['candidate', 36]);
    assert.equal(by(dated).sampleDays, 9);
    assert.equal(by(waiting).sampleDays, null);
  });
});
