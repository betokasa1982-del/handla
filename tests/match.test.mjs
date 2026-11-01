/**
 * A named product stays specific. Hönö Pågen is not a random loaf,
 * and lactose-free mellanmjölk is not ordinary milk.
 *   node --test tests/match.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function boot(){
  const dom = new JSDOM(html, { url: 'https://example.test/handla/', runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('Hönö Pågen is pinned and a plain loaf is not offered', () => {
  const win = boot();
  try {
    win.eval(`
      AUTO = { stores: [], products: [
        { store: 'willys-2816', name: 'Hönökaka 4-pack', brand: 'Pågen', price: 25.9, size: 450, unit: 'g', compare_price: 57.55, compare_unit: 'kg', url: 'https://example.test/pagen', query: 'hönö' },
        { store: 'willys-2816', name: 'Originalet Hönökaka 5p', brand: 'Åkes Äkta Hönö', price: 28.9, size: 500, unit: 'g', compare_price: 57.8, compare_unit: 'kg', url: 'https://example.test/akes', query: 'hönö' },
        { store: 'willys-2816', name: 'Rågbröd', brand: 'Garant', price: 19.9, size: 320, unit: 'g', compare_price: 62.19, compare_unit: 'kg', url: 'https://example.test/rag', query: 'bröd' }
      ]};
      S.stores = [{ id: 'willys-2816', name: 'Willys', chain: 'willys', del: false }];
    `);
    const levels = win.eval(`suggestions({ name: 'pão Hönö Pågen', sv: 'bröd Hönö Pågen' }, 'willys-2816').map(x => x.p.brand + ' ' + x.p.name + ':' + x.level)`);
    assert.ok(levels.some(x => /Pågen/.test(x) && x.endsWith('exact')), levels.join(','));
    assert.ok(levels.some(x => /Åkes/.test(x) && x.endsWith('equivalent')), levels.join(','));
    assert.ok(!levels.some(x => /Rågbröd/.test(x)), levels.join(','));
    win.eval(`addItem('pão Hönö Pågen', 1, 'pcs')`);
    const chosen = win.eval(`liveItems().slice(-1)[0].chosen['willys-2816']`);
    assert.match(chosen.name, /Hönökaka/);
    assert.equal(chosen.brand, 'Pågen');
    assert.equal(chosen.level, 'exact');
  } finally { win.close(); }
});

test('lactose-free mellanmjölk is remembered for the next leite', () => {
  const win = boot();
  try {
    win.eval(`
      AUTO = { stores: [], products: [
        { store: 'coop-126350', name: 'Laktosfri Mellanmjölk', brand: 'Arla Ko', price: 18.88, size: 1, unit: 'l', compare_price: 18.88, compare_unit: 'l', url: 'https://example.test/arla', query: 'laktosfri mjölk' },
        { store: 'coop-126350', name: 'Mellanmjölk', brand: 'Coop', price: 11.92, size: 1, unit: 'l', compare_price: 11.92, compare_unit: 'l', url: 'https://example.test/plain', query: 'mjölk' },
        { store: 'willys-2816', name: 'Mjölkdryck Laktosfri 1,5%', brand: 'Garant', price: 18.5, size: 1.5, unit: 'l', compare_price: 12.33, compare_unit: 'l', url: 'https://example.test/garant', query: 'laktosfri mjölk' }
      ]};
      S.stores = [
        { id: 'coop-126350', name: 'Coop', chain: 'coop', del: false },
        { id: 'willys-2816', name: 'Willys', chain: 'willys', del: false }
      ];
      addItem('leite sem lactose mellan', 1, 'l');
    `);
    const first = win.eval(`liveItems().slice(-1)[0]`);
    assert.match(first.chosen['coop-126350'].name, /Laktosfri Mellanmjölk/);
    assert.doesNotMatch(first.chosen['coop-126350'].name, /^Mellanmjölk$/);
    assert.match(first.chosen['willys-2816'].name, /Laktosfri 1,5%/);
    win.eval(`addItem('leite', 1, 'l')`);
    const second = win.eval(`liveItems().slice(-1)[0].chosen['coop-126350'].name`);
    assert.match(second, /Laktosfri/);
    assert.doesNotMatch(second, /^Mellanmjölk$/);
  } finally { win.close(); }
});
