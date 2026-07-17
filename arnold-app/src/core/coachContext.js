// core/coachContext.js — LIVE assembler for the pure Coach Narrative engine
// (coachNarrative.js). Storage-coupled, so kept OUT of the engine to keep that node-testable.
//
// DEFENSIVE by contract: every slice is guarded; a missing or changed source yields a null
// field, and the engine simply stays silent for the beats that need it (no-fabrication — a
// thin context produces fewer beats, never a wrong one, never a crash). It reuses the
// userState / sessions / plan signals CoachComment already computes, plus a couple of cheap
// direct reads (cut mode, goals, the planner week + logged activities).
//
// SLICE 1 wired: purpose · knock-on · mechanism · cut-divergence.
// SLICE 2 wired: WEEK DRIFT (missed-session live re-solve, gWeekDrift) + strength progress
//   (gProgress) — the plan slice below reconciles the planned Mon–Sun week against what was
//   actually logged, so a missed run this week surfaces as a flagged, judged, option-bearing
//   coaching beat on Play/Daily/Calendar. The pure reconcile (computePlanSlice) is exported +
//   node-tested; the live shell just fetches the planner week + activity stores and normalises.
// SLICE 2b wired: goal.weakLink — a lever string ('threshold'|'endurance'|'aerobic') mapped
//   from trainingProfile's weak-link ingredient (the biggest GOAL gap), resolved async in
//   CoachComment and passed in. Only set when the profile finds a REAL goal-anchored gap, so
//   gPurpose upgrades to "the exact gap between you and <race>" without ever fabricating a
//   limiter; null → gPurpose falls back to generic framing (still fires from primarySession).

import { intentFor } from './sessionAdapt.js';
import { classifyCutMode } from './cutMode.js';
import { getGoals } from './goals.js';
import { buildGoalModel } from './goalResolve.js';   // canonical A-race resolver (the plan's goal race)
import { fuelForToday } from './fuelForWork.js';      // live EA / RED-S read (Mountjoy IOC 2018 floor)
import { saidAgoDays } from './coachMemory.js';        // episodic novelty — "did I say this recently?"
import { readTodaySignals, readinessScoreFrom } from './todayAdaptation.js';   // same readiness the workout tile uses
import { adaptSession } from './adaptPlan.js';         // pure session-adaptation (the reason to back off)
import { hubFacts } from './hub/hubFacts.js';          // learned response sensitivities (heat %/°C, …)
import { weekKey, getPlannerWeek, daySessions, dayRunMiles } from './planner.js';
import { isRun, isStrength } from './activityClass.js';
import { storage } from './storage.js';
import { buildWorldModel } from './worldModel.js';   // day/week/season/body/person snapshot (Stage 1)
import { learnedKindWeights, learnedPerson } from './coachPersonalization.js';   // preference learning (Stage 4)

const num = (x) => (Number.isFinite(+x) ? +x : null);
const QUAL = new Set(['intervals', 'tempo', 'hiit']);
const ALIAS = { easy: 'easy_run', long: 'long_run', interval: 'intervals', speed: 'intervals', fartlek: 'intervals' };
const normType = (t) => { const s = String(t || '').toLowerCase(); return ALIAS[s] || s; };

// Canonical run types the engine's gWeekDrift understands (mirror coachNarrative RUN_TYPES).
const RUN_TYPES = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit']);

