// ─── Cut Mode classifier (task #218) ───────────────────────────────────────
// Classifies the user's chronic fuel state so Coach signals can interpret
// intake numbers in context. Same 1800-kcal day means COMPLETELY different
// things depending on whether:
//   - the user has an intentional fat-loss target (background_cut — quiet)
//   - or has no goal direction at all (under_fueled — RED-S alarm)
//
// The load-bearing fork is `hasGoalDirection`. Without that distinction, the
// Coach either falsely alarms on intentional cuts (current behavior — gets
// annoying) or silently misses dangerous chronic under-fueling (the worse
// failure mode, because the user might not even know they're doing it).
//
// Decision tree (first match wins):
//   1. acute_cut      → sudden ≥20% drop vs 28d baseline in last 3 days
//   2. crash_cut      → goal + sustained ≥25% deficit + weight loss > 1.5 lb/wk
//   3. stalled_cut    → goal + deficit + no weight movement 7+ days
//   4. background_cut → goal + deficit + weight trending toward target
//   5. under_fueled   → 14d deficit ≥15% AND no fat-loss goal
//   6. surplus        → 14d intake > TDEE +10%, weight rising
//   7. maintenance    → fallback: intake ≈ TDEE, weight stable
//
// Returns a rich object so downstream Coach signals + UI can render context
// without recomputing the same windows.

import { storage } from './storage.js';
import { localDate, ymd } from './time.js';
import { parseLocalDate } from './dateUtils.js';
import { dailyTotals as nutDailyTotals } from './nutrition.js';
import { tdee } from './dcy.js';
import { getGoals } from './goals.js';

// ─── Tunable thresholds (single source of truth) ───────────────────────────
const THRESHOLDS = {
  // Deficit/surplus magnitudes (% vs TDEE)
  DEFICIT_MILD:    0.05,   // 5% — below this is "noise," call maintenance
  DEFICIT_REAL:    0.10,   // 10% — real deficit territory
  DEFICIT_UNDER:   0.15,   // 15% — RED-S risk when no goal
  DEFICIT_CRASH:   0.25,   // 25% — too aggressive even with a goal
  SURPLUS_MILD:    0.10,   // 10% over TDEE — lifestyle surplus
  // Weight movement (lb/wk)
  WEIGHT_STALL:    0.25,   // <0.25 lb/wk movement = stalled
  WEIGHT_CRASH:    1.5,    // >1.5 lb/wk loss = too aggressive
  WEIGHT_DROP_UNINTENDED: 0.5, // unintentional drop trigger when no goal
  // Windows (days)
  CHRONIC_WINDOW:    14,
  BASELINE_WINDOW:   28,
  ACUTE_WINDOW:      3,
  STALL_WINDOW:      7,
  // Acute drop magnitude
  ACUTE_DROP_PCT:    0.20,
  // Goal/race phase awareness
  ACTIVE_PHASE_WEEKS: 16,
};

// ─── Helper: average intake over a date range ──────────────────────────────
function _avgIntakeKcal(daysBack, excludeToday = true) {
  const today = parseLocalDate(localDate());
  if (!today) return null;
  const endOffset = excludeToday ? 1 : 0;
  let sum = 0, days = 0;
  for (let i = endOffset; i < daysBack + endOffset; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = ymd(d);
    const t = nutDailyTotals(ds);
    const cal = Number(t?.calories) || 0;
    if (cal > 0) { sum += cal; days += 1; }
  }
  return days > 0 ? { avg: sum / days, days } : null;
}

// ─── Helper: average TDEE over a date range ────────────────────────────────
function _avgTdee(daysBack) {
  const today = parseLocalDate(localDate());
  if (!today) return null;
  let sum = 0, days = 0;
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = ymd(d);
    const t = tdee(ds);
    if (Number.isFinite(t) && t > 0) { sum += t; days += 1; }
  }
  return days > 0 ? { avg: sum / days, days } : null;
}

// ─── Helper: filter weight rows to morning-fasted only ────────────────────
// Post-workout weights lose 1-2 lb of sweat + glycogen and pull medians
// and slopes artificially low. The "gold standard" body-comp reading is
// fasted, first thing in the morning. Garmin weight rows carry a `time`
// HH:MM string; we accept readings before 10am as morning-fasted. When a
// day has no morning reading, we still take its EARLIEST reading rather
// than dropping the day entirely — better partial signal than no signal.
const MORNING_CUTOFF_HOUR = 10;

