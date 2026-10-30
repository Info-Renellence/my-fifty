// api/hs.js: n8n's "Upload PDF" step sends multipart/form-data (a file part named "file" plus folderPath / options fields).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../api/hs')._;

test('the file part and the plain fields are read from a multipart body', () => {
  const b = 'XyZ123';
  const pdf = Buffer.from('%PDF-1.4 binary \r\n stuff');
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="signed form.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf,
    Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="folderPath"\r\n\r\n/signed-documents\r\n--${b}--\r\n`)]);
  const out = H.multipart(body, 'multipart/form-data; boundary=' + b);
  assert.equal(out.folderPath, '/signed-documents');
  assert.equal(out.__file.filename, 'signed form.pdf');
  assert.equal(out.__file.contentType, 'application/pdf');
  assert.ok(out.__file.data.equals(pdf), 'the bytes, CRLFs inside included');
});
test('only the intake secret opens it', () => {
  process.env.N8N_INTAKE_SECRET = 'k-unit';
  assert.equal(H.authorised({ headers: { 'x-intake-secret': 'k-unit' } }), true);
  assert.equal(H.authorised({ headers: { authorization: 'Bearer k-unit' } }), true);
  assert.equal(H.authorised({ headers: { 'x-intake-secret': 'nope' } }), false);
  delete process.env.N8N_INTAKE_SECRET;
});
