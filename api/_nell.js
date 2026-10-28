// Nell's moments (Final Mockup (3) N0-N4, owner 2026-10-28): which full-screen moment a log or an order earns.
//   Cheer    the log that reaches the daily goal (streak saved). Once a day; the phone also keeps it to once.
//   Jackpot  a rare big win, at most one a day, and it replaces Cheer on the same log. Kept in users.preferences.nell_wins
//            so Rewards can list it ("Saved to your wins on Rewards"). Earned by, in this order:
//              a new record day (more logs than any day before, and more than the goal),
//              a perfect week (every workday this week at the goal, on the week's last workday),
//              a streak of 4, 10 or 25 weeks (20, 50 or 125 workdays in a row),
//              an account back after 30+ days (a customer with a paid order, first reached contact in 30+ days).
//   Payday   every order Pulse sends that has money on it (api/act.js place_order): the commission it is expected to earn,
//            2% on a person's first paid order and 4% on every later one (owner 2026-10-28, as _rewards.js), and the
//            rep's all-time paid commission. Counted once the order is paid, so it says "on the way".
// Only real logs count: the same reached outbound calls and in-person visits as the day goal (_book.js dayStats).
// Nudge (after 3 pm, under the goal) is decided on the phone from Today's numbers; the 3 pm push is api/cron.js.
const B = require('./_book');
const T = require('./_time');

const STREAK_WEEKS = [4, 10, 25];
const NEW_RATE = 0.02, REORDER_RATE = 0.04;
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-CA');

// Counted logs per Toronto day, the same filter as the day goal.
async function perDay(sql, me) {
  const rows = await sql`
    select (i.occurred_at at time zone 'America/Toronto')::date::text as day, count(*)::int as n
      from interactions i
     where i.user_id = ${me.id} and i.deleted_at is null and i.status is distinct from 'cancelled' and i.status is distinct from 'scheduled'
       and (${B.CALL(sql)} or (i.kind = 'meeting' and i.mode = 'in_person')) and not ${B.INBOUND(sql)} and ${B.REACHED(sql)}
     group by 1`;
  return Object.fromEntries(rows.map((r) => [r.day, r.n]));
}

// The Monday of a 'YYYY-MM-DD' (weekday() is 0 = Sunday).
const mondayOf = (d) => T.addDays(d, -((T.weekday(d) + 6) % 7));

function perfectWeek(by, today, cfg) {
  const days = [];
  for (let d = mondayOf(today); d <= today; d = T.addDays(d, 1)) if (T.isBusinessDay(d, cfg.holidays)) days.push(d);
  // Only on the week's last workday (Friday, or Thursday before a Friday holiday).
  let rest = T.addDays(today, 1), more = false;
  while (T.weekday(rest) !== 1) { if (T.isBusinessDay(rest, cfg.holidays)) { more = true; break; } rest = T.addDays(rest, 1); }
  return !more && days.length >= 3 && days.every((d) => (by[d] || 0) >= cfg.daily_goal) ? days.length : 0;
}

