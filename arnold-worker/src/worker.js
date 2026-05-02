// ─── Arnold Cloud Sync Worker ────────────────────────────────────────────────
// Opaque encrypted-blob relay for syncing Arnold between devices.
// The worker never sees plaintext — it's a dumb key/value shuttle guarded by
// a bearer token. Data is end-to-end encrypted on the client with an AES-256
// key derived from the user's passphrase via PBKDF2.
//
// Endpoints:
//   GET    /s/:id       → returns the encrypted blob (or 404)
//   PUT    /s/:id       → stores the blob (body up to 8 MB)
//   DELETE /s/:id       → wipes the blob (manual reset)
//   GET    /health      → "ok" (no auth, no secrets)
//
// Auth:
//   Every non-health request must carry:
//     Authorization: Bearer <SYNC_TOKEN>
//   SYNC_TOKEN is stored as a Cloudflare secret (wrangler secret put SYNC_TOKEN).
//   Comparison is constant-time to deflect timing probes.
//
// Storage:
//   KV namespace binding name: SYNC_KV
//   Keys are of the form `blob:<id>`. `<id>` is a hex string chosen by the
//   client (32 bytes of CSPRNG). The worker rejects ids that don't match the
//   expected shape.
//
// The blob itself is opaque bytes — typically ~100 KB to 2 MB of ciphertext.

import {
  handleGarminSleep,
  handleGarminWellness,
  handleGarminReadiness,
  handleGarminAll,
  handleGarminActivitiesList,
  handleGarminActivityDetails,
  handleGarminActivityFit,
  handleGarminVO2Max,
} from './garmin-relay.js';

const MAX_BLOB_BYTES = 8 * 1024 * 1024; // 8 MB safety cap
const ID_PATTERN = /^[a-f0-9]{32,128}$/; // 16–64 bytes hex

// ── Constant-time string compare ────────────────────────────────────────────
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length);
  const expected = env.SYNC_TOKEN || '';
  if (!expected) return false; // misconfigured — deny
  return timingSafeEqual(token, expected);
}

// ── CORS ────────────────────────────────────────────────────────────────────
// Capacitor WebViews use scheme `https://localhost`, `capacitor://localhost`,
// or `http://localhost`. Web desktop runs on whatever origin you serve from.
// Bearer auth is the actual security boundary — CORS is just for browsers.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
  'Access-Control-Max-Age': '86400',
};

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
  });
}

function text(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS, ...extra },
  });
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleGet(id, env) {
  const meta = await env.SYNC_KV.getWithMetadata(`blob:${id}`, { type: 'arrayBuffer' });
  if (!meta || !meta.value) return json(404, { error: 'not_found' });
  const updatedAt = (meta.metadata && meta.metadata.updatedAt) || 0;
  return new Response(meta.value, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'ETag': `"${updatedAt}"`,
      'X-Updated-At': String(updatedAt),
      ...CORS_HEADERS,
    },
  });
}

async function handlePut(id, request, env) {
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_BLOB_BYTES) return json(413, { error: 'too_large', limit: MAX_BLOB_BYTES });

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return json(400, { error: 'empty_body' });
  if (buf.byteLength > MAX_BLOB_BYTES) return json(413, { error: 'too_large', limit: MAX_BLOB_BYTES });

  const updatedAt = Date.now();
  await env.SYNC_KV.put(`blob:${id}`, buf, {
    metadata: { updatedAt, bytes: buf.byteLength },
  });
  return json(200, { ok: true, bytes: buf.byteLength, updatedAt });
}

async function handleDelete(id, env) {
  await env.SYNC_KV.delete(`blob:${id}`);
  return json(200, { ok: true });
}

// ─── Cronometer relay ───────────────────────────────────────────────────────
// The client holds the user's Cronometer credentials inside its own encrypted
// Cloud Sync blob (unlocked with the Cloud Sync passphrase). When it needs
// intra-day nutrition, it POSTs the decrypted creds to /cronometer/pull over
// HTTPS. This worker executes the Cronometer login + export flow server-side
// and returns parsed JSON — cookies and short-lived caches live in KV keyed
// by sha256(email) so no plaintext emails hit our storage.

