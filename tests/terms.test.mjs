/**
 * Grocery-name translation used before Swedish price search.
 *   node --test tests/terms.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Terms = require('../js/terms.cjs');
const dict = JSON.parse(fs.readFileSync(new URL('../data/i18n/grocery-terms.json', import.meta.url), 'utf8'));

test('dictionary is large enough and indexes cleanly', () => {
  const n = Terms.buildIndex(dict);
  assert.ok(dict.items.length >= 250, 'expected at least 250 grocery entries, got ' + dict.items.length);
  assert.ok(n > dict.items.length, 'aliases should expand the index');
});

test('portuguese, italian and english fold to swedish, accents and plurals included', () => {
  Terms.buildIndex(dict);
  Terms.setCorrections({});
  const cases = [
    ['leite', 'mjölk'],
    ['LEITE', 'mjölk'],
    ['leites', 'mjölk'],
    ['leite integral', 'standardmjölk'],
    ['ovos', 'ägg'],
    ['ovo', 'ägg'],
    ['pão', 'bröd'],
    ['pao', 'bröd'],
    ['arroz', 'ris'],
    ['feijão', 'bönor'],
    ['feijao', 'bönor'],
    ['frango', 'kyckling'],
    ['carne moída', 'köttfärs'],
    ['carne moida', 'köttfärs'],
    ['papel higiênico', 'toalettpapper'],
    ['papel higienico', 'toalettpapper'],
    ['fraldas', 'blöja'],
    ['latte', 'mjölk'],
    ['uova', 'ägg'],
    ['pane', 'bröd'],
    ['pollo', 'kyckling'],
    ['milk', 'mjölk'],
    ['eggs', 'ägg'],
    ['tomatoes', 'tomat'],
  ];
  for (const [input, sv] of cases) {
    const hit = Terms.lookup(input, 'auto');
    assert.ok(hit, 'no hit for ' + input);
    assert.equal(hit.sv, sv, input);
    assert.equal(hit.source, 'dict');
  }
});

test('english setting does not treat italian latte as milk', () => {
  Terms.buildIndex(dict);
  Terms.setCorrections({});
  const auto = Terms.lookup('latte', 'auto');
  const en = Terms.lookup('latte', 'en');
  assert.equal(auto.sv, 'mjölk');
  assert.equal(en, null);
});

test('a saved correction wins over the dictionary', () => {
  Terms.buildIndex(dict);
  Terms.setCorrections({});
  Terms.remember('leite', 'filmjölk');
  const hit = Terms.lookup('leite', 'pt');
  assert.equal(hit.sv, 'filmjölk');
  assert.equal(hit.source, 'user');
});

test('unknown words fall back to the online translator, then cache', async () => {
  Terms.buildIndex(dict);
  Terms.setCorrections({});
  Terms.setOnlineCache({});
  assert.equal(Terms.lookup('xylophone', 'en'), null);
  let calls = 0;
  const fakeFetch = async (url) => {
    calls += 1;
    assert.match(url, /langpair=en\|sv/);
    assert.match(url, /xylophone/);
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: 'xylofon' } }),
    };
  };
  const first = await Terms.translateOnline('xylophone', 'en', fakeFetch);
  assert.equal(first.sv, 'xylofon');
  assert.equal(first.source, 'online');
  const second = await Terms.translateOnline('xylophone', 'en', fakeFetch);
  assert.equal(second.sv, 'xylofon');
  assert.equal(calls, 1, 'the second lookup should use the cache');
});

test('a failed or useless online translation is ignored', async () => {
  Terms.buildIndex(dict);
  Terms.setOnlineCache({});
  const warn = await Terms.translateOnline('qwertyuiop', 'en', async () => ({
    ok: true,
    json: async () => ({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }),
  }));
  assert.equal(warn, null);
  const same = await Terms.translateOnline('qwertyuiop', 'en', async () => ({
    ok: true,
    json: async () => ({ responseData: { translatedText: 'qwertyuiop' } }),
  }));
  assert.equal(same, null);
  const down = await Terms.translateOnline('qwertyuiop', 'en', async () => { throw new Error('offline'); });
  assert.equal(down, null);
});
