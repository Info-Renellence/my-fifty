// api/act.js: every write, against v2 (rolled back). Outside services (n8n, Gemini, Google) are faked.
const { test, describe, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');
const act = require('../../api/act');
const A = act.OPS;
const T = require('../../api/_time');
const { open } = require('../../api/_crypto');

after(h.closeDb);
let f;
afterEach(() => { if (f) f.restore(); f = null; delete process.env.N8N_MYFIFTY_URL; delete process.env.GEMINI_API_KEY; });
const st = (status, message) => (e) => e.status === status && e.message === message;
const tomorrow9 = () => T.atLocal(T.addDays(T.ymd(), 1), 9, 0).toISOString();

describe('the route', () => {
  test('only POST', async () => {
    const res = h.fakeRes();
    await act({ method: 'GET', url: '/api/act', headers: {} }, res);
    assert.equal(res.statusCode, 405);
  });
  test('POST without sign-in is refused', async () => {
    const res = h.fakeRes();
    await act({ method: 'POST', url: '/api/act', headers: {}, body: { op: 'log' } }, res);
    assert.equal(res.statusCode, 401);
  });
});

describe('log (L3 Save)', () => {
  test('refuses a bad kind, an empty note, no follow-up, and someone else’s person', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    await assert.rejects(A.log(me, { contactId: c, kind: 'fax', note: 'hi', followUp: 'eod' }), st(400, 'bad_kind'));
    await assert.rejects(A.log(me, { contactId: c, kind: 'call', note: ' ', followUp: 'eod' }), st(400, 'note_required'));
    await assert.rejects(A.log(me, { contactId: c, kind: 'call', note: 'hi', followUp: 'someday' }), st(400, 'pick_a_follow_up'));
    await assert.rejects(A.log(me, { contactId: await h.contact(sql, other), kind: 'call', note: 'hi', followUp: 'eod' }), st(404, 'not_found'));
    await assert.rejects(A.log(me, { contactId: 'nope', kind: 'call', note: 'hi', followUp: 'eod' }), st(400, 'bad_id'));
  }));
  test('a reached call: saved as My Fifty, the Next: line becomes the follow-up, older follow-ups close', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me, { first: 'Nadia', last: 'Unit' });
    const old = await h.task(sql, c, me.id, { title: 'old one' });
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'tomorrow', note: 'Talked lips.\nNext: send pricing' });
    const [i] = await sql`select kind::text, mode::text, outcome, body, source::text, user_id, direction::text, status::text from interactions where id = ${r.interactionId}`;
    assert.deepEqual(i, { kind: 'call', mode: 'phone', outcome: 'connected', body: 'Talked lips.\nNext: send pricing', source: 'my_fifty', user_id: me.id, direction: 'out', status: 'completed' });
    const [t] = await sql`select title, type::text, status::text, due_at, from_interaction_id from tasks where id = ${r.taskId}`;
    assert.deepEqual([t.title, t.type, t.status, t.from_interaction_id, t.due_at.toISOString()], ['send pricing', 'call', 'open', r.interactionId, tomorrow9()]);
    const [o] = await sql`select status::text, completed_at from tasks where id = ${old}`;
    assert.equal(o.status, 'done');
    assert.ok(o.completed_at);
    assert.deepEqual(r.closedTaskIds, [old]);
    assert.equal(r.day.done, 1);
    assert.equal(r.name, 'Nadia Unit');
    assert.equal(r.counted, true);
    assert.equal(r.wasStage, 'lead');
  }));
  test('a visit with no reply is an in-person meeting and a visit follow-up', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.log(me, { contactId: c, kind: 'visit', reached: false, followUp: 'eod', note: 'Nobody in.' });
    const [i] = await sql`select kind::text, mode::text, outcome from interactions where id = ${r.interactionId}`;
    assert.deepEqual(i, { kind: 'meeting', mode: 'in_person', outcome: 'no_answer' });
    const [t] = await sql`select type::text, title from tasks where id = ${r.taskId}`;
    assert.deepEqual(t, { type: 'visit', title: 'Follow up' });
    assert.equal(r.day.done, 1);
  }));
  test('a text is saved but does not count toward the day', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.log(me, { contactId: c, kind: 'text', reached: true, followUp: T.addDays(T.ymd(), 3), note: 'Sent info' });
    assert.equal(r.counted, false);
    assert.equal(r.day.done, 0);
    const [i] = await sql`select mode from interactions where id = ${r.interactionId}`;
    assert.equal(i.mode, null);
  }));
  test('a voice draft is linked to the saved log', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const [ai] = await sql`insert into ai_outputs (kind, contact_id, output, output_data, created_by) values ('voice_note', ${c}, 'x', ${sql.json({ note: 'x' })}, ${me.id}) returning id`;
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'eod', note: 'x note', aiOutputId: ai.id });
    const [row] = await sql`select output_data from ai_outputs where id = ${ai.id}`;
    assert.deepEqual(row.output_data, { note: 'x', saved_as: r.interactionId });
  }));
  test('the next person on Today is offered', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const nextOne = await h.contact(sql, me, { source: 'social', createdAt: h.ago(0, 1), first: 'Next' });
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'eod', note: 'done' });
    assert.equal(r.next.id, nextOne);
  }));
  test('the change log records the log as mine, from My Fifty', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'eod', note: 'x note' });
    const [l] = await sql`select actor_user_id, source::text from change_log where entity_id = ${r.interactionId}`;
    assert.deepEqual([l.actor_user_id, l.source], [me.id, 'my_fifty']);
  }));
});