function _morningWeightRows(rows) {
  if (!rows || !rows.length) return [];
  // Group by date, pick one row per date — morning if any exists, else
  // earliest time of day. Falls back to original row order if no `time`.
  const byDate = {};
  for (const r of rows) {
    if (!r?.date || !(Number(r?.weightLbs) > 0)) continue;
    const t = (r.time || '').match(/^(\d{1,2}):(\d{2})$/);
    const hour = t ? parseInt(t[1], 10) : null;
    const minute = t ? parseInt(t[2], 10) : 0;
    const minutesOfDay = hour != null ? hour * 60 + minute : 9999; // unknown time → push to end
    const existing = byDate[r.date];
    if (!existing) { byDate[r.date] = { row: r, minutesOfDay }; continue; }
    // Prefer morning over non-morning; if both morning OR both non-morning, prefer earlier.
    const exMorning = existing.minutesOfDay < MORNING_CUTOFF_HOUR * 60;
    const newMorning = minutesOfDay < MORNING_CUTOFF_HOUR * 60;
    if (newMorning && !exMorning) byDate[r.date] = { row: r, minutesOfDay };
    else if (newMorning === exMorning && minutesOfDay < existing.minutesOfDay) byDate[r.date] = { row: r, minutesOfDay };
  }
  return Object.values(byDate).map(v => v.row);
}

// ─── Helper: weight slope (lb/wk) over the last N days ─────────────────────
// Linear regression over morning-fasted weight rows. Positive = gaining,
// negative = losing. Morning-only filter is critical — mixing post-workout
// readings inflates the loss slope and creates phantom cuts.
function _weightSlopePerWeek(daysBack) {
  const rows = storage.get('weight') || [];
  const today = parseLocalDate(localDate());
  if (!today) return null;
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - daysBack);
  const morningRows = _morningWeightRows(rows);
  const pts = morningRows
    .map(r => ({ d: r?.date ? parseLocalDate(r.date) : null, v: Number(r?.weightLbs) }))
    .filter(p => p.d && p.d >= cutoff && Number.isFinite(p.v) && p.v > 0)
    .map(p => ({ d: p.d.getTime() / 86400000, v: p.v }))
    .sort((a, b) => a.d - b.d);
  if (pts.length < 4) return null;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.d, 0);
  const sy = pts.reduce((s, p) => s + p.v, 0);
  const sxy = pts.reduce((s, p) => s + p.d * p.v, 0);
  const sxx = pts.reduce((s, p) => s + p.d * p.d, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slopePerDay = (n * sxy - sy * sx) / denom;
  return slopePerDay * 7;
}

// ─── Helper: median recent weight (robust to BIA noise) ────────────────────
// Morning-only median — one fasted reading per day, take the median across
// the last N days.
function _recentWeightMedian(daysBack = 7) {
  const rows = storage.get('weight') || [];
  const today = parseLocalDate(localDate());
  if (!today) return null;
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - daysBack);
  const morningRows = _morningWeightRows(rows);
  const vals = morningRows
    .filter(r => { const d = parseLocalDate(r?.date); return d && d >= cutoff && Number(r?.weightLbs) > 0; })
    .map(r => Number(r.weightLbs))
    .sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
}

// ─── Helper: detect active goal direction ──────────────────────────────────
// Returns { hasGoal: bool, direction: 'lose'|'gain'|null, target, current, deltaToGoal }
function _detectGoalDirection() {
  const goals = getGoals() || {};
  const target = parseFloat(goals?.targetWeight) || null;
  const current = _recentWeightMedian(7);
  if (!target || !current) return { hasGoal: false, direction: null, target, current, deltaToGoal: null };
  const deltaToGoal = target - current;
  // Threshold: at least 1% delta from current to count as a real goal direction.
  // Without this, target = current ± noise would falsely count as a goal.
  if (Math.abs(deltaToGoal) / current < 0.01) {
    return { hasGoal: false, direction: null, target, current, deltaToGoal };
  }
  const direction = deltaToGoal < 0 ? 'lose' : 'gain';
  return { hasGoal: true, direction, target, current, deltaToGoal };
}

