/**
 * Tiny proxy so the Handla phone app can call an OpenAI-compatible model
 * without ever seeing the API key. Tool calls are returned to the phone,
 * which is the only place that can see the shopping list.
 */
var RATE = new Map();

function corsHeaders(env, request) {
  var allowed = (env && env.ALLOW_ORIGIN) || 'https://betokasa1982-del.github.io';
  var origin = request.headers.get('Origin') || '';
  var ok = origin === allowed;
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Handla-Token',
    'Vary': 'Origin'
  };
}

function json(env, request, body, status) {
  var headers = corsHeaders(env, request);
  headers['Content-Type'] = 'application/json; charset=utf-8';
  return new Response(JSON.stringify(body), { status: status || 200, headers: headers });
}

function limited(device) {
  var now = Date.now();
  var row = RATE.get(device) || { n: 0, reset: now + 3600000 };
  if (now > row.reset) row = { n: 0, reset: now + 3600000 };
  row.n += 1;
  RATE.set(device, row);
  return row.n > 40;
}

var TOOLS = [
  { type: 'function', function: { name: 'add_items', description: 'Add grocery items.', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' } }, required: ['name'] } } }, required: ['items'] } } },
  { type: 'function', function: { name: 'remove_items', description: 'Remove items by name.', parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } } },
  { type: 'function', function: { name: 'mark_bought', description: 'Mark items bought.', parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } } },
  { type: 'function', function: { name: 'get_cheapest_plan', description: 'Cheapest shop, totals and savings.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_offers', description: 'Offers, optional query.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
  { type: 'function', function: { name: 'search_products', description: 'Search saved products.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }
];

async function handleChat(request, env) {
  if (env.APP_TOKEN) {
    var token = request.headers.get('X-Handla-Token') || '';
    if (token !== env.APP_TOKEN) return json(env, request, { error: 'bad_token' }, 401);
  }
  if (!env.LLM_API_KEY) return json(env, request, { error: 'not_configured' }, 503);
  var body;
  try { body = await request.json(); } catch (e) { return json(env, request, { error: 'bad_json' }, 400); }
  var device = String((body && body.device) || request.headers.get('X-Device') || 'anon').slice(0, 80);
  if (limited(device)) return json(env, request, { error: 'rate_limited' }, 429);
  var incoming = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  var messages = [{ role: 'system', content: 'You are Handla, a brief grocery assistant for someone shopping in Sweden. Reply in the user\'s language, in at most two short sentences. Use tools for any list change or price question. Never invent a price.' }].concat(incoming.map(function (m) {
    var out = { role: m.role === 'tool' || m.role === 'assistant' || m.role === 'user' ? m.role : 'user' };
    if (m.content != null) out.content = String(m.content).slice(0, 2000);
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = String(m.tool_call_id).slice(0, 80);
    return out;
  }));
  var base = String(env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  var maxTokens = Math.min(800, Number(env.MAX_OUTPUT_TOKENS) || 400);
  var upstream = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.LLM_API_KEY
    },
    body: JSON.stringify({
      model: env.LLM_MODEL || 'gpt-4o-mini',
      messages: messages,
      tools: TOOLS,
      max_tokens: maxTokens,
      temperature: 0.2
    })
  });
  if (!upstream.ok) {
    return json(env, request, { error: 'upstream', status: upstream.status }, 502);
  }
  var data = await upstream.json();
  var message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return json(env, request, { error: 'empty' }, 502);
  return json(env, request, { message: message });
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return json(env, request, { ok: true, model: (env && env.LLM_MODEL) || 'gpt-4o-mini' });
    }
    if (url.pathname === '/chat' && request.method === 'POST') {
      return handleChat(request, env || {});
    }
    return json(env, request, { error: 'not_found' }, 404);
  }
};
