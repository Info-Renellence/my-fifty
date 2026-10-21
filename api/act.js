// Everything My Fifty writes (POST /api/act, body { op, ... }). Every write runs as the signed-in person inside
// asUser(), so the change_log trigger records who did it, from My Fifty.
//
//   log              L3 Save: a call / visit / text, reached or not, the note, and the next follow-up
//   undo             L4 Undo: takes that log back
//   snooze           L2 "Tomorrow": move the follow-up (or hide the person) until tomorrow
//   seen_fifty       L5 has been shown
//   add_person       L13 Save person
//   set_follow_up    L7/L8 Next follow-up
//   set_uses         L7/L8 Filler / PRP they use
//   edit_note        L14 Edit (your own entries)
//   invoice_email    L10 "+ Add an invoice email" (contacts.secondary_email)
//   order            L10 / L15 Send for approval
//   resend_pay_link  L19
//   remind_md        L20 / L21
//   voice            L3 mic: the recording -> a draft note (nothing saved on the person yet)
//   email            L7 Email: sends from the rep's Gmail
//   push_subscribe   turn on phone notifications
//   gmail_connect    after sign-in: keep the Gmail token
const { db, asUser } = require('./_db');
const { signedIn } = require('./_auth');
const { send, body, route, fail, isUuid, clean, own } = require('./_http');
const B = require('./_book');
const T = require('./_time');

module.exports = route(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'post_only');
  const me = await signedIn(req);
  const b = await body(req);
  const fn = own(OPS, b.op);
  if (!fn) throw fail(400, 'unknown_op');
  send(res, 200, await fn(me, b));
});

// The contact, if it is in this person's book.
async function mine(sql, me, id) {
  if (!isUuid(id)) throw fail(400, 'bad_id');
  const [c] = await sql`select id, first_name, last_name, designation, email, secondary_email, phone, mobile, clinic_id from contacts where id = ${id} and owner_id = ${me.id} and deleted_at is null`;
  if (!c) throw fail(404, 'not_found');
  return c;
}

const realDay = (s) => { const t = Date.parse(s + 'T12:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };

// The follow-up moment for EOD / Tomorrow / a picked date (5 PM Toronto, the end of the working day).
function followUpAt(choice) {
  const today = T.ymd();
  if (choice === 'eod') return T.atLocal(today, 17, 0);
  if (choice === 'tomorrow') return T.atLocal(T.addDays(today, 1), 9, 0);
  // A real calendar day only ('2026-02-30' or '2026-13-45' would otherwise reach the database as an invalid time).
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(choice || '')) && choice >= today && realDay(choice)) return T.atLocal(choice, 9, 0);
  return null;
}

// "What happened and the next step" is one box; a line starting "Next:" is the next step.
function splitNote(text) {
  const t = clean(text, 4000);
  const m = t.match(/^([\s\S]*?)(?:^|\n)[ \t]*next(?: step)?[ \t]*:\s*([\s\S]+)$/i);
  return m ? { note: m[1].trim(), next: m[2].trim().slice(0, 300) } : { note: t, next: '' };
}

