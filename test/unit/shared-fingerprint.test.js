// Risk 7 (2026-10-23): the shared rule files (book, lists, time, http) are copied between Pulse (my-fifty/api/_x.js),
// Edge (renellence-edge/api/_edge/x.js) and Compass (compass/api/_compass/x.js). shared-fingerprint.json holds their
// hash, the same in all three repos; this fails when this repo's copy changed without it. Fix: change Pulse's file and
// run renellence-ops/ops/shared/sync.js, which copies it into the other two and updates all three fingerprints.
// Same normalising as sync.js: leading "// Copied from" lines dropped, CRLF read as LF, require('./_x') = require('./x').
//   node --test test/unit/shared-fingerprint.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const NAMES = ['book', 'lists', 'time', 'http'];
const file = (n) => path.join(ROOT, 'api/_' + n + '.js');
const SHARED_RE = /require\('\.\/_?(book|lists|time|http)'\)/g;
function normalise(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length && /^\/\/ Copied from /.test(lines[0])) lines.shift();
  return lines.join('\n').replace(SHARED_RE, "require('./$1')");
}
const hash = (text) => 'sha256:' + crypto.createHash('sha256').update(normalise(text), 'utf8').digest('hex');

test('the shared rule files match shared-fingerprint.json', () => {
  const fp = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared-fingerprint.json'), 'utf8'));
  assert.deepEqual(Object.keys(fp.files).sort(), NAMES.map((n) => n + '.js').sort(), 'shared-fingerprint.json lists the four shared files');
  for (const n of NAMES) {
    assert.equal(hash(fs.readFileSync(file(n), 'utf8')), fp.files[n + '.js'],
      'shared file changed: update all three repos with ops/shared/sync.js (' + path.relative(ROOT, file(n)) + ')');
  }
});

test('the normalising ignores only the header line and the require prefix', () => {
  const body = "const T = require('./time');\nmodule.exports = 1;\n";
  assert.equal(hash('// Copied from x (y)\n' + body.replace('./time', './_time')), hash(body));
  assert.equal(hash(body.replace(/\n/g, '\r\n')), hash(body));
  assert.notEqual(hash(body.replace('1;', '2;')), hash(body));
});
