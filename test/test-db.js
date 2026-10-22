// Tests talk to the TEST database only: Supabase v1 (tkgcinmmqbtdiqbhsgtk), never v2 (Yousef 2026-10-22: v2 now holds
// the real data, and v1 became the test database with v2's exact structure plus the demo and test-run rows).
//
// The address is TEST_DATABASE_URL in .env.test (git-ignored by .env*; ask the owner for it, it is not in Vercel).
// This sets DATABASE_URL to it (api/_db.js reads DATABASE_URL first) and removes the v2 addresses that .env.local
// brings, so nothing in a test process can reach v2. A missing file or a v2 address stops the tests.
'use strict';
const fs = require('fs');
const path = require('path');

const V2_REF = 'ojphplepzuwchjtuycpv';
const FILE = path.join(__dirname, '..', '.env.test');

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function testDbUrl() {
  const url = process.env.TEST_DATABASE_URL || readEnv(FILE).TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set: put the test database (Supabase v1) address in my-fifty/.env.test');
  if (url.includes(V2_REF)) throw new Error('TEST_DATABASE_URL points at Supabase v2 (the real data); tests must use v1');
  return url;
}

function useTestDb() {
  const url = testDbUrl();
  for (const k of ['POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_HOST', 'POSTGRES_PASSWORD']) delete process.env[k];
  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
  return url;
}

module.exports = { useTestDb, testDbUrl, V2_REF };