// After a log is saved: { kind: 'jackpot' | 'cheer', kicker, title, sub } or null. Writes a jackpot to the rep's wins.
async function afterLog(sql, me, cfg, day, ctx) {
  if (!ctx.counted) return null;
  const today = T.ymd();
  const wins = Array.isArray(me.preferences.nell_wins) ? me.preferences.nell_wins : [];
  let jack = null;
  if (!wins.some((w) => w && w.date === today)) {
    const by = await perDay(sql, me);
    const best = Math.max(0, ...Object.entries(by).filter(([d]) => d < today).map(([, n]) => n));
    const goalNow = day.done === day.goal;
    if (day.done > best && day.done > day.goal) jack = { why: 'record', kicker: 'NEW RECORD', title: day.done + ' in a day', sub: best ? 'Your best day ever. Previous best: ' + best + '.' : 'Your best day ever.' };
    else if (goalNow && perfectWeek(by, today, cfg)) jack = { why: 'perfect_week', kicker: 'PERFECT WEEK', title: 'Every day this week', sub: day.goal + ' or more logged every workday this week.' };
    else if (goalNow && STREAK_WEEKS.includes(day.streak / 5)) jack = { why: 'streak', kicker: 'STREAK RECORD', title: (day.streak / 5) + ' weeks straight', sub: day.streak + ' workdays in a row at ' + day.goal + ' or more.' };
    else if (ctx.contactId) {
      const [back] = await sql`
        select (select max(i.occurred_at) from interactions i where i.contact_id = ${ctx.contactId} and i.id <> ${ctx.interactionId} and i.deleted_at is null
                  and i.outcome is distinct from 'no_answer' and not ${B.INBOUND(sql)}) as last,
               exists (select 1 from orders o where o.contact_id = ${ctx.contactId} and o.deleted_at is null and o.status <> all(${['rejected', 'cancelled']}::orders_status[])) as account`;
      const gap = back && back.account && back.last ? Math.floor((Date.now() - new Date(back.last)) / T.DAY) : 0;
      if (gap >= 30) jack = { why: 'back', kicker: 'BACK IN TOUCH', title: ctx.name, sub: 'First contact in ' + gap + ' days. Welcome back.' };
    }
  }
  if (jack) {
    const kept = wins.concat([{ date: today, at: new Date().toISOString(), why: jack.why, kicker: jack.kicker, title: jack.title, sub: jack.sub }]).slice(-50);
    await (ctx.write || ((fn) => fn(sql)))((tx) => tx`update users set preferences = (case when jsonb_typeof(preferences) = 'object' then preferences else '{}'::jsonb end) || ${tx.json({ nell_wins: kept })} where id = ${me.id}`);
    me.preferences.nell_wins = kept;
    return Object.assign({ kind: 'jackpot' }, jack);
  }
  if (day.done === day.goal) return { kind: 'cheer', kicker: 'STREAK SAVED', title: day.streak + '-day streak', sub: day.done + ' logged today. Everything after this is a bonus.' };
  return null;
}

// Payday for an order just placed: null for a sample order or one credited to someone else.
async function payday(sql, me, contactId, repId, total) {
  if (!(total > 0) || repId !== me.id) return null;
  const orders = (await B.ordersFor(sql, [contactId])).filter(B.isPaid);
  const rate = orders.length ? REORDER_RATE : NEW_RATE;
  return { amount: money(total * rate), cents: Math.round(total * rate * 100), rate: Math.round(rate * 100) + '%', balance: money(await balance(sql, me)) };
}

// All-time paid commission for a rep: 2% on each person's first paid order, 4% on every later one.
async function balance(sql, me) {
  const ids = (await sql`select distinct contact_id from orders where rep_id = ${me.id} and deleted_at is null`).map((r) => r.contact_id);
  if (!ids.length) return 0;
  const orders = (await B.ordersFor(sql, ids)).filter(B.isPaid);
  const first = {};
  for (const o of orders) if (!first[o.contact_id] || B.paidAt(o) < B.paidAt(first[o.contact_id])) first[o.contact_id] = o;
  return orders.filter((o) => o.rep_id === me.id).reduce((a, o) => a + o.total * (first[o.contact_id].id === o.id ? NEW_RATE : REORDER_RATE), 0);
}

// The wins Rewards lists: newest first.
function wins(me) {
  const w = Array.isArray(me.preferences.nell_wins) ? me.preferences.nell_wins : [];
  return w.slice().reverse().map((x) => ({ kicker: x.kicker, title: x.title, sub: x.sub, date: x.date, when: x.date === T.ymd() ? 'Today' : T.short(x.date + 'T12:00:00Z') }));
}

module.exports = { afterLog, payday, balance, wins, perfectWeek, perDay, NEW_RATE, REORDER_RATE };