describe('undo (L4)', () => {
  test('takes the log back, cancels its follow-up and reopens the ones it closed', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const old = await h.task(sql, c, me.id);
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'eod', note: 'oops' });
    const u = await A.undo(me, { interactionId: r.interactionId, closedTaskIds: r.closedTaskIds });
    assert.equal(u.day.done, 0);
    const [i] = await sql`select deleted_at from interactions where id = ${r.interactionId}`;
    const [t] = await sql`select status::text, deleted_at from tasks where id = ${r.taskId}`;
    const [o] = await sql`select status::text, completed_at from tasks where id = ${old}`;
    assert.ok(i.deleted_at);
    assert.equal(t.status, 'cancelled'); assert.ok(t.deleted_at);
    assert.deepEqual(o, { status: 'open', completed_at: null });
  }));
  test('ignores bad task ids in the list', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'eod', note: 'oops' });
    assert.deepEqual(await A.undo(me, { interactionId: r.interactionId, closedTaskIds: ['x', 5] }).then((x) => x.ok), true);
  }));
  test('cannot undo someone else’s, an old one, one from another source, or twice', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    const theirs = await h.touch(sql, c, other.id);
    const oldOne = await h.touch(sql, c, me.id, { days: 2 });
    const quo = await h.touch(sql, c, me.id, { source: 'quo' });
    for (const id of [theirs, oldOne, quo]) await assert.rejects(A.undo(me, { interactionId: id }), st(404, 'not_found'));
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'eod', note: 'x note' });
    await A.undo(me, { interactionId: r.interactionId });
    await assert.rejects(A.undo(me, { interactionId: r.interactionId }), st(404, 'not_found'));
    await assert.rejects(A.undo(me, { interactionId: 'x' }), st(400, 'bad_id'));
  }));
});

describe('snooze, seen_fifty', () => {
  test('Tomorrow moves the follow-up and hides the person until tomorrow; settings stay an object', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { settings: { snoozed: { gone: '2020-01-01' }, other: 1 } }), c = await h.contact(sql, me);
    const t = await h.task(sql, c, me.id);
    await A.snooze(me, { contactId: c, taskId: t });
    const [task] = await sql`select due_at from tasks where id = ${t}`;
    assert.equal(task.due_at.toISOString(), tomorrow9());
    const [u] = await sql`select settings from users where id = ${me.id}`;
    assert.deepEqual(u.settings, { other: 1, snoozed: { [c]: T.addDays(T.ymd(), 1) } }, 'an object, old snoozes dropped');
  }));
  test('snooze without a task only hides them; someone else’s person is refused', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    assert.equal((await A.snooze(me, { contactId: c })).ok, true);
    await assert.rejects(A.snooze(me, { contactId: await h.contact(sql, other) }), st(404, 'not_found'));
  }));
  test('seen_fifty keeps the other settings and stays an object', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { settings: { snoozed: { a: '2030-01-01' } } });
    await A.seen_fifty(me);
    const [u] = await sql`select settings, jsonb_typeof(settings) t from users where id = ${me.id}`;
    assert.equal(u.t, 'object');
    assert.deepEqual(u.settings.snoozed, { a: '2030-01-01' });
    assert.ok(Date.parse(u.settings.fifty_seen_at) > Date.now() - 60000);
  }));
  test('seen_fifty on a user with no settings at all', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await sql`update users set settings = null where id = ${me.id}`;
    await A.seen_fifty(me);
    const [u] = await sql`select jsonb_typeof(settings) t from users where id = ${me.id}`;
    assert.equal(u.t, 'object');
  }));
});

