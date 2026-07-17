// core/worldModel.js — the athlete's SITUATION as one structured snapshot.
//
// WHY THIS EXISTS (roadmap Stage 1). The coach kept needing a new `if` for every time-of-day case
// (midnight fuel nag, bedtime "no energy", morning "you missed a session") because it reasoned over
// a flat bag of scalars (`hour`, `ea`, `readiness`). Context-engineering practice (Anthropic 2025)
// says: compute ONE high-signal, structured state and reason over THAT. `buildWorldModel` is that
// state — a first-class object across timescales (day · week · season · body · person) — so
// "don't nag about food at bedtime" becomes *"the athlete is in `wind_down`"* instead of `hour >= 21`
// sprinkled through five generators. The symptoms stop needing individual patches.
//
// PURE by contract: no storage / no Date / no I/O. Every input is pre-normalised by the live
// assembler (coachContext.js), exactly like computePlanSlice + coachNarrative — so this whole module
// is node-testable and sim-drivable. Missing inputs degrade to null/false fields; never throws.
//
// It is a SUPERSET of today's `ctx.clock` (it re-exports a compatible `clock`), so wiring it into
// buildCoachContext is additive: generators can start reading `ctx.day.phase` while every existing
// `ctx.clock` / `ctx.today.trainedToday` read keeps working unchanged.