// ── PURE plan reconcile (node-testable; no storage/date/planner imports) ──────────────────
// normDays: [{ dateStr:'YYYY-MM-DD', hasStrength:bool, runSessions:[{type,mi}] }] for the
// current Mon–Sun week, in order. runOn/strOn: Sets of 'YYYY-MM-DD' that have a run / strength
// actually logged. todayStr: 'YYYY-MM-DD'. Returns the `plan` slice the engine reads
// (weekMiTarget/weekMiProjected/missed/remaining[/strengthTarget/strengthDone]) or {} when the
// week has no planned running (→ gWeekDrift + gProgress stay silent).
export function computePlanSlice(normDays, runOn, strOn, todayStr) {
  const rOn = runOn instanceof Set ? runOn : new Set(runOn || []);
  const sOn = strOn instanceof Set ? strOn : new Set(strOn || []);
  let weekMiTarget = 0, strengthTarget = 0, strengthDone = 0, swappedToStrength = false;
  const missed = [], remaining = [];
  for (const d of (normDays || [])) {
    if (!d || !d.dateStr) continue;
    const past = d.dateStr < todayStr;              // strictly-before-today = a session that has passed
    const runLogged = rOn.has(d.dateStr);
    if (d.hasStrength) { strengthTarget += 1; if (sOn.has(d.dateStr)) strengthDone += 1; }
    for (const s of (d.runSessions || [])) {
      if (!RUN_TYPES.has(s.type)) continue;
      const mi = Number(s.mi) || 0;
      weekMiTarget += mi;                           // target = the FULL planned week (done or not)
      const entry = { type: s.type, mi };
      if (past && !runLogged) {                     // planned run, day gone, nothing run → missed
        missed.push(entry);
        if (sOn.has(d.dateStr)) swappedToStrength = true;   // ...and strength WAS logged that day → a true swap
      } else if (!past && !runLogged) {
        remaining.push(entry);                      // today/future, not yet done → absorbable
      }
    }
  }
  if (!(weekMiTarget > 0)) return {};
  const missedMi = missed.reduce((a, m) => a + (m.mi || 0), 0);
  const slice = {
    weekMiTarget: Math.round(weekMiTarget),
    weekMiProjected: Math.round(Math.max(0, weekMiTarget - missedMi)),
    missed,
    remaining,
    swappedToStrength,                              // did the athlete log strength on a missed-run day?
  };
  if (strengthTarget > 0) { slice.strengthTarget = strengthTarget; slice.strengthDone = strengthDone; }
  return slice;
}

// Local YYYY-MM-DD (matches how activities store `.date` and how the planner keys weeks).
const fmtDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// ── LIVE shell: fetch the planner week + logged activity, normalise, hand to computePlanSlice.
function livePlanSlice(nowMs) {
  try {
    const now = Number.isFinite(+nowMs) ? new Date(+nowMs) : new Date();
    const wkStr = weekKey(now);                     // Monday-anchored 'YYYY-MM-DD' (planner's key)
    const wk = getPlannerWeek(wkStr);
    const days = (wk && wk.days) || [];
    if (!days.length) return {};
    const parts = String(wkStr).split('-').map(Number);
    const monday = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);   // exact Monday the planner used

    // What was actually LOGGED, by date — union of the three stores checkTodayCompletion reads.
    const acts = storage.get('activities') || [];
    const wkts = storage.get('workouts') || [];
    const logs = storage.get('dailyLogs') || [];
    const runOn = new Set(), strOn = new Set();
    for (const a of acts) { if (a && a.date) { if (isRun(a)) runOn.add(a.date); if (isStrength(a)) strOn.add(a.date); } }
    for (const w of wkts) { if (w && w.date) { if (/run/i.test(w.type || '')) runOn.add(w.date); if (/strength/i.test(w.type || '')) strOn.add(w.date); } }
    for (const l of logs) { if (l && l.date) { const t = `${l.workout || ''} ${l.type || ''} ${l.activityType || ''}`; if (/run/i.test(t)) runOn.add(l.date); if (/strength|weight/i.test(t)) strOn.add(l.date); } }

    const normDays = days.map((day, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const sess = daySessions(day) || [];
      return {
        dateStr: fmtDate(d),
        hasStrength: sess.some((s) => s.type === 'strength'),
        runSessions: sess.filter((s) => RUN_TYPES.has(s.type)).map((s) => ({ type: s.type, mi: Number(s.distanceMi) || 0 })),
      };
    });
    // dayRunMiles kept imported as the canonical per-day miles source of truth; normDays mirrors
    // it (sum of run-session distanceMi), so target math stays aligned with the calendar totals.
    void dayRunMiles;
    return computePlanSlice(normDays, runOn, strOn, fmtDate(now));
  } catch { return {}; }
}

