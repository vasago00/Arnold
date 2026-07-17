// Monte-Carlo property test for the COACH NARRATIVE engine (COACH_NARRATIVE_DESIGN Phase E).
//
// The reasoning layer (coachNarrative.js) is PURE — narrateSurface(ctx, surface) takes a plain
// context bundle and returns { text, tone, beats } — so it property-tests exactly like adaptPlan /
// prescribeFuel already do in runSim.js. This harness generates thousands of diverse (and
// deliberately adversarial) contexts from a seeded RNG, renders every surface, and asserts the
// invariants the whole design rests on. Every invariant here traces to a REAL bug we shipped and
// then caught by hand from a screenshot this session — so the sim turns those from "spot it later"
// into "can't regress":
//
//   • SURFACE LANES — a fuel/body beat must never appear on the Plan surface, and a plan beat
//     must never appear on Fuel (the "planner shows the Fuel message" bug).
//   • SURFACE CONTRACT — every composed beat is tagged for the surface it rendered on.
//   • COMPOSE INTEGRITY — the composed text is EXACTLY the selected beats' claims joined; the
//     deterministic composer injects nothing. (This is the oracle the future LLM phraser — Phase H,
//     "output ⊆ facts" — will be validated against.)
//   • NO SELF-CONTRADICTION — no affirming purpose/progress cheerleading composed next to a
//     corrective beat.
//   • DETERMINISM — same ctx → same text (no Math.random / Date.now in the engine).
//   • ROBUSTNESS — never throws, even on null/NaN/missing slices.
//
// Deterministic: same seed → same run; a reported violation carries the seed + case index to
// reproduce. Fast (pure), so it lives in the normal `npm test` suite.

import { makeRng } from './prng.js';
import { narrateSurface, allBeats } from '../coachNarrative.js';

const SURFACES = ['start', 'edgeiq', 'play', 'fuel', 'daily', 'plan', 'trend', 'calendar'];

// Domain lanes (the rule Emil set: each surface speaks about ITS metrics). Encoded by beat id so a
// future change that re-tags a fuel beat onto 'plan' fails loudly here.
const FUEL_BODY_IDS = new Set(['fuel-status', 'mech-protein-timing', 'reds-lowEA', 'cut-divergence']);
const PLAN_IDS = new Set(['plan-status', 'week-drift']);   // plan-domain — must not appear on Fuel

const RUN_TYPES = ['easy_run', 'long_run', 'tempo', 'intervals', 'hiit'];
const ANY_TYPES = [...RUN_TYPES, 'strength', 'mobility', 'cycle', 'cross', 'recovery', 'rest', 'swim'];
const RACES = ['Valencia', 'Berlin Marathon', 'NYC Marathon', 'Chicago'];

// ── context generator ─────────────────────────────────────────────────────────
// `adversarial` sprinkles nulls / NaN / wrong-typed slices to probe robustness. Realistic runs keep
// the slices well-formed so the LANE / CONTRADICTION invariants get exercised on real-looking data.
function genContext(rng, { adversarial = false } = {}) {
  const maybe = (p, v) => (rng.chance(p) ? v : null);
  const bad = adversarial && rng.chance(0.5);

  const primaryType = rng.choice(ANY_TYPES);
  const primarySession = maybe(0.8, { type: primaryType, label: primaryType, loadBearing: rng.chance(0.5) });

  const missed = [];
  const remaining = [];
  const nMissed = rng.int(0, 2);
  for (let i = 0; i < nMissed; i++) missed.push({ type: rng.choice(RUN_TYPES), mi: rng.int(3, 16) });
  const nRem = rng.int(0, 3);
  for (let i = 0; i < nRem; i++) remaining.push({ type: rng.choice(RUN_TYPES), mi: rng.int(3, 16) });
  const weekMiTarget = rng.int(0, 60);
  const missedMi = missed.reduce((s, m) => s + m.mi, 0);
  const strengthTarget = rng.int(0, 3);

  const eaVal = rng.int(15, 55);
  const kToday = rng.int(0, 3200);
  const kTarget = rng.int(1500, 3200);
  const pTarget = rng.int(100, 180);
  const pToday = rng.int(0, 180);

  const ctx = {
    clock: { hour: bad ? NaN : rng.int(0, 23) },
    today: {
      primarySession: bad ? undefined : primarySession,
      trainedToday: rng.chance(0.5),
      tdee: rng.chance(0.8) ? rng.int(2000, 3200) : null,
      injuryArea: maybe(0.3, rng.choice(['knee', 'achilles', 'itb', 'generic'])),
      readiness: maybe(0.6, { score: rng.int(20, 95), band: rng.choice(['low', 'moderate', 'high']) }),
      tempC: bad ? NaN : maybe(0.6, rng.uniform(8, 38)),
    },
    adaptation: maybe(0.4, { reason: `today's ${primaryType} is best eased to an easy effort`, action: rng.choice(['ease', 'trim']) }),
    tomorrow: maybe(0.5, { type: rng.choice(ANY_TYPES), label: 'Session', quality: rng.chance(0.5) }),
    goal: {
      aRace: maybe(0.7, { name: rng.choice(RACES), daysOut: rng.int(1, 220) }),
      weakLink: maybe(0.3, rng.choice(['threshold', 'endurance', 'aerobic'])),
      body: maybe(0.4, { direction: rng.choice(['cut', 'bulk', 'maintain']), observedRateLbPerWk: rng.uniform(-1, 1.2), targetLb: rng.int(150, 190) }),
    },
    fuel: bad && rng.chance(0.3) ? null : {
      protein: maybe(0.7, { today: pToday, target: pTarget, gap: Math.max(0, pTarget - pToday) }),
      calories: maybe(0.7, { today: kToday, target: kTarget, pct: kTarget > 0 ? kToday / kTarget : null }),
      ea: maybe(0.7, { flag: eaVal < 30, valueKcalPerKg: eaVal, floor: 30, status: eaVal < 30 ? 'low' : eaVal < 45 ? 'reduced' : 'optimal' }),
      deficitPct: maybe(0.5, rng.uniform(0, 0.3)),
    },
    plan: bad && rng.chance(0.3) ? null : (weekMiTarget > 0 ? {
      weekMiTarget, weekMiProjected: Math.max(0, weekMiTarget - missedMi), missed, remaining,
      swappedToStrength: rng.chance(0.4),
      ...(strengthTarget > 0 ? { strengthTarget, strengthDone: rng.int(0, strengthTarget) } : {}),
    } : {}),
    learned: maybe(0.4, { heat: { perUnitPct: rng.uniform(0, 1.6), confidence: rng.uniform(0, 1) } }) || {},
    clinical: {},
    memory: maybe(0.3, { saidAgoDays: { 'week-drift': rng.int(0, 5) }, kindWeight: { progress: rng.uniform(-0.2, 0.2) } }) || {},
  };
  if (bad && rng.chance(0.2)) ctx.today = null;         // hardest: whole slice gone
  if (bad && rng.chance(0.2)) ctx.goal = null;
  return ctx;
}

