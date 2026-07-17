// Hub core — PLAN GENERATOR. The "Coaching Team proposes your training" step: given
// how you want to train (run days/week, strength/week, focus) AND — critically —
// which days you can ACTUALLY train (availableDays), plus what the hub knows (your
// race paces, weekly volume), it lays out a 7-day week that fits your real schedule.
// Sessions only land on available days; when days are scarce it doubles (run +
// strength) and notes the compromise. Re-run any time with new availableDays to
// reshape the week — schedules change, the plan flexes. Output is the app's planner
// shape ({ days:[Mon..Sun] }, each a planner day object or null=rest). Pure + tested.

import { resolveSeasonPlan } from '../seasonPlan.js';   // periodization engine (2.1 season layer)
import { vdotFromRace, trainingPaces } from '../coaching/vdot.js';   // P1 — Daniels VDOT (adopted method)

// Mon=0 .. Sun=6.
const DEFAULT_LONG_DOW = 5;             // Saturday (only used as a hint)
const MI_PER_KM = 1 / 1.60934;
const WK_MS = 7 * 86400000;
const MARATHON_MIN_MI = 24;

const PLAN_LABEL = {
  easy_run: 'Easy run', long_run: 'Long run', tempo: 'Tempo',
  intervals: 'Intervals', strength: 'Strength',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function fmtPace(secPerMi) {
  if (!(secPerMi > 0)) return null;
  const m = Math.floor(secPerMi / 60), s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Derive easy/long/tempo/interval paces (sec/mi) from the hub's fitness via Daniels VDOT
// (P1 — adopted, validated method, replacing the old hand-tuned offsets). VDOT is seeded
// from the athlete's OWN predicted 10K (Riegel/hub) — that's the personalization: the paces
// are Daniels' zones computed at YOUR fitness. Long-run pace targets marathon effort (keeps
// the fast→slow order + gives goal-pace practice). Returns the generator's key shape.
export function pacesFromHubFacts(facts, opts = {}) {
  const tenK = (facts && facts.predictions || []).find(p => p.dist === '10K');
  if (!tenK || !(tenK.secs > 0)) return null;
  const vdot = vdotFromRace(tenK.secs, 10000);
  const tp = vdot ? trainingPaces(vdot) : null;
  if (!tp) return null;
  const out = { interval: tp.interval, tempo: tp.threshold, long: tp.marathon, easy: tp.easy };
  // YOUR DATA LEADS for easy/long: if we know your observed easy pace, prescribe THAT (not
  // the table), using the VDOT zone only as a guardrail — easy shouldn't be faster than
  // marathon pace, nor absurdly slower than the VDOT easy. Long = between your easy + MP.
  // Quality (tempo/interval) stays VDOT (effort-anchored, less personal data). (P1 · evolve.)
  const obs = Number(opts.observedEasySecs) > 0 ? Number(opts.observedEasySecs) : null;
  if (obs) {
    const easy = Math.max(tp.marathon, Math.min(tp.easy + 150, obs));   // guardrail band
    out.easy = easy;
    out.long = Math.round((easy + tp.marathon) / 2);
    out.easySource = (easy === obs) ? 'observed' : 'observed-clamped';
  }
  return out;
}

// Build a 7-day plan. opts:
//   availableDays: [dow…] the days you CAN train (default all 7). Sessions only land here.
//   runDays, strengthDays, focus ('race'|'base'|'maintain'|'hybrid'),
//   weeklyMileageTarget, paces (from pacesFromHubFacts), longRunDow (hint)
export function generateWeeklyPlan(opts = {}) {
  const avail = (Array.isArray(opts.availableDays) && opts.availableDays.length)
    ? [...new Set(opts.availableDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [0, 1, 2, 3, 4, 5, 6];
  const runDaysWanted = clamp(opts.runDays ?? 5, 1, 7);
  const strengthWanted = clamp(opts.strengthDays ?? 0, 0, 7);
  const focus = opts.focus || 'maintain';
  const weekly = Number(opts.weeklyMileageTarget) > 0 ? Number(opts.weeklyMileageTarget) : 30;
  const paces = opts.paces || null;

  // Runs can't exceed the days you can actually train.
  const effRunDays = Math.min(runDaysWanted, avail.length);
  const hasLong = runDaysWanted >= 3 && effRunDays >= 1;
  let quality = (focus === 'race' || focus === 'hybrid') ? 2 : 1;
  quality = Math.max(0, Math.min(quality, effRunDays - (hasLong ? 1 : 0) - 1)); // keep ≥1 easy if room
  if (quality === 0 && effRunDays - (hasLong ? 1 : 0) >= 1) quality = 1;          // ...but allow 1 quality if that's all there's room for
  let easyCount = Math.max(0, effRunDays - (hasLong ? 1 : 0) - quality);

  const longMi = hasLong ? Math.max(6, Math.round(weekly * 0.33)) : 0;
  const qualityMi = quality ? Math.max(4, Math.round(weekly * 0.16)) : 0;
  const easyBudget = Math.max(0, weekly - longMi - qualityMi * quality);
  const easyMi = easyCount > 0 ? Math.max(3, Math.round(easyBudget / easyCount)) : 0;

  const days = Array(7).fill(null);
  const mkRun = (type, mi) => ({
    type, label: PLAN_LABEL[type], distanceMi: mi || null,
    paceTarget: paces ? fmtPace(paces[type === 'long_run' ? 'long' : type === 'tempo' ? 'tempo' : type === 'intervals' ? 'interval' : 'easy']) : null,
    strength: false,
  });

  // ── Long run → a weekend available day (or an explicit hint, or the last available). ──
  let longDay = null;
  if (hasLong) {
    const weekendAvail = avail.filter(d => d === 5 || d === 6);
    if (opts.longRunDow != null && avail.includes(opts.longRunDow)) longDay = opts.longRunDow;
    else if (weekendAvail.length) longDay = weekendAvail[weekendAvail.length - 1];
    else longDay = avail[avail.length - 1];
    days[longDay] = mkRun('long_run', longMi);
  }

  // ── Quality runs → spaced where possible (prefer Tue/Thu), within available days. ──
  const runSlots = avail.filter(d => d !== longDay);
  const placedHard = new Set(longDay != null ? [longDay] : []);
  const adjacent = s => placedHard.has(s - 1) || placedHard.has(s + 1);
  // Rotating quality emphasis (de-linearize): qualityLead sets the leading hard
  // session; the second quality flips to the other type so consecutive weeks
  // aren't identical. Default (no lead) preserves the original intervals→tempo.
  const qLead = opts.qualityLead === 'tempo' ? 'tempo' : 'intervals';
  const qType = (n) => (n === 0 ? qLead : (qLead === 'tempo' ? 'intervals' : 'tempo'));
  const qPref = [1, 3, 2, 4, 0, 5, 6];
  let qi = 0;
  for (const s of qPref) { if (qi >= quality) break; if (runSlots.includes(s) && !days[s] && !adjacent(s)) { days[s] = mkRun(qType(qi), qualityMi); placedHard.add(s); qi++; } }
  for (const s of qPref) { if (qi >= quality) break; if (runSlots.includes(s) && !days[s]) { days[s] = mkRun(qType(qi), qualityMi); placedHard.add(s); qi++; } }

  // ── Easy runs → remaining available run days. ──
  let ei = 0;
  for (const s of runSlots) { if (ei >= easyCount) break; if (!days[s]) { days[s] = mkRun('easy_run', easyMi); ei++; } }

  // ── Strength placement. If the athlete pinned specific strength days
  // (opts.strengthDows), honor those exactly (double onto a run, else a pure
  // strength day) — their choice wins; we just flag if it lands on a hard day.
  // Otherwise auto-place: easy-day doubles → pure on empty days → (tight schedule)
  // doubled onto any run day. ──
  const isHardOrLong = d => d && (d.type === 'intervals' || d.type === 'tempo' || d.type === 'long_run');
  let stc = 0, strengthOnHard = false;
  const pinned = Array.isArray(opts.strengthDows) ? opts.strengthDows.filter(d => avail.includes(d)) : null;
  if (pinned && pinned.length) {
    for (const s of pinned) {
      if (days[s] && days[s].type === 'strength') { stc++; continue; }
      if (days[s]) { days[s].strength = true; stc++; if (isHardOrLong(days[s])) strengthOnHard = true; }
      else { days[s] = { type: 'strength', label: 'Strength', strength: true, distanceMi: null, paceTarget: null }; stc++; }
    }
  } else {
    for (const s of avail) { if (stc >= strengthWanted) break; if (days[s] && days[s].type === 'easy_run' && !days[s].strength) { days[s].strength = true; stc++; } }
    for (const s of avail) { if (stc >= strengthWanted) break; if (!days[s]) { days[s] = { type: 'strength', label: 'Strength', strength: true, distanceMi: null, paceTarget: null }; stc++; } }
    for (const s of avail) { if (stc >= strengthWanted) break; if (days[s] && days[s].type !== 'strength' && !days[s].strength) { days[s].strength = true; stc++; if (isHardOrLong(days[s])) strengthOnHard = true; } }
  }

  // ── Recovery/mobility on EVERY remaining empty day (not just available ones), so
  // the plan reads as a COMPLETE week — training days + Recovery days — with no blank
  // "rest" gaps. A "mobility" day is a Recovery day (rest OR 15-min mobility — the
  // athlete's choice, per the unified-Recovery decision), so it applies on days the
  // athlete can't train too: a day you don't train IS a recovery day, not nothing.
  // (Was `for (const s of avail)`, which left unavailable off-days — e.g. a Thursday
  // you don't run — as blank rest on the calendar instead of a Recovery session.)
  // Doesn't touch run/quality/strength counts. ──
  for (let s = 0; s < 7; s++) { if (!days[s]) days[s] = { type: 'mobility', label: 'Mobility', distanceMi: null, paceTarget: null, strength: false }; }

  // ── Labels (note doubles + pace/distance). ──
  for (let i = 0; i < 7; i++) {
    const d = days[i];
    if (!d || d.type === 'strength' || d.type === 'mobility') continue;
    const dist = d.distanceMi ? `${d.distanceMi}mi` : '';
    const pace = d.paceTarget ? ` @ ${d.paceTarget}/mi` : '';
    const base = `${PLAN_LABEL[d.type]}${dist ? ' ' + dist : ''}`;
    d.label = d.strength ? `${base} + strength` : base;
    d.note = d.strength ? `${PLAN_LABEL[d.type]}${pace} + a strength session` : `${PLAN_LABEL[d.type]}${pace}`;
  }

  const compressed = effRunDays < runDaysWanted || stc < strengthWanted || strengthOnHard;
  return {
    days,
    summary: {
      runDaysWanted, runDaysPlaced: effRunDays, strengthWanted, strengthPlaced: stc,
      focus, quality, easyCount, hasLong, longMi, easyMi, qualityMi, weeklyMi: weekly,
      availableDays: avail, compressed, strengthOnHard,
    },
  };
}

// Monday-anchored ISO key for a date (matches coachSignals' planner week keys).
export function mondayKeyOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEASON LAYER (Sprint 2 · 2.1) — periodized MULTI-WEEK block.
// Composes the two engines: for each week toward your races it pulls that week's phase
// + mileage + long-run target from resolveSeasonPlan (the periodization engine), feeds
// generateWeeklyPlan (the tested single-week layout), then applies phase rules:
//   build      → normal week, long run set to the season target (progressing each week)
//   mini-taper → drop the long run, keep one short sharpener
//   race-week  → the race is the key session (placed on its day); rest easy
//   recovery   → easy only, capped short long run
// The mileage ramp is THREADED: this week's target seeds next week's input, so build
// weeks climb ~10%/wk toward the ceiling exactly as resolveSeasonPlan intends. Pure.
// ═══════════════════════════════════════════════════════════════════════════════

function addDaysKey(mondayKey, days) {
  const d = new Date(`${mondayKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function dowOf(dateStr) { const d = new Date(`${dateStr}T12:00:00`); return Number.isFinite(d.getTime()) ? (d.getDay() + 6) % 7 : -1; }
const isMarathon = r => (Number(r?.distanceMi) || 0) >= MARATHON_MIN_MI;
function racesInWeek(races, mondayKey) {
  const end = addDaysKey(mondayKey, 6);
  return (races || []).filter(r => r && r.date && r.date >= mondayKey && r.date <= end);
}
function findDayIndex(days, type) { return days.findIndex(d => d && d.type === type); }
const mkEasy = (mi, prev) => ({ type: 'easy_run', label: 'Easy run', distanceMi: mi || null, paceTarget: prev?.paceTarget || null, strength: !!prev?.strength });
function setLongRunDistance(days, mi) { const i = findDayIndex(days, 'long_run'); if (i >= 0 && mi > 0) days[i].distanceMi = Math.round(mi); }
function dropLongRun(days) { const i = findDayIndex(days, 'long_run'); if (i >= 0) days[i] = mkEasy(4, days[i]); }
function downgradeQualityToEasy(days) {
  for (let i = 0; i < 7; i++) { const d = days[i]; if (d && (d.type === 'intervals' || d.type === 'tempo')) days[i] = mkEasy(d.distanceMi || 4, d); }
}
function trimToOneQuality(days) {
  let kept = 0;
  for (let i = 0; i < 7; i++) { const d = days[i]; if (d && (d.type === 'intervals' || d.type === 'tempo')) { if (kept) days[i] = mkEasy(4, d); else kept = 1; } }
}
function placeRace(days, race) {
  const dow = dowOf(race?.date); if (dow < 0) return;
  const mi = Number(race.distanceMi) || null;
  days[dow] = { type: 'race', label: race.name || 'Race', distanceMi: mi, paceTarget: null, strength: false, race: true, note: `${race.name || 'Race'}${mi ? ` · ${mi} mi` : ''}` };
}
function relabelSeason(days) {
  for (let i = 0; i < 7; i++) {
    const d = days[i];
    if (!d || d.type === 'strength' || d.type === 'race') continue;
    const dist = d.distanceMi ? ` ${d.distanceMi}mi` : '';
    const base = `${PLAN_LABEL[d.type] || d.type}${dist}`;
    d.label = d.strength ? `${base} + strength` : base;
    d.note = d.label;
  }
}
function weeksToDate(dateStr, startMonday) {
  const rm = mondayKeyOf(dateStr);
  if (!rm) return null;
  return clamp(Math.round((new Date(`${rm}T12:00:00`) - new Date(`${startMonday}T12:00:00`)) / WK_MS) + 1, 1, 52);
}
function resolveHorizonWeeks({ horizon, targetRaceDate }, races, today, startMonday) {
  // Target a SPECIFIC race/event on the calendar → build all the way to its week. Any
  // races in between (e.g. Berlin, NYC on the way to Valencia) are folded in as race-weeks
  // by the week-by-week loop, so this just sets how far to project.
  if (targetRaceDate) { const w = weeksToDate(targetRaceDate, startMonday); if (w) return w; }
  if (horizon === 'next-race') {
    const future = (races || []).filter(r => r && r.date && r.date >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return future[0] ? (weeksToDate(future[0].date, startMonday) || 8) : 8;
  }
  const n = parseInt(horizon, 10);
  return Number.isFinite(n) ? clamp(n, 1, 52) : 8;
}

// Build the periodized block. Returns { weeks:[{weekKey, phase, verdict, targetWeeklyMiles,
// longRunTargetMi, why, tuneUp, days}], summary }. Pure.
export function generateSeasonBlock(opts = {}) {
  const races = opts.races || [];
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const startMonday = mondayKeyOf(today);
  const base = { availableDays: opts.availableDays, runDays: opts.runDays, strengthDays: opts.strengthDays, focus: opts.focus, paces: opts.paces, longRunDow: opts.longRunDow, strengthDows: opts.strengthDows };
  let weeklyMiles = Number(opts.weeklyMiles) > 0 ? Number(opts.weeklyMiles) : 30;
  let longMi = Number(opts.longestRecentMi) > 0 ? Number(opts.longestRecentMi) : 8;
  const nWeeks = resolveHorizonWeeks({ horizon: opts.horizon, targetRaceDate: opts.targetRaceDate }, races, today, startMonday);
  // Targeting a specific race MAKES it the A-race (goal): the build peaks for it and the
  // OTHER marathons become supported tune-up efforts the build runs through. Explicit
  // opts.aRaceDate overrides. No A-race (horizon mode) → every marathon tapers (continuous).
  const aRaceDate = opts.aRaceDate || opts.targetRaceDate || null;

  const weeks = [];
  let buildIdx = 0;                                    // counts build weeks (cut-back cadence + quality rotation)
  const QUALITY_ROTATION = ['intervals', 'tempo'];    // alternate the leading hard session week to week
  for (let i = 0; i < nWeeks; i++) {
    const monday = addDaysKey(startMonday, i * 7);
    const sp = resolveSeasonPlan({ races, today: monday, weeklyMiles, longestRecentMi: longMi, acwr: opts.acwr, ceilingMiles: opts.ceilingMiles, aRaceDate });
    const wkRaces = racesInWeek(races, monday);
    // A-race (goal) → full taper/race-week. A non-A marathon in an A-race block is a
    // SUPPORTED effort: placed in a build week, it replaces that week's long run but the
    // build keeps climbing (no race-week/recovery reset). No A-race → any marathon tapers.
    const wkARace = aRaceDate ? (wkRaces.find(r => r.date === aRaceDate) || null) : (wkRaces.find(isMarathon) || null);
    const wkSupport = wkRaces.find(r => isMarathon(r) && r !== wkARace) || null;
    const phase = wkARace ? 'race-week' : sp.phase;

    // ── De-linearize (Sprint 3.2c): cut-back weeks + rotating quality. In a
    // sustained build, every 4th build week steps DOWN ~20% to consolidate — the
    // saw-tooth a real coach uses — while the THREADED weeklyMiles stays on the
    // underlying ramp so the build keeps progressing. Short blocks (<8 wk) get no
    // cut-back (and the phase stays 'build' so downstream phase logic is unchanged).
    let effTarget = sp.targetWeeklyMiles;
    let effLong = sp.longRunTargetMi;
    let cutback = false;
    let qualityLead;
    if (phase === 'build') {
      buildIdx++;
      qualityLead = QUALITY_ROTATION[(buildIdx - 1) % QUALITY_ROTATION.length];
      if (nWeeks >= 8 && buildIdx % 4 === 0) {
        effTarget = Math.round(sp.targetWeeklyMiles * 0.8);
        effLong = Math.round((sp.longRunTargetMi || 0) * 0.8);
        cutback = true;
      }
    }

    // Race-week volume trim — applies to the A-race AND supported B-marathons (Berlin/
    // NYC), not just the goal race. When a marathon lands in this week, mini-taper the
    // SURROUNDING training (~40% cut) so the week's total = easy miles + the 26.2 race
    // sits near the ceiling, instead of stacking a full 26.2 on top of a full build week
    // (which pushed race weeks to 64–72mi). The race is the week's long effort → no
    // separate long run. NOTE: this must run BEFORE generateWeeklyPlan so the easy runs
    // are SIZED down; the phase-specific block below then places the race + trims quality.
    const wkMarathon = (wkARace && isMarathon(wkARace)) ? wkARace : (wkSupport || null);
    if (wkMarathon) { effTarget = Math.round(weeklyMiles * 0.6); effLong = 0; }

    // Post-marathon RECOVERY week — for the supported B-marathons too (Berlin/NYC), not
    // just the A-race (whose post-race recovery racePhase already owns). A marathon in the
    // PREVIOUS week eases THIS week to an easy recovery block (no quality, short long run)
    // so the legs absorb 26.2 mi of eccentric load before the build resumes. Crucially the
    // ramp is NOT reset — `weeklyMiles` keeps threading up the build line (see below) — so
    // this is a DIP in the saw-tooth, not a restart (honors Option-A "keep climbing toward
    // the A-race"). Without it, Berlin/NYC sat between two full build weeks (52·race·52).
    const weekAgoKey = addDaysKey(monday, -7);
    const priorMarathon = races.find(r => isMarathon(r) && r.date && r.date < monday && r.date >= weekAgoKey);
    const postRace = !!priorMarathon && !wkMarathon && phase === 'build';
    if (postRace) { effTarget = Math.round(weeklyMiles * 0.6); effLong = Math.min(effLong, 10); }

    const gen = generateWeeklyPlan({ ...base, weeklyMileageTarget: effTarget, qualityLead });
    const days = gen.days;

    if (phase === 'build') {
      const inWk = wkSupport || (wkRaces.length && !wkARace ? wkRaces[0] : null);
      if (inWk) {
        placeRace(days, inWk);
        // A race IS the week's hard/long effort — never stack a full long run on top of it.
        // Marathon: also strip quality + trim volume (handled above). Tune-up (half/10K/etc.):
        // drop the separate long run (the race replaces it) and keep just one other quality,
        // so the week isn't a 20-miler + two quality sessions + a race (that was the 65-mi week
        // when NYRR Staten's half landed on a full build week).
        if (isMarathon(inWk)) { downgradeQualityToEasy(days); dropLongRun(days); }
        else { dropLongRun(days); trimToOneQuality(days); }
      } else if (postRace) {
        downgradeQualityToEasy(days);            // post-marathon recovery: easy running only
        setLongRunDistance(days, effLong);        // long capped short (≤10) by effLong above
      } else {
        setLongRunDistance(days, effLong);
      }
    } else if (phase === 'mini-taper') {
      dropLongRun(days); trimToOneQuality(days);
    } else if (phase === 'recovery') {
      downgradeQualityToEasy(days); setLongRunDistance(days, effLong);
    } else if (phase === 'race-week') {
      downgradeQualityToEasy(days); dropLongRun(days); if (wkARace) placeRace(days, wkARace);
    }
    relabelSeason(days);

    weeks.push({ weekKey: monday, phase, verdict: postRace ? 'recover' : (cutback ? 'cut' : sp.verdict), targetWeeklyMiles: effTarget, longRunTargetMi: effLong, why: postRace ? `Recovery week after ${priorMarathon.name} — easy aerobic only, no quality; let the legs absorb the marathon before the build resumes.` : (cutback ? `Cut-back week — ~20% down to absorb the last block; adaptation happens on the easier weeks.` : sp.why), tuneUp: sp.tuneUp || null, raceName: (wkARace || wkSupport || wkRaces[0])?.name || null, isARace: !!wkARace, cutback, recoveryAfterRace: postRace, days });

    weeklyMiles = sp.targetWeeklyMiles;                       // thread the UNREDUCED ramp so the build keeps climbing
    longMi = Math.max(longMi, sp.longRunTargetMi || longMi);
  }
  return { weeks, summary: { nWeeks, startMonday, horizon: opts.horizon ?? 8 } };
}

// Paste a season block into the planner (store = {get,set}). Default mode 'fill-empty'
// PROTECTS hand-edited days (only writes empty/rest or previously-generated days); mode
// 'overwrite' replaces everything in range. Returns { written }.
export function pasteSeasonBlock(store, weeks, opts = {}) {
  const mode = opts.mode || 'fill-empty';
  const planner = (store && typeof store.get === 'function' && store.get('planner')) || {};
  let written = 0;
  for (const wk of weeks || []) {
    const existing = planner[wk.weekKey] || { days: Array(7).fill(null).map(() => ({ type: 'rest' })) };
    const exDays = existing.days || [];
    const mergedDays = (wk.days || []).map((gd, i) => {
      const ex = exDays[i];
      const exEdited = ex && ex.type && ex.type !== 'rest' && !ex.generated;   // user hand-edited
      if (mode === 'fill-empty' && exEdited) return ex;                        // don't clobber it
      return gd ? { ...gd, generated: true } : { type: 'rest', generated: true };
    });
    planner[wk.weekKey] = { ...existing, weekStart: wk.weekKey, days: mergedDays, generated: true, generatedAt: new Date().toISOString(), phase: wk.phase };
    written++;
  }
  if (store && typeof store.set === 'function') store.set('planner', planner);
  return { written };
}

// Remove a pasted season block from the planner: reset only the GENERATED days back to rest,
// preserving anything you hand-edited. `weekKeys` = the block's week keys. Returns { cleared }.
export function clearSeasonBlock(store, weekKeys) {
  const planner = (store && typeof store.get === 'function' && store.get('planner')) || {};
  let cleared = 0;
  for (const key of weekKeys || []) {
    const wk = planner[key];
    if (!wk || !Array.isArray(wk.days)) continue;
    wk.days = wk.days.map(d => (d && d.generated) ? { type: 'rest' } : d);
    planner[key] = wk;
    cleared++;
  }
  if (store && typeof store.set === 'function') store.set('planner', planner);
  return { cleared };
}

// Generate THIS week's plan and write it into the planner (store = {get,set}).
// Returns { plan, key }. Pure aside from the injected store.
export function generateAndSaveWeek(store, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const key = opts.mondayKey || mondayKeyOf(today);
  const plan = generateWeeklyPlan(opts);
  const planner = (store && typeof store.get === 'function' && store.get('planner')) || {};
  planner[key] = { days: plan.days, generated: true, generatedAt: new Date().toISOString() };
  if (store && typeof store.set === 'function') store.set('planner', planner);
  return { plan, key };
}
