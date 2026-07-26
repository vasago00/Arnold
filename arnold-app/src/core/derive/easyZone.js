// core/derive/easyZone.js — DEFINE "EASY" HONESTLY (P4).
//
// The premise (Seiler's polarized model): most training should be genuinely EASY — below the first
// lactate/ventilatory threshold (LT1 / VT1, the top of Zone 2). Above LT1 an "easy" run quietly
// becomes a workout, stealing from recovery AND from the real quality days. So we need an honest,
// PERSONAL ceiling for easy — not a population %HRmax band.
//
// Why heart-rate RESERVE, not %HRmax (the whole reason this module exists):
//   %HRmax divides by the max only and ignores where your range STARTS. Heart-rate reserve
//   (Karvonen) divides by the usable span between rest and max — how far INTO your range you are —
//   and tracks %VO2max far better. Because resting HR sits in BOTH the numerator and denominator,
//   %HRR is always LOWER than %HRmax for the same heartbeat (see pctReserve vs pctMax), which is
//   exactly what rescues a low-resting-HR athlete's easy runs from looking "too hard" on a generic
//   %HRmax chart. Resting HR is the piece that turns a population guess into YOUR number.
//
// Honesty (Emil's core rule): the science is blunt that there is NO validated field test for LT1 and
// that %HRmax formulas are unreliable. So we ESTIMATE LT1 from the athlete's own decoupling signature
// (where pace stops improving as HR climbs), express it as a %HRR, CLAMP it to the physiologically
// plausible window, and carry a confidence — never a hard line pretending to lab precision. When data
// is thin we fall back to a defensible central %HRR and say so.
//
// Pure + node-testable: takes plain arrays, returns a plain object. No storage, no fabrication.

// ── Physiological guardrails (from the literature) ──────────────────────────────────────────────
// LT1 as a fraction of HR reserve sits, across individuals, roughly in this window. We never let the
// estimate leave it, so a noisy inflection can't produce an absurd ceiling.
const LT1_HRR_MIN = 0.60;
const LT1_HRR_MAX = 0.80;
const LT1_HRR_FALLBACK = 0.70;     // defensible central estimate when the data can't support a personal one
const AEROBIC_CORE_HRR = 0.65;     // <= this = "definitely aerobic" for ~95% of runners (safe floor)
const SCIENCE_CAP_PCTMAX = 0.82;   // never call a run "easy" above this %HRmax, whatever the data says
const LT2_HRR_OFFSET = 0.17;       // LT2/threshold sits ~this much of reserve above LT1 (loose; only bounds "hard")

