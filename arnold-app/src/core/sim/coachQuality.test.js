// Tests for the QUALITY eval harness (roadmap Stage 5). Two things are proven here: (1) the rubric
// CATCHES bad coaching — each dimension is negative-controlled with a hand-built bad output, so it
// can flag the class even though the engine (post Stage 1) no longer produces it; and (2) the current
// engine holds a high quality BASELINE across the sim's athlete-day distribution, so a future change
// that degrades coaching quality fails here instead of in a screenshot.
import { describe, it, expect } from 'vitest';
import {
  runQualityEval, scoreNarrative,
  assessTimely, assessGrounded, assessConcise, assessCoherent, assessActionable,
  JUDGE_RUBRIC,
} from './coachQuality.js';

describe('rubric dimensions — negative-controlled', () => {
  it('timely: flags a time-sensitive beat firing in the wrong phase; N/A when the clock is unknown', () => {
    expect(assessTimely({ phase: 'wind_down', isWindDown: true, isMorning: false, postWorkout: false }, ['reds-lowEA'], '').pass).toBe(false);
    expect(assessTimely({ phase: 'morning', isWindDown: false, isMorning: true, postWorkout: false }, ['reds-lowEA'], '').pass).toBe(false);
    expect(assessTimely({ phase: 'recovery', isWindDown: false, isMorning: false, postWorkout: true }, ['purpose-easy_run'], '').pass).toBe(false);
    expect(assessTimely({ phase: 'wind_down', isWindDown: true }, ['fuel-status'], 'front-load protein early').pass).toBe(false);
    expect(assessTimely({ phase: 'unknown' }, ['reds-lowEA'], '').pass).toBe(true);          // no clock → don't fabricate a violation
    expect(assessTimely({ phase: 'training_window', isWindDown: false, isMorning: false, postWorkout: false }, ['reds-lowEA', 'purpose-x'], 't').pass).toBe(true);
  });

  it('grounded: flags an unsourced number/entity, passes a sourced rephrase', () => {
    expect(assessGrounded('Energy availability is 9 kcal/kg.', 'EA is 26 kcal/kg · Valencia').pass).toBe(false);
    expect(assessGrounded('Hold at 26 toward Valencia.', '26 kcal/kg Valencia').pass).toBe(true);
    expect(assessGrounded('', 'anything').pass).toBe(true);
  });

  it('concise: flags exceeding the beat budget or ballooning length', () => {
    expect(assessConcise('start', [{ id: 'a' }, { id: 'b' }], 'x').pass).toBe(false);         // start budget is 1
    expect(assessConcise('daily', [{ id: 'a' }], 'z'.repeat(1200)).pass).toBe(false);
    expect(assessConcise('daily', [{ id: 'a' }, { id: 'b' }], 'short').pass).toBe(true);
  });

  it('coherent: flags affirming purpose/progress composed next to a corrective beat', () => {
    const fb = new Map([['reds', { tone: 'corrective' }], ['purpose-x', { tone: 'affirming', kind: 'purpose' }]]);
    expect(assessCoherent([{ id: 'reds' }, { id: 'purpose-x' }], fb).pass).toBe(false);
    expect(assessCoherent([{ id: 'purpose-x' }], new Map([['purpose-x', { tone: 'affirming', kind: 'purpose' }]])).pass).toBe(true);
  });

  it('actionable: a corrective/gentle read must hand over something to do', () => {
    expect(assessActionable('corrective', 'This is a problem.').pass).toBe(false);
    expect(assessActionable('corrective', 'Add fuel around your work.').pass).toBe(true);
    expect(assessActionable('neutral', 'no verb here at all').pass).toBe(true);               // soft: N/A for non-corrective
  });
});

describe('scoreNarrative — a good context scores clean', () => {
  it('an evening low-EA day on Fuel is grounded, timely, coherent', () => {
    const ctx = {
      clock: { hour: 18 },
      today: { primarySession: { type: 'easy_run', label: 'Easy run', loadBearing: false }, trainedToday: false, tdee: 2500 },
      tomorrow: null, goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: null, body: null },
      fuel: { protein: { today: 60, target: 150, gap: 90 }, calories: { today: 1400, target: 2200, pct: 1400 / 2200 }, ea: { flag: true, valueKcalPerKg: 24, floor: 30, status: 'low' }, deficitPct: null },
      plan: {}, learned: {}, clinical: {}, memory: {},
    };
    const r = scoreNarrative(ctx, 'fuel');
    expect(r.spoke).toBe(true);
    expect(r.dims.grounded).toBe(true);
    expect(r.dims.timely).toBe(true);
    expect(r.dims.coherent).toBe(true);
    expect(r.score).toBeGreaterThan(0.9);
  });
  it('silence scores as valid (spoke=false), never penalized', () => {
    const r = scoreNarrative({ clock: { hour: 10 }, today: {}, goal: {}, fuel: {}, plan: {}, memory: {} }, 'trend');
    expect(r.spoke).toBe(false);
    expect(r.score).toBe(1);
  });
});

describe('quality baseline — the current engine holds across the athlete-day distribution', () => {
  const r = runQualityEval({ seed: 20260716, nCases: 4000 });

  it('the load-bearing dimensions are perfect: grounded · timely · coherent = 1.0', () => {
    expect(r.passRate.grounded).toBe(1);
    expect(r.passRate.timely).toBe(1);
    expect(r.passRate.coherent).toBe(1);
  });

  it('brevity + actionability stay high, and mean quality is strong', () => {
    expect(r.passRate.concise).toBe(1);                          // was ~0.962; fixed by removing week-drift from the start cockpit
    expect(r.passRate.actionable).toBeGreaterThanOrEqual(0.95);  // measured ~0.97
    expect(r.meanScore).toBeGreaterThanOrEqual(0.995);           // measured ~0.998
  });

  it('is stable across seeds (quality is not seed-dependent)', () => {
    for (const s of [1, 42, 777]) {
      const rr = runQualityEval({ seed: s, nCases: 2000 });
      expect(rr.passRate.grounded).toBe(1);
      expect(rr.passRate.timely).toBe(1);
      expect(rr.passRate.coherent).toBe(1);
      expect(rr.meanScore).toBeGreaterThanOrEqual(0.99);
    }
  });
});

describe('judge seam', () => {
  it('exposes a calibratable rubric for the subjective dimensions (LLM-as-judge, later)', () => {
    expect(JUDGE_RUBRIC).toMatch(/APPROPRIATE/);
    expect(JUDGE_RUBRIC).toMatch(/FAITHFUL/);
    expect(JUDGE_RUBRIC).toMatch(/NON-NAGGING/i);
  });
});
