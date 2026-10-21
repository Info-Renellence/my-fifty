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
const STUB = `window.supabase = { createClient: function () { return { auth: {
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.value; };
  const go = async (p) => { await send('Page.navigate', { url: BASE + p }); await wait(1600); };
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
      params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: Math.min(h, 6000), scale: 1 } };
    }
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    note('shot ' + name);
  };
  const api = (q) => evaluate(`fetch('/api/data?${q}', { headers: { Authorization: 'Bearer dev' } }).then(function (r) { return r.json(); })`);

  try {
    await go('/');
    if (SCEN === 'alpha') {
      const all = await api('op=search&q=');
      const find = (first) => (all.people.find((p) => p.name.indexOf(first) >= 0) || {}).id;
      await shot('L2-today'); await shot('L2-today-full', true);
      await click('[data-log]'); await shot('L3-log');
      await click('[data-type]'); await type('[data-note]', 'Talked about the lips launch.\nNext: send pricing'); await shot('L3-log-typed');
      await click('[data-save]'); await wait(1500); await shot('L4-logged');
      await click('[data-undo]'); await wait(1200); await shot('L4-undone');
      await go('/people'); await shot('L6-people'); await shot('L6-people-full', true);
      await click('[data-pview="cand"]'); await shot('L6-candidates');
      await click('[data-pview="leads"]'); await shot('L6-leads');
      await click('[data-add-person]'); await shot('L13-add');
      for (const g of ['social', 'event', 'warm', 'cold']) { await go('/people/leads/' + g); await shot('L22-25-' + g); }
      const people = { card: 'Faye', cold: 'Colt', wire: 'Wade', cand: 'Cass', candw: 'Cyd', odd: 'Zo', onb: 'Ona', onbDone: 'Olly', mixed: 'Mix', noname: 'No name', unpaid: 'Una', gmail: 'Gemma', newl: 'Nova' };
      for (const [k, first] of Object.entries(people)) {
        const pid = find(first);
        if (!pid) { note('NOT FOUND ' + first); continue; }
        await go('/person/' + pid); await shot('L7-' + k);
        await go('/person/' + pid + '/history'); await shot('L14-' + k, true);
      }
      await go('/person/' + find('Ona') + '/onboarding'); await shot('L20-onboarding');
      await go('/person/' + find('Olly') + '/onboarding'); await shot('L20-onboarding-done');
      const card = await api('op=person&id=' + find('Faye'));
      if (card.status) { await go('/orders/' + card.status.id); await shot('L19-order-paylink'); }
      const cw = await api('op=person&id=' + find('Cyd'));
      if (cw.status) { await go('/orders/' + cw.status.id); await shot('L21-samples-md'); }
      const wire = await api('op=person&id=' + find('Wade'));
      const h2 = await api('op=history&id=' + find('Wade'));
      const wo = h2.entries.find((e) => e.type === 'order');
      if (wo) { await go('/orders/' + wo.id); await shot('L19-order-wire'); }
      void wire;
      await go('/order'); await shot('L9-who');
      await go('/order/' + find('Faye')); await shot('12-products');
      await click('[data-same]'); await shot('12-products-same');
      await click('a[href$="/review"]'); await wait(700); await shot('L10-review', true);
      await go('/order/' + find('Olly'));
      await click('[data-okind="samples"]'); await click('[data-more]', 0); await click('a[href$="/review"]'); await wait(700); await shot('L15-samples-review', true);
      await go('/rewards'); await shot('L11-rewards');
      await go('/person/00000000-0000-0000-0000-000000000000'); await shot('err-person-not-found');
      await go('/nowhere'); await shot('err-unknown-path');
    } else {
      await shot(SCEN + '-L2-today', true);
      await go('/people'); await shot(SCEN + '-L6-people', true);
      await click('[data-pview="cand"]'); await shot(SCEN + '-L6-candidates', true);
      await click('[data-pview="leads"]'); await shot(SCEN + '-L6-leads');
      await go('/people/leads/social'); await shot(SCEN + '-L22-social', true);
      await go('/order'); await shot(SCEN + '-L9-who', true);
      await go('/rewards'); await shot(SCEN + '-L11-rewards');
    }
  } catch (e) { note('SCRIPT ERROR ' + e.message); }
  note('blocked outside requests: ' + blocked.length + ' (' + [...new Set(blocked.map((u) => new URL(u).host))].join(', ') + ')');
  fs.writeFileSync(path.join(OUT, SCEN + '-log.txt'), log.join('\n') + '\n');
  try { await send('Browser.close'); } catch (e) { /* closing */ }
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
