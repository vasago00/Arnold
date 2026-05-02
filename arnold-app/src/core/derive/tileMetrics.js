// ─── Start-Screen Tile Metric Registry (Phase 4b) ──────────────────────────
// Single source of truth for every metric the user can choose to display on
// their Start screen. Each entry is a self-contained record:
//
//   id        — stable string identifier; persisted in storage('startTilePrefs')
//   label     — short user-facing name shown in the tile + the picker
//   category  — 'run' | 'strength' | 'recovery' | 'body'
//   unit      — display unit ('mi', 'bpm', 'g', '%', etc.) or '' if none
//   compute   — (ctx) => { value, sublabel?, color?, sparkline?, hrZones? }
//               returns null if no data yet. ctx has the same shape every
//               metric receives (see buildTileContext below).
//   available — (ctx) => boolean
//               returns true if there's enough data for this metric to be
//               meaningful. Used by the picker to grey out "no data yet"
//               options. Defaults to "compute returned non-null".
//   trendOf   — optional. (ctx) => number — comparable older value for the
//               trend arrow. Tile component computes ↑/↓/→ + delta.
//
// Adding a new metric: write one entry. The picker, the tile renderer, and
// cross-device sync all pick it up automatically.

import { canonicalActivityType } from '../dcyMath.js';
import { isRun, isStrength as isStrengthAct } from '../activityClass.js';

// ── Helpers used by multiple metrics ────────────────────────────────────────

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const startOfWeekMonday = (d = new Date()) => {
  const x = new Date(d);
  const dow = x.getDay();
  x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1));
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const filterByDateGe = (arr, dateObj, dateField = 'date') => {
  const cutoff = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
  return arr.filter(x => x?.[dateField] && x[dateField] >= cutoff);
};

const avg = (arr, key) => {
  const vals = arr.map(x => x?.[key]).filter(v => v != null && !isNaN(v));
  return vals.length ? vals.reduce((s, v) => s + Number(v), 0) / vals.length : null;
};

const sum = (arr, key) =>
  arr.reduce((s, x) => s + (Number(x?.[key]) || 0), 0);

// True if date string (YYYY-MM-DD) is within the last `days` days from today.
function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const cutoff = daysAgo(days);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  return dateStr >= cutoffStr;
}

// Combine HRV observations from sleep (Garmin Worker) + hrvData (manual CSV).
// Returns newest-first array of { date, overnightHRV, source } where source
// is 'worker' or 'csv'. Worker rows win when both exist for the same date.
function mergedHrvByDate(ctx) {
  const byDate = new Map();
  // Manual CSV imports first (lower priority — overwritten by worker below)
  for (const h of (ctx.hrvData || [])) {
    if (h?.date && h?.overnightHRV != null && !isNaN(Number(h.overnightHRV))) {
      byDate.set(h.date, { date: h.date, overnightHRV: Number(h.overnightHRV), source: 'csv' });
    }
  }
  // Worker sleep rows (higher priority)
  for (const s of (ctx.sleepData || [])) {
    if (s?.date && s?.overnightHRV != null && !isNaN(Number(s.overnightHRV))) {
      byDate.set(s.date, { date: s.date, overnightHRV: Number(s.overnightHRV), source: 'worker' });
    }
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ── Nutrition macro lookup helpers (Phase 4g) ──
// Body-category tiles (Protein, Calories, Carbs, Fat, Fiber, Sodium) need a
// 30-day series for their avg30 number. These helpers walk the nutrition data
// in the same priority order nutDailyTotals uses outside the registry:
//   1. Cronometer full-day entry (Worker source) for the date
//   2. Sum of manual nutritionLog entries
//   3. Legacy `cronometer` collection fallback
function macroForDate(ctx, dateStr, macroKey) {
  const dayLog = (ctx.nutritionLog || []).filter(e => e?.date === dateStr);
  const fullDay = dayLog
    .filter(e => e?.meal === 'full-day')
    .sort((a, b) => (b?.createdAt || '').localeCompare(a?.createdAt || ''))[0];
  if (fullDay) {
    const v = Number(fullDay?.macros?.[macroKey]) || Number(fullDay?.extended?.[macroKey]) || 0;
    if (v > 0) return v;
  }
  if (dayLog.length) {
    const sum = dayLog.reduce((s, e) =>
      s + (Number(e?.macros?.[macroKey]) || Number(e?.[macroKey]) || 0), 0);
    if (sum > 0) return sum;
  }
  const legacy = (ctx.cronometer || []).find(c => c?.date === dateStr);
  if (legacy) {
    const v = Number(legacy?.[macroKey]) || 0;
    if (v > 0) return v;
  }
  return 0;
}

// Returns last 30 days' values for a given macro key, in newest-first order.
// Days with zero (empty intake) are skipped — averaging over them would drag
// the displayed avg30 down for users who don't log every day.
function macroHistory30(ctx, macroKey) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const v = macroForDate(ctx, ds, macroKey);
    if (v > 0) out.push(v);
  }
  return out;
}

