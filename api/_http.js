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
  } catch (err) {
    // A request value String() cannot convert (e.g. {"toString":"x"}) anywhere in a route is bad input, not a crash (SH).
    const e = err instanceof TypeError && /primitive value/.test(err.message) ? fail(400, 'bad_input') : err;
    const status = e && e.status && e.status < 600 ? e.status : 500;
    if (status >= 500) {
      // A server error says only "server_error" to the client; what went wrong (often the database's own message, with
      // table and column names) stays in the server log (test run F9, Yousef 2026-10-22). 4xx answers are unchanged.
      console.error('MYFIFTY_ERROR', req.method, req.url, e && (e.stack || e.message), e && e.detail ? 'detail: ' + e.detail : '');
      return send(res, status, { error: 'server_error' });
    }
    send(res, status, { error: (e && e.message) || 'server_error', detail: e && e.detail });
  }
};

const fail = (status, message, detail) => { const e = new Error(message); e.status = status; if (detail) e.detail = detail; return e; };
// Only a string can be an id: anything else (a number, a list, an object such as {"toString":"x"}) is not one.
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// obj[key] only when it is the object's own entry, so names like 'constructor' or '__proto__' never match.
const own = (obj, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
// Text from a request: a string, number or true/false is turned into text; a list or object (e.g. {"toString":"x"},
// which String() cannot even convert) is bad input, a 400 rather than a server error (test run SH / F17, Yousef 2026-10-22).
const asText = (s) => { if (s == null) return ''; const t = typeof s; if (t === 'string') return s; if (t === 'number' || t === 'boolean') return String(s); throw fail(400, 'bad_input'); };
const clean = (s, n) => asText(s).replace(/\r/g, '').trim().slice(0, n || 500);

module.exports = { send, body, query, route, fail, isUuid, clean, own };
