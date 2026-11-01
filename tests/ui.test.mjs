import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const UI = createRequire(import.meta.url)('../js/ui.cjs');

test('every language has the same screen copy', () => {
  const langs = ['en', 'pt', 'sv', 'it'];
  const keys = Object.keys(UI.en).filter(k => k !== 'steps').sort();
  for (const lang of langs) {
    const got = Object.keys(UI[lang]).filter(k => k !== 'steps').sort();
    assert.deepEqual(got, keys, lang);
    for (const key of keys) assert.equal(typeof UI[lang][key], 'string', lang + ' ' + key);
    for (const chain of Object.keys(UI.en.steps)) {
      assert.ok(Array.isArray(UI[lang].steps[chain]) && UI[lang].steps[chain].length >= 4, lang + ' ' + chain);
    }
  }
});
