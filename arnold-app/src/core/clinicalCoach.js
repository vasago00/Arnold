// core/clinicalCoach.js — CLINICAL generators' data layer (roadmap Stage 7 / legacy Phase F).
//
// Connects bloodwork + DEXA to TRAINING / FUEL / RECOVERY / GOAL — the coach explaining *why* a
// number matters for the athlete in front of it, not a lab readout. It reuses the app's own reference
// engine (biomarkers.bStatus + the BM ranges) so classification never drifts from the Labs screen.
//
// SCOPE — non-negotiable (matches the architecture's safety section): the coach FLAGS and CONTEXTUALISES,
// it NEVER DIAGNOSES or prescribes treatment. Every observation is training-relevant framing plus a
// hand-off to a professional. Clinical concerns route to a human; Arnold stays in the training lane.
//
// RECENCY — a lab is only a fact for as long as it's still true. An old panel is NOT current, so we
// decay clinical observations by AGE, tiered by how fast each marker actually moves (Emil's catch:
// some panels are >1yr old and were being asserted present-tense):
//   • acute markers (CK, hsCRP) — meaningful for weeks; an old one is noise → dropped.
//   • slow markers (ferritin/iron, hormones, vitamin D) — months → dated when aging, "re-test" when old.
//   • body-comp (DEXA) — months → same, longer horizon.
// Fresh → assert as now. Aging → keep but date-stamp + down-rank. Stale → a gentle "re-test" nudge
// (or, for acute/affirming, dropped), never a present-tense claim.
//
// PURE + node-testable: takes the lab/clinical arrays (+ today), returns a ranked, pre-framed `clinical`
// context the engine's gClinical reads. No storage, no I/O. Cold start / no `today` → no decay applied.

import { BM, bStatus } from './biomarkers.js';

