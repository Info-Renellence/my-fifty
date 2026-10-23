require('./_staging'); // first: with STAGING=1 nothing goes out (api/_staging.js)
// Everything My Fifty reads (GET /api/data?op=...). Read-only; writes are in api/act.js.
//
//   config      public settings the page needs before sign-in (Supabase URL + anon key, push key)
//   boot        who is signed in, their initials, and a "joined your Fifty" moment if one is due
//   today       L2: the day ring, streak, Fifty tile, suggested next and the list; the week (focus, visits, calls) when set
//   people      L6: My Fifty (warm / going cold), Candidates, Leads (four groups)
//   leads       L22-L25: one lead group, newest first (&group=onboarded|social|event|warm|cold)
//   person      L7/L8: one person's card (&id=)
//   history     L14: one person's history (&id=)
//   ready       L9: people ready to order (onboarded, or ordered before)
//   products    #12: the product list, with what this person had on their last order (&id=)
//   order       L19/L21: one order's progress (&id=)
//   onboarding  L20: a person's onboarding progress (&id=contact)
//   rewards     L11
//   search      Find a person (&q=)
const { db } = require('./_db');
const { signedIn, SUPABASE_URL, ANON } = require('./_auth');
const { send, query, route, fail, isUuid, own } = require('./_http');
const B = require('./_book');
const T = require('./_time');
const R = require('./_rewards');

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-CA');
// Onboarded (Yousef 2026-10-22, item B) comes first: fully signed onboarding and no order of any kind yet (_book.js).
const LEAD_GROUPS = { onboarded: 'Onboarded', social: 'Social media', event: 'Events and training', warm: 'Other warm leads', cold: 'Cold leads' };
const TOUCH_WORD = { call: 'Called', text: 'Texted', meeting: 'Visited', email: 'Emailed' };

module.exports = route(async (req, res) => {
  const q = query(req);
  const op = q.get('op') || '';
  if (op === 'config') {
    const push = require('./_push');
    require('./_staging').refuseV2(SUPABASE_URL());   // staging signs in against v1 only
    return send(res, 200, { supabaseUrl: SUPABASE_URL(), supabaseAnonKey: ANON(), vapidPublicKey: (push.vapid() || {}).publicKey || '',
      staging: require('./_staging').on() });
  }
  const me = await signedIn(req);
  const sql = db();
  const fn = own(OPS, op);
  if (!fn) throw fail(400, 'unknown_op');
  send(res, 200, await fn(sql, me, q));
});

// Admins (users.kind = 'admin') see everyone's customers, unassigned leads included, the same as Edge's F5 (Yousef
// 2026-10-22, E): the shared book's opts.everyone. Reps are unchanged (their own book; head-office contacts stay hidden).
const isAdmin = (me) => !!me && me.kind === 'admin';
const scope = (me, o) => Object.assign({}, o || {}, { everyone: isAdmin(me) });