describe('add_person (L13)', () => {
  test('refuses no name, a bad email and a bad phone', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await assert.rejects(A.add_person(me, {}), st(400, 'name_required'));
    await assert.rejects(A.add_person(me, { firstName: 'A', email: 'not-an-email' }), st(400, 'bad_email'));
    await assert.rejects(A.add_person(me, { firstName: 'A', phone: '12' }), st(400, 'bad_phone'));
  }));
  test('saves a cold lead in my book, with the clinic’s address and a standard phone', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const cl = await h.clinic(sql, { name: 'Unit Clinic Reuse' });
    const r = await A.add_person(me, { firstName: ' Ana ', lastName: 'Lee', clinic: 'unit clinic reuse', phone: '647-555-0101', email: 'Ana.Lee@Test.invalid', role: 'nurse_injector', warm: false });
    const [c] = await sql`select owner_id, clinic_id, first_name, email::text, mobile, role::text, source_kind::text, shipping_street, shipping_city from contacts where id = ${r.id}`;
    assert.deepEqual(c, { owner_id: me.id, clinic_id: cl.id, first_name: 'Ana', email: 'ana.lee@test.invalid', mobile: '+16475550101', role: 'nurse_injector', source_kind: 'cold', shipping_street: '1 Test St', shipping_city: 'Testville' });
    const [l] = await sql`select actor_user_id, action from change_log where entity_id = ${r.id} and action = 'create'`;
    assert.equal(l.actor_user_id, me.id, '"Added by you" comes from this');
  }));
  test('a new clinic is made when none matches; warm is the default; an unknown role is dropped', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const name = 'Brand New Clinic ' + h.uid();
    const r = await A.add_person(me, { firstName: 'Bo', clinic: name, role: 'astronaut' });
    const [c] = await sql`select cl.name, c.source_kind::text, c.role from contacts c join clinics cl on cl.id = c.clinic_id where c.id = ${r.id}`;
    assert.deepEqual(c, { name, source_kind: 'warm', role: null });
  }));
  test('no clinic is fine', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const r = await A.add_person(me, { lastName: 'Solo' });
    const [c] = await sql`select clinic_id from contacts where id = ${r.id}`;
    assert.equal(c.clinic_id, null);
  }));
  test('a duplicate email or phone is refused, saying whose it is', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    const mine = await h.contact(sql, me, { email: 'dup.mine@test.invalid' });
    await h.contact(sql, other, { email: 'dup.theirs@test.invalid', phone: '+16475550199' });
    await assert.rejects(A.add_person(me, { firstName: 'X', email: 'DUP.MINE@test.invalid' }), (e) => e.status === 409 && e.message === 'already_yours' && e.detail === mine);
    await assert.rejects(A.add_person(me, { firstName: 'X', email: 'dup.theirs@test.invalid' }), (e) => e.message === 'already_someones' && e.detail === undefined);
    await assert.rejects(A.add_person(me, { firstName: 'X', phone: '(647) 555-0199' }), st(409, 'already_someones'));
  }));
  test('a secondary email also counts as taken', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await sql`update contacts set secondary_email = 'acct@test.invalid' where id = ${c}`;
    await assert.rejects(A.add_person(me, { firstName: 'X', email: 'acct@test.invalid' }), st(409, 'already_yours'));
  }));
});

