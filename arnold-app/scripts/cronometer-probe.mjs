#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Cronometer probe — proves the Cronometer login + daily-summary data path
// end-to-end, no external deps (Node 18+ built-ins only).
//
// Usage:
//   CRONO_USER=you@example.com CRONO_PASS=yourpw node scripts/cronometer-probe.mjs
//   Optional:
//     --date=2026-04-22     (defaults to today)
//     --fresh               (force new login, ignore cached session)
//     --export=servings     (daily_summary | servings | exercises | biometrics | notes)
//
// Session cookies are cached to .cronometer-session.json in CWD (gitignore it!).
// Port target: Cloudflare Worker. Same call graph, Workers KV instead of disk.
//
// Reference: reverse-engineered from cphoskins/cronometer-mcp (v2.0.3).
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const UA = 'arnold-cronometer-probe/0.1';
const SESSION_FILE = path.resolve(process.cwd(), '.cronometer-session.json');
const CT_GWT = 'text/x-gwt-rpc; charset=UTF-8';
const GWT_MODULE_BASE = 'https://cronometer.com/cronometer/';

// Defaults — refreshed at runtime via _discover_gwt_hashes()
let gwtPermutation = 'CBC38FBB0A1527BD5E68722DD9DABD27';
let gwtHeader      = '76FC4464E20E53D16663AC9A96A486B3';

// ── Cookie jar ──────────────────────────────────────────────────────────────
const jar = new Map();
function setCookiesFrom(response) {
  // Headers#getSetCookie returns array of full Set-Cookie strings (Node 20.15+).
  // Fallback: parse from raw headers.
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.raw?.()['set-cookie'] || []);
  for (const line of raw) {
    const [kv] = line.split(';');
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    const k = kv.slice(0, eq).trim();
    const v = kv.slice(eq + 1).trim();
    if (k) jar.set(k, v);
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── HTTP helper ─────────────────────────────────────────────────────────────
async function httpFetch(url, opts = {}) {
  const headers = {
    'user-agent': UA,
    ...(opts.headers || {}),
  };
  const cookie = cookieHeader();
  if (cookie) headers['cookie'] = cookie;
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  setCookiesFrom(res);
  // Manual redirect handling — capture cookies along the way
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) return httpFetch(new URL(loc, url).toString(), { ...opts, method: 'GET', body: undefined });
  }
  return res;
}

// ── Session persistence ─────────────────────────────────────────────────────
function saveSession(extra = {}) {
  const data = {
    cookies: Object.fromEntries(jar),
    gwtPermutation, gwtHeader,
    savedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  console.log(`💾 session cached to ${SESSION_FILE}`);
}
function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    for (const [k, v] of Object.entries(data.cookies || {})) jar.set(k, v);
    if (data.gwtPermutation) gwtPermutation = data.gwtPermutation;
    if (data.gwtHeader)      gwtHeader      = data.gwtHeader;
    return data;
  } catch { return null; }
}

// ── Steps 3–4: discover GWT hashes (best-effort, defaults usually work) ─────
async function discoverGwtHashes() {
  try {
    const r1 = await httpFetch('https://cronometer.com/cronometer/cronometer.nocache.js');
    const t1 = await r1.text();
    const m1 = t1.match(/='([A-F0-9]{32})'/);
    if (m1) gwtPermutation = m1[1];

    const r2 = await httpFetch(`https://cronometer.com/cronometer/${gwtPermutation}.cache.js`);
    const t2 = await r2.text();
    const m2 = t2.match(/'app','([A-F0-9]{32})'/);
    if (m2) gwtHeader = m2[1];

    console.log(`🔑 GWT permutation=${gwtPermutation.slice(0,8)}…  header=${gwtHeader.slice(0,8)}…`);
  } catch (e) {
    console.warn(`⚠  GWT discovery failed, using defaults: ${e.message}`);
  }
}

// ── Step 1: scrape anticsrf ─────────────────────────────────────────────────
async function getAnticsrf() {
  const res = await httpFetch('https://cronometer.com/login/');
  const body = await res.text();
  const m = body.match(/name="anticsrf"\s+value="([^"]+)"/);
  if (!m) throw new Error('anticsrf token not found on login page');
  return m[1];
}