const OPS = {
  async boot(sql, me) {
    const cfg = await B.settings(sql);
    const flags = await require('./_flags').all(sql);
    const { people } = await B.book(sql, me, scope(me, { cfg }));
    const fifty = people.filter((p) => p.stage === 'fifty');
    // "Joined your Fifty" (L5): the newest person whose first paid order came after the last one shown.
    const seenAt = me.preferences.fifty_seen_at ? new Date(me.preferences.fifty_seen_at) : null;
    // Joining = their first order (the Fifty is worked out from orders placed, paid or not: Edge decisions 2026-10-21).
    const fresh = fifty.filter((p) => p.firstOrderAt && (!seenAt || new Date(p.firstOrderAt) > seenAt))
      .sort((a, b) => new Date(b.firstOrderAt) - new Date(a.firstOrderAt));
    const joined = seenAt && fresh.length ? { id: fresh[0].id, name: fresh[0].name, count: fifty.length, goal: cfg.fifty_goal, next: B.nextMilestone(fifty.length) } : null;
    const gmail = await sql`select status from connections where user_id = ${me.id} and provider = 'gmail' order by updated_at desc limit 1`;
    return { me: { id: me.id, name: me.name, first: me.first, initials: me.initials, email: me.email }, joined, firstVisit: !seenAt,
      gmail: gmail.length ? gmail[0].status : 'off', voice: require('./_gemini').available() && flags.voice_notes,
      // Feature switches (settings 'flags', api/_flags.js) the page may need; already-live features default on.
      features: { weekView: flags.week_view, voiceNotes: flags.voice_notes, claudeSuggestions: flags.claude_suggestions } };
  },

  async today(sql, me) {
    const cfg = await B.settings(sql);
    const [{ people }, day] = await Promise.all([B.book(sql, me, scope(me, { cfg })), B.dayStats(sql, me, cfg)]);
    const fiftyCount = people.filter((p) => p.stage === 'fifty').length;
    // Parked accounts (Compass) stay off the list until their date; the week block shows once the weekly 1-on-1 is saved.
    // The week block can be switched off (settings flags.week_view, api/_flags.js; on by default).
    const weekOn = await require('./_flags').on(sql, 'week_view');
    const [parked, week] = await Promise.all([B.parkedUntil(sql, people.map((p) => p.id)), weekOn ? require('./_week').view(sql, me) : null]);
    const list = B.todayList(people, me, cfg, parked);
    return { date: T.ymd(), day, fifty: { count: fiftyCount, next: B.nextMilestone(fiftyCount), goal: cfg.fifty_goal }, list, week };
  },

  async people(sql, me) {
    const cfg = await B.settings(sql);
    const { people } = await B.book(sql, me, scope(me, { cfg }));
    const fifty = people.filter((p) => p.stage === 'fifty');
    const warm = fifty.filter((p) => !p.goingCold).sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
    const cold = fifty.filter((p) => p.goingCold).sort((a, b) => b.coldDays - a.coldDays);
    const cands = people.filter((p) => p.stage === 'candidate')
      .sort((a, b) => (b.sampleDays == null ? -1 : b.sampleDays) - (a.sampleDays == null ? -1 : a.sampleDays));
    const leads = people.filter((p) => p.stage === 'lead');
    const groups = Object.keys(LEAD_GROUPS).map((k) => {
      const g = leads.filter((p) => p.leadGroup === k);   // someone who left the Fifty is a warm lead
      return { key: k, label: LEAD_GROUPS[k] === 'Events and training' ? 'Event and training leads' : k === 'social' ? 'Social media leads' : LEAD_GROUPS[k], count: g.length, fresh: g.filter((p) => p.isNew).length };
    });
    const row = (p, sub) => ({ id: p.id, name: p.name, clinic: p.clinic, sub });
    return {
      fifty: { count: fifty.length, goal: cfg.fifty_goal, warmCount: warm.length, coldCount: cold.length, open: Math.max(0, cfg.fifty_goal - fifty.length),
        warm: warm.map((p) => row(p, (p.clinic ? p.clinic + ' · ' : '') + p.lastActiveKind + ' ' + T.short(p.lastActiveAt))),
        cold: cold.map((p) => row(p, (p.clinic ? p.clinic + ' · ' : '') + p.coldDays + ' days')) },
      candidates: cands.map((p) => Object.assign(row(p, p.clinic), { initials: initials(p.name), days: p.sampleDays,
        ring: p.sampleDays == null ? 0 : Math.min(1, p.sampleDays / 30) })),
      leads: groups,
      all: people.map((p) => ({ id: p.id, name: p.name, clinic: p.clinic, stage: p.stage })),
    };
  },

  async leads(sql, me, q) {
    const group = q.get('group');
    if (!own(LEAD_GROUPS, group)) throw fail(400, 'bad_group');
    const { people } = await B.book(sql, me, scope(me));
    const leads = people.filter((p) => p.stage === 'lead' && p.leadGroup === group).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const added = group === 'cold' || group === 'warm' ? await addedBy(sql, leads.map((p) => p.id), me) : {};
    return { group, title: LEAD_GROUPS[group], leads: leads.map((p) => ({
      id: p.id, name: p.name, initials: initials(p.name), isNew: p.isNew, age: B.ago(p.createdAt),
      sub: [p.clinic, sourceText(p, added[p.id])].filter(Boolean).join(' · '),
      last: p.lastTouchKind ? (TOUCH_WORD[p.lastTouchKind] || 'Touched') + ' ' + T.short(p.lastTouchAt) : '',
    })) };
  },

  async person(sql, me, q) {
    const p = await one(sql, me, q.get('id'));
    const status = await statusRow(sql, p);
    const last = await lastHistoryLine(sql, p);
    return {
      id: p.id, name: p.name, first: p.first, clinic: p.clinic, phone: p.phone, email: p.email, stage: p.stage, goingCold: !!p.goingCold,
      label: p.stage === 'fifty' ? (p.goingCold ? 'MY FIFTY · GOING COLD' : 'MY FIFTY') : p.stage === 'candidate' ? 'CANDIDATE'
        : 'LEAD · ' + ({ onboarded: 'ONBOARDED', social: 'SOCIAL MEDIA', event: 'EVENT AND TRAINING', warm: 'WARM', cold: 'COLD' }[p.leadGroup] || 'NEW'),
      totalBought: p.stage === 'fifty' ? money(p.totalBought) : null,
      lastOrder: p.lastPaid ? { total: money(p.lastPaid.total), date: T.short(B.paidAt(p.lastPaid)) } : null,
      status, followUp: p.followUp ? { id: p.followUp.id, date: T.ymd(p.followUp.due_at), label: T.short(p.followUp.due_at), title: p.followUp.title } : null,
      fillers: p.fillers, prp: p.prp, last,
    };
  },

  async history(sql, me, q) {
    const p = await one(sql, me, q.get('id'));
    return { id: p.id, name: p.name, entries: await historyOf(sql, me, p) };
  },

  async ready(sql, me) {
    const { people } = await B.book(sql, me, scope(me));
    const ids = people.map((p) => p.id);
    const onb = ids.length ? await sql`
      select distinct coalesce(primary_contact_id, injector_contact_id) as id from onboardings
       where status in ('signed', 'complete') and (primary_contact_id = any(${ids}) or injector_contact_id = any(${ids}))` : [];
    const ok = new Set(onb.map((r) => r.id));
    return { people: people.filter((p) => ok.has(p.id) || p.orders.length)
      .sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ id: p.id, name: p.name, clinic: p.clinic, initials: initials(p.name) })) };
  },

  async products(sql, me, q) {
    // The L9 product step as the mockup has it (Yousef 2026-10-21): products by category (saypha, Magic Needle,
    // Mesbio, Skin care, Exprecell, Other), each at its list price, which the rep may change. Free-only items (price 0,
    // the "Other" extras) have no price. A product that is not active shows as Unavailable only in the Exprecell
    // category (the mockup's one unavailable product); other inactive products are left out. No "Same as last order"
    // and no "Last order" hints (dropped to match the mockup).
    const p = await one(sql, me, q.get('id'));
    const products = await sql`select sku, name, product_line, list_price::float8 as price, is_active from products where is_active = ${true} or product_line = ${'prp'}`;
    const card = await cardOnFile(sql, p.id);
    return {
      person: { id: p.id, name: p.name, clinic: p.clinic, initials: initials(p.name), email: p.email, secondaryEmail: p.secondaryEmail, shipping: p.shipping, billing: p.billing },
      card,
      cats: ORDER_CATS.map(([key, label]) => ({ key, label })),
      products: products.map((x) => {
        const cat = orderCat(x);
        return { sku: x.sku, cat, name: rowName(x, cat), fullName: shortProduct(x.name), price: x.price, freeOnly: !(x.price > 0), unavailable: !x.is_active, sort: rowSort(x, cat) };
      }).sort((a, b) => ORDER_CATS.findIndex((c) => c[0] === a.cat) - ORDER_CATS.findIndex((c) => c[0] === b.cat) || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
        .map(({ sort, ...x }) => x),
    };
  },

  async order(sql, me, q) {
    const id = q.get('id');
    if (!isUuid(id)) throw fail(400, 'bad_id');
    const [o] = await sql`select o.*, c.owner_id, c.first_name, c.last_name, c.designation, c.email as contact_email from orders o join contacts c on c.id = o.contact_id where o.id = ${id} and o.deleted_at is null`;
    if (!o || (o.owner_id !== me.id && o.rep_id !== me.id && !isAdmin(me))) throw fail(404, 'not_found');
    const [x] = await B.ordersFor(sql, [o.contact_id]).then((rows) => rows.filter((r) => r.id === id));
    const sample = x ? B.isSample(x) : false;
    const pays = await sql`select method::text, status::text, pay_link_url, card_brand, card_last4, failure_reason, paid_at, created_at from payments where order_id = ${id} and kind = 'charge' order by created_at desc`;
    const md = o.medical_director_contact_id ? (await sql`select first_name, last_name, designation from contacts where id = ${o.medical_director_contact_id}`)[0] : null;
    const mdAgreement = (await sql`select status::text, sent_at, completed_at from agreements where order_id = ${id} and kind = 'md_pdr' order by created_at desc limit 1`)[0];
    const onb = await onboardingOf(sql, o.contact_id);
    const W = require('./_wire');
    const wire = o.payment_method === 'wire' ? W.state(o, pays.find((p) => p.method === 'wire') || null, await W.defaultTerms(sql)) : null;
    const steps = sample ? sampleSteps(o, md, mdAgreement) : orderSteps(o, x, pays, wire);
    const pay = pays[0];
    return {
      id, contactId: o.contact_id, name: B.fullName({ first_name: o.first_name, last_name: o.last_name, designation: o.designation, email: o.contact_email }), sample,
      total: sample ? 'Free' : money(x ? x.total : 0), steps,
      action: sample ? (mdAgreement && mdAgreement.status === 'waiting' ? 'remind_md' : null)
        : (pay && pay.method === 'pay_link' && pay.status === 'pending' && !(x && x.paid_flag) ? 'resend_pay_link' : null),
      onboarding: !sample && onb ? { label: 'Onboarding', value: onb.status === 'signed' || onb.status === 'complete' ? 'Signed ' + T.short(onb.signedAt || onb.submitted_at) : 'Not signed yet', done: onb.status === 'signed' || onb.status === 'complete' } : null,
      lines: sample && x ? (x.summary || []).map((l) => ({ name: shortProduct(l.name), qty: l.qty })) : [],
    };
  },

  async onboarding(sql, me, q) {
    const p = await one(sql, me, q.get('id'));
    const onb = await onboardingOf(sql, p.id);
    if (!onb) return { id: p.id, name: p.name, none: true };
    const s = onb.signers;
    const first = s.find((x) => x.role !== 'md');
    const md = s.find((x) => x.role === 'md');
    const ready = onb.status === 'signed' || onb.status === 'complete';
    const steps = [
      { label: 'Form submitted', when: onb.submitted_at ? T.short(onb.submitted_at) : '', done: !!onb.submitted_at },
      { label: 'Initial signature', when: first && first.signed_at ? T.short(first.signed_at) : '', done: !!(first && first.signed_at) },
      { label: 'MD signature', when: md && md.signed_at ? T.short(md.signed_at) : '', done: !!(md && md.signed_at) },
      { label: 'Ready to order', when: ready ? T.short(onb.completed_at || onb.signedAt || onb.submitted_at) : '', done: ready },
    ];
    markCurrent(steps, (st) => (st.label === 'MD signature' && md && md.sent_at ? 'Waiting · ' + T.daysBetween(md.sent_at) + ' days'
      : st.label === 'Initial signature' ? 'Waiting' : 'Waiting'));
    return { id: p.id, name: p.name, steps, onboardingId: onb.id,
      action: md && !md.signed_at && first && first.signed_at ? 'remind_md' : null,
      card: onb.card_saved_at ? 'Saved ' + T.short(onb.card_saved_at) : 'Not saved yet', cardDone: !!onb.card_saved_at };
  },

  async rewards(sql, me) {
    return R.rewards(sql, me);
  },

  async search(sql, me, q) {
    // Accents and case don't matter (Yousef 2026-10-22, Edge Q7): "Zoe" finds "Zoë" and the reverse.
    const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const term = fold(String(q.get('q') || '').trim());
    const { people } = await B.book(sql, me, scope(me));
    const hits = people.filter((p) => !term || fold(p.name + ' ' + p.clinic + ' ' + p.email + ' ' + p.phone).includes(term))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50);
    return { people: hits.map((p) => ({ id: p.id, name: p.name, clinic: p.clinic, stage: p.stage, initials: initials(p.name) })) };
  },
};