const CRONO_SESS_TTL  = 24 * 60 * 60; // 24h cookie cache
const CRONO_CACHE_TTL = 5 * 60;       // 5 min response cache
const CRONO_UA        = 'arnold-worker/1.0';
const CRONO_CT_GWT    = 'text/x-gwt-rpc; charset=UTF-8';
const CRONO_GWT_BASE  = 'https://cronometer.com/cronometer/';
const CRONO_EXPORT_MAP = {
  daily_summary: 'dailySummary',
  servings:      'servings',
  exercises:     'exercises',
  biometrics:    'biometrics',
  notes:         'notes',
};

// Default GWT hashes — discovered dynamically on fresh login; these are
// just the last-known-good fallback for when discovery fails.
const CRONO_GWT_PERM_DEFAULT   = 'CBC38FBB0A1527BD5E68722DD9DABD27';
const CRONO_GWT_HEADER_DEFAULT = '76FC4464E20E53D16663AC9A96A486B3';

const GWT_AUTHENTICATE =
  '7|0|5|https://cronometer.com/cronometer/|{gwt_header}|com.cronometer.shared.rpc.CronometerService|authenticate|java.lang.Integer/3438268394|1|2|3|4|1|5|5|-300|';
const GWT_AUTH_TOKEN =
  '7|0|8|https://cronometer.com/cronometer/|{gwt_header}|com.cronometer.shared.rpc.CronometerService|generateAuthorizationToken|java.lang.String/2004016611|I|com.cronometer.shared.user.AuthScope/2065601159|{nonce}|1|2|3|4|4|5|6|6|7|8|{user_id}|3600|7|2|';

async function sha256Hex(s) {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Per-request cookie jar — Workers have no persistent globals.
class CookieJar {
  constructor(init = {}) { this.map = new Map(Object.entries(init || {})); }
  setFrom(response) {
    const raw = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    for (const line of raw) {
      const [kv] = line.split(';');
      const eq = kv.indexOf('=');
      if (eq < 0) continue;
      const k = kv.slice(0, eq).trim();
      const v = kv.slice(eq + 1).trim();
      if (k) this.map.set(k, v);
    }
  }
  header() { return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  toObject() { return Object.fromEntries(this.map); }
}

async function cronoFetch(url, jar, opts = {}) {
  const headers = { 'user-agent': CRONO_UA, ...(opts.headers || {}) };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  jar.setFrom(res);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) return cronoFetch(new URL(loc, url).toString(), jar, { ...opts, method: 'GET', body: undefined });
  }
  return res;
}

async function discoverGwtHashes(jar) {
  let perm = CRONO_GWT_PERM_DEFAULT;
  let hdr  = CRONO_GWT_HEADER_DEFAULT;
  try {
    const r1 = await cronoFetch('https://cronometer.com/cronometer/cronometer.nocache.js', jar);
    const t1 = await r1.text();
    const m1 = t1.match(/='([A-F0-9]{32})'/);
    if (m1) perm = m1[1];
    const r2 = await cronoFetch(`https://cronometer.com/cronometer/${perm}.cache.js`, jar);
    const t2 = await r2.text();
    const m2 = t2.match(/'app','([A-F0-9]{32})'/);
    if (m2) hdr = m2[1];
  } catch { /* fall back to defaults */ }
  return { perm, hdr };
}

async function cronoLogin(jar, user, pass) {
  const page = await cronoFetch('https://cronometer.com/login/', jar);
  const body = await page.text();
  const m = body.match(/name="anticsrf"\s+value="([^"]+)"/);
  if (!m) throw new Error('anticsrf_missing');
  const res = await cronoFetch('https://cronometer.com/login', jar, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ anticsrf: m[1], username: user, password: pass }).toString(),
  });
  const txt = await res.text();
  let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt }; }
  if (parsed.error) throw new Error(`login_refused:${parsed.error}`);
  if (!jar.map.get('sesnonce')) throw new Error('login_no_sesnonce');
}