// ─── Helper: race horizon (active phase check) ─────────────────────────────
function _activePhase() {
  const races = (() => {
    try { return JSON.parse(localStorage.getItem('arnold:races') || '[]'); }
    catch { return []; }
  })();
  const today = parseLocalDate(localDate());
  if (!today) return { active: false, daysOut: null };
  const upcoming = races
    .map(r => ({ ...r, _d: parseLocalDate(r?.date) }))
    .filter(r => r._d && r._d >= today)
    .sort((a, b) => a._d - b._d)[0];
  if (!upcoming) return { active: false, daysOut: null };
  const daysOut = Math.round((upcoming._d - today) / 86400000);
  const active = daysOut <= THRESHOLDS.ACTIVE_PHASE_WEEKS * 7;
  return { active, daysOut, raceName: upcoming.name || null };
}

// ─── Manual override ──────────────────────────────────────────────────────
// Stored under 'cutModeOverride' as a state string OR null.
// When set, classifyCutMode returns the override directly with confidence 1.0
// and reason 'manual override' — bypasses all detection. Lets the user tell
// Arnold "I'm not cutting" during off-season, or "force background_cut" if
// the auto-detection isn't catching their pattern yet.
export function getCutModeOverride() {
  try { return storage.get('cutModeOverride') || null; } catch { return null; }
}
export function setCutModeOverride(state) {
  try {
    if (state == null || state === 'auto') {
      storage.set('cutModeOverride', null, { skipValidation: true });
    } else {
      storage.set('cutModeOverride', state, { skipValidation: true });
    }
    // Bust the cache so the next getCutMode() call reflects the override.
    storage.set('cutMode', null, { skipValidation: true });
  } catch {}
}

