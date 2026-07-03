// ─── FatSecret client (sanctioned nutrition API, behind a static-IP proxy) ────
// Why a proxy: FatSecret OAuth2 requires (a) the client_credentials token to be
// requested SERVER-SIDE (never expose the secret in the app) and (b) the caller
// IP to be WHITELISTED (≤15 IPs / CIDR on the free/Premier-Free tier). Cloudflare
// Workers egress from a rotating pool and can't be whitelisted, so the FatSecret
// proxy must run on a host with a fixed IP (small VPS / Fly.io dedicated IPv4).
// The worker exposes three JSON passthrough routes; ALL FatSecret→Arnold mapping
// happens here in PURE functions so it's unit-testable (see fatsecret-client.test.js).
//
// Endpoint config lives in localStorage 'arnold:fatsecret-endpoint' (set once the
// proxy is deployed). When unset, isFatSecretConfigured() is false and the
// nutrition provider layer falls back to Open Food Facts — no breakage.

import { storage } from './storage.js';

const CFG_ENDPOINT = 'arnold:fatsecret-endpoint';

export function getFatSecretEndpoint() {
  try { return (localStorage.getItem(CFG_ENDPOINT) || '').replace(/\/$/, ''); } catch { return ''; }
}
export function setFatSecretEndpoint(url) {
  try { localStorage.setItem(CFG_ENDPOINT, String(url || '').trim().replace(/\/$/, '')); } catch {}
}
export function isFatSecretConfigured() { return !!getFatSecretEndpoint(); }

// ─── PURE mappers (FatSecret JSON → Arnold's existing nutrition shapes) ────────

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const round0 = (n) => Math.round(Number(n) || 0);

// FatSecret search rows carry a compact `food_description` string, e.g.
//   "Per 1 cup - Calories: 233kcal | Fat: 8.20g | Carbs: 32.00g | Protein: 8.00g"
// Parse it so the results list + quick-add have macros without an extra food.get.
export function parseFsDescription(desc) {
  if (!desc || typeof desc !== 'string') return null;
  const serving = (desc.match(/^Per\s+([^-|]+?)\s*[-|]/i) || [])[1]?.trim() || '';
  const num = (re) => { const m = desc.match(re); return m ? parseFloat(m[1]) : null; };
  const calories = num(/Calories:\s*([\d.]+)\s*kcal/i);
  const fat      = num(/Fat:\s*([\d.]+)\s*g/i);
  const carbs    = num(/Carbs?:\s*([\d.]+)\s*g/i);
  const protein  = num(/Protein:\s*([\d.]+)\s*g/i);
  if (calories == null && protein == null && carbs == null && fat == null) return null;
  return { serving, calories: round0(calories), protein: round1(protein), carbs: round1(carbs), fat: round1(fat) };
}

// One FatSecret search result → the shape NutritionInput's results list expects:
//   { name, brand, servingSize, imageUrl, macros:{...}, barcode, foodId }
export function mapFsSearchItem(food) {
  if (!food) return null;
  const parsed = parseFsDescription(food.food_description) || {};
  return {
    name: food.food_name || 'Unknown',
    brand: food.brand_name || '',
    servingSize: parsed.serving || '1 serving',
    imageUrl: null,
    macros: {
      calories: parsed.calories ?? 0,
      protein:  parsed.protein  ?? 0,
      carbs:    parsed.carbs    ?? 0,
      fat:      parsed.fat      ?? 0,
      fiber:    0,
      sugar:    0,
      water:    0,
    },
    barcode: null,
    foodId: food.food_id || null,
    source: 'fatsecret',
  };
}

export function mapFsSearchResults(payload) {
  // foods.search.v3: { foods_search: { results: { food: [...] | {...} } } }
  // foods.search (v1/v2): { foods: { food: [...] | {...} } }
  const arr =
    payload?.foods_search?.results?.food ??
    payload?.foods?.food ??
    [];
  const list = Array.isArray(arr) ? arr : (arr ? [arr] : []);
  return list.map(mapFsSearchItem).filter(Boolean);
}

// FatSecret `serving` is an array when multiple, a single object when one.
export function asServingArray(servings) {
  const s = servings?.serving;
  if (!s) return [];
  return Array.isArray(s) ? s : [s];
}