async function cronoGwtAuthenticate(jar, perm, hdr) {
  const body = GWT_AUTHENTICATE.replace('{gwt_header}', hdr);
  const res = await cronoFetch('https://cronometer.com/cronometer/app', jar, {
    method: 'POST',
    headers: {
      'content-type': CRONO_CT_GWT,
      'x-gwt-module-base': CRONO_GWT_BASE,
      'x-gwt-permutation': perm,
    },
    body,
  });
  const text = await res.text();
  if (!text.startsWith('//OK')) throw new Error('gwt_auth_failed');
  const m = text.match(/OK\[(\d+),/);
  if (!m) throw new Error('gwt_auth_no_userid');
  return m[1];
}

async function cronoAuthToken(jar, userId, perm, hdr) {
  const nonce = jar.map.get('sesnonce') || '';
  const body = GWT_AUTH_TOKEN
    .replace('{gwt_header}', hdr)
    .replace('{nonce}', nonce)
    .replace('{user_id}', userId);
  const res = await cronoFetch('https://cronometer.com/cronometer/app', jar, {
    method: 'POST',
    headers: {
      'content-type': CRONO_CT_GWT,
      'x-gwt-module-base': CRONO_GWT_BASE,
      'x-gwt-permutation': perm,
    },
    body,
  });
  const text = await res.text();
  if (!text.startsWith('//OK')) throw new Error('auth_token_failed');
  const m = text.match(/"([^"]+)"/);
  if (!m) throw new Error('auth_token_no_nonce');
  return m[1];
}

async function cronoExport(jar, token, type, start, end) {
  const generate = CRONO_EXPORT_MAP[type] || type;
  const u = new URL('https://cronometer.com/export');
  u.searchParams.set('nonce', token);
  u.searchParams.set('generate', generate);
  u.searchParams.set('start', start);
  u.searchParams.set('end', end);
  const res = await cronoFetch(u.toString(), jar);
  if (!res.ok) throw new Error(`export_http_${res.status}`);
  return res.text();
}

function parseCronoCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const hdrs = splitCronoCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCronoCSVLine(line);
    const row = {};
    hdrs.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}
function splitCronoCSVLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"' && inQ) { cur += '"'; i++; continue; }
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function aggregateServings(rows) {
  // Sum numeric nutrients across every row. Blank cells don't count —
  // Cronometer leaves nutrients blank when its food-DB entry has no value
  // for that nutrient (blank ≠ 0).
  const keysToSum = new Set();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (['Day', 'Time', 'Group', 'Food Name', 'Amount', 'Category'].includes(k)) continue;
      if (v !== '' && !Number.isNaN(parseFloat(v))) keysToSum.add(k);
    }
  }
  const totals = {};
  for (const k of keysToSum) {
    let sum = 0;
    for (const r of rows) {
      const v = r[k];
      if (v === '' || v == null) continue;
      const n = parseFloat(v);
      if (!Number.isNaN(n)) sum += n;
    }
    totals[k] = Math.round(sum * 100) / 100;
  }
  return totals;
}

