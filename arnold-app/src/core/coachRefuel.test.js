// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { refuelForSession, refuelPhrase, fuelGapAdvice } from './coachRefuel.js';

describe('refuelForSession', () => {
  it('scales carbs up for a long run vs an easy short run', () => {
    const long = refuelForSession({ distanceMi: 16, intensity: 'long_run' }, 70);
    const easy = refuelForSession({ distanceMi: 4, intensity: 'easy_run' }, 70);
    expect(long.carbsG).toBeGreaterThan(easy.carbsG);
    expect(long.long).toBe(true);
    expect(easy.load).toBe('easy');
  });

  it('flags a hard session and gives more carbs than easy', () => {
    const hard = refuelForSession({ distanceMi: 6, intensity: 'intervals' }, 70);
    const easy = refuelForSession({ distanceMi: 6, intensity: 'easy_run' }, 70);
    expect(hard.hard).toBe(true);
    expect(hard.carbsG).toBeGreaterThan(easy.carbsG);
  });

  it('scales with body mass and estimates kcal (~1 kcal/kg/km)', () => {
    const big = refuelForSession({ distanceMi: 10, intensity: 'easy_run' }, 90);
    const small = refuelForSession({ distanceMi: 10, intensity: 'easy_run' }, 60);
    expect(big.carbsG).toBeGreaterThan(small.carbsG);
    // 10 mi ≈ 16.1 km × 70 kg ≈ 1127 kcal
    expect(refuelForSession({ distanceMi: 10 }, 70).kcal).toBeGreaterThan(900);
  });

  it('protein stays in the 20–40 g band', () => {
    expect(refuelForSession({ distanceMi: 20 }, 120).proteinG).toBeLessThanOrEqual(40);
    expect(refuelForSession({ distanceMi: 3 }, 45).proteinG).toBeGreaterThanOrEqual(20);
  });
});

describe('refuelPhrase', () => {
  it('names the session and gives specific grams', () => {
    const p = refuelPhrase({ distanceMi: 14, intensity: 'long_run' }, 70, 'long run');
    expect(p.text).toMatch(/long run/);
    expect(p.text).toMatch(/g carbs/);
    expect(p.text).toMatch(/g protein/);
  });
});

describe('fuelGapAdvice', () => {
  it('states the real remaining gap and ties it to a hard session tomorrow', () => {
    const a = fuelGapAdvice({ intake: 1400, protein: 60, kcalT: 2200, proteinT: 130, tomorrowLabel: 'intervals', tomorrowHard: true });
    expect(a.text).toMatch(/800 kcal/);
    expect(a.text).toMatch(/70g protein/);
    expect(a.text).toMatch(/intervals/);
  });

  it('says on-target when the gap is closed', () => {
    const a = fuelGapAdvice({ intake: 2200, protein: 130, kcalT: 2200, proteinT: 130 });
    expect(a.text).toMatch(/on target/i);
    expect(a.kcalGap).toBe(0);
  });

  it('returns null with no targets', () => {
    expect(fuelGapAdvice({ intake: 500, protein: 20 })).toBe(null);
  });
});