// NB: `+null === 0` and `+'' === 0`, so a bare Number.isFinite(+x) would turn a MISSING value into
// 0 — which here would read a missing clock as 3am ('sleep') and a missing race horizon as 'taper'.
// That's exactly the fabrication the world model exists to prevent, so null/undefined/'' → default.
const numOr = (x, d = null) => {
  if (x === null || x === undefined || x === '') return d;
  return Number.isFinite(+x) ? +x : d;
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── DAY: a real temporal object, not a scalar hour ────────────────────────────────────────────
// phase priority is deliberate: sleep/wind-down WIN over recovery, so training at 22:00 still reads
// as `wind_down` (→ "sleep is the next input", not "refuel now"). trained-today collapses the rest
// of the active day to `recovery` (→ the pre-workout purpose beat goes quiet the moment you log).
//
//   hour band          phase            what it protects against
//   ───────────────    ─────────────    ─────────────────────────────────────────────
//   [null]             unknown          no clock → time-gated beats stay silent (no-fabrication)
//   [0,5)              sleep            "you haven't logged a session" at 3am
//   >=21               wind_down        "you have no energy" / "refuel" at bedtime
//   [5,8)              pre_dawn         early wake — don't nag about a day not started
//   trainedToday       recovery         Play/purpose beat updates the instant training is logged
//   [8,11)             morning          "you missed a workout" right after waking
//   [11,16)            midday           steady state
//   [16,21)            training_window  the usual pre-session / evening eval window
export function computeDayPhase(hour, trainedToday) {
  const h = numOr(hour);
  if (h == null) return 'unknown';
  if (h < 5) return 'sleep';
  if (h >= 21) return 'wind_down';
  if (h < 8) return 'pre_dawn';
  if (trainedToday) return 'recovery';
  if (h < 11) return 'morning';
  if (h < 16) return 'midday';
  return 'training_window';
}

export function buildDay({ hour, trainedToday = false, hasPlannedToday = false } = {}) {
  const h = numOr(hour);
  const phase = computeDayPhase(h, trainedToday);
  const isWindDown = h != null && (h >= 21 || h < 5);       // bedtime / asleep — suppress fuel & energy nags
  const isMorning = h != null && h >= 5 && h < 11;           // just up — suppress "you missed a session"
  const isEvening = h != null && h >= 16 && h < 21;          // the fuel/EA read is genuinely relevant here
  const isSleep = phase === 'sleep';
  const fuelWindowOpen = h != null && h >= 6 && h < 21;      // eating hours — outside this, don't talk intake
  const postWorkout = !!trainedToday;                        // trained → the day's training story is "done"
  const preWorkout = !trainedToday && !!hasPlannedToday && h != null && h >= 5 && h < 21;
  return {
    hour: h,
    phase,
    trainedToday: !!trainedToday,
    hasPlannedToday: !!hasPlannedToday,
    isMorning, isEvening, isWindDown, isSleep,
    fuelWindowOpen, preWorkout, postWorkout,
  };
}

// ── WEEK: the plan's arc — planned vs done, adherence, what's ahead, the deviations ─────────────
// Thin wrapper over the plan slice computePlanSlice already produces; adds adherence + a compact
// deviation read so the plan voice keys off `week`, not raw plan fields.
export function buildWeek({ plan = {}, injuryArea = null } = {}) {
  const p = plan || {};
  const miTarget = numOr(p.weekMiTarget, 0) || 0;
  const miProjected = numOr(p.weekMiProjected, miTarget);
  const missed = Array.isArray(p.missed) ? p.missed : [];
  const remaining = Array.isArray(p.remaining) ? p.remaining : [];
  const missedMi = missed.reduce((a, m) => a + (numOr(m && m.mi, 0) || 0), 0);
  const adherencePct = miTarget > 0 ? clamp(Math.round((1 - missedMi / miTarget) * 100), 0, 100) : null;
  const strengthTarget = numOr(p.strengthTarget);
  const strengthDone = numOr(p.strengthDone);
  return {
    hasPlan: miTarget > 0,
    miTarget: Math.round(miTarget),
    miProjected: Math.round(miProjected),
    missed,
    remaining,
    missedCount: missed.length,
    remainingCount: remaining.length,
    adherencePct,
    strengthTarget,
    strengthDone,
    swappedToStrength: !!p.swappedToStrength,
    reshapedAround: (injuryArea && injuryArea !== 'generic') ? injuryArea : null,
    deviated: missed.length > 0 || !!p.swappedToStrength || (!!injuryArea && injuryArea !== 'generic'),
  };
}

// ── SEASON: build → peak → taper, weeks-to-race, block intent ───────────────────────────────────
// Marathon-shaped defaults: taper ~ final 2 wk, peak ~ the sharpening weeks before it, else base build.
// daysOut null → 'unknown' (no race horizon → the season read stays silent, no fabrication).
export function computeSeasonPhase(daysOut) {
  const d = numOr(daysOut);
  if (d == null || d < 0) return 'unknown';
  if (d <= 14) return 'taper';
  if (d <= 42) return 'peak';
  return 'build';
}

export function buildSeason({ aRace = null } = {}) {
  const race = aRace || null;
  const daysOut = numOr(race && race.daysOut);
  const phase = computeSeasonPhase(daysOut);
  const weeksToRace = daysOut != null ? Math.round(daysOut / 7) : null;
  const intent = phase === 'taper'
    ? 'sharpen and shed fatigue — volume drops, freshness rises'
    : phase === 'peak'
      ? 'peak the specific fitness — the hardest, most race-like work'
      : phase === 'build'
        ? 'build the aerobic base and durability — bank the volume'
        : null;
  return {
    raceName: (race && race.name) || null,
    daysOut,
    weeksToRace,
    phase,
    intent,
    hasRace: !!(race && race.name),
  };
}

// ── BODY: trends, not just today's value ───────────────────────────────────────────────────────
// Direction of travel for the signals we have. Kept minimal (weight direction + rate, heat, EA
// status); richer HRV/sleep/load trends slot in here as the assembler starts passing them.
export function buildBody({ body = null, fuel = {}, tempC = null, readiness = null } = {}) {
  const b = body || {};
  const f = fuel || {};
  const rate = numOr(b.observedRateLbPerWk);
  return {
    weightDirection: b.direction || null,          // 'cut' | 'bulk' | 'maintain'
    weightRateLbPerWk: rate,
    targetLb: numOr(b.targetLb),
    eaStatus: (f.ea && f.ea.status) || (f.ea && f.ea.flag ? 'low' : null),
    eaFlag: !!(f.ea && f.ea.flag),
    tempC: numOr(tempC),
    heatStressed: numOr(tempC) != null && numOr(tempC) >= 24,
    readinessScore: numOr(readiness && readiness.score),
    readinessBand: (readiness && readiness.band) || null,
  };
}

// ── PERSON: the learned profile (Stage 4 fills this) ────────────────────────────────────────────
// Stub today: a stable shape so the reasoner/generators can key off `person` now and gain signal
// later without a shape change. stancePref/patterns arrive with the memory + preference-learning
// stage (engagement signal → learned stance). goals/values carried through when available.
export function buildPerson({ profile = null, memory = null } = {}) {
  const pr = profile || {};
  return {
    stancePref: pr.stancePref || null,             // learned: 'facilitative' | 'directive' | null
    patterns: Array.isArray(pr.patterns) ? pr.patterns : [],   // e.g. ['july_heat_breaks_them']
    sleepGoalHrs: numOr(pr.sleepGoalHrs),
    saidAgoDays: (memory && memory.saidAgoDays) || {},         // novelty carried from coachMemory
  };
}

// ── THE ASSEMBLER ───────────────────────────────────────────────────────────────────────────────
// One structured snapshot the generators reason over. Backward-compatible: also returns `clock`
// (the same {hour,isEvening,isLateNight} shape today's ctx exposes) so wiring is purely additive.
export function buildWorldModel(input = {}) {
  const {
    hour = null,
    trainedToday = false,
    hasPlannedToday = false,
    plan = {},
    aRace = null,
    body = null,
    fuel = {},
    readiness = null,
    injuryArea = null,
    tempC = null,
    profile = null,
    memory = null,
  } = input || {};

  const day = buildDay({ hour, trainedToday, hasPlannedToday });
  const week = buildWeek({ plan, injuryArea });
  const season = buildSeason({ aRace });
  const bodyModel = buildBody({ body, fuel, tempC, readiness });
  const person = buildPerson({ profile, memory });

  const h = numOr(hour);
  return {
    day,
    week,
    season,
    body: bodyModel,
    person,
    // Back-compat mirror of the legacy clock slice — lets existing ctx.clock reads keep working
    // while callers migrate to ctx.day.phase.
    clock: { hour: h, isEvening: day.isEvening, isLateNight: day.isWindDown },
  };
}

export default buildWorldModel;
