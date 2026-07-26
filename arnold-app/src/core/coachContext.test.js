// Unit tests for the coach-context plan slice (Slice 2 — the missed-session live re-solve).
// computePlanSlice is PURE (no storage / date / planner imports), so we assert the full slice
// from hand-built week fixtures, then feed it through the REAL narrative engine to prove
// gWeekDrift + gProgress fire with the right judgement, tone, and honest lead.
import { describe, it, expect } from 'vitest';
import { computePlanSlice, canonicalSessionType, buildCoachContext } from './coachContext.js';
import { narrateSurface, allBeats } from './coachNarrative.js';

// A Mon–Sun week fixture helper. Each day: run sessions [{type,mi}] + whether strength was planned.
const day = (dateStr, runSessions = [], hasStrength = false) => ({ dateStr, hasStrength, runSessions });

const mkCtx = (plan, primary = { type: 'intervals', label: 'Intervals', loadBearing: false }) => ({
  clock: { hour: 9 },
  today: { primarySession: primary, trainedToday: false, tdee: 2500 },
  tomorrow: null,
  goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: null, body: null },
  fuel: { protein: null, ea: { flag: false }, deficitPct: null },
  plan, learned: {}, clinical: {}, memory: {},
});

describe('computePlanSlice', () => {
  it('reconciles planned week vs logged: missed easy run (strength swapped in)', () => {
    const week = [
      day('2026-07-13', [{ type: 'easy_run', mi: 5 }]),
      day('2026-07-14', [{ type: 'easy_run', mi: 6 }], true),   // Tue: did strength, skipped the run
      day('2026-07-15', [{ type: 'intervals', mi: 7 }]),        // Wed = today
      day('2026-07-16', [{ type: 'easy_run', mi: 5 }]),
      day('2026-07-17', []),
      day('2026-07-18', [{ type: 'long_run', mi: 15 }]),
      day('2026-07-19', [{ type: 'easy_run', mi: 4 }]),
    ];
    const p = computePlanSlice(week, new Set(['2026-07-13']), new Set(['2026-07-14']), '2026-07-15');
    expect(p.weekMiTarget).toBe(42);
    expect(p.weekMiProjected).toBe(36);
    expect(p.missed).toEqual([{ type: 'easy_run', mi: 6, date: '2026-07-14' }]);
    expect(p.swappedToStrength).toBe(true);
    expect(p.strengthTarget).toBe(1);
    expect(p.strengthDone).toBe(1);
    // remaining = today + future not-yet-done runs (absorb targets)
    expect(p.remaining.map((r) => r.type)).toEqual(['intervals', 'easy_run', 'long_run', 'easy_run']);
  });

  it('returns {} when the week has no planned running (engine stays silent)', () => {
    const week = [day('2026-07-13', [], true), day('2026-07-14', [])];
    expect(computePlanSlice(week, new Set(), new Set(), '2026-07-15')).toEqual({});
  });

  it('a run below the 2-mi noise floor does not project a drift beat', () => {
    // one 1-mi easy run missed → gapMi < 2 → gWeekDrift suppresses
    const week = [day('2026-07-14', [{ type: 'easy_run', mi: 1 }]), day('2026-07-15', [{ type: 'easy_run', mi: 20 }])];
    const p = computePlanSlice(week, new Set(), new Set(), '2026-07-15');
    expect(p.missed).toEqual([{ type: 'easy_run', mi: 1, date: '2026-07-14' }]);
    expect(allBeats(mkCtx(p)).find((b) => b.id === 'week-drift')).toBeUndefined();
  });
});

