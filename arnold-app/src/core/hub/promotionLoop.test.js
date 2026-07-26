// Tests for the push–pull promotion loop — the exploration controller Emil approved. These ARE the design
// invariants: the plan may only PROMOTE toward the ceiling on demonstrated absorption, must EASE on any safety
// signal (the pull always wins), and HOLDs when over-delivery isn't yet confirmed absorbed.
import { describe, it, expect } from 'vitest';
import { promotionVerdict, assessAbsorption, ACWR_DANGER } from './promotionLoop.js';

const abs = (acwr, readinessTrend = 0, efficiencyTrend = 0) => assessAbsorption({ acwr, readinessTrend, efficiencyTrend });

describe('assessAbsorption — the "did your body handle it?" fusion', () => {
  it('ACWR in the sweet spot scores positive; the danger zone scores negative', () => {
    expect(assessAbsorption({ acwr: 1.1 }).score).toBeGreaterThan(0);
    expect(assessAbsorption({ acwr: 1.7 }).score).toBeLessThan(0);
  });
  it('rising readiness + improving efficiency lift the score; declining ones drop it', () => {
    expect(assessAbsorption({ acwr: 1.1, readinessTrend: 1, efficiencyTrend: 1 }).score)
      .toBeGreaterThan(assessAbsorption({ acwr: 1.1, readinessTrend: -1, efficiencyTrend: -1 }).score);
  });
});

describe('promotionVerdict — the push & pull', () => {
  it('PROMOTES only when over-delivering AND absorbing AND there is headroom to explore', () => {
    const v = promotionVerdict({ deliveryRatio: 1.10, absorption: abs(1.15, 0.4, 0.4), acwr: 1.15, headroomVdot: 7 });
    expect(v.verdict).toBe('promote');
    expect(v.trajectoryAdjust).toBeGreaterThan(0);
    expect(v.trajectoryAdjust).toBeLessThanOrEqual(0.08);   // never a leap
  });
  it('an active niggle forces EASE regardless of ambition (the pull wins)', () => {
    expect(promotionVerdict({ deliveryRatio: 1.3, absorption: abs(1.1, 0.5, 0.5), acwr: 1.1, injuryActive: true, headroomVdot: 7 }).verdict).toBe('ease');
  });
  it(`ACWR past the danger line (${ACWR_DANGER}) forces EASE even while over-delivering (Emil's real 1.54 case)`, () => {
    const v = promotionVerdict({ deliveryRatio: 1.72, absorption: abs(1.54), acwr: 1.54, headroomVdot: 6.9 });
    expect(v.verdict).toBe('ease');
    expect(v.trajectoryAdjust).toBeLessThan(0);
  });
  it('over-delivering but not yet confirmed absorbed → HOLD a week before promoting', () => {
    expect(promotionVerdict({ deliveryRatio: 1.08, absorption: abs(1.35), acwr: 1.35, headroomVdot: 7 }).verdict).toBe('hold');
  });
  it('under-delivering and not recovered → EASE and re-baseline down', () => {
    expect(promotionVerdict({ deliveryRatio: 0.8, absorption: abs(0.7, -0.2, -0.1), acwr: 0.7, headroomVdot: 7 }).verdict).toBe('ease');
  });
  it('on-plan and steady → HOLD the trajectory', () => {
    expect(promotionVerdict({ deliveryRatio: 1.0, absorption: abs(1.1, 0, 0.1), acwr: 1.1, headroomVdot: 7 }).verdict).toBe('hold');
  });
  it('near the ceiling (no headroom) never promotes — sharpen, don’t pile on', () => {
    expect(promotionVerdict({ deliveryRatio: 1.1, absorption: abs(1.1, 0.4, 0.4), acwr: 1.1, headroomVdot: 0.5 }).verdict).not.toBe('promote');
  });
});
