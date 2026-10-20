// Secrets at rest (SOP section 7: credentials only in user_connections.credentials, encrypted).
// AES-256-GCM with a key derived from MYFIFTY_SECRET, a server-only environment variable. Changing that variable
// makes every stored Gmail token and push subscription unreadable (people then connect again).
const crypto = require('crypto');

const PREFIX = 'mf1:';
function key(purpose) {
  const base = process.env.MYFIFTY_SECRET || '';
  if (!base) { const e = new Error('secret_not_configured'); e.status = 503; throw e; }
  return crypto.createHash('sha256').update('my-fifty:' + purpose + ':' + base).digest();
}

function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key('seal'), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function open(sealed) {
  const s = String(sealed || '');
  if (!s.startsWith(PREFIX)) return null;
  try {
    const b = Buffer.from(s.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key('seal'), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

// A stable secret for one purpose (VAPID keys, the cron key check).
const derive = (purpose) => crypto.createHmac('sha256', key('derive')).update(purpose).digest();

module.exports = { seal, open, derive };