describe('novelty memory — a recently-said beat steps aside (Phase D)', () => {
  // Daily surface, purpose (train) vs progress (train) compete for the single train-topic slot.
  const memCtx = (memory) => ({
    clock: { hour: 9 },
    today: { primarySession: { type: 'easy_run', label: 'Easy run', loadBearing: false }, trainedToday: false, tdee: 2500 },
    tomorrow: null, goal: { aRace: { name: 'Valencia', daysOut: 100 }, weakLink: null, body: null },
    fuel: { protein: null, calories: null, ea: { flag: false }, deficitPct: null },
    plan: { weekMiTarget: 0, strengthTarget: 2, strengthDone: 1, missed: [], remaining: [] },
    learned: {}, clinical: {}, memory,
  });
  it('leads with purpose when nothing was said recently', () => {
    const nv = narrateSurface(memCtx({}), 'daily');
    expect(nv.beats[0].id).toBe('purpose-easy_run');
  });
  it('defers to the next idea when purpose was shown yesterday', () => {
    const nv = narrateSurface(memCtx({ saidAgoDays: { 'purpose-easy_run': 1 } }), 'daily');
    expect(nv.beats[0].id).toBe('progress-strength-freq');
  });
});

describe('narrative calibration — surfaces stay tight (Emil: no wall of text)', () => {
  // The screenshot case: low EA + a cut + strength progress + calorie status all fire at once.
  const busy = {
    clock: { hour: 11 },
    today: { primarySession: { type: 'easy_run', label: 'Easy run', loadBearing: false }, trainedToday: false, tdee: 2500, injuryArea: null, readiness: { score: 78, band: 'high' }, tempC: 30 },
    adaptation: null, tomorrow: null,
    goal: { aRace: { name: 'Valencia Marathon', daysOut: 120 }, weakLink: null, body: { direction: 'cut', observedRateLbPerWk: 0.17, targetLb: 170 } },
    fuel: { protein: { today: 105, target: 153, gap: 48 }, calories: { today: 1613, target: 1980, pct: 1613 / 1980 }, ea: { flag: true, valueKcalPerKg: 26, floor: 30, status: 'low' }, deficitPct: 0.19 },
    plan: { weekMiTarget: 31, weekMiProjected: 31, missed: [], remaining: [{ type: 'easy_run', mi: 5 }], swappedToStrength: false, strengthTarget: 3, strengthDone: 2 },
    learned: { heat: { perUnitPct: 0.63, confidence: 0.84 } }, clinical: {}, memory: {},
  };
  it('Daily composes ≤ 2 beats and drops the reassuring cut next to a RED-S alarm', () => {
    const nv = narrateSurface(busy, 'daily');
    expect(nv.beats.length).toBeLessThanOrEqual(2);
    expect(nv.text).toMatch(/RED-S floor/);
    expect(nv.text).not.toMatch(/sustainable background cut/);   // divergence suppressed under corrective
  });
  it('never stacks two same-domain (fuel) beats on any surface', () => {
    for (const s of ['daily', 'fuel', 'play']) {
      const nv = narrateSurface(busy, s);
      if (!nv) continue;
      const fuelBeats = nv.beats.filter((b) => ['reds-lowEA', 'fuel-status', 'mech-protein-timing'].includes(b.id));
      expect(fuelBeats.length, `${s} stacked ${fuelBeats.length} fuel beats`).toBeLessThanOrEqual(1);
    }
  });
});

describe('per-surface density — mobile Play is one tight read, opts can retune (Emil 2026-07)', () => {
  // Same "everything fires at once" fixture as the calibration block above.
  const busy = {
    clock: { hour: 11 },
    today: { primarySession: { type: 'easy_run', label: 'Easy run', loadBearing: false }, trainedToday: false, tdee: 2500, injuryArea: null, readiness: { score: 78, band: 'high' }, tempC: 30 },
    adaptation: null, tomorrow: null,
    goal: { aRace: { name: 'Valencia Marathon', daysOut: 120 }, weakLink: null, body: { direction: 'cut', observedRateLbPerWk: 0.17, targetLb: 170 } },
    fuel: { protein: { today: 105, target: 153, gap: 48 }, calories: { today: 1613, target: 1980, pct: 1613 / 1980 }, ea: { flag: true, valueKcalPerKg: 26, floor: 30, status: 'low' }, deficitPct: 0.19 },
    plan: { weekMiTarget: 31, weekMiProjected: 31, missed: [], remaining: [{ type: 'easy_run', mi: 5 }], swappedToStrength: false, strengthTarget: 3, strengthDone: 2 },
    learned: { heat: { perUnitPct: 0.63, confidence: 0.84 } }, clinical: {}, memory: {},
  };

  it('the mobile Play hero carries exactly one beat (no full paragraph)', () => {
    const nv = narrateSurface(busy, 'play');
    expect(nv).toBeTruthy();
    expect(nv.beats.length).toBe(1);
  });

  it('the daily digest still gets its two-beat budget (unchanged)', () => {
    expect(narrateSurface(busy, 'daily').beats.length).toBeLessThanOrEqual(2);
  });

  it("density:'full' lets a surface carry one extra beat; 'compact' clamps to one", () => {
    const dflt = narrateSurface(busy, 'play').beats.length;
    const full = narrateSurface(busy, 'play', { density: 'full' }).beats.length;
    expect(full).toBeGreaterThan(dflt);
    expect(narrateSurface(busy, 'daily', { density: 'compact' }).beats.length).toBe(1);
  });

  it('no opts → the surface keeps its declared budget (backward compatible)', () => {
    // Two calls, same result — the default path is untouched by the opts plumbing.
    expect(narrateSurface(busy, 'play').beats.length).toBe(narrateSurface(busy, 'play', {}).beats.length);
  });
});