// ─── Main classifier ───────────────────────────────────────────────────────
export function classifyCutMode() {
  const today = localDate();

  // Manual override wins. Used to disable detection during off-season or
  // force a specific state when auto-detection lags behind the user's plan.
  const override = getCutModeOverride();
  if (override) {
    return {
      state: override,
      confidence: 1.0,
      reasoning: 'manual override (set in Plan → Cut Mode)',
      recommendation: null,
      goal: _detectGoalDirection(),
      phase: _activePhase(),
      intake: { avg14d: null, avg28d: null, avg3d: null },
      tdee: { avg14d: null },
      weight: { slope7d: null, slope14d: null, current: null },
      deficitPct: null,
      acuteDropPct: null,
      isOverride: true,
      computedAt: Date.now(),
    };
  }

  // Gather the inputs once.
  const intake14 = _avgIntakeKcal(THRESHOLDS.CHRONIC_WINDOW);
  const intake28 = _avgIntakeKcal(THRESHOLDS.BASELINE_WINDOW);
  const intake3  = _avgIntakeKcal(THRESHOLDS.ACUTE_WINDOW);
  const tdee14   = _avgTdee(THRESHOLDS.CHRONIC_WINDOW);
  const slope14  = _weightSlopePerWeek(THRESHOLDS.CHRONIC_WINDOW);
  const slope7   = _weightSlopePerWeek(THRESHOLDS.STALL_WINDOW);
  const goal     = _detectGoalDirection();
  const phase    = _activePhase();

  // If we can't even compute a 14d intake or TDEE, we don't have a basis.
  if (!intake14 || !tdee14 || intake14.days < 5 || tdee14.days < 5) {
    return {
      state: 'unknown',
      confidence: 0,
      reasoning: `insufficient data (intake days=${intake14?.days || 0}, tdee days=${tdee14?.days || 0})`,
      goal,
      phase,
      intake: { avg14d: intake14?.avg ?? null, avg28d: intake28?.avg ?? null, avg3d: intake3?.avg ?? null },
      tdee: { avg14d: tdee14?.avg ?? null },
      weight: { slope7d: slope7, slope14d: slope14, current: goal.current },
      computedAt: Date.now(),
    };
  }

  // Compute derived ratios.
  const deficitPct = (tdee14.avg - intake14.avg) / tdee14.avg;     // positive = deficit
  const acuteDropPct = (intake3 && intake28)
    ? (intake28.avg - intake3.avg) / intake28.avg
    : null;

  const base = {
    goal,
    phase,
    intake: { avg14d: intake14.avg, avg28d: intake28?.avg ?? null, avg3d: intake3?.avg ?? null },
    tdee: { avg14d: tdee14.avg },
    weight: { slope7d: slope7, slope14d: slope14, current: goal.current },
    deficitPct: +deficitPct.toFixed(3),
    acuteDropPct: acuteDropPct != null ? +acuteDropPct.toFixed(3) : null,
    computedAt: Date.now(),
  };

  // ── Decision tree ──

  // (1) ACUTE_CUT — sudden recent drop wins regardless of goal.
  // Catches sickness, stress, missed meals — actionable today.
  if (acuteDropPct != null && acuteDropPct >= THRESHOLDS.ACUTE_DROP_PCT) {
    return {
      ...base,
      state: 'acute_cut',
      confidence: 0.85,
      reasoning: `last 3d intake ${Math.round(intake3.avg)} kcal vs prior 28d avg ${Math.round(intake28.avg)} (${Math.round(acuteDropPct * 100)}% drop)`,
      recommendation: `Sudden intake drop. If unintentional, refuel today — especially around training. If intentional, slow the ramp.`,
    };
  }

  // (2) Goal-aware branch: user has a fat-loss target.
  if (goal.hasGoal && goal.direction === 'lose') {
    const weightLossPerWk = slope14 != null ? -slope14 : null; // positive when losing

    // CRASH_CUT — too aggressive even though intentional.
    if (deficitPct >= THRESHOLDS.DEFICIT_CRASH && weightLossPerWk != null && weightLossPerWk > THRESHOLDS.WEIGHT_CRASH) {
      return {
        ...base,
        state: 'crash_cut',
        confidence: 0.9,
        reasoning: `${Math.round(deficitPct * 100)}% deficit + losing ${weightLossPerWk.toFixed(2)} lb/wk — steeper than the trajectory needs`,
        recommendation: `Pace is steeper than your race horizon needs. Easing back ~200 kcal/day would protect lean mass, hormones, and performance without losing the timeline.`,
      };
    }

    // STALLED_CUT — deficit present but weight isn't moving.
    if (deficitPct >= THRESHOLDS.DEFICIT_REAL && slope7 != null && Math.abs(slope7) < THRESHOLDS.WEIGHT_STALL) {
      return {
        ...base,
        state: 'stalled_cut',
        confidence: 0.75,
        reasoning: `${Math.round(deficitPct * 100)}% deficit but weight flat (${slope7.toFixed(2)} lb/wk over 7d)`,
        recommendation: `Cut stalled. Worth a refeed day or reassessing TDEE — adaptive thermogenesis may have caught up.`,
      };
    }

    // BACKGROUND_CUT — intentional, sustained, on plan.
    // Triggers on EITHER (a) computed intake deficit ≥10% OR (b) weight
    // trajectory dropping toward target ≥0.4 lb/wk. The trajectory branch
    // catches the common case where Cronometer under-logs intake or TDEE
    // is under-estimated — the scale is the ground truth, the math is
    // the inference. When trajectory fires but deficit doesn't, mark the
    // confidence slightly lower and note the inferred path.
    const trajectoryCut = weightLossPerWk != null && weightLossPerWk >= 0.4;
    const deficitCut    = deficitPct >= THRESHOLDS.DEFICIT_REAL;
    if (deficitCut || trajectoryCut) {
      let projectedHitDate = null;
      if (weightLossPerWk != null && weightLossPerWk > 0.1 && goal.deltaToGoal != null) {
        const weeksToGoal = Math.abs(goal.deltaToGoal) / weightLossPerWk;
        const proj = new Date(); proj.setDate(proj.getDate() + Math.round(weeksToGoal * 7));
        projectedHitDate = ymd(proj);
      }
      const inferredFromTrajectory = trajectoryCut && !deficitCut;
      return {
        ...base,
        state: 'background_cut',
        confidence: inferredFromTrajectory ? 0.75 : 0.85,
        projectedHitDate,
        reasoning: inferredFromTrajectory
          ? `Losing ${weightLossPerWk.toFixed(2)} lb/wk toward ${goal.target} lb target (intake math shows only ${Math.round(deficitPct * 100)}% deficit — trajectory is the ground truth; intake likely under-logged or TDEE under-estimated)`
          : `${Math.round(deficitPct * 100)}% deficit, losing ${weightLossPerWk?.toFixed(2) ?? '—'} lb/wk toward ${goal.target} lb target`,
        recommendation: projectedHitDate
          ? `On pace — projecting ${goal.target} lb by ${projectedHitDate} at current trajectory.`
          : `Cut sustained — wait for clearer weight trend before projecting hit date.`,
      };
    }
  }

  // (3) Under-fueled WITHOUT a fat-loss goal — RED-S territory.
  // This is the most clinically important state. User has a sustained
  // deficit but no goal direction → they may not even know they're doing it.
  if (!goal.hasGoal || goal.direction !== 'lose') {
    if (deficitPct >= THRESHOLDS.DEFICIT_UNDER) {
      // Confidence high if weight is stable or dropping unintentionally.
      const dropping = slope14 != null && slope14 < -THRESHOLDS.WEIGHT_DROP_UNINTENDED / 7 * 7; // > 0.5 lb/wk drop
      const stable = slope14 == null || Math.abs(slope14) < THRESHOLDS.WEIGHT_STALL;
      if (dropping || stable) {
        return {
          ...base,
          state: 'under_fueled',
          confidence: dropping ? 0.95 : 0.8,
          reasoning: `${Math.round(deficitPct * 100)}% deficit sustained over ${intake14.days} days without a fat-loss goal — RED-S risk territory`,
          recommendation: `Averaging ${Math.round(intake14.avg)} kcal against a ${Math.round(tdee14.avg)} kcal training load with no goal direction. Add ${Math.round((tdee14.avg - intake14.avg) * 0.7)}-${Math.round(tdee14.avg - intake14.avg)} kcal/day, especially around training. Low energy availability over time compromises recovery, hormones, and bone health.`,
        };
      }
    }
  }

  // (4) Surplus — intake meaningfully over TDEE with weight rising.
  if (deficitPct < -THRESHOLDS.SURPLUS_MILD) {
    const gaining = slope14 != null && slope14 > THRESHOLDS.WEIGHT_STALL;
    if (gaining || goal.direction === 'gain') {
      return {
        ...base,
        state: 'surplus',
        confidence: 0.7,
        reasoning: `intake ${Math.round(Math.abs(deficitPct) * 100)}% over TDEE${gaining ? `, gaining ${slope14.toFixed(2)} lb/wk` : ''}`,
        recommendation: goal.direction === 'gain'
          ? `Surplus on plan — supporting weight gain toward target.`
          : `Surplus without a gain goal — drift, intentional, or refeed? Consider what's appropriate.`,
      };
    }
  }

  // (5) Fall-through: maintenance.
  return {
    ...base,
    state: 'maintenance',
    confidence: 0.7,
    reasoning: `intake ≈ TDEE (${Math.round(deficitPct * 100)}% delta), weight ${slope14 != null ? slope14.toFixed(2) + ' lb/wk' : 'stable'}`,
    recommendation: null,
  };
}

