// ─── Garmin Connect Relay ────────────────────────────────────────────────────
// Server-side Garmin Connect login + Wellness API client for Cloudflare Workers.
//
// Why this exists:
//   Health Connect on Android delivers stage durations but not Garmin's actual
//   composite scores (Sleep Score, Body Battery, Training Readiness, Stress).
//   Garmin Connect itself owns those scores — we have to authenticate as the
//   user and pull from connectapi.garmin.com directly.
//
// Auth flow (no MFA):
//   1. GET  sso.garmin.com/sso/signin            → grab _csrf cookie + token
//   2. POST sso.garmin.com/sso/signin            → ticket=ST-...
//   3. GET  connectapi/oauth-service/preauthorized?ticket=...   (OAuth1 signed)
//                                                → oauth_token + oauth_token_secret
//   4. POST connectapi/oauth-service/exchange/user/2.0          (OAuth1 signed)
//                                                → access_token (Bearer, ~1h)
//
// OAuth1 consumer key/secret:
//   Garmin's mobile-app keys (extracted by the Garth library and re-published
//   at thegarth.s3.amazonaws.com so they can rotate without breaking clients).
//   We fetch them on first use and cache in KV; if S3 is unreachable we fall
//   back to known-working defaults.
//
// Endpoints exposed (all require Bearer SYNC_TOKEN, body shape {user,pass,date}):
//   POST /garmin/sleep      → daily sleep DTO + intraday HR/HRV/stress arrays
//   POST /garmin/wellness   → daily summary + body battery + intraday stress
//   POST /garmin/readiness  → training readiness composite
//   POST /garmin/all        → consolidated payload (sleep + wellness + readiness)
//
// Caching:
//   - garmin:oauth_consumer       → consumer key/secret, 7d TTL
//   - garmin:token:<sha256(user)> → access_token + expires_at, ~1h TTL
//   - garmin:resp:<sha256>:<date>:<kind> → response cache, 5 min TTL

const SSO_ORIGIN     = 'https://sso.garmin.com';
const API_ORIGIN     = 'https://connectapi.garmin.com';
const CONSUMER_URL   = 'https://thegarth.s3.amazonaws.com/oauth_consumer.json';
const USER_AGENT     = 'GCM-iOS-5.7.2.1';
const APP_USER_AGENT = 'com.garmin.android.apps.connectmobile';

// Fallback OAuth1 consumer (Garth's last-known-good values). Bumped automatically
// whenever S3 returns a fresher pair.
const FALLBACK_CONSUMER_KEY    = 'fc3e99d2-118c-44b8-8ae3-03370dde24c0';
const FALLBACK_CONSUMER_SECRET = 'E08WAR897WEz2sH3EOkQT9gkKWk9uZUQjIYE9RJfLBl6WeQ7zTl0RfL2srVJFWMc';

const CONSUMER_TTL = 7 * 24 * 60 * 60;
const TOKEN_TTL    = 60 * 60;       // 1h — Garmin tokens expire in ~3600s
const RESP_TTL     = 5 * 60;         // 5 min response cache

// ── Cookie jar ─────────────────────────────────────────────────────────────
class CookieJar {
  constructor() { this.map = new Map(); }
  setFrom(res) {
    const lines = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
    for (const line of lines) {
      const [kv] = line.split(';');
      const eq = kv.indexOf('=');
      if (eq < 0) continue;
      const k = kv.slice(0, eq).trim();
      const v = kv.slice(eq + 1).trim();
      if (k) this.map.set(k, v);
    }
  }
  header() { return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function gFetch(url, jar, opts = {}) {
  const headers = { 'user-agent': USER_AGENT, ...(opts.headers || {}) };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  jar.setFrom(res);
  // follow 30x manually so we keep grabbing cookies
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) {
      return gFetch(new URL(loc, url).toString(), jar, {
        ...opts, method: 'GET', body: undefined,
      });
    }
  }
  return res;
}

