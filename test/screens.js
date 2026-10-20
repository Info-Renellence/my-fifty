// Screenshots every My Fifty screen at phone size from the local test server (test/serve.js), to compare with the
// mockup. The Supabase library is swapped for a stub that is always signed in.
//   node test/screens.js <out-dir> [port] [chrome-path] [puppeteer-path]
const path = require('path');
const fs = require('fs');
const out = process.argv[2];
const port = process.argv[3] || 5178;
const puppeteer = require(process.argv[5] || 'puppeteer-core');
const STUB = `window.supabase = { createClient: function () { return { auth: {
  onAuthStateChange: function () {}, getSession: function () { return Promise.resolve({ data: { session: { access_token: 'dev' } } }); },
  signOut: function () { return Promise.resolve(); }, signInWithOAuth: function () {} } }; } };`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: process.argv[4] || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', (r) => (/supabase-js/.test(r.url()) ? r.respond({ status: 200, contentType: 'text/javascript', body: STUB }) : r.continue()));
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  const base = 'http://localhost:' + port;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function shot(name, full) { await wait(900); await page.screenshot({ path: path.join(out, name + '.png'), fullPage: !!full }); console.log('shot', name); }
  async function click(sel) { await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); else console.error('no element ' + s); }, sel); }

  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await shot('L2-today');
  await shot('L2-today-full', true);
  await click('[data-log]'); await shot('L3-log');
  await click('[data-type]'); await wait(200);
  await page.type('[data-note]', 'Talked about the lips launch.\nNext: send pricing');
  await shot('L3-log-typed');
  await click('[data-close]');
  await page.goto(base + '/people', { waitUntil: 'networkidle0' }); await shot('L6-people');
  await click('[data-pview="cand"]'); await shot('L6-candidates');
  await click('[data-pview="leads"]'); await shot('L6-leads');
  await click('[data-add-person]'); await shot('L13-add');
  await page.goto(base + '/people/leads/social', { waitUntil: 'networkidle0' }); await shot('L22-social');
  await page.goto(base + '/people/leads/cold', { waitUntil: 'networkidle0' }); await shot('L25-cold');
  const ids = await page.evaluate(() => fetch('/api/data?op=search&q=Sample', { headers: { Authorization: 'Bearer dev' } }).then((r) => r.json()));
  const find = (n) => ids.people.find((p) => p.name === n).id;
  await page.goto(base + '/person/' + find('Dr. Maya Sample'), { waitUntil: 'networkidle0' }); await shot('L7-maya');
  await page.goto(base + '/person/' + find('Dr. Sara Sample'), { waitUntil: 'networkidle0' }); await shot('L8-sara');
  await page.goto(base + '/person/' + find('Dr. Maya Sample') + '/history', { waitUntil: 'networkidle0' }); await shot('L14-history'); await shot('L14-history-full', true);
  await page.goto(base + '/person/' + find('Dr. Sara Sample') + '/onboarding', { waitUntil: 'networkidle0' }); await shot('L20-onboarding');
  const card = await page.evaluate((id) => fetch('/api/data?op=person&id=' + id, { headers: { Authorization: 'Bearer dev' } }).then((r) => r.json()), find('Dr. Maya Sample'));
  await page.goto(base + '/orders/' + card.status.id, { waitUntil: 'networkidle0' }); await shot('L19-order');
  const nina = await page.evaluate((id) => fetch('/api/data?op=person&id=' + id, { headers: { Authorization: 'Bearer dev' } }).then((r) => r.json()), find('Nina Sample'));
  await page.goto(base + '/orders/' + nina.status.id, { waitUntil: 'networkidle0' }); await shot('L21-samples');
  await page.goto(base + '/order', { waitUntil: 'networkidle0' }); await shot('L9-who');
  await page.goto(base + '/order/' + find('Dr. Maya Sample'), { waitUntil: 'networkidle0' }); await shot('12-products');
  await click('[data-same]'); await shot('12-products-same');
  await click('a[href$="/review"]'); await wait(600); await shot('L10-review'); await shot('L10-review-full', true);
  await page.goto(base + '/order/' + find('Leo Sample'), { waitUntil: 'networkidle0' });
  await click('[data-okind="samples"]'); await wait(500);
  await page.evaluate(() => { const b = document.querySelectorAll('[data-more]'); b[0].click(); });
  await wait(500); await click('a[href$="/review"]'); await wait(600); await shot('L15-samples-review', true);
  await page.goto(base + '/rewards', { waitUntil: 'networkidle0' }); await shot('L11-rewards');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