// Per-serving macros from a FatSecret serving object.
export function servingMacros(s) {
  return {
    calories: round0(s.calories),
    protein:  round1(s.protein),
    carbs:    round1(s.carbohydrate),
    fat:      round1(s.fat),
    fiber:    round1(s.fiber),
    sugar:    round1(s.sugar),
    water:    0, // FatSecret has no water field
  };
}

// Compute per-100g macros from whichever serving is gram-denominated, so the
// existing PortionSelector's gram/oz/cup math keeps working.
export function per100gFromServings(servingArr) {
  for (const s of servingArr) {
    const unit = (s.metric_serving_unit || '').toLowerCase();
    const amt = parseFloat(s.metric_serving_amount);
    if (unit === 'g' && amt > 0) {
      const f = 100 / amt;
      return {
        calories: round0((Number(s.calories) || 0) * f),
        protein:  round1((Number(s.protein) || 0) * f),
        carbs:    round1((Number(s.carbohydrate) || 0) * f),
        fat:      round1((Number(s.fat) || 0) * f),
        fiber:    round1((Number(s.fiber) || 0) * f),
        sugar:    round1((Number(s.sugar) || 0) * f),
        water:    0,
      };
    }
  }
  return null;
}

// Pick the default serving: FatSecret flags one with is_default==='1', else first.
export function pickDefaultServing(servingArr) {
  if (!servingArr.length) return null;
  return servingArr.find(s => String(s.is_default) === '1') || servingArr[0];
}

// food.get.v4 / barcode food object → the rich shape lookupBarcode returns:
//   { name, brand, servingSize, servingWeightG, per100g, imageUrl, macros, barcode, rawApiData, foodId, servings:[] }
export function mapFsFood(payload, barcode = null) {
  const food = payload?.food || payload;
  if (!food || !food.food_name) return null;
  const servingArr = asServingArray(food.servings);
  const def = pickDefaultServing(servingArr);
  const per100g = per100gFromServings(servingArr);
  const gramServing = servingArr.find(s => (s.metric_serving_unit || '').toLowerCase() === 'g' && parseFloat(s.metric_serving_amount) > 0);
  return {
    name: food.food_name,
    brand: food.brand_name || '',
    servingSize: def?.serving_description || def?.measurement_description || '1 serving',
    servingWeightG: gramServing ? parseFloat(gramServing.metric_serving_amount) : null,
    per100g,
    imageUrl: null,
    macros: def ? servingMacros(def) : { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, water: 0 },
    barcode: barcode || null,
    foodId: food.food_id || null,
    source: 'fatsecret',
    rawApiData: { food_id: food.food_id, food_name: food.food_name, brand_name: food.brand_name },
    servings: servingArr.map(s => ({
      id: s.serving_id || null,
      label: s.serving_description || s.measurement_description || 'serving',
      metricAmount: s.metric_serving_amount ? parseFloat(s.metric_serving_amount) : null,
      metricUnit: s.metric_serving_unit || null,
      per: servingMacros(s),
    })),
  };
}

// ─── Network (calls the proxy; returns mapped Arnold shapes) ──────────────────

async function fsFetch(path, params) {
  const endpoint = getFatSecretEndpoint();
  if (!endpoint) throw new Error('FatSecret endpoint not configured');
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${endpoint}${path}?${qs}`, { method: 'GET' });
  if (!res.ok) throw new Error(`FatSecret proxy ${path} → ${res.status}`);
  return res.json();
}

export async function fsSearchFoods(query, page = 0) {
  try {
    const payload = await fsFetch('/fatsecret/search', { q: query, page });
    return mapFsSearchResults(payload);
  } catch (e) { console.warn('[fatsecret] search failed:', e.message); return null; }
}

export async function fsGetFood(foodId) {
  try {
    const payload = await fsFetch('/fatsecret/food', { id: foodId });
    return mapFsFood(payload);
  } catch (e) { console.warn('[fatsecret] food.get failed:', e.message); return null; }
}

export async function fsLookupBarcode(code) {
  try {
    const payload = await fsFetch('/fatsecret/barcode', { code });
    return mapFsFood(payload, code);
  } catch (e) { console.warn('[fatsecret] barcode failed:', e.message); return null; }
}