describe('set_follow_up, set_uses, edit_note, invoice_email', () => {
  test('moves my earliest open follow-up, or makes one', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me), d = await h.contact(sql, me);
    const t = await h.task(sql, c, me.id, { due: h.ago(-1) });
    const later = T.addDays(T.ymd(), 10);
    const r = await A.set_follow_up(me, { contactId: c, date: later });
    assert.equal(r.label, T.short(T.atLocal(later, 9, 0)));
    assert.equal((await sql`select due_at from tasks where id = ${t}`)[0].due_at.toISOString(), T.atLocal(later, 9, 0).toISOString());
    await A.set_follow_up(me, { contactId: d, date: later });
    assert.equal((await sql`select count(*)::int n from tasks where contact_id = ${d} and status = 'open'`)[0].n, 1);
    await assert.rejects(A.set_follow_up(me, { contactId: c, date: '2001-01-01' }), st(400, 'bad_date'));
  }));
  test('set_uses keeps the known names and ignores the rest', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await A.set_uses(me, { contactId: c, fillers: ['saypha', 'botox', 'saypha', 'other'] });
    await A.set_uses(me, { contactId: c, prp: ['emcyte'] });
    const [r] = await sql`select fillers_used::text[] f, prp_used::text[] p from contacts where id = ${c}`;
    assert.deepEqual(r, { f: ['saypha', 'other'], p: ['emcyte'] });
    await A.set_uses(me, { contactId: c, fillers: [] });
    assert.deepEqual((await sql`select fillers_used::text[] f from contacts where id = ${c}`)[0].f, []);
  }));
  test('edit_note changes my own note and its follow-up title; not someone else’s', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.log(me, { contactId: c, kind: 'call', reached: true, followUp: 'eod', note: 'first\nNext: a' });
    await A.edit_note(me, { interactionId: r.interactionId, body: 'better\nNext: call Friday' });
    assert.equal((await sql`select body from interactions where id = ${r.interactionId}`)[0].body, 'better\nNext: call Friday');
    assert.equal((await sql`select title from tasks where id = ${r.taskId}`)[0].title, 'call Friday');
    const theirs = await h.touch(sql, c, other.id);
    await assert.rejects(A.edit_note(me, { interactionId: theirs, body: 'hack' }), st(404, 'not_found'));
    await assert.rejects(A.edit_note(me, { interactionId: r.interactionId, body: '' }), st(400, 'note_required'));
    await assert.rejects(A.edit_note(me, { interactionId: 'x', body: 'hello' }), st(400, 'bad_id'));
  }));
  test('invoice_email saves the secondary email', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    assert.deepEqual(await A.invoice_email(me, { contactId: c, email: ' Accounts@Clinic.test ' }), { ok: true, email: 'accounts@clinic.test' });
    assert.equal((await sql`select secondary_email::text e from contacts where id = ${c}`)[0].e, 'accounts@clinic.test');
    await assert.rejects(A.invoice_email(me, { contactId: c, email: 'nope' }), st(400, 'bad_email'));
  }));
});

