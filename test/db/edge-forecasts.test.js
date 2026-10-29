// Live Edge's forecasts -> v2 (owner 2026-10-29, api/_edgefc.js). TEST database, rolled back.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const I = require('../../api/intake');
const F = require('../../api/_edgefc');

after(() => h.closeDb());
const n = Date.now() % 1e8;
const hsId = (k) => String(710000000 + n * 10 + k);
const row = (o) => Object.assign({ id: hsId(1), rowId: 'r' + n + 'a', name: 'Pat Unit', company: 'Unit Clinic', fillers: 10, price: 150, needles: 0, needlePrice: null,
  cannulas: 0, cannulaPrice: null, date: '2026-12-10' }, o);
const send = (sql, rep, mode, prev, rows) => I.edgeForecasts(sql, { wf: 'Edge', kind: 'forecasts', mode, rep, by: rep, prev, rows, at: Date.now() + Math.random() });
const live = (sql, id) => sql`select due_date::text as d, syringes, deleted_at from forecasts where id = ${id}`.then((r) => r[0]);

async function setup(sql) {
  const rep = await h.user(sql, { email: 'fc.' + n + '@test.invalid' });
  const c = await h.contact(sql, rep);
  await sql`update contacts set legacy_id = ${hsId(1)} where id = ${c}`;
  return { rep, c };
}

test('a new forecast in live Edge shows in v2 with the migration\'s id; an edit updates it; removing it deletes it', async () => {
  await h.withDb(async (sql) => {
    const { rep, c } = await setup(sql);
    const a = row();
    let r = await send(sql, rep.email, 'save', [], [a]);
    assert.equal(r.written, 1, JSON.stringify(r));
    const id = F.idFor(rep.email, a);
    const [f] = await sql`select contact_id, rep_id, syringes, syringe_price::float8 as p from forecasts where id = ${id}`;
    assert.deepEqual([f.contact_id, f.rep_id, f.syringes, f.p], [c, rep.id, 10, 150]);
    const b = row({ fillers: 20, date: '2027-01-05' });
    r = await send(sql, rep.email, 'save', [a], [b]);
    assert.equal(r.written, 1);
    assert.deepEqual([(await live(sql, id)).d, (await live(sql, id)).syringes], ['2027-01-05', 20]);
    r = await send(sql, rep.email, 'save', [b], []);
    assert.equal(r.deleted, 1);
    assert.ok((await live(sql, id)).deleted_at);
  });
});

test('a save leaves rows it did not change alone, so an edit made in Pulse stays', async () => {
  await h.withDb(async (sql) => {
    const { rep } = await setup(sql);
    const a = row(), other = row({ rowId: 'r' + n + 'b', date: '2026-12-20' });
    await send(sql, rep.email, 'save', [], [a]);
    await sql`update forecasts set syringes = 99 where id = ${F.idFor(rep.email, a)}`;   // edited in Pulse
    const r = await send(sql, rep.email, 'save', [a], [a, other]);
    assert.equal(r.unchanged, 1);
    assert.equal((await live(sql, F.idFor(rep.email, a))).syringes, 99);
    assert.equal((await live(sql, F.idFor(rep.email, other))).syringes, 10);
  });
});

test('catch-up adds what v2 lacks, updates or deletes only rows untouched since Oct 22, never an empty list', async () => {
  await h.withDb(async (sql) => {
    const { rep, c } = await setup(sql);
    const kept = row({ rowId: 'r' + n + 'k' }), gone = row({ rowId: 'r' + n + 'g' }), edited = row({ rowId: 'r' + n + 'e' }), fresh = row({ rowId: 'r' + n + 'f' });
    for (const x of [kept, gone, edited]) {
      await sql`insert into forecasts (id, contact_id, rep_id, due_date, syringes, syringe_price, created_at, updated_at)
        values (${F.idFor(rep.email, x)}, ${c}, ${rep.id}, '2026-11-01', 5, 150, ${F.MIGRATED_AT}, ${F.MIGRATED_AT})`;
    }
    // touch_updated_at would stamp now(); put the Oct 22 time back on the untouched ones, as v2 holds them
    await sql`update forecasts set syringes = 7 where id = ${F.idFor(rep.email, edited)}`;
    await sql`alter table forecasts disable trigger touch_updated_at`;
    await sql`update forecasts set updated_at = ${F.MIGRATED_AT} where id = any(${[F.idFor(rep.email, kept), F.idFor(rep.email, gone)]}::uuid[])`;
    await sql`alter table forecasts enable trigger touch_updated_at`;
    assert.equal((await send(sql, rep.email, 'catchup', [], [])).deleted, 0);   // empty list: nothing cleared
    const r = await send(sql, rep.email, 'catchup', [], [kept, edited, fresh]);
    assert.deepEqual([r.written, r.deleted], [2, 1], JSON.stringify(r));     // kept brought up to date + fresh added; gone deleted
    assert.equal((await live(sql, F.idFor(rep.email, kept))).syringes, 10);
    assert.equal((await live(sql, F.idFor(rep.email, edited))).syringes, 7);   // edited in v2: left alone
    assert.ok((await live(sql, F.idFor(rep.email, gone))).deleted_at);
    assert.equal((await live(sql, F.idFor(rep.email, fresh))).syringes, 10);
  });
});

test('the migration\'s skip rules: test rows, no quantity, unknown contact, admin@; the same copy twice is a duplicate', async () => {
  await h.withDb(async (sql) => {
    const { rep } = await setup(sql);
    const r = await send(sql, rep.email, 'save', [], [row({ rowId: 'x1', name: 'Test Person' }), row({ rowId: 'x2', fillers: 0 }), row({ rowId: 'x3', id: '1' })]);
    assert.deepEqual([r.written, r.left], [0, 3]);
    assert.equal((await send(sql, 'admin@renellence.com', 'save', [], [row()])).skipped, true);
    const b = { wf: 'Edge', kind: 'forecasts', mode: 'save', rep: rep.email, prev: [], rows: [row()], at: 1 };
    await I.edgeForecasts(sql, b);
    assert.equal((await I.edgeForecasts(sql, b)).duplicate, true);
  });
});

test('the id matches the Oct 22 migration\'s (ops/migration/build.js uid)', () => {
  const crypto = require('crypto');
  const key = 'forecast:territory:emily@renellence.com:r123';
  const h2 = crypto.createHash('md5').update('renellence-migration-2026-10-22:' + key).digest('hex');
  const want = `${h2.slice(0, 8)}-${h2.slice(8, 12)}-4${h2.slice(13, 16)}-${((parseInt(h2[16], 16) & 3) | 8).toString(16)}${h2.slice(17, 20)}-${h2.slice(20, 32)}`;
  assert.equal(F.idFor('emily@renellence.com', { rowId: 'r123' }), want);
});