describe('gFuelStatus (grounded fuel voice — weaves the displayed metrics)', () => {
  const base = (fuel, hour = 14) => ({
    clock: { hour }, today: { primarySession: null, trainedToday: false, tdee: 2500 },
    tomorrow: null, goal: { aRace: null, weakLink: null, body: null },
    fuel, plan: {}, learned: {}, clinical: {}, memory: {},
  });
  it('speaks today\'s kcal + protein on the Fuel surface', () => {
    const nv = narrateSurface(base({
      calories: { today: 1236, target: 2030, pct: 1236 / 2030 },
      protein: { today: 73, target: 156, gap: 83 }, ea: { flag: false }, deficitPct: null,
    }), 'fuel');
    expect(nv).toBeTruthy();
    expect(nv.text).toMatch(/1236 of 2030 kcal/);
    expect(nv.text).toMatch(/83g protein/);
  });
  it('stays silent when no calorie target is logged (no fabrication)', () => {
    const beats = allBeats(base({ protein: null, calories: null, ea: { flag: false }, deficitPct: null }));
    expect(beats.find((b) => b.id === 'fuel-status')).toBeUndefined();
  });
  it('a low-EA day fires the RED-S beat on Fuel (slice 2c wiring)', () => {
    const nv = narrateSurface(base({
      calories: { today: 1200, target: 2400, pct: 0.5 }, protein: { today: 40, target: 150, gap: 110 },
      ea: { flag: true, valueKcalPerKg: 22, floor: 30, status: 'low' }, deficitPct: null,
    }), 'fuel');
    expect(nv).toBeTruthy();
    expect(nv.text).toMatch(/RED-S floor|Energy availability/);
    expect(nv.text).toMatch(/22 kcal\/kg/);
  });
});

describe('gLearned heat (learned per-°C strain — slice 2c)', () => {
  const hctx = (learned, tempC) => ({
    clock: { hour: 12 },
    today: { primarySession: null, trainedToday: true, tdee: 2500, tempC },
    tomorrow: null, goal: { aRace: null, weakLink: null, body: null },
    fuel: { protein: null, calories: null, ea: { flag: false }, deficitPct: null },
    plan: {}, learned, clinical: {}, memory: {},
  });
  it('speaks the heat strain on a hot day when the model is confident', () => {
    const nv = narrateSurface(hctx({ heat: { perUnitPct: 0.7, confidence: 0.5 } }, 30), 'daily');
    expect(nv).toBeTruthy();
    expect(nv.text).toMatch(/30°C/);
    expect(nv.text).toMatch(/cardiac strain/);
  });
  it('stays silent on a cool day / low confidence', () => {
    expect(allBeats(hctx({ heat: { perUnitPct: 0.7, confidence: 0.5 } }, 18)).find((b) => b.id === 'learned-heat')).toBeUndefined();
    expect(allBeats(hctx({ heat: { perUnitPct: 0.7, confidence: 0.2 } }, 30)).find((b) => b.id === 'learned-heat')).toBeUndefined();
  });
});