describe('order (L10 / L15 Send for approval)', () => {
  async function ready(sql, me, o) { const c = await h.contact(sql, me, o); await sql`insert into onboardings (primary_contact_id, status) values (${c}, 'complete')`; return c; }
  test('someone not onboarded and without orders is refused', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me);
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] }), st(409, 'not_ready_to_order'));
  }));
  test('no products, unknown products, only free products, and samples without an MD are refused', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 0 }] }), st(400, 'no_products'));
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'FAKE', qty: 1 }] }), st(400, 'unknown_product'));
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'HDB100', qty: 1 }] }), st(400, 'nothing_to_charge'));
    await assert.rejects(A.order(me, { contactId: c, kind: 'samples', lines: [{ sku: 'SAL400', qty: 1 }], mdName: 'Dr X' }), st(400, 'md_required'));
    await assert.rejects(A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1000 }] }), st(400, 'no_products'));
  }));
  test('a card order: saved for approval with prices, free extras, notes, and no payment yet', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 2 }, { sku: 'HDB100', qty: 1 }], approvalNote: 'Rush please', shippingNote: 'Back door' });
    assert.equal(r.sentToN8n, false);
    assert.equal(r.reason, 'n8n_not_connected');
    const [o] = await sql`select status::text, rep_id, placed_by, payment_method::text, approval_note, shipping_note, channel::text from orders where id = ${r.orderId}`;
    assert.deepEqual(o, { status: 'submitted', rep_id: me.id, placed_by: me.id, payment_method: 'card_on_file', approval_note: 'Rush please', shipping_note: 'Back door', channel: 'stripe' });
    const lines = await sql`select sku, quantity, unit_price::float8 p, is_free from order_lines where order_id = ${r.orderId} order by sku`;
    assert.deepEqual([...lines], [{ sku: 'HDB100', quantity: 1, p: 0, is_free: true }, { sku: 'SAF100', quantity: 2, p: 225, is_free: false }]);
    assert.equal((await sql`select count(*)::int n from payments where order_id = ${r.orderId}`)[0].n, 0);
  }));
  test('a wire order counts as paid at once', () => h.withDb(async (sql) => {
    // Test run 2026-10-21: the rules say never create a payment row for a wire order, so this checks that none is
    // written and that the order still counts as paid (it used to check for a "succeeded" wire payment row).
    const me = await h.user(sql), c = await ready(sql, me);
    const r = await A.order(me, { contactId: c, payment: 'wire', lines: [{ sku: 'SAF100', qty: 2 }] });
    assert.equal((await sql`select count(*)::int n from payments where order_id = ${r.orderId}`)[0].n, 0);
    const [o] = await sql`select payment_method::text m from orders where id = ${r.orderId}`;
    assert.equal(o.m, 'wire');
    const [x] = (await require('../../api/_book').ordersFor(sql, [c])).filter((y) => y.id === r.orderId);
    assert.equal(x.paid_flag, true);
    assert.equal(x.total, 450);
  }));
  test('samples: every line free, the MD found by email and marked as an MD', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    const md = await h.contact(sql, null, { owner: null, email: 'md.found@test.invalid' });
    const r = await A.order(me, { contactId: c, kind: 'samples', lines: [{ sku: 'SAL400', qty: 2 }], mdName: 'Dr. Found', mdEmail: 'MD.Found@test.invalid' });
    const [o] = await sql`select md_contact_id, payment_method from orders where id = ${r.orderId}`;
    assert.deepEqual(o, { md_contact_id: md, payment_method: null });
    assert.equal((await sql`select is_medical_director from contacts where id = ${md}`)[0].is_medical_director, true);
    assert.ok((await sql`select bool_and(is_free) ok from order_lines where order_id = ${r.orderId}`)[0].ok);
  }));
  test('samples: a new MD is added as a doctor with no owner', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await ready(sql, me);
    const email = 'md.new.' + h.uid() + '@test.invalid';
    const r = await A.order(me, { contactId: c, kind: 'samples', lines: [{ sku: 'SAL400', qty: 1 }], mdName: 'Dr. Lee Unit', mdEmail: email });
    const [md] = await sql`select first_name, last_name, designation, owner_id, is_medical_director, role::text from contacts where id = (select md_contact_id from orders where id = ${r.orderId})`;
    assert.deepEqual(md, { first_name: 'Lee', last_name: 'Unit', designation: 'MD', owner_id: null, is_medical_director: true, role: 'physician' });
  }));
  test('with n8n connected, the order is sent with its id and the key', () => h.withDb(async (sql) => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), c = await h.contact(sql, me);
    await h.order(sql, c, me, { status: 'shipped' });
    const r = await A.order(me, { contactId: c, lines: [{ sku: 'SAF100', qty: 1 }] });
    assert.equal(r.sentToN8n, true);
    assert.deepEqual(JSON.parse(f.calls[0].body), { action: 'order', orderId: r.orderId });
  }));
});

