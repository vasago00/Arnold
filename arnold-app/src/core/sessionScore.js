// Session execution score (Sprint 3.2d). Pure + tested.
//
// After a session is done, how well did it match the PLAN? Not "was it a good
// workout" (that's the post-workout summary) but "did you execute the
// prescription" — hit the distance, and hit the target pace where pace is the
// point (quality/long), or stay controlled where easy is the point.
//
// scoreSession({ planned, actual }) → { score 0-100, verdict, parts[] } | null
//   planned: { type, distanceMi?, paceTarget? ('m:ss' or secs), minutes? }
//   actual:  { distanceMi?, avgPaceRaw? / avgPaceSec?, durationSecs?, avgHR? }

const EASY_TYPES = new Set(['easy_run', 'recovery']);
const QUALITY_TYPES = new Set(['tempo', 'threshold', 'intervals', 'hiit']);

function paceToSec(p) {
  if (p == null) return null;
  if (typeof p === 'number') return p > 0 ? p : null;
  const parts = String(p).split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return null;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : (parts[0] || null);
}
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

export function scoreSession({ planned, actual } = {}) {
  if (!planned || !actual) return null;
  const type = planned.type || '';
  const parts = [];
  let scoreSum = 0, wSum = 0;
  const add = (label, s, w) => { parts.push({ label, score: Math.round(s * 100), weight: w }); scoreSum += s * w; wSum += w; };

  // ── Distance: did you cover the prescribed miles? ──
  const pd = num(planned.distanceMi), ad = num(actual.distanceMi);
  if (pd && pd > 0 && ad != null) {
    const r = ad / pd;
    const s = r >= 0.95 ? 1 : r >= 0.85 ? 0.8 : r >= 0.7 ? 0.55 : r >= 0.5 ? 0.35 : 0.15;
    add('distance', s, 1);
  }

  // ── Pace: hit the target where pace is the point; stay controlled on easy days. ──
  const pt = paceToSec(planned.paceTarget ?? planned.paceTargetSec);
  const ap = paceToSec(actual.avgPaceSec ?? actual.avgPaceRaw);
  if (pt && ap) {
    if (EASY_TYPES.has(type)) {
      // Easy: at or slower than target is fine; running much FASTER is the miss.
      const s = ap >= pt - 15 ? 1 : ap >= pt - 45 ? 0.6 : 0.3;
      add('control', s, 0.8);
    } else if (QUALITY_TYPES.has(type) || type === 'long_run') {
      const diff = Math.abs(ap - pt) / pt;
      const s = diff <= 0.03 ? 1 : diff <= 0.06 ? 0.75 : diff <= 0.10 ? 0.45 : 0.2;
      add('pace', s, QUALITY_TYPES.has(type) ? 1.2 : 1.0);
    }
  }

  // Nothing scoreable (e.g. strength with no distance/pace) → completion only.
  if (!wSum) {
    const done = (num(actual.durationSecs) || 0) >= 20 * 60 || (num(actual.distanceMi) || 0) > 0;
    add('completed', done ? 1 : 0, 1);
  }

  const score = wSum ? Math.round((scoreSum / wSum) * 100) : null;
  const verdict = score == null ? null
    : score >= 90 ? 'nailed'
    : score >= 75 ? 'solid'
    : score >= 55 ? 'partial'
    : 'off';
  return { score, verdict, parts };
}

export default scoreSession;
