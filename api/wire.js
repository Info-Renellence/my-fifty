// "Mark as received" for a wire payment (the button in the overdue-wire email to info@, api/cron.js op=wires).
//   GET  /api/wire?o=&u=&e=&s=   a small page: the order, and the day the money arrived (today unless changed)
//   POST the same address          marks the wire payment succeeded, with paid_at = that day
// The link is signed for one order and one admin and lasts 30 days (api/_wire.js). The page asks before it changes
// anything, so a mail scanner opening the link does nothing. The change is recorded as that admin (change_log).
const { db, asUser } = require('./_db');
const { route, isUuid } = require('./_http');
const B = require('./_book');
const T = require('./_time');
const W = require('./_wire');

module.exports = route(async (req, res) => {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  if (!isUuid(q.o) || !isUuid(q.u) || !W.verify(q)) return page(res, 403, 'This link has expired or is not valid', 'Open the latest overdue-wire email and use its button.');
  const sql = db();
  const [admin] = await sql`select id, name from users where id = ${q.u} and kind = 'admin' and active is not false`;
  if (!admin) return page(res, 403, 'This link is not valid', 'Only an admin can mark a wire payment as received.');
  const [o] = await sql`
    select o.id, o.order_number, o.payment_method::text, o.submitted_at, o.invoiced_at, o.created_at, o.payment_terms_days,
           c.first_name, c.last_name, c.designation, c.email, cl.name as clinic,
           p.id as pay_id, p.amount::float8 as amount, p.status::text as pay_status, p.paid_at
      from orders o join contacts c on c.id = o.contact_id left join clinics cl on cl.id = c.clinic_id
      left join lateral (select * from payments where order_id = o.id and kind = 'charge' and method = 'wire' order by created_at desc limit 1) p on true
     where o.id = ${q.o} and o.deleted_at is null and o.payment_method = 'wire'`;
  if (!o) return page(res, 404, 'Order not found', 'It may have been cancelled or removed.');
  const who = B.fullName(o) + (o.clinic ? ' · ' + o.clinic : '');
  const amount = '$' + (Number(o.amount) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (o.pay_status === 'succeeded') return page(res, 200, 'Already received', esc(who) + '<br>' + esc(amount) + ' received ' + esc(T.short(o.paid_at)) + '.');

  if (req.method === 'POST') {
    const day = String((await formBody(req)).day || '');
    const today = T.ymd();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || T.ymd(T.atLocal(day, 12, 0)) !== day) return page(res, 400, 'Pick the day the money arrived', 'It cannot be in the future.');
    const at = T.atLocal(day, 12, 0);
    await asUser(admin.id, async (tx) => {
      if (o.pay_id) await tx`update payments set status = 'succeeded', paid_at = ${at} where id = ${o.pay_id} and status <> 'succeeded'`;
      else await tx`insert into payments (order_id, kind, method, amount, currency, status, provider, paid_at, is_test)
                    select ${o.id}, 'charge', 'wire', coalesce(sum(case when is_free then 0 else quantity * unit_price end), 0), 'CAD', 'succeeded', 'wire', ${at}, false
                      from order_lines where order_id = ${o.id}`;
    });
    return page(res, 200, 'Marked as received', esc(who) + '<br>' + esc(amount) + ' received ' + esc(T.short(at)) + '. Thank you.');
  }

  const s = W.state(o, { status: o.pay_status }, await W.defaultTerms(sql));
  return page(res, 200, 'Wire payment received?',
    esc(who) + '<br>' + esc(amount) + ' · ' + esc(s ? s.text.replace(/^Wire · /, '') : '')
    + '<form method="post" style="margin-top:20px"><label style="display:block;font-size:14px;color:#6B7486;margin-bottom:6px">Day the money arrived</label>'
    + '<input type="date" name="day" value="' + T.ymd() + '" max="' + T.ymd() + '" style="font-size:16px;padding:8px;border:1px solid #CBD2DE;border-radius:8px">'
    + '<button type="submit" style="display:block;margin-top:16px;height:48px;width:100%;border:0;border-radius:12px;background:#1170C0;color:#FFFFFF;font-size:16px;font-weight:600">Mark as received</button></form>');
});

// The page's form arrives as name=value pairs (Vercel may already have read it into req.body).
async function formBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null;
  if (raw == null) { const chunks = []; for await (const c of req) chunks.push(c); raw = Buffer.concat(chunks).toString('utf8'); }
  return Object.fromEntries(new URLSearchParams(raw));
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function page(res, status, title, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title></head>'
    + '<body style="margin:0;background:#F5F6F9;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1D2433">'
    + '<div style="max-width:420px;margin:40px auto;padding:24px;background:#FFFFFF;border-radius:16px">'
    + '<img src="/logo.png" alt="Renellence" style="height:18px;width:auto"><h1 style="font-size:22px;margin:16px 0 8px">' + esc(title) + '</h1>'
    + '<div style="font-size:15px;line-height:1.5">' + html + '</div></div></body></html>');
}

// Exposed for the unit tests only.
module.exports._ = { page, formBody };