// ── small robust stats (kept local so the module has no deps and stays node-testable) ──
const num = (x) => (Number.isFinite(+x) ? +x : null);
function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function ageDays(dateStr, today) {
  const t = new Date(`${String(today).slice(0, 10)}T12:00:00`).getTime();
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`).getTime();
  return Number.isFinite(t) && Number.isFinite(d) ? (t - d) / 86400000 : Infinity;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── Karvonen core — the two denominators, and the round-trip between them ───────────────────────
/** %HRmax — ignores the floor (the honest-but-flawed denominator). */
export function pctMax(hr, hrMax) {
  if (!(hrMax > 0)) return null;
  return hr / hrMax;
}
/** %HR reserve (Karvonen) — (hr − rest) / (max − rest). The denominator that includes resting HR. */
export function pctReserve(hr, hrMax, hrRest) {
  const hrr = hrMax - hrRest;
  if (!(hrr > 0)) return null;
  return (hr - hrRest) / hrr;
}
/** Inverse of pctReserve: the bpm at a given fraction of reserve. hr = rest + p·(max − rest). */
export function hrAtPctReserve(p, hrMax, hrRest) {
  const hrr = hrMax - hrRest;
  if (!(hrr > 0)) return null;
  return hrRest + p * hrr;
}
/** The science guardrail on the easy ceiling (LT1): never call a run "easy" above ~0.82·HRmax / 0.80·reserve.
 *  Exported so the ONE resolver (zones.resolveZones) can enforce it too — keeping every surface on one number. */
export function easyCeilingCapBpm(hrMax, hrRest) {
  if (!(hrMax > 0) || !(hrRest >= 0) || hrMax <= hrRest) return null;
  return Math.round(Math.min(SCIENCE_CAP_PCTMAX * hrMax, hrAtPctReserve(LT1_HRR_MAX, hrMax, hrRest)));
}

// ── input estimators ────────────────────────────────────────────────────────────────────────────
/** HRmax — an explicit profile value wins; else the peak per-activity maxHR observed (already a max,
 *  so far less spiky than a raw sample). Guards against junk. */
export function estimateHrMax(runs, profile = {}) {
  const p = num(profile.maxHR);
  if (p && p > 120 && p < 230) return p;
  const maxes = runs.map((r) => num(r.maxHR)).filter((x) => x && x > 120 && x < 230);
  return maxes.length ? Math.max(...maxes) : null;
}
/** Resting HR over a window — median of the resting-HR series (from sleep/wellness). `days` selects the
 *  window: a long window gives the stable BASELINE (your true floor); a short window gives the ACUTE
 *  value (a fatigue signal when it's elevated vs baseline). profile.restingHR overrides. */
export function estimateRestingHr(series = [], opts = {}) {
  const { today, days = 120 } = opts;
  const rows = (series || [])
    .map((s) => ({ date: s.date, rhr: num(s.restingHR ?? s.restingHeartRate ?? s.rhr) }))
    .filter((s) => s.rhr && s.rhr > 25 && s.rhr < 110 && (!today || ageDays(s.date, today) <= days));
  return median(rows.map((s) => s.rhr));
}

/** percentile of a numeric array (linear, 0..1). */
function percentile(xs, p) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((m, n) => m - n);
  if (!a.length) return null;
  return a[clamp(Math.round((a.length - 1) * p), 0, a.length - 1)];
}

// ── LT1 from the athlete's OWN data ─────────────────────────────────────────────────────────────
// With run-level averages (one avgHR + one pace per run) we can't see within-run cardiac drift, but the
// CROSS-run shape is telling: in the easy domain, the SAME easy pace shows up across a spread of heart
// rates (a cool day at 133, a hot/tired day at 145) — pace sits on a PLATEAU while HR varies. Then, at
// genuine workouts, pace RE-ACCELERATES. LT1 is the CEILING of that aerobic plateau — the top of where
// he still runs easy — confirmed to sit just below where pace takes off again. Two signals agree on it:
//   (1) cluster ceiling — a high percentile of his aerobic-run HR (the top of what he does easy), and
//   (2) re-acceleration — the HR where median pace speeds up past the plateau (workouts begin).
// We take the cluster ceiling, cap it just below the re-acceleration, clamp to the plausible %HRR window,
// and grade confidence by data volume + how well the two signals agree.
export function estimateLt1(runs, { hrMax, hrRest, today, windowDays = 140 } = {}) {
  const hrr = hrMax - hrRest;
  const fallback = (why) => {
    const bpm = Math.round(hrRest + LT1_HRR_FALLBACK * hrr);
    return { bpm, pctHrr: LT1_HRR_FALLBACK, pctMax: bpm / hrMax, method: 'fallback', confidence: 0.2, why };
  };
  if (!(hrr > 0)) return fallback('no valid reserve');

  const pts = (runs || [])
    .map((r) => {
      const d = num(r.distanceMi), t = num(r.durationSecs), hr = num(r.avgHR);
      if (!d || !t || !hr || d < 0.5) return null;
      const pace = (t / 60) / d;                       // min/mi
      if (!(pace > 4 && pace < 18) || !(hr > 80)) return null;
      if (today && ageDays(r.date, today) > windowDays) return null;
      return { hr, speed: 1 / pace };                  // speed in mi/min (higher = faster)
    })
    .filter(Boolean);
  if (pts.length < 20) return fallback(`only ${pts.length} usable runs`);

  // (1) cluster ceiling: the 88th-percentile HR of his runs — the top of the easy cluster (the handful of
  // true workouts sit above it, so a high-but-not-extreme percentile finds the easy ceiling, not a workout).
  const clusterHr = percentile(pts.map((p) => p.hr), 0.88);

  // (2) re-acceleration: bin by 5 bpm; the plateau speed is the median speed of the dense aerobic core
  // (runs at/below the cluster ceiling). Walk the bins above it and find the first where median pace jumps
  // clear of the plateau — that's the workout floor; the aerobic ceiling is the bin just under it.
  const BIN = 5, MIN_PER_BIN = 4, REACCEL = 0.04;      // >4% faster than plateau = a different (working) gear
  const bins = new Map();
  for (const p of pts) {
    const key = Math.round(p.hr / BIN) * BIN;
    (bins.get(key) || bins.set(key, []).get(key)).push(p.speed);
  }
  const ordered = [...bins.entries()]
    .map(([hr, s]) => ({ hr, n: s.length, speed: median(s) }))
    .filter((b) => b.n >= MIN_PER_BIN)
    .sort((a, b) => a.hr - b.hr);
  const plateauSpeed = median(pts.filter((p) => p.hr <= clusterHr).map((p) => p.speed));
  let reaccelHr = null;
  for (const b of ordered) {
    if (b.hr <= clusterHr) continue;
    if (plateauSpeed > 0 && (b.speed - plateauSpeed) / plateauSpeed > REACCEL) { reaccelHr = b.hr; break; }
  }

  // LT1 = the cluster ceiling, but never at/above where pace re-accelerates (that's workout HR, not easy).
  const reaccelCap = reaccelHr != null ? reaccelHr - BIN / 2 : Infinity;
  const lt1Hr = Math.min(clusterHr, reaccelCap);
  const method = reaccelHr != null ? 'cluster+reaccel' : 'cluster';

  const rawPctHrr = (lt1Hr - hrRest) / hrr;
  const pctHrrClamped = clamp(rawPctHrr, LT1_HRR_MIN, LT1_HRR_MAX);
  const clamped = pctHrrClamped !== rawPctHrr;
  const bpm = Math.round(hrRest + pctHrrClamped * hrr);
  // agreement: do the two independent signals land close? (cluster vs the re-accel-capped value)
  const agree = reaccelHr != null ? 1 - Math.min(1, Math.abs(clusterHr - reaccelCap) / 15) : 0.5;
  const confidence = clamp(
    0.3
    + Math.min(0.3, pts.length / 600 * 0.3)     // data volume
    + 0.25 * agree                               // the two signals corroborate
    - (clamped ? 0.15 : 0),                      // had to be pulled into the plausible window
    0.15, 0.95,
  );
  return { bpm, pctHrr: pctHrrClamped, pctMax: bpm / hrMax, method, confidence, clamped, rawPctHrr };
}

// ── intensity classification, relative to the PERSONAL zone ─────────────────────────────────────
/** classify a run's avgHR into easy / grey / hard using %HRR relative to the athlete's LT1.
 *  easy  = at or below LT1 (true aerobic)
 *  grey  = above LT1 but below ~LT2 (the "black hole": too hard to recover, too easy to be a workout)
 *  hard  = at or above ~LT2 (a genuine quality effort)  */
export function classifyIntensity(hr, zone) {
  const pr = pctReserve(hr, zone.hrMax, zone.hrRest);
  if (pr == null) return 'unknown';
  // Grade against the ENFORCED ceiling (LT1 after the science cap), falling back to raw LT1 for a
  // hand-built zone. Keeping classification and the displayed ceiling on the same number is what stops
  // the engine from ever calling a run "easy" above the guardrail.
  const ceilPctHrr = zone.easyCeilingPctHrr ?? zone.lt1.pctHrr;
  if (pr <= ceilPctHrr + 0.005) return 'easy';
  if (pr < zone.lt2PctHrr) return 'grey';
  return 'hard';
}

// ── the orchestrator: build the athlete's honest easy zone from their data ──────────────────────
/**
 * buildEasyZone({ runs, restingHrSeries, profile }, { today, ... }) → the full picture:
 *   hrMax, hrRestBaseline, hrRestAcute, hrr, lt1 {bpm,pctHrr,pctMax,confidence,method},
 *   easyCeilingBpm, band, guardrails, lt2PctHrr, distribution {easy/grey/hard share}, drift[], restElevated.
 * Returns null only when there isn't enough to say anything honest (no HRmax or no resting HR).
 */
export function buildEasyZone(inputs = {}, opts = {}) {
  const { runs = [], restingHrSeries = [], profile = {}, zones = null } = inputs;
  const { today, windowDays = 140, restBaselineDays = 120, restAcuteDays = 10 } = opts;

  // Max + resting from the CANONICAL resolver when given (so this analysis shares the app's ONE ceiling),
  // else estimated from the raw inputs (keeps the module pure + node-testable on its own).
  const hrMax = (zones && zones.maxHR > 0) ? zones.maxHR : estimateHrMax(runs, profile);
  const hrRestBaseline = (zones && zones.restingHR > 0) ? zones.restingHR
    : (num(profile.restingHR) || estimateRestingHr(restingHrSeries, { today, days: restBaselineDays }));
  if (!(hrMax > 0) || !(hrRestBaseline > 0) || hrMax <= hrRestBaseline) return null;

  const hrRestAcute = estimateRestingHr(restingHrSeries, { today, days: restAcuteDays }) ?? hrRestBaseline;
  const hrr = hrMax - hrRestBaseline;

  // Science guardrails — computed BEFORE the ceiling so we can ENFORCE them (on DERIVED sources), not just show them.
  const aerobicCoreBpm = Math.round(hrAtPctReserve(AEROBIC_CORE_HRR, hrMax, hrRestBaseline));   // <= this = definitely aerobic
  const scienceCapBpm = Math.round(Math.min(SCIENCE_CAP_PCTMAX * hrMax, hrAtPctReserve(LT1_HRR_MAX, hrMax, hrRestBaseline)));

  // THE easy ceiling (LT1). From the canonical resolver when provided — lab / personal-data / garmin /
  // karvonen — so it's literally the number the rest of the app uses; else computed here from the athlete's
  // own decoupling. A measured lab value is trusted as-is; any DERIVED value is still capped by the science
  // guardrail. Classification + the LT2 boundary hang off this one ceiling.
  let lt1, easyCeilingBpm, lt2PctHrr;
  if (zones && zones.z2Ceiling > 0) {
    const isLab = zones.lt1Method === 'lab';
    easyCeilingBpm = isLab ? Math.round(zones.z2Ceiling) : Math.min(Math.round(zones.z2Ceiling), scienceCapBpm);
    const pHrr = pctReserve(easyCeilingBpm, hrMax, hrRestBaseline);
    lt1 = { bpm: easyCeilingBpm, pctHrr: pHrr, pctMax: easyCeilingBpm / hrMax, method: zones.lt1Method || zones.source || 'zones', confidence: zones.lt1Confidence ?? 0.5 };
    lt2PctHrr = zones.lt2Hr > 0 ? clamp(pctReserve(zones.lt2Hr, hrMax, hrRestBaseline), 0.80, 0.92) : clamp(pHrr + LT2_HRR_OFFSET, 0.80, 0.92);
  } else {
    lt1 = estimateLt1(runs, { hrMax, hrRest: hrRestBaseline, today, windowDays });
    easyCeilingBpm = Math.min(lt1.bpm, scienceCapBpm);
    lt2PctHrr = clamp(pctReserve(easyCeilingBpm, hrMax, hrRestBaseline) + LT2_HRR_OFFSET, 0.80, 0.92);
  }
  const easyCeilingPctHrr = pctReserve(easyCeilingBpm, hrMax, hrRestBaseline);

  const zone = {
    hrMax, hrRest: hrRestBaseline, hrRestAcute, hrr, lt1, source: (zones && zones.source) || 'decoupling',
    easyCeilingBpm, easyCeilingPctHrr, lt2PctHrr,
    band: { lowBpm: aerobicCoreBpm, highBpm: easyCeilingBpm },
    guardrails: { aerobicCoreBpm, scienceCapBpm },
    // Acute fatigue read: resting HR up vs baseline shrinks reserve and means easy PACE will read hot.
    // We surface it as a SIGNAL (attribution for a hot-drift day), never by silently moving the line —
    // by the reserve formula an elevated RHR would push the ceiling UP, exactly the wrong way when tired.
    restElevated: hrRestAcute - hrRestBaseline,
  };

  // Distribution over the window (the 80/20 check) + hot-drift days (easy-intent but over the ceiling).
  const NON_RUN = /\b(ski|snowboard|cycl|bik|ride|swim|strength|hiit|walk|hik|row|ellipt|yoga|mobility|breath|skate|hyrox|cardio)\w*/i;
  const inWindow = runs.filter((r) => {
    const hr = num(r.avgHR);
    if (!hr || hr < 80) return false;
    if (today && ageDays(r.date, today) > windowDays) return false;
    const type = String(r.type || r.activityType || '');
    if (type && NON_RUN.test(type) && r.isRun !== true) return false;
    return true;
  });
  let easy = 0, grey = 0, hard = 0;
  const drift = [];
  const easyPaces = [];   // min/mi of the genuinely-easy runs → the pace that corresponds to the HR ceiling
  const hrHist = new Map();   // 2.5-bpm histogram of run avg-HRs → the distribution curve the UI draws
  for (const r of inWindow) {
    const hb = Math.round(num(r.avgHR) / 2.5) * 2.5;
    hrHist.set(hb, (hrHist.get(hb) || 0) + 1);
    const cls = classifyIntensity(num(r.avgHR), zone);
    if (cls === 'easy') {
      easy++;
      const d = num(r.distanceMi), t = num(r.durationSecs);
      if (d > 0.5 && t > 0) { const p = (t / 60) / d; if (p > 4 && p < 18) easyPaces.push(p); }
    } else if (cls === 'grey') { grey++; }
    else hard++;
    // hot-drift = a run that was MEANT easy (planned easy, or easy by pace) but whose HR sat above the
    // ceiling. Distinguished from a real workout so the coach can attribute it (heat / fatigue), not nag.
    const plannedEasy = r.plannedType ? /easy|recovery|long/.test(String(r.plannedType)) : null;
    if (cls !== 'easy' && plannedEasy !== false && cls !== 'hard') {
      drift.push({ date: r.date, hr: num(r.avgHR), ceilingBpm: easyCeilingBpm, deltaBpm: Math.round(num(r.avgHR) - easyCeilingBpm) });
    }
  }
  const nRuns = inWindow.length || 1;
  zone.distribution = {
    nRuns: inWindow.length,
    easyShare: easy / nRuns, greyShare: grey / nRuns, hardShare: hard / nRuns,
  };
  // The easy PACE that corresponds to the HR ceiling — median + the typical spread (p25–p75), all min/mi.
  // Pace is confounded by heat/terrain (which is exactly why HR is the anchor), so it's a BAND, not a line.
  zone.easyPace = easyPaces.length >= 5
    ? { median: percentile(easyPaces, 0.5), fast: percentile(easyPaces, 0.25), slow: percentile(easyPaces, 0.75), n: easyPaces.length }
    : null;
  // Most-recent hot-drift days first, capped — the coach speaks to fresh drift, not a two-year backlog.
  zone.drift = drift.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20);
  // The single freshest drift day (≤5 days old) — what the coach reacts to now, if anything.
  zone.recentDrift = (today ? zone.drift.find((d) => ageDays(d.date, today) <= 5) : null) || null;
  // The distribution the UI draws: where the athlete's runs actually land (avg HR), plus the zone
  // boundaries to shade under it (recovery → easy ceiling → LT2 → hard).
  zone.hrDist = [...hrHist.entries()].map(([hr, n]) => ({ hr, n })).sort((a, b) => a.hr - b.hr);
  zone.lt2Bpm = Math.round(hrAtPctReserve(lt2PctHrr, hrMax, hrRestBaseline));
  zone.recoveryBpm = Math.round(easyCeilingBpm * 0.92);
  return zone;
}

export default buildEasyZone;