const OPS = {
  async log(me, b) {
    const kind = { call: 'call', visit: 'meeting', text: 'text' }[b.kind];
    if (!kind) throw fail(400, 'bad_kind');
    const text = clean(b.note, 4000);
    if (text.length < 2) throw fail(400, 'note_required');
    const due = followUpAt(b.followUp);
    if (!due) throw fail(400, 'pick_a_follow_up');
    const { note, next } = splitNote(text);
    const sql = db();
    const c = await mine(sql, me, b.contactId);
    const before = await B.book(sql, me, { contactId: c.id });
    const out = await asUser(me.id, async (tx) => {
      const [i] = await tx`
        insert into interactions (kind, contact_id, user_id, occurred_at, direction, mode, status, outcome, body, source, created_by)
        values (${kind}, ${c.id}, ${me.id}, now(), 'out', ${kind === 'meeting' ? 'in_person' : kind === 'call' ? 'phone' : null}, 'completed',
                ${b.reached ? 'connected' : 'no_answer'}, ${text}, 'my_fifty', ${me.id})
        returning id`;
      // The follow-up this log did, and any other open one for the person, are replaced by the new one.
      const closed = await tx`
        update tasks set status = 'done', completed_at = now()
         where contact_id = ${c.id} and assignee_id = ${me.id} and status = 'open' and deleted_at is null returning id`;
      const [t] = await tx`
        insert into tasks (contact_id, assignee_id, created_by, title, type, due_at, status, source, from_interaction_id)
        values (${c.id}, ${me.id}, ${me.id}, ${next || 'Follow up'}, ${kind === 'meeting' ? 'visit' : 'call'}, ${due}, 'open', 'manual', ${i.id})
        returning id`;
      if (isUuid(b.aiOutputId)) await tx`update ai_outputs set output_data = coalesce(output_data, '{}'::jsonb) || ${tx.json({ saved_as: i.id })} where id = ${b.aiOutputId} and created_by = ${me.id}`;
      return { interactionId: i.id, taskId: t.id, closedTaskIds: closed.map((r) => r.id) };
    });
    const cfg = await B.settings(sql);
    const [{ people }, day] = await Promise.all([B.book(sql, me, { cfg }), B.dayStats(sql, me, cfg)]);
    const list = B.todayList(people, me, cfg);
    return Object.assign(out, { day, name: B.fullName(c), followUp: T.short(due),
      counted: kind !== 'text', next: list[0] ? { id: list[0].id, name: list[0].name } : null, wasStage: before.people[0] && before.people[0].stage });
  },

  async undo(me, b) {
    if (!isUuid(b.interactionId)) throw fail(400, 'bad_id');
    const sql = db();
    await asUser(me.id, async (tx) => {
      const [i] = await tx`update interactions set deleted_at = now() where id = ${b.interactionId} and user_id = ${me.id} and source = 'my_fifty' and deleted_at is null and occurred_at > now() - interval '1 day' returning id`;
      if (!i) throw fail(404, 'not_found');
      await tx`update tasks set status = 'cancelled', deleted_at = now() where from_interaction_id = ${i.id} and assignee_id = ${me.id}`;
      const ids = (Array.isArray(b.closedTaskIds) ? b.closedTaskIds : []).filter(isUuid);
      if (ids.length) await tx`update tasks set status = 'open', completed_at = null where id = any(${ids}) and assignee_id = ${me.id}`;
    });
    const cfg = await B.settings(sql);
    return { ok: true, day: await B.dayStats(sql, me, cfg) };
  },

  async snooze(me, b) {
    const sql = db();
    const c = await mine(sql, me, b.contactId);
    const tomorrow = T.addDays(T.ymd(), 1);
    await asUser(me.id, async (tx) => {
      if (isUuid(b.taskId)) await tx`update tasks set due_at = ${T.atLocal(tomorrow, 9, 0)} where id = ${b.taskId} and assignee_id = ${me.id} and status = 'open'`;
      // Hidden from Today until tomorrow (SOP: dismissals of derived to-dos live in users.settings).
      // Settings saved as anything but an object (seen in v2) are started again as an object.
      // Read what is saved now (locked), not what was there at sign-in, so two quick saves never undo each other.
      const [now] = await tx`select settings from users where id = ${me.id} for update`;
      const snoozed = Object.assign({}, (objectOrEmpty(now && now.settings).snoozed) || {});
      for (const k of Object.keys(snoozed)) if (snoozed[k] <= T.ymd()) delete snoozed[k];
      snoozed[c.id] = tomorrow;
      await tx`update users set settings = (case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end) || ${tx.json({ snoozed })} where id = ${me.id}`;
    });
    return { ok: true };
  },

  async seen_fifty(me) {
    await asUser(me.id, (tx) => tx`update users set settings = (case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end) || ${tx.json({ fifty_seen_at: new Date().toISOString() })} where id = ${me.id}`);
    return { ok: true };
  },

  async add_person(me, b) {
    const first = clean(b.firstName, 80), last = clean(b.lastName, 80);
    if (!first && !last) throw fail(400, 'name_required');
    const role = ['physician', 'nurse_injector', 'clinic_owner', 'manager', 'other'].includes(b.role) ? b.role : null;
    const warm = b.warm !== false;
    const email = clean(b.email, 200).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw fail(400, 'bad_email');
    const phone = normalPhone(b.phone);
    if (b.phone && !phone) throw fail(400, 'bad_phone');
    const clinicName = clean(b.clinic, 160);
    const sql = db();
    if (email) {
      const [dupe] = await sql`select id, owner_id from contacts where (lower(email::text) = ${email} or lower(secondary_email::text) = ${email}) and deleted_at is null`;
      if (dupe) throw fail(409, dupe.owner_id === me.id ? 'already_yours' : 'already_someones', dupe.owner_id === me.id ? dupe.id : undefined);
    }
    if (phone) {
      const [dupe] = await sql`select id, owner_id from contacts where (phone = ${phone} or mobile = ${phone}) and deleted_at is null`;
      if (dupe) throw fail(409, dupe.owner_id === me.id ? 'already_yours' : 'already_someones', dupe.owner_id === me.id ? dupe.id : undefined);
    }
    const id = await asUser(me.id, async (tx) => {
      let clinic = null;
      if (clinicName) {
        [clinic] = await tx`select id, street, city, province, postal_code from clinics where lower(name) = ${clinicName.toLowerCase()} and deleted_at is null limit 1`;
        if (!clinic) [clinic] = await tx`insert into clinics (name) values (${clinicName}) returning id, street, city, province, postal_code`;
      }
      // A new person's shipping address starts as their clinic's location (SOP section 4).
      const [c] = await tx`
        insert into contacts (clinic_id, owner_id, first_name, last_name, email, role, mobile, source_kind,
                              shipping_street, shipping_city, shipping_province, shipping_postal_code)
        values (${clinic ? clinic.id : null}, ${me.id}, ${first || null}, ${last || null}, ${email || null}, ${role}, ${phone || null},
                ${warm ? 'warm' : 'cold'}, ${clinic ? clinic.street : null}, ${clinic ? clinic.city : null}, ${clinic ? clinic.province : null}, ${clinic ? clinic.postal_code : null})
        returning id`;
      return c.id;
    }).catch(async (e) => {
      // Someone else saved the same email first (two reps at once), or a removed person still holds it: a clear answer, not an error.
      if (e && e.code === '23505' && /email/.test(e.constraint_name || e.message || '')) {
        const [d] = await sql`select id, owner_id, deleted_at from contacts where lower(email::text) = ${email} limit 1`;
        const yours = d && d.owner_id === me.id && !d.deleted_at;
        throw fail(409, yours ? 'already_yours' : 'already_someones', yours ? d.id : undefined);
      }
      throw e;
    });
    return { ok: true, id };
  },

  async set_follow_up(me, b) {
    const sql = db();
    const c = await mine(sql, me, b.contactId);
    const due = followUpAt(b.date);
    if (!due) throw fail(400, 'bad_date');
    await asUser(me.id, async (tx) => {
      const [t] = await tx`select id from tasks where contact_id = ${c.id} and assignee_id = ${me.id} and status = 'open' and deleted_at is null order by due_at nulls last limit 1`;
      if (t) await tx`update tasks set due_at = ${due} where id = ${t.id}`;
      else await tx`insert into tasks (contact_id, assignee_id, created_by, title, type, due_at, status, source) values (${c.id}, ${me.id}, ${me.id}, 'Follow up', 'call', ${due}, 'open', 'manual')`;
    });
    return { ok: true, label: T.short(due) };
  },

  async set_uses(me, b) {
    const FILLERS = ['saypha', 'juvederm', 'restylane', 'teoxane_rha', 'belotero', 'revanesse', 'stylage', 'other'];
    const PRPS = ['eclipse_prp', 'regenlab', 'arthrex_angel', 'emcyte', 'exprecell', 'other'];
    const sql = db();
    const c = await mine(sql, me, b.contactId);
    const pick = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter((x) => allowed.includes(x)))] : null);
    const fillers = pick(b.fillers, FILLERS), prp = pick(b.prp, PRPS);
    await asUser(me.id, async (tx) => {
      if (fillers) await tx`update contacts set fillers_used = ${fillers}::contacts_filler[] where id = ${c.id}`;
      if (prp) await tx`update contacts set prp_used = ${prp}::contacts_prp[] where id = ${c.id}`;
    });
    return { ok: true };
  },

  async edit_note(me, b) {
    if (!isUuid(b.interactionId)) throw fail(400, 'bad_id');
    const text = clean(b.body, 4000);
    if (text.length < 2) throw fail(400, 'note_required');
    const { note, next } = splitNote(text);
    await asUser(me.id, async (tx) => {
      const [i] = await tx`update interactions set body = ${text} where id = ${b.interactionId} and user_id = ${me.id} and kind <> 'email' and deleted_at is null returning id`;
      if (!i) throw fail(404, 'not_found');
      if (next) await tx`update tasks set title = ${next} where from_interaction_id = ${i.id} and assignee_id = ${me.id} and status = 'open'`;
      void note;
    });
    return { ok: true };
  },

  async invoice_email(me, b) {
    const email = clean(b.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw fail(400, 'bad_email');
    const sql = db();
    const c = await mine(sql, me, b.contactId);
    await asUser(me.id, (tx) => tx`update contacts set secondary_email = ${email} where id = ${c.id}`);
    return { ok: true, email };
  },

  async order(me, b) {
    const samples = b.kind === 'samples';
    const sql = db();
    const c = await mine(sql, me, b.contactId);
    // Only people who are ready to order (L9): onboarded, or who already have an order.
    const [ready] = await sql`
      select (exists (select 1 from onboardings where status in ('signed', 'complete') and (primary_contact_id = ${c.id} or injector_contact_id = ${c.id}))
           or exists (select 1 from orders where contact_id = ${c.id} and deleted_at is null and status not in ('rejected', 'cancelled'))) as ok`;
    if (!ready.ok) throw fail(409, 'not_ready_to_order');
    const asked = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ sku: clean(l && l.sku, 40), qty: Math.round(Number(l && l.qty) || 0) })).filter((l) => l.sku && l.qty > 0);
    const want = asked.filter((l) => l.qty <= 999);
    if (!want.length) throw fail(400, 'no_products');
    // More than 999 of one product is refused, never silently left off the order.
    if (want.length < asked.length) throw fail(400, 'too_many');
    const prods = await sql`select id, sku, name, list_price::float8 as price from products where active and sku = any(${want.map((l) => l.sku)})`;
    const by = Object.fromEntries(prods.map((p) => [p.sku, p]));
    if (want.some((l) => !by[l.sku])) throw fail(400, 'unknown_product');
    const method = samples ? null : b.payment === 'wire' ? 'wire' : 'card_on_file';
    let md = null;
    if (samples) {
      const mdName = clean(b.mdName, 120), mdEmail = clean(b.mdEmail, 200).toLowerCase();
      if (!mdName || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mdEmail)) throw fail(400, 'md_required');
      md = { name: mdName, email: mdEmail };
    }
    const lines = want.map((l) => {
      const p = by[l.sku];
      const free = samples || !(p.price > 0);
      return { product_id: p.id, sku: p.sku, name: p.name, quantity: l.qty, unit_price: free ? 0 : p.price, list_price: p.price, is_free: free };
    });
    const total = lines.reduce((a, l) => a + l.quantity * l.unit_price, 0);
    if (!samples && !(total > 0)) throw fail(400, 'nothing_to_charge');
    const orderId = await asUser(me.id, async (tx) => {
      let mdId = null;
      if (md) {
        // The medical director is a contact (SOP section 4), found by email or added.
        const [found] = await tx`select id from contacts where (lower(email::text) = ${md.email} or lower(secondary_email::text) = ${md.email})
          order by (deleted_at is null) desc limit 1`;   // a removed person still holds their email (it is unique), so they are found too
        if (found) { mdId = found.id; await tx`update contacts set is_medical_director = true where id = ${mdId} and is_medical_director is not true`; }
        else {
          const parts = md.name.replace(/^dr\.?\s+/i, '').split(/\s+/);
          [{ id: mdId }] = await tx`insert into contacts (clinic_id, first_name, last_name, email, is_medical_director, role, designation)
            values (${c.clinic_id}, ${parts[0]}, ${parts.slice(1).join(' ') || null}, ${md.email}, true, 'physician', ${/^dr\.?\s/i.test(md.name) ? 'MD' : null}) returning id`;
        }
      }
      const [o] = await tx`
        insert into orders (contact_id, rep_id, placed_by, channel, status, submitted_at, md_contact_id, payment_method, approval_note, shipping_note)
        values (${c.id}, ${me.id}, ${me.id}, 'stripe', 'submitted', now(), ${mdId}, ${method}, ${clean(b.approvalNote, 1000) || null}, ${clean(b.shippingNote, 1000) || null})
        returning id`;
      for (const l of lines) {
        await tx`insert into order_lines (order_id, product_id, sku, name, quantity, unit_price, list_price, is_free)
                 values (${o.id}, ${l.product_id}, ${l.sku}, ${l.name}, ${l.quantity}, ${l.unit_price}, ${l.list_price}, ${l.is_free})`;
      }
      // A wire order counts as paid as soon as it is placed (orders.payment_method = 'wire', read by api/_book.js).
      // Never a payment row for it (test-run rules, section 1): no money has been received when it is placed.
      return o.id;
    });
    const sent = await require('./_n8n').call('order', { orderId });
    return { ok: true, orderId, sentToN8n: sent.queued, reason: sent.reason };
  },

  async resend_pay_link(me, b) {
    const o = await myOrder(me, b.orderId);
    const sent = await require('./_n8n').call('resend_pay_link', { orderId: o.id });
    if (sent.queued) await logResend(me, 'orders', o.id, o.contact_id, 'Pay link resent');
    return { ok: sent.queued, reason: sent.reason };
  },

  async remind_md(me, b) {
    const sql = db();
    let payload, entity, contactId, agreement;
    if (isUuid(b.orderId)) {
      const o = await myOrder(me, b.orderId);
      [agreement] = await sql`select id, last_reminded_at from agreements where order_id = ${o.id} and kind = 'md_pdr' and status = 'waiting' order by created_at desc limit 1`;
      payload = { orderId: o.id }; entity = ['orders', o.id]; contactId = o.contact_id;
    } else if (isUuid(b.onboardingId)) {
      const [onb] = await sql`
        select o.id, o.agreement_id, coalesce(o.primary_contact_id, o.injector_contact_id) as contact_id from onboardings o
          join contacts c on c.id = coalesce(o.primary_contact_id, o.injector_contact_id)
         where o.id = ${b.onboardingId} and c.owner_id = ${me.id}`;
      if (!onb) throw fail(404, 'not_found');
      [agreement] = onb.agreement_id ? await sql`select id, last_reminded_at from agreements where id = ${onb.agreement_id}` : [];
      payload = { onboardingId: onb.id }; entity = ['onboardings', onb.id]; contactId = onb.contact_id;
    } else throw fail(400, 'bad_id');
    // At most once an hour (agreements.last_reminded_at, SOP section 10).
    if (agreement && agreement.last_reminded_at && Date.now() - new Date(agreement.last_reminded_at) < 3600000) throw fail(429, 'reminded_recently');
    const sent = await require('./_n8n').call('remind_md', payload);
    if (sent.queued) {
      if (agreement) await asUser(me.id, (tx) => tx`update agreements set last_reminded_at = now() where id = ${agreement.id}`);
      await logResend(me, entity[0], entity[1], contactId, 'MD reminded to sign');
    }
    return { ok: sent.queued, reason: sent.reason };
  },

  async voice(me, b) {
    const sql = db();
    await mine(sql, me, b.contactId);
    return require('./_voice').transcribe(sql, me, b);
  },

  async email(me, b) {
    const sql = db();
    const c = await mine(sql, me, b.contactId);
    const to = clean(b.to, 200).toLowerCase() || String(c.email || '').toLowerCase();
    if (!to || ![String(c.email || '').toLowerCase(), String(c.secondary_email || '').toLowerCase()].includes(to)) throw fail(400, 'bad_recipient');
    const subject = clean(b.subject, 300), text = clean(b.text, 20000);
    if (!subject || !text) throw fail(400, 'subject_and_message_required');
    const r = await require('./_gmail').send(sql, me, { to, subject, text });
    await asUser(me.id, (tx) => tx`
      insert into interactions (kind, contact_id, user_id, occurred_at, direction, status, subject, body, thread_id, addresses, source, external_id, created_by)
      values ('email', ${c.id}, ${me.id}, now(), 'out', 'completed', ${subject}, ${text}, ${r.threadId}, ${tx.json({ from: me.email, to })},
              'my_fifty', ${r.messageId}, ${me.id})`);
    return { ok: true };
  },

  async push_subscribe(me, b) {
    const ok = await asUser(me.id, (tx) => require('./_push').subscribe(tx, me, b.subscription));
    if (!ok) throw fail(400, 'bad_subscription');
    return { ok: true };
  },

  async gmail_connect(me, b) {
    return asUser(me.id, (tx) => require('./_gmail').connect(tx, me, b.refreshToken));
  },
};

async function myOrder(me, id) {
  if (!isUuid(id)) throw fail(400, 'bad_id');
  const [o] = await db()`select o.id, o.contact_id from orders o join contacts c on c.id = o.contact_id where o.id = ${id} and (c.owner_id = ${me.id} or o.rep_id = ${me.id}) and o.deleted_at is null`;
  if (!o) throw fail(404, 'not_found');
  return o;
}

// Resends are kept in change_log (SOP section 4: "Resend history goes in change_log").
async function logResend(me, table, id, contactId, note) {
  await asUser(me.id, (tx) => tx`
    insert into change_log (actor_user_id, actor_kind, source, action, entity_type, entity_id, contact_id, note)
    values (${me.id}, 'user', 'my_fifty', 'resend', ${table}, ${id}, ${contactId}, ${note})`);
}

const objectOrEmpty = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

// One standard form: +1 and ten digits for North American numbers (SOP section 3).
function normalPhone(s) {
  const d = String(s || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (d.startsWith('+') && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  return '';
}

module.exports.OPS = OPS;
module.exports._ = { splitNote, followUpAt, normalPhone };
