/* Local shopping assistant: understands short phrases in pt/sv/it/en
   and turns them into tool calls the list can run. No network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Assistant = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function fold(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var NUM = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
    ett: 1, en: 1, tva: 2, tre: 3, fyra: 4, fem: 5,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6
  };

  function numberOf(word) {
    if (!word) return null;
    if (/^\d+(?:[.,]\d+)?$/.test(word)) return Number(word.replace(',', '.'));
    return NUM[fold(word)] == null ? null : NUM[fold(word)];
  }

  function unitOf(word) {
    var w = fold(word || '');
    if (/^(l|lt|litro|litros|liter|litri)$/.test(w)) return 'l';
    if (/^(kg|quilo|quilos|kilo|kilos|chilo|chili)$/.test(w)) return 'kg';
    if (/^(g|gr|grama|gramas|gram|grammi)$/.test(w)) return 'g';
    if (/^(ml|mililitro|mililitros)$/.test(w)) return 'ml';
    if (/^(pkg|pacote|pacotes|pkt|pacco|paket)$/.test(w)) return 'pkg';
    if (/^(pcs|un|unidade|unidades|st|styck|pezzo|pezzi)$/.test(w)) return 'pcs';
    return '';
  }

  function detectLang(text) {
    var t = fold(text);
    if (/\b(tira|tire|leite|pao|ovos|quanto|oferta|lasanha|adiciona|preciso)\b/.test(t)) return 'pt';
    if (/\b(mjolk|agg|brod|ta bort|erbjudande|billigast|kosta)\b/.test(t)) return 'sv';
    if (/\b(latte|uova|pane|togli|offerta|quanto)\b/.test(t) && /\b(di|il|la|per)\b/.test(t)) return 'it';
    if (/\b(milk|eggs|bread|remove|cheapest|offer|spend)\b/.test(t)) return 'en';
    return 'pt';
  }

  function intentOf(text) {
    var t = fold(text);
    if (/\b(tira|tire|remove|retira|retirar|ta bort|togli|delete)\b/.test(t)) return 'remove';
    if (/\b(comprado|comprei|marca|kopte|kopt|bought|comprato)\b/.test(t)) return 'bought';
    if (/mais barato|onde compro|billigast|cheapest|piu economico|where should i buy/.test(t)) return 'plan';
    if (/quanto vou gastar|quanto gasto|how much|vad kostar|quanto spendo|qual o total/.test(t) || /\b(total|gastar)\b/.test(t)) return 'total';
    if (/oferta|promocao|erbjudande| on offer|offerta/.test(t)) return 'offers';
    return 'add';
  }

  var LASANHA = [
    { name: 'massa para lasanha', qty: 1, unit: 'pkg' },
    { name: 'molho de tomate', qty: 1, unit: 'pcs' },
    { name: 'queijo', qty: 1, unit: 'pcs' },
    { name: 'carne moída', qty: 500, unit: 'g' }
  ];

  function splitClauses(text) {
    return String(text || '')
      .split(/\s*,\s*|\s+e\s+|\s+och\s+|\s+and\s+|\s+ed\s+/i)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function stripLead(clause) {
    return clause
      .replace(/^(por favor\s+)?/i, '')
      .replace(/^(acabou|preciso de|preciso|compra|compre|adiciona|adiciona|poe|põe|coloca|aggiungi|lägg till|lagg till|add|buy|i need)\s+/i, '')
      .replace(/^(o|a|os|as|the|some|il|la|i|gli)\s+/i, '')
      .replace(/\b(de domingo|pra domingo|para domingo|this week|essa semana|denna vecka)\b/ig, '')
      .trim();
  }

  function parseClause(clause) {
    var s = stripLead(clause);
    if (!s) return null;
    if (/lasanh|lasagn/.test(fold(s)) && /coisas|stuff|ingredient|para a|pra /.test(fold(s))) return null;
    var parts = s.split(/\s+/);
    var qty = 1;
    var unit = 'pcs';
    var i = 0;
    var n = numberOf(parts[0]);
    if (n != null) {
      qty = n;
      i = 1;
      var u = unitOf(parts[1] || '');
      if (u) { unit = u; i = 2; }
      if (/^(de|of|di)$/i.test(parts[i] || '')) i += 1;
    }
    var name = parts.slice(i).join(' ').replace(/^(de|of|di)\s+/i, '').trim();
    if (!name || /^(coisas|stuff|things)$/i.test(name)) return null;
    return { name: name, qty: qty, unit: unit };
  }

  function itemList(items) {
    return items.map(function (it) {
      return (it.qty && it.qty !== 1 ? String(it.qty).replace('.', ',') + ' ' + it.unit + ' ' : '') + it.name;
    }).join(', ');
  }

  function money(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',');
  }

  function replyFor(lang, kind, payload) {
    var pt = lang !== 'sv' && lang !== 'en' && lang !== 'it';
    if (kind === 'add') {
      if (lang === 'sv') return 'La till ' + itemList(payload) + '.';
      if (lang === 'en') return 'Added ' + itemList(payload) + '.';
      if (lang === 'it') return 'Ho aggiunto ' + itemList(payload) + '.';
      return 'Adicionei ' + itemList(payload) + '.';
    }
    if (kind === 'remove') {
      var names = payload.join(', ');
      if (lang === 'sv') return 'Tog bort ' + names + '.';
      if (lang === 'en') return 'Removed ' + names + '.';
      if (lang === 'it') return 'Ho tolto ' + names + '.';
      return 'Tirei ' + names + '.';
    }
    if (kind === 'bought') {
      if (lang === 'sv') return 'Markerade ' + payload.join(', ') + ' som köpt.';
      if (lang === 'en') return 'Marked ' + payload.join(', ') + ' as bought.';
      if (lang === 'it') return 'Segnato ' + payload.join(', ') + ' come comprato.';
      return 'Marquei ' + payload.join(', ') + ' como comprado.';
    }
    if (kind === 'plan' || kind === 'total') {
      if (!payload) return pt ? 'Ainda não há preços para somar.' : (lang === 'sv' ? 'Inga priser att summera än.' : lang === 'it' ? 'Non ci sono ancora prezzi.' : 'No prices to add up yet.');
      var line = payload.name + ' ' + money(payload.sum) + ' kr';
      if (kind === 'total') {
        if (lang === 'sv') return 'Korgen kostar ' + line + '.';
        if (lang === 'en') return 'The basket is ' + line + '.';
        if (lang === 'it') return 'La spesa è ' + line + '.';
        return 'A cesta fica em ' + line + '.';
      }
      var save = payload.save ? money(payload.save) : '';
      if (lang === 'sv') return save ? line + ', ' + save + ' kr billigare.' : line + '.';
      if (lang === 'en') return save ? line + ', ' + save + ' kr cheaper.' : line + '.';
      if (lang === 'it') return save ? line + ', ' + save + ' kr in meno.' : line + '.';
      return save ? line + ', ' + save + ' kr mais barato.' : line + '.';
    }
    if (kind === 'offers') {
      if (!payload.length) {
        if (lang === 'sv') return 'Ingen erbjudande just nu.';
        if (lang === 'en') return 'No offer on that right now.';
        if (lang === 'it') return 'Nessuna offerta adesso.';
        return 'Não vi oferta nisso agora.';
      }
      var list = payload.map(function (p) { return p.name + ' ' + money(p.price) + ' kr'; }).join(', ');
      if (lang === 'sv') return 'Erbjudande: ' + list + '.';
      if (lang === 'en') return 'On offer: ' + list + '.';
      if (lang === 'it') return 'In offerta: ' + list + '.';
      return 'Oferta: ' + list + '.';
    }
    if (lang === 'sv') return 'Jag förstod inte. Säg till exempel: två liter mjölk.';
    if (lang === 'en') return 'I did not catch that. Try: two litres of milk.';
    if (lang === 'it') return 'Non ho capito. Prova: due litri di latte.';
    return 'Não entendi. Diga por exemplo: dois litros de leite.';
  }

  function call(name, args) {
    return { id: 'c' + Math.random().toString(36).slice(2, 8), type: 'function', function: { name: name, arguments: JSON.stringify(args) } };
  }

  function parseLocal(text) {
    var raw = String(text || '').trim();
    var lang = detectLang(raw);
    var intent = intentOf(raw);
    if (!raw) return { lang: lang, calls: [], reply: replyFor(lang, 'none'), mode: 'local' };
    if (intent === 'plan' || intent === 'total') {
      return { lang: lang, calls: [call('get_cheapest_plan', {})], reply: '', mode: 'local', kind: intent };
    }
    if (intent === 'offers') {
      var q = stripLead(raw.replace(/.*\b(oferta de|oferta|erbjudande på|offer on|offerta di)\s+/i, ''));
      q = q.replace(/[?!.]/g, '').trim();
      return { lang: lang, calls: [call('get_offers', { query: q })], reply: '', mode: 'local', kind: 'offers' };
    }
    if (intent === 'remove' || intent === 'bought') {
      var rest = raw.replace(/^(por favor\s+)?(tira|tire|remove|retira|retirar|ta bort|togli|marca|comprado|comprei|bought|comprato)\s+/i, '');
      rest = rest.replace(/^(os|as|o|a|the|i|gli|le)\s+/i, '');
      var names = splitClauses(rest).map(stripLead).filter(Boolean);
      var tool = intent === 'remove' ? 'remove_items' : 'mark_bought';
      return { lang: lang, calls: [call(tool, { names: names })], reply: replyFor(lang, intent === 'remove' ? 'remove' : 'bought', names), mode: 'local' };
    }
    var items = [];
    splitClauses(raw).forEach(function (clause) {
      if (/lasanh|lasagn/.test(fold(clause))) {
        LASANHA.forEach(function (it) { items.push(Object.assign({}, it)); });
        var also = parseClause(clause.replace(/coisas\s+(pra|para)\s+lasanha.*$/i, '').replace(/lasanha.*$/i, ''));
        if (also) items.unshift(also);
        return;
      }
      var one = parseClause(clause);
      if (one) items.push(one);
    });
    if (!items.length) return { lang: lang, calls: [], reply: replyFor(lang, 'none'), mode: 'local' };
    return { lang: lang, calls: [call('add_items', { items: items })], reply: replyFor(lang, 'add', items), mode: 'local' };
  }

  function argsOf(callObj) {
    var fn = callObj && (callObj.function || callObj);
    var raw = fn.arguments != null ? fn.arguments : callObj.arguments;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return {}; }
    }
    return raw || {};
  }

  function nameOf(callObj) {
    var fn = callObj && (callObj.function || callObj);
    return fn.name || callObj.name;
  }

  function normName(value) {
    return fold(value).replace(/[^a-z0-9\s]/g, '');
  }

  function sameItem(a, b) {
    var x = normName(a), y = normName(b);
    if (!x || !y) return false;
    return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
  }

  function planOf(state) {
    var items = (state.items || []).filter(function (i) { return i && !i.del && !i.done; });
    var rows = (state.stores || []).map(function (st) {
      var sum = 0, n = 0;
      items.forEach(function (it) {
        var chosen = it.chosen && it.chosen[st.id];
        if (chosen && Number(chosen.price) > 0) { sum += Number(chosen.price) * (Number(it.qty) || 1); n += 1; return; }
        var hit = (state.products || []).find(function (p) {
          return p.store === st.id && sameItem(p.name, it.sv || it.name);
        });
        if (hit && Number(hit.price) > 0) { sum += Number(hit.price) * (Number(it.qty) || 1); n += 1; }
      });
      return { id: st.id, name: st.name, sum: Math.round(sum * 100) / 100, priced: n, count: items.length };
    }).filter(function (r) { return r.priced > 0; });
    rows.sort(function (a, b) { return a.sum - b.sum; });
    var best = rows[0] || null;
    var next = rows.filter(function (r) { return best && r.id !== best.id && r.sum > best.sum; })[0] || null;
    return { stores: rows, best: best, save: best && next ? Math.round((next.sum - best.sum) * 100) / 100 : 0 };
  }

  function offersOf(state, query) {
    var q = fold(query || '');
    return (state.products || []).filter(function (p) {
      if (!p || !p.offer) return false;
      if (!q) return true;
      var blob = fold((p.name || '') + ' ' + (p.brand || '') + ' ' + (p.query || ''));
      return blob.indexOf(q) >= 0 || sameItem(p.name, query) || sameItem(p.query || '', query);
    }).slice(0, 6);
  }

  function execute(state, calls) {
    var items = (state.items || []).map(function (it) { return Object.assign({}, it); });
    var chips = [];
    var facts = {};
    (calls || []).forEach(function (c) {
      var name = nameOf(c);
      var args = argsOf(c);
      if (name === 'add_items') {
        (args.items || []).forEach(function (it) {
          var qty = Number(it.qty) > 0 ? Number(it.qty) : 1;
          var unit = it.unit || 'pcs';
          var ex = items.find(function (row) { return !row.del && sameItem(row.name, it.name) && row.unit === unit; });
          if (ex) ex.qty = Math.round((Number(ex.qty) + qty) * 1000) / 1000;
          else items.push({ id: 'a' + items.length + '-' + fold(it.name).slice(0, 8), name: it.name, qty: qty, unit: unit, done: false, del: false });
          chips.push({ op: 'add', name: it.name, qty: qty, unit: unit });
        });
      } else if (name === 'remove_items') {
        (args.names || []).forEach(function (n) {
          items.forEach(function (row) {
            if (!row.del && sameItem(row.name, n)) { row.del = true; chips.push({ op: 'remove', name: row.name }); }
          });
        });
      } else if (name === 'mark_bought') {
        (args.names || []).forEach(function (n) {
          items.forEach(function (row) {
            if (!row.del && sameItem(row.name, n)) { row.done = true; chips.push({ op: 'bought', name: row.name }); }
          });
        });
      } else if (name === 'get_cheapest_plan') {
        facts.plan = planOf({ items: items, stores: state.stores, products: state.products });
      } else if (name === 'get_offers') {
        facts.offers = offersOf(state, args.query || '');
      } else if (name === 'search_products') {
        var q = fold(args.query || '');
        facts.products = (state.products || []).filter(function (p) {
          return fold((p.name || '') + ' ' + (p.brand || '')).indexOf(q) >= 0;
        }).slice(0, 8);
      }
    });
    return { items: items, chips: chips, facts: facts };
  }

  function describe(lang, calls, result) {
    var kind = 'none';
    (calls || []).forEach(function (c) {
      var name = nameOf(c);
      if (name === 'add_items') kind = 'add';
      else if (name === 'remove_items') kind = 'remove';
      else if (name === 'mark_bought') kind = 'bought';
      else if (name === 'get_offers') kind = 'offers';
      else if (name === 'get_cheapest_plan') kind = kind === 'total' ? 'total' : 'plan';
    });
    if (kind === 'add') {
      var added = [];
      (calls || []).forEach(function (c) {
        if (nameOf(c) !== 'add_items') return;
        (argsOf(c).items || []).forEach(function (it) { added.push(it); });
      });
      return replyFor(lang, 'add', added);
    }
    if (kind === 'remove' || kind === 'bought') {
      var names = [];
      (calls || []).forEach(function (c) { (argsOf(c).names || []).forEach(function (n) { names.push(n); }); });
      return replyFor(lang, kind, names);
    }
    if (kind === 'offers') return replyFor(lang, 'offers', (result && result.facts && result.facts.offers) || []);
    if (kind === 'plan' || kind === 'total') {
      var plan = result && result.facts && result.facts.plan;
      var best = plan && plan.best ? { name: plan.best.name, sum: plan.best.sum, save: plan.save } : null;
      return replyFor(lang, kind, best);
    }
    return replyFor(lang, 'none');
  }

  var TOOLS = [
    { type: 'function', function: { name: 'add_items', description: 'Add grocery items to the list.', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' } }, required: ['name'] } } }, required: ['items'] } } },
    { type: 'function', function: { name: 'remove_items', description: 'Remove items from the list.', parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } } },
    { type: 'function', function: { name: 'mark_bought', description: 'Mark items as bought.', parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } } },
    { type: 'function', function: { name: 'get_cheapest_plan', description: 'Totals per store, cheapest shop and savings.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'get_offers', description: 'Current offers, optionally filtered by a product.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
    { type: 'function', function: { name: 'search_products', description: 'Find products in the saved shop prices.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }
  ];

  async function resolveWithModel(complete, state, text) {
    var messages = [{ role: 'user', content: String(text || '') }];
    var made = [];
    var lang = detectLang(text);
    for (var i = 0; i < 3; i++) {
      var message = await complete(messages.slice());
      if (!message) break;
      messages.push(message);
      var tools = message.tool_calls || [];
      if (!tools.length) {
        return { lang: lang, calls: made, reply: message.content || '', mode: 'ai' };
      }
      tools.forEach(function (c) { made.push(c); });
      var result = execute(state, tools);
      state = { items: result.items, stores: state.stores, products: state.products };
      tools.forEach(function (c) {
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result.facts && Object.keys(result.facts).length ? result.facts : { chips: result.chips }) });
      });
    }
    var last = execute(state, []);
    return { lang: lang, calls: made, reply: describe(lang, made, last), mode: 'ai' };
  }

  return {
    fold: fold,
    detectLang: detectLang,
    parseLocal: parseLocal,
    execute: execute,
    describe: describe,
    planOf: planOf,
    TOOLS: TOOLS,
    resolveWithModel: resolveWithModel,
    argsOf: argsOf,
    nameOf: nameOf
  };
});