// ── Step 2: username/password login ─────────────────────────────────────────
async function login(username, password) {
  const anticsrf = await getAnticsrf();
  console.log(`🛂 anticsrf acquired`);
  const res = await httpFetch('https://cronometer.com/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ anticsrf, username, password }).toString(),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (json.error) throw new Error(`login refused: ${json.error}`);
  if (!jar.get('sesnonce')) throw new Error('login succeeded but no sesnonce cookie was set');
  console.log(`✓ logged in  sesnonce=${jar.get('sesnonce').slice(0,8)}…`);
  return json;
}

// ── Step 5: GWT authenticate → user_id ──────────────────────────────────────
const GWT_AUTHENTICATE =
  '7|0|5|https://cronometer.com/cronometer/|{gwt_header}|com.cronometer.shared.rpc.CronometerService|authenticate|java.lang.Integer/3438268394|1|2|3|4|1|5|5|-300|';

async function gwtAuthenticate() {
  const body = GWT_AUTHENTICATE.replace('{gwt_header}', gwtHeader);
  const res = await httpFetch('https://cronometer.com/cronometer/app', {
    method: 'POST',
    headers: {
      'content-type': CT_GWT,
      'x-gwt-module-base': GWT_MODULE_BASE,
      'x-gwt-permutation': gwtPermutation,
    },
    body,
  });
  const text = await res.text();
  if (!text.startsWith('//OK')) throw new Error(`gwtAuthenticate failed: ${text.slice(0, 200)}`);
  const m = text.match(/OK\[(\d+),/);
  if (!m) throw new Error(`could not extract user_id from: ${text.slice(0, 200)}`);
  const userId = m[1];
  console.log(`✓ user_id=${userId}`);
  return userId;
}

// ── Step 6: GWT generateAuthorizationToken → short-lived export token ───────
const GWT_AUTH_TOKEN =
  '7|0|8|https://cronometer.com/cronometer/|{gwt_header}|com.cronometer.shared.rpc.CronometerService|generateAuthorizationToken|java.lang.String/2004016611|I|com.cronometer.shared.user.AuthScope/2065601159|{nonce}|1|2|3|4|4|5|6|6|7|8|{user_id}|3600|7|2|';

async function generateAuthToken(userId) {
  const nonce = jar.get('sesnonce') || '';
  const body = GWT_AUTH_TOKEN
    .replace('{gwt_header}', gwtHeader)
    .replace('{nonce}', nonce)
    .replace('{user_id}', userId);
  const res = await httpFetch('https://cronometer.com/cronometer/app', {
    method: 'POST',
    headers: {
      'content-type': CT_GWT,
      'x-gwt-module-base': GWT_MODULE_BASE,
      'x-gwt-permutation': gwtPermutation,
    },
    body,
  });
  const text = await res.text();
  if (!text.startsWith('//OK')) throw new Error(`generateAuthToken failed: ${text.slice(0, 200)}`);
  const m = text.match(/"([^"]+)"/);
  if (!m) throw new Error(`could not extract token from: ${text.slice(0, 200)}`);
  return m[1];
}

// ── Step 7: GET /export CSV ─────────────────────────────────────────────────
const EXPORT_MAP = {
  daily_summary: 'dailySummary',
  servings:      'servings',
  exercises:     'exercises',
  biometrics:    'biometrics',
  notes:         'notes',
};

async function exportRaw(token, type, start, end) {
  const generate = EXPORT_MAP[type] || type;
  const u = new URL('https://cronometer.com/export');
  u.searchParams.set('nonce', token);
  u.searchParams.set('generate', generate);
  u.searchParams.set('start', start);
  u.searchParams.set('end', end);
  const res = await httpFetch(u.toString(), {
    headers: {
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
    },
  });
  if (!res.ok) throw new Error(`export ${type} HTTP ${res.status}`);
  return res.text();
}

// ── CSV → rows of objects ───────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const hdrs = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const row = {};
    hdrs.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}
function splitCSVLine(line) {
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

// ── Validate cached session with a cheap call ───────────────────────────────
async function validateSession(userId) {
  try {
    await generateAuthToken(userId); // throws if session is dead
    return true;
  } catch (e) {
    console.log(`ℹ cached session invalid: ${e.message}`);
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }

async function main() {
  const user = process.env.CRONO_USER;
  const pass = process.env.CRONO_PASS;
  if (!user || !pass) {
    console.error('Missing CRONO_USER / CRONO_PASS env vars.');
    console.error('Example:  CRONO_USER=you@x.com CRONO_PASS=•••• node scripts/cronometer-probe.mjs');
    process.exit(1);
  }
  // Cronometer stores servings against LOCAL date, so we must use local time —
  // not toISOString() which would hand us UTC "today" (a day ahead once past 20:00 in EU).
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const date = arg('date', today);
  const type = arg('export', 'daily_summary');
  const fresh = flag('fresh');

  let userId;
  const cached = !fresh && loadSession();
  if (cached?.userId) {
    console.log(`♻ using cached session from ${cached.savedAt}`);
    userId = cached.userId;
    if (!(await validateSession(userId))) {
      console.log('→ re-authenticating from scratch');
      jar.clear();
      userId = null;
    }
  }

  if (!userId) {
    await discoverGwtHashes();
    await login(user, pass);
    userId = await gwtAuthenticate();
    saveSession({ userId });
  }

  const token = await generateAuthToken(userId);
  console.log(`🎟  export token acquired (1h TTL)`);

  const csv = await exportRaw(token, type, date, date);
  console.log(`\n── RAW CSV (${type} · ${date}) ────────────────────────────`);
  console.log(csv.trimEnd());
  console.log(`─────────────────────────────────────────────────────`);

  const rows = parseCSV(csv);
  console.log(`\n── PARSED (${rows.length} row${rows.length === 1 ? '' : 's'}) ─────────────────`);
  for (const r of rows) console.log(JSON.stringify(r, null, 2));

  // If this was a daily_summary, show the headline nutrition facts
  if (type === 'daily_summary' && rows.length) {
    const r = rows[0];
    console.log(`\n── HEADLINE (${date}) ────────────────────────────────────`);
    const pick = (...names) => {
      for (const n of names) {
        const key = Object.keys(r).find(k => k.toLowerCase() === n.toLowerCase());
        if (key && r[key] !== '') return r[key];
      }
      return '—';
    };
    console.log(`  Calories (kcal):  ${pick('Energy (kcal)', 'Calories')}`);
    console.log(`  Protein  (g):     ${pick('Protein (g)')}`);
    console.log(`  Carbs    (g):     ${pick('Carbs (g)', 'Net Carbs (g)')}`);
    console.log(`  Fat      (g):     ${pick('Fat (g)')}`);
    console.log(`  Water    (g):     ${pick('Water (g)')}`);
  }

  console.log(`\n✓ probe complete`);
}

main().catch(e => { console.error(`\n✗ ${e.message}`); process.exit(2); });
