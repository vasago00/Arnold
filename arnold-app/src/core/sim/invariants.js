// Invariants — the "genuine tests" the simulation evaluates the engine against.
//
// TWO KINDS, kept explicitly separate for transparency:
//
//   HARD invariants (checkCase) — properties that MUST hold for EVERY case, zero
//     tolerance. A single violation fails the suite and reports the seed/inputs.
//     These encode the engine's contracts (e.g. "never prescribe below RMR").
//
//   STATISTICAL properties (AGG_MARGINS / checkAggregate) — distribution-level
//     expectations that hold ACROSS many cases within a stated margin (e.g. "≥90%
//     of hard sessions on a low-readiness day get eased or trimmed"). These catch
//     "the engine stopped responding" regressions that no single case would.
//
// Every margin below is a named constant with a rationale, so the acceptance
// criteria are auditable — not buried magic numbers.

const HUMAN_KCAL_MIN = 800;    // below this, a daily target is non-physiological
const HUMAN_KCAL_MAX = 6000;   // above this, ditto (even elite + carb-load)
const NIL_TYPES = new Set(['rest', 'mobility', 'recovery']);
const EASE_ACTIONS = new Set(['ease', 'trim']);
const VALID_ACTIONS = new Set(['ease', 'trim', 'hold', 'greenlit']);
const VALID_EA = new Set(['low', 'reduced', 'optimal', null]);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * checkCase — hard invariants for one simulated athlete-day.
 * @param input  the day record (from generateDayStream) + athlete
 * @param out    { adapted, fuel, target, targetNoEatBack }
 * @returns array of { id, msg } violations (empty = all held)
 */
export function checkCase(input, out) {
  const v = [];
  const add = (id, msg) => v.push({ id, msg });
  const { adapted, fuel, target, targetNoEatBack } = out;
  const planned = input.session;

  // ── Adaptation contracts ──
  if (!VALID_ACTIONS.has(adapted.action)) add('A2-action-enum', `invalid action "${adapted.action}"`);
  if (NIL_TYPES.has(planned.intensityClass) && adapted.action !== 'hold')
    add('A1-rest-never-eased', `${planned.intensityClass} day got action "${adapted.action}" (must hold)`);
  if (isNum(planned.distanceMi) && isNum(adapted.distanceMi) && adapted.distanceMi > planned.distanceMi + 1e-9)
    add('A3-volume-never-up', `distance rose ${planned.distanceMi}→${adapted.distanceMi}`);
  if (isNum(planned.durationMin) && isNum(adapted.durationMin) && adapted.durationMin > planned.durationMin + 1e-9)
    add('A3-volume-never-up', `duration rose ${planned.durationMin}→${adapted.durationMin}`);
  if (adapted.distanceMi != null && !isNum(adapted.distanceMi)) add('A4-nan', 'adapted.distanceMi NaN');
  if (adapted.durationMin != null && !isNum(adapted.durationMin)) add('A4-nan', 'adapted.durationMin NaN');
  if (adapted.action === 'greenlit' && !(input.readiness === 'high' && input.debtLbs < 0.5))
    add('A5-greenlit-gate', `greenlit with readiness=${input.readiness} debt=${input.debtLbs}`);
  if (EASE_ACTIONS.has(adapted.action) && !(typeof adapted.reason === 'string' && adapted.reason.length))
    add('A6-reason-shown', `action ${adapted.action} but no reason string`);

  // ── Fuel contracts ──
  for (const k of ['preCarbsG', 'duringCarbsPerHr', 'pmProteinG']) {
    if (!isNum(fuel[k]) || fuel[k] < 0) add('F1-fuel-nonneg', `${k}=${fuel[k]}`);
  }
  if (fuel.bracket === 'none' && (fuel.preCarbsG || fuel.duringCarbsPerHr || fuel.pmProteinG))
    add('F2-none-zero', `bracket none but fuel ${fuel.preCarbsG}/${fuel.duringCarbsPerHr}/${fuel.pmProteinG}`);
  if (!VALID_EA.has(fuel.ea?.status)) add('F4-ea-enum', `invalid ea.status "${fuel.ea?.status}"`);
  const ea = fuel.ea || {};
  if (isNum(ea.kcalPerKgFfm)) {
    const shouldFlag = ea.kcalPerKgFfm < 30;
    if (!!ea.flag !== shouldFlag) add('F3-ea-flag', `EA ${ea.kcalPerKgFfm} flag=${ea.flag} (expected ${shouldFlag})`);
    if ((ea.status === 'low') !== shouldFlag) add('F3-ea-status', `EA ${ea.kcalPerKgFfm} status=${ea.status}`);
  }

  // ── Calorie-target contracts ──
  if (!isNum(target.derived)) add('C2-target-nan', `derived=${target.derived}`);
  else {
    if (target.derived < target.effectiveFloor) add('C1-below-rmr-floor', `derived ${target.derived} < floor ${target.effectiveFloor}`);
    if (target.derived < HUMAN_KCAL_MIN || target.derived > HUMAN_KCAL_MAX)
      add('C2-target-range', `derived ${target.derived} outside [${HUMAN_KCAL_MIN},${HUMAN_KCAL_MAX}]`);
  }
  // The 2026-07-01 regression guard: eat-back must ADD on top of the floor, never
  // be swallowed by it. With eat-back present, the target must exceed the same day
  // computed with zero eat-back.
  if (input.eatBack > 0 && isNum(target.derived) && isNum(targetNoEatBack.derived)
      && !(target.derived > targetNoEatBack.derived))
    add('C4-eatback-stacks', `eatBack ${input.eatBack} but derived ${target.derived} ≤ no-eatBack ${targetNoEatBack.derived}`);

  return v;
}

