/**
 * Reproductions for the three Handla bugs.
 * Loads the real index.html in jsdom and drives the page functions.
 *
 *   node --test tests/bugs.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function boot(beforeParse){
  const dom = new JSDOM(html, {
    url: 'https://example.test/handla/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse
  });
  const win = dom.window;
  const errors = [];
  win.addEventListener('error', (e) => errors.push(e.message || String(e.error)));
  return { dom, win, errors };
}

function evalPage(win, code){
  return win.eval(code);
}

function stateOf(win){
  return JSON.parse(evalPage(win, 'JSON.stringify(S)'));
}

function setState(win, state){
  evalPage(win, 'S = JSON.parse(' + JSON.stringify(JSON.stringify(state)) + '); dirty = false; syncing = false;');
}

function canon(v){
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object'){
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}

function itemsOf(win){
  return JSON.parse(evalPage(win, 'JSON.stringify(liveItems().map(i => ({name:i.name, qty:i.qty, unit:i.unit})))'));
}

function jsonResponse(body){
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('stored data cannot break out of HTML or use a javascript: link', async () => {
  const { win } = boot();
  try { await xssCase(win); } finally { win.close(); }
});

async function xssCase(win){
  win.__xss = 0;
  const breakId = '"><img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">';
  const payload = {
    v: 3,
    items: [{
      id: breakId,
      name: 'Mjölk',
      qty: 1,
      unit: 'l',
      cat: 'dairy',
      done: false,
      prices: { [breakId]: { p: '"><img src=x onerror="window.__xss=1">', s: '1 l' } },
      mt: 9
    }],
    stores: [{
      id: breakId,
      name: 'Evil shop',
      chain: 'other',
      address: 'x',
      url: 'javascript:window.__xss=1',
      home: 'JavaScript:window.__xss=1//',
      online: true,
      mt: 9
    }],
    book: {},
    recent: [{ n: breakId, mt: 9 }]
  };

  win.prompt = () => JSON.stringify(payload);
  win.document.getElementById('importBtn').click();

  const doc = win.document;
  assert.equal(win.__xss, 0, 'imported markup ran a script');
  assert.equal(doc.querySelectorAll('img, svg[onload], [onerror], [onload]').length, 0);
  assert.ok(doc.body.textContent.includes('Mjölk'), 'legitimate item text should survive import');

  const hrefs = [...doc.querySelectorAll('a')].map(a => a.getAttribute('href') || '');
  assert.ok(hrefs.some(h => h.startsWith('https://www.willys.se/sok?q=')), 'shop search links should still be https');
  for (const href of hrefs){
    assert.doesNotMatch(href, /^\s*javascript:/i);
    if (href && href !== '#') assert.match(href, /^https?:\/\//i);
  }

  const stored = stateOf(win);
  for (const st of stored.stores){
    for (const field of ['url', 'home']){
      if (!st[field]) continue;
      assert.match(st[field], /^https?:\/\//i, field+' was stored as a non-http link');
    }
  }

  // The same payload arriving from the shared gist must be inert too.
  win.__xss = 0;
  const gist = {
    v: 3,
    items: [{
      id: '"><img src=x onerror="window.__xss=1">',
      name: 'Bröd',
      qty: 1, unit: 'pcs', cat: 'bakery', done: false, prices: {}, mt: 4
    }],
    stores: [{
      id: 'shop-1', name: 'Sync shop', chain: 'other', address: '',
      url: 'java\tscript:window.__xss=1',
      home: 'data:text/html,<script>window.__xss=1</script>',
      online: true, mt: 4
    }],
    book: JSON.parse('{"__proto__":{"mt":1,"prices":{},"polluted":true},"kaffe":{"mt":2,"prices":{"shop-1":{"p":10}}}}'),
    recent: []
  };
  let pushed = null;
  win.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (!String(url).includes('api.github.com')) return jsonResponse({});
    if (method === 'GET'){
      return jsonResponse({ files: { 'handla.json': { content: JSON.stringify(gist) } } });
    }
    pushed = JSON.parse(JSON.parse(opts.body).files['handla.json'].content);
    return jsonResponse({});
  };
  evalPage(win, 'CFG.token="ghp_test_token_should_stay_local"; CFG.gist="abc"; CFG.on=true; dirty=false; syncing=false;');
  return evalPage(win, 'syncNow(true)').then(() => {
    assert.equal(win.__xss, 0, 'synced markup ran a script');
    assert.equal(doc.querySelectorAll('img, [onerror], [onload]').length, 0);
    assert.equal(Object.prototype.polluted, undefined);
    const after = stateOf(win);
    assert.equal(after.book.polluted, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(after.book, '__proto__'), false);
    assert.equal(after.book.kaffe.prices['shop-1'].p, 10);
    for (const st of after.stores){
      for (const field of ['url', 'home']){
        if (!st[field]) continue;
        assert.match(st[field], /^https?:\/\//i);
      }
    }
    if (pushed){
      const blob = JSON.stringify(pushed);
      assert.doesNotMatch(blob, /javascript:/i);
      assert.doesNotMatch(blob, /data:text\/html/i);
      assert.equal(Object.prototype.polluted, undefined);
    }
    assert.ok(doc.body.textContent.includes('Bröd'));
  });
}

test('two devices with the same list do not re-upload forever', async () => {
  const { win } = boot();
  try { await syncCase(win); } finally { win.close(); }
});

async function syncCase(win){
  const item = (id, name) => ({
    id, name, qty: 1, unit: 'pcs', cat: 'other', done: false, prices: {}, mt: 5
  });
  const stores = [
    { id:'willys-varvader', name:'Willys Vårväderstorget', chain:'willys', address:'A',
      url:'https://www.willys.se/sok?q={q}', home:'https://www.willys.se/butik/2816', online:true, mt:5 },
    { id:'ica-sannegarden', name:'ICA Kvantum Sannegården', chain:'ica', address:'B',
      url:'https://handla.ica.se/sok?q={q}', home:'https://www.ica.se/butiker/x', online:true, mt:5 }
  ];
  const recent = [{ n:'äpple', mt:2 }, { n:'bröd', mt:1 }];
  // Same rows, opposite order — what each phone keeps after a local-first merge.
  let remote = {
    v: 3,
    items: [item('b','bröd'), item('a','äpple')],
    stores: [stores[1], stores[0]],
    book: { 'bröd': { mt:5, prices:{} }, 'äpple': { mt:5, prices:{} } },
    recent
  };
  let localA = {
    v: 3,
    items: [item('a','äpple'), item('b','bröd')],
    stores: stores.map(s => ({ ...s })),
    book: { 'äpple': { mt:5, prices:{} }, 'bröd': { mt:5, prices:{} } },
    recent: recent.map(r => ({ ...r }))
  };
  let localB = JSON.parse(JSON.stringify(remote));

  let uploads = 0;
  win.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (!String(url).includes('api.github.com')) return jsonResponse({});
    if (method === 'GET'){
      return jsonResponse({ files: { 'handla.json': { content: JSON.stringify(remote) } } });
    }
    uploads++;
    remote = JSON.parse(JSON.parse(opts.body).files['handla.json'].content);
    return jsonResponse({});
  };
  evalPage(win, 'CFG.token="t"; CFG.gist="gid"; CFG.on=true;');

  async function round(state){
    setState(win, state);
    await evalPage(win, 'syncNow(true)');
    return stateOf(win);
  }

  for (let i = 0; i < 10; i++){
    localA = await round(localA);
    localB = await round(localB);
  }
  assert.ok(uploads <= 2, 'expected the phones to stop uploading, got '+uploads+' uploads in 10 rounds');
  const settled = uploads;
  for (let i = 0; i < 5; i++){
    localA = await round(localA);
    localB = await round(localB);
  }
  assert.equal(uploads, settled, 'uploads resumed after the list had already converged');
  assert.deepEqual(canon(localA), canon(localB));
  assert.deepEqual(canon(localA), canon(remote));
}

test('quantities merge only when units match or convert', () => {
  const { win } = boot();
  try { unitCase(win); } finally { win.close(); }
});

function unitCase(win){
  const sid = evalPage(win, 'liveStores()[0].id');

  evalPage(win, 'addItem("mjölk", 1, "l")');
  evalPage(win, `
    const it = liveItems().find(i => i.unit === "l");
    it.prices[${JSON.stringify(sid)}] = { p: 12, s: "1 l" };
  `);
  evalPage(win, 'addItem("mjölk", 2, "pcs")');
  evalPage(win, `
    const it = liveItems().find(i => i.name === "mjölk" && i.unit !== "l");
    if (it) it.prices[${JSON.stringify(sid)}] = { p: 8 };
  `);

  const milk = itemsOf(win).filter(i => i.name === 'mjölk');
  assert.deepEqual(milk.map(i => i.unit).sort(), ['l', 'pcs']);
  assert.equal(milk.find(i => i.unit === 'l').qty, 1);
  assert.equal(milk.find(i => i.unit === 'pcs').qty, 2);

  const totals = evalPage(win, `liveItems().filter(i => i.name==="mjölk").map(i => ({
    unit: i.unit, qty: i.qty, total: lineTotal(i, ${JSON.stringify(sid)})
  }))`);
  const byUnit = Object.fromEntries(totals.map(t => [t.unit, t.total]));
  assert.equal(byUnit.l, 12);
  assert.equal(byUnit.pcs, 16);
  const basket = evalPage(win, `storeTotals().find(r => r.store.id === ${JSON.stringify(sid)}).sum`);
  assert.equal(basket, 28);

  evalPage(win, 'addItem("mjöl", 1, "kg"); addItem("mjöl", 250, "g");');
  const flour = itemsOf(win).filter(i => i.name === 'mjöl');
  assert.equal(flour.length, 1);
  assert.equal(flour[0].unit, 'kg');
  assert.equal(flour[0].qty, 1.25);

  evalPage(win, 'addItem("grädde", 1, "l"); addItem("grädde", 200, "ml");');
  const cream = itemsOf(win).find(i => i.name === 'grädde');
  assert.equal(cream.unit, 'l');
  assert.equal(cream.qty, 1.2);
  evalPage(win, `
    liveItems().find(i => i.name==="grädde").prices[${JSON.stringify(sid)}] = { p: 10 };
  `);
  const creamTotal = evalPage(win, `lineTotal(liveItems().find(i => i.name==="grädde"), ${JSON.stringify(sid)})`);
  assert.equal(creamTotal, 12);

  evalPage(win, 'addItem("ägg", 6, "pcs"); addItem("ägg", 1, "pkg"); addItem("ägg", 6, "pcs");');
  const eggs = itemsOf(win).filter(i => i.name === 'ägg');
  assert.equal(eggs.length, 2);
  assert.equal(eggs.find(i => i.unit === 'pcs').qty, 12);
  assert.equal(eggs.find(i => i.unit === 'pkg').qty, 1);

  evalPage(win, 'addItem("banan", 2, "pcs")');
  evalPage(win, `
    const row = [...document.querySelectorAll("li.item")].find(li => li.textContent.includes("banan"));
    row.querySelector("[data-toggle]").click();
  `);
  assert.equal(evalPage(win, 'liveItems().find(i => i.name==="banan").done'), true);
}

test('existing local list is still there after load', () => {
  const saved = {
    v: 3,
    items: [{
      id: 'i-keep', name: 'kaffe', qty: 2, unit: 'pkg', cat: 'pantry', done: false,
      prices: { 'willys-varvader': { p: 45, s: '500 g' } }, mt: 111
    }],
    stores: [{
      id: 'willys-varvader', name: 'Willys Vårväderstorget', chain: 'willys', address: 'Vårväderstorget 2',
      url: 'https://www.willys.se/sok?q={q}', home: 'https://www.willys.se/butik/2816', online: true, mt: 1
    }],
    book: { kaffe: { mt: 111, prices: { 'willys-varvader': { p: 45, s: '500 g' } } } },
    recent: [{ n: 'kaffe', mt: 111 }]
  };
  const { win } = boot((window) => {
    window.localStorage.setItem('handla:v3', JSON.stringify(saved));
  });
  try { keepCase(win); } finally { win.close(); }
});

function keepCase(win){
  const items = itemsOf(win);
  assert.deepEqual(items, [{ name: 'kaffe', qty: 2, unit: 'pkg' }]);
  const price = evalPage(win, 'liveItems()[0].prices["willys-varvader"].p');
  assert.equal(price, 45);
  assert.equal(evalPage(win, 'S.v'), 3);
  assert.match(win.document.body.textContent, /kaffe/);
}

test('a stored javascript link is dropped and the list is kept', () => {
  const saved = {
    v: 3,
    items: [{
      id: 'i-keep', name: 'kaffe', qty: 2, unit: 'pkg', cat: 'pantry', done: false,
      prices: { 'willys-varvader': { p: 45, s: '500 g' } }, mt: 111
    }],
    stores: [{
      id: 'willys-varvader', name: 'Willys Vårväderstorget', chain: 'willys', address: 'Vårväderstorget 2',
      url: 'javascript:alert(1)', home: 'https://www.willys.se/butik/2816', online: true, mt: 1
    }],
    book: { kaffe: { mt: 111, prices: { 'willys-varvader': { p: 45, s: '500 g' } } } },
    recent: [{ n: 'kaffe', mt: 111 }]
  };
  const { win } = boot((window) => {
    window.localStorage.setItem('handla:v3', JSON.stringify(saved));
  });
  try {
    assert.deepEqual(itemsOf(win), [{ name: 'kaffe', qty: 2, unit: 'pkg' }]);
    assert.equal(evalPage(win, 'liveStores()[0].url'), '');
    assert.equal(evalPage(win, 'liveStores()[0].home'), 'https://www.willys.se/butik/2816');
    assert.equal(evalPage(win, 'liveItems()[0].prices["willys-varvader"].p'), 45);
    const hrefs = [...win.document.querySelectorAll('a')].map(a => a.getAttribute('href') || '');
    for (const href of hrefs) assert.doesNotMatch(href, /^\s*javascript:/i);
  } finally { win.close(); }
});

test('shell cache version was bumped with the app', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = 'handla-v5'/);
  assert.match(sw, /\.\/index\.html/);
});
