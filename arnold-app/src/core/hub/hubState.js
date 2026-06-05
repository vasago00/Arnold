// Hub core — the persistent state container. Holds the two ledgers + a bounded
// audit log, records checkpoints through the router, and serializes to/from the
// app's storage so the hub ACCUMULATES across sessions (the point of "learning
// over time"). See docs/HUB_CORE.md.
//
// Dependency-free for testability: save/load take an injected store ({get,set});
// the app passes the real `storage` from core/storage.js. Pure logic otherwise,
// unit-tested in tests/hubState.test.mjs.

import { makeFitnessModel } from './fitnessModel.js';
import { makeResponseModel } from './responseModel.js';
import { ingestCheckpoint } from './ingestCheckpoint.js';

export const HUB_STATE_VERSION = 1;
export const HUB_STATE_KEY = 'hub:state';
const LOG_CAP = 200; // keep the most recent N checkpoint log entries

// A fresh hub. opts.fitnessPriors = { paramName: number | {value,precision} }.
export function createHubState(opts = {}) {
  return {
    version: HUB_STATE_VERSION,
    fitness: makeFitnessModel(opts.fitnessPriors || {}),
    response: makeResponseModel(),
    log: [],
    lastUpdated: null,
  };
}

// Record one checkpoint: run it through the router, fold the updated ledgers back
// in, append a compact dated log entry. Returns { state, ingest } — `state` is the
// new hub state, `ingest` is the full explainable router log for this checkpoint.
export function recordCheckpoint(state, attribution, opts = {}) {
  const res = ingestCheckpoint(
    { fitnessModel: state.fitness, responseModel: state.response },
    attribution,
    opts,
  );
  const entry = {
    date: (attribution && attribution.date) || opts.date || new Date().toISOString().slice(0, 10),
    verdict: (attribution && attribution.verdict) || null,
    obsPrecision: res.log.grade.obsPrecision,
    summary: res.log.summary,
  };
  const log = [...state.log, entry].slice(-LOG_CAP);
  const next = {
    ...state,
    fitness: res.fitnessModel,
    response: res.responseModel,
    log,
    lastUpdated: opts.now || new Date().toISOString(),
  };
  return { state: next, ingest: res.log };
}

// ── Serialization ────────────────────────────────────────────────────────────
// The in-memory state is already JSON-safe (estimates are {value,precision}),
// so serialize is a deep clone; deserialize validates + repairs + migrates.
export function serializeHubState(state) {
  return JSON.parse(JSON.stringify({
    version: HUB_STATE_VERSION,
    fitness: state.fitness,
    response: state.response,
    log: state.log,
    lastUpdated: state.lastUpdated,
  }));
}

export function deserializeHubState(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return createHubState(opts);
  // Unknown future version → don't risk misreading; start fresh. (Older versions
  // would migrate here as the schema evolves; v1 is the first.)
  if (raw.version != null && raw.version > HUB_STATE_VERSION) return createHubState(opts);

  const fresh = createHubState(opts);
  const fitnessParams = (raw.fitness && raw.fitness.params && typeof raw.fitness.params === 'object')
    ? raw.fitness.params : {};
  const responseFactors = (raw.response && raw.response.factors && typeof raw.response.factors === 'object')
    ? raw.response.factors : {};

  return {
    version: HUB_STATE_VERSION,
    fitness: { params: coerceEstimates(fitnessParams) },
    response: { factors: coerceEstimates(responseFactors) },
    log: Array.isArray(raw.log) ? raw.log.slice(-LOG_CAP) : fresh.log,
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : null,
  };
}

// Keep only well-formed { value, precision } estimates; drop anything corrupt.
function coerceEstimates(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && typeof v === 'object' && Number.isFinite(v.value) && Number.isFinite(v.precision)) {
      out[k] = { value: v.value, precision: v.precision };
    }
  }
  return out;
}

// ── Storage binding (store = { get, set }) ───────────────────────────────────
export function saveHubState(state, store) {
  if (store && typeof store.set === 'function') store.set(HUB_STATE_KEY, serializeHubState(state));
  return state;
}

export function loadHubState(store, opts = {}) {
  const raw = (store && typeof store.get === 'function') ? store.get(HUB_STATE_KEY) : null;
  return raw ? deserializeHubState(raw, opts) : createHubState(opts);
}