// ── Statistical acceptance margins (auditable; each with a rationale) ──
export const AGG_MARGINS = {
  // A hard session on a low-readiness day should almost always be eased or trimmed.
  // Not 100% — a very mild limiter on a barely-hard session can legitimately hold —
  // so we require the large majority.
  hardLowReadinessEasedMin: 0.90,
  // The greenlit ("cleared for the full session — recovered") verdict is the rare
  // perfect-day call: it needs high readiness AND ~no recovery debt AND a full
  // battery AND no limiter at once. Measured across 3 seeds it lands ~0.15–0.25%,
  // stably. The min just proves the path is ALIVE (a break would drop it to 0); the
  // max proves it never dominates (which would mean it's not protecting recovery).
  greenlitFracMin: 0.0005,
  greenlitFracMax: 0.60,
  // Low-EA should fire for a minority of days given the intake distribution — never
  // 0 (the flag is dead) and never a majority (the population isn't starving). Wide,
  // it's a smoke check that the RED-S path is alive and not stuck-on.
  lowEaFracMin: 0.001,
  lowEaFracMax: 0.60,
};

export function checkAggregate(stats) {
  const v = [];
  const add = (id, msg) => v.push({ id, msg });
  const frac = (n, d) => (d > 0 ? n / d : 0);

  const easedRate = frac(stats.hardLowReadinessEased, stats.hardLowReadiness);
  if (stats.hardLowReadiness >= 50 && easedRate < AGG_MARGINS.hardLowReadinessEasedMin)
    add('S1-adapt-responsive', `only ${(easedRate * 100).toFixed(1)}% of hard low-readiness days eased/trimmed (min ${AGG_MARGINS.hardLowReadinessEasedMin * 100}%)`);

  const greenRate = frac(stats.greenlit, stats.cases);
  if (greenRate < AGG_MARGINS.greenlitFracMin || greenRate > AGG_MARGINS.greenlitFracMax)
    add('S2-greenlit-band', `greenlit rate ${(greenRate * 100).toFixed(1)}% outside [${AGG_MARGINS.greenlitFracMin * 100},${AGG_MARGINS.greenlitFracMax * 100}]%`);

  const eaRate = frac(stats.lowEa, stats.cases);
  if (eaRate < AGG_MARGINS.lowEaFracMin || eaRate > AGG_MARGINS.lowEaFracMax)
    add('S3-lowEa-band', `low-EA rate ${(eaRate * 100).toFixed(1)}% outside [${AGG_MARGINS.lowEaFracMin * 100},${AGG_MARGINS.lowEaFracMax * 100}]%`);

  return v;
}

/**
 * checkFuelMonotonic — deterministic structural invariant (not random): at a fixed
 * body mass, pre-session carbs must be non-decreasing as the fueling demand bracket
 * rises (light ≤ moderate ≤ high ≤ very-high). A higher-demand session can never
 * prescribe LESS pre-fuel than a lighter one.
 */
export function checkFuelMonotonic(prescribeFuel, athlete) {
  const v = [];
  const ctx = { bodyMassKg: athlete.bodyMassKg, ffmKg: athlete.ffmKg };
  // durations chosen to land in each bracket (see fuelForWork.demandBracket).
  const sessions = [
    { type: 'Run (outdoor)', intensityClass: 'easy', durationMin: 30 },   // light
    { type: 'Run (outdoor)', intensityClass: 'easy', durationMin: 60 },   // moderate
    { type: 'Run (outdoor)', intensityClass: 'easy', durationMin: 100 },  // high
    { type: 'Run (outdoor)', intensityClass: 'easy', durationMin: 160 },  // very-high
  ];
  let prev = -1;
  for (const s of sessions) {
    const g = prescribeFuel(s, ctx).preCarbsG;
    if (g < prev - 1e-9) v.push({ id: 'M1-fuel-monotonic', msg: `preCarbsG dropped ${prev}→${g} at ${s.durationMin}min` });
    prev = g;
  }
  return v;
}
