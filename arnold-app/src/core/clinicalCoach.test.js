// Tests for the clinical coach engine (roadmap Stage 7 / Phase F). Proves: rules fire on real
// out-of-range panels with training-relevant framing + a professional hand-off, ranking surfaces the
// most salient concern, cold start is silent, and the whole thing flows through the narrative engine's
// gClinical onto the right surfaces — never inventing a value.
import { describe, it, expect } from 'vitest';
import { buildClinicalContext } from './clinicalCoach.js';
import { narrateSurface, allBeats } from './coachNarrative.js';

const snap = (markers, date = '2026-07-10') => [{ date, markers }];

describe('buildClinicalContext — training-relevant flags with a hand-off', () => {
  it('low ferritin → iron flag, aerobic framing, "check with your doctor"', () => {
    const c = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 22 }), []);
    const f = c.flags.find((x) => x.id === 'clinical-iron-low');
    expect(f).toBeTruthy();
    expect(f.tone).toBe('corrective');
    expect(f.claim).toMatch(/22/);
    expect(f.claim).toMatch(/doctor/);
    expect(f.claim).toMatch(/aerobic/);
  });
  it('low T:C ratio → overtraining flag', () => {
    const c = buildClinicalContext(snap({ 'Testosterone:Cortisol Ratio (Units)': 30 }), []);
    expect(c.flags.find((x) => x.id === 'clinical-tc-low')).toBeTruthy();
  });
  it('elevated CK and hsCRP → recovery/inflammation flags', () => {
    const c = buildClinicalContext(snap({ 'Creatine kinase (U/L)': 620, 'hsCRP (mg/L)': 2.4 }), []);
    expect(c.flags.find((x) => x.id === 'clinical-ck-high')).toBeTruthy();
    expect(c.flags.find((x) => x.id === 'clinical-hscrp-high')).toBeTruthy();
  });
  it('low vitamin D → durability flag', () => {
    const c = buildClinicalContext(snap({ 'Vitamin D (ng/mL)': 22 }), []);
    expect(c.flags.find((x) => x.id === 'clinical-vitd-low')).toBeTruthy();
  });
  it('ranks the most salient concern first (iron over vitamin D)', () => {
    const c = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 20, 'Vitamin D (ng/mL)': 22 }), []);
    expect(c.flags[0].id).toBe('clinical-iron-low');
  });
  it('DEXA lean held during a cut → affirming', () => {
    const dexa = [{ type: 'dexa', date: '2026-06-01', leanMass: 134 }, { type: 'dexa', date: '2026-07-01', leanMass: 134.4 }];
    const c = buildClinicalContext([], dexa, { goalDirection: 'cut' });
    expect(c.flags.find((x) => x.id === 'clinical-dexa-lean-held')).toBeTruthy();
    // ...but NOT when the goal isn't a cut
    expect(buildClinicalContext([], dexa, { goalDirection: 'bulk' }).flags.length).toBe(0);
  });
});

describe('no fabrication — silent without data', () => {
  it('cold start (no labs) → no flags', () => {
    expect(buildClinicalContext([], []).flags).toEqual([]);
    expect(buildClinicalContext(null, null).flags).toEqual([]);
  });
  it('optimal values → no flags', () => {
    expect(buildClinicalContext(snap({ 'Ferritin (ng/mL)': 90, 'Vitamin D (ng/mL)': 60, 'hsCRP (mg/L)': 0.3 }), []).flags).toEqual([]);
  });
  it('a HIGH ferritin is not miscalled as low iron', () => {
    const c = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 210 }), []);
    expect(c.flags.find((x) => x.id === 'clinical-iron-low')).toBeUndefined();
  });
});

describe('recency — an old lab is not a current fact (Emil: some panels are >1yr old)', () => {
  it('a FRESH panel asserts present-tense', () => {
    const c = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 22 }, '2026-07-01'), [], { today: '2026-07-17' });
    const f = c.flags[0];
    expect(f.claim).toMatch(/is low/);
    expect(f.claim).not.toMatch(/re-testing|That reading is from/);
    expect(f.data.ageDays).toBe(16);
  });
  it('an AGING slow marker keeps the flag but date-stamps it and down-ranks', () => {
    const c = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 22 }, '2026-01-05'), [], { today: '2026-07-17' });
    const f = c.flags[0];
    expect(f.claim).toMatch(/That reading is from Jan 2026/);
    expect(f.severity).toBeLessThan(0.9);
  });
  it('a STALE slow marker becomes a gentle "re-test" nudge, not a present-tense claim', () => {
    const c = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 22 }, '2025-03-10'), [], { today: '2026-07-17' });
    const f = c.flags[0];
    expect(f.claim).toMatch(/too old to act on now; worth re-testing/);
    expect(f.claim).toMatch(/Mar 2025/);
    expect(f.claim).not.toMatch(/very likely why easy runs/);
    expect(f.tone).toBe('gentle');
  });
  it('a STALE acute marker (old CK) is dropped entirely — it reflected that day, not now', () => {
    const c = buildClinicalContext(snap({ 'Creatine kinase (U/L)': 620 }, '2025-03-10'), [], { today: '2026-07-17' });
    expect(c.flags.find((x) => x.id === 'clinical-ck-high')).toBeUndefined();
  });
  it('no `today` supplied → no decay (backward-compatible)', () => {
    const c = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 22 }, '2020-01-01'), []);
    expect(c.flags[0].claim).toMatch(/is low/);        // asserted as-is when we can't compute age
  });
});

describe('through the engine — gClinical surfaces the top flag on Daily/Plan', () => {
  const ctx = (clinical) => ({
    clock: { hour: 12 }, today: { primarySession: null, trainedToday: true, tdee: 2500 },
    tomorrow: null, goal: { aRace: null, weakLink: null, body: null },
    fuel: { protein: null, calories: null, ea: { flag: false }, deficitPct: null },
    plan: {}, learned: {}, clinical, memory: {},
  });
  it('a low-iron panel speaks on Daily', () => {
    const clinical = buildClinicalContext(snap({ 'Ferritin (ng/mL)': 22 }), []);
    const nv = narrateSurface(ctx(clinical), 'daily');
    expect(nv).toBeTruthy();
    expect(nv.text).toMatch(/ferritin is low \(22/);
  });
  it('stays silent with no clinical flags', () => {
    expect(allBeats(ctx({ flags: [] })).find((b) => b.kind === 'clinical')).toBeUndefined();
  });
});
