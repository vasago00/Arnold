// Quality-session structure generator (Sprint 3 · task #35). Pure + tested.
//
// Easy/long runs are one line. But intervals/tempo need real STRUCTURE: a
// warm-up, a main set with a SHAPE (straight reps / pyramid / continuous /
// cruise / fartlek — varying by phase), and a cool-down, with paces + recoveries.
//
// buildQualityStructure({ type, phase, paces, seed }) → {
//   tag       — compact tile label ("3×2mi", "1-2-3-2-1", "8×1′", "6×800m")
//   shape     — 'cruise'|'continuous'|'pyramid'|'straight'|'fartlek'
//   shorthand — one line ("15 min easy · 3 × 2 mi @ 6:55–7:05 · 2′ float @ 9:30 · 10 min easy")
//   warmup, mainSet, cooldown — text
//   profile   — [[durUnits, effort0..1], …] incl. wu / reps / recoveries / cd,
//               consumed by the effort-silhouette in the drill-down.
// }
// Paces come from the plan's computed paces object (sec/mi). Rotation (seed =
// week index) keeps consecutive quality weeks from being identical; phase shifts
// the emphasis (VO2/speed shapes early, threshold cruise mid, sharpeners in taper).

const QUALITY = new Set(['tempo', 'threshold', 'intervals', 'hiit']);

function fmtPace(secPerMi) {
  if (!(secPerMi > 0)) return null;
  const m = Math.floor(secPerMi / 60), s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function buildQualityStructure({ type, phase = 'build', paces = null, seed = 0 } = {}) {
  if (!QUALITY.has(type)) return null;
  // Target WORK paces are RANGES, not a false-precision single number — nobody splits an
  // 800 to the exact second, and chasing one pace makes you surge/fade. A window gives the
  // effort BAND to live in (VO2 a touch wider than the steadier threshold).
  const range = (sec, half) => (sec > 0 ? `${fmtPace(sec - half)}–${fmtPace(sec + half)}` : null);
  const tPace = paces ? range(paces.tempo, 5) : null;      // threshold: ±5 s/mi window
  const iPace = paces ? range(paces.interval, 6) : null;   // VO2/interval: ±6 s/mi window
  // Recovery stays a single easy reference — a jog/float needs no tight window; quantifying
  // it from easy pace still tells the athlete how fast to run the rest.
  const rPace = paces ? fmtPace(paces.easy) : null;
  const at = (p) => (p ? ` @ ${p}` : '');       // " @ 9:30" or ""
  const WU_STRIDES = '15 min easy + 4 strides';
  const WU_EASY = '15 min easy';
  const WU_SHORT = '10 min easy';
  const CD = '10 min easy';

  let tmpl;
  if (type === 'tempo' || type === 'threshold') {
    const opts = [
      { tag: '3×2mi', shape: 'cruise',     reps: [2, 2, 2], repEff: 0.84, wu: WU_EASY, main: `3 × 2 mi @ ${tPace || 'threshold'} · 2′ float${at(rPace)}` },
      { tag: '2×3mi', shape: 'cruise',     reps: [3, 3],    repEff: 0.84, wu: WU_EASY, main: `2 × 3 mi @ ${tPace || 'threshold'} · 3′ float${at(rPace)}` },
      { tag: '4mi T', shape: 'continuous', reps: [4],       repEff: 0.82, wu: WU_EASY, main: `4 mi continuous @ ${tPace || 'threshold'}` },
    ];
    // Taper/race-week → a short sharpener, not a big block.
    if (phase === 'race-week' || phase === 'mini-taper') {
      tmpl = { tag: '3×1mi', shape: 'cruise', reps: [1, 1, 1], repEff: 0.82, wu: WU_EASY, main: `3 × 1 mi @ ${tPace || 'threshold'} · 2′ float${at(rPace)}` };
    } else {
      tmpl = opts[seed % opts.length];
    }
  } else {
    // intervals / hiit — VO2 / speed. Recovery is SIZED TO THE REP so it's a genuine VO2
    // session, not under-recovered: 800m VO2 reps get a 400 m float (~half the rep,
    // ~2–2.5 min at easy pace) — the Daniels standard — NOT a flat 90 s; the pyramid gets
    // equal-TIME recovery; the fartlek's "1 min easy" is the recovery. All carry a pace.
    const opts = [
      { tag: '1-2-3-2-1', shape: 'pyramid',  reps: [1, 2, 3, 2, 1],          repEff: 0.92, wu: WU_STRIDES, main: `1-2-3-2-1 min hard @ ${iPace || '5K pace'} · jog recovery = rep time${at(rPace)}` },
      { tag: '6×800m',    shape: 'straight', reps: [2, 2, 2, 2, 2, 2],       repEff: 0.90, wu: WU_STRIDES, main: `6 × 800 m @ ${iPace || '5K pace'} · 400 m float${at(rPace)}` },
      { tag: '8×1′',      shape: 'fartlek',  reps: [1, 1, 1, 1, 1, 1, 1, 1], repEff: 0.86, wu: WU_SHORT,   main: `8 × (1 min hard / 1 min easy${at(rPace)})` },
    ];
    tmpl = opts[seed % opts.length];
  }

  // Effort silhouette segments: warm-up, then rep/recovery alternating, then cool-down.
  const profile = [[4, 0.28]];
  tmpl.reps.forEach((r, idx) => {
    profile.push([r, tmpl.repEff]);
    if (idx < tmpl.reps.length - 1) profile.push([1, 0.24]);   // recovery valley
  });
  profile.push([3, 0.28]);

  return {
    tag: tmpl.tag,
    shape: tmpl.shape,
    warmup: tmpl.wu,
    mainSet: tmpl.main,
    cooldown: CD,
    shorthand: `${tmpl.wu} · ${tmpl.main} · ${CD}`,
    profile,
  };
}

export default buildQualityStructure;