describe('gReadiness (low-readiness back-off nudge — slice 2c)', () => {
  const rctx = (readiness, adaptation) => ({
    clock: { hour: 8 },
    today: { primarySession: { type: 'tempo', label: 'Tempo', loadBearing: true }, trainedToday: false, tdee: 2500, readiness },
    adaptation, tomorrow: null, goal: { aRace: { name: 'Valencia', daysOut: 100 }, weakLink: null, body: null },
    fuel: { protein: null, calories: null, ea: { flag: false }, deficitPct: null }, plan: {}, learned: {}, clinical: {}, memory: {},
  });
  it('fires on the Play surface when readiness is low and the session eases', () => {
    const nv = narrateSurface(rctx({ score: 45, band: 'low' }, { reason: "today's Tempo is best eased to an easy effort (HRV -14 below your baseline)", action: 'ease' }), 'play');
    expect(nv).toBeTruthy();
    expect(nv.text).toMatch(/Readiness is low \(45\)/);
    expect(nv.text).toMatch(/eased to an easy effort/);
  });
  it('stays silent when readiness is not low (no back-off invented)', () => {
    const beats = allBeats(rctx({ score: 80, band: 'high' }, null));
    expect(beats.find((b) => b.id === 'readiness-adapt')).toBeUndefined();
  });
});

describe('gPlanStatus (dedicated plan voice — stays in the plan lane)', () => {
  const planCtx = (extra = {}) => ({
    clock: { hour: 9 },
    today: { primarySession: { type: 'cycle', label: 'Cycle', loadBearing: false }, trainedToday: false, tdee: 2500, injuryArea: 'knee' },
    tomorrow: null,
    goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: null, body: { direction: 'cut', observedRateLbPerWk: 0.4, targetLb: 175 } },
    fuel: { protein: { today: 40, target: 156, gap: 116 }, calories: { today: 900, target: 2030, pct: 900 / 2030 }, ea: { flag: false }, deficitPct: 0.15 },
    plan: { weekMiTarget: 31, weekMiProjected: 31, missed: [], remaining: [{ type: 'easy_run', mi: 5 }], swappedToStrength: false, strengthTarget: 2, strengthDone: 1 },
    learned: {}, clinical: {}, memory: {},
  });
  it('the Plan surface leads with a plan-specific observation (not the Fuel message)', () => {
    const nv = narrateSurface(planCtx(), 'plan');
    expect(nv).toBeTruthy();
    expect(nv.text).toMatch(/holding to plan/);
    expect(nv.text).toMatch(/knee/);
    expect(nv.text).toMatch(/Valencia/);
    // and it must NOT be the fuel/cut voice
    expect(nv.text).not.toMatch(/kcal/);
    expect(nv.text).not.toMatch(/cutting/);
  });
  it('the Fuel surface does NOT show the plan-status beat, and vice-versa', () => {
    const ctx = planCtx();
    const planText = narrateSurface(ctx, 'plan').text;
    const fuelText = narrateSurface(ctx, 'fuel').text;
    expect(planText).not.toEqual(fuelText);          // the two surfaces diverge (Emil's bug)
    expect(fuelText).toMatch(/kcal|protein/);         // fuel speaks nutrition
    expect(planText).not.toMatch(/plan-status-not-a-real-token/);
    // the plan beat is confined to the plan surface
    const onFuel = allBeats(ctx).find((b) => b.id === 'plan-status');
    expect(onFuel.surfaces).toEqual(['plan']);
  });
});

