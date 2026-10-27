// Test run 2026-10-21: every screen at phone size (390 x 844) in headless Chrome, driven over the DevTools protocol
// with Node's own WebSocket (puppeteer is not installed). Nothing leaves the computer: every request that is not to
// localhost is refused inside Chrome (and the host resolver maps every other name to nothing); the Supabase library is
// answered with a stub that is always signed in; Google Fonts are refused (system font is used instead).
//   node test/run/cdp-screens.js <out-dir> <port> <scenario>      scenario: alpha | empty | load | admin
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const OUT = process.argv[2];
const PORT = Number(process.argv[3] || 5201);
const SCEN = process.argv[4] || 'alpha';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DBG = 9300 + (PORT % 100);
const BASE = 'http://localhost:' + PORT;
const SIGNED_OUT = process.argv[4] === 'signedout';
const STUB = SIGNED_OUT ? `window.supabase = { createClient: function () { return { auth: { onAuthStateChange: function () {}, getSession: function () { return Promise.resolve({ data: { session: null } }); }, signOut: function () { return Promise.resolve(); }, signInWithOAuth: function () { window.__oauth = true; return Promise.resolve({}); } } }; } };` : `window.supabase = { createClient: function () { return { auth: {
  onAuthStateChange: function () {}, getSession: function () { return Promise.resolve({ data: { session: { access_token: 'dev' } } }); },
  signOut: function () { return Promise.resolve(); }, signInWithOAuth: function () {} } }; } };`;
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const note = (s) => { log.push(s); console.log(s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prof = path.join(OUT, '.profile');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=OptimizationHints,MediaRouter,Translate',
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 40 && !ws; i++) {
    await wait(250);
    try {
      const list = await new Promise((res, rej) => http.get('http://127.0.0.1:' + DBG + '/json/list', (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
      const pg = list.find((t) => t.type === 'page');
      if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl);
    } catch (e) { /* not up yet */ }
  }
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
  const blocked = [];
  ws.addEventListener('message', async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); return m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    if (m.method === 'Fetch.requestPaused') {
      const u = m.params.request.url;
      if (/supabase-js/.test(u)) return send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(STUB).toString('base64') });
      if (SCEN === 'navrace' && /op=person&/.test(u)) { await wait(1500); return send('Fetch.continueRequest', { requestId: m.params.requestId }); }
      if (SCEN === 'searchrace' && /op=search&q=Fa/.test(u)) { await wait(1500); return send('Fetch.continueRequest', { requestId: m.params.requestId }); }
      if (/^https?:\/\/localhost(:\d+)?\//.test(u)) return send('Fetch.continueRequest', { requestId: m.params.requestId });
      blocked.push(u);
      return send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' });
    }
    if (m.method === 'Runtime.exceptionThrown') note('PAGE ERROR ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') note('CONSOLE ' + m.params.args.map((a) => a.value || a.description).join(' ').slice(0, 300));
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.WIDTH || 390), height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.value; };
  // The L5 "joined your Fifty" moment opens over any screen until it is dismissed; the screen pass dismisses it (it is shot once on its own).
  const go = async (p) => { await send('Page.navigate', { url: BASE + p }); await wait(1600); if (SCEN !== 'joined') await evaluate("(function(){ var k = document.querySelector('[data-keep]'); if (k) k.click(); })()"); await wait(200); };
  const click = async (sel, i) => { const okk = await evaluate(`(function(){ var els = document.querySelectorAll(${JSON.stringify(sel)}); var el = els[${i || 0}]; if (!el) return false; el.click(); return true; })()`); if (!okk) note('NO ELEMENT ' + sel); await wait(700); return okk; };
  const type = async (sel, text) => { await evaluate(`(function(){ var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return; el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(300); };
  // A screen is checked for: horizontal overflow (wider than the phone), text that leaked raw HTML, "undefined"/"NaN"/"null" shown.
  const check = async (name) => {
    const r = await evaluate(`(function(){
      var t = document.body.innerText || '';
      var wide = document.documentElement.scrollWidth > window.innerWidth + 1;
      var bad = (t.match(/\\b(undefined|NaN|null|\\[object Object\\])\\b/g) || []);
      var raw = /<script|<\\/b>|&lt;|&amp;amp;/.test(t) ? 'raw markup visible' : '';
      var injected = document.querySelectorAll('#app script, #sheet script, #app b').length;
      var over = Array.from(document.querySelectorAll('#app *')).filter(function (e) { var b = e.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 2; }).slice(0, 3).map(function (e) { return e.tagName + ':' + (e.innerText || '').slice(0, 30); });
      return { wide: wide, bad: bad, raw: raw, injected: injected, over: over, text: t.slice(0, 160) };
    })()`);
    if (r.wide || r.bad.length || r.injected || r.over.length) note('CHECK ' + name + ' ' + JSON.stringify(r));
    return r;
  };
  const shot = async (name, full) => {
    await wait(300);
    await check(name);
    let params = { format: 'png' };
    if (full) {
      const h = await evaluate('document.documentElement.scrollHeight');
      params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Number(process.env.WIDTH || 390), height: Math.min(h, 6000), scale: 1 } };
    }
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    note('shot ' + name);
  };
  const api = (q) => evaluate(`fetch('/api/data?${q}', { headers: { Authorization: 'Bearer dev' } }).then(function (r) { return r.json(); })`);

  const toast = () => evaluate("document.getElementById('toast').textContent");
  const txt = () => evaluate("(document.getElementById('app').innerText||'')");
  const sheetTxt = () => evaluate("(document.getElementById('sheet').innerText||'')");
  const path_ = () => evaluate('location.pathname');
  const oneLine = (s) => String(s || '').replace(/\n/g, ' | ');
  try {
    await go('/');
    if (SCEN === 'new') {
      const all = await api('op=search&q=');
      const find = (first) => (all.people.find((p) => p.name.indexOf(first) >= 0) || {}).id;
      // 1. Today My Fifty tile -> /people/fifty
      await shot('n1-today');
      await click('a.tile.blue'); note('NEW1 tile -> ' + await path_() + ' fifty tab on: ' + await evaluate("!!document.querySelector('[data-pview=\"fifty\"].on, [data-pview=\"fifty\"][aria-selected=\"true\"]')"));
      await shot('n1-fifty');
      await go('/people/fifty'); note('NEW1b direct /people/fifty -> ' + await path_() + ' text: ' + oneLine((await txt()).slice(0, 60)));
      // 2. the + on product rows
      await go('/order/' + find('Faye')); await shot('n2-products');
      note('NEW2 row html: ' + (await evaluate("document.querySelector('.prow').outerHTML")).slice(0, 700));
      await click('[data-prow]', 0); note('NEW2 sheet: ' + oneLine((await sheetTxt()).slice(0, 140))); await shot('n2-sheet');
      await click('#sheet [data-psave]'); await shot('n2-added');
      note('NEW2 bar: ' + oneLine(await evaluate("(document.querySelector('.orderbar')||{}).innerText")));
      // 3. saypha price options
      const say = await evaluate("(function(){ var rows = Array.from(document.querySelectorAll('[data-prow]')); var r = rows.filter(function(x){ return /saypha/i.test(x.innerText); })[0]; return r ? r.getAttribute('data-prow') : null; })()");
      note('NEW3 saypha row ' + say);
      if (say) {
        await click('[data-prow="' + say + '"]'); await click('#sheet [data-op="price"]');
        note('NEW3 options: ' + (await evaluate("Array.from(document.querySelectorAll('#sheet .popt')).map(function(b){return b.innerText.replace(/\\n/g,' ')}).join(' | ')"))); await shot('n3-price');
        await click('#sheet [data-opt="135"]'); note('NEW3 after 135: ' + oneLine((await sheetTxt()).slice(0, 160)));
        await click('#sheet [data-op="price"]'); await click('#sheet [data-opt="155"]'); note('NEW3 after 155: ' + oneLine((await sheetTxt()).slice(0, 160)));
        await click('#sheet [data-op="price"]'); await click('#sheet [data-opt="custom"]'); note('NEW3 custom shown: ' + await evaluate("!!document.querySelector('#sheet [data-custom]')")); await shot('n3-custom');
        await type('#sheet [data-custom]', '147.50'); await evaluate("document.querySelector('#sheet [data-custom]').dispatchEvent(new Event('change',{bubbles:true}))"); await wait(300);
        note('NEW3 custom 147.50: ' + oneLine((await sheetTxt()).slice(0, 200)));
        await click('#sheet [data-psave]'); note('NEW3 bar: ' + oneLine(await evaluate("(document.querySelector('.orderbar')||{}).innerText")));
      }
      // 4. Review -> Edit in place
      await click('a[href$="/review"]'); await wait(800); await shot('n4-review', true);
      note('NEW4 review: ' + oneLine((await txt()).slice(0, 400)));
      await click('[data-items-edit]'); await shot('n4-edit', true);
      note('NEW4 edit label: ' + await evaluate("document.querySelector('[data-items-edit]').innerText") + ' rows ' + await evaluate("document.querySelectorAll('[data-item-row]').length"));
      await click('[data-item-row]', 0); note('NEW4 line sheet: ' + oneLine((await sheetTxt()).slice(0, 140))); await shot('n4-line-sheet');
      await click('#sheet [data-op="q"]'); await click('#sheet [data-opt="3"]'); await click('#sheet [data-psave]');
      note('NEW4 after qty 3, path ' + await path_() + ' edit label: ' + await evaluate("document.querySelector('[data-items-edit]').innerText"));
      await click('[data-item-add]'); await shot('n4-add-sheet'); note('NEW4 add sheet: ' + oneLine((await sheetTxt()).slice(0, 200)));
      await click('#sheet [data-addrow]', 1); note('NEW4 picked sheet: ' + oneLine((await sheetTxt()).slice(0, 120))); await click('#sheet [data-psave]');
      note('NEW4 after add: ' + oneLine((await txt()).slice(0, 500)));
      await click('[data-items-edit]'); note('NEW4 Done -> label ' + await evaluate("document.querySelector('[data-items-edit]').innerText") + ' rows ' + await evaluate("document.querySelectorAll('[data-item-row]').length"));
      await click('[data-items-edit]');
      for (let i = 0; i < 6; i++) {
        const n = await evaluate("document.querySelectorAll('[data-item-row]').length"); if (!n) break;
        await click('[data-item-row]', 0); const had = await evaluate("!!document.querySelector('#sheet [data-premove]')"); if (!had) { note('NEW4 no Remove button in sheet'); await click('#sheet [data-close]', 0); break; }
        await click('#sheet [data-premove]'); await wait(500);
      }
      note('NEW4 after removing all lines -> ' + await path_());
      // 5. initials -> sign out
      await go('/'); await click('[data-me]'); note('NEW5 sheet: ' + oneLine(await sheetTxt())); await shot('n5-me');
      await click('#sheet [data-close]', 1); note('NEW5 cancel closed: ' + !(await sheetTxt()).trim());
      await click('[data-me]'); await click('#sheet [data-signout]'); await wait(1000); note('NEW5 after signout path ' + await path_() + ' text ' + oneLine((await txt()).slice(0, 80))); await shot('n5-signedout');
    }
    else if (SCEN === 'custom0') {
      const all = await api('op=search&q=');
      const faye = all.people.find((p) => p.name.indexOf('Faye') >= 0).id;
      await go('/order/' + faye); await click('[data-prow="SAF100"]'); await click('#sheet [data-op="price"]'); await click('#sheet [data-opt="custom"]');
      await type('#sheet [data-custom]', ''); await click('#sheet [data-psave]'); note('CUSTOM0 toast: ' + await toast() + ' | sheet still open: ' + !!(await sheetTxt()).trim());
      await type('#sheet [data-custom]', '147.50'); await click('#sheet [data-psave]'); note('CUSTOM0 bar: ' + oneLine(await evaluate("(document.querySelector('.orderbar')||{}).innerText")));
    }
    else if (SCEN === 'flow4') {
      const all = await api('op=search&q=');
      const find = (first) => (all.people.find((p) => p.name.indexOf(first) >= 0) || {}).id;
      const today = () => api('op=today').then((d) => d.day.done + '/' + d.day.goal);
      note('FLOW4 start count ' + await today());
      // log a visit, reached, with a typed note and a Next: line
      await go('/person/' + find('Wren')); await shot('f4-card');
      await click('[data-log][data-kind="visit"]'); await shot('f4-log-open');
      await click('#sheet [data-ans="yes"]'); await click('#sheet [data-notebox]'); await type('#sheet [data-note]', 'Run 4 probe visit.\nNext: send pricing');
      await shot('f4-log-typed'); await click('#sheet [data-save]'); await wait(1500);
      note('FLOW4 after visit: toast=' + await toast() + ' | count ' + await today() + ' | path ' + await path_()); await shot('f4-logged');
      note('FLOW4 undo button present: ' + await evaluate("!!document.querySelector('[data-undo]')"));
      if (await evaluate("!!document.querySelector('[data-undo]')")) { await click('[data-undo]'); await wait(1200); note('FLOW4 undo toast=' + await toast() + ' | count ' + await today()); }
      // a text and a not-reached call
      await go('/person/' + find('Wren')); await click('[data-log][data-kind="text"]'); note('FLOW4 text sheet: ' + oneLine((await sheetTxt()).slice(0, 100)));
      await click('#sheet [data-ans="yes"]'); await click('#sheet [data-notebox]'); await type('#sheet [data-note]', 'Texted about the lips launch.'); await click('#sheet [data-save]'); await wait(1500);
      note('FLOW4 after text: count ' + await today() + ' toast=' + await toast());
      // an empty / one-character note must not save
      await go('/person/' + find('Wren')); await click('[data-log][data-kind="visit"]'); await click('#sheet [data-ans="no"]'); await click('#sheet [data-notebox]'); await type('#sheet [data-note]', 'x');
      await click('#sheet [data-save]'); note('FLOW4 one-char note: sheet still open ' + !!(await sheetTxt()).trim());
      await click('#sheet [data-close]', 0);
      // history
      await go('/person/' + find('Wren') + '/history'); await shot('f4-history', true);
      // Order for a card-on-file person, wire person, and a sample order
      await go('/order/' + find('Faye')); await click('[data-prow="SAF100"]'); await click('#sheet [data-psave]'); await click('a[href$="/review"]'); await wait(800);
      await click('[data-send-order]'); await wait(2500); note('FLOW4 order sent: toast=' + await toast() + ' | path ' + await path_()); await shot('f4-order-sent');
      const oid = (await path_()); await click('a[href^="/orders/"]'); await wait(1200); note('FLOW4 status path ' + await path_()); await shot('f4-order-status', true);
      note('FLOW4 order screen: ' + oneLine((await txt()).slice(0, 400)));
    }
    else if (SCEN === 'me') {
      await wait(800); note('ME initials: ' + await evaluate("(document.querySelector('[data-me]')||{}).innerText") + ' aria: ' + await evaluate("(document.querySelector('[data-me]')||{}).getAttribute('aria-label')"));
      await click('[data-me]'); note('ME sheet: ' + oneLine(await sheetTxt())); await shot('me-sheet');
      await click('#sheet [data-close]', 1); note('ME cancel closes: ' + !(await sheetTxt()).trim());
      await click('[data-me]'); await click('.dim[data-close]'); note('ME dim tap closes: ' + !(await sheetTxt()).trim());
      await click('[data-me]'); await evaluate("(function(){ var b=document.querySelector('#sheet [data-signout]'); b.click(); b.click(); })()"); await wait(1200);
      note('ME after double sign out: ' + oneLine((await txt()).slice(0, 60)) + ' errors above? none expected');
    }
  } catch (e) { note('SCRIPT ERROR ' + e.message); }
  note('blocked outside requests: ' + blocked.length + ' (' + [...new Set(blocked.map((u) => new URL(u).host))].join(', ') + ')');
  fs.writeFileSync(path.join(OUT, SCEN + '-log.txt'), log.join('\n') + '\n');
  try { await send('Browser.close'); } catch (e) { /* closing */ }
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
