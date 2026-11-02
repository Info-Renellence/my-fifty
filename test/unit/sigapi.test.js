// api/_sigapi.js pure parts and the signed-PDF step with a fake transaction and fake fetch (full audit 2026-11-02).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SIG = require('../../api/_sigapi');
const M = require('../../api/_hsmap');

test('signer status: awaiting (not emailed yet) is not_sent; completed signed; sent sent; a cancelled envelope not_sent', () => {
  const e = { status: 'in_progress' };
  assert.equal(SIG._.signerStatus({ status: 'awaiting' }, e), 'not_sent');
  assert.equal(SIG._.signerStatus({ status: 'completed' }, e), 'signed');
  assert.equal(SIG._.signerStatus({ status: 'sent' }, e), 'sent');
  assert.equal(SIG._.signerStatus({ status: 'sent' }, { status: 'canceled' }), 'not_sent');
});

test('a completed envelope\'s signed PDF goes to Storage under agreements/<id>/ and onto the agreement; skipped without storage or a PDF', async () => {
  const aid = '11111111-2222-4333-8444-555555555555';
  const e = { id: 'env-pdf', title: 'Renellence Customer Onboarding Form', deliverable: { status: 'generated', url: 'https://vault.example/sealed.pdf?response-content-disposition=attachment%3B+filename%3DRenellence%2520Form.pdf&x=1' } };
  const queries = [];
  const tx = (strings, ...vals) => { const q = strings.join('?'); queries.push([q, vals]); return Promise.resolve(/select signed_file_id/.test(q) ? [{ signed_file_id: null }] : []); };
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, o) => { calls.push([String(url), o && o.method]); return /vault/.test(String(url)) ? { ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.7 x') } : { ok: true, json: async () => ({}) }; };
  try {
    delete process.env.SUPABASE_URL;
    assert.equal(await SIG.keepSignedPdf(tx, aid, e), false, 'no storage set up: skipped');
    process.env.SUPABASE_URL = 'https://v2.example'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    assert.equal(await SIG.keepSignedPdf(tx, aid, e), true);
    const fid = M.uid('signedpdf:env-pdf');
    assert.equal(calls[1][0], 'https://v2.example/storage/v1/object/files/agreements/' + aid + '/' + fid + '.pdf');
    const ins = queries.find((q) => /insert into files/.test(q[0]));
    assert.equal(ins[1][2], 'Renellence Form.pdf');
    assert.ok(queries.some((q) => /update agreements set signed_file_id/.test(q[0])));
    assert.equal(await SIG.keepSignedPdf(tx, aid, { id: 'x', deliverable: { status: 'pending' } }), false, 'not generated yet');
  } finally { global.fetch = real; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});