// ── Hashing / utilities ────────────────────────────────────────────────────
async function sha256Hex(s) {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randHex(bytes = 16) {
  const u = new Uint8Array(bytes);
  crypto.getRandomValues(u);
  return [...u].map(b => b.toString(16).padStart(2, '0')).join('');
}

// RFC3986 percent-encoding (stricter than encodeURIComponent — must escape !*'() too).
function pctEncode(s) {
  return encodeURIComponent(String(s)).replace(/[!*'()]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function hmacSha1(key, message) {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── OAuth1 signing ─────────────────────────────────────────────────────────
async function signOAuth1({ method, url, params = {}, consumerKey, consumerSecret, tokenSecret = '', extraOAuth = {} }) {
  const oauthParams = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            randHex(16),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
    oauth_version:          '1.0',
    ...extraOAuth,
  };
  // Combine OAuth + query/body params for base string
  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramStr = sortedKeys
    .map(k => `${pctEncode(k)}=${pctEncode(allParams[k])}`)
    .join('&');
  const base = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(paramStr)}`;
  const key = `${pctEncode(consumerSecret)}&${pctEncode(tokenSecret)}`;
  const signature = await hmacSha1(key, base);
  oauthParams.oauth_signature = signature;
  // Header: only oauth_* params, sorted, quoted
  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .filter(k => k.startsWith('oauth_'))
    .sort()
    .map(k => `${pctEncode(k)}="${pctEncode(oauthParams[k])}"`)
    .join(', ');
  return authHeader;
}

// ── OAuth1 consumer key/secret (cached, auto-refreshing) ───────────────────
async function getConsumerKeys(env) {
  try {
    const cached = await env.SYNC_KV.get('garmin:oauth_consumer', 'json');
    if (cached?.consumer_key && cached?.consumer_secret) return cached;
  } catch { /* KV blip — fall through to fetch */ }
  try {
    const r = await fetch(CONSUMER_URL);
    if (r.ok) {
      const j = await r.json();
      if (j.consumer_key && j.consumer_secret) {
        try { await env.SYNC_KV.put('garmin:oauth_consumer', JSON.stringify(j), { expirationTtl: CONSUMER_TTL }); } catch {}
        return j;
      }
    }
  } catch { /* network blip — fall through */ }
  return { consumer_key: FALLBACK_CONSUMER_KEY, consumer_secret: FALLBACK_CONSUMER_SECRET };
}

// ── SSO login → ticket ─────────────────────────────────────────────────────
function ssoSigninUrl() {
  // The embed widget flow (used by Garmin's mobile apps) is more permissive
  // than the full web login — no JS challenge, no fingerprint check.
  const embed = `${SSO_ORIGIN}/sso/embed`;
  const params = new URLSearchParams({
    id: 'gauth-widget',
    embedWidget: 'true',
    gauthHost: `${SSO_ORIGIN}/sso`,
    service: embed,
    source: embed,
    redirectAfterAccountLoginUrl: embed,
    redirectAfterAccountCreationUrl: embed,
  });
  return `${SSO_ORIGIN}/sso/signin?${params.toString()}`;
}

async function getSsoCsrfToken(jar) {
  // First, hit the embed page to seed cookies + cf challenge tokens.
  await gFetch(`${SSO_ORIGIN}/sso/embed`, jar);
  const res = await gFetch(ssoSigninUrl(), jar);
  if (!res.ok) throw new Error(`sso_get_${res.status}`);
  const html = await res.text();
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!m) throw new Error('csrf_not_found');
  return m[1];
}

async function ssoLoginGetTicket(jar, user, pass) {
  const csrf = await getSsoCsrfToken(jar);
  const res = await gFetch(ssoSigninUrl(), jar, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'referer': ssoSigninUrl(),
      'origin': SSO_ORIGIN,
    },
    body: new URLSearchParams({
      username: user,
      password: pass,
      embed: 'true',
      _csrf: csrf,
    }).toString(),
  });
  const html = await res.text();
  // The success page contains: var response_url = "https://sso.garmin.com/sso/embed?ticket=ST-...."
  // (or similar variations). Pull the ticket out.
  const m = html.match(/embed\?ticket=([\w\-]+)/) || html.match(/ticket=([\w\-]+)"/);
  if (!m) {
    if (/Account Locked/i.test(html))                throw new Error('account_locked');
    if (/incorrect|invalid|wrong/i.test(html))       throw new Error('bad_credentials');
    if (/captcha/i.test(html))                       throw new Error('captcha_required');
    if (/multi-factor|verification code/i.test(html)) throw new Error('mfa_required');
    throw new Error('ticket_not_found');
  }
  return m[1];
}

// ── OAuth1 preauthorized token (from ticket) ───────────────────────────────
async function getOAuth1Token(ticket, env) {
  const { consumer_key, consumer_secret } = await getConsumerKeys(env);
  const url = `${API_ORIGIN}/oauth-service/oauth/preauthorized`;
  const params = {
    ticket,
    'login-url': `${SSO_ORIGIN}/sso/embed`,
    'accepts-mfa-tokens': 'true',
  };
  const auth = await signOAuth1({
    method: 'GET', url, params,
    consumerKey: consumer_key, consumerSecret: consumer_secret,
  });
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(fullUrl, {
    headers: {
      'Authorization': auth,
      'User-Agent': APP_USER_AGENT,
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`oauth1_${res.status}:${t.slice(0, 120)}`);
  }
  const text = await res.text();
  const parsed = Object.fromEntries(
    text.split('&').map(p => p.split('=').map(decodeURIComponent))
  );
  if (!parsed.oauth_token || !parsed.oauth_token_secret) throw new Error('oauth1_token_missing');
  return { token: parsed.oauth_token, secret: parsed.oauth_token_secret };
}

// ── OAuth2 access token (exchange OAuth1) ──────────────────────────────────
async function getOAuth2Token(oauth1, env) {
  const { consumer_key, consumer_secret } = await getConsumerKeys(env);
  const url = `${API_ORIGIN}/oauth-service/oauth/exchange/user/2.0`;
  const auth = await signOAuth1({
    method: 'POST', url, params: {},
    consumerKey: consumer_key, consumerSecret: consumer_secret,
    tokenSecret: oauth1.secret,
    extraOAuth: { oauth_token: oauth1.token },
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'User-Agent': APP_USER_AGENT,
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '0',
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`oauth2_${res.status}:${t.slice(0, 120)}`);
  }
  const j = await res.json();
  if (!j.access_token) throw new Error('oauth2_token_missing');
  return j; // { access_token, refresh_token, expires_in, scope, token_type }
}

// ── Cached token getter ────────────────────────────────────────────────────
export async function getGarminAccessToken(user, pass, env, { force = false } = {}) {
  const userHash = await sha256Hex(user.toLowerCase());
  const tokenKey = `garmin:token:${userHash}`;

  if (!force) {
    try {
      const cached = await env.SYNC_KV.get(tokenKey, 'json');
      if (cached?.access_token && cached.expires_at > Date.now() + 60_000) {
        return { access_token: cached.access_token, displayName: cached.displayName, fromCache: true };
      }
    } catch { /* KV blip */ }
  }

  const jar = new CookieJar();
  const ticket = await ssoLoginGetTicket(jar, user, pass);
  const oauth1 = await getOAuth1Token(ticket, env);
  const oauth2 = await getOAuth2Token(oauth1, env);
  const expires_at = Date.now() + Math.max(120_000, (oauth2.expires_in - 120) * 1000);

  // Fetch displayName once — needed for sleep/summary endpoints
  let displayName = null;
  try {
    const r = await fetch(`${API_ORIGIN}/userprofile-service/socialProfile`, {
      headers: { 'Authorization': `Bearer ${oauth2.access_token}`, 'User-Agent': USER_AGENT },
    });
    if (r.ok) {
      const j = await r.json();
      displayName = j.displayName || null;
    }
  } catch { /* non-fatal — fall back to 'me' below */ }

  try {
    await env.SYNC_KV.put(tokenKey, JSON.stringify({
      access_token: oauth2.access_token,
      expires_at,
      displayName,
    }), { expirationTtl: Math.max(60, oauth2.expires_in - 120) });
  } catch { /* KV blip */ }

  return { access_token: oauth2.access_token, displayName, fromCache: false };
}

// ── Authenticated API GET ──────────────────────────────────────────────────
async function apiGet(path, accessToken) {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent':    USER_AGENT,
      'di-backend':    'connectapi.garmin.com',
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`api_${res.status}:${path}:${t.slice(0, 200)}`);
  }
  return res.json();
}

// ── Activity API methods ───────────────────────────────────────────────────
// Activities (runs, strength, cycling, etc) live behind a different set of
// endpoints from the wellness API. The same OAuth2 access_token works for
// both — Garmin's authorization is per-account, not per-scope.

export async function fetchActivityList(accessToken, { start = 0, limit = 20 } = {}) {
  return apiGet(
    `/activitylist-service/activities/search/activities?start=${start}&limit=${limit}`,
    accessToken,
  );
}

export async function fetchActivityDetails(accessToken, activityId) {
  return apiGet(`/activity-service/activity/${encodeURIComponent(activityId)}`, accessToken);
}

// FIT download: Garmin returns a ZIP containing `{activityId}_ACTIVITY.fit`.
// The Worker passes the ZIP through to the Arnold app as raw bytes — the app
// already has a FIT parser, and we'll add a tiny browser-side unzip step
// (much smaller payload than parsing in the Worker and re-shipping).
export async function fetchActivityFitZip(accessToken, activityId) {
  const url = `${API_ORIGIN}/download-service/files/activity/${encodeURIComponent(activityId)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent':    USER_AGENT,
      'di-backend':    'connectapi.garmin.com',
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`fit_${res.status}:${t.slice(0, 200)}`);
  }
  return res.arrayBuffer(); // raw ZIP bytes
}

// ── User profile / direct VO2Max ───────────────────────────────────────────
// Garmin tracks VO2Max independently of any single activity — the watch
// updates it whenever a qualifying run/ride happens. Pulling from the user
// profile gives us the current "watch VO2Max" without having to enrich
// every activity. Used by the Start screen Core summary.
//
// Garmin scatters VO2Max across multiple endpoints depending on account
// type / region / API version. We try them in priority order, returning the
// first non-null value:
//   1. /metrics-service/metrics/maxmet/latest — Garmin's "MaxMET" (≈VO2Max
//      for running). Most reliable when present.
//   2. /userprofile-service/userprofile — vO2MaxRunning / vO2MaxCycling
//   3. /usersummary-service/usersummary/daily/{date} — vO2MaxValue field
//   4. /biometric-service/biometric/biometric_VO2MAX_RUNNING/latest
export async function fetchUserProfileVO2Max(accessToken, displayName) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'User-Agent': USER_AGENT,
    'di-backend': 'connectapi.garmin.com',
  };
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const tryFetch = async (path) => {
    try {
      const r = await fetch(`${API_ORIGIN}${path}`, { headers });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };

  const result = {};
  // 1. MaxMET — Garmin's primary VO2Max metric for running
  if (displayName) {
    const maxmet = await tryFetch(`/metrics-service/metrics/maxmet/latest/${encodeURIComponent(displayName)}`);
    if (Array.isArray(maxmet) && maxmet.length) {
      const latest = maxmet[0];
      const v = Number(latest?.generic?.vo2MaxValue ?? latest?.vo2MaxValue ?? latest?.vO2MaxValue);
      if (Number.isFinite(v) && v > 0) {
        result.vO2MaxRunning = v;
        result.lastRunningUpdate = latest?.calendarDate || latest?.updateTimestamp || null;
        result.source = 'maxmet';
      }
    }
  }

  // 2. User profile (v1)
  if (!result.vO2MaxRunning) {
    const profile = await tryFetch('/userprofile-service/userprofile');
    if (profile) {
      const vRun = Number(profile?.vO2MaxRunning);
      const vCyc = Number(profile?.vO2MaxCycling);
      if (Number.isFinite(vRun) && vRun > 0) {
        result.vO2MaxRunning = vRun;
        result.lastRunningUpdate = profile?.lastRunningVo2MaxUpdateDate || null;
        result.source = result.source || 'profile';
      }
      if (Number.isFinite(vCyc) && vCyc > 0) {
        result.vO2MaxCycling = vCyc;
        result.lastCyclingUpdate = profile?.lastCyclingVo2MaxUpdateDate || null;
      }
    }
  }

  // 3. Personal info subprofile
  if (!result.vO2MaxRunning) {
    const personal = await tryFetch('/userprofile-service/userprofile/personal-information');
    if (personal) {
      const v = Number(personal?.userInfo?.vO2MaxRunning ?? personal?.vO2MaxRunning);
      if (Number.isFinite(v) && v > 0) {
        result.vO2MaxRunning = v;
        result.source = result.source || 'personal-info';
      }
    }
  }

  // 4. Daily summary (sometimes has vO2MaxValue at the day level)
  if (!result.vO2MaxRunning && displayName) {
    const summary = await tryFetch(`/usersummary-service/usersummary/daily/${encodeURIComponent(displayName)}?calendarDate=${todayStr}`);
    if (summary) {
      const v = Number(summary?.vO2MaxValue ?? summary?.vO2MaxRunning);
      if (Number.isFinite(v) && v > 0) {
        result.vO2MaxRunning = v;
        result.source = result.source || 'daily-summary';
      }
    }
  }

  // Personal-records endpoint deliberately NOT used here — Garmin's PR
  // typeIds aren't standardized for VO2Max across regions/account ages, and
  // earlier testing showed typeId 12 actually returned "longest run distance
  // in meters" (e.g., 61397 m = 38 miles), not VO2Max. Misleading data is
  // worse than no data, so the activity-enrichment path is the canonical
  // fallback (each qualifying run's DTO has vO2MaxValue server-computed).

  return Object.keys(result).length ? result : null;
}