describe('canonicalSessionType — logged activity → granular coach type (the real "Play showed strength" root cause)', () => {
  it('a logged generic run inherits today\'s PLANNED granular run type', () => {
    expect(canonicalSessionType('run', 'easy_run', 'running')).toBe('easy_run');
    expect(canonicalSessionType('run', 'long_run', 'running')).toBe('long_run');
    expect(canonicalSessionType('run', 'tempo', 'running')).toBe('tempo');
  });
  it('a logged run with no / non-granular planned type defaults to easy_run', () => {
    expect(canonicalSessionType('run', null, 'running')).toBe('easy_run');
    expect(canonicalSessionType('run', 'rest', 'running')).toBe('easy_run');
    expect(canonicalSessionType('run', 'run', 'running')).toBe('easy_run');
  });
  it('non-run kinds map straight through', () => {
    expect(canonicalSessionType('strength', null, 'strength_training')).toBe('strength');
    expect(canonicalSessionType('hiit', null, 'hiit')).toBe('hiit');
    expect(canonicalSessionType('cycling', null, 'cycling')).toBe('cycle');
    expect(canonicalSessionType('swim', null, 'lap_swimming')).toBe('swim');
    expect(canonicalSessionType('mobility', null, 'yoga')).toBe('mobility');
  });
});

// The real "Play stuck on the 2-of-3-strength tally for days" root cause (Emil, 2026-07-18): coachSignals
// emits todayPlanned as the next7Days[0] WRAPPER { planned:{type}, intensityClass, label, done } — the
// granular type is at .planned.type. buildCoachContext was reading .type off the WRAPPER (undefined), so on
// a planned-but-unlogged day primarySession fell to null → gPurpose/gSessionDone went silent → the strength
// tally won by default, every day. These guard the wrapper→.planned.type shape end-to-end.
describe('primarySession from the planned session (todayPlanned wrapper shape)', () => {
  const nestedPlan = () => ({
    status: 'has-plan',
    todayPlanned: { date: '2026-07-18', daysOut: 0, dow: 6, planned: { type: 'easy_run', distanceMi: 6 }, intensityClass: 'easy', label: 'Easy 6mi', done: false },
    next7Days: [
      { date: '2026-07-18', daysOut: 0, dow: 6, planned: { type: 'easy_run', distanceMi: 6 }, intensityClass: 'easy', label: 'Easy 6mi', done: false },
      { date: '2026-07-19', daysOut: 1, dow: 0, planned: { type: 'long_run', distanceMi: 16 }, intensityClass: 'hard', label: 'Long 16mi', done: null },
    ],
  });
  it('reads today\'s granular type from .planned.type (a planned, unlogged easy day)', () => {
    const upcomingPlan = nestedPlan();
    const ctx = buildCoachContext({
      us: { numbers: {}, asOf: '2026-07-18', coachSignals: { upcomingPlan } },
      sessions: [], upcomingPlan, raceHorizon: null, hour: 9, nowMs: Date.parse('2026-07-18T09:00:00'),
    });
    expect(ctx.today.primarySession).toBeTruthy();
    expect(ctx.today.primarySession.type).toBe('easy_run');
  });
});

describe('planned easy day → Play leads with purpose, not the backward strength tally (Emil regression)', () => {
  it('gPurpose (0.48) outranks gProgress (0.40) in the shared "train" slot when a planned session is set', () => {
    const ctx = {
      clock: { hour: 9 },                 // morning, pre-workout (not postWorkout → purpose is live)
      today: { primarySession: { type: 'easy_run', label: 'Easy 6mi', loadBearing: false }, trainedToday: false, tdee: 2500 },
      tomorrow: { type: 'long_run', label: 'Long 16mi', quality: false },
      goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: 'aerobic', body: null },
      fuel: { protein: null, ea: { flag: false }, deficitPct: null },
      plan: { strengthDone: 2, strengthTarget: 3, weekMiTarget: 40, weekMiProjected: 40, missed: [], remaining: [] },
      learned: {}, clinical: {}, memory: { saidAgoDays: {}, kindWeight: {} },
    };
    const play = narrateSurface(ctx, 'play');
    expect(play.text).toMatch(/aerobic base|easy miles/i);   // the forward purpose read leads
    expect(play.text).not.toMatch(/strength days/i);         // the backward tally no longer wins the slot
  });
});

