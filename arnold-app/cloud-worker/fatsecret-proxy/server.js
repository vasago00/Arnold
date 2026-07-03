// ─── Arnold FatSecret proxy (STATIC-IP host required) ────────────────────────
// FatSecret's free / Premier-Free tier only authorizes API calls from
// WHITELISTED IPs (≤15, or CIDR ranges) and requires the OAuth2 client_credentials
// token to be obtained SERVER-SIDE (the secret must never reach the app).
// Cloudflare Workers egress from a rotating pool and CANNOT be whitelisted, so
// this proxy must run on a host with ONE fixed outbound IP (small VPS, Fly.io
// dedicated IPv4, Render with a static IP, etc.). Whitelist that host's IP in the
// FatSecret dashboard. See README.md in this folder.
//
// Zero dependencies — Node 18+ (global fetch). Run:  node server.js
// Env:  FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET  (required; set yourself)
//       FATSECRET_SCOPE      (optional; default "basic" — "premier" for barcode)
//       PORT                 (optional; default 8787)
//       ALLOW_ORIGIN         (optional; default "*")
//
// Routes (all GET, JSON passthrough — mapping happens in the app):
//   GET /health
//   GET /fatsecret/search?q=<expr>&page=<0-based>
//   GET /fatsecret/food?id=<food_id>
//   GET /fatsecret/barcode?code=<gtin>

import http from 'node:http';

const CLIENT_ID = process.env.FATSECRET_CLIENT_ID || '';
const CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET || '';
const SCOPE = process.env.FATSECRET_SCOPE || 'basic';
const PORT = Number(process.env.PORT) || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const REST_URL = 'https://platform.fatsecret.com/rest/server.api';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('FATAL: set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET env vars.');
  process.exit(1);
}

// ── OAuth2 client-credentials token, cached in-memory until ~60s before expiry ──
let _token = null;        // { access_token, expiresAt }
async function getToken() {
  if (_token && Date.now() < _token.expiresAt) return _token.access_token;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const j = await res.json();
  _token = { access_token: j.access_token, expiresAt: Date.now() + ((j.expires_in || 86400) - 60) * 1000 };
  return _token.access_token;
}

async function fsCall(params) {
  const token = await getToken();
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ format: 'json', ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fatsecret ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ── Route handlers ───────────────────────────────────────────────────────────
async function handleSearch(q, page) {
  return fsCall({ method: 'foods.search.v3', search_expression: q || '', page_number: String(page || 0), max_results: '20' });
}
async function handleFood(id) {
  return fsCall({ method: 'food.get.v4', food_id: String(id) });
}
async function handleBarcode(code) {
  // Premier feature. Newer find_id_for_barcode returns the full food; older returns
  // just food_id → chain food.get. Handle both.
  const r = await fsCall({ method: 'food.find_id_for_barcode.v2', barcode: String(code) });
  if (r?.food?.food_name) return r;                        // full food already
  const foodId = r?.food_id?.value ?? r?.food_id ?? null;  // id-only form
  if (foodId && String(foodId) !== '0') return handleFood(foodId);
  return r;                                                // not found → passthrough
}

const json = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); } catch { return json(res, 400, { error: 'bad url' }); }
  const p = url.pathname;
  try {
    if (p === '/health') return json(res, 200, { ok: true, scope: SCOPE });
    if (p === '/fatsecret/search') return json(res, 200, await handleSearch(url.searchParams.get('q'), Number(url.searchParams.get('page')) || 0));
    if (p === '/fatsecret/food')   return json(res, 200, await handleFood(url.searchParams.get('id')));
    if (p === '/fatsecret/barcode') return json(res, 200, await handleBarcode(url.searchParams.get('code')));
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[fatsecret-proxy]', p, e.message);
    return json(res, 502, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Arnold FatSecret proxy on :${PORT} (scope=${SCOPE})`));
