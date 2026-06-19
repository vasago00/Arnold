var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/garmin-relay.js
var SSO_ORIGIN = "https://sso.garmin.com";
var API_ORIGIN = "https://connectapi.garmin.com";
var CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
var USER_AGENT = "GCM-iOS-5.7.2.1";
var APP_USER_AGENT = "com.garmin.android.apps.connectmobile";
var FALLBACK_CONSUMER_KEY = "fc3e99d2-118c-44b8-8ae3-03370dde24c0";
var FALLBACK_CONSUMER_SECRET = "E08WAR897WEz2sH3EOkQT9gkKWk9uZUQjIYE9RJfLBl6WeQ7zTl0RfL2srVJFWMc";
var CONSUMER_TTL = 7 * 24 * 60 * 60;
var TOKEN_TTL = 60 * 60;
var RESP_TTL = 5 * 60;
var CookieJar = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  setFrom(res) {
    const lines = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const line of lines) {
      const [kv] = line.split(";");
      const eq = kv.indexOf("=");
      if (eq < 0)
        continue;
      const k = kv.slice(0, eq).trim();
      const v = kv.slice(eq + 1).trim();
      if (k)
        this.map.set(k, v);
    }
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
};
__name(CookieJar, "CookieJar");
async function gFetch(url, jar, opts = {}) {
  const headers = { "user-agent": USER_AGENT, ...opts.headers || {} };
  const cookie = jar.header();
  if (cookie)
    headers.cookie = cookie;
  const res = await fetch(url, { ...opts, headers, redirect: "manual" });
  jar.setFrom(res);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      return gFetch(new URL(loc, url).toString(), jar, {
        ...opts,
        method: "GET",
        body: void 0
      });
    }
  }
  return res;
}
__name(gFetch, "gFetch");
async function sha256Hex(s) {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function randHex(bytes = 16) {
  const u = new Uint8Array(bytes);
  crypto.getRandomValues(u);
  return [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randHex, "randHex");
function pctEncode(s) {
  return encodeURIComponent(String(s)).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
__name(pctEncode, "pctEncode");
async function hmacSha1(key, message) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
__name(hmacSha1, "hmacSha1");
async function signOAuth1({ method, url, params = {}, consumerKey, consumerSecret, tokenSecret = "", extraOAuth = {} }) {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randHex(16),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1e3).toString(),
    oauth_version: "1.0",
    ...extraOAuth
  };
  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramStr = sortedKeys.map((k) => `${pctEncode(k)}=${pctEncode(allParams[k])}`).join("&");
  const base = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(paramStr)}`;
  const key = `${pctEncode(consumerSecret)}&${pctEncode(tokenSecret)}`;
  const signature = await hmacSha1(key, base);
  oauthParams.oauth_signature = signature;
  const authHeader = "OAuth " + Object.keys(oauthParams).filter((k) => k.startsWith("oauth_")).sort().map((k) => `${pctEncode(k)}="${pctEncode(oauthParams[k])}"`).join(", ");
  return authHeader;
}
__name(signOAuth1, "signOAuth1");
async function getConsumerKeys(env) {
  try {
    const cached = await env.SYNC_KV.get("garmin:oauth_consumer", "json");
    if (cached?.consumer_key && cached?.consumer_secret)
      return cached;
  } catch {
  }
  try {
    const r = await fetch(CONSUMER_URL);
    if (r.ok) {
      const j = await r.json();
      if (j.consumer_key && j.consumer_secret) {
        try {
          await env.SYNC_KV.put("garmin:oauth_consumer", JSON.stringify(j), { expirationTtl: CONSUMER_TTL });
        } catch {
        }
        return j;
      }
    }
  } catch {
  }
  return { consumer_key: FALLBACK_CONSUMER_KEY, consumer_secret: FALLBACK_CONSUMER_SECRET };
}
__name(getConsumerKeys, "getConsumerKeys");
function ssoSigninUrl() {
  const embed = `${SSO_ORIGIN}/sso/embed`;
  const params = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: `${SSO_ORIGIN}/sso`,
    service: embed,
    source: embed,
    redirectAfterAccountLoginUrl: embed,
    redirectAfterAccountCreationUrl: embed
  });
  return `${SSO_ORIGIN}/sso/signin?${params.toString()}`;
}
__name(ssoSigninUrl, "ssoSigninUrl");
async function getSsoCsrfToken(jar) {
  await gFetch(`${SSO_ORIGIN}/sso/embed`, jar);
  const res = await gFetch(ssoSigninUrl(), jar);
  if (!res.ok)
    throw new Error(`sso_get_${res.status}`);
  const html = await res.text();
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!m)
    throw new Error("csrf_not_found");
  return m[1];
}
__name(getSsoCsrfToken, "getSsoCsrfToken");
async function ssoLoginGetTicket(jar, user, pass) {
  const csrf = await getSsoCsrfToken(jar);
  const res = await gFetch(ssoSigninUrl(), jar, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "referer": ssoSigninUrl(),
      "origin": SSO_ORIGIN
    },
    body: new URLSearchParams({
      username: user,
      password: pass,
      embed: "true",
      _csrf: csrf
    }).toString()
  });
  const html = await res.text();
  const m = html.match(/embed\?ticket=([\w\-]+)/) || html.match(/ticket=([\w\-]+)"/);
  if (!m) {
    if (/Account Locked/i.test(html))
      throw new Error("account_locked");
    if (/incorrect|invalid|wrong/i.test(html))
      throw new Error("bad_credentials");
    if (/captcha/i.test(html))
      throw new Error("captcha_required");
    if (/multi-factor|verification code/i.test(html))
      throw new Error("mfa_required");
    throw new Error("ticket_not_found");
  }
  return m[1];
}
__name(ssoLoginGetTicket, "ssoLoginGetTicket");
async function getOAuth1Token(ticket, env) {
  const { consumer_key, consumer_secret } = await getConsumerKeys(env);
  const url = `${API_ORIGIN}/oauth-service/oauth/preauthorized`;
  const params = {
    ticket,
    "login-url": `${SSO_ORIGIN}/sso/embed`,
    "accepts-mfa-tokens": "true"
  };
  const auth = await signOAuth1({
    method: "GET",
    url,
    params,
    consumerKey: consumer_key,
    consumerSecret: consumer_secret
  });
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(fullUrl, {
    headers: {
      "Authorization": auth,
      "User-Agent": APP_USER_AGENT
    }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`oauth1_${res.status}:${t.slice(0, 120)}`);
  }
  const text2 = await res.text();
  const parsed = Object.fromEntries(
    text2.split("&").map((p) => p.split("=").map(decodeURIComponent))
  );
  if (!parsed.oauth_token || !parsed.oauth_token_secret)
    throw new Error("oauth1_token_missing");
  return { token: parsed.oauth_token, secret: parsed.oauth_token_secret };
}
__name(getOAuth1Token, "getOAuth1Token");
async function getOAuth2Token(oauth1, env) {
  const { consumer_key, consumer_secret } = await getConsumerKeys(env);
  const url = `${API_ORIGIN}/oauth-service/oauth/exchange/user/2.0`;
  const auth = await signOAuth1({
    method: "POST",
    url,
    params: {},
    consumerKey: consumer_key,
    consumerSecret: consumer_secret,
    tokenSecret: oauth1.secret,
    extraOAuth: { oauth_token: oauth1.token }
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "User-Agent": APP_USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
      "content-length": "0"
    }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`oauth2_${res.status}:${t.slice(0, 120)}`);
  }
  const j = await res.json();
  if (!j.access_token)
    throw new Error("oauth2_token_missing");
  return j;
}
__name(getOAuth2Token, "getOAuth2Token");
async function getGarminAccessToken(user, pass, env, { force = false } = {}) {
  const userHash = await sha256Hex(user.toLowerCase());
  const tokenKey = `garmin:token:${userHash}`;
  if (!force) {
    try {
      const cached = await env.SYNC_KV.get(tokenKey, "json");
      if (cached?.access_token && cached.expires_at > Date.now() + 6e4) {
        return { access_token: cached.access_token, displayName: cached.displayName, fromCache: true };
      }
    } catch {
    }
  }
  const jar = new CookieJar();
  const ticket = await ssoLoginGetTicket(jar, user, pass);
  const oauth1 = await getOAuth1Token(ticket, env);
  const oauth2 = await getOAuth2Token(oauth1, env);
  const expires_at = Date.now() + Math.max(12e4, (oauth2.expires_in - 120) * 1e3);
  let displayName = null;
  try {
    const r = await fetch(`${API_ORIGIN}/userprofile-service/socialProfile`, {
      headers: { "Authorization": `Bearer ${oauth2.access_token}`, "User-Agent": USER_AGENT }
    });
    if (r.ok) {
      const j = await r.json();
      displayName = j.displayName || null;
    }
  } catch {
  }
  try {
    await env.SYNC_KV.put(tokenKey, JSON.stringify({
      access_token: oauth2.access_token,
      expires_at,
      displayName
    }), { expirationTtl: Math.max(60, oauth2.expires_in - 120) });
  } catch {
  }
  return { access_token: oauth2.access_token, displayName, fromCache: false };
}
__name(getGarminAccessToken, "getGarminAccessToken");
async function apiGet(path, accessToken) {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "di-backend": "connectapi.garmin.com"
    }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`api_${res.status}:${path}:${t.slice(0, 200)}`);
  }
  return res.json();
}
__name(apiGet, "apiGet");
async function fetchActivityList(accessToken, { start = 0, limit = 20 } = {}) {
  return apiGet(
    `/activitylist-service/activities/search/activities?start=${start}&limit=${limit}`,
    accessToken
  );
}
__name(fetchActivityList, "fetchActivityList");
async function fetchActivityDetails(accessToken, activityId) {
  return apiGet(`/activity-service/activity/${encodeURIComponent(activityId)}`, accessToken);
}
__name(fetchActivityDetails, "fetchActivityDetails");
async function fetchActivityFitZip(accessToken, activityId) {
  const url = `${API_ORIGIN}/download-service/files/activity/${encodeURIComponent(activityId)}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "di-backend": "connectapi.garmin.com"
    }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`fit_${res.status}:${t.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}
__name(fetchActivityFitZip, "fetchActivityFitZip");
async function fetchWeightRange(accessToken, startDate, endDate) {
  return apiGet(
    `/weight-service/weight/range/${encodeURIComponent(startDate)}/${encodeURIComponent(endDate)}?includeAll=true`,
    accessToken
  );
}
__name(fetchWeightRange, "fetchWeightRange");
async function fetchUserProfileVO2Max(accessToken, displayName) {
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "User-Agent": USER_AGENT,
    "di-backend": "connectapi.garmin.com"
  };
  const todayStr = (() => {
    const d = /* @__PURE__ */ new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const tryFetch = /* @__PURE__ */ __name(async (path) => {
    try {
      const r = await fetch(`${API_ORIGIN}${path}`, { headers });
      if (!r.ok)
        return null;
      return await r.json();
    } catch {
      return null;
    }
  }, "tryFetch");
  const result = {};
  if (displayName) {
    const maxmet = await tryFetch(`/metrics-service/metrics/maxmet/latest/${encodeURIComponent(displayName)}`);
    if (Array.isArray(maxmet) && maxmet.length) {
      const latest = maxmet[0];
      const v = Number(latest?.generic?.vo2MaxValue ?? latest?.vo2MaxValue ?? latest?.vO2MaxValue);
      if (Number.isFinite(v) && v > 0) {
        result.vO2MaxRunning = v;
        result.lastRunningUpdate = latest?.calendarDate || latest?.updateTimestamp || null;
        result.source = "maxmet";
      }
    }
  }
  if (!result.vO2MaxRunning) {
    const profile = await tryFetch("/userprofile-service/userprofile");
    if (profile) {
      const vRun = Number(profile?.vO2MaxRunning);
      const vCyc = Number(profile?.vO2MaxCycling);
      if (Number.isFinite(vRun) && vRun > 0) {
        result.vO2MaxRunning = vRun;
        result.lastRunningUpdate = profile?.lastRunningVo2MaxUpdateDate || null;
        result.source = result.source || "profile";
      }
      if (Number.isFinite(vCyc) && vCyc > 0) {
        result.vO2MaxCycling = vCyc;
        result.lastCyclingUpdate = profile?.lastCyclingVo2MaxUpdateDate || null;
      }
    }
  }
  if (!result.vO2MaxRunning) {
    const personal = await tryFetch("/userprofile-service/userprofile/personal-information");
    if (personal) {
      const v = Number(personal?.userInfo?.vO2MaxRunning ?? personal?.vO2MaxRunning);
      if (Number.isFinite(v) && v > 0) {
        result.vO2MaxRunning = v;
        result.source = result.source || "personal-info";
      }
    }
  }
  if (!result.vO2MaxRunning && displayName) {
    const summary = await tryFetch(`/usersummary-service/usersummary/daily/${encodeURIComponent(displayName)}?calendarDate=${todayStr}`);
    if (summary) {
      const v = Number(summary?.vO2MaxValue ?? summary?.vO2MaxRunning);
      if (Number.isFinite(v) && v > 0) {
        result.vO2MaxRunning = v;
        result.source = result.source || "daily-summary";
      }
    }
  }
  return Object.keys(result).length ? result : null;
}
__name(fetchUserProfileVO2Max, "fetchUserProfileVO2Max");
async function fetchSleepData(accessToken, displayName, date) {
  const id = displayName || "me";
  return apiGet(
    `/wellness-service/wellness/dailySleepData/${encodeURIComponent(id)}?date=${date}&nonSleepBufferMinutes=60`,
    accessToken
  );
}
__name(fetchSleepData, "fetchSleepData");
async function fetchDailyStress(accessToken, date) {
  return apiGet(`/wellness-service/wellness/dailyStress/${date}`, accessToken);
}
__name(fetchDailyStress, "fetchDailyStress");
async function fetchBodyBattery(accessToken, date) {
  return apiGet(
    `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`,
    accessToken
  );
}
__name(fetchBodyBattery, "fetchBodyBattery");
async function fetchTrainingReadiness(accessToken, date) {
  return apiGet(`/metrics-service/metrics/trainingreadiness/${date}`, accessToken);
}
__name(fetchTrainingReadiness, "fetchTrainingReadiness");
async function fetchDailySummary(accessToken, displayName, date) {
  const id = displayName || "me";
  return apiGet(
    `/usersummary-service/usersummary/daily/${encodeURIComponent(id)}?calendarDate=${date}`,
    accessToken
  );
}
__name(fetchDailySummary, "fetchDailySummary");
async function fetchGarminBundle(user, pass, date, env, { force = false } = {}) {
  const userHash = await sha256Hex(user.toLowerCase());
  const cacheKey = `garmin:resp:${userHash}:${date}:bundle`;
  if (!force) {
    try {
      const cached = await env.SYNC_KV.get(cacheKey, "json");
      if (cached)
        return { ...cached, cached: true };
    } catch {
    }
  }
  const { access_token, displayName } = await getGarminAccessToken(user, pass, env);
  const [sleep, stress, body, readiness, summary] = await Promise.allSettled([
    fetchSleepData(access_token, displayName, date),
    fetchDailyStress(access_token, date),
    fetchBodyBattery(access_token, date),
    fetchTrainingReadiness(access_token, date),
    fetchDailySummary(access_token, displayName, date)
  ]);
  const result = {
    date,
    displayName,
    sleep: sleep.status === "fulfilled" ? sleep.value : { error: String(sleep.reason?.message || sleep.reason) },
    stress: stress.status === "fulfilled" ? stress.value : { error: String(stress.reason?.message || stress.reason) },
    body: body.status === "fulfilled" ? body.value : { error: String(body.reason?.message || body.reason) },
    readiness: readiness.status === "fulfilled" ? readiness.value : { error: String(readiness.reason?.message || readiness.reason) },
    summary: summary.status === "fulfilled" ? summary.value : { error: String(summary.reason?.message || summary.reason) },
    fetchedAt: Date.now()
  };
  try {
    await env.SYNC_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: RESP_TTL });
  } catch {
  }
  return { ...result, cached: false };
}
__name(fetchGarminBundle, "fetchGarminBundle");
function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type"
    }
  });
}
__name(jsonResp, "jsonResp");
function errStatus(msg) {
  if (!msg)
    return 502;
  if (msg.startsWith("bad_credentials"))
    return 401;
  if (msg.startsWith("account_locked"))
    return 423;
  if (msg.startsWith("captcha_required"))
    return 401;
  if (msg.startsWith("mfa_required"))
    return 401;
  if (msg.startsWith("csrf_not_found"))
    return 502;
  if (msg.startsWith("ticket_not_found"))
    return 401;
  return 502;
}
__name(errStatus, "errStatus");
async function readBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return [null, jsonResp(400, { error: "bad_json" })];
  }
  const { user, pass, date } = body || {};
  if (!user || !pass)
    return [null, jsonResp(400, { error: "missing_credentials" })];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return [null, jsonResp(400, { error: "bad_date" })];
  return [{ user, pass, date }, null];
}
__name(readBody, "readBody");
async function handleGarminSleep(request, env) {
  const [body, err] = await readBody(request);
  if (err)
    return err;
  try {
    const { access_token, displayName } = await getGarminAccessToken(body.user, body.pass, env);
    const sleep = await fetchSleepData(access_token, displayName, body.date);
    return jsonResp(200, { date: body.date, sleep, fetchedAt: Date.now() });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminSleep, "handleGarminSleep");
async function handleGarminWellness(request, env) {
  const [body, err] = await readBody(request);
  if (err)
    return err;
  try {
    const { access_token, displayName } = await getGarminAccessToken(body.user, body.pass, env);
    const [stress, bb, summary] = await Promise.allSettled([
      fetchDailyStress(access_token, body.date),
      fetchBodyBattery(access_token, body.date),
      fetchDailySummary(access_token, displayName, body.date)
    ]);
    return jsonResp(200, {
      date: body.date,
      stress: stress.status === "fulfilled" ? stress.value : { error: String(stress.reason?.message || stress.reason) },
      body: bb.status === "fulfilled" ? bb.value : { error: String(bb.reason?.message || bb.reason) },
      summary: summary.status === "fulfilled" ? summary.value : { error: String(summary.reason?.message || summary.reason) },
      fetchedAt: Date.now()
    });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminWellness, "handleGarminWellness");
async function handleGarminReadiness(request, env) {
  const [body, err] = await readBody(request);
  if (err)
    return err;
  try {
    const { access_token } = await getGarminAccessToken(body.user, body.pass, env);
    const readiness = await fetchTrainingReadiness(access_token, body.date);
    return jsonResp(200, { date: body.date, readiness, fetchedAt: Date.now() });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminReadiness, "handleGarminReadiness");
async function handleGarminActivitiesList(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp(400, { error: "bad_json" });
  }
  const { user, pass } = body || {};
  if (!user || !pass)
    return jsonResp(400, { error: "missing_credentials" });
  const start = Math.max(0, Math.min(1e3, Number(body.start) || 0));
  const limit = Math.max(1, Math.min(100, Number(body.limit) || 20));
  try {
    const { access_token } = await getGarminAccessToken(user, pass, env);
    const activities = await fetchActivityList(access_token, { start, limit });
    return jsonResp(200, { activities, fetchedAt: Date.now(), count: Array.isArray(activities) ? activities.length : 0 });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminActivitiesList, "handleGarminActivitiesList");
async function handleGarminActivityDetails(request, env, activityId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp(400, { error: "bad_json" });
  }
  const { user, pass } = body || {};
  if (!user || !pass)
    return jsonResp(400, { error: "missing_credentials" });
  if (!/^\d+$/.test(String(activityId)))
    return jsonResp(400, { error: "bad_activity_id" });
  try {
    const { access_token } = await getGarminAccessToken(user, pass, env);
    const details = await fetchActivityDetails(access_token, activityId);
    return jsonResp(200, { activityId, details, fetchedAt: Date.now() });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminActivityDetails, "handleGarminActivityDetails");
async function handleGarminActivityFit(request, env, activityId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp(400, { error: "bad_json" });
  }
  const { user, pass } = body || {};
  if (!user || !pass)
    return jsonResp(400, { error: "missing_credentials" });
  if (!/^\d+$/.test(String(activityId)))
    return jsonResp(400, { error: "bad_activity_id" });
  try {
    const { access_token } = await getGarminAccessToken(user, pass, env);
    const zipBuf = await fetchActivityFitZip(access_token, activityId);
    return new Response(zipBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${activityId}_ACTIVITY.zip"`,
        "X-Activity-Id": String(activityId),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "X-Activity-Id, Content-Disposition"
      }
    });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminActivityFit, "handleGarminActivityFit");