const num = (x) => (x == null || x === '' ? null : (Number.isFinite(+x) ? +x : null));
const r = (n, d = 0) => (Number.isFinite(+n) ? (+n).toFixed(d) : null);
const optLo = (name) => (BM[name] && BM[name].opt ? BM[name].opt[0] : null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monYear(dateStr) {
  const m = /^(\d{4})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  return `${MONTHS[Math.max(0, Math.min(11, +m[2] - 1))]} ${m[1]}`;
}
function ageDays(dateStr, today) {
  if (!dateStr || !today) return null;
  const a = new Date(`${dateStr}T12:00:00`), b = new Date(`${today}T12:00:00`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Freshness horizons by marker volatility (days): fresh = assert as current; up to hard = "aging"
// (date-stamped, down-ranked); beyond hard = "stale".
const FRESH = {
  acute:    { fresh: 30,  hard: 75 },     // CK / hsCRP — reflect a moment, not a state
  slow:     { fresh: 150, hard: 400 },    // ferritin / hormones / vitD — shift over months
  bodycomp: { fresh: 210, hard: 550 },    // DEXA — months, longer horizon
};

// The most-recent lab snapshot's markers + its date.
function latestMarkers(labSnapshots) {
  const arr = Array.isArray(labSnapshots) ? labSnapshots.filter((s) => s && s.date) : [];
  if (!arr.length) return { markers: {}, date: null };
  const latest = [...arr].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return { markers: (latest && latest.markers) || {}, date: latest ? latest.date : null };
}

// DEXA lean-mass trend across the two most recent DEXA records + the latest DEXA date (best-effort).
function dexaLean(clinicalTests) {
  const dx = (Array.isArray(clinicalTests) ? clinicalTests : [])
    .filter((t) => t && t.type === 'dexa' && t.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const leanOf = (t) => num(t && (t.leanMass ?? t.lean ?? t.leanLbs ?? t.leanMassLbs));
  if (dx.length < 2) return { trend: null, date: dx[0] ? dx[0].date : null };
  const cur = leanOf(dx[0]); const prev = leanOf(dx[1]);
  if (cur == null || prev == null) return { trend: null, date: dx[0].date };
  const d = cur - prev;
  return { trend: Math.abs(d) < 1 ? 'held' : d > 0 ? 'up' : 'down', date: dx[0].date };
}

// Apply the recency policy to one raw candidate → a finalized flag, or null if it should be dropped.
function applyRecency(cand, today) {
  const age = ageDays(cand.sourceDate, today);
  const base = {
    id: cand.id, severity: cand.severity, area: cand.area, tone: cand.tone,
    claim: cand.claim, data: { ...(cand.data || {}), asOf: cand.sourceDate || null, ageDays: age },
    why: cand.why,
  };
  if (age == null) return base;                                   // no date/today → no decay (assert as given)
  const h = FRESH[cand.class] || FRESH.slow;
  if (age <= h.fresh) return base;                                // fresh → present-tense, full weight
  const my = monYear(cand.sourceDate) || 'an earlier panel';
  const months = Math.round(age / 30);
  if (age <= h.hard) {                                            // aging → keep, date-stamp, down-rank
    return { ...base, severity: cand.severity * 0.65, claim: `${cand.claim} (That reading is from ${my}.)` };
  }
  // stale → an old acute marker or an affirmation is noise; drop it. Others become a re-test nudge.
  if (cand.class === 'acute' || cand.tone === 'affirming') return null;
  return {
    id: cand.id, severity: 0.3, area: cand.area, tone: 'gentle',
    claim: `Your ${cand.label} last read out of range back in ${my} (~${months} months ago) — that panel's too old to act on now; worth re-testing before reading into it.`,
    data: { asOf: cand.sourceDate || null, ageDays: age },
    why: `${cand.why} — stale (${age}d)`,
  };
}

// ── the observation catalog — TRAINING-relevant markers only, each with a hand-off ────────────────
export function buildClinicalContext(labSnapshots, clinicalTests, { goalDirection = null, today = null } = {}) {
  const { markers, date } = latestMarkers(labSnapshots);
  const mv = (name) => num(markers[name]);
  const raw = [];

  // 1) IRON AXIS low → aerobic cost + fatigue. Highest training impact. (slow)
  const fer = mv('Ferritin (ng/mL)');
  const iron = mv('Iron (ug/dL)');
  const tsat = mv('Transferrin saturation (%)');
  const ironLow = (fer != null && bStatus('Ferritin (ng/mL)', fer) === 'flag' && fer < optLo('Ferritin (ng/mL)'))
    || (iron != null && bStatus('Iron (ug/dL)', iron) === 'flag' && iron < optLo('Iron (ug/dL)'))
    || (tsat != null && bStatus('Transferrin saturation (%)', tsat) === 'flag' && tsat < optLo('Transferrin saturation (%)'));
  if (ironLow) {
    const shown = fer != null ? { label: 'ferritin', val: fer, unit: 'ng/mL' } : iron != null ? { label: 'iron', val: iron, unit: 'µg/dL' } : { label: 'transferrin saturation', val: tsat, unit: '%' };
    raw.push({
      id: 'clinical-iron-low', class: 'slow', severity: 0.9, area: 'aerobic', tone: 'corrective',
      label: shown.label, sourceDate: date,
      claim: `Your ${shown.label} is low (${r(shown.val)} ${shown.unit}) — very likely why easy runs have felt harder, and it caps the aerobic adaptation you're chasing. Worth getting your iron checked with your doctor before adding load.`,
      data: { [shown.label.replace(/\s+/g, '')]: shown.val }, why: `biomarkers ${shown.label} below optimal (flag)`,
    });
  }

  // 2) TESTOSTERONE:CORTISOL ratio low → under-recovery / overtraining. (slow)
  const tc = mv('Testosterone:Cortisol Ratio (Units)');
  if (tc != null && bStatus('Testosterone:Cortisol Ratio (Units)', tc) === 'flag' && tc < optLo('Testosterone:Cortisol Ratio (Units)')) {
    raw.push({
      id: 'clinical-tc-low', class: 'slow', severity: 0.85, area: 'recovery', tone: 'corrective',
      label: 'testosterone:cortisol ratio', sourceDate: date,
      claim: `Your testosterone:cortisol ratio has dropped (${r(tc)}) — a classic under-recovery/overtraining signal. Protect sleep and easy days now; if it stays down, raise it with your doctor.`,
      data: { tcRatio: tc }, why: `biomarkers T:C ratio below optimal (flag)`,
    });
  }

  // 3) hsCRP high → systemic inflammation. (acute — a single old value is noise)
  const crp = mv('hsCRP (mg/L)');
  if (crp != null && bStatus('hsCRP (mg/L)', crp) === 'flag') {
    raw.push({
      id: 'clinical-hscrp-high', class: 'acute', severity: 0.7, area: 'recovery', tone: 'gentle',
      label: 'hsCRP', sourceDate: date,
      claim: `hsCRP is elevated (${r(crp, 1)} mg/L) — systemic inflammation that blunts adaptation and drags recovery. If it stays up, worth discussing with your doctor.`,
      data: { hsCRP: crp }, why: `biomarkers hsCRP above range (flag)`,
    });
  }

  // 4) CREATINE KINASE high → unrecovered muscle damage → ease the next hard day. (acute)
  const ck = mv('Creatine kinase (U/L)');
  if (ck != null && bStatus('Creatine kinase (U/L)', ck) === 'flag') {
    raw.push({
      id: 'clinical-ck-high', class: 'acute', severity: 0.6, area: 'recovery', tone: 'gentle',
      label: 'creatine kinase', sourceDate: date,
      claim: `Creatine kinase is up (${r(ck)} U/L) — recent training damage hasn't fully cleared. Ease the next hard session and let recovery catch up.`,
      data: { ck }, why: `biomarkers CK above range (flag)`,
    });
  }

  // 5) VITAMIN D low → bone + immune resilience (RED-S adjacent). (slow)
  const vd = mv('Vitamin D (ng/mL)');
  if (vd != null && bStatus('Vitamin D (ng/mL)', vd) === 'flag') {
    raw.push({
      id: 'clinical-vitd-low', class: 'slow', severity: 0.55, area: 'durability', tone: 'gentle',
      label: 'vitamin D', sourceDate: date,
      claim: `Vitamin D is low (${r(vd)} ng/mL) — it underpins the bone and immune resilience a hard training block depends on. Worth a recheck with your doctor.`,
      data: { vitaminD: vd }, why: `biomarkers Vitamin D below range (flag)`,
    });
  }

  // 6) DEXA — lean held during a cut → affirming. (bodycomp)
  const dexa = dexaLean(clinicalTests);
  if (dexa.trend === 'held' && goalDirection === 'cut') {
    raw.push({
      id: 'clinical-dexa-lean-held', class: 'bodycomp', severity: 0.4, area: 'goal', tone: 'affirming',
      label: 'DEXA lean mass', sourceDate: dexa.date,
      claim: `Your last DEXA says what you're losing is fat, not muscle — the cut's working; hold the course.`,
      data: {}, why: `DEXA lean mass held during a cut`,
    });
  }

  const flags = raw.map((c) => applyRecency(c, today)).filter(Boolean);
  flags.sort((a, b) => b.severity - a.severity);
  return { flags, asOf: date, dexaDate: dexa.date };
}

export default buildClinicalContext;