// Pace string "M:SS" → seconds, or null
const paceToSecs = (p) => {
  if (!p) return null;
  const m = String(p).match(/^(\d+):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};
const secsToPace = (s) => {
  if (!s || !isFinite(s)) return null;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

// Find FIT activity for a given date (used to surface latest run's
// per-session metrics like cadence, GCT, etc.)
const latestRun = (acts) => {
  const runs = (acts || []).filter(isRun)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return runs[0] || null;
};
const latestStrength = (acts) => {
  const strength = (acts || []).filter(isStrengthAct)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return strength[0] || null;
};

// ── Status & trend evaluation ───────────────────────────────────────────────
// Each metric declares:
//   polarity   — what direction is "good": 'higher-better' | 'lower-better' |
//                'target' (closer to target = better) | 'neutral' (no meaningful good/bad)
//   thresholds — {green: [lo,hi], amber: [lo,hi], red: [lo,hi]} ranges. Values outside
//                any band default to 'neutral'. Optional — metrics without thresholds
//                show in default white text.
//   historyOf  — (ctx) => number[] returning the historical values used for
//                the trend computation. Newest-first or oldest-first both fine —
//                deriveTrend filters to the prior 7 entries before today's.
//
// The renderer never inspects these directly. Instead it calls evaluate(metric, ctx)
// which executes compute() and post-hoc enriches the result with auto-derived
// status + trend if compute didn't already supply them.

// Body Battery resilience helper: prefer the highest-fidelity field that's
// actually populated. Garmin's reports/daily endpoint occasionally returns
// sparse intraday samples (bodyBatteryStart/End/Min/Max all null) but always
// gives charged/drained — falling back through this chain means the tile
// shows something useful instead of going blank when one field is missing.
function bodyBatteryDerived(w) {
  if (!w) return null;
  if (typeof w.bodyBatteryStart === 'number') return w.bodyBatteryStart;
  if (typeof w.bodyBatteryMax   === 'number') return w.bodyBatteryMax;
  if (typeof w.bodyBatteryEnd   === 'number') return w.bodyBatteryEnd;
  // Last-resort proxy: charged-drained as a "net day" indicator if no samples.
  // Not a true 0-100 scale — bracket to [0,100] so thresholds still fire.
  if (typeof w.bodyBatteryCharged === 'number' || typeof w.bodyBatteryDrained === 'number') {
    const ch = Number(w.bodyBatteryCharged) || 0;
    const dr = Number(w.bodyBatteryDrained) || 0;
    return Math.max(0, Math.min(100, 50 + (ch - dr)));
  }
  return null;
}

export const STATUS_COLORS = {
  green:   '#4ade80',
  amber:   '#fbbf24',
  red:     '#f87171',
  neutral: null,  // signals "no special color, use default"
};

// Subtle status glyphs rendered next to the trend line below the value.
// Intentionally minimal: a check when optimal, nothing when "fine but not flagged",
// a caution mark when amber, a heavy X when red. Same icon for every metric so
// users learn one visual language across the whole Start screen.
//
// Why these particular characters — they are all in Unicode blocks that font
// engines render as TEXT GLYPHS (not emoji), which means they stay crisp at
// small sizes. The original ☠ skull was emoji-rendered and pixelated on both
// Windows and Android at 9px font-size.
export const STATUS_ICONS = {
  green:   '✓',          // U+2713 CHECK MARK — optimal
  amber:   '!',          // ASCII bang — caution
  red:     '✗',          // U+2717 BALLOT X — danger (text-rendered, always crisp)
  neutral: null,         // nothing rendered
};

function inRange(v, range) {
  if (!Array.isArray(range)) return false;
  // Single range [lo, hi] OR array-of-ranges [[lo,hi], [lo2,hi2], ...]
  if (range.length === 2 && typeof range[0] === 'number') {
    return v >= range[0] && v <= range[1];
  }
  return range.some(r => Array.isArray(r) && r.length === 2 && v >= r[0] && v <= r[1]);
}

// Status derivation from a target-based ratio (used by macros / micronutrients).
// type='window' → green if 90-110% of target, amber if 70-130%, red outside.
// type='higher' → green if >=80% of target, amber if >=50%, red below.
export function statusFromPct(pct, type = 'window') {
  if (pct == null || !isFinite(pct)) return 'neutral';
  if (type === 'higher') {
    if (pct >= 0.8) return 'green';
    if (pct >= 0.5) return 'amber';
    return 'red';
  }
  if (pct >= 0.9 && pct <= 1.1) return 'green';
  if (pct >= 0.7 && pct <= 1.3) return 'amber';
  return 'red';
}

export function deriveStatus(value, thresholds) {
  if (value == null || !isFinite(value) || !thresholds) return 'neutral';
  if (inRange(value, thresholds.green)) return 'green';
  if (inRange(value, thresholds.amber)) return 'amber';
  if (inRange(value, thresholds.red))   return 'red';
  return 'neutral';
}

// Compute trend: compare current value vs average of the prior `window` entries.
// Returns { direction: 'up'|'down'|'flat', delta, isGood }
//   direction — raw movement, not interpreted
//   isGood    — direction interpreted through polarity
//                higher-better: up=good, down=bad
//                lower-better:  down=good, up=bad
//                target:        movement toward target = good (needs target)
//                neutral:       isGood=null (don't color the arrow)
export function deriveTrend(currentValue, history, polarity, target = null, window = 7) {
  if (currentValue == null || !Array.isArray(history) || history.length < 2) return null;
  // Drop the current value from the history (assumed to be at index 0 newest-first
  // or last oldest-first); use the next `window` items as the reference average.
  const numeric = history.map(v => Number(v)).filter(v => isFinite(v));
  if (numeric.length < 2) return null;
  // Heuristic: if the first item equals currentValue, treat array as newest-first.
  const newestFirst = Math.abs(numeric[0] - Number(currentValue)) < 0.01;
  const ref = newestFirst ? numeric.slice(1, 1 + window) : numeric.slice(-window - 1, -1);
  if (ref.length === 0) return null;
  const refAvg = ref.reduce((s, v) => s + v, 0) / ref.length;
  const delta = Number(currentValue) - refAvg;
  const flatThreshold = Math.max(0.5, Math.abs(refAvg) * 0.02);  // ~2% noise band
  let direction;
  if (Math.abs(delta) < flatThreshold) direction = 'flat';
  else direction = delta > 0 ? 'up' : 'down';

  let isGood;
  if (polarity === 'higher-better') {
    isGood = direction === 'up' ? true : direction === 'down' ? false : null;
  } else if (polarity === 'lower-better') {
    isGood = direction === 'down' ? true : direction === 'up' ? false : null;
  } else if (polarity === 'target' && target != null) {
    // Moved toward target → good; away → bad
    const distNow  = Math.abs(Number(currentValue) - target);
    const distRef  = Math.abs(refAvg - target);
    isGood = direction === 'flat' ? null : (distNow < distRef);
  } else {
    isGood = null;
  }
  return { direction, delta: +delta.toFixed(2), isGood };
}

// Evaluator: runs compute() and back-fills status + trend + avg30 if the
// metric provides enough metadata. Used by the tile renderer in MobileHome.jsx.
export function evaluate(metric, ctx) {
  if (!metric) return null;
  let result;
  try { result = metric.compute(ctx); } catch (e) { console.warn(`[evaluate] ${metric.id} compute failed:`, e); return null; }
  if (!result) return null;
  if (result.status == null && metric.thresholds) {
    result.status = deriveStatus(Number(result.value), metric.thresholds);
  }
  // Pull the historical series once and reuse for trend + 30d avg.
  let hist = null;
  if (metric.historyOf) {
    try { hist = metric.historyOf(ctx); } catch { hist = null; }
  }
  if (result.trend == null && Array.isArray(hist) && metric.polarity && metric.polarity !== 'neutral') {
    result.trend = deriveTrend(Number(result.value), hist, metric.polarity, metric.target ?? null);
  }
  // 30-day average — average of the last 30 numeric historical observations.
  // For metrics whose value is a point-in-time observation (HR, HRV, weight,
  // duration, etc.) this is meaningful. For metrics that are themselves
  // already windowed aggregates (Z2 weekly, ACWR), historyOf is null and
  // avg30 stays null — the renderer shows "—" in that slot.
  if (result.avg30 == null && Array.isArray(hist) && hist.length > 0) {
    const recent = hist.slice(0, 30).map(Number).filter(v => isFinite(v));
    if (recent.length >= 1) {
      const avgVal = recent.reduce((s, v) => s + v, 0) / recent.length;
      // Round to match the precision of the headline value where possible.
      const todayVal = Number(result.value);
      const decimals = isFinite(todayVal) && String(result.value).includes('.')
        ? (String(result.value).split('.')[1] || '').length
        : 0;
      result.avg30 = decimals > 0 ? +avgVal.toFixed(decimals) : Math.round(avgVal);
    }
  }
  return result;
}

// ── Registry ────────────────────────────────────────────────────────────────

export const TILE_METRICS = [
  // ═══ RUN ═══════════════════════════════════════════════════════════════
  {
    id: 'avgRunHR', label: 'Avg HR (Run)', category: 'run', unit: 'bpm',
    polarity: 'lower-better', // for trend: dropping HR at same paces = improving fitness
    // No fixed thresholds — context-dependent (Z2 vs tempo). Status stays neutral.
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.avgHR).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (!r?.avgHR) return null;
      return {
        value: Math.round(r.avgHR),
        sublabel: r.date,
        hrZones: Array.isArray(r.hrZones) && r.hrZones.length === 5 ? r.hrZones : null,
      };
    },
  },
  {
    id: 'cadence', label: 'Cadence', category: 'run', unit: 'spm',
    polarity: 'higher-better',
    thresholds: { green: [170, 220], amber: [160, 170], red: [0, 160] },
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.avgCadence).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (!r?.avgCadence) return null;
      return { value: Math.round(r.avgCadence), sublabel: r.date };
    },
  },
  {
    id: 'racePredictor', label: 'Race Predictor', category: 'run', unit: '',
    polarity: 'lower-better', // faster predicted time = better
    historyOf: (ctx) => (ctx.activities || [])
      .filter(a => isRun(a) && a?.racePredictor?.tHM)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(a => a.racePredictor.tHM),
    compute: (ctx) => {
      // Find most recent FIT with a racePredictor block
      const runs = (ctx.activities || []).filter(a => a?.racePredictor)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const r = runs[0];
      if (!r?.racePredictor) return null;
      const fmt = s => {
        if (s == null) return '—';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.round(s % 60);
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
                     : `${m}:${String(sec).padStart(2, '0')}`;
      };
      const rp = r.racePredictor;
      return {
        value: fmt(rp.tHM),  // headline number = half-marathon prediction
        sublabel: `5K ${fmt(rp.t5k)} · 10K ${fmt(rp.t10k)}`,
        full: rp,            // tile component can render the 4-row breakdown
      };
    },
    // Race Predictor only available if any activity has it. Older Forerunners
    // don't emit this; needs Garmin Wellness sync (Phase 4) for full coverage.
    available: (ctx) => (ctx.activities || []).some(a => a?.racePredictor),
  },
  {
    id: 'aerobicTE', label: 'Aerobic TE', category: 'run', unit: '/5',
    polarity: 'target', target: 3.0,
    // Sweet spot 2-4: maintaining/improving fitness. Below 2 = too easy,
    // above 4 = overreaching for routine training.
    thresholds: { green: [2, 4], amber: [[1, 2], [4, 5]], red: [[0, 1], [5, 10]] },
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.aerobicTrainingEffect).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (r?.aerobicTrainingEffect == null) return null;
      return { value: r.aerobicTrainingEffect.toFixed(1), sublabel: r.date };
    },
  },
  {
    id: 'paceHrRatio', label: 'Pace : HR Ratio', category: 'run', unit: '',
    // Pace in sec/mi divided by avg HR. Lower = better aerobic efficiency.
    polarity: 'lower-better',
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => {
        const sec = paceToSecs(r.avgPaceRaw || r.avgPacePerMi);
        return r.avgHR && sec ? +(sec / r.avgHR).toFixed(2) : null;
      }).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (!r) return null;
      const paceSec = paceToSecs(r.avgPaceRaw || r.avgPacePerMi);
      const hr = r.avgHR;
      if (!paceSec || !hr) return null;
      const ratio = +(paceSec / hr).toFixed(2);
      return { value: ratio, sublabel: r.date };
    },
  },
  {
    id: 'zone2Weekly', label: 'Z2 Weekly', category: 'run', unit: 'min',
    // Sum of seconds-in-Z2 across this week's runs. Foundation of endurance.
    // Most coaches target ~80% of weekly HR-zone time in Z2 for base building.
    polarity: 'higher-better',
    // 240+ min/wk in Z2 is solid base; 120-240 building; <120 minimal aerobic.
    thresholds: { green: [240, 99999], amber: [120, 240], red: [0, 120] },
    historyOf: null, // Trend not meaningful for a "this-week" snapshot
    compute: (ctx) => {
      const monday = startOfWeekMonday();
      const weekRuns = filterByDateGe(ctx.activities || [], monday).filter(isRun);
      const z2Secs = weekRuns.reduce((sum, a) => {
        if (Array.isArray(a?.hrZones) && a.hrZones.length === 5) return sum + (a.hrZones[1] || 0);
        return sum;
      }, 0);
      if (z2Secs === 0) return null;
      const totalSecs = weekRuns.reduce((sum, a) => {
        if (Array.isArray(a?.hrZones)) return sum + a.hrZones.reduce((s, v) => s + v, 0);
        return sum;
      }, 0);
      const z2Mins = Math.round(z2Secs / 60);
      const pct = totalSecs > 0 ? Math.round((z2Secs / totalSecs) * 100) : 0;
      return { value: z2Mins, sublabel: `${pct}% of Z-time` };
    },
    available: (ctx) => (ctx.activities || []).some(a => Array.isArray(a?.hrZones)),
  },
  {
    id: 'aerobicDecoupling', label: 'Aerobic Decoupling', category: 'run', unit: '%',
    polarity: 'lower-better',
    thresholds: { green: [0, 5], amber: [5, 10], red: [10, 100] },
    historyOf: (ctx) => (ctx.activities || [])
      .filter(a => isRun(a) && a?.aerobicDecoupling != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(a => a.aerobicDecoupling),
    compute: (ctx) => {
      const runs = (ctx.activities || []).filter(a => isRun(a) && a.aerobicDecoupling != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const r = runs[0];
      if (!r) return null;
      const v = r.aerobicDecoupling;
      const status = v < 5 ? 'green' : v < 10 ? 'amber' : 'red';
      return { value: v.toFixed(1), sublabel: r.date, status };
    },
    available: (ctx) => (ctx.activities || []).some(a => a?.aerobicDecoupling != null),
  },
  {
    id: 'acwr', label: 'ACWR', category: 'run', unit: '',
    // Acute:Chronic Workload Ratio. Sweet spot 0.8-1.3, danger zone >1.5.
    polarity: 'target', target: 1.0,
    // Two-sided thresholds: amber and red bands on both sides of the sweet spot.
    thresholds: {
      green: [0.8, 1.3],
      amber: [[0.5, 0.8], [1.3, 1.5]],
      red:   [[0, 0.5], [1.5, 99]],
    },
    // Trend window: 7 days makes sense for the rolling acute load.
    historyOf: null,  // ACWR itself is already a derived ratio over a window
    compute: (ctx) => {
      const cutoff7  = daysAgo(7);
      const cutoff28 = daysAgo(28);
      const acts = ctx.activities || [];
      const last7  = filterByDateGe(acts, cutoff7).filter(isRun);
      const last28 = filterByDateGe(acts, cutoff28).filter(isRun);
      const mi7  = last7.reduce((s, a) => s + (a.distanceMi || 0), 0);
      const mi28 = last28.reduce((s, a) => s + (a.distanceMi || 0), 0);
      const avg28Weekly = mi28 / 4;
      if (avg28Weekly < 1) return null;
      const ratio = +(mi7 / avg28Weekly).toFixed(2);
      const status = ratio > 1.5 ? 'red' : ratio > 1.3 ? 'amber' : ratio < 0.5 ? 'amber' : 'green';
      return { value: ratio, sublabel: `${mi7.toFixed(1)} / ${avg28Weekly.toFixed(1)} mi`, status };
    },
    available: (ctx) => (ctx.activities || []).filter(isRun).length >= 4,
  },

  // ═══ STRENGTH ══════════════════════════════════════════════════════════
  {
    id: 'epoc', label: 'EPOC (Load)', category: 'strength', unit: '',
    polarity: 'neutral', // higher load = harder workout, neither inherently good/bad
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.totalTrainingLoad).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (s?.totalTrainingLoad == null) return null;
      return { value: Math.round(s.totalTrainingLoad), sublabel: s.date };
    },
  },
  {
    id: 'avgStrengthHR', label: 'Avg HR (Strength)', category: 'strength', unit: 'bpm',
    polarity: 'neutral',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.avgHR).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.avgHR) return null;
      return {
        value: Math.round(s.avgHR),
        sublabel: s.date,
        hrZones: Array.isArray(s.hrZones) && s.hrZones.length === 5 ? s.hrZones : null,
      };
    },
  },
  {
    id: 'peakStrengthHR', label: 'Peak HR', category: 'strength', unit: 'bpm',
    polarity: 'neutral',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.maxHR).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.maxHR) return null;
      return { value: Math.round(s.maxHR), sublabel: s.date };
    },
  },
  {
    id: 'workRestRatio', label: 'Work : Rest', category: 'strength', unit: '',
    // Total work seconds vs total rest seconds for the latest strength session,
    // expressed as 1:X. The energy system being trained correlates directly
    // with the ratio, so the SUBLABEL surfaces the training effect (Power /
    // Hypertrophy / Endurance) rather than the value being colored as
    // "good/bad" — the user's intent for that session decides which is right.
    polarity: 'neutral', // No good/bad direction — depends on training intent
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .filter(s => s?.totalWorkSecs && s?.totalRestSecs)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => +(s.totalRestSecs / s.totalWorkSecs).toFixed(2)),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.totalWorkSecs || !s?.totalRestSecs) {
        // Surface why the tile is empty: lap/set-typed data is required.
        const hasAny = (ctx.activities || []).some(a => a?.totalWorkSecs);
        if (!hasAny && latestStrength(ctx.activities)) {
          return { value: '—', sublabel: 'Need lap/set data' };
        }
        return null;
      }
      const ratio = s.totalRestSecs / s.totalWorkSecs;
      // Energy-system label per coaching literature.
      let system;
      if (ratio >= 5)        system = 'Power';
      else if (ratio >= 1.5) system = 'Hypertrophy';
      else if (ratio >= 0.5) system = 'Mixed';
      else                   system = 'Endurance';
      return {
        value: `1 : ${ratio.toFixed(1)}`,
        sublabel: `${system} · ${Math.round(s.totalWorkSecs)}s work / ${Math.round(s.totalRestSecs)}s rest`,
      };
    },
    available: (ctx) => (ctx.activities || []).some(a => a?.totalWorkSecs && a?.totalRestSecs),
  },
  {
    id: 'activeStrengthCal', label: 'Active Cal', category: 'strength', unit: 'kcal',
    polarity: 'neutral',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.calories).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.calories) return null;
      return { value: Math.round(s.calories), sublabel: s.date };
    },
  },
  {
    id: 'sessionDuration', label: 'Session Duration', category: 'strength', unit: '',
    polarity: 'neutral',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.durationSecs ? Math.round(s.durationSecs / 60) : null).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.durationSecs) return null;
      const m = Math.round(s.durationSecs / 60);
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return {
        value: h > 0 ? `${h}h ${mm}m` : `${m}m`,
        sublabel: s.date,
      };
    },
  },
  {
    id: 'preTrainingCarbs', label: 'Pre-Training Carbs', category: 'strength', unit: 'g',
    polarity: 'higher-better',
    // 30g+ within 2hr pre = adequate fueling for a strength session.
    thresholds: { green: [30, 200], amber: [15, 30], red: [0, 15] },
    // Sum carb intake in 2hr window before latest strength session start.
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.startTime) return null;
      // Build start datetime from session date + start time string
      // (e.g. "2026-04-26" + "07:30") — best-effort, returns null if shape unknown
      const tMatch = String(s.startTime).match(/(\d{1,2}):(\d{2})/);
      if (!tMatch) return null;
      const [, hh, mm] = tMatch;
      const sessionStart = new Date(`${s.date}T${hh.padStart(2, '0')}:${mm}:00`);
      const windowStart = new Date(sessionStart.getTime() - 2 * 60 * 60 * 1000);
      const log = ctx.nutritionLog || [];
      const inWindow = log.filter(e => {
        if (!e?.timestamp) return false;
        const t = new Date(e.timestamp);
        return t >= windowStart && t <= sessionStart;
      });
      if (!inWindow.length) return null;
      const carbs = inWindow.reduce((s, e) => s + (Number(e?.macros?.carbs) || Number(e?.carbs) || 0), 0);
      return { value: Math.round(carbs), sublabel: '2hr pre' };
    },
    available: (ctx) => Array.isArray(ctx.nutritionLog) && ctx.nutritionLog.length > 0,
  },
  {
    id: 'postTrainingProtein', label: 'Post-Training Protein', category: 'strength', unit: 'g',
    polarity: 'higher-better',
    // 25g+ in the 60-min post window optimizes muscle protein synthesis.
    thresholds: { green: [25, 100], amber: [15, 25], red: [0, 15] },
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.startTime || !s?.durationSecs) return null;
      const tMatch = String(s.startTime).match(/(\d{1,2}):(\d{2})/);
      if (!tMatch) return null;
      const [, hh, mm] = tMatch;
      const sessionStart = new Date(`${s.date}T${hh.padStart(2, '0')}:${mm}:00`);
      const sessionEnd = new Date(sessionStart.getTime() + s.durationSecs * 1000);
      const windowEnd = new Date(sessionEnd.getTime() + 60 * 60 * 1000);
      const log = ctx.nutritionLog || [];
      const inWindow = log.filter(e => {
        if (!e?.timestamp) return false;
        const t = new Date(e.timestamp);
        return t >= sessionEnd && t <= windowEnd;
      });
      if (!inWindow.length) return null;
      const protein = inWindow.reduce((s, e) => s + (Number(e?.macros?.protein) || Number(e?.protein) || 0), 0);
      return { value: Math.round(protein), sublabel: '60min post' };
    },
    available: (ctx) => Array.isArray(ctx.nutritionLog) && ctx.nutritionLog.length > 0,
  },

  // ═══ RECOVERY ══════════════════════════════════════════════════════════
  {
    id: 'overnightHRV', label: 'Overnight HRV', category: 'recovery', unit: 'ms',
    polarity: 'higher-better',
    // Adult-male reference ranges (loose). Without a personal baseline we use
    // typical ranges; long-term, ideally calibrated to user's 90d distribution.
    thresholds: { green: [40, 999], amber: [30, 40], red: [0, 30] },
    // Combine HRV sources by date:
    //   - sleep collection (Phase 4c Garmin Worker): each night has overnightHRV
    //   - hrvData collection (manual Garmin HRV CSV imports): per-day observations
    // Worker source wins on dates where both exist (it's authoritative — same
    // upstream as Garmin Connect itself). Falls back to manual CSV otherwise.
    historyOf: (ctx) => mergedHrvByDate(ctx).map(o => o.overnightHRV),
    compute: (ctx) => {
      const merged = mergedHrvByDate(ctx);
      const recent = merged.filter(o => isWithinDays(o.date, 7));
      if (!recent.length) return null;
      const v = avg(recent, 'overnightHRV');
      const sourceLabels = new Set(recent.map(o => o.source));
      const sourceTag = sourceLabels.size === 1
        ? (sourceLabels.has('worker') ? 'worker · 7d avg' : 'csv · 7d avg')
        : '7d avg';
      return { value: Math.round(v), sublabel: sourceTag };
    },
  },
  {
    id: 'rhr', label: 'RHR', category: 'recovery', unit: 'bpm',
    polarity: 'lower-better',
    thresholds: { green: [0, 55], amber: [55, 65], red: [65, 200] },
    historyOf: (ctx) => [...(ctx.sleepData || [])]
      .filter(s => s?.restingHR)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.restingHR),
    compute: (ctx) => {
      const sleeps = [...(ctx.sleepData || [])]
        .filter(s => s?.restingHR)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!sleeps.length) return null;
      return { value: Math.round(sleeps[0].restingHR), sublabel: sleeps[0].date };
    },
  },
  {
    id: 'sleepScore', label: 'Sleep Score', category: 'recovery', unit: '/100',
    polarity: 'higher-better',
    thresholds: { green: [80, 100], amber: [60, 80], red: [0, 60] },
    historyOf: (ctx) => [...(ctx.sleepData || [])]
      .filter(s => s?.sleepScore != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.sleepScore),
    compute: (ctx) => {
      const sleeps = [...(ctx.sleepData || [])]
        .filter(s => s?.sleepScore != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!sleeps.length) return null;
      return { value: Math.round(Math.min(sleeps[0].sleepScore, 100)), sublabel: sleeps[0].date };
    },
  },
  {
    id: 'morningBodyBattery', label: 'Body Battery', category: 'recovery', unit: '/100',
    polarity: 'higher-better',
    thresholds: { green: [70, 100], amber: [50, 70], red: [0, 50] },
    // Field-priority for resilience (Garmin's reports/daily endpoint can return
    // sparse intraday samples, which leaves bodyBatteryStart null even when
    // charged/drained come through fine):
    //   1. bodyBatteryStart  — first intraday sample = true morning value
    //   2. bodyBatteryMax    — peak of the day (almost always morning)
    //   3. bodyBatteryEnd    — most recent sample (current value)
    //   4. derive from charged/drained: assume net change starts from yesterday's end
    historyOf: (ctx) => (ctx.wellness || [])
      .map(w => bodyBatteryDerived(w))
      .filter(v => v != null)
      .sort((_a, _b) => 0) // already ordered by date in collection — keep insertion order
      .reverse(),
    compute: (ctx) => {
      const wm = (ctx.wellness || []).find(w => w?.date === localToday());
      if (!wm) return null;
      const v = bodyBatteryDerived(wm);
      if (v == null) return null;
      const sub = wm.bodyBatteryStart != null ? 'morning'
                : wm.bodyBatteryMax  != null ? 'peak today'
                : wm.bodyBatteryEnd  != null ? 'current'
                : `+${wm.bodyBatteryCharged ?? 0}/-${wm.bodyBatteryDrained ?? 0}`;
      return { value: Math.round(v), sublabel: sub };
    },
    available: (ctx) => (ctx.wellness || []).some(w =>
      w?.bodyBatteryStart != null
      || w?.bodyBatteryMax != null
      || w?.bodyBatteryEnd != null
      || w?.bodyBatteryCharged != null
    ),
  },
  {
    id: 'dailyStress', label: 'Daily Stress', category: 'recovery', unit: '/100',
    polarity: 'lower-better',
    thresholds: { green: [0, 30], amber: [30, 60], red: [60, 100] },
    historyOf: (ctx) => (ctx.wellness || [])
      .filter(w => w?.avgStress != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.avgStress),
    compute: (ctx) => {
      // Prefer today's row; fall back to the most recent date with avgStress.
      const today = (ctx.wellness || []).find(w => w?.date === localToday());
      const fallback = [...(ctx.wellness || [])]
        .filter(w => w?.avgStress != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const wm = (today?.avgStress != null) ? today : fallback;
      if (!wm || wm.avgStress == null) return null;
      const sublabel = wm.date === localToday() ? 'today' : wm.date;
      return { value: Math.round(wm.avgStress), sublabel };
    },
    available: (ctx) => (ctx.wellness || []).some(w => w?.avgStress != null),
  },
  {
    id: 'trainingReadiness', label: 'Training Readiness', category: 'recovery', unit: '/100',
    polarity: 'higher-better',
    thresholds: { green: [70, 100], amber: [40, 70], red: [0, 40] },
    historyOf: (ctx) => (ctx.wellness || [])
      .filter(w => w?.trainingReadiness != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.trainingReadiness),
    compute: (ctx) => {
      const today = (ctx.wellness || []).find(w => w?.date === localToday());
      const fallback = [...(ctx.wellness || [])]
        .filter(w => w?.trainingReadiness != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const wm = (today?.trainingReadiness != null) ? today : fallback;
      if (!wm || wm.trainingReadiness == null) return null;
      const sublabel = wm.date === localToday() ? 'today' : wm.date;
      return { value: Math.round(wm.trainingReadiness), sublabel };
    },
    available: (ctx) => (ctx.wellness || []).some(w => w?.trainingReadiness != null),
  },
  {
    id: 'recoveryHours', label: 'Recovery Hours', category: 'recovery', unit: 'h',
    polarity: 'lower-better',
    thresholds: { green: [0, 12], amber: [12, 36], red: [36, 999] },
    historyOf: (ctx) => (ctx.wellness || [])
      .filter(w => w?.recoveryHours != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.recoveryHours),
    compute: (ctx) => {
      const today = (ctx.wellness || []).find(w => w?.date === localToday());
      const fallback = [...(ctx.wellness || [])]
        .filter(w => w?.recoveryHours != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const wm = (today?.recoveryHours != null) ? today : fallback;
      if (!wm || wm.recoveryHours == null) return null;
      const sublabel = wm.date === localToday() ? 'until baseline' : `as of ${wm.date}`;
      return { value: Math.round(wm.recoveryHours), sublabel };
    },
    available: (ctx) => (ctx.wellness || []).some(w => w?.recoveryHours != null),
  },
  {
    id: 'sleepRegularity', label: 'Sleep Regularity', category: 'recovery', unit: 'min',
    // Standard deviation of sleep-onset time over last 7 nights, in minutes.
    polarity: 'lower-better',
    // <30 min SD = consistent. 30-60 = average. >60 = chaotic.
    thresholds: { green: [0, 30], amber: [30, 60], red: [60, 999] },
    // historyOf: rolling 7-night SD computed at each of the last 30 days.
    // Mean of that series = "typical weekly bedtime consistency this month".
    // Averaging windowed-statistics (not raw values) so the 30d avg is
    // meaningful for a derived metric.
    historyOf: (ctx) => {
      const allRows = (ctx.sleepData || []).filter(s => s?.date && (s.bedtime || s.sleepStart));
      if (allRows.length < 3) return [];
      // Build a date→onsetMin map
      const byDate = new Map();
      for (const s of allRows) {
        const t = String(s.bedtime || s.sleepStart);
        const m = t.match(/(\d{1,2}):(\d{2})/);
        if (!m) continue;
        let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (mins >= 18 * 60) mins -= 24 * 60;
        byDate.set(s.date, mins);
      }
      // For each day in last 30, compute SD of the 7 prior days that have data
      const out = [];
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const window = [];
        for (let j = 0; j < 7; j++) {
          const wd = new Date(d);
          wd.setDate(d.getDate() - j);
          const ds = `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`;
          if (byDate.has(ds)) window.push(byDate.get(ds));
        }
        if (window.length < 3) continue;
        const mean = window.reduce((s, v) => s + v, 0) / window.length;
        const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
        out.push(Math.round(Math.sqrt(variance)));
      }
      return out;
    },
    compute: (ctx) => {
      const recent = filterByDateGe(ctx.sleepData || [], daysAgo(7))
        .filter(s => s?.bedtime || s?.sleepStart);
      if (recent.length < 3) return null;
      const onsetMinutes = recent.map(s => {
        const t = String(s.bedtime || s.sleepStart);
        const m = t.match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        // Normalize: bedtimes between 6pm-6am → centered around midnight
        // 22:00 = 1320 → -120 (relative to midnight)
        // 02:00 = 120 (already past midnight)
        if (mins >= 18 * 60) mins -= 24 * 60; // late evening → negative
        return mins;
      }).filter(v => v != null);
      if (onsetMinutes.length < 3) return null;
      const m = onsetMinutes.reduce((s, v) => s + v, 0) / onsetMinutes.length;
      const variance = onsetMinutes.reduce((s, v) => s + (v - m) ** 2, 0) / onsetMinutes.length;
      const stdMin = Math.round(Math.sqrt(variance));
      return { value: `±${stdMin}`, sublabel: '7-night SD' };
    },
    available: (ctx) => (ctx.sleepData || []).filter(s => s?.bedtime || s?.sleepStart).length >= 3,
  },

  // ═══ BODY ══════════════════════════════════════════════════════════════
  {
    id: 'totalCal', label: 'Calories', category: 'body', unit: 'kcal',
    polarity: 'target',
    // Both compute and historyOf use macroForDate so the Cronometer Worker's
    // full-day entries are picked up (they were being missed by the raw
    // todayLog reduce, which only summed manual entries).
    historyOf: (ctx) => macroHistory30(ctx, 'calories'),
    compute: (ctx) => {
      const today = localToday();
      const cal = macroForDate(ctx, today, 'calories');
      if (cal <= 0) return null;
      const target = ctx.profile?.dailyCalorieTarget || 2200;
      const pct = cal / target;
      return {
        value: Math.round(cal),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
  },
  {
    id: 'protein', label: 'Protein', category: 'body', unit: 'g',
    polarity: 'higher-better', // for protein, going OVER target is fine
    historyOf: (ctx) => macroHistory30(ctx, 'protein'),
    compute: (ctx) => {
      const today = localToday();
      const p = macroForDate(ctx, today, 'protein');
      if (p <= 0) return null;
      const target = ctx.profile?.dailyProteinTarget || 150;
      const pct = p / target;
      return {
        value: Math.round(p),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'higher'),
      };
    },
  },
  {
    id: 'carbs', label: 'Carbs', category: 'body', unit: 'g',
    polarity: 'target',
    historyOf: (ctx) => macroHistory30(ctx, 'carbs'),
    compute: (ctx) => {
      const today = localToday();
      const c = macroForDate(ctx, today, 'carbs');
      if (c <= 0) return null;
      const target = ctx.profile?.dailyCarbTarget || 250;
      const pct = c / target;
      return {
        value: Math.round(c),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
  },
  {
    id: 'fat', label: 'Fat', category: 'body', unit: 'g',
    polarity: 'target',
    historyOf: (ctx) => macroHistory30(ctx, 'fat'),
    compute: (ctx) => {
      const today = localToday();
      const f = macroForDate(ctx, today, 'fat');
      if (f <= 0) return null;
      const target = ctx.profile?.dailyFatTarget || 70;
      const pct = f / target;
      return {
        value: Math.round(f),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
  },
  {
    id: 'fiber', label: 'Fiber', category: 'body', unit: 'g',
    polarity: 'higher-better',
    historyOf: (ctx) => macroHistory30(ctx, 'fiber'),
    compute: (ctx) => {
      const today = localToday();
      const f = macroForDate(ctx, today, 'fiber');
      if (f <= 0) return null;
      const target = ctx.profile?.dailyFiberTarget || 30;
      const pct = f / target;
      return {
        value: Math.round(f),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'higher'),
      };
    },
  },
  {
    id: 'micronutrientScore', label: 'Micros', category: 'body', unit: '%',
    polarity: 'higher-better',
    thresholds: { green: [80, 100], amber: [50, 80], red: [0, 50] },
    // Roll-up: percentage of tracked micronutrients hitting their RDI today.
    compute: (ctx) => {
      const today = localToday();
      const todayCrono = (ctx.cronometer || []).find(r => r?.date === today);
      const totals = todayCrono?.totals || todayCrono;
      if (!totals) return null;
      // Subset of important micros + their RDI (US adult male reference)
      const RDI = {
        'Vitamin C (mg)': 90, 'Vitamin D (IU)': 600, 'Vitamin B12 (µg)': 2.4,
        'Magnesium (mg)': 420, 'Potassium (mg)': 3400, 'Iron (mg)': 8,
        'Zinc (mg)': 11, 'Calcium (mg)': 1000,
      };
      let hit = 0; let total = 0;
      for (const [k, rdi] of Object.entries(RDI)) {
        const v = parseFloat(totals[k]);
        if (!isFinite(v)) continue;
        total++;
        if (v >= rdi) hit++;
      }
      if (total === 0) return null;
      return { value: Math.round((hit / total) * 100), sublabel: `${hit}/${total} hit` };
    },
    available: (ctx) => Array.isArray(ctx.cronometer) && ctx.cronometer.some(r => r?.totals || r?.['Magnesium (mg)']),
  },
  {
    id: 'weightTrend', label: 'Weight Trend', category: 'body', unit: 'lb',
    // Polarity depends on user's goal direction. Without an explicit "cut"
    // / "bulk" / "maintain" flag in profile, treat as 'target' against the
    // user's targetWeight. If no target set, polarity falls to 'neutral'.
    polarity: 'target',
    historyOf: (ctx) => [...(ctx.weightData || [])]
      .filter(w => w?.weightLbs)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.weightLbs),
    compute: (ctx) => {
      const recent = filterByDateGe(ctx.weightData || [], daysAgo(7))
        .filter(w => w?.weightLbs);
      if (!recent.length) return null;
      const v = avg(recent, 'weightLbs');
      const target = ctx.profile?.targetWeight || null;
      return {
        value: v.toFixed(1),
        sublabel: target ? `target ${target}` : '7d avg',
      };
    },
    trendOf: (ctx) => {
      // Prior 7-14d for the trend arrow
      const prev = filterByDateGe(ctx.weightData || [], daysAgo(14))
        .filter(w => w?.weightLbs && w.date < new Date(daysAgo(7)).toISOString().slice(0, 10));
      if (!prev.length) return null;
      return avg(prev, 'weightLbs');
    },
  },
  {
    id: 'sodium', label: 'Sodium', category: 'body', unit: 'mg',
    polarity: 'target',
    // Sodium is in nutritionLog full-day entries' `extended` block (cronometer-
    // client.js) — macroForDate handles both the new path and the legacy
    // cronometer collection. Includes 30d history for the avg30 slot.
    historyOf: (ctx) => macroHistory30(ctx, 'sodium'),
    compute: (ctx) => {
      const today = localToday();
      let v = macroForDate(ctx, today, 'sodium');
      // Legacy cronometer used "Sodium (mg)" key in totals — keep that path
      // as a final fallback for old data.
      if (v <= 0) {
        const todayCrono = (ctx.cronometer || []).find(r => r?.date === today);
        const totals = todayCrono?.totals || todayCrono;
        v = totals ? parseFloat(totals['Sodium (mg)']) : 0;
      }
      if (!isFinite(v) || v <= 0) return null;
      const target = ctx.profile?.dailySodiumTarget || 2300;
      const pct = v / target;
      return {
        value: Math.round(v),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
    available: (ctx) => Array.isArray(ctx.cronometer) && ctx.cronometer.some(r => {
      const t = r?.totals || r;
      return t && t['Sodium (mg)'] != null;
    }),
  },
];

// ── Defaults for new users ──────────────────────────────────────────────────
// Picked to be useful from day one: covers the most-commonly-available
// data for a Garmin + Cronometer + Health Connect setup. User can change
// any of these at any time via the Goals → Customize Start tiles picker.
export const DEFAULT_TILE_PREFS = {
  // Run defaults reflect race-prep diagnostic value: aerobic base volume
  // (Z2), efficiency drift (decoupling), injury risk (ACWR), turnover
  // (cadence). VO/GCT/AnaerobicTE remain in the registry as toggleable
  // options for users who want the biomechanics view, but aren't default.
  run:      ['avgRunHR', 'zone2Weekly', 'aerobicDecoupling', 'acwr'],
  strength: ['avgStrengthHR', 'sessionDuration', 'activeStrengthCal', 'epoc'],
  recovery: ['overnightHRV', 'rhr', 'sleepScore', 'sleepRegularity'],
  body:     ['totalCal', 'protein', 'weightTrend', 'fiber'],
};

// ── Lookup helpers ──────────────────────────────────────────────────────────

const _byId = new Map(TILE_METRICS.map(m => [m.id, m]));
export const getMetric = (id) => _byId.get(id);

export const metricsByCategory = (category) =>
  TILE_METRICS.filter(m => m.category === category);

// ── Validation: clamp user prefs to min 2 / max 4 + drop unknown ids ───────

export function normalizeTilePrefs(prefs) {
  const out = { run: [], strength: [], recovery: [], body: [] };
  for (const cat of Object.keys(out)) {
    const incoming = Array.isArray(prefs?.[cat]) ? prefs[cat] : [];
    const valid = incoming.filter(id => {
      const m = _byId.get(id);
      return m && m.category === cat;
    });
    // Pad with defaults if below min, truncate if above max
    let chosen = valid.slice(0, 4);
    if (chosen.length < 2) {
      const fallback = DEFAULT_TILE_PREFS[cat] || [];
      for (const id of fallback) {
        if (chosen.length >= 2) break;
        if (!chosen.includes(id)) chosen.push(id);
      }
    }
    out[cat] = chosen;
  }
  return out;
}

// ── Context builder ─────────────────────────────────────────────────────────
// Single function that gathers everything any metric might need from storage.
// Called once per render rather than each metric reading storage individually.
export function buildTileContext({ activities, sleepData, hrvData, weightData, nutritionLog, cronometer, dailyLogs, profile, wellness }) {
  return {
    activities: activities || [],
    sleepData: sleepData || [],
    hrvData: hrvData || [],
    weightData: weightData || [],
    nutritionLog: nutritionLog || [],
    cronometer: cronometer || [],
    dailyLogs: dailyLogs || [],
    profile: profile || {},
    wellness: wellness || [], // Phase 4 — empty until Garmin Connect Wellness sync ships
  };
}