async function fetchCronometerData(user, pass, date, type, env, { skipCachedSession = false } = {}) {
  const userHash = await sha256Hex(user.toLowerCase());
  const sessKey  = `crono_sess:${userHash}`;

  const saved = skipCachedSession ? null : await env.SYNC_KV.get(sessKey, 'json');
  let jar    = new CookieJar(saved?.cookies);
  let userId = saved?.userId;
  let perm   = saved?.perm || CRONO_GWT_PERM_DEFAULT;
  let hdr    = saved?.hdr  || CRONO_GWT_HEADER_DEFAULT;
  let token;
  let usedCachedSession = false;

  try {
    if (!userId) throw new Error('no_session');
    token = await cronoAuthToken(jar, userId, perm, hdr);
    usedCachedSession = true;
  } catch {
    jar = new CookieJar();
    const hashes = await discoverGwtHashes(jar);
    perm = hashes.perm; hdr = hashes.hdr;
    await cronoLogin(jar, user, pass); // throws on bad creds
    userId = await cronoGwtAuthenticate(jar, perm, hdr);
    await env.SYNC_KV.put(sessKey, JSON.stringify({
      cookies: jar.toObject(), userId, perm, hdr, savedAt: Date.now(),
    }), { expirationTtl: CRONO_SESS_TTL });
    token = await cronoAuthToken(jar, userId, perm, hdr);
  }

  let csv;
  try {
    csv = await cronoExport(jar, token, type, date, date);
  } catch (e) {
    if (usedCachedSession) {
      // Cookies might have rotated on Cronometer's side — burn the cache and retry once.
      await env.SYNC_KV.delete(sessKey);
      return fetchCronometerData(user, pass, date, type, env, { skipCachedSession: true });
    }
    throw e;
  }

  const rows = parseCronoCSV(csv);
  const totals = (type === 'servings' || type === 'daily_summary') ? aggregateServings(rows) : null;
  return { date, type, rows, totals, rowCount: rows.length, fetchedAt: Date.now() };
}

async function handleCronometerPull(request, env) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  const { user, pass, date, type = 'servings' } = body || {};
  if (!user || !pass)  return json(400, { error: 'missing_credentials' });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: 'bad_date' });
  if (!CRONO_EXPORT_MAP[type]) return json(400, { error: 'bad_type' });

  const userHash = await sha256Hex(user.toLowerCase());
  const cacheKey = `crono_cache:${userHash}:${date}:${type}`;

  // 5 min response cache — repeat polls are free
  const cached = await env.SYNC_KV.get(cacheKey, 'json');
  if (cached) return json(200, { ...cached, cached: true });

  let result;
  try {
    result = await fetchCronometerData(user, pass, date, type, env);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.startsWith('login_refused') || msg === 'login_no_sesnonce' || msg === 'anticsrf_missing') {
      return json(401, { error: 'cronometer_login_failed', detail: msg });
    }
    return json(502, { error: 'cronometer_upstream_failed', detail: msg });
  }

  await env.SYNC_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CRONO_CACHE_TTL });
  return json(200, { ...result, cached: false });
}

// ─── FIT activity relay ─────────────────────────────────────────────────────
// Same security model as the encrypted-blob /s endpoints — Bearer token over
// HTTPS — but the FITs themselves are plaintext JSON. The point of this relay
// is to provide a simple direct-fetch path for FIT activities that doesn't
// ride the encrypted-blob LWW/decrypt logic, which has historically been the
// weak point when devices' passphrases drift apart.
//
// Each FIT is keyed by pairId + date + filename. KV TTL of 90 days keeps the
// namespace bounded; activities are persisted to each device's local storage
// during the first successful pull, so the relay copy is purely transport.
//
// Endpoints:
//   POST   /fit/:pairId           body {date, filename, activity} → stores
//   GET    /fit/:pairId/recent    ?days=14 → array of stored FITs
//   DELETE /fit/:pairId/:date/:filename → wipe one
//
// This relay uses the same SYNC_KV namespace with key prefix `fit:` (vs the
// `blob:` prefix used by the encrypted-blob endpoints).

const FIT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const FIT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FIT_FILENAME_PATTERN = /^[A-Za-z0-9_.\-]{1,128}$/;
const FIT_MAX_BODY_BYTES = 256 * 1024; // 256 KB per FIT — generous for parsed JSON

