// Hub core — PLAN GENERATOR. The "Coaching Team proposes your training" step: given
// how you want to train (run days/week, strength/week, focus) AND — critically —
// which days you can ACTUALLY train (availableDays), plus what the hub knows (your
// race paces, weekly volume), it lays out a 7-day week that fits your real schedule.
// Sessions only land on available days; when days are scarce it doubles (run +
// strength) and notes the compromise. Re-run any time with new availableDays to
// reshape the week — schedules change, the plan flexes. Output is the app's planner
// shape ({ days:[Mon..Sun] }, each a planner day object or null=rest). Pure + tested.

// Mon=0 .. Sun=6.
const DEFAULT_LONG_DOW = 5;             // Saturday (only used as a hint)
const MI_PER_KM = 1 / 1.60934;

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

// Derive easy/long/tempo/interval paces (sec/mi) from the hub's 10K prediction.
export function pacesFromHubFacts(facts) {
  const tenK = (facts && facts.predictions || []).find(p => p.dist === '10K');
  if (!tenK || !(tenK.secs > 0)) return null;
  const p10k = tenK.secs / (10 * MI_PER_KM);
  return {
    interval: Math.round(p10k - 15),
    tempo: Math.round(p10k + 25),
    long: Math.round(p10k + 95),
    easy: Math.round(p10k + 110),
  };
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
  const qPref = [1, 3, 2, 4, 0, 5, 6];
  let qi = 0;
  for (const s of qPref) { if (qi >= quality) break; if (runSlots.includes(s) && !days[s] && !adjacent(s)) { days[s] = mkRun(qi === 0 ? 'intervals' : 'tempo', qualityMi); placedHard.add(s); qi++; } }
  for (const s of qPref) { if (qi >= quality) break; if (runSlots.includes(s) && !days[s]) { days[s] = mkRun(qi === 0 ? 'intervals' : 'tempo', qualityMi); placedHard.add(s); qi++; } }

  // ── Easy runs → remaining available run days. ──
  let ei = 0;
  for (const s of runSlots) { if (ei >= easyCount) break; if (!days[s]) { days[s] = mkRun('easy_run', easyMi); ei++; } }

  // ── Strength → easy-day doubles, then pure on empty available days, then (only when
  // your schedule is too tight to avoid it) doubled onto any available run day. ──
  const isHardOrLong = d => d && (d.type === 'intervals' || d.type === 'tempo' || d.type === 'long_run');
  let stc = 0, strengthOnHard = false;
  for (const s of avail) { if (stc >= strengthWanted) break; if (days[s] && days[s].type === 'easy_run' && !days[s].strength) { days[s].strength = true; stc++; } }
  for (const s of avail) { if (stc >= strengthWanted) break; if (!days[s]) { days[s] = { type: 'strength', label: 'Strength', strength: true, distanceMi: null, paceTarget: null }; stc++; } }
  for (const s of avail) { if (stc >= strengthWanted) break; if (days[s] && days[s].type !== 'strength' && !days[s].strength) { days[s].strength = true; stc++; if (isHardOrLong(days[s])) strengthOnHard = true; } }

  // ── Labels (note doubles + pace/distance). ──
  for (let i = 0; i < 7; i++) {
    const d = days[i];
    if (!d || d.type === 'strength') continue;
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