describe('post-workout session read (Emil: Play showed strength after logging a run)', () => {
  const postRun = (type = 'easy_run') => ({
    clock: { hour: 19 },
    today: { primarySession: { type, label: type, loadBearing: type === 'strength' }, trainedToday: true, tdee: 2500 },
    tomorrow: null, goal: { aRace: { name: 'Valencia', daysOut: 143 }, weakLink: null, body: null },
    fuel: { protein: null, calories: null, ea: { flag: false }, deficitPct: null },
    plan: { weekMiTarget: 30, weekMiProjected: 30, missed: [], remaining: [], strengthTarget: 3, strengthDone: 2 },
    learned: {}, clinical: {}, memory: {},
  });
  it('after an easy run, Play LEADS with the run — not the strength tally', () => {
    const nv = narrateSurface(postRun('easy_run'), 'play');
    expect(nv.beats[0].id).toBe('session-done-easy_run');
    expect(nv.text).toMatch(/Easy miles banked/);
    expect(nv.text).not.toMatch(/2 of 3 strength days/);      // the bug: strength beat led on a run day
  });
  it('grounds the read in the ACTUAL logged distance when present', () => {
    const ctx = postRun('easy_run');
    ctx.today.primarySession.distanceMi = 7.5;
    const nv = narrateSurface(ctx, 'play');
    expect(nv.text).toMatch(/7.5 mi of easy running banked/);
    expect(nv.text).not.toMatch(/^Easy miles banked/);        // the specific lead replaces the generic one
  });
  it('a logged strength day reads as strength done', () => {
    expect(narrateSurface(postRun('strength'), 'play').text).toMatch(/Strength work is in/);
  });
  it('pre-workout still previews with purpose (session-done is post-only)', () => {
    const pre = { ...postRun('easy_run'), today: { ...postRun('easy_run').today, trainedToday: false } };
    const beats = allBeats(pre);
    expect(beats.find((b) => b.id === 'purpose-easy_run')).toBeTruthy();
    expect(beats.find((b) => b.id.startsWith('session-done'))).toBeUndefined();
  });
});

describe('time-of-day freshness (Stage 1 — day.phase gates)', () => {
  // These set only ctx.clock (no ctx.day), exercising the engine's dayOf() fallback that derives
  // the phase from the clock — the exact path the live app takes before the world model is present.
  const fuelCtx = (hour, extra = {}) => ({
    clock: { hour },
    today: { primarySession: extra.primary ?? null, trainedToday: !!extra.trained, tdee: 2500 },
    tomorrow: null, goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: null, body: null },
    fuel: {
      protein: { today: 60, target: 150, gap: 90 },
      calories: { today: 1200, target: 2200, pct: 1200 / 2200 },
      ea: extra.ea ?? { flag: false }, deficitPct: null,
    },
    plan: {}, learned: {}, clinical: {}, memory: {},
  });

  it('purpose is a PRE-workout preview — silent once today is logged (Play tile moves on)', () => {
    const pre = { type: 'easy_run', label: 'Easy run', loadBearing: false };
    const before = allBeats(fuelCtx(9, { primary: pre, trained: false }));
    const after = allBeats(fuelCtx(14, { primary: pre, trained: true }));
    expect(before.find((b) => b.id === 'purpose-easy_run')).toBeTruthy();
    expect(after.find((b) => b.id === 'purpose-easy_run')).toBeUndefined();
  });

  it('midnight no longer says "front-load protein early" — it wraps the day', () => {
    const nv = narrateSurface(fuelCtx(0), 'fuel');            // hour 0 → wind_down, not "morning"
    expect(nv.text).not.toMatch(/front-load protein early/);
    expect(nv.text).toMatch(/Sleep's the next input/);
  });

  it('morning DOES front-load; midday gives the steady read', () => {
    expect(narrateSurface(fuelCtx(7), 'fuel').text).toMatch(/front-load protein early/);
    expect(narrateSurface(fuelCtx(14), 'fuel').text).toMatch(/1200 of 2200 kcal/);
  });

  it('bedtime suppresses the RED-S "fuel up" nudge; the fueling day still fires it', () => {
    const lowEA = { flag: true, valueKcalPerKg: 24, floor: 30, status: 'low' };
    expect(allBeats(fuelCtx(23, { ea: lowEA })).find((b) => b.id === 'reds-lowEA')).toBeUndefined();
    expect(allBeats(fuelCtx(18, { ea: lowEA })).find((b) => b.id === 'reds-lowEA')).toBeTruthy();
  });

  it('no intake logged → the "0 kcal/kg FFM under the floor" alarm is a NO-DATA artifact, silent', () => {
    // The Daily screenshot: EA flag trips at ~0 because nothing is logged yet — not a real deficit.
    const emptyDay = {
      clock: { hour: 18 },                                   // evening — would otherwise be the fire window
      today: { primarySession: null, trainedToday: false, tdee: 2500 },
      tomorrow: null, goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: null, body: null },
      fuel: { protein: { today: 0, target: 150, gap: 150 }, calories: { today: 0, target: 2200, pct: 0 }, ea: { flag: true, valueKcalPerKg: 0, floor: 30, status: 'low' }, deficitPct: null },
      plan: {}, learned: {}, clinical: {}, memory: {},
    };
    expect(allBeats(emptyDay).find((b) => b.id === 'reds-lowEA')).toBeUndefined();
  });

  it('morning suppresses the EA nudge even with intake — the day is not decided yet', () => {
    const lowEA = { flag: true, valueKcalPerKg: 24, floor: 30, status: 'low' };
    expect(allBeats(fuelCtx(8, { ea: lowEA })).find((b) => b.id === 'reds-lowEA')).toBeUndefined();
  });
});

