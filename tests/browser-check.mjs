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
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/handla') rel = '/handla/';
  if (rel.startsWith('/handla/')) rel = rel.slice('/handla'.length);
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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const dialogs = [];
page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message()); await d.dismiss(); });

try {
  // GitHub Pages serves the repo at /handla/, so the app must use relative data URLs.
  await page.goto(origin + 'handla/', { waitUntil: 'networkidle0' });
  assert.equal(await page.title(), 'Handla');
  assert.equal(new URL(page.url()).pathname, '/handla/');

  await page.waitForSelector('#onboard:not([hidden])');
  await page.click('#onboard [data-uilang="pt"]');
  await page.waitForFunction(() => document.body.innerText.includes('Onde você compra?'));
  await page.type('#onboardQuery', 'Kortedala');
  await page.click('#onboardSearch');
  await page.waitForFunction(() => document.getElementById('onboardResults').innerText.includes('Hemköp'));
  await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/after-onboard.png' });
  await page.click('#onboardDone');
  await page.waitForSelector('#onboard[hidden]');

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

  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll('li.item')].find(li => /mjölk/.test(li.innerText));
    return row && row.querySelector('.best') && /\d/.test(row.querySelector('.best').innerText);
  }, { timeout: 8000 });
  const lines = await page.$$eval('li.item .row', rows => rows.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  assert.ok(lines.some(t => /mjölk/.test(t) && /oferta|offer|erbjudande|offerta/.test(t)), 'expected an offer mark on mjölk, got ' + lines.join(' | '));
  assert.ok(lines.some(t => /mjölk/.test(t) && /1 l/.test(t)), 'expected 1 l of mjölk, got ' + lines.join(' | '));
  assert.ok(lines.some(t => /mjölk/.test(t) && /2 pcs/.test(t)), 'expected 2 pcs of mjölk, got ' + lines.join(' | '));
  assert.ok(lines.some(t => /mjöl/.test(t) && /1\.25 kg/.test(t)), 'expected 1.25 kg of mjöl, got ' + lines.join(' | '));

  const shotDir = '/opt/cursor/artifacts/screenshots';
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'after-list.png') });
  const gap = await page.$eval('#storeGaps', el => el.innerText);
  assert.match(gap, /X:-Tra/);
  await page.click('#tab-compare');
  await page.waitForFunction(() => /\d+,\d+/.test(document.getElementById('verdict').innerText));
  await page.screenshot({ path: path.join(shotDir, 'after-shop.png') });
  await page.click('#tab-list');
  await page.evaluate(() => { applyTheme('dark'); });
  await page.screenshot({ path: path.join(shotDir, 'after-dark.png') });
  await page.evaluate(() => { applyTheme('light'); });

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

  await page.waitForFunction(() => window.Terms && Terms.lookup('leite', 'pt'), { timeout: 8000 });
  await page.type('#newName', 'leite');
  await page.select('#newUnit', 'l');
  await page.click('#addBtn');
  const leiteSv = await page.evaluate(() => {
    const row = [...document.querySelectorAll('li.item')].find(li => li.innerText.includes('leite'));
    return row && row.querySelector('input.svterm').value;
  });
  assert.equal(leiteSv, 'mjölk');

  await page.evaluate(() => document.getElementById('tab-setup').click());
  const setupState = await page.evaluate(() => ({
    hidden: document.getElementById('view-setup').hidden,
    lang: document.documentElement.lang,
    area: document.querySelector('[data-i18n="areaTitle"]') && document.querySelector('[data-i18n="areaTitle"]').textContent,
    ui: typeof UI,
  }));
  await page.evaluate(() => document.querySelector('#appLangs [data-uilang="en"]').click());
  const afterLang = await page.evaluate(() => document.querySelector('[data-i18n="areaTitle"]').textContent);
  if (afterLang !== 'Your area') {
    throw new Error('language switch failed ' + JSON.stringify(setupState) + ' after=' + afterLang);
  }
  await page.type('#areaQuery', 'Kortedala');
  await page.click('#areaSearch');
  await page.waitForFunction(() => {
    const box = document.getElementById('areaResults');
    return box && box.innerText.includes('Kortedala');
  }, { timeout: 8000 });
  const areaText = await page.$eval('#areaResults', el => el.innerText);
  assert.ok(/Hemköp/.test(areaText), areaText);
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('#areaResults label')].find(el => el.textContent.includes('Hemköp'));
    label.querySelector('input').click();
  });
  await page.click('#tab-list');
  await page.waitForFunction(() => document.body.innerText.includes('Hemköp'), { timeout: 8000 });

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
