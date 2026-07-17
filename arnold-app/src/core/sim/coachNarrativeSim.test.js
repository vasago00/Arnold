// Monte-Carlo property test for the coach NARRATIVE engine (COACH_NARRATIVE_DESIGN Phase E).
// Renders thousands of seeded, diverse (+ adversarial) contexts across every surface and asserts
// the invariants the design rests on — surface lanes, surface contract, compose integrity, no
// self-contradiction, determinism, robustness. Seeded → deterministic; a failure reports the seed
// + case index to reproduce. Negative-controlled during development: reintroducing the historical
// "cut-divergence on the Plan surface" bug makes this fail with `fuel-on-plan` violations.
import { describe, it, expect } from 'vitest';
import { runCoachSim } from './coachNarrativeSim.js';

const SEED = 20260716;
const N = 6000;

describe('coach narrative — Monte-Carlo property test', () => {
  const report = runCoachSim({ seed: SEED, nCases: N });

  it(`runs ${N} contexts across every surface`, () => {
    expect(report.cases).toBe(N);
  });

  it('holds every narrative invariant (surface lanes · contract · compose integrity · no-contradiction · determinism · robustness)', () => {
    expect(
      report.violationCount,
      `${report.violationCount} violations (seed ${SEED}). Sample:\n${JSON.stringify(report.violations, null, 2)}`,
    ).toBe(0);
  });

  it('is stable across seeds (no invariant is seed-dependent)', () => {
    for (const s of [1, 42, 777, 20260101]) {
      const r = runCoachSim({ seed: s, nCases: 2500 });
      expect(r.violationCount, `seed ${s}: ${JSON.stringify(r.violations.slice(0, 5), null, 2)}`).toBe(0);
    }
  });
});
