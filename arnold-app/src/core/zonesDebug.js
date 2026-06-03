// ─── HR Zones diagnostic — window.zonesDebug() ──────────────────────────────
// Phase 4r.hub.zones — read-only console tool to answer "what are my REAL
// zones, and where do my runs actually fall?" Prints, side by side:
//   1. Garmin custom zones (profile.hrZoneBpm) if set
//   2. Karvonen / HRR zones from your true max + resting HR
//   3. Crude %HRmax zones (the weak fallback)
// plus your actual time-in-zone distribution over 30d and 90d.
//
// Why: the attribution engine + plan generator must judge "easy/Z2" against
// REAL physiological zones, not %HRmax guesses or single-run peaks. This tool
// surfaces the truth so we can pick the right zone source.

import { storage } from './storage.js';
import { isRun } from './activityClass.js';
import { getProfileZoneBpm, karvonenZones } from './derive/hr.js';

function median(arr) {
  const xs = (arr || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

// Bin one bpm into Z1..Z5 by a {z1Max,z2Max,z3Max,z4Max} boundary set.
function binByBpm(bpm, z) {
  if (!z || !Number.isFinite(bpm)) return null;
  if (bpm <= z.z1Max) return 0;
  if (bpm <= z.z2Max) return 1;
  if (bpm <= z.z3Max) return 2;
  if (bpm <= z.z4Max) return 3;
  return 4;
}

if (typeof window !== 'undefined') {
  window.zonesDebug = async () => {
    const _storage = window.__arnoldStorage || storage;
    const profile = _storage.get('profile') || {};
    const activities = (_storage.get('activities') || []).filter(a => isRun(a) && a?.date);
    const sleep = _storage.get('sleep') || [];

    // ── True max + resting HR ──
    let maxHR = null;
    try {
      const { getEffectiveMaxHR } = await import('./trainingStress.js');
      maxHR = getEffectiveMaxHR(profile, activities);
    } catch {}
    maxHR = maxHR || Number(profile.maxHR) || null;
    // Resting HR: median of sleep-row restingHR over last 60 days.
    const restingHR = median(
      sleep.filter(s => Number(s.restingHR) > 0).slice(0, 60).map(s => Number(s.restingHR))
    ) || Number(profile.restingHR) || null;

    console.log('%c━━━ HR ZONES DIAGNOSTIC ━━━', 'font-weight:700;font-size:13px');
    console.log(`true max HR: ${maxHR ?? '—'}   ·   resting HR: ${restingHR ?? '—'}`);

    // ── The three zone definitions ──
    const garmin = getProfileZoneBpm(profile);
    const karvonen = (maxHR && restingHR) ? karvonenZones({ maxHR, restingHR }) : null;
    const pctMax = maxHR ? {
      z1Max: Math.round(maxHR * 0.60),
      z2Max: Math.round(maxHR * 0.70),
      z3Max: Math.round(maxHR * 0.80),
      z4Max: Math.round(maxHR * 0.90),
    } : null;

    const fmtZ = (z) => z
      ? `Z1 ≤${z.z1Max} · Z2 ${z.z1Max + 1}-${z.z2Max} · Z3 ${z.z2Max + 1}-${z.z3Max} · Z4 ${z.z3Max + 1}-${z.z4Max} · Z5 >${z.z4Max}`
      : '(not available)';
    console.log('%cZone definitions (bpm):', 'font-weight:700');
    console.log('  1) Garmin custom :', fmtZ(garmin), garmin ? '' : '← none set');
    console.log('  2) Karvonen/HRR  :', fmtZ(karvonen), '← physiologically correct, adapts with fitness');
    console.log('  3) %HRmax (crude):', fmtZ(pctMax), '← the weak fallback');
    if (karvonen) console.log(`  → Your Z2 by Karvonen: ${karvonen.z1Max + 1}–${karvonen.z2Max} bpm. (Is 140 inside it?)`);

    // ── Actual time-in-zone distribution ──
    // Prefer per-activity hrZones [z1..z5] seconds (Garmin's own binning).
    // Fall back to binning avgHR by Karvonen when hrZones absent.
    const now = Date.now();
    const windows = [30, 90];
    for (const days of windows) {
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      const inWin = activities.filter(a => {
        const t = a.date && new Date(a.date + 'T12:00:00').getTime();
        return t && t >= cutoff;
      });
      const tot = [0, 0, 0, 0, 0];
      let secsFromZones = 0, secsFromAvg = 0;
      for (const a of inWin) {
        if (Array.isArray(a.hrZones) && a.hrZones.length === 5) {
          for (let i = 0; i < 5; i++) tot[i] += Number(a.hrZones[i]) || 0;
          secsFromZones += (Number(a.durationSecs) || 0);
        } else {
          // No zone array — approximate: whole run in the avgHR's Karvonen zone.
          const z = binByBpm(Number(a.avgHR || a.avgHeartRate), karvonen);
          if (z != null) { tot[z] += Number(a.durationSecs) || 0; secsFromAvg += (Number(a.durationSecs) || 0); }
        }
      }
      const grand = tot.reduce((s, v) => s + v, 0);
      const pct = grand > 0 ? tot.map(v => Math.round((v / grand) * 100)) : [0, 0, 0, 0, 0];
      const z12 = pct[0] + pct[1];
      console.log(`%cTime-in-zone · last ${days}d (${inWin.length} runs):`, 'font-weight:700');
      console.log(`  Z1 ${pct[0]}%  Z2 ${pct[1]}%  Z3 ${pct[2]}%  Z4 ${pct[3]}%  Z5 ${pct[4]}%   →  easy(Z1-2) ${z12}%`);
      console.log(`  ${z12 >= 75 ? '✓ on the 80/20 target' : '⚠ below 80% easy — grey-zone drift'}` +
        (secsFromAvg > 0 ? `  (note: ${Math.round(secsFromAvg / 60)}min binned from avgHR — no zone array)` : ''));
    }

    return { maxHR, restingHR, garmin, karvonen, pctMax };
  };
}
