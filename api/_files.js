// The files naming rule (Yousef 2026-10-22, the naming review; no new field). Every stored file is named by its id:
//   storage_path  = <parent table>/<parent id>/<file id>.<ext>          e.g. contacts/7f3a…/c91e5b2a-….pdf
//   download name = <original name without ext>_<first 8 of the id>.<ext>   e.g. Business licence_c91e5b2a.pdf
// The download name goes in Content-Disposition. Nothing in either app stores or serves file bytes yet; whatever does
// (uploads, signed PDFs) builds both names here. Shared: my-fifty api/_files.js = renellence-edge api/_edge/files.js.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The parents a files row can hang off (one FK each in files).
const PARENTS = ['contacts', 'interactions', 'orders', 'agreements', 'marketing_requests', 'events', 'expenses'];
const MIME_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'image/gif': 'gif', 'text/plain': 'txt', 'text/csv': 'csv' };

// The extension: from the original name (lower case, letters and digits only), else from the type, else "bin".
function extOf(originalName, mimeType) {
  const m = String(originalName || '').match(/\.([A-Za-z0-9]{1,10})$/);
  if (m) return m[1].toLowerCase();
  return MIME_EXT[String(mimeType || '').toLowerCase()] || 'bin';
}
// The original name without its extension, with no path, quotes or control characters; "file" if nothing is left.
function baseOf(originalName) {
  let s = String(originalName || '').split(/[\\/]/).pop();
  s = s.replace(/\.[A-Za-z0-9]{1,10}$/, '');
  s = s.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || 'file';
}

function fileNames({ table, parentId, fileId, originalName, mimeType }) {
  if (!PARENTS.includes(table)) throw new Error('bad_parent_table');
  if (!UUID.test(String(parentId || '')) || !UUID.test(String(fileId || ''))) throw new Error('bad_id');
  const id = String(fileId).toLowerCase();
  const ext = extOf(originalName, mimeType);
  const downloadName = baseOf(originalName) + '_' + id.slice(0, 8) + '.' + ext;
  const ascii = downloadName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return {
    storagePath: table + '/' + String(parentId).toLowerCase() + '/' + id + '.' + ext,
    downloadName,
    contentDisposition: 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(downloadName),
  };
}

module.exports = { fileNames, extOf, baseOf, PARENTS };