// ── per-case invariant check ───────────────────────────────────────────────────
export function checkCoachCase(ctx) {
  const v = [];
  const add = (id, msg) => v.push({ id, msg });

  // Full beat objects by id (reconciled set) — the source of truth for surfaces/tone/kind/claim.
  let fullById = new Map();
  try {
    for (const b of allBeats(ctx)) fullById.set(b.id, b);
  } catch (e) { add('allBeats-threw', String(e && e.message || e)); return v; }

  for (const surface of SURFACES) {
    let res1, res2;
    try {
      res1 = narrateSurface(ctx, surface);
      res2 = narrateSurface(ctx, surface);
    } catch (e) {
      add('narrate-threw', `${surface}: ${e && e.message || e}`);
      continue;
    }
    if (res1 == null) continue;   // silence is always valid

    // DETERMINISM
    if (!res2 || res2.text !== res1.text) add('nondeterministic', `${surface}: two renders differ`);

    // non-empty text when it speaks
    if (typeof res1.text !== 'string' || res1.text.trim() === '') add('empty-text', `${surface}: returned non-null but empty`);

    const beats = res1.beats || [];
    const ids = beats.map((b) => b.id);

    // SURFACE CONTRACT — every composed beat is tagged for this surface
    for (const b of beats) {
      const full = fullById.get(b.id);
      if (!full) { add('phantom-beat', `${surface}: '${b.id}' not in allBeats`); continue; }
      if (!Array.isArray(full.surfaces) || !full.surfaces.includes(surface)) {
        add('surface-contract', `${surface}: beat '${b.id}' surfaces=${JSON.stringify(full.surfaces)}`);
      }
    }

    // SURFACE LANES — the "each surface speaks its own domain" rule
    if (surface === 'plan') {
      for (const id of ids) if (FUEL_BODY_IDS.has(id)) add('fuel-on-plan', `plan showed fuel/body beat '${id}'`);
    }
    if (surface === 'fuel') {
      for (const id of ids) if (PLAN_IDS.has(id)) add('plan-on-fuel', `fuel showed plan beat '${id}'`);
    }

    // COMPOSE INTEGRITY — text is EXACTLY the selected beats' claims joined (nothing injected)
    const expected = beats.map((b) => (fullById.get(b.id)?.claim?.text || '').trim()).join(' ');
    if (expected !== res1.text) add('compose-integrity', `${surface}: composed text != joined beat claims`);

    // NO SELF-CONTRADICTION — no affirming purpose/progress next to a corrective beat
    const hasCorrective = beats.some((b) => fullById.get(b.id)?.tone === 'corrective');
    if (hasCorrective) {
      for (const b of beats) {
        const full = fullById.get(b.id);
        if (full && full.tone === 'affirming' && (full.kind === 'progress' || full.kind === 'purpose')) {
          add('contradiction', `${surface}: affirming ${full.kind} '${b.id}' composed with a corrective beat`);
        }
      }
    }
  }
  return v;
}

// ── run ─────────────────────────────────────────────────────────────────────
export function runCoachSim({ seed = 20260716, nCases = 6000, adversarialFrac = 0.25, maxStored = 20 } = {}) {
  const rng = makeRng(seed);
  let cases = 0, violationCount = 0;
  const violations = [];
  for (let i = 0; i < nCases; i++) {
    const adversarial = rng.next() < adversarialFrac;
    const ctx = genContext(rng, { adversarial });
    cases += 1;
    const vs = checkCoachCase(ctx);
    for (const vio of vs) {
      violationCount += 1;
      if (violations.length < maxStored) violations.push({ seed, caseIndex: i, adversarial, ...vio });
    }
  }
  return { seed, cases, violationCount, violations };
}

// Exported so the QUALITY eval (coachQuality.js, roadmap Stage 5) samples the SAME athlete-day
// distribution the invariant sim uses — one generator, two lenses (invariants + quality scoring).
export { genContext };

export default runCoachSim;