// ── Wellness API methods ───────────────────────────────────────────────────
export async function fetchSleepData(accessToken, displayName, date) {
  const id = displayName || 'me';
  return apiGet(
    `/wellness-service/wellness/dailySleepData/${encodeURIComponent(id)}?date=${date}&nonSleepBufferMinutes=60`,
    accessToken,
  );
}

export async function fetchDailyStress(accessToken, date) {
  return apiGet(`/wellness-service/wellness/dailyStress/${date}`, accessToken);
}

export async function fetchBodyBattery(accessToken, date) {
  // Reports endpoint returns: [{ date, charged, drained, bodyBatteryValuesArray, ... }]
  return apiGet(
    `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`,
    accessToken,
  );
}

export async function fetchTrainingReadiness(accessToken, date) {
  // Returns array (latest reading first); we return the whole thing — caller picks.
  return apiGet(`/metrics-service/metrics/trainingreadiness/${date}`, accessToken);
}

export async function fetchDailySummary(accessToken, displayName, date) {
  const id = displayName || 'me';
  return apiGet(
    `/usersummary-service/usersummary/daily/${encodeURIComponent(id)}?calendarDate=${date}`,
    accessToken,
  );
}

// ── High-level: pull-everything-for-a-date (with cache) ────────────────────
export async function fetchGarminBundle(user, pass, date, env, { force = false } = {}) {
  const userHash = await sha256Hex(user.toLowerCase());
  const cacheKey = `garmin:resp:${userHash}:${date}:bundle`;

  if (!force) {
    try {
      const cached = await env.SYNC_KV.get(cacheKey, 'json');
      if (cached) return { ...cached, cached: true };
    } catch { /* */ }
  }

  const { access_token, displayName } = await getGarminAccessToken(user, pass, env);

  // Run wellness pulls in parallel — each is independent.
  const [sleep, stress, body, readiness, summary] = await Promise.allSettled([
    fetchSleepData(access_token, displayName, date),
    fetchDailyStress(access_token, date),
    fetchBodyBattery(access_token, date),
    fetchTrainingReadiness(access_token, date),
    fetchDailySummary(access_token, displayName, date),
  ]);

  const result = {
    date,
    displayName,
    sleep:     sleep.status     === 'fulfilled' ? sleep.value     : { error: String(sleep.reason?.message || sleep.reason) },
    stress:    stress.status    === 'fulfilled' ? stress.value    : { error: String(stress.reason?.message || stress.reason) },
    body:      body.status      === 'fulfilled' ? body.value      : { error: String(body.reason?.message || body.reason) },
    readiness: readiness.status === 'fulfilled' ? readiness.value : { error: String(readiness.reason?.message || readiness.reason) },
    summary:   summary.status   === 'fulfilled' ? summary.value   : { error: String(summary.reason?.message || summary.reason) },
    fetchedAt: Date.now(),
  };

  try { await env.SYNC_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: RESP_TTL }); } catch {}
  return { ...result, cached: false };
}