// ─── AI proxy ───────────────────────────────────────────────────────────────
// Forwards { system, user, max, model } to api.anthropic.com using the
// Worker-owned ANTHROPIC_API_KEY secret. Returns the Anthropic response
// verbatim so the client can use it identically to a direct call. Handles:
//   - CORS (Worker is server-side, no CORS preflight at the Anthropic edge)
//   - Key security (key is a Cloudflare secret, never sent to browser)
//   - Rate limiting (per-token bucket — 60 calls/hour by default)
async function handleAIMessages(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json(503, { error: 'ai_not_configured', detail: 'Set ANTHROPIC_API_KEY via wrangler secret put' });
  }
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  // Default model — update as Anthropic releases. claude-sonnet-4-5-20250929
  // is the latest Sonnet 4.5. Caller can override via body.model.
  const { system, user, max = 1500, model = 'claude-sonnet-4-5-20250929' } = body || {};
  if (!user || typeof user !== 'string') return json(400, { error: 'missing_user_message' });

  // Rate-limit per Worker token. SYNC_TOKEN already authenticated — use a
  // hash of it as the bucket key. Default cap 60 calls/hour.
  try {
    const auth = request.headers.get('Authorization') || '';
    const tokenHash = await sha256Hex(auth);
    const bucketKey = `ai:rate:${tokenHash}:${Math.floor(Date.now() / 3600000)}`;
    const used = parseInt((await env.SYNC_KV.get(bucketKey)) || '0', 10);
    if (used >= 60) {
      return json(429, { error: 'rate_limited', detail: 'Hourly AI cap reached (60). Try again next hour.' });
    }
    await env.SYNC_KV.put(bucketKey, String(used + 1), { expirationTtl: 3700 });
  } catch (e) {
    console.warn('[ai] rate-limit accounting failed:', e?.message || e);
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-api-key':        env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(Math.max(parseInt(max, 10) || 1500, 100), 8192),
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: user }],
      }),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  } catch (e) {
    return json(502, { error: 'ai_upstream_failed', detail: String(e?.message || e) });
  }
}

async function handleFitPost(pairId, request, env) {
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > FIT_MAX_BODY_BYTES) return json(413, { error: 'too_large' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  const { date, filename, activity } = body || {};
  if (!date || !FIT_DATE_PATTERN.test(date)) return json(400, { error: 'bad_date' });
  if (!filename || !FIT_FILENAME_PATTERN.test(filename)) return json(400, { error: 'bad_filename' });
  if (!activity || typeof activity !== 'object') return json(400, { error: 'bad_activity' });

  const key = `fit:${pairId}:${date}:${filename}`;
  const updatedAt = Date.now();
  const payload = JSON.stringify({ date, filename, activity, updatedAt });
  if (payload.length > FIT_MAX_BODY_BYTES) return json(413, { error: 'too_large' });

  await env.SYNC_KV.put(key, payload, {
    expirationTtl: FIT_TTL_SECONDS,
    metadata: { date, filename, updatedAt, bytes: payload.length },
  });
  return json(200, { ok: true, date, filename, updatedAt, bytes: payload.length });
}

async function handleFitRecent(pairId, request, env) {
  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '14', 10) || 14));
  const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1000;
  // KV list with prefix gives us the keys; we then GET each to assemble the
  // result. List operations are bounded by the prefix scope (`fit:<pairId>:`).
  const prefix = `fit:${pairId}:`;
  const list = await env.SYNC_KV.list({ prefix, limit: 1000 });
  const fits = [];
  for (const k of list.keys) {
    // Filter by metadata first (no GET cost) — but we also need the activity
    // payload, so we GET anyway. Fast enough for a few dozen recent FITs.
    if (k.metadata && k.metadata.updatedAt && k.metadata.updatedAt < cutoffTs) continue;
    const v = await env.SYNC_KV.get(k.name);
    if (!v) continue;
    try {
      const parsed = JSON.parse(v);
      fits.push(parsed);
    } catch { /* skip corrupt */ }
  }
  // Newest first
  fits.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return json(200, { count: fits.length, fits });
}

