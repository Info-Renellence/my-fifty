// HubSpot's API address, answered from v2 (owner 2026-10-30; api/_hsapi.js). n8n's former HubSpot steps call
//   https://my-fifty.vercel.app/api/hs/<the HubSpot path>        e.g. POST /api/hs/crm/v3/objects/contacts/search
// with the intake secret (header X-Intake-Secret, the same n8n credential the Mirror steps used). Optional headers
// X-N8N-Workflow / X-N8N-Node name the step in ingest_events. Errors come back in HubSpot's shape with HubSpot's codes.
'use strict';
const crypto = require('crypto');
const { db } = require('./_db');
const A = require('./_hsapi');

const MAX = 4 * 1024 * 1024;
function authorised(req) {
  const want = String(process.env.N8N_INTAKE_SECRET || '');
  const got = String(req.headers['x-intake-secret'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const a = Buffer.from(got), b = Buffer.from(want);
  return !!want && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function raw(req) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
// multipart/form-data: the "file" part (a signed PDF) and the plain fields.
function multipart(buf, type) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type || '');
  if (!m) return {};
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const out = {};
  let at = buf.indexOf(boundary);
  while (at !== -1) {
    const next = buf.indexOf(boundary, at + boundary.length);
    if (next === -1) break;
    const part = buf.slice(at + boundary.length + 2, next - 2);   // skip CRLF after boundary and before the next
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.slice(0, sep).toString('utf8'), data = part.slice(sep + 4);
      const name = (/name="([^"]*)"/i.exec(head) || [])[1] || '';
      const filename = (/filename="([^"]*)"/i.exec(head) || [])[1];
      const ctype = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1];
      if (filename != null) out.__file = { filename, contentType: ctype ? ctype.trim() : 'application/octet-stream', data };
      else out[name] = data.toString('utf8');
    }
    at = next;
  }
  return out;
}

module.exports = async (req, res) => {
  const reply = (status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  try {
    if (!authorised(req)) return reply(401, { status: 'error', message: 'Authentication credentials not found.', category: 'INVALID_AUTHENTICATION' });
    const url = new URL(req.url, 'http://x');
    const path = url.searchParams.get('p') || url.pathname.replace(/^\/api\/hs\/?/, '');
    url.searchParams.delete('p');
    let body = {};
    if (!['GET', 'DELETE'].includes(req.method)) {
      const buf = await raw(req);
      const type = String(req.headers['content-type'] || '');
      if (/multipart\/form-data/i.test(type)) body = multipart(buf, type);
      else if (buf.length) { try { body = JSON.parse(buf.toString('utf8')); } catch (e) { return reply(400, { status: 'error', message: 'Invalid input JSON', category: 'VALIDATION_ERROR' }); } }
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const ctx = { wf: String(req.headers['x-n8n-workflow'] || ''), node: String(req.headers['x-n8n-node'] || '') };
    const out = await A.handle(db(), req.method, path, url.searchParams, body || {}, ctx);
    return reply(req.method === 'POST' && /\/objects\/\w+\/?$/.test('/' + path) ? 201 : 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('HS_V2API', req.method, req.url, e.message);
    return reply(status, e.hs || { status: 'error', message: status >= 500 ? 'internal error' : e.message, category: 'VALIDATION_ERROR' });
  }
};
module.exports.config = { api: { bodyParser: false } };
module.exports._ = { multipart, authorised };
