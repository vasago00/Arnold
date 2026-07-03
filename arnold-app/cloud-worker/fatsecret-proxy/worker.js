// ─── Arnold FatSecret proxy — CLOUDFLARE WORKER variant ──────────────────────
// Use this instead of server.js when your FatSecret account is on PREMIER or
// PREMIER-FREE, where you can whitelist an IP *range* in CIDR notation. Whitelist
// 0.0.0.0/0 (and ::/0) in the FatSecret dashboard → Manage API Keys → IP
// Restrictions, and a Worker's rotating egress IPs are then all allowed, so no
// dedicated static-IP host is needed. (On the free BASIC tier you can only
// whitelist 15 individual IPs — use server.js on a fixed-IP host instead.)
//
// The OAuth2 client_credentials secret stays server-side (a Worker secret); the
// app never sees it. Routes + JSON passthrough are identical to server.js, so the
// app-side mappers in core/fatsecret-client.js work unchanged.
//
// Deploy:
//   wrangler secret put FATSECRET_CLIENT_ID
//   wrangler secret put FATSECRET_CLIENT_SECRET
//   wrangler deploy
// Then point the app at the deployed URL via the FatSecret endpoint setting.
//
// Routes (all GET):
//   GET /health
//   GET /fatsecret/search?q=<expr>&page=<0-based>
//   GET /fatsecret/food?id=<food_id>
//   GET /fatsecret/barcode?code=<gtin>   (Premier feature — needs scope=premier)

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const REST_URL  = 'https://platform.fatsecret.com/rest/server.api';

// Per-isolate token cache (good enough; a cold isolate just re-fetches a token).
let _token = null; // { access_token, expiresAt }

async function getToken(env) {
  if (_token && Date.now() < _token.expiresAt) return _token.access_token;
  const basic = btoa(`${env.FATSECRET_CLIENT_ID}:${env.FATSECRET_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: env.FATSECRET_SCOPE || 'premier' }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const j = await res.json();
  _token = { access_token: j.access_token, expiresAt: Date.now() + ((j.expires_in || 86400) - 60) * 1000 };
  return _token.access_token;
}

async function fsCall(env, params) {
  const token = await getToken(env);
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ format: 'json', ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fatsecret ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function handleBarcode(env, code) {
  // Newer find_id_for_barcode returns the full food; older returns just food_id
  // → chain food.get. Handle both. (Barcode requires Premier scope.)
  const r = await fsCall(env, { method: 'food.find_id_for_barcode.v2', barcode: String(code) });
  if (r?.food?.food_name) return r;
  const foodId = r?.food_id?.value ?? r?.food_id ?? null;
  if (foodId && String(foodId) !== '0') return fsCall(env, { method: 'food.get.v4', food_id: String(foodId) });
  return r; // not found → passthrough
}

export default {
  async fetch(request, env) {
    const ALLOW_ORIGIN = env.ALLOW_ORIGIN || '*';
    const json = (code, obj) => new Response(code === 204 ? null : JSON.stringify(obj), {
      status: code,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOW_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-store',
      },
    });

    if (request.method === 'OPTIONS') return json(204, {});
    if (!env.FATSECRET_CLIENT_ID || !env.FATSECRET_CLIENT_SECRET) {
      return json(500, { error: 'FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET secrets not set' });
    }

    const url = new URL(request.url);
    const p = url.pathname;
    const q = url.searchParams;
    try {
      if (p === '/health') return json(200, { ok: true, scope: env.FATSECRET_SCOPE || 'premier' });
      if (p === '/fatsecret/search') {
        return json(200, await fsCall(env, { method: 'foods.search.v3', search_expression: q.get('q') || '', page_number: String(Number(q.get('page')) || 0), max_results: '20' }));
      }
      if (p === '/fatsecret/food')   return json(200, await fsCall(env, { method: 'food.get.v4', food_id: String(q.get('id')) }));
      if (p === '/fatsecret/barcode') return json(200, await handleBarcode(env, q.get('code')));
      return json(404, { error: 'not found' });
    } catch (e) {
      return json(502, { error: String(e.message || e) });
    }
  },
};