describe('resend_pay_link and remind_md', () => {
  test('resend: not my order is refused; n8n off sends nothing and logs nothing', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql);
    await assert.rejects(A.resend_pay_link(me, { orderId: await h.order(sql, await h.contact(sql, other), other) }), st(404, 'not_found'));
    const o = await h.order(sql, await h.contact(sql, me), me);
    assert.deepEqual(await A.resend_pay_link(me, { orderId: o }), { ok: false, reason: 'n8n_not_connected' });
    assert.equal((await sql`select count(*)::int n from change_log where entity_id = ${o} and action = 'resend'`)[0].n, 0);
  }));
  test('resend with n8n on is logged as a resend', () => h.withDb(async (sql) => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), c = await h.contact(sql, me), o = await h.order(sql, c, me);
    assert.equal((await A.resend_pay_link(me, { orderId: o })).ok, true);
    const [l] = await sql`select actor_user_id, contact_id, note, source::text from change_log where entity_id = ${o} and action = 'resend'`;
    assert.deepEqual(l, { actor_user_id: me.id, contact_id: c, note: 'Pay link resent', source: 'my_fifty' });
  }));
  test('remind the MD on a sample order: sent, stamped, then refused within the hour', () => h.withDb(async (sql) => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), c = await h.contact(sql, me), o = await h.order(sql, c, me, { lines: [['SAL400', 1, true]] });
    const [ag] = await sql`insert into agreements (kind, contact_id, order_id, status) values ('md_pdr', ${c}, ${o}, 'waiting') returning id`;
    assert.equal((await A.remind_md(me, { orderId: o })).ok, true);
    assert.ok((await sql`select last_reminded_at from agreements where id = ${ag.id}`)[0].last_reminded_at);
    assert.deepEqual(JSON.parse(f.calls[0].body), { action: 'remind_md', orderId: o });
    await assert.rejects(A.remind_md(me, { orderId: o }), st(429, 'reminded_recently'));
  }));
  test('remind the MD on onboarding; not someone else’s; bad ids', () => h.withDb(async (sql) => {
    process.env.N8N_MYFIFTY_URL = 'https://n8n.test/hook';
    f = h.fakeFetch(() => ({ json: {} }));
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    const [onb] = await sql`insert into onboardings (primary_contact_id, status) values (${c}, 'submitted') returning id`;
    assert.equal((await A.remind_md(me, { onboardingId: onb.id })).ok, true);
    const [l] = await sql`select note from change_log where entity_id = ${onb.id} and action = 'resend'`;
    assert.equal(l.note, 'MD reminded to sign');
    const [theirs] = await sql`insert into onboardings (primary_contact_id, status) values (${await h.contact(sql, other)}, 'submitted') returning id`;
    await assert.rejects(A.remind_md(me, { onboardingId: theirs.id }), st(404, 'not_found'));
    await assert.rejects(A.remind_md(me, {}), st(400, 'bad_id'));
  }));
});

describe('voice', () => {
  test('turns a recording into a draft and keeps it in ai_outputs as an object', () => h.withDb(async (sql) => {
    process.env.GEMINI_API_KEY = 'k';
    const tomorrow = T.addDays(T.ymd(), 1);
    f = h.fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ note: 'Met Maya.', nextStep: 'Send pricing', followUpDate: tomorrow, transcript: 'met maya' }) }] } }] } }));
    const me = await h.user(sql), c = await h.contact(sql, me);
    const r = await A.voice(me, { contactId: c, audio: 'AAAA', mime: 'audio/webm;codecs=opus' });
    assert.deepEqual([r.note, r.nextStep, r.followUpDate], ['Met Maya.', 'Send pricing', tomorrow]);
    const [ai] = await sql`select kind::text, contact_id, output, jsonb_typeof(output_data) t, created_by from ai_outputs where id = ${r.aiOutputId}`;
    assert.deepEqual(ai, { kind: 'voice_note', contact_id: c, output: 'Met Maya.', t: 'object', created_by: me.id });
  }));
  test('a follow-up date in the past is dropped', () => h.withDb(async (sql) => {
    process.env.GEMINI_API_KEY = 'k';
    f = h.fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ note: 'n', nextStep: '', followUpDate: '2020-01-01', transcript: '' }) }] } }] } }));
    const me = await h.user(sql), c = await h.contact(sql, me);
    assert.equal((await A.voice(me, { contactId: c, audio: 'AAAA', mime: 'audio/mp4' })).followUpDate, '');
  }));
  test('refuses no audio, the wrong type, too long, no key, and someone else’s person', () => h.withDb(async (sql) => {
    const me = await h.user(sql), other = await h.user(sql), c = await h.contact(sql, me);
    await assert.rejects(A.voice(me, { contactId: c, audio: 'AAAA', mime: 'audio/webm' }), st(503, 'voice_not_set_up'));
    process.env.GEMINI_API_KEY = 'k';
    await assert.rejects(A.voice(me, { contactId: c, audio: '', mime: 'audio/webm' }), st(400, 'no_audio'));
    await assert.rejects(A.voice(me, { contactId: c, audio: '%%%', mime: 'audio/webm' }), st(400, 'no_audio'));
    await assert.rejects(A.voice(me, { contactId: c, audio: 'AAAA', mime: 'video/mp4' }), st(400, 'bad_audio_type'));
    await assert.rejects(A.voice(me, { contactId: c, audio: 'A'.repeat(3600001), mime: 'audio/webm' }), st(413, 'recording_too_long'));
    await assert.rejects(A.voice(me, { contactId: await h.contact(sql, other), audio: 'AAAA', mime: 'audio/webm' }), st(404, 'not_found'));
  }));
  test('the voice prompt is built from v2 (context)', () => h.withDb(async (sql) => {
    const me = await h.user(sql), cl = await h.clinic(sql, { name: 'Ctx Clinic' });
    const c = await h.contact(sql, me, { clinicId: cl.id, role: 'physician' });
    await h.contact(sql, me, { clinicId: cl.id, first: 'Colleague' });
    await h.touch(sql, c, me.id, { body: 'Earlier chat' });
    await h.order(sql, c, me, { status: 'shipped' });
    const x = await require('../../api/_voice').context(sql, me, c);
    assert.equal(x.c.clinic, 'Ctx Clinic');
    assert.equal(x.others[0].first_name, 'Colleague');
    assert.equal(x.recent[0].body, 'Earlier chat');
    assert.ok(x.lines.length && x.products.length > 30);
  }));
});

