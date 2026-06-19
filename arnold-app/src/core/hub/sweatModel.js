// Hub core — PERSONAL SWEAT-RATE accumulator. The hydration counterpart to the
// fitness/response ledgers: it learns how much fluid YOU lose per hour as a
// function of temperature, from real measured weight deltas around runs. This is
// the "every data point is valuable" principle applied to hydration — each hot run
// with a before/after weigh-in is one observation that sharpens a personal model
// the generic population formula (derive/hydration.js) can't capture.
//
// THE PHYSICS (gross sweat, not net):
//   A scale drop after a run UNDER-counts sweat, because you drank during it.
//     gross_sweat = (fasted_weight − post_weight) + fluid_taken_in
//   In litres (water ≈ 1 kg/L; 1 lb ≈ 0.4536 L):
//     gross_L = sweatNetLbs × 0.4536 + fluidInL
//     rate    = gross_L / durationHr      (L/hr)
//   sweatNetLbs comes straight from bodyModel's post-activity hydration signal.
//
// THE MODEL: a precision-weighted linear fit rate ≈ a + b·tempC. With one point
// it's a flat mean; with a spread of temperatures it learns the slope (how fast
// your sweat rate climbs with heat). Observations carry precision (cleaner reads
// count more) and decay so the model tracks fitness/acclimation changes.
// Pure, unit-tested in tests/hubSweat.test.mjs. See docs/SIGNAL_LEDGERS.md.

const LB_TO_L = 0.4536;            // 1 lb of water ≈ 0.4536 L
const OBS_CAP = 40;
const REF_TEMP_C = 20;             // report the baseline rate at a mild 20°C
const RATE_MIN = 0.2, RATE_MAX = 4.0;   // plausible L/hr bounds (clamp predictions)
const SLOPE_MAX = 0.15;            // plausible L/hr per °C (clamp the learned slope)

export function makeSweatModel() {
  return { obs: [] }; // obs: [{ tempC, rateLhr, precision, date }]
}

// Convert a measured run into a gross sweat rate (L/hr). Returns null when the
// inputs can't support a real read (no duration, implausible result).
export function grossSweatRate({ sweatNetLbs, fluidInL = 0, durationHr }) {
  if (!(durationHr > 0)) return null;
  const net = Number(sweatNetLbs);
  if (!Number.isFinite(net)) return null;
  const grossL = net * LB_TO_L + (Number(fluidInL) || 0);
  if (!(grossL > 0)) return null;            // gained weight / bad read → not a sweat signal
  const rate = grossL / durationHr;
  if (rate < RATE_MIN / 2 || rate > RATE_MAX * 1.5) return null; // garbage guard
  return +rate.toFixed(3);
}

// Observation precision: cleaner reads count more. A fasted-anchored read with a
// known fluid intake and a solid duration is precision ~1; missing fluid data or a
// very short run damps it.
function obsPrecision({ fluidKnown, durationHr }) {
  let p = 1;
  if (!fluidKnown) p *= 0.5;                 // unknown intake → gross is a floor, less trustworthy
  if (durationHr < 0.5) p *= 0.5;            // short runs: small deltas, big relative error
  return p;
}

// Record one run's sweat observation. obs = { tempC, sweatNetLbs, fluidInL?,
// durationHr, date? }. Returns { model, observed } (observed=false if unusable).
export function observeSweat(model, obs = {}) {
  const rate = grossSweatRate(obs);
  const tempC = Number(obs.tempC);
  if (rate == null || !Number.isFinite(tempC)) return { model, observed: false };
  const precision = obsPrecision({ fluidKnown: Number.isFinite(Number(obs.fluidInL)), durationHr: obs.durationHr });
  const next = [...model.obs, { tempC, rateLhr: rate, precision, date: obs.date || null }].slice(-OBS_CAP);
  return { model: { obs: next }, observed: true, rateLhr: rate, tempC, precision };
}

// Weighted linear fit rate ≈ a + b·tempC over the observations.
function fit(obs) {
  const n = obs.length;
  if (!n) return null;
  let Sw = 0, Swx = 0, Swy = 0, Swxx = 0, Swxy = 0;
  for (const o of obs) {
    const w = o.precision > 0 ? o.precision : 0.0001;
    Sw += w; Swx += w * o.tempC; Swy += w * o.rateLhr;
    Swxx += w * o.tempC * o.tempC; Swxy += w * o.tempC * o.rateLhr;
  }
  const mean = Swy / Sw;
  const denom = Sw * Swxx - Swx * Swx;
  let b = 0, a = mean;
  if (n >= 2 && Math.abs(denom) > 1e-9) {
    b = (Sw * Swxy - Swx * Swy) / denom;
    b = Math.max(0, Math.min(SLOPE_MAX, b));   // clamp to a plausible, non-negative slope
    a = (Swy - b * Swx) / Sw;
  }
  return { a, b, Sw, n };
}

// Predict YOUR sweat rate at a given temperature. Returns rate (L/hr, clamped),
// the learned per-°C slope, baseline rate at REF_TEMP_C, confidence, and n.
export function predictSweatRate(model, tempC, k0 = 2) {
  const f = fit(model.obs);
  if (!f) return { rateLhr: null, perDegC: 0, baseAt20: null, confidence: 0, n: 0 };
  const t = Number.isFinite(tempC) ? tempC : REF_TEMP_C;
  const raw = f.a + f.b * t;
  const rate = +Math.max(RATE_MIN, Math.min(RATE_MAX, raw)).toFixed(2);
  const baseAt20 = +Math.max(RATE_MIN, Math.min(RATE_MAX, f.a + f.b * REF_TEMP_C)).toFixed(2);
  return {
    rateLhr: rate,
    perDegC: +f.b.toFixed(3),
    baseAt20,
    confidence: +(f.Sw / (f.Sw + k0)).toFixed(2),
    n: f.n,
  };
}