async function handleGarminWeight(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp(400, { error: "bad_json" });
  }
  const { user, pass } = body || {};
  if (!user || !pass)
    return jsonResp(400, { error: "missing_credentials" });
  const today = /* @__PURE__ */ new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const past30 = new Date(today.getTime() - 30 * 86400 * 1e3);
  const defaultStart = past30.toISOString().slice(0, 10);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate)) ? body.startDate : defaultStart;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.endDate)) ? body.endDate : defaultEnd;
  try {
    const { access_token } = await getGarminAccessToken(user, pass, env);
    const weighIns = await fetchWeightRange(access_token, startDate, endDate);
    return jsonResp(200, { weighIns, startDate, endDate, fetchedAt: Date.now() });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminWeight, "handleGarminWeight");
async function handleGarminVO2Max(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp(400, { error: "bad_json" });
  }
  const { user, pass } = body || {};
  if (!user || !pass)
    return jsonResp(400, { error: "missing_credentials" });
  try {
    const { access_token, displayName } = await getGarminAccessToken(user, pass, env);
    const v = await fetchUserProfileVO2Max(access_token, displayName);
    return jsonResp(200, { vo2max: v, fetchedAt: Date.now(), displayName });
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminVO2Max, "handleGarminVO2Max");
async function handleGarminAll(request, env) {
  const [body, err] = await readBody(request);
  if (err)
    return err;
  try {
    const bundle = await fetchGarminBundle(body.user, body.pass, body.date, env);
    return jsonResp(200, bundle);
  } catch (e) {
    const msg = String(e.message || e);
    return jsonResp(errStatus(msg), { error: "garmin_failed", detail: msg });
  }
}
__name(handleGarminAll, "handleGarminAll");

