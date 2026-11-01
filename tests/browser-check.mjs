/**
 * Loads the real PWA in Chrome: add items, reject a javascript link,
 * then reload with the network off and confirm the list is still there.
 *
 *   node tests/browser-check.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}/`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const page = await browser.newPage();
const dialogs = [];
page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message()); await d.dismiss(); });

try {
  await page.goto(origin, { waitUntil: 'networkidle0' });
  assert.equal(await page.title(), 'Handla');

  await page.type('#newName', 'mjölk');
  await page.$eval('#newQty', el => { el.value = '1'; });
  await page.select('#newUnit', 'l');
  await page.click('#addBtn');

  await page.type('#newName', 'mjölk');
  await page.$eval('#newQty', el => { el.value = '2'; });
  await page.select('#newUnit', 'pcs');
  await page.click('#addBtn');

  await page.type('#newName', 'mjöl');
  await page.$eval('#newQty', el => { el.value = '1'; });
  await page.select('#newUnit', 'kg');
  await page.click('#addBtn');

  await page.type('#newName', 'mjöl');
  await page.$eval('#newQty', el => { el.value = '250'; });
  await page.select('#newUnit', 'g');
  await page.click('#addBtn');

  await page.waitForFunction(() => document.body.innerText.includes('Auto prices'), { timeout: 8000 });
  const lines = await page.$$eval('li.item .row', rows => rows.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  assert.ok(lines.some(t => /mjölk/.test(t) && /offer/.test(t)), 'expected an offer mark on mjölk, got ' + lines.join(' | '));
  assert.ok(lines.some(t => /mjölk/.test(t) && /1 l/.test(t)), 'expected 1 l of mjölk, got ' + lines.join(' | '));
  assert.ok(lines.some(t => /mjölk/.test(t) && /2 pcs/.test(t)), 'expected 2 pcs of mjölk, got ' + lines.join(' | '));
  assert.ok(lines.some(t => /mjöl/.test(t) && /1\.25 kg/.test(t)), 'expected 1.25 kg of mjöl, got ' + lines.join(' | '));

  const shotDir = '/opt/cursor/artifacts/screenshots';
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'units.png') });

  await page.evaluate(() => {
    const st = S.stores.find(s => !s.del);
    st.url = 'javascript:alert(1)';
    st.home = 'javascript:alert(1)';
    st.chain = 'other';
    st.mt = Date.now();
    renderAll();
  });
  const hrefs = await page.$$eval('a', as => as.map(a => a.getAttribute('href') || ''));
  for (const href of hrefs) assert.doesNotMatch(href, /^\s*javascript:/i, href);
  assert.equal(dialogs.length, 0);

  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw';
    const reg = await navigator.serviceWorker.ready;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        reg.update();
      }).catch(() => {});
    }
    return navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'no-controller';
  });
  if (!String(controlled).includes('sw.js')) {
    await page.reload({ waitUntil: 'networkidle0' });
  }
  const scriptURL = await page.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL);
  assert.ok(scriptURL && scriptURL.includes('sw.js'), 'service worker did not take control: ' + scriptURL);

  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.title(), 'Handla');
  const offlineLines = await page.$$eval('li.item .row', rows => rows.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  assert.ok(offlineLines.some(t => /mjölk/.test(t) && /1 l/.test(t)), 'offline reload lost the litre line');
  assert.ok(offlineLines.some(t => /mjölk/.test(t) && /2 pcs/.test(t)), 'offline reload lost the piece line');
  await page.screenshot({ path: path.join(shotDir, 'offline.png') });

  console.log('browser check ok');
  console.log(lines.join('\n'));
} finally {
  await browser.close();
  server.close();
}