export function buildCoachContext({ us, sessions, upcomingPlan, raceHorizon, hour, nowMs, weakLink = null } = {}) {
  try {
    const n = (us && us.numbers) || {};
    const S = Array.isArray(sessions) ? sessions : [];

    // Today's PRIMARY training session (a strength/run, not a bare mobility) for "purpose".
    const primary = S.find((s) => { const i = intentFor(s); return i && i.family !== 'mobility'; }) || S[0] || null;
    const ip = primary ? intentFor(primary) : null;
    let primarySession = ip ? { type: normType(primary.type), label: ip.label, loadBearing: !!ip.loadBearing } : null;
    // Pre-workout fallback: nothing logged yet → speak to TODAY'S PLANNED session so the purpose
    // beat fires on Play/Start before you train (not just after). Only a real, non-mobility plan.
    if (!primarySession) {
      const todP = upcomingPlan && upcomingPlan.todayPlanned;
      if (todP && todP.type && todP.type !== 'rest') {
        const ipp = intentFor(todP);
        if (ipp && ipp.family !== 'mobility') primarySession = { type: normType(todP.type), label: ipp.label, loadBearing: !!ipp.loadBearing };
      }
    }

    // Tomorrow's planned session (for the knock-on beat).
    let tomorrow = null;
    const tp = upcomingPlan && upcomingPlan.next7Days && upcomingPlan.next7Days[1] && upcomingPlan.next7Days[1].planned;
    if (tp && tp.type && tp.type !== 'rest') { const tt = normType(tp.type); tomorrow = { type: tt, label: tp.label || null, quality: QUAL.has(tt) }; }

    // GOAL race = the race the PLAN is built toward — NOT the soonest race on the calendar.
    // The coach was naming raceHorizon.race (next chronological race → "Berlin") while the plan
    // builds toward the A-race the athlete set a goal time on (→ "Valencia"). One source of truth:
    // resolve via buildGoalModel (the canonical A-race resolver the whole periodization anchors on),
    // keyed by planPrefs.target — the explicit 'race:<date>' the plan generator + LivingPlan use.
    // Fall back to the goal-model heuristic, then to the race-horizon signal. (Emil — unification.)
    let aRace = null;
    try {
      const races = storage.get('races') || [];
      const prefs = storage.get('planPrefs') || {};
      const aRaceDate = (typeof prefs.target === 'string' && prefs.target.startsWith('race:')) ? prefs.target.slice(5) : null;
      const gm = buildGoalModel({ races, goals: getGoals() || {}, aRaceDate });
      const ar = gm && gm.race && gm.race.aRace;
      if (ar && ar.name) aRace = { name: ar.name, daysOut: num(ar.daysOut) };
    } catch { /* fall back to the race-horizon signal below */ }
    if (!aRace) {
      const race = raceHorizon && raceHorizon.race;
      if (race) aRace = { name: race.name || 'your race', daysOut: num(raceHorizon.daysOut) };
    }

    // Fuel: protein gap + calorie intake vs target, from userState numbers (the SAME fields
    // classifyFuelState reads). Calories power the grounded fuel-status beat (gFuelStatus) so the
    // Fuel surface speaks the actual numbers on ordinary days, not just strength/cut days.
    const pT = num(n.proteinTarget); const pToday = num(n.todayProtein) || 0;
    const protein = pT != null ? { today: pToday, target: pT, gap: Math.max(0, Math.round(pT - pToday)) } : null;
    const kT = num(n.goalTarget); const kToday = num(n.todayIntake) || 0;
    const calories = (kT != null && kT > 0) ? { today: Math.round(kToday), target: Math.round(kT), pct: kToday / kT } : null;
    // Energy availability (RED-S) — live from fuelForWork, the SAME engine the planned-workout fuel
    // band uses. Was hard-coded off (the beat never fired); wire it so a genuine low-EA day surfaces
    // the corrective RED-S beat on Fuel/Daily. EA = (intake − activity kcal) / FFM; floor 30 kcal/kg.
    let ea = { flag: false };
    try {
      const fw = fuelForToday({ type: (primarySession && primarySession.type) || 'easy_run' }, nowMs ? { date: fmtDate(new Date(+nowMs)) } : {});
      if (fw && fw.ea && fw.ea.kcalPerKgFfm != null) {
        ea = { flag: !!fw.ea.flag, valueKcalPerKg: fw.ea.kcalPerKgFfm, floor: 30, status: fw.ea.status };
      }
    } catch { /* EA unavailable → the RED-S beat stays silent (no fabrication) */ }

    // Cut mode: deficit % + observed loss rate + direction — the SAME source as the Cut Mode card.
    let body = null; let deficitPct = null;
    try {
      const cm = classifyCutMode();
      const goals = getGoals() || {};
      deficitPct = num(cm && cm.deficitPct);
      const slope = (cm && cm.weight && (cm.weight.slope14d != null ? cm.weight.slope14d : cm.weight.slope7d));
      const rate = slope != null ? Math.round(-slope * 100) / 100 : null;
      const cur = num(cm && cm.weight && cm.weight.current); const tgt = num(goals.targetWeight);
      const dir = (cur != null && tgt != null) ? (cur - tgt > 0.5 ? 'cut' : cur - tgt < -0.5 ? 'bulk' : 'maintain') : null;
      if (dir) body = { direction: dir, observedRateLbPerWk: rate, targetLb: tgt };
    } catch { /* cut mode unavailable → skip body/deficit beats */ }

    // Plan slice (SLICE 2): planned week vs logged → missed / remaining / weekly volume + strength.
    const plan = livePlanSlice(nowMs) || {};

    // Injury area (e.g. 'knee') — powers the plan-status beat's "reshaped around your knee" read.
    const injuryArea = (() => {
      try { const iv = storage.get('injury'); return (typeof iv === 'string' && iv) ? iv : (iv && iv.area) ? iv.area : null; }
      catch { return null; }
    })();

    // Readiness (gReadiness) — the "back off today" nudge. Score/band from the SAME sleep+HRV
    // readiness the planned-workout tile shows (todayAdaptation), and the reason from adaptSession
    // (the pure engine that eases/trims a hard session). Computed synchronously (debt/fatigue are
    // async-only signals the tile adds — omitted here; the readiness band still drives the ease).
    // Only when today has a planned session that ISN'T done yet — a "back off" nudge is moot post-run.
    let readiness = null; let adaptation = null;
    try {
      const todP = upcomingPlan && upcomingPlan.todayPlanned;
      if (todP && todP.type && todP.type !== 'rest' && S.length === 0) {
        const sig = readTodaySignals();
        const score = readinessScoreFrom(sig);
        const band = score >= 75 ? 'high' : score >= 55 ? 'moderate' : 'low';
        readiness = { score, band };
        const prof = storage.get('profile') || {};
        const adapt = adaptSession(
          { type: todP.type, intensityClass: todP.type, distanceMi: num(todP.distanceMi), durationMin: num(todP.durationMin), label: todP.label },
          { readiness: band, debtLbs: 0, hrvDelta: sig.hrvDelta, sleepHrs: sig.sleepHrs, sleepGoalHrs: Number(prof.sleepGoalHrs) || 7.5, fatigueLevel: 0 },
        );
        if (adapt && (adapt.action === 'ease' || adapt.action === 'trim')) {
          // Pull the specific limiter (after the em-dash) unless it's the generic "low readiness"
          // note, which would just echo gReadiness's own "Readiness is low" lead.
          const rawWhy = adapt.reason && adapt.reason.includes('—') ? adapt.reason.split('—').slice(1).join('—').trim().replace(/\.$/, '') : null;
          const whyTail = (rawWhy && !/low readiness/i.test(rawWhy)) ? ` (${rawWhy})` : '';
          const verb = adapt.action === 'ease' ? 'is best eased to an easy effort' : 'is best trimmed ~15%';
          adaptation = { reason: `today's ${todP.label || todP.type} ${verb}${whyTail}`, action: adapt.action };
        }
      }
    } catch { /* readiness unavailable → gReadiness stays silent */ }

    // Learned HEAT sensitivity (gLearned) — the hub's per-°C cardiac-cost model × today's temperature,
    // the SAME heatStrain read LearnedHero / hubCoachInsights use. tempC comes from a logged session's
    // weather; with no session temp the beat stays silent (it needs a real temperature, no forecast here).
    let tempC = null; let learned = {};
    try {
      tempC = S.map((a) => Number(a && (a.avgTemperature ?? a.tempC ?? a.weatherTempC))).find(Number.isFinite);
      if (!Number.isFinite(tempC)) tempC = null;
      const hubState = storage.get('hub:state');
      if (hubState && tempC != null) {
        const facts = hubFacts(hubState);
        const hs = (facts.responses || []).find((rp) => rp && rp.factor === 'heatStrain');
        if (hs && hs.perUnitPct > 0) learned = { heat: { perUnitPct: hs.perUnitPct, confidence: hs.confidence } };
      }
    } catch { /* heat model unavailable → gLearned stays silent */ }

    const H = num(hour);
    const trainedToday = S.length > 0;
    const todayStr = fmtDate(Number.isFinite(+nowMs) ? new Date(+nowMs) : new Date());
    // Memory (Stage 4): episodic novelty (saidAgoDays) + PROCEDURAL preference (kindWeight) — the
    // learned per-kind salience nudge the engine already reads. Cold start → {} → no nudge.
    const memory = {
      saidAgoDays: (() => { try { return saidAgoDays(todayStr); } catch { return {}; } })(),
      kindWeight: (() => { try { return learnedKindWeights(todayStr); } catch { return {}; } })(),
    };
    // Semantic person (Stage 4): stance preference + patterns learned from engagement, fed into the
    // world-model `person`. Neutral (null) until there's real signal — no fabricated personalization.
    const personLearned = (() => { try { return learnedPerson(todayStr); } catch { return { stancePref: null, patterns: [] }; } })();

    // ── Stage 1: the WORLD MODEL — one structured snapshot (day/week/season/body/person) assembled
    // from the same normalised signals above. Additive: every legacy field below is untouched, and
    // ctx.clock is preserved, so existing generators keep working while they migrate to ctx.day.phase.
    const hasPlannedToday = !!primarySession
      || !!(upcomingPlan && upcomingPlan.todayPlanned && upcomingPlan.todayPlanned.type && upcomingPlan.todayPlanned.type !== 'rest');
    let world = null;
    try {
      world = buildWorldModel({
        hour: H, nowMs, trainedToday, hasPlannedToday,
        plan, aRace, body,
        fuel: { protein, calories, ea, deficitPct },
        readiness, injuryArea, tempC,
        profile: (() => {
          try {
            const p = storage.get('profile') || {};
            // Merge learned stance/patterns so world.person reflects preference learning (Stage 4).
            return { ...p, stancePref: personLearned.stancePref, patterns: personLearned.patterns };
          } catch { return { stancePref: personLearned.stancePref, patterns: personLearned.patterns }; }
        })(),
        memory,
      });
    } catch { world = null; }

    return {
      clock: { hour: H, isEvening: H != null && H >= 17, isLateNight: H != null && H >= 21 },
      today: { primarySession, trainedToday, tdee: null, injuryArea, readiness, tempC },
      adaptation,
      tomorrow,
      goal: { aRace, weakLink: (typeof weakLink === 'string' ? weakLink : null), body },   // weakLink: lever string from trainingProfile (slice 2b), or null
      fuel: { protein, calories, ea, deficitPct },
      plan,
      learned, clinical: {},
      // Episodic memory (Phase D): novelty — days since each beat was last shown (prior days only),
      // so the salience function down-weights what the coach already said and surfaces something new.
      memory,
      // Stage 1 world model — generators read ctx.day.phase (freshness/time), and ctx.week/season/
      // body/person for the richer state. Present on the live path; tests derive day from clock.
      day: world ? world.day : undefined,
      week: world ? world.week : undefined,
      season: world ? world.season : undefined,
      person: world ? world.person : undefined,
      world: world || undefined,
    };
  } catch { return null; }
}

export default buildCoachContext;
