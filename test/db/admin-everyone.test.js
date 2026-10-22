// Admins see and act on everyone's customers, as in Edge (Yousef 2026-10-22, E; Edge's F5). Reps are unchanged.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const D = require('../../api/data').OPS;
const A = require('../../api/act').OPS;

after(h.closeDb);
const Q = (o) => new URLSearchParams(o || {});
const ids = (rows) => rows.map((p) => p.id);

describe('admins see everyone (E)', () => {
  test('an admin\'s lists, search, person and order include every rep\'s customers and the unassigned leads; a rep\'s do not', () => h.withDb(async (sql) => {
    const rep = await h.user(sql), other = await h.user(sql), admin = await h.user(sql, { kind: 'admin' });
    const mine = await h.contact(sql, rep, { first: 'Ada', last: 'Everyonecase' });
    const theirs = await h.contact(sql, other, { first: 'Bo', last: 'Everyonecase' });
    const nobody = await h.contact(sql, null, { owner: null, first: 'Cy', last: 'Everyonecase', source: 'social' });
    const o = await h.order(sql, theirs, other, { status: 'approved', approved: true });
    const all = ids((await D.people(sql, admin)).all);
    assert.deepEqual([all.includes(mine), all.includes(theirs), all.includes(nobody)], [true, true, true]);
    const repAll = ids((await D.people(sql, rep)).all);
    assert.deepEqual([repAll.includes(mine), repAll.includes(theirs), repAll.includes(nobody)], [true, false, false]);
    const found = ids((await D.search(sql, admin, Q({ q: 'everyonecase' }))).people);
    assert.equal(found.length, 3);
    assert.deepEqual(ids((await D.search(sql, rep, Q({ q: 'everyonecase' }))).people), [mine]);
    assert.equal((await D.person(sql, admin, Q({ id: theirs }))).id, theirs);
    await assert.rejects(D.person(sql, rep, Q({ id: theirs })), (e) => e.status === 404);
    assert.equal((await D.order(sql, admin, Q({ id: o }))).id, o);
    await assert.rejects(D.order(sql, rep, Q({ id: o })), (e) => e.status === 404);
    const social = ids((await D.leads(sql, admin, Q({ group: 'social' }))).leads);
    assert.ok(social.includes(nobody), 'unassigned lead in the admin\'s Social media leads');
  }));

  test('an admin may act on any customer; an order they place is credited to the customer\'s rep; a rep still may not', () => h.withDb(async (sql) => {
    const rep = await h.user(sql), other = await h.user(sql), admin = await h.user(sql, { kind: 'admin' });
    const theirs = await h.contact(sql, other);
    await sql`insert into onboardings (primary_contact_id, status) values (${theirs}, 'complete')`;
    await A.set_uses(admin, { contactId: theirs, fillers: ['saypha'] });
    await assert.rejects(A.set_uses(rep, { contactId: theirs, fillers: ['saypha'] }), (e) => e.status === 404);
    const r = await A.order(admin, { contactId: theirs, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.ok, true);
    const [row] = await sql`select rep_id, placed_by from orders where contact_id = ${theirs} order by created_at desc limit 1`;
    assert.deepEqual([row.rep_id, row.placed_by], [other.id, admin.id]);
    await assert.rejects(A.order(rep, { contactId: theirs, lines: [{ sku: 'SAF100', qty: 1 }] }), (e) => e.status === 404);
  }));
});
