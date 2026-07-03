// metricResult.js — Phase 2 of DATA_INTEGRITY_PLAN.md. The ONE place the
// "is this a real zero or is it missing?" decision lives, plus the typed result
// shape every scorer should emit. The fuel/nutrition hallucination existed
// because three scorers each made this call with ad-hoc `if (x > 0)` guards that
// silently turned MISSING into a favorable number. This centralizes it.
//
// Typed result:  { value, status, ...meta }
//   status ∈ 'ok' | 'stale' | 'no-data' | 'partial' | 'not-tracked' | 'gap' | 'no-target'
//     ok          — a real, usable value (INCLUDING a genuine 0)
//     gap         — input is EXPECTED (source configured / day is tracked) but absent → do NOT score
//     not-tracked — input isn't expected (user doesn't track it) → omit silently
//     no-data     — composite has no usable inputs at all
//     partial     — composite produced from some-but-not-all inputs (flag as incomplete)
//     no-target   — a target/goal is missing so adherence can't be computed

export function result(value, status = 'ok', meta = {}) {
  return { value, status, ...meta };
}

export const isUsable = (r) => !!(r && r.status === 'ok' && r.value != null);

/**
 * scoreAdherence — intake vs target → adherence ratio, or a typed gap.
 *
 * THE RULE that prevents the hallucination:
 *   • value missing (null/undefined/NaN) + EXPECTED → { status: 'gap' }     (don't score)
 *   • value missing + NOT expected                  → { status: 'not-tracked' }
 *   • value === 0 (a real, logged zero)             → { status: 'ok', value: 0 }  ← scored LOW, never skipped
 *   • target missing/zero                           → { status: 'no-target' }
 *   • otherwise                                     → { status: 'ok', value: clip(intake/target, 0, cap) }
 *
 * @param {number|null|undefined} value   logged intake
 * @param {number} target                 daily target/goal
 * @param {{expected?: boolean, cap?: number}} opts  `expected` = is this input due today (source configured / day tracked)?
 */
export function scoreAdherence(value, target, { expected = true, cap = 1.1 } = {}) {
  const present = value != null && Number.isFinite(Number(value));
  if (!present) return result(null, expected ? 'gap' : 'not-tracked');
  const tgt = Number(target);
  if (!(tgt > 0)) return result(null, 'no-target');
  const v = Number(value);
  return result(Math.max(0, Math.min(cap, v / tgt)), 'ok');
}

/**
 * combineDomain — fold per-factor adherence results into a 0..1 domain score the
 * HONEST way. Only 'ok' factors contribute; 'gap'/'not-tracked'/'no-target' are
 * skipped from the MATH but tracked so the result reports completeness.
 *   - no usable factors                → { value: null, status: 'no-data' }
 *   - some present but an EXPECTED gap  → { value, status: 'partial' }   (incomplete — flag it)
 *   - all expected factors present      → { value, status: 'ok' }
 * @param {Array<{w:number, r:object}>} factors  weight + scoreAdherence result per factor
 */
export function combineDomain(factors) {
  const usable = factors.filter(f => f && f.r && f.r.status === 'ok' && f.r.value != null && f.w > 0);
  if (usable.length === 0) return result(null, 'no-data');
  const wSum = usable.reduce((s, f) => s + f.w, 0);
  const value = usable.reduce((s, f) => s + (f.w / wSum) * f.r.value, 0);
  const expectedGap = factors.some(f => f && f.r && f.r.status === 'gap');
  return result(value, expectedGap ? 'partial' : 'ok', { usedFactors: usable.length, totalFactors: factors.length });
}
