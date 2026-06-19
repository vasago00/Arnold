// Locks the adaptive-plan engine (Phase 2.1). Pure rules → verifiable without UI.
import { describe, it, expect } from 'vitest';
import { adaptSession } from './adaptPlan.js';

describe('adaptSession — readiness reshapes the prescription', () => {
  it('EASES a hard session when recovery debt is heavy', () => {
    const r = adaptSession({ type: 'tempo', intensityClass: 'tempo', distanceMi: 6 }, { debtLbs: 2.5 });
    expect(r.action).toBe('ease');
    expect(r.eased).toBe(true);
    expect(r.intensityClass).toBe('easy');
    expect(r.distanceMi).toBe(4.5);            // 25% cut
    expect(r.reason).toMatch(/residual/i);
  });

  it('EASES a hard session on low readiness', () => {
    const r = adaptSession({ type: 'intervals', intensityClass: 'intervals', distanceMi: 5 }, { readiness: 'low' });
    expect(r.action).toBe('ease');
    expect(r.intensityClass).toBe('easy');
  });

  it('TRIMS a hard session on a mild limiter (HRV a touch low)', () => {
    const r = adaptSession({ type: 'tempo', intensityClass: 'tempo', distanceMi: 6 }, { hrvDelta: -7 });
    expect(r.action).toBe('trim');
    expect(r.eased).toBe(true);
    expect(r.distanceMi).toBe(5.1);            // 15% cut, intensity unchanged
    expect(r.intensityClass).toBe('tempo');
  });

  it('does NOT touch an already-easy session even under debt', () => {
    const r = adaptSession({ type: 'easy_run', intensityClass: 'easy', distanceMi: 5 }, { debtLbs: 2.5 });
    expect(r.action).toBe('hold');
    expect(r.eased).toBe(false);
    expect(r.distanceMi).toBe(5);
  });

  it('GREEN-LIGHTS the full session on a strong morning with no debt', () => {
    const r = adaptSession({ type: 'tempo', intensityClass: 'tempo', distanceMi: 6, label: 'Tempo 6mi' }, { readiness: 'high', debtLbs: 0 });
    expect(r.action).toBe('greenlit');
    expect(r.eased).toBe(false);
    expect(r.reason).toMatch(/cleared/i);
  });

  it('holds rest days with no reason', () => {
    const r = adaptSession({ type: 'rest' }, { debtLbs: 3 });
    expect(r.action).toBe('hold');
    expect(r.reason).toBe(null);
  });

  it('holds a hard session when everything is moderate', () => {
    const r = adaptSession({ type: 'tempo', intensityClass: 'tempo', distanceMi: 6 }, { readiness: 'moderate', debtLbs: 0 });
    expect(r.action).toBe('hold');
    expect(r.eased).toBe(false);
    expect(r.distanceMi).toBe(6);
  });

  it('does NOT greenlight a strong morning when the battery reads depleted', () => {
    // The contradiction Emil flagged: well-slept + good HRV (readiness high, no
    // debt) but the fatigue model shows ~empty. Must not say "recovered".
    const r = adaptSession(
      { type: 'tempo', intensityClass: 'tempo', distanceMi: 6 },
      { readiness: 'high', debtLbs: 0, fatigueLevel: 3 }
    );
    expect(r.action).not.toBe('greenlit');
    expect(r.reason).toMatch(/battery/i);   // eased, with the battery as the reason
  });

  it('EASES a hard session on a depleted battery alone', () => {
    const r = adaptSession({ type: 'intervals', intensityClass: 'intervals', distanceMi: 5 }, { fatigueLevel: 2 });
    expect(r.action).toBe('ease');
    expect(r.intensityClass).toBe('easy');
    expect(r.reason).toMatch(/battery reads depleted/i);
  });

  it('still greenlights when the battery is full (fatigueLevel 0)', () => {
    const r = adaptSession(
      { type: 'tempo', intensityClass: 'tempo', distanceMi: 6, label: 'Tempo 6mi' },
      { readiness: 'high', debtLbs: 0, fatigueLevel: 0 }
    );
    expect(r.action).toBe('greenlit');
  });
});
