// The "Onboarded" lead group (Yousef 2026-10-22, item B; shared _book.js, the same in Edge): a lead whose onboarding is
// fully signed (the onboarding agreement completed) and who has no order of any kind yet. It is listed first; any order
// (samples or paid, not cancelled or rejected) takes them out.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const B = require('../../api/_book');
const D = require('../../api/data').OPS;

after(h.closeDb);
const Q = (o) => new URLSearchParams(o || {});
async function signed(sql, c, o = {}) {
  const [a] = await sql`insert into agreements (kind, contact_id, status, sent_at, completed_at) values ('onboarding', ${o.on || c}, ${o.status || 'completed'}, now() - interval '3 days', ${o.status === 'waiting' ? null : sql`now() - interval '2 days'`}) returning id`;
  if (o.viaRow) await sql`insert into onboardings (primary_contact_id, injector_contact_id, agreement_id, status) values (${o.primary || null}, ${c}, ${a.id}, 'signed')`;
  return a.id;
}

describe('the Onboarded group (item B)', () => {
  test('signed and no order: onboarded; waiting, a sample order or a paid order: not; a cancelled order does not count', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const a = await h.contact(sql, me); await signed(sql, a);
    const w = await h.contact(sql, me); await signed(sql, w, { status: 'waiting' });
    const s = await h.contact(sql, me); await signed(sql, s); await h.order(sql, s, me, { status: 'approved', lines: [['SAL400', 1, true]] });
    const x = await h.contact(sql, me); await signed(sql, x); await h.order(sql, x, me, { status: 'cancelled' });
    const inj = await h.contact(sql, me); const other = await h.contact(sql, me); await signed(sql, inj, { on: other, viaRow: true });
    const by = Object.fromEntries((await B.book(sql, me)).people.map((p) => [p.id, p]));
    assert.deepEqual([by[a].leadGroup, by[w].leadGroup, by[s].stage, by[x].leadGroup, by[inj].leadGroup, by[other].leadGroup],
      ['onboarded', 'warm', 'candidate', 'onboarded', 'onboarded', 'onboarded']);
  }));
  test('People lists the group first, titled "Onboarded"; its list and the person label work', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const a = await h.contact(sql, me, { first: 'Ona' }); await signed(sql, a);
    await h.contact(sql, me, { source: 'social' });
    const people = await D.people(sql, me);
    assert.deepEqual([people.leads[0].key, people.leads[0].label, people.leads[0].count], ['onboarded', 'Onboarded', 1]);
    const list = await D.leads(sql, me, Q({ group: 'onboarded' }));
    assert.deepEqual([list.title, list.leads.map((l) => l.id)], ['Onboarded', [a]]);
    assert.equal((await D.person(sql, me, Q({ id: a }))).label, 'LEAD · ONBOARDED');
  }));
});
