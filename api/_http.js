// Small request/response helpers shared by the routes.
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Only a plain JSON object is a request body; anything else (a list, null, a number, junk) is treated as empty.
const asObject = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
async function body(req) {
  if (req.body && typeof req.body === 'object') return asObject(req.body);
  if (typeof req.body === 'string') { try { return asObject(JSON.parse(req.body)); } catch (e) { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return asObject(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { return {}; }
}

const query = (req) => new URL(req.url, 'http://x').searchParams;

// Wraps a route: errors with a .status become that status and message; anything else is a 500.
const route = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const status = e && e.status && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error('MYFIFTY_ERROR', req.method, req.url, e && (e.stack || e.message));
    send(res, status, { error: (e && e.message) || 'server_error', detail: e && e.detail });
  }
};

const fail = (status, message, detail) => { const e = new Error(message); e.status = status; if (detail) e.detail = detail; return e; };
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
// obj[key] only when it is the object's own entry, so names like 'constructor' or '__proto__' never match.
const own = (obj, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const clean = (s, n) => String(s == null ? '' : s).replace(/\r/g, '').trim().slice(0, n || 500);

module.exports = { send, body, query, route, fail, isUuid, clean, own };
