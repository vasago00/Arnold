// Hub core — PLAN GENERATOR. The "Coaching Team proposes your training" step: given
// how you want to train (run days/week, strength/week, focus) AND — critically —
// which days you can ACTUALLY train (availableDays), plus what the hub knows (your
// race paces, weekly volume), it lays out a 7-day week that fits your real schedule.
// Sessions only land on available days; when days are scarce it doubles (run +
// strength) and notes the compromise. Re-run any time with new availableDays to
// reshape the week — schedules change, the plan flexes. Output is the app's planner
// shape ({ days:[Mon..Sun] }, each a planner day object or null=rest). Pure + tested.

// HALF_MIN_MI comes from the periodization engine rather than being re-declared here:
// both files shape a week around the same "is this race the week's long run" line, and
// two copies of 13 is exactly how the two layers start answering that differently.
import { resolveSeasonPlan, HALF_MIN_MI } from '../seasonPlan.js';   // periodization engine (2.1 season layer)
import { vdotFromRace, trainingPaces } from '../coaching/vdot.js';   // P1 — Daniels VDOT (adopted method)
import { AGGRAVATORS, INJURY_LIBRARY } from '../injury.js';   // selective niggle protection (knee → speed eased)

// Mon=0 .. Sun=6.
const DEFAULT_LONG_DOW = 5;             // Saturday (only used as a hint)
const MI_PER_KM = 1 / 1.60934;
const WK_MS = 7 * 86400000;
const MARATHON_MIN_MI = 24;

const PLAN_LABEL = {
  easy_run: 'Easy run', long_run: 'Long run', tempo: 'Tempo',
  intervals: 'Intervals', strength: 'Strength',
};

