/**
 * Local assistant phrases and tool calls, including a mocked model.
 *   node --test tests/assistant.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import worker from '../server/src/index.js';

const require = createRequire(import.meta.url);
const Assistant = require('../js/assistant.cjs');

function args(plan, name) {
  const call = plan.calls.find(c => Assistant.nameOf(c) === name);
  assert.ok(call, 'missing ' + name);
  return Assistant.argsOf(call);
}

test('voice phrase adds two litres of milk and Hönö bread', () => {
  const plan = Assistant.parseLocal('dois litros de leite e pão Hönö');
  const items = args(plan, 'add_items').items;
  assert.deepEqual(items[0], { name: 'leite', qty: 2, unit: 'l' });
  assert.equal(items[1].name, 'pão Hönö');
  assert.equal(items[1].qty, 1);
  assert.match(plan.reply, /Adicionei/);
  const out = Assistant.execute({ items: [] }, plan.calls);
  assert.equal(out.items.filter(i => !i.del).length, 2);
  assert.equal(out.chips[0].op, 'add');
});

test('a sunday lasagne request adds milk and the lasagne kit', () => {
  const plan = Assistant.parseLocal('acabou o leite e preciso de coisas pra lasanha de domingo');
  const items = args(plan, 'add_items').items.map(i => i.name);
  assert.ok(items.some(n => /leite/i.test(n)), items.join(','));
  assert.ok(items.some(n => /lasanha/i.test(n)), items.join(','));
  assert.ok(items.some(n => /carne/i.test(n)), items.join(','));
});

test('remove, cheapest shop, spend, and coffee offer', () => {
  assert.deepEqual(args(Assistant.parseLocal('tira os ovos'), 'remove_items').names, ['ovos']);
  assert.equal(Assistant.nameOf(Assistant.parseLocal('onde compro mais barato essa semana?').calls[0]), 'get_cheapest_plan');
  assert.equal(Assistant.nameOf(Assistant.parseLocal('quanto vou gastar?').calls[0]), 'get_cheapest_plan');
  assert.equal(args(Assistant.parseLocal('tem oferta de café?'), 'get_offers').query, 'café');

  const state = {
    items: [
      { name: 'ovos', qty: 1, unit: 'pcs' },
      { name: 'café', qty: 1, unit: 'pcs', chosen: { w: { price: 40 }, i: { price: 55 } } }
    ],
    stores: [{ id: 'w', name: 'Willys' }, { id: 'i', name: 'ICA' }],
    products: [{ store: 'w', name: 'Gevalia café', price: 49, offer: true, query: 'kaffe' }]
  };
  const removed = Assistant.execute(state, Assistant.parseLocal('tira os ovos').calls);
  assert.equal(removed.items.find(i => i.name === 'ovos').del, true);
  const plan = Assistant.execute(state, [{ function: { name: 'get_cheapest_plan', arguments: '{}' } }]);
  assert.equal(plan.facts.plan.best.name, 'Willys');
  assert.equal(plan.facts.plan.save, 15);
  const offers = Assistant.execute(state, Assistant.parseLocal('tem oferta de café?').calls);
  assert.equal(offers.facts.offers.length, 1);
  assert.match(Assistant.describe('pt', Assistant.parseLocal('tem oferta de café?').calls, offers), /Oferta/);
});

test('a mocked model tool call is applied and then answered', async () => {
  const state = { items: [], stores: [{ id: 'w', name: 'Willys' }], products: [] };
  let step = 0;
  const out = await Assistant.resolveWithModel(async () => {
    step += 1;
    if (step === 1) {
      return {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'add_items', arguments: JSON.stringify({ items: [{ name: 'leite', qty: 2, unit: 'l' }] }) } }]
      };
    }
    return { role: 'assistant', content: 'Adicionei 2 l de leite.' };
  }, state, 'adiciona leite');
  assert.equal(out.mode, 'ai');
  assert.equal(out.reply, 'Adicionei 2 l de leite.');
  assert.equal(Assistant.nameOf(out.calls[0]), 'add_items');
});

test('the worker hides the key, limits abuse, and only talks to the configured model', async () => {
  const env = {
    LLM_API_KEY: 'sk-test',
    LLM_BASE_URL: 'https://api.example.test/v1',
    LLM_MODEL: 'gpt-4o-mini',
    ALLOW_ORIGIN: 'https://betokasa1982-del.github.io',
    APP_TOKEN: 'house'
  };
  const health = await worker.fetch(new Request('https://ai.test/health'), env);
  assert.equal((await health.json()).ok, true);

  const blocked = await worker.fetch(new Request('https://ai.test/chat', {
    method: 'POST',
    headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }], device: 'd' })
  }), env);
  assert.equal(blocked.status, 401);

  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent = { url, opts };
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Olá' } }] }), { status: 200 });
  };
  try {
    const res = await worker.fetch(new Request('https://ai.test/chat', {
      method: 'POST',
      headers: { Origin: 'https://betokasa1982-del.github.io', 'Content-Type': 'application/json', 'X-Handla-Token': 'house' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'dois litros de leite' }], device: 'phone-1' })
    }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://betokasa1982-del.github.io');
    const body = JSON.parse(sent.opts.body);
    assert.equal(sent.url, 'https://api.example.test/v1/chat/completions');
    assert.equal(body.model, 'gpt-4o-mini');
    assert.ok(body.max_tokens <= 400);
    assert.ok(body.tools.some(t => t.function.name === 'add_items'));
    assert.match(sent.opts.headers.Authorization, /sk-test/);
    assert.equal((await res.json()).message.content, 'Olá');
  } finally {
    globalThis.fetch = realFetch;
  }
});
