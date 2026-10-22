// api/_files.js: the files naming rule (Yousef 2026-10-22). Edge has the same file and the same checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../api/_files');

const P = '7f3a1c2e-0000-4000-8000-000000000001';
const ID = 'C91E5B2A-1111-4111-8111-111111111111';

test('storage path is <parent table>/<parent id>/<file id>.<ext>', () => {
  const n = F.fileNames({ table: 'contacts', parentId: P, fileId: ID, originalName: 'Business licence.PDF', mimeType: 'application/pdf' });
  assert.equal(n.storagePath, 'contacts/' + P + '/c91e5b2a-1111-4111-8111-111111111111.pdf');
});
test('download name is <original name without ext>_<first 8 of the id>.<ext>', () => {
  const n = F.fileNames({ table: 'expenses', parentId: P, fileId: ID, originalName: 'Receipt Oct 3.jpg' });
  assert.equal(n.downloadName, 'Receipt Oct 3_c91e5b2a.jpg');
  assert.equal(n.contentDisposition, 'attachment; filename="Receipt Oct 3_c91e5b2a.jpg"; filename*=UTF-8\'\'Receipt%20Oct%203_c91e5b2a.jpg');
});
test('no extension: taken from the type, else bin; no name: "file"', () => {
  assert.equal(F.fileNames({ table: 'orders', parentId: P, fileId: ID, originalName: 'scan', mimeType: 'image/png' }).downloadName, 'scan_c91e5b2a.png');
  assert.equal(F.fileNames({ table: 'orders', parentId: P, fileId: ID, originalName: '' }).downloadName, 'file_c91e5b2a.bin');
});
test('paths, quotes and accents in the original name are made safe', () => {
  const n = F.fileNames({ table: 'agreements', parentId: P, fileId: ID, originalName: 'C:\\docs\\"Zoë" form.pdf' });
  assert.equal(n.downloadName, 'Zoë form_c91e5b2a.pdf');
  assert.match(n.contentDisposition, /filename="Zoe form_c91e5b2a.pdf"; filename\*=UTF-8''Zo%C3%AB%20form_c91e5b2a.pdf/);
});
test('only a files parent table and real ids', () => {
  assert.throws(() => F.fileNames({ table: 'users', parentId: P, fileId: ID, originalName: 'x.pdf' }), /bad_parent_table/);
  assert.throws(() => F.fileNames({ table: 'contacts', parentId: '../x', fileId: ID, originalName: 'x.pdf' }), /bad_id/);
});