import { clamp } from '../stats.js';
// core/time.js is the canonical local-date formatter and it "deliberately never
// calls toISOString()" (time.js:8-13) — because toISOString() is UTC and rolls
// over at UTC midnight, not local midnight. This file used to build a Date at
// LOCAL noon and then read it back in UTC, which is the same bug in slow motion:
// west of UTC it silently reports TOMORROW every evening (New York after ~19:00),
// and far enough east it reports yesterday. These keys are the planner's week
// keys and its idea of "today", so a one-day slip lands the whole week's sessions
// on the wrong dates and every one of them reads missed. Emil: "I stills see
// misses across all surfaces."
import { ymd } from '../time.js';
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
  // A run day you can't give ≥2.5 miles isn't a run day — at very low weekly volume,
  // honoring "5 run days" literally forces the week's total above its own target no
  // matter how the miles are split. Capping the count here (and reporting it via
  // `compressed`) keeps the WEEK honest and says so, instead of silently overshooting.
  const effRunDays = Math.min(runDaysWanted, avail.length, Math.max(1, Math.floor(weekly / 2.5)));
  const hasLong = runDaysWanted >= 3 && effRunDays >= 1;
  // ── How many HARD sessions the week's VOLUME can carry. ──────────────────────────
  // Two quality sessions is a 30-mile-week structure; prescribing two on a 13-mile
  // rebuild week is both bad coaching and arithmetically impossible (see the floors
  // below). So the quality count is capped by volume as well as by available days.
  const volQualityCap = weekly >= 26 ? 2 : weekly >= 15 ? 1 : 0;
  let quality = Math.min((focus === 'race' || focus === 'hybrid') ? 2 : 1, volQualityCap);
  quality = Math.max(0, Math.min(quality, effRunDays - (hasLong ? 1 : 0) - 1)); // keep ≥1 easy if room
  if (quality === 0 && volQualityCap >= 1 && effRunDays - (hasLong ? 1 : 0) >= 1) quality = 1;  // ...but allow 1 quality if that's all there's room for
  let easyCount = Math.max(0, effRunDays - (hasLong ? 1 : 0) - quality);

  // ── Distances. Nominal shape: long 33%, each quality 16%, easy splits the rest. ───
  // The 6/4/3-mile numbers are floors on a SESSION (a 1-mile "long run" isn't one) —
  // they were never meant to be a floor on the WEEK, but they stacked into one: at a
  // 13-mile target this produced 6 + 4 + 4 + 3 + 3 = 20 miles, a 54% overshoot, which
  // is why a plan told to build gently from a ~12 mi/wk base still opened at ~19-20
  // and climbed from there (Emil, 2026-07: "how can I jump from 33 to 45 in a week,
  // this will kill any good build"). The overshoot vanished above ~30 mpw, so it only
  // ever hurt exactly the athlete who most needed the ramp respected: one rebuilding.
  // Fix: when the floors don't fit the budget, scale the whole week down to the target
  // (preserving the long/quality/easy proportions) with a 2-mile absolute session
  // minimum. At 30+ mpw the floors never bind and nothing here changes.
  const ABS_MIN_MI = 2;
  let longMi = hasLong ? Math.max(6, Math.round(weekly * 0.33)) : 0;
  let qualityMi = quality ? Math.max(4, Math.round(weekly * 0.16)) : 0;
  const easyBudget = Math.max(0, weekly - longMi - qualityMi * quality);
  let easyMi = easyCount > 0 ? Math.max(3, Math.round(easyBudget / easyCount)) : 0;
  const floored = longMi + qualityMi * quality + easyMi * easyCount;
  if (weekly > 0 && floored > weekly * 1.05) {
    const k = weekly / floored;
    if (hasLong) longMi = Math.max(ABS_MIN_MI, Math.round(longMi * k));
    if (quality) qualityMi = Math.max(ABS_MIN_MI, Math.round(qualityMi * k));
    if (easyCount) easyMi = Math.max(ABS_MIN_MI, Math.round(easyMi * k));
  }

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
  return ymd(d);
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
  return ymd(d);
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
// Demote, don't delete. When a race of half-marathon-or-longer takes over as the week's
// long run, the run the generator had laid out is not surplus — its MILES were part of
// this week's budget and the athlete is still going to run them. It loses the "long run"
// designation (a week does not get two long runs) and keeps its distance. dropLongRun
// above throws the miles away and replaces them with a flat 4, which is right for a
// taper week and wrong everywhere else; using it on every race week is how a Saturday
// 5K used to delete a 16-mile Sunday.
function demoteLongRunToEasy(days) {
  const i = findDayIndex(days, 'long_run');
  if (i >= 0) days[i] = mkEasy(Number(days[i].distanceMi) || 4, days[i]);
}
const sumDayMiles = (days) => Math.round((days || []).reduce((t, d) => t + (Number(d && d.distanceMi) || 0), 0) * 10) / 10;
// Selective injury protection. An active niggle only aggravates SOME running stresses
// (injury.js encodes which: a knee aggravates intensity, a shin aggravates impact +
// volume, …). Downgrade ONLY the aggravating sessions — speed/tempo → easy aerobic; a
// long run shortened for a volume injury — and leave tolerated sessions untouched (focus
// the running on what the body can still do). Mutates `days`; returns true if it changed
// anything. Runs across the whole block while the injury is logged; clearing it and
// regenerating restores the quality.
function protectInjuredDays(days, area) {
  const inj = INJURY_LIBRARY[area];
  if (!inj || !inj.aggravates || !inj.aggravates.length) return false;
  const hits = (type) => inj.aggravates.some(a => AGGRAVATORS[a] && AGGRAVATORS[a].has(type));
  let changed = false;
  for (let i = 0; i < 7; i++) {
    const d = days[i];
    if (!d || d.type === 'race' || d.type === 'strength' || d.type === 'mobility' || d.type === 'rest') continue;
    if (!hits(d.type)) continue;
    if (d.type === 'long_run') {
      const cur = Number(d.distanceMi) || 0;   // volume-aggravating (shin/ITB/back) → shorten the long run
      if (cur > 8) { d.distanceMi = Math.max(6, Math.round(cur * 0.6)); changed = true; }
    } else {
      days[i] = mkEasy(d.distanceMi || 4, d);   // intensity/impact (tempo/intervals/hiit) → easy aerobic
      changed = true;
    }
  }
  return changed;
}

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
// ── THE 48 HOURS EITHER SIDE OF A LONG RACE ──────────────────────────────────────────
// Putting the race inside the week's mileage (Emil's rule) hands the generator REAL
// miles to lay out AROUND it — and the day it picks for the week's biggest training run
// can land on the Saturday before a Sunday marathon. Seven easy miles the day before
// Berlin is not a plan, it is an injury with a date on it. The same is true after: a
// 13-mile "easy" run the morning after racing a half is worse than the half was.
//
// Only races of half-marathon-or-longer earn this. Emil's rule 1 is explicit that a 5K
// or a road mile is simply that day's run, and you do not reorganise a week around one.
//
// The shaved miles are NOT moved elsewhere in the week. That was the tempting version
// and it is wrong: the only days left to move them to are also inside the taper, so
// "preserving the weekly total" would mean answering a 7-mile Saturday with a 12-mile
// Monday of race week. A taper is supposed to make the week smaller. totalWeeklyMiles
// is summed from the days AFTER this runs, so the number the athlete reads is the week
// they will actually run rather than the one the ramp line asked for.
const TAPER_BEFORE_MI = [null, 4, 6];        // [race day, day before, two days before]
const TAPER_AFTER_LONG_MI = [null, 4, 6];    // after a half — easy shakeout, then normal
const TAPER_AFTER_MARATHON_MI = [null, 0, 0]; // after a marathon — rest, both days
function taperIntoLongRaces(days, races) {
  const caps = new Array(7).fill(null);
  const put = (i, mi) => { if (i >= 0 && i < 7) caps[i] = caps[i] == null ? mi : Math.min(caps[i], mi); };
  for (const r of races || []) {
    const mi = Number(r && r.distanceMi) || 0;
    if (mi < HALF_MIN_MI) continue;
    const dow = dowOf(r && r.date);
    if (dow < 0) continue;
    const after = mi >= MARATHON_MIN_MI ? TAPER_AFTER_MARATHON_MI : TAPER_AFTER_LONG_MI;
    for (let k = 1; k <= 2; k++) { put(dow - k, TAPER_BEFORE_MI[k]); put(dow + k, after[k]); }
  }
  for (let i = 0; i < 7; i++) {
    const cap = caps[i]; const d = days[i];
    if (cap == null || !d || d.type === 'race' || d.type === 'strength' || d.type === 'mobility' || d.type === 'rest') continue;
    if (cap <= 0) { days[i] = { type: 'rest', label: 'Rest', distanceMi: null, paceTarget: null, strength: !!d.strength }; continue; }
    const cur = Number(d.distanceMi) || 0;
    // A tempo two days before a half is a hard session inside the taper, and shortening
    // it does not make it easy — so the KIND changes as well as the number. An easy run
    // already under the cap is left completely alone; this only ever takes away.
    if (d.type === 'easy_run') { if (cur > cap) days[i] = { ...d, distanceMi: cap }; continue; }
    days[i] = mkEasy(cur > 0 ? Math.min(cur, cap) : cap, d);
  }
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
// totalWeeklyMiles, raceMi, longRunTargetMi, longRunIsRace, why, tuneUp, days}], summary }.
// targetWeeklyMiles = training volume (the ramp line, race excluded); totalWeeklyMiles =
// what you actually cover, race included. See the note at the weeks.push below. Pure.
export function generateSeasonBlock(opts = {}) {
  const races = opts.races || [];
  const today = opts.today || ymd();
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
    // maxRampPct is threaded, not defaulted here — resolveSeasonPlan falls back to the
    // 10% rule when it is absent, so passing undefined is exactly the old behaviour.
    // core/planTiers.js supplies a different step per triad rung; that is the ONLY
    // difference between the three blocks it generates, which is what makes them
    // comparable week-for-week instead of three unrelated plans.
    const sp = resolveSeasonPlan({ races, today: monday, weeklyMiles, longestRecentMi: longMi, acwr: opts.acwr, ceilingMiles: opts.ceilingMiles, aRaceDate, maxRampPct: opts.maxRampPct });
    const wkRaces = racesInWeek(races, monday);
    // A-race (goal) → full taper/race-week. A non-A marathon in an A-race block is a
    // SUPPORTED effort: placed in a build week, it replaces that week's long run but the
    // build keeps climbing (no race-week/recovery reset). No A-race → any marathon tapers.
    const wkARace = aRaceDate ? (wkRaces.find(r => r.date === aRaceDate) || null) : (wkRaces.find(isMarathon) || null);
    const wkSupport = wkRaces.find(r => isMarathon(r) && r !== wkARace) || null;
    const phase = wkARace ? 'race-week' : sp.phase;

    // ── THE RACE-LENGTH RULE (Emil, 2026-07) ─────────────────────────────────────────
    //   1. "Races that are less than a half marathon should be treated as just part of
    //       the scheduled plan as runs for that day. Races should count towards the
    //       total mileage of the week in all times."
    //   2. "On weeks when there is a race and is a half marathon or longer, that race
    //       will automatically be used as a long run for the week."
    //
    // What this replaces: EVERY race in a build week used to drop the long run and trim
    // the week to a single quality session, because the only question the code asked was
    // "is there a race in this week". So the Harlem 5K deleted a 10-mile long run, the
    // 5th Avenue Mile deleted an 8-mile one, and a one-mile road race cost the same as a
    // marathon. There is no coaching answer to that — a 5K is a hard session, not a week.
    const raceMiOf = (r) => Number(r && r.distanceMi) || 0;
    // The longest race in the week decides the week's shape. Sorting matters only in the
    // (rare) week that carries two: a half on Saturday and a parkrun on Sunday is a half
    // marathon week, not a parkrun week.
    const wkLongRace = wkRaces.filter(r => raceMiOf(r) >= HALF_MIN_MI)
      .sort((a, b) => raceMiOf(b) - raceMiOf(a))[0] || null;
    const wkRaceMi = wkRaces.reduce((t, r) => t + raceMiOf(r), 0);
    // Days the calendar has already spent. A race day is not a slot the generator may
    // also drop an easy run onto, and its miles are not miles the week still has to find.
    const raceDows = new Set(wkRaces.map(r => dowOf(r.date)).filter(d => d >= 0));

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
    // so the legs absorb 26.2 mi of eccentric load before the build resumes.
    //
    // CORRECTED 2026-07 — this comment used to claim "the ramp is NOT reset; `weeklyMiles`
    // keeps threading up the build line, so this is a DIP, not a restart." That is not what
    // the code does and has not been for some time: the threaded line is frozen across the
    // race and recovery weeks and then RE-ANCHORED at the re-entry-capped resume value (see
    // `progressing` at the bottom of the loop). The code is right and the comment was wrong —
    // returning straight to the pre-race line is exactly the ACWR spike the re-entry guard
    // exists to prevent. Each non-A marathon therefore costs the build its race week, its
    // recovery week, and a short re-climb.
    //
    // MEASURED 2026-07-25 — and then RE-MEASURED, because the first two versions of this note
    // both guessed, and both guessed wrong, in opposite directions.
    //
    //   v1 claimed the two supported marathons "consume the entire back half of the build".
    //   v2 claimed they "cost this build essentially nothing" — on a sweep that held the
    //      ceiling at 44, so the with-races and without-races runs BOTH hit 44 and it was the
    //      CAP, not the race handling, that made them equal. Measurement error, not a finding.
    //
    // The corrected sweep (base = rampBaseMi = 14.8 mi/wk, ceiling 51, Valencia 2026-12-06,
    // 20 weeks — /tmp/sens2.mjs):
    //
    //     all races ………………………… peak 35  long 15
    //     tune-ups removed ………… peak 35  long 15     (5K / mile / 10M / half cost nothing)
    //     Berlin + NYC removed … peak 51  long 20
    //
    // BOTH constraints are real and they compound. Where the ramp STARTS sets what it can
    // reach in the weeks available (base 12.2 → 29, 14.8 → 35, 17 → 43, 19.3 → 46, 22 → 51),
    // and each SUPPORTED MARATHON then subtracts its race week, its recovery week, and the
    // re-climb from the re-entry-capped resume value.
    //
    // v4, and the reason this note is worth reading: EVERY SWEEP ABOVE HELD THE RAMP AT 10%.
    // "Racing Berlin and NYC costs sixteen mi/wk of peak" is therefore not a fact about
    // races — it is a fact about MAX_RAMP_PCT. With ~12 progressing weeks surviving the two
    // race weeks, their recoveries, the cut-backs and the taper, 14.8 × 1.10¹² = 35 and
    // stops, BELOW every ceiling on the ladder, which is exactly why raising the tier
    // selection changed nothing and Emil reported the peak refusing to move (/tmp/rampsweep.mjs):
    //
    //     ramp \ ceiling   36   41   42   44   48   51
    //       10%            35   35   35   35   35   35   ← the reported bug: ceiling never binds
    //       12%            36   41   42   44   45   45
    //       15%            36   41   42   44   48   51   ← every option reached
    //
    // Deleting races buys back progressing weeks; climbing faster buys back compounding.
    // The second is the cheap one. Solved minimum ramps for each rung of Emil's real
    // ladder, WITH all three marathons kept (/tmp/solve.mjs, /tmp/triad.mjs §2):
    // 36→10.5%, 41→11.5%, 42→11.5%, 44→12.0%, 48→13.0%, 51→14.1% — steady-state ACWR
    // 1.15 … 1.21, every one of them inside the 0.8–1.3 sweet zone this codebase already
    // enforces. So the honest statement is NOT "give up a marathon to reach sub-3:40";
    // it is "climb at ~12%/wk instead of 10%". The race cost is real but it is the price
    // of a FIXED ramp, and the ramp is a parameter now — see maxRampPct below and
    // core/planTiers.js, which sets it from the goal instead of capping the goal by it.
    // The race weeks themselves are still a true, stated cost (see the delivery check in
    // LivingPlan.jsx) and must never be hidden by quietly shortening a recovery. Only the
    // tune-up races are free.
    const weekAgoKey = addDaysKey(monday, -7);
    const priorMarathon = races.find(r => isMarathon(r) && r.date && r.date < monday && r.date >= weekAgoKey);
    const postRace = !!priorMarathon && !wkMarathon && phase === 'build';
    if (postRace) { effTarget = Math.round(weeklyMiles * 0.6); effLong = Math.min(effLong, 10); }

    // ACWR re-entry guard — coming OUT of a DEEP dip (a race or a post-race recovery week,
    // ~40% down), the 4-week chronic load is depressed, so jumping straight back onto the
    // build line spikes
    // the acute:chronic ratio (the plan-acceptance harness caught ~0.5% of resumes over the
    // 1.5 injury-danger line, up to 1.88). Cap the FIRST build week after a dip to a safe
    // step over the dip week so the return RAMPS across a week instead of leaping. This cap
    // also flows into the threaded ramp below (weeklyMiles = effTarget), so the following
    // weeks build up FROM the capped level rather than snapping to the pre-dip line.
    const _prevWk = weeks[weeks.length - 1];
    // Only a DEEP dip (a marathon week or a post-marathon recovery, ~40% down) depresses the
    // 4-week chronic enough to spike ACWR on return. A routine deload (~20% down) does not,
    // so it rebounds normally — capping it too would needlessly flatten the build.
    //
    // This used to test `_prevWk.raceName`, which is set for ANY race in the week — a parkrun,
    // a 5K, the 5th Ave Mile. Those weeks are NOT trimmed (only `wkMarathon` triggers the ~40%
    // cut), so a tune-up race was handing the following build week a re-entry cap it had done
    // nothing to earn: the ramp flattened after every little race on the calendar. The week
    // now states outright whether it was deeply cut (`deepDip`, written below), so the guard
    // reads a fact instead of inferring one from the presence of a race name.
    const _prevDip = _prevWk && (_prevWk.deepDip || _prevWk.recoveryAfterRace);
    const _isResume = phase === 'build' && !cutback && !wkMarathon && !postRace && _prevDip && (_prevWk.targetWeeklyMiles > 0);
    if (_isResume) effTarget = Math.min(effTarget, Math.round(_prevWk.targetWeeklyMiles * 1.4));

    // Long run must stay a sane SHARE of the week — a 20-mi long run inside a 39-mi week is
    // >50% of the load, an injury flag the plan-acceptance harness caught across the whole
    // population. Cap the long run at ~42% of the FINAL week target (after the re-entry cap
    // above) so it SCALES with weekly volume (0.42 is the same goal anchor
    // volumeModel.goalRequirements uses: longRun ≈ peak × 0.42). Low-volume weeks never
    // carry an outsized long run.
    if (effTarget > 0 && effLong > 0) effLong = Math.min(effLong, Math.round(effTarget * 0.42));

    // ── THE RACE'S MILES ARE THE WEEK'S MILES ────────────────────────────────────────
    // Emil: "Races should count towards the total mileage of the week in all times."
    // For anything short of a marathon the week stays on its ramp line and the race is
    // CARVED OUT of it — the remaining days are sized from what is left, so a 5K spends
    // 3.1 of the week's budget instead of being bolted on top of a full week (which is
    // how a "20-mile" week quietly became a 23-mile one). A marathon week is the one
    // exception: effTarget there is already the ~40% mini-taper AROUND the race, and
    // subtracting 26.2 from it would leave nothing but the marathon itself.
    const trainingBudget = wkMarathon ? effTarget : Math.max(0, effTarget - wkRaceMi);
    const availAll = (Array.isArray(base.availableDays) && base.availableDays.length) ? base.availableDays : [0, 1, 2, 3, 4, 5, 6];
    const availForWeek = availAll.filter(d => !raceDows.has(d));
    const runDaysForWeek = base.runDays != null ? Math.max(1, base.runDays - raceDows.size) : base.runDays;

    const gen = generateWeeklyPlan({
      ...base,
      // Fall back to the untouched list if the races somehow consumed every training day —
      // placeRace overwrites those slots anyway, so an empty list would only starve the
      // generator of somewhere to put the rest of the week.
      availableDays: availForWeek.length ? availForWeek : availAll,
      runDays: runDaysForWeek,
      weeklyMileageTarget: trainingBudget,
      qualityLead,
    });
    const days = gen.days;

    // Place EVERY race on the calendar. The old code picked exactly one per week
    // (wkSupport ?? wkRaces[0]) and silently dropped any others.
    for (const r of wkRaces) placeRace(days, r);

    if (phase === 'build') {
      if (wkMarathon) {
        // A supported marathon inside the build: easy running only around it, and the
        // marathon IS the long run — so the run the generator drew keeps its miles and
        // loses the designation rather than being deleted.
        downgradeQualityToEasy(days); demoteLongRunToEasy(days);
      } else if (wkLongRace) {
        // RULE 2 — half marathon or longer. The race becomes this week's long run. The
        // week keeps its quality: a half is a hard effort you run THROUGH a build, and
        // stripping the week around it was what turned the Staten Island Half week into
        // a 5-mile-long-run week.
        demoteLongRunToEasy(days);
      } else if (postRace) {
        downgradeQualityToEasy(days);            // post-marathon recovery: easy running only
        setLongRunDistance(days, effLong);        // long capped short (≤10) by effLong above
      } else {
        // RULE 1 — a race shorter than a half is simply that day's run. The long run
        // stands at its season target, both quality sessions stay, nothing is taken away.
        setLongRunDistance(days, effLong);
      }
    } else if (phase === 'mini-taper') {
      dropLongRun(days); trimToOneQuality(days);
    } else if (phase === 'recovery') {
      downgradeQualityToEasy(days); setLongRunDistance(days, effLong);
    } else if (phase === 'race-week') {
      downgradeQualityToEasy(days); demoteLongRunToEasy(days);
    }

    // Last, after every branch above has decided what the week contains — because this
    // is the one rule that outranks all of them. Whatever shape the week took, nothing
    // big goes in the 48 hours either side of a half or a marathon.
    taperIntoLongRaces(days, wkRaces);

    // What the week's long effort actually IS. A week containing a half marathon used to
    // report longRunTargetMi 0, which reads as "no long run this week" on the one week
    // that has the longest run in it. Reporting the race here is the same statement the
    // code has been making in comments since the continuous model was written — "the
    // marathon itself IS that week's long run" — finally made true in the data.
    const longRunIsRace = !!(wkMarathon || wkLongRace);
    if (longRunIsRace) effLong = raceMiOf(wkMarathon || wkLongRace);
    // Injury protection — selectively ease the sessions a logged niggle aggravates,
    // AFTER the phase logic has shaped the week (so we ease what's actually there).
    const injuryProtected = opts.injury ? protectInjuredDays(days, opts.injury) : false;
    relabelSeason(days);

    const injNote = injuryProtected
      ? ` · Protecting your ${(INJURY_LIBRARY[opts.injury]?.label || 'injury').toLowerCase()} — the sessions that aggravate it are eased to aerobic.`
      : '';
    // ── THE TWO WEEKLY NUMBERS, AND WHY THERE ARE TWO ────────────────────────────────
    // targetWeeklyMiles is the TRAINING line — the number the ramp reasons with, the one
    // solveRampForPeak reads to find a peak and the one the ACWR/ceiling invariants are
    // written against. It deliberately excludes the race, because a marathon you signed
    // up for is not evidence that your training volume climbed 80% in a week.
    // totalWeeklyMiles is what you will actually cover, race included. That is the number
    // an athlete means by "how far am I running this week", and the number the tier tiles
    // already sum from the days — so publishing it here makes the two agree instead of
    // leaving the card saying 20 while the days say 39. Two names, one arithmetic each;
    // collapsing them into one field is exactly how a plan starts lying in one direction
    // to stay honest in the other.
    const totalWeeklyMiles = sumDayMiles(days);
    weeks.push({ weekKey: monday, phase, verdict: postRace ? 'recover' : (cutback ? 'cut' : sp.verdict), targetWeeklyMiles: effTarget, totalWeeklyMiles, raceMi: Math.round(wkRaceMi * 10) / 10, longRunTargetMi: effLong, longRunIsRace, why: (postRace ? `Recovery week after ${priorMarathon.name} — easy aerobic only, no quality; let the legs absorb the marathon before the build resumes.` : (cutback ? `Cut-back week — ~20% down to absorb the last block; adaptation happens on the easier weeks.` : sp.why)) + injNote + (wkRaceMi > 0 ? ` · ${longRunIsRace ? `${(wkARace || wkSupport || wkLongRace).name} is this week's long run` : `${wkRaces.map(r => r.name).join(' + ')} counts inside the week — the long run stands`}, week totals ${Math.round(totalWeeklyMiles)} mi with the race in it.` : ''), tuneUp: sp.tuneUp || null, raceName: (wkARace || wkSupport || wkLongRace || wkRaces[0])?.name || null, isARace: !!wkARace, cutback, recoveryAfterRace: postRace, deepDip: !!wkMarathon || postRace, injuryProtected, days });

    // Thread the ramp — but PAUSE it across every non-build week (race, post-race
    // recovery, deload). The old code advanced the underlying line every week even while
    // the DISPLAYED week was reduced, so after a race/deload the plan snapped back to a
    // line it had never actually trained (22 → 36 → 48 in one jump — Emil's whiplash).
    // Freezing on non-build weeks means the next build week resumes from the volume you
    // REALLY reached, so the athlete-visible progression stays a smooth ≤10% staircase and
    // the race dips are true notches, not detours around an invisible climb.
    // Advance from the ACTUAL prescribed target (effTarget), not the raw ramp line — so a
    // re-entry-capped resume week builds the next weeks up FROM the capped level instead of
    // the plan snapping back to the uncapped line the week after (which re-introduced the
    // very jump the cap was meant to remove). On an ordinary build week effTarget === the
    // ramp line, so this is a no-op there.
    const progressing = phase === 'build' && !cutback && !wkMarathon && !postRace;
    if (progressing) {
      weeklyMiles = effTarget;
      longMi = Math.max(longMi, sp.longRunTargetMi || longMi);
    }
  }
  return { weeks, summary: { nWeeks, startMonday, horizon: opts.horizon ?? 8 } };
}

// Joint-safe cross-training the athlete swaps a run FOR (usually to protect a knee/shin).
// A hand-edited future day in one of these is an intentional injury choice, so the living
// re-sync PRESERVES it even while it re-baselines everything else around it.
const CROSS_TRAIN_TYPES = new Set(['bike', 'cycle', 'pool', 'swim', 'elliptical', 'rower', 'row', 'gym', 'cross', 'crosstrain', 'xtrain', 'treadmill']);

// Paste a season block into the planner (store = {get,set}). Modes:
//   'fill-empty' (default) — PROTECTS hand-edited days (writes empty/rest or previously-
//                            generated days only). Good for a first apply.
//   'overwrite'            — replaces everything in range (the explicit "regenerate" button).
//   'refresh'              — the LIVING re-sync. Re-baselines FUTURE machine days to the
//                            fresh block so the calendar tracks the plan, while (a) never
//                            touching a day in the PAST (history is history) and (b) keeping
//                            a future hand-edited cross-train swap (your knee choice). This
//                            is what lets the plan re-calibrate forward without a "shock",
//                            and without clobbering what you've already done or deliberately
//                            offloaded. Pass opts.today ('YYYY-MM-DD').
// Returns { written, resynced }.
export function pasteSeasonBlock(store, weeks, opts = {}) {
  const mode = opts.mode || 'fill-empty';
  const today = opts.today || ymd();
  const planner = (store && typeof store.get === 'function' && store.get('planner')) || {};
  let written = 0, resynced = 0;
  for (const wk of weeks || []) {
    const existing = planner[wk.weekKey] || { days: Array(7).fill(null).map(() => ({ type: 'rest' })) };
    const exDays = existing.days || [];
    const mergedDays = (wk.days || []).map((gd, i) => {
      const ex = exDays[i];
      const exEdited = ex && ex.type && ex.type !== 'rest' && !ex.generated;   // user hand-edited
      if (mode === 'fill-empty' && exEdited) return ex;                        // don't clobber it
      if (mode === 'refresh') {
        const dayDate = addDaysKey(wk.weekKey, i);
        if (dayDate < today) return ex || { type: 'rest' };                    // PAST — never rewrite history
        if (exEdited && CROSS_TRAIN_TYPES.has(String(ex.type).toLowerCase())) return ex;  // keep a knee cross-swap
        if (ex && !ex.generated && ex.type && ex.type !== 'rest') resynced++;  // count a stale hand-edit we re-baseline
      }
      return gd ? { ...gd, generated: true } : { type: 'rest', generated: true };
    });
    planner[wk.weekKey] = { ...existing, weekStart: wk.weekKey, days: mergedDays, generated: true, generatedAt: new Date().toISOString(), phase: wk.phase };
    written++;
  }
  if (store && typeof store.set === 'function') store.set('planner', planner);
  return { written, resynced };
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
  const today = opts.today || ymd();
  const key = opts.mondayKey || mondayKeyOf(today);
  const plan = generateWeeklyPlan(opts);
  const planner = (store && typeof store.get === 'function' && store.get('planner')) || {};
  planner[key] = { days: plan.days, generated: true, generatedAt: new Date().toISOString() };
  if (store && typeof store.set === 'function') store.set('planner', planner);
  return { plan, key };
}
