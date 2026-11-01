/* Grocery names: Portuguese, Italian and English -> Swedish.
   The word the user typed stays on the list. `sv` is only for price search.
   Loaded as a classic script (window.Terms) and as a CommonJS module for tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Terms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var index = new Map();
  var swedish = new Set();
  var corrections = {};
  var onlineCache = {};

  function foldKey(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function variants(key) {
    var out = [key];
    if (key.length > 4 && key.endsWith('ies')) out.push(key.slice(0, -3) + 'y');
    if (key.length > 4 && key.endsWith('es')) out.push(key.slice(0, -2));
    if (key.length > 3 && key.endsWith('s') && !key.endsWith('ss')) out.push(key.slice(0, -1));
    return out;
  }

  function addAlias(alias, lang, sv) {
    var key = foldKey(alias);
    if (!key || !sv) return;
    var list = index.get(key);
    if (!list) { list = []; index.set(key, list); }
    list.push({ lang: lang, sv: sv });
    if (lang === 'sv') swedish.add(key);
  }

  function buildIndex(data) {
    index = new Map();
    swedish = new Set();
    var rows = (data && (data.items || data)) || [];
    rows.forEach(function (row) {
      if (!row) return;
      var sv, pt, it, en;
      if (Array.isArray(row)) {
        sv = row[0]; pt = row[1]; it = row[2]; en = row[3];
      } else {
        sv = row.sv;
        pt = row.pt; it = row.it; en = row.en;
      }
      if (!sv) return;
      addAlias(sv, 'sv', sv);
      function each(value, lang) {
        String(value || '').split('|').forEach(function (part) {
          if (part.trim()) addAlias(part, lang, sv);
        });
      }
      if (Array.isArray(pt)) pt.forEach(function (p) { addAlias(p, 'pt', sv); });
      else each(pt, 'pt');
      if (Array.isArray(it)) it.forEach(function (p) { addAlias(p, 'it', sv); });
      else each(it, 'it');
      if (Array.isArray(en)) en.forEach(function (p) { addAlias(p, 'en', sv); });
      else each(en, 'en');
    });
    return index.size;
  }

  function hitsFor(key) {
    var found = [];
    variants(key).forEach(function (variant) {
      var list = index.get(variant);
      if (list) found = found.concat(list);
    });
    return found;
  }

  function choose(hits, lang, phrase) {
    if (!hits.length) return null;
    if (lang && lang !== 'auto') {
      var preferred = hits.filter(function (h) { return h.lang === lang; });
      if (preferred.length) return preferred[0].sv;
      if (swedish.has(foldKey(phrase))) {
        var own = hits.filter(function (h) { return h.lang === 'sv'; });
        if (own.length) return own[0].sv;
      }
      return null;
    }
    var unique = [];
    hits.forEach(function (h) {
      if (unique.indexOf(h.sv) === -1) unique.push(h.sv);
    });
    if (unique.length === 1) return unique[0];
    var order = ['pt', 'it', 'en', 'sv'];
    for (var i = 0; i < order.length; i++) {
      var hit = hits.filter(function (h) { return h.lang === order[i]; })[0];
      if (hit) return hit.sv;
    }
    return hits[0].sv;
  }

  function lookup(phrase, lang) {
    var key = foldKey(phrase);
    if (!key) return null;
    if (corrections[key]) return { sv: corrections[key], source: 'user' };
    var sv = choose(hitsFor(key), lang || 'auto', phrase);
    if (!sv) return null;
    return { sv: sv, source: 'dict' };
  }

  function isSwedish(phrase) {
    return swedish.has(foldKey(phrase));
  }

  function remember(phrase, sv) {
    var key = foldKey(phrase);
    var term = String(sv || '').trim();
    if (!key) return;
    if (!term) delete corrections[key];
    else corrections[key] = term;
  }

  function setCorrections(map) { corrections = map || {}; }
  function getCorrections() { return corrections; }
  function setOnlineCache(map) { onlineCache = map || {}; }
  function getOnlineCache() { return onlineCache; }

  function langPair(lang) {
    if (lang === 'pt' || lang === 'it' || lang === 'en') return lang + '|sv';
    return null;
  }

  function pairsFor(lang) {
    if (lang === 'pt' || lang === 'it' || lang === 'en') return [lang];
    if (lang === 'sv') return [];
    return ['pt', 'it', 'en'];
  }

  async function translateOnline(phrase, lang, fetchFn) {
    var key = foldKey(phrase);
    if (!key) return null;
    if (onlineCache[key]) return { sv: onlineCache[key], source: 'online' };
    var fetchImpl = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) return null;
    var text = String(phrase).trim().slice(0, 80);
    var langs = pairsFor(lang);
    for (var i = 0; i < langs.length; i++) {
      var url = 'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(text) + '&langpair=' + langs[i] + '|sv';
      try {
        var res = await fetchImpl(url);
        if (!res || !res.ok) continue;
        var data = await res.json();
        var translated = data && data.responseData && data.responseData.translatedText;
        if (!translated || /MYMEMORY/i.test(translated)) continue;
        if (foldKey(translated) === key) continue;
        onlineCache[key] = translated.trim();
        return { sv: onlineCache[key], source: 'online' };
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  function loadRows(data) {
    return buildIndex(data);
  }

  return {
    foldKey: foldKey,
    variants: variants,
    buildIndex: buildIndex,
    loadRows: loadRows,
    lookup: lookup,
    isSwedish: isSwedish,
    remember: remember,
    setCorrections: setCorrections,
    getCorrections: getCorrections,
    setOnlineCache: setOnlineCache,
    getOnlineCache: getOnlineCache,
    translateOnline: translateOnline,
    langPair: langPair
  };
});