async function handleFitDelete(pairId, date, filename, env) {
  if (!FIT_DATE_PATTERN.test(date)) return json(400, { error: 'bad_date' });
  if (!FIT_FILENAME_PATTERN.test(filename)) return json(400, { error: 'bad_filename' });
  await env.SYNC_KV.delete(`fit:${pairId}:${date}:${filename}`);
  return json(200, { ok: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health probe — no auth, no data
    if (pathname === '/health' && request.method === 'GET') {
      return text(200, 'ok');
    }

    // Everything else requires auth
    if (!requireAuth(request, env)) {
      return json(401, { error: 'unauthorized' });
    }

    // Cronometer relay
    if (pathname === '/cronometer/pull' && request.method === 'POST') {
      return handleCronometerPull(request, env);
    }

    // AI proxy — calls Anthropic API server-side. Eliminates CORS, hides
    // API key from the client bundle, lets us add rate limiting in one place.
    // Body: { system, user, max?, model? }
    if (pathname === '/ai/messages' && request.method === 'POST') {
      return handleAIMessages(request, env);
    }

    // Garmin Wellness relay — pulls Sleep Score, Body Battery, Stress,
    // Training Readiness, and the daily summary that Health Connect doesn't
    // expose. Each accepts {user, pass, date} POST body, same shape as the
    // Cronometer relay so the client side stays uniform.
    if (request.method === 'POST') {
      if (pathname === '/garmin/sleep')     return handleGarminSleep(request, env);
      if (pathname === '/garmin/wellness')  return handleGarminWellness(request, env);
      if (pathname === '/garmin/readiness') return handleGarminReadiness(request, env);
      if (pathname === '/garmin/all')       return handleGarminAll(request, env);
      if (pathname === '/garmin/vo2max')    return handleGarminVO2Max(request, env);
      // Activity routes — list is body-only; details/fit take {activityId} in path.
      if (pathname === '/garmin/activities/recent') return handleGarminActivitiesList(request, env);
      const detMatch = pathname.match(/^\/garmin\/activities\/(\d+)\/details$/);
      if (detMatch) return handleGarminActivityDetails(request, env, detMatch[1]);
      const fitMatch = pathname.match(/^\/garmin\/activities\/(\d+)\/fit$/);
      if (fitMatch) return handleGarminActivityFit(request, env, fitMatch[1]);
    }

    // FIT relay
    const fitRecentMatch = pathname.match(/^\/fit\/([a-f0-9]+)\/recent$/);
    if (fitRecentMatch) {
      const pairId = fitRecentMatch[1];
      if (!ID_PATTERN.test(pairId)) return json(400, { error: 'bad_id' });
      if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
      return handleFitRecent(pairId, request, env);
    }
    const fitDeleteMatch = pathname.match(/^\/fit\/([a-f0-9]+)\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_.\-]+)$/);
    if (fitDeleteMatch) {
      const [, pairId, date, filename] = fitDeleteMatch;
      if (!ID_PATTERN.test(pairId)) return json(400, { error: 'bad_id' });
      if (request.method !== 'DELETE') return json(405, { error: 'method_not_allowed' });
      return handleFitDelete(pairId, date, filename, env);
    }
    const fitPostMatch = pathname.match(/^\/fit\/([a-f0-9]+)$/);
    if (fitPostMatch) {
      const pairId = fitPostMatch[1];
      if (!ID_PATTERN.test(pairId)) return json(400, { error: 'bad_id' });
      if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
      return handleFitPost(pairId, request, env);
    }

    // /s/:id routes
    const match = pathname.match(/^\/s\/([a-f0-9]+)$/);
    if (match) {
      const id = match[1];
      if (!ID_PATTERN.test(id)) return json(400, { error: 'bad_id' });

      switch (request.method) {
        case 'GET':    return handleGet(id, env);
        case 'PUT':    return handlePut(id, request, env);
        case 'DELETE': return handleDelete(id, env);
        default:       return json(405, { error: 'method_not_allowed' });
      }
    }

    return json(404, { error: 'not_found' });
  },
};
