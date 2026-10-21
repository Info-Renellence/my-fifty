// Postgres (Supabase v2) for every My Fifty route.
//
// The server uses the database's own connection (DATABASE_URL, or POSTGRES_URL from the Vercel Supabase
// integration), which bypasses row-level security. Every route therefore scopes its own queries to the
// signed-in person (api/_auth.js), the same rule the RLS policies apply to direct access.
//
// Writes go through asUser(): one transaction that tells the database who is acting and that it is My
// Fifty, so the change_log trigger records the right person and source (db/001-my-fifty.sql).
const postgres = require('postgres');

let sql = null;
function db() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!url) { const e = new Error('database_not_configured'); e.status = 503; throw e; }
  // Supabase's pooler (port 6543, transaction mode) does not keep prepared statements.
  sql = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
  return sql;
}

// Every query must carry at least one parameter: through Supabase's transaction pooler (port 6543) a query with none
// sometimes never came back when several ran at once (test run 2026-10-21, test/db/testrun-parallel.test.js).

// fn(tx) runs inside one transaction tagged with the acting user.
async function asUser(userId, fn, opts) {
  const o = opts || {};
  return db().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId || ''}, true), set_config('app.source', ${o.source || 'my_fifty'}, true),
                    set_config('app.batch_id', ${o.batchId || ''}, true)`;
    return fn(tx);
  });
}

function setDb(x) { sql = x; }

module.exports = { db, asUser, setDb };