// ── HTTP route handlers ────────────────────────────────────────────────────
function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

function errStatus(msg) {
  if (!msg) return 502;
  if (msg.startsWith('bad_credentials'))  return 401;
  if (msg.startsWith('account_locked'))   return 423;
  if (msg.startsWith('captcha_required')) return 401;
  if (msg.startsWith('mfa_required'))     return 401;
  if (msg.startsWith('csrf_not_found'))   return 502;
  if (msg.startsWith('ticket_not_found')) return 401;
  return 502;
}

async function readBody(request) {
  let body;
  try { body = await request.json(); }
  catch { return [null, jsonResp(400, { error: 'bad_json' })]; }
  const { user, pass, date } = body || {};
  if (!user || !pass)  return [null, jsonResp(400, { error: 'missing_credentials' })];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [null, jsonResp(400, { error: 'bad_date' })];
  return [{ user, pass, date }, null];
}

export async function handleGarminSleep(request, env) {
  const [body, err] = await readBody(request);
  if (err) return err;
  try {
    const { access_token, displayName } = await getGarminAccessToken(body.user, body.pass, env);
    const sleep = await fetchSleepData(access_token, displayName, body.date);
    return jsonResp(200, { date: body.date, sleep, fetchedAt: Date.now() });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}

export async function handleGarminWellness(request, env) {
  const [body, err] = await readBody(request);
  if (err) return err;
  try {
    const { access_token, displayName } = await getGarminAccessToken(body.user, body.pass, env);
    const [stress, bb, summary] = await Promise.allSettled([
      fetchDailyStress(access_token, body.date),
      fetchBodyBattery(access_token, body.date),
      fetchDailySummary(access_token, displayName, body.date),
    ]);
    return jsonResp(200, {
      date: body.date,
      stress:  stress.status  === 'fulfilled' ? stress.value  : { error: String(stress.reason?.message || stress.reason) },
      body:    bb.status      === 'fulfilled' ? bb.value      : { error: String(bb.reason?.message || bb.reason) },
      summary: summary.status === 'fulfilled' ? summary.value : { error: String(summary.reason?.message || summary.reason) },
      fetchedAt: Date.now(),
    });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}

export async function handleGarminReadiness(request, env) {
  const [body, err] = await readBody(request);
  if (err) return err;
  try {
    const { access_token } = await getGarminAccessToken(body.user, body.pass, env);
    const readiness = await fetchTrainingReadiness(access_token, body.date);
    return jsonResp(200, { date: body.date, readiness, fetchedAt: Date.now() });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}

// ── Activity route handlers ────────────────────────────────────────────────
// All take {user, pass, ...} POST bodies. The activity ID for details/fit
// comes via the URL path so we can keep the body shape uniform.

export async function handleGarminActivitiesList(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResp(400, { error: 'bad_json' }); }
  const { user, pass } = body || {};
  if (!user || !pass) return jsonResp(400, { error: 'missing_credentials' });
  const start = Math.max(0, Math.min(1000, Number(body.start) || 0));
  const limit = Math.max(1, Math.min(100, Number(body.limit) || 20));
  try {
    const { access_token } = await getGarminAccessToken(user, pass, env);
    const activities = await fetchActivityList(access_token, { start, limit });
    return jsonResp(200, { activities, fetchedAt: Date.now(), count: Array.isArray(activities) ? activities.length : 0 });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}

export async function handleGarminActivityDetails(request, env, activityId) {
  let body;
  try { body = await request.json(); } catch { return jsonResp(400, { error: 'bad_json' }); }
  const { user, pass } = body || {};
  if (!user || !pass) return jsonResp(400, { error: 'missing_credentials' });
  if (!/^\d+$/.test(String(activityId))) return jsonResp(400, { error: 'bad_activity_id' });
  try {
    const { access_token } = await getGarminAccessToken(user, pass, env);
    const details = await fetchActivityDetails(access_token, activityId);
    return jsonResp(200, { activityId, details, fetchedAt: Date.now() });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}

export async function handleGarminActivityFit(request, env, activityId) {
  let body;
  try { body = await request.json(); } catch { return jsonResp(400, { error: 'bad_json' }); }
  const { user, pass } = body || {};
  if (!user || !pass) return jsonResp(400, { error: 'missing_credentials' });
  if (!/^\d+$/.test(String(activityId))) return jsonResp(400, { error: 'bad_activity_id' });
  try {
    const { access_token } = await getGarminAccessToken(user, pass, env);
    const zipBuf = await fetchActivityFitZip(access_token, activityId);
    return new Response(zipBuf, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${activityId}_ACTIVITY.zip"`,
        'X-Activity-Id': String(activityId),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Activity-Id, Content-Disposition',
      },
    });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}

export async function handleGarminVO2Max(request, env) {
  // VO2Max doesn't need a date — pulls the current watch value from the user
  // profile. Read body directly with just credentials.
  let body;
  try { body = await request.json(); } catch { return jsonResp(400, { error: 'bad_json' }); }
  const { user, pass } = body || {};
  if (!user || !pass) return jsonResp(400, { error: 'missing_credentials' });
  try {
    const { access_token, displayName } = await getGarminAccessToken(user, pass, env);
    const v = await fetchUserProfileVO2Max(access_token, displayName);
    return jsonResp(200, { vo2max: v, fetchedAt: Date.now(), displayName });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}

export async function handleGarminAll(request, env) {
  const [body, err] = await readBody(request);
  if (err) return err;
  try {
    const bundle = await fetchGarminBundle(body.user, body.pass, body.date, env);
    return jsonResp(200, bundle);
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: 'garmin_failed', detail: msg });
  }
}