describe('email, push_subscribe, gmail_connect', () => {
  test('email: needs Gmail connected, the person’s own address, a subject and a message', () => h.withDb(async (sql) => {
    const me = await h.user(sql), c = await h.contact(sql, me, { email: 'p.mail@test.invalid' });
    await assert.rejects(A.email(me, { contactId: c, subject: 's', text: 't' }), st(409, 'gmail_not_connected'));
    await assert.rejects(A.email(me, { contactId: c, to: 'stranger@x.com', subject: 's', text: 't' }), st(400, 'bad_recipient'));
    await assert.rejects(A.email(me, { contactId: c, subject: '', text: 't' }), st(400, 'subject_and_message_required'));
  }));
  test('email: sent from Gmail and saved on their history', () => h.withDb(async (sql) => {
    const me = await h.user(sql, { name: 'Pat Rep' }), c = await h.contact(sql, me, { email: 'p.mail2@test.invalid' });
    await A.gmail_connect(me, { refreshToken: 'rt-1' });
    f = h.fakeFetch((url) => (/oauth2/.test(url) ? { json: { access_token: 'at' } } : { json: { id: 'm1', threadId: 'th1' } }));
    assert.deepEqual(await A.email(me, { contactId: c, subject: 'Pricing', text: 'Hello' }), { ok: true });
    const raw = Buffer.from(JSON.parse(f.calls[1].body).raw, 'base64').toString();
    assert.match(raw, /To: p\.mail2@test\.invalid/);
    assert.match(raw, /From: Pat Rep </);
    const [i] = await sql`select kind::text, subject, thread_id, source::text, addresses from interactions where contact_id = ${c}`;
    assert.deepEqual(i, { kind: 'email', subject: 'Pricing', thread_id: 'th1', source: 'my_fifty', addresses: { from: me.email, to: 'p.mail2@test.invalid' } });
  }));
  test('push_subscribe stores the phone encrypted; a bad one is refused', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    const sub = { endpoint: 'https://push.test/abc123456789', keys: { p256dh: 'P', auth: 'A' } };
    await A.push_subscribe(me, { subscription: sub });
    const [r] = await sql`select credentials, status::text from user_connections where user_id = ${me.id} and kind = 'push'`;
    assert.deepEqual(JSON.parse(open(r.credentials)), sub);
    assert.equal(r.status, 'connected');
    await assert.rejects(A.push_subscribe(me, { subscription: { endpoint: 'nope' } }), st(400, 'bad_subscription'));
  }));
  test('gmail_connect keeps the newest token encrypted and switches the old one off', () => h.withDb(async (sql) => {
    const me = await h.user(sql);
    await A.gmail_connect(me, { refreshToken: 'old' });
    await A.gmail_connect(me, { refreshToken: 'new' });
    const rows = await sql`select credentials, status::text from user_connections where user_id = ${me.id} and kind = 'gmail' order by created_at`;
    assert.deepEqual(rows.map((r) => [open(r.credentials), r.status]), [['old', 'off'], ['new', 'connected']]);
    await assert.rejects(A.gmail_connect(me, { refreshToken: '' }), st(400, 'no_token'));
  }));
});
