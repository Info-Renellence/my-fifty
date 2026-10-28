require('./_staging'); // first: with STAGING=1 nothing goes out (api/_staging.js)
// Stripe's webhook (owner 2026-10-28, data-flow improvement 1): payments straight into v2. The logic is in api/_stripe.js.
//   POST /api/stripe   Stripe-Signature checked against the RAW body with STRIPE_WEBHOOK_SECRET (Vercel would otherwise
//                      parse the JSON and the signature would no longer match, so req.body is never touched here).
// Answers 200 for every event it accepted (also when it skipped it or is waiting for the order), so Stripe doesn't retry;
// 401 for a bad or missing signature.
const { db } = require('./_db');
const { send, route, fail } = require('./_http');
const S = require('./_stripe');

const rawBody = (req) => new Promise((ok, no) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch).toString('utf8'))); req.on('error', no); });

module.exports = route(async (req, res) => {
  if (req.method !== 'POST') throw fail(405, 'method_not_allowed');
  const raw = await rawBody(req);
  if (!S.signatureOk(req.headers['stripe-signature'], raw, process.env.STRIPE_WEBHOOK_SECRET)) throw fail(401, 'unauthorized');
  let ev; try { ev = JSON.parse(raw); } catch (e) { throw fail(400, 'bad_json'); }
  send(res, 200, await S.handle(db(), ev));
});
module.exports.config = { api: { bodyParser: false } };
