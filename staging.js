// Staging banner (data map risk #3, 2026-10-23; renellence-ops/ops/release/STAGING.md). The project pulse-staging sets
// STAGING=1, so /api/data?op=config answers staging: true and this draws a fixed "Staging · test data" strip on every
// screen. Production answers staging: false (or nothing) and this does nothing.
(function () {
  var TEXT = 'Staging · test data';
  function draw() {
    if (document.getElementById('staging-banner')) return;
    var b = document.createElement('div');
    b.id = 'staging-banner';
    b.setAttribute('role', 'status');
    b.textContent = TEXT;
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:calc(env(safe-area-inset-top) + 4px) 12px 4px;'
      + 'background:#B42318;color:#FFFFFF;font:600 13px/18px Inter,system-ui,sans-serif;text-align:center;letter-spacing:0.3px;pointer-events:none';
    document.body.appendChild(b);
    document.title = 'STAGING · ' + String(document.title || '').replace(/^STAGING · /, '');
  }
  try {
    fetch('/api/data?op=config').then(function (r) { return r.json(); }).then(function (cfg) {
      if (cfg && cfg.staging === true) draw();
    }, function () {});
  } catch (e) { /* no banner */ }
})();