// src/worker.js
var MAX_BLOB_BYTES = 8 * 1024 * 1024;
var ID_PATTERN = /^[a-f0-9]{32,128}$/;
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string")
    return false;
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function requireAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix))
    return false;
  const token = header.slice(prefix.length);
  const expected = env.SYNC_TOKEN || "";
  if (!expected)
    return false;
  return timingSafeEqual(token, expected);
}
__name(requireAuth, "requireAuth");
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match",
  "Access-Control-Max-Age": "86400"
};
function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra }
  });
}
__name(json, "json");
function text(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", ...CORS_HEADERS, ...extra }
  });
}
__name(text, "text");
async function handleGet(id, env) {
  const meta = await env.SYNC_KV.getWithMetadata(`blob:${id}`, { type: "arrayBuffer" });
  if (!meta || !meta.value)
    return json(404, { error: "not_found" });
  const updatedAt = meta.metadata && meta.metadata.updatedAt || 0;
  return new Response(meta.value, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, no-store",
      "ETag": `"${updatedAt}"`,
      "X-Updated-At": String(updatedAt),
      ...CORS_HEADERS
    }
  });
}
__name(handleGet, "handleGet");
async function handlePut(id, request, env) {
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > MAX_BLOB_BYTES)
    return json(413, { error: "too_large", limit: MAX_BLOB_BYTES });
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0)
    return json(400, { error: "empty_body" });
  if (buf.byteLength > MAX_BLOB_BYTES)
    return json(413, { error: "too_large", limit: MAX_BLOB_BYTES });
  const updatedAt = Date.now();
  await env.SYNC_KV.put(`blob:${id}`, buf, {
    metadata: { updatedAt, bytes: buf.byteLength }
  });
  return json(200, { ok: true, bytes: buf.byteLength, updatedAt });
}
__name(handlePut, "handlePut");
async function handleDelete(id, env) {
  await env.SYNC_KV.delete(`blob:${id}`);
  return json(200, { ok: true });
}
__name(handleDelete, "handleDelete");
var CRONO_SESS_TTL = 24 * 60 * 60;
var CRONO_CACHE_TTL = 5 * 60;
var CRONO_UA = "arnold-worker/1.0";
var CRONO_CT_GWT = "text/x-gwt-rpc; charset=UTF-8";
var CRONO_GWT_BASE = "https://cronometer.com/cronometer/";
var CRONO_EXPORT_MAP = {
  daily_summary: "dailySummary",
  servings: "servings",
  exercises: "exercises",
  biometrics: "biometrics",
  notes: "notes"
};
var CRONO_GWT_PERM_DEFAULT = "CBC38FBB0A1527BD5E68722DD9DABD27";
var CRONO_GWT_HEADER_DEFAULT = "76FC4464E20E53D16663AC9A96A486B3";
var GWT_AUTHENTICATE = "7|0|5|https://cronometer.com/cronometer/|{gwt_header}|com.cronometer.shared.rpc.CronometerService|authenticate|java.lang.Integer/3438268394|1|2|3|4|1|5|5|-300|";
var GWT_AUTH_TOKEN = "7|0|8|https://cronometer.com/cronometer/|{gwt_header}|com.cronometer.shared.rpc.CronometerService|generateAuthorizationToken|java.lang.String/2004016611|I|com.cronometer.shared.user.AuthScope/2065601159|{nonce}|1|2|3|4|4|5|6|6|7|8|{user_id}|3600|7|2|";
async function sha256Hex2(s) {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex2, "sha256Hex");
var CookieJar2 = class {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init || {}));
  }
  setFrom(response) {
    const raw = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const line of raw) {
      const [kv] = line.split(";");
      const eq = kv.indexOf("=");
      if (eq < 0)
        continue;
      const k = kv.slice(0, eq).trim();
      const v = kv.slice(eq + 1).trim();
      if (k)
        this.map.set(k, v);
    }
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  toObject() {
    return Object.fromEntries(this.map);
  }
};
__name(CookieJar2, "CookieJar");
async function cronoFetch(url, jar, opts = {}) {
  const headers = { "user-agent": CRONO_UA, ...opts.headers || {} };
  const cookie = jar.header();
  if (cookie)
    headers.cookie = cookie;
  const res = await fetch(url, { ...opts, headers, redirect: "manual" });
  jar.setFrom(res);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc)
      return cronoFetch(new URL(loc, url).toString(), jar, { ...opts, method: "GET", body: void 0 });
  }
  return res;
}
__name(cronoFetch, "cronoFetch");
async function discoverGwtHashes(jar) {
  let perm = CRONO_GWT_PERM_DEFAULT;
  let hdr = CRONO_GWT_HEADER_DEFAULT;
  try {
    const r1 = await cronoFetch("https://cronometer.com/cronometer/cronometer.nocache.js", jar);
    const t1 = await r1.text();
    const m1 = t1.match(/='([A-F0-9]{32})'/);
    if (m1)
      perm = m1[1];
    const r2 = await cronoFetch(`https://cronometer.com/cronometer/${perm}.cache.js`, jar);
    const t2 = await r2.text();
    const m2 = t2.match(/'app','([A-F0-9]{32})'/);
    if (m2)
      hdr = m2[1];
  } catch {
  }
  return { perm, hdr };
}
__name(discoverGwtHashes, "discoverGwtHashes");
async function cronoLogin(jar, user, pass) {
  const page = await cronoFetch("https://cronometer.com/login/", jar);
  const body = await page.text();
  const m = body.match(/name="anticsrf"\s+value="([^"]+)"/);
  if (!m)
    throw new Error("anticsrf_missing");
  const res = await cronoFetch("https://cronometer.com/login", jar, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ anticsrf: m[1], username: user, password: pass }).toString()
  });
  const txt = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch {
    parsed = { raw: txt };
  }
  if (parsed.error)
    throw new Error(`login_refused:${parsed.error}`);
  if (!jar.map.get("sesnonce"))
    throw new Error("login_no_sesnonce");
}
__name(cronoLogin, "cronoLogin");
async function cronoGwtAuthenticate(jar, perm, hdr) {
  const body = GWT_AUTHENTICATE.replace("{gwt_header}", hdr);
  const res = await cronoFetch("https://cronometer.com/cronometer/app", jar, {
    method: "POST",
    headers: {
      "content-type": CRONO_CT_GWT,
      "x-gwt-module-base": CRONO_GWT_BASE,
      "x-gwt-permutation": perm
    },
    body
  });
  const text2 = await res.text();
  if (!text2.startsWith("//OK"))
    throw new Error("gwt_auth_failed");
  const m = text2.match(/OK\[(\d+),/);
  if (!m)
    throw new Error("gwt_auth_no_userid");
  return m[1];
}
__name(cronoGwtAuthenticate, "cronoGwtAuthenticate");
async function cronoAuthToken(jar, userId, perm, hdr) {
  const nonce = jar.map.get("sesnonce") || "";
  const body = GWT_AUTH_TOKEN.replace("{gwt_header}", hdr).replace("{nonce}", nonce).replace("{user_id}", userId);
  const res = await cronoFetch("https://cronometer.com/cronometer/app", jar, {
    method: "POST",
    headers: {
      "content-type": CRONO_CT_GWT,
      "x-gwt-module-base": CRONO_GWT_BASE,
      "x-gwt-permutation": perm
    },
    body
  });
  const text2 = await res.text();
  if (!text2.startsWith("//OK"))
    throw new Error("auth_token_failed");
  const m = text2.match(/"([^"]+)"/);
  if (!m)
    throw new Error("auth_token_no_nonce");
  return m[1];
}
__name(cronoAuthToken, "cronoAuthToken");
async function cronoExport(jar, token, type, start, end) {
  const generate = CRONO_EXPORT_MAP[type] || type;
  const u = new URL("https://cronometer.com/export");
  u.searchParams.set("nonce", token);
  u.searchParams.set("generate", generate);
  u.searchParams.set("start", start);
  u.searchParams.set("end", end);
  const res = await cronoFetch(u.toString(), jar, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept": "text/csv,application/csv,text/plain,*/*",
      "accept-language": "en-US,en;q=0.9",
      "referer": "https://cronometer.com/",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin"
    }
  });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    const h = res.headers;
    const diag = `server=${h.get("server") || ""};ray=${h.get("cf-ray") || ""};mit=${h.get("cf-mitigated") || ""};ct=${h.get("content-type") || ""}`;
    throw new Error(`export_http_${res.status}[${diag}]:${b.slice(0, 200)}`);
  }
  return res.text();
}
__name(cronoExport, "cronoExport");
function parseCronoCSV(text2) {
  const lines = text2.replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length)
    return [];
  const hdrs = splitCronoCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitCronoCSVLine(line);
    const row = {};
    hdrs.forEach((h, i) => {
      row[h] = vals[i] ?? "";
    });
    return row;
  });
}
__name(parseCronoCSV, "parseCronoCSV");
function splitCronoCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"' && inQ) {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
__name(splitCronoCSVLine, "splitCronoCSVLine");
function aggregateServings(rows) {
  const keysToSum = /* @__PURE__ */ new Set();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (["Day", "Time", "Group", "Food Name", "Amount", "Category"].includes(k))
        continue;
      if (v !== "" && !Number.isNaN(parseFloat(v)))
        keysToSum.add(k);
    }
  }
  const totals = {};
  for (const k of keysToSum) {
    let sum = 0;
    for (const r of rows) {
      const v = r[k];
      if (v === "" || v == null)
        continue;
      const n = parseFloat(v);
      if (!Number.isNaN(n))
        sum += n;
    }
    totals[k] = Math.round(sum * 100) / 100;
  }
  return totals;
}
__name(aggregateServings, "aggregateServings");
async function fetchCronometerData(user, pass, date, type, env, { skipCachedSession = false } = {}) {
  const userHash = await sha256Hex2(user.toLowerCase());
  const sessKey = `crono_sess:${userHash}`;
  const saved = skipCachedSession ? null : await env.SYNC_KV.get(sessKey, "json");
  let jar = new CookieJar2(saved?.cookies);
  let userId = saved?.userId;
  let perm = saved?.perm || CRONO_GWT_PERM_DEFAULT;
  let hdr = saved?.hdr || CRONO_GWT_HEADER_DEFAULT;
  let token;
  let usedCachedSession = false;
  try {
    if (!userId)
      throw new Error("no_session");
    token = await cronoAuthToken(jar, userId, perm, hdr);
    usedCachedSession = true;
  } catch {
    jar = new CookieJar2();
    const hashes = await discoverGwtHashes(jar);
    perm = hashes.perm;
    hdr = hashes.hdr;
    await cronoLogin(jar, user, pass);
    userId = await cronoGwtAuthenticate(jar, perm, hdr);
    await env.SYNC_KV.put(sessKey, JSON.stringify({
      cookies: jar.toObject(),
      userId,
      perm,
      hdr,
      savedAt: Date.now()
    }), { expirationTtl: CRONO_SESS_TTL });
    token = await cronoAuthToken(jar, userId, perm, hdr);
  }
  let csv;
  try {
    csv = await cronoExport(jar, token, type, date, date);
  } catch (e) {
    const emsg = String(e && e.message || e);
    const isAuthEdgeBlock = emsg.includes("export_http_403") || emsg.includes("export_http_429");
    if (usedCachedSession && !isAuthEdgeBlock) {
      await env.SYNC_KV.delete(sessKey);
      return fetchCronometerData(user, pass, date, type, env, { skipCachedSession: true });
    }
    throw e;
  }
  const rows = parseCronoCSV(csv);
  const totals = type === "servings" || type === "daily_summary" ? aggregateServings(rows) : null;
  return { date, type, rows, totals, rowCount: rows.length, fetchedAt: Date.now() };
}
__name(fetchCronometerData, "fetchCronometerData");
async function handleCronometerPull(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_json" });
  }
  const { user, pass, date, type = "servings" } = body || {};
  if (!user || !pass)
    return json(400, { error: "missing_credentials" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return json(400, { error: "bad_date" });
  if (!CRONO_EXPORT_MAP[type])
    return json(400, { error: "bad_type" });
  const userHash = await sha256Hex2(user.toLowerCase());
  const cacheKey = `crono_cache:${userHash}:${date}:${type}`;
  const cached = await env.SYNC_KV.get(cacheKey, "json");
  if (cached)
    return json(200, { ...cached, cached: true });
  let result;
  try {
    result = await fetchCronometerData(user, pass, date, type, env);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.startsWith("login_refused") || msg === "login_no_sesnonce" || msg === "anticsrf_missing") {
      return json(401, { error: "cronometer_login_failed", detail: msg });
    }
    return json(502, { error: "cronometer_upstream_failed", detail: msg });
  }
  await env.SYNC_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CRONO_CACHE_TTL });
  return json(200, { ...result, cached: false });
}
__name(handleCronometerPull, "handleCronometerPull");
var FIT_TTL_SECONDS = 90 * 24 * 60 * 60;
var FIT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var FIT_FILENAME_PATTERN = /^[A-Za-z0-9_.\-]{1,128}$/;
var FIT_MAX_BODY_BYTES = 256 * 1024;
async function handleAIMessages(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json(503, { error: "ai_not_configured", detail: "Set ANTHROPIC_API_KEY via wrangler secret put" });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_json" });
  }
  const { system, user, max = 1500, model = "claude-sonnet-4-5-20250929" } = body || {};
  if (!user || typeof user !== "string")
    return json(400, { error: "missing_user_message" });
  try {
    const auth = request.headers.get("Authorization") || "";
    const tokenHash = await sha256Hex2(auth);
    const bucketKey = `ai:rate:${tokenHash}:${Math.floor(Date.now() / 36e5)}`;
    const used = parseInt(await env.SYNC_KV.get(bucketKey) || "0", 10);
    if (used >= 60) {
      return json(429, { error: "rate_limited", detail: "Hourly AI cap reached (60). Try again next hour." });
    }
    await env.SYNC_KV.put(bucketKey, String(used + 1), { expirationTtl: 3700 });
  } catch (e) {
    console.warn("[ai] rate-limit accounting failed:", e?.message || e);
  }
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(Math.max(parseInt(max, 10) || 1500, 100), 8192),
        ...system ? { system } : {},
        messages: [{ role: "user", content: user }]
      })
    });
    const text2 = await upstream.text();
    return new Response(text2, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS
      }
    });
  } catch (e) {
    return json(502, { error: "ai_upstream_failed", detail: String(e?.message || e) });
  }
}
__name(handleAIMessages, "handleAIMessages");
async function handleFitPost(pairId, request, env) {
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > FIT_MAX_BODY_BYTES)
    return json(413, { error: "too_large" });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_json" });
  }
  const { date, filename, activity } = body || {};
  if (!date || !FIT_DATE_PATTERN.test(date))
    return json(400, { error: "bad_date" });
  if (!filename || !FIT_FILENAME_PATTERN.test(filename))
    return json(400, { error: "bad_filename" });
  if (!activity || typeof activity !== "object")
    return json(400, { error: "bad_activity" });
  const key = `fit:${pairId}:${date}:${filename}`;
  const updatedAt = Date.now();
  const payload = JSON.stringify({ date, filename, activity, updatedAt });
  if (payload.length > FIT_MAX_BODY_BYTES)
    return json(413, { error: "too_large" });
  await env.SYNC_KV.put(key, payload, {
    expirationTtl: FIT_TTL_SECONDS,
    metadata: { date, filename, updatedAt, bytes: payload.length }
  });
  return json(200, { ok: true, date, filename, updatedAt, bytes: payload.length });
}
__name(handleFitPost, "handleFitPost");
async function handleFitRecent(pairId, request, env) {
  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") || "14", 10) || 14));
  const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1e3;
  const prefix = `fit:${pairId}:`;
  const list = await env.SYNC_KV.list({ prefix, limit: 1e3 });
  const fits = [];
  for (const k of list.keys) {
    if (k.metadata && k.metadata.updatedAt && k.metadata.updatedAt < cutoffTs)
      continue;
    const v = await env.SYNC_KV.get(k.name);
    if (!v)
      continue;
    try {
      const parsed = JSON.parse(v);
      fits.push(parsed);
    } catch {
    }
  }
  fits.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return json(200, { count: fits.length, fits });
}
__name(handleFitRecent, "handleFitRecent");
async function handleFitDelete(pairId, date, filename, env) {
  if (!FIT_DATE_PATTERN.test(date))
    return json(400, { error: "bad_date" });
  if (!FIT_FILENAME_PATTERN.test(filename))
    return json(400, { error: "bad_filename" });
  await env.SYNC_KV.delete(`fit:${pairId}:${date}:${filename}`);
  return json(200, { ok: true });
}
__name(handleFitDelete, "handleFitDelete");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (pathname === "/health" && request.method === "GET") {
      return text(200, "ok");
    }
    if (!requireAuth(request, env)) {
      return json(401, { error: "unauthorized" });
    }
    if (pathname === "/cronometer/pull" && request.method === "POST") {
      return handleCronometerPull(request, env);
    }
    if (pathname === "/ai/messages" && request.method === "POST") {
      return handleAIMessages(request, env);
    }
    if (request.method === "POST") {
      if (pathname === "/garmin/sleep")
        return handleGarminSleep(request, env);
      if (pathname === "/garmin/wellness")
        return handleGarminWellness(request, env);
      if (pathname === "/garmin/readiness")
        return handleGarminReadiness(request, env);
      if (pathname === "/garmin/all")
        return handleGarminAll(request, env);
      if (pathname === "/garmin/vo2max")
        return handleGarminVO2Max(request, env);
      if (pathname === "/garmin/weight")
        return handleGarminWeight(request, env);
      if (pathname === "/garmin/activities/recent")
        return handleGarminActivitiesList(request, env);
      const detMatch = pathname.match(/^\/garmin\/activities\/(\d+)\/details$/);
      if (detMatch)
        return handleGarminActivityDetails(request, env, detMatch[1]);
      const fitMatch = pathname.match(/^\/garmin\/activities\/(\d+)\/fit$/);
      if (fitMatch)
        return handleGarminActivityFit(request, env, fitMatch[1]);
    }
    const fitRecentMatch = pathname.match(/^\/fit\/([a-f0-9]+)\/recent$/);
    if (fitRecentMatch) {
      const pairId = fitRecentMatch[1];
      if (!ID_PATTERN.test(pairId))
        return json(400, { error: "bad_id" });
      if (request.method !== "GET")
        return json(405, { error: "method_not_allowed" });
      return handleFitRecent(pairId, request, env);
    }
    const fitDeleteMatch = pathname.match(/^\/fit\/([a-f0-9]+)\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_.\-]+)$/);
    if (fitDeleteMatch) {
      const [, pairId, date, filename] = fitDeleteMatch;
      if (!ID_PATTERN.test(pairId))
        return json(400, { error: "bad_id" });
      if (request.method !== "DELETE")
        return json(405, { error: "method_not_allowed" });
      return handleFitDelete(pairId, date, filename, env);
    }
    const fitPostMatch = pathname.match(/^\/fit\/([a-f0-9]+)$/);
    if (fitPostMatch) {
      const pairId = fitPostMatch[1];
      if (!ID_PATTERN.test(pairId))
        return json(400, { error: "bad_id" });
      if (request.method !== "POST")
        return json(405, { error: "method_not_allowed" });
      return handleFitPost(pairId, request, env);
    }
    const match = pathname.match(/^\/s\/([a-f0-9]+)$/);
    if (match) {
      const id = match[1];
      if (!ID_PATTERN.test(id))
        return json(400, { error: "bad_id" });
      switch (request.method) {
        case "GET":
          return handleGet(id, env);
        case "PUT":
          return handlePut(id, request, env);
        case "DELETE":
          return handleDelete(id, env);
        default:
          return json(405, { error: "method_not_allowed" });
      }
    }
    return json(404, { error: "not_found" });
  }
};
export {
  worker_default as default
};