describe('gWeekDrift (engine, fed by the real slice)', () => {
  it('missed EASY run → gentle, names the race, offers absorb/redistribute, honest swap lead', () => {
    const week = [
      day('2026-07-13', [{ type: 'easy_run', mi: 5 }]),
      day('2026-07-14', [{ type: 'easy_run', mi: 6 }], true),
      day('2026-07-15', [{ type: 'intervals', mi: 7 }]),
      day('2026-07-16', [{ type: 'easy_run', mi: 5 }]),
      day('2026-07-17', []),
      day('2026-07-18', [{ type: 'long_run', mi: 15 }]),
      day('2026-07-19', [{ type: 'easy_run', mi: 4 }]),
    ];
    const p = computePlanSlice(week, new Set(['2026-07-13']), new Set(['2026-07-14']), '2026-07-15');
    const drift = allBeats(mkCtx(p)).find((b) => b.id === 'week-drift');
    expect(drift).toBeTruthy();
    expect(drift.tone).toBe('gentle');
    expect(drift.claim.text).toMatch(/^You logged strength but not Tuesday's easy run/);
    expect(drift.claim.text).toMatch(/Valencia/);
    expect(drift.claim.text).toMatch(/without touching the long run/);
    expect(drift.claim.text).toMatch(/wouldn't do is cram it all back/);
  });

  it('missed KEY session (long run, no strength) → corrective, flags the hole, honest miss lead, suppresses cheerleading', () => {
    const week = [
      day('2026-07-13', [{ type: 'easy_run', mi: 5 }]),
      day('2026-07-14', [{ type: 'intervals', mi: 7 }]),
      day('2026-07-15', [{ type: 'easy_run', mi: 5 }]),
      day('2026-07-16', [{ type: 'tempo', mi: 6 }]),
      day('2026-07-17', []),
      day('2026-07-18', [{ type: 'long_run', mi: 16 }]),   // Sat: missed, no strength logged
      day('2026-07-19', [{ type: 'easy_run', mi: 4 }]),
    ];
    const logged = new Set(['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16']);
    const p = computePlanSlice(week, logged, new Set(), '2026-07-19');
    expect(p.swappedToStrength).toBe(false);
    const beats = allBeats(mkCtx(p, { type: 'easy_run', label: 'Easy run', loadBearing: false }));
    const drift = beats.find((b) => b.id === 'week-drift');
    expect(drift.tone).toBe('corrective');
    expect(drift.claim.text).toMatch(/^You didn't get Saturday's long run/);
    expect(drift.claim.text).toMatch(/key session/);
    // under a corrective beat, affirming purpose/progress cheerleading is dropped
    expect(beats.some((b) => b.id.startsWith('purpose'))).toBe(false);
  });
});