// ---- helpers ------------------------------------------------------------------------------------

const initials = (name) => String(name || '').replace(/^Dr\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// Product names as the mockup writes them: "saypha® filler", "Magic Needle 25G 50mm", "Mesbio needle 30G 12mm".
function shortProduct(name) {
  const s = String(name || '');
  let m = s.match(/^(saypha®?\s+(?:lips|filler|volume plus|volume))\b/i);
  if (m) return m[1];
  m = s.match(/^Magic Needle Cannula\s+(\d+G)\s+(\d+)MM/i);
  if (m) return 'Magic Needle ' + m[1] + ' ' + m[2] + 'mm';
  m = s.match(/^Mesbio .*?Needle\s+(\d+G)\s+(\d+)MM/i);
  if (m) return 'Mesbio needle ' + m[1] + ' ' + m[2] + 'mm';
  return s.replace(/\s+\((?:\d+ Syringes\/Box)\)/i, '');
}

function unitWord(sku) { return /^(MN|MES|EXPRECELL)/i.test(sku) ? 'box' : ''; }

// The product step's categories, in the mockup's order.
const ORDER_CATS = [['saypha', 'saypha'], ['cannula', 'Magic Needle'], ['mesbio', 'Mesbio'], ['skin', 'Skin care'], ['prp', 'Exprecell'], ['other', 'Other']];
function orderCat(x) {
  if (x.product_line === 'prp' || /^EXPRECELL/i.test(x.sku)) return 'prp';
  if (/^MN/i.test(x.sku)) return 'cannula';
  if (/^MES/i.test(x.sku)) return 'mesbio';
  if (x.product_line === 'skin_care') return 'skin';
  if (/^SA/i.test(x.sku) && x.price > 0) return 'saypha';
  return 'other';
}
// Row names as in the mockup: "saypha® filler", cannulas and needles by size only ("25G 50mm"), the rest as named.
function rowName(x, cat) {
  const m = String(x.name).match(/(\d+G)\s+(\d+)MM/i);
  if ((cat === 'cannula' || cat === 'mesbio') && m) return m[1] + ' ' + m[2] + 'mm';
  if (cat === 'prp') return String(x.name).replace(/\s*\((\d+) Syringes\/Box\)/i, '');
  return shortProduct(x.name);
}
// saypha in the mockup's order (filler, lips, volume, volume plus); sizes by gauge then length; the rest by name.
function rowSort(x, cat) {
  const m = String(x.name).match(/(\d+)G\s+(\d+)MM/i);
  if ((cat === 'cannula' || cat === 'mesbio') && m) return String(m[1]).padStart(3, '0') + String(m[2]).padStart(3, '0');
  if (cat === 'saypha') return String(['SAF', 'SAL', 'SAV2', 'SAVP'].findIndex((s) => String(x.sku).toUpperCase().startsWith(s))) + x.sku;
  return String(x.name).toLowerCase();
}

async function one(sql, me, id) {
  if (!isUuid(id)) throw fail(400, 'bad_id');
  const { people } = await B.book(sql, me, scope(me, { contactId: id }));
  if (!people.length) throw fail(404, 'not_found');
  return people[0];
}

// Who added each lead (from change_logs), for "Added by you" / "Added by <first name>" on cold and warm leads.
async function addedBy(sql, ids, me) {
  if (!ids.length) return {};
  const rows = await sql`
    select distinct on (l.entity_id) l.entity_id, l.actor_user_id, u.full_name
      from change_logs l left join users u on u.id = l.actor_user_id
     where l.entity_type = 'contacts' and l.action = 'create' and l.entity_id = any(${ids})
     order by l.entity_id, l.changed_at`;
  return Object.fromEntries(rows.map((r) => [r.entity_id, r.actor_user_id ? (r.actor_user_id === me.id ? 'you' : String(r.full_name || '').split(/\s+/)[0]) : null]));
}

// Under a lead's clinic: the event they came from, or who added them (no other source detail: four sources only).
function sourceText(p, by) {
  if (p.sourceKind === 'event' && p.eventName) return p.eventName;
  if (by) return 'Added by ' + by;
  return '';
}

async function cardOnFile(sql, contactId) {
  const [c] = await sql`
    select p.card_brand, p.card_last4 from payments p join orders o on o.id = p.order_id
     where o.contact_id = ${contactId} and p.method = 'card_on_file' and p.card_last4 is not null
     order by p.created_at desc limit 1`;
  const [onb] = await sql`select card_saved_at from onboardings where (primary_contact_id = ${contactId} or injector_contact_id = ${contactId}) and card_saved_at is not null order by card_saved_at desc limit 1`;
  if (c) return { saved: true, text: (c.card_brand || 'Card') + ' •••• ' + c.card_last4 };
  if (onb) return { saved: true, text: 'Card on file' };
  return { saved: false, text: '' };
}

async function onboardingOf(sql, contactId) {
  const [o] = await sql`
    select o.id, o.status::text, o.submitted_at, o.completed_at, o.card_saved_at, o.agreement_id
      from onboardings o where (o.primary_contact_id = ${contactId} or o.injector_contact_id = ${contactId}) and o.status <> 'abandoned'
     order by o.submitted_at desc nulls last limit 1`;
  if (!o) return null;
  const signers = o.agreement_id ? await sql`
    select s.role, s.status::text, s.signed_at, a.sent_at, a.completed_at from agreement_signers s join agreements a on a.id = s.agreement_id
     where s.agreement_id = ${o.agreement_id} order by s.signing_order` : [];
  o.signers = signers.map((s) => ({ role: /md|director/i.test(s.role || '') ? 'md' : s.role, signed_at: s.signed_at, sent_at: s.sent_at }));
  o.signedAt = signers.length && signers.every((s) => s.signed_at) ? signers.map((s) => s.signed_at).reduce((a, x) => (x > a ? x : a)) : null;
  return o;
}

// The person card's status row (L7 "Waiting on payment", L8 "Waiting on MD signature · Onboarding").
async function statusRow(sql, p) {
  const open = p.orders.find((o) => !o.shipped_at && !o.delivered_at && !['shipped', 'delivered'].includes(o.status));
  if (open) {
    const sample = B.isSample(open);
    let label = 'Preparing to ship';
    if (open.status === 'submitted') label = 'Waiting on approval';
    else if (open.status === 'awaiting_md' || (sample && open.medical_director_contact_id && !open.medical_director_signed_at)) label = 'Waiting on MD signature';
    else if (!sample && !open.paid_flag) label = 'Waiting on payment';
    return { kind: sample ? 'samples' : 'order', id: open.id, label, sub: sample ? 'Samples · Free' : 'Order · ' + money(open.total) };
  }
  const onb = await onboardingOf(sql, p.id);
  if (onb && !['signed', 'complete'].includes(onb.status)) {
    const first = onb.signers.find((x) => x.role !== 'md');
    const label = first && !first.signed_at ? 'Waiting on signature' : 'Waiting on MD signature';
    return { kind: 'onboarding', id: onb.id, label, sub: 'Onboarding' };
  }
  return null;
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KIND_WORD = { call: 'Call', meeting: 'Visit', text: 'Text', email: 'Email', note: 'Note' };
function outcomeWord(i) {
  if (i.kind === 'note' || i.kind === 'email') return '';
  return /connected|reached|took_order|left_samples|met/i.test(i.outcome || '') ? 'reached' : i.outcome ? 'no reply' : '';
}
function when(at) { const d = T.ymd(at); return d === T.ymd() ? 'today' : T.short(at); }

// The last line on the card's History row: "Call · reached · today".
async function lastHistoryLine(sql, p) {
  const [i] = await sql`select kind::text, mode::text, outcome, occurred_at from interactions where contact_id = ${p.id} and deleted_at is null and status is distinct from 'scheduled' order by occurred_at desc limit 1`;
  if (!i) return p.orders.length ? 'Order · ' + T.short(p.orders[0].submitted_at || p.orders[0].created_at) : 'Nothing yet';
  return [KIND_WORD[B.kindOf(i)], outcomeWord(i), when(i.occurred_at)].filter(Boolean).join(' · ');
}

const ORDER_WORD = (o) => {
  if (o.status === 'rejected') return ['Rejected', 'grey'];
  if (o.status === 'cancelled') return ['Cancelled', 'grey'];
  if (o.delivered_at || o.status === 'delivered') return ['Delivered', 'green'];
  if (o.shipped_at || o.status === 'shipped') return ['Shipped', 'green'];
  if (o.status === 'submitted') return ['Waiting on approval', 'amber'];
  if (o.status === 'awaiting_md') return ['Waiting on MD signature', 'amber'];
  if (!B.isSample(o) && !o.paid_flag) return ['Waiting on payment', 'amber'];
  return ['Preparing to ship', 'blue'];
};

function lineSummary(o) {
  const parts = (o.summary || []).filter((l) => B.isSample(o) || !l.free).map((l) => l.qty + ' ' + shortName(l.name));
  return parts.join(' · ');
}
function shortName(n) {
  const s = String(n || '');
  if (/saypha.*volume plus/i.test(s)) return 'volume plus';
  if (/saypha.*volume/i.test(s)) return 'volume';
  if (/saypha.*lips/i.test(s)) return 'lips';
  if (/saypha.*filler/i.test(s)) return 'filler';
  if (/cannula/i.test(s)) return 'cannulas';
  if (/needle/i.test(s)) return 'needles';
  return s.replace(/\s+box of \d+/i, '');
}

async function historyOf(sql, me, p) {
  const out = [];
  const inter = await sql`
    select i.id, i.kind::text, i.mode::text, i.direction::text, i.outcome, i.subject, i.body, i.occurred_at, i.user_id, u.full_name as user_name,
           (select t.title from tasks t where t.from_interaction_id = i.id and t.deleted_at is null order by t.created_at desc limit 1) as next_step
      from interactions i left join users u on u.id = i.user_id
     where i.contact_id = ${p.id} and i.deleted_at is null and i.status is distinct from 'scheduled'
     order by i.occurred_at desc limit 200`;
  for (const i of inter) {
    // A call, text or email the person made or sent (RD3, Yousef 2026-10-23) is from them, never "You", and can't be edited.
    const inbound = i.direction === 'in' && ['call', 'text', 'email'].includes(i.kind);
    const mine = !inbound && i.user_id === me.id;
    const who = inbound ? p.first || p.name : mine ? 'You' : String(i.user_name || '').split(/\s+/)[0] || 'Renellence';
    const kind = B.kindOf(i);   // a meeting with no type is a call (RD4, Yousef 2026-10-23)
    if (i.kind === 'note' && !mine) {
      out.push({ type: 'note', at: i.occurred_at, title: 'Note from ' + who, body: i.body || '', by: who, id: i.id });
      continue;
    }
    // "Next:" is the follow-up made from this log (tasks.from_interaction_id), or the line the rep wrote.
    const written = String(i.body || '').match(/(?:^|\n)[ \t]*next(?: step)?[ \t]*:\s*([\s\S]+)$/i);
    const next = i.next_step && i.next_step !== 'Follow up' ? i.next_step : written ? written[1].trim() : '';
    out.push({ type: 'touch', kind, at: i.occurred_at, id: i.id, editable: mine && i.kind !== 'email',
      title: [(KIND_WORD[kind] || 'Note') + (inbound ? ' from ' + who : ''), outcomeWord(i)].filter(Boolean).join(' · '),
      body: i.kind === 'email' ? [i.subject, i.body].filter(Boolean).join(' — ').slice(0, 4000) : (i.body || ''),
      next, by: who });
  }
  // Rejected and cancelled orders are left out of everything else (they never count), but History shows them, so
  // the rep sees what happened (Yousef 2026-10-21, Q7).
  const ended = await sql`
    select o.id, o.status::text as status, o.submitted_at, o.created_at,
           coalesce(sum(case when ol.is_free then 0 else ol.quantity * coalesce(ol.unit_price, 0) end), 0)::float8 as total,
           count(ol.id)::int as n_lines, coalesce(bool_and(ol.is_free or coalesce(ol.unit_price, 0) = 0), false) as all_free,
           json_agg(json_build_object('sku', ol.product_sku, 'name', ol.product_name, 'qty', ol.quantity, 'free', coalesce(ol.is_free, false)) order by ol.quantity desc, ol.product_name)
             filter (where ol.id is not null) as summary
      from orders o left join order_lines ol on ol.order_id = o.id
     where o.contact_id = ${p.id} and o.deleted_at is null and o.status = any(${['rejected', 'cancelled']})
     group by o.id`;
  for (const o of p.orders.concat(ended)) {
    const sample = B.isSample(o);
    const [word, tone] = ORDER_WORD(o);
    out.push({ type: sample ? 'samples' : 'order', at: o.submitted_at || o.created_at, id: o.id,
      title: sample ? 'Samples' : 'Order · ' + money(o.total), body: lineSummary(o), status: word, tone });
  }
  const moves = await sql`
    select l.changed_at as at, u.full_name as name from change_logs l join users u on u.id::text = (l.old_value #>> '{}')
     where l.entity_type = 'contacts' and l.entity_id = ${p.id} and l.field_name = 'owner_id' and (l.new_value #>> '{}') = ${me.id}
     order by l.changed_at desc`;
  for (const m of moves) out.push({ type: 'event', at: m.at, title: 'Moved to you from ' + m.name });
  const origin = p.sourceKind === 'event' && p.eventName ? 'Met at ' + p.eventName
    : p.sourceKind === 'social' ? 'Came from a Meta ad' : 'Added to My Fifty';
  out.push({ type: 'origin', at: p.createdAt, title: origin });
  out.sort((a, b) => new Date(b.at) - new Date(a.at));
  return out.map((e) => Object.assign(e, { month: LONG_MONTHS[+T.ymd(e.at).slice(5, 7) - 1], year: T.ymd(e.at).slice(0, 4), when: when(e.at).replace(/^today$/, 'Today') }));
}

function fmtTime(at) {
  const d = T.ymd(at) === T.ymd() ? 'Today ' : T.short(at) + ', ';
  return d + new Date(at).toLocaleTimeString('en-CA', { timeZone: T.TZ, hour: 'numeric', minute: '2-digit' }).replace(/\s?[ap]\.?m\.?/i, '');
}

function markCurrent(steps, waitingText) {
  const i = steps.findIndex((s) => !s.done);
  if (i >= 0) { steps[i].current = true; if (!steps[i].when) steps[i].when = waitingText(steps[i]); }
  return steps;
}

// wire: api/_wire.js state() for a wire order (due, overdue or received), shown on the Payment step.
// How far the order's status says it got. Orders brought over from Shopify are shipped or delivered with no
// approved / warehouse / shipped times (real-data run 2026-10-22, RD6): the status still counts, the step just has no date.
const STATUS_RANK = { submitted: 0, awaiting_md: 0, approved: 1, invoiced: 1, paid: 1, sent_to_warehouse: 2, shipped: 3, delivered: 3 };
const reached = (o, status) => (STATUS_RANK[o.status] || 0) >= STATUS_RANK[status];
function orderSteps(o, x, pays, wire) {
  const paid = x && x.paid_flag;
  const pay = pays[0];
  let payWhen = '';
  // A wire order is paid only once the money is marked received (Edge decisions 2026-10-21); until then its due date shows.
  if (o.payment_method === 'wire') payWhen = wire ? wire.text : 'Wire';
  else if (paid) payWhen = pay && pay.paid_at ? fmtTime(pay.paid_at) : 'Paid';
  else if (pay && pay.status === 'failed') payWhen = 'Card declined' + (pay.pay_link_url ? ' · link sent ' + fmtTime(pay.created_at).replace(/^Today /, '') : '');
  else if (pay && pay.method === 'pay_link') payWhen = 'No card on file · link sent ' + fmtTime(pay.created_at).replace(/^Today /, '');
  const steps = [
    { label: 'Order placed', when: fmtTime(o.submitted_at || o.created_at), done: true },
    { label: 'Approved', when: o.approved_at ? fmtTime(o.approved_at) : '', done: !!o.approved_at || reached(o, 'approved') },
    { label: 'Payment', when: payWhen, done: !!paid },
    { label: 'Preparing to ship', when: o.sent_to_warehouse_at ? fmtTime(o.sent_to_warehouse_at) : '', done: !!(o.sent_to_warehouse_at || o.shipped_at) || reached(o, 'sent_to_warehouse') },
    { label: 'Shipped', when: o.shipped_at ? fmtTime(o.shipped_at) + (o.tracking_number ? ' · ' + o.tracking_number : '') : '', done: !!o.shipped_at || reached(o, 'shipped') },
  ];
  return markCurrent(steps, () => 'Waiting');
}

function sampleSteps(o, md, ag) {
  const mdName = md ? B.fullName(md) : 'the MD';
  const steps = [
    { label: 'Order placed', when: fmtTime(o.submitted_at || o.created_at), done: true },
    { label: 'Approved', when: o.approved_at ? fmtTime(o.approved_at) : '', done: !!o.approved_at || reached(o, 'approved') },
    { label: 'MD signature', when: o.medical_director_signed_at ? fmtTime(o.medical_director_signed_at) : ag && ag.sent_at ? 'Sent to ' + mdName + ' ' + fmtTime(ag.sent_at).replace(/^Today /, '') : '', done: !!o.medical_director_signed_at || reached(o, 'sent_to_warehouse') },
    { label: 'Preparing to ship', when: o.sent_to_warehouse_at ? fmtTime(o.sent_to_warehouse_at) : '', done: !!(o.sent_to_warehouse_at || o.shipped_at) || reached(o, 'sent_to_warehouse') },
    { label: 'Shipped', when: o.shipped_at ? fmtTime(o.shipped_at) : '', done: !!o.shipped_at || reached(o, 'shipped') },
  ];
  return markCurrent(steps, () => 'Waiting');
}

module.exports.OPS = OPS;
// Exposed for the unit tests only.
module.exports._ = { money, initials, shortProduct, unitWord, one, addedBy, sourceText, cardOnFile, onboardingOf, statusRow, outcomeWord, when, lastHistoryLine,
  ORDER_WORD, lineSummary, shortName, historyOf, fmtTime, markCurrent, orderSteps, sampleSteps, LEAD_GROUPS };
