// Tests for the REDs screen (2023 IOC standard). The invariants ARE the standard: the EA number alone must
// never raise an alarm; the outcome markers arbitrate; a stable weight + clean markers reads green even with a
// low EA estimate; and a genuine multi-marker deficit escalates to red with a clinician hand-off. Emil's real
// numbers are the green fixture; a synthetic under-fuelled athlete is the red one.
import { describe, it, expect } from 'vitest';
import { redsScreen } from './redsScreen.js';

const EMIL = {
  ea: { median: 35, lowDaysFrac: 0.37 }, rmrRatio: 1.05, weightTrendPctPerMonth: 0.1, boneT: 2.8,
  sex: 'male', age: 51, markers: { testosterone: 756, ferritin: 65, hemoglobin: 15, vitD: 67, hsCRP: 0.2 },
};

describe('the EA number alone never raises an alarm (the 2023 shift)', () => {
  it('low EA + every outcome marker healthy + stable weight → GREEN, with an under-logging note', () => {
    const r = redsScreen({ ...EMIL, ea: { median: 24, lowDaysFrac: 0.8 } });   // even a LOW EA
    expect(r.overall.status).toBe('green');
    expect(r.overall.summary).toMatch(/under-logg|not a real deficit/i);
    // the EA indicator itself still shows its reading (transparency), it just doesn't drive the overall
    expect(r.indicators.find((i) => i.key === 'ea').screening).toBe(true);
  });
  it("Emil's real data reads green (well-fuelled) despite a moderate EA estimate", () => {
    const r = redsScreen(EMIL, { asOf: '2026-07-19' });
    expect(r.overall.status).toBe('green');
    expect(r.indicators.find((i) => i.key === 'testosterone').status).toBe('green');
    expect(r.indicators.find((i) => i.key === 'bone').status).toBe('green');
  });
});

describe('outcome markers arbitrate — a real deficit escalates', () => {
  it('low T + suppressed RMR + anaemia + weight loss → RED, clinician hand-off', () => {
    const r = redsScreen({ ea: { median: 22, lowDaysFrac: 0.8 }, rmrRatio: 0.83, weightTrendPctPerMonth: -1.6, boneT: -1.4, sex: 'male', age: 30, markers: { testosterone: 240, ferritin: 12, hemoglobin: 12.8, vitD: 18, hsCRP: 1 } });
    expect(r.overall.status).toBe('red');
    expect(r.indicators.find((i) => i.key === 'testosterone').status).toBe('red');
    expect(r.handoff).toMatch(/screen, not a diagnosis/i);
  });
  it('a single suppressed RMR (primary) outranks a green EA', () => {
    const r = redsScreen({ ea: { median: 50 }, rmrRatio: 0.78, sex: 'male', markers: { testosterone: 600 } });
    expect(['orange', 'red']).toContain(r.overall.status);
  });
  it('unexplained weight loss with training, clean markers → at least monitor/orange', () => {
    const r = redsScreen({ ea: { median: 28 }, weightTrendPctPerMonth: -1.8, rmrRatio: 1.0, sex: 'male', markers: { testosterone: 700 } });
    expect(['orange', 'yellow']).toContain(r.overall.status);
    expect(r.overall.status).not.toBe('green');
  });
});

describe('secondary markers nudge, never diagnose', () => {
  it('low ferritin + low vitD with clean primaries + stable weight → yellow (monitor), not red', () => {
    const r = redsScreen({ ea: { median: 46 }, rmrRatio: 1.0, weightTrendPctPerMonth: 0, sex: 'male', markers: { testosterone: 650, ferritin: 20, vitD: 22, hemoglobin: 15 } });
    expect(r.overall.status).toBe('yellow');
  });
});

describe('missing data is handled — screen only what it can see', () => {
  it('no inputs → green with no indicators (nothing to flag)', () => {
    const r = redsScreen({});
    expect(r.overall.status).toBe('green');
    expect(r.indicators).toEqual([]);
    expect(r.handoff).toBeTruthy();
  });
});