// ─── Cached accessor ───────────────────────────────────────────────────────
// Computes once per session and caches; recomputes if stale (>6h) or absent.
// Storage key: 'cutMode'.
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export function getCutMode() {
  try {
    const cached = storage.get('cutMode');
    const age = cached?.computedAt ? Date.now() - cached.computedAt : Infinity;
    if (cached && age < CACHE_MAX_AGE_MS) return cached;
  } catch (e) { /* fall through to recompute */ }
  return refreshCutMode();
}

export function refreshCutMode() {
  const result = classifyCutMode();
  try { storage.set('cutMode', result, { skipValidation: true }); } catch (e) {}
  return result;
}

// ─── Console debug helper ──────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.cutModeDebug = () => {
    const fresh = classifyCutMode();
    const cached = storage.get('cutMode');
    console.log('━━ Cut Mode ━━');
    console.log('state:', fresh.state, '(confidence', fresh.confidence + ')');
    console.log('reasoning:', fresh.reasoning);
    if (fresh.recommendation) console.log('recommendation:', fresh.recommendation);
    console.log('goal:', fresh.goal);
    console.log('intake:', fresh.intake);
    console.log('tdee:', fresh.tdee);
    console.log('weight:', fresh.weight);
    console.log('deficitPct:', fresh.deficitPct, '· acuteDropPct:', fresh.acuteDropPct);
    if (fresh.projectedHitDate) console.log('projectedHitDate:', fresh.projectedHitDate);
    console.log('cached:', cached);
    return { fresh, cached };
  };
}
