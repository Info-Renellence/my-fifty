// Postgres (Supabase v2) for every My Fifty route.
//
// The server uses the database's own connection (DATABASE_URL, or POSTGRES_URL from the Vercel Supabase
// integration), which bypasses row-level security. Every route therefore scopes its own queries to the
// signed-in person (api/_auth.js), the same rule the RLS policies apply to direct access.
//
// Writes go through asUser(): one transaction that tells the database who is acting and that it is My
// Fifty, so the change_logs trigger records the right person and source (db/001-my-fifty.sql).
const postgres = require('postgres');

const demo = require('./_demo');

let sql = null;
function real() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!url) { const e = new Error('database_not_configured'); e.status = 503; throw e; }
  require('./_staging').refuseV2(url);   // a staging deployment (STAGING=1) never opens v2
  // Supabase's pooler (port 6543, transaction mode) does not keep prepared statements.
  sql = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
  return sql;
}

// db() is v2, except for the test account (api/_demo.js): then it is that request's in-memory database. The choice is
// made on each call, so a db() taken before sign-in still follows the request.
const pick = () => demo.current() || real();
const routed = new Proxy(function () {}, {
  apply: (_t, _this, args) => pick()(...args),
  get: (_t, prop) => {
    const d = pick();
    // In a test-mode transaction a nested begin() becomes a savepoint of it.
    if (prop === 'begin' && d !== sql && typeof d.savepoint === 'function') return d.savepoint.bind(d);
    const v = d[prop];
    return typeof v === 'function' ? v.bind(d) : v;
  },
});
function db() { return routed; }

// Every query must carry at least one parameter: through Supabase's transaction pooler (port 6543) a query with none
// sometimes never came back when several ran at once (test run 2026-10-21, test/db/testrun-parallel.test.js).

// fn(tx) runs inside one transaction tagged with the acting user.
async function asUser(userId, fn, opts) {
  const o = opts || {};
  return db().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId || ''}, true), set_config('app.source', ${o.source || 'my_fifty'}, true),
                    set_config('app.batch_id', ${o.batchId || ''}, true)`;
    return demo.inTx(tx, () => fn(tx));
  });
}

function setDb(x) { sql = x; }

// Sign-in found the test account: the rest of this request uses its in-memory database.
const enterDemo = () => demo.enter({ prepare: false });

module.exports = { db, asUser, setDb, enterDemo };
