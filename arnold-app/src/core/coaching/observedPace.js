// core/coaching/observedPace.js — YOUR real easy pace, from YOUR runs. This is the truth the
// easy/long prescription anchors to (COACHING_PHILOSOPHY: "your data leads, VDOT guards").
// VDOT gives the textbook zone; this gives what your body actually does on an aerobic run,
// and the pace layer prescribes THIS (with the VDOT zone only as a sanity guardrail).
//
// "Aerobic run" = an easy effort. Preferred signal: heart rate below your aerobic ceiling
// (Maffetone MAF + a few bpm). When HR is thin/absent, fall back to the SLOWER ~60% of your
// recent runs (your easy days are the slow ones; the fast ones are quality/races). Pure + tested.

import { isRun } from '../activityClass.js';
import { mafHeartRate } from './maffetone.js';

function paceStrToSecs(s) {
  if (typeof s === 'number') return s > 0 ? s : null;
  const m = String(s || '').match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function daysAgoKey(days) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// → { secs: median easy pace sec/mi | null, n, source: 'hr' | 'pace-split' | 'insufficient' }
export function observedEasyPaceSecs(activities, opts = {}) {
  const cutoff = daysAgoKey(opts.days || 90);
  const rows = (activities || [])
    .filter(a => isRun(a) && (a.date ? a.date >= cutoff : true) && Number(a.durationSecs) > 0)
    .map(a => ({ secs: paceStrToSecs(a.avgPaceRaw ?? a.avgPace), hr: Number(a.avgHR ?? a.avgHeartRate) || null }))
    .filter(r => r.secs > 0);
  if (rows.length < 3) return { secs: null, n: rows.length, source: 'insufficient' };

  const aerobicCap = Number(opts.aerobicHrCap) || (opts.age ? mafHeartRate(opts.age) + 5 : null);
  const withHr = rows.filter(r => r.hr);
  let easy = null, source = 'pace-split';
  if (aerobicCap && withHr.length >= 3) {
    const sub = withHr.filter(r => r.hr <= aerobicCap).map(r => r.secs);
    if (sub.length >= 3) { easy = sub; source = 'hr'; }
  }
  if (!easy) {
    // No reliable HR split — drop the fastest ~40% (quality/races), keep the slower easy days.
    const sorted = rows.map(r => r.secs).sort((a, b) => a - b);
    easy = sorted.slice(Math.floor(sorted.length * 0.4));
  }
  const secs = median(easy);
  return { secs: secs ? Math.round(secs) : null, n: easy.length, source };
}
