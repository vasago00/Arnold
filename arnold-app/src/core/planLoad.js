// Plan-load read (Emil 2026-06-17, reworked): the coaching team watches the
// CALENDAR and judges the week by LOAD vs RECOVERY vs the running goal — NOT by
// "is every day filled". Key corrections: mobility/walk days are RECOVERY (not
// load, not "no rest"); and a week UNDER the mileage goal can never be "heavy".
// Pure (no storage/DOM) so it's node-testable and can feed any surface.
import { daySessions, dayRunMiles } from './planner.js';

const QUALITY  = new Set(['tempo', 'intervals', 'hiit', 'race']); // high intensity
const LONG     = new Set(['long_run']);                            // key long run
const STRENGTH = new Set(['strength']);
const RECOVERY = new Set(['mobility', 'walk']);                    // pure recovery

export function classifySession(type) {
  if (QUALITY.has(type)) return 'quality';
  if (LONG.has(type)) return 'long';
  if (STRENGTH.has(type)) return 'strength';
  if (RECOVERY.has(type)) return 'recovery';
  return 'easy'; // easy_run / cross / cycle / swim / ski
}

// Classify a whole day by its hardest signal.
function classifyDay(sessions) {
  if (!sessions.length) return 'rest';
  const kinds = sessions.map(s => classifySession(s.type));
  if (kinds.some(k => k === 'quality')) return 'quality';
  if (kinds.some(k => k === 'long')) return 'long';
  if (kinds.every(k => k === 'recovery')) return 'recovery'; // mobility/walk only
  if (kinds.some(k => k === 'strength') && !kinds.some(k => k === 'easy')) return 'strength';
  return 'easy';
}

export function analyzePlannedWeek(week, opts = {}) {
  const days = week?.days || [];
  const goal = Number(opts.weeklyRunMilesGoal) > 0 ? Number(opts.weeklyRunMilesGoal) : null;

  let runMiles = 0, sessions = 0;
  let qualityDays = 0, longDays = 0, strengthDays = 0, easyDays = 0, recoveryDays = 0, restDays = 0;
  const kinds = [];
  for (const d of days) {
    const ss = daySessions(d);
    sessions += ss.length;
    runMiles += dayRunMiles(d);
    const k = classifyDay(ss);
    kinds.push(k);
    if (k === 'rest') restDays++;
    else if (k === 'recovery') recoveryDays++;
    else if (k === 'quality') qualityDays++;
    else if (k === 'long') longDays++;
    else if (k === 'strength') strengthDays++;
    else easyDays++;
  }
  // Recovery includes pure-rest days AND mobility/walk-only days.
  const totalRecovery = restDays + recoveryDays;
  const hardDays = qualityDays + longDays;
  const milesRatio = goal ? runMiles / goal : null;

  // Consecutive HARD days with no easy/recovery/rest between (true stacking).
  let stacked = 0;
  for (let i = 1; i < kinds.length; i++) {
    const a = kinds[i], b = kinds[i - 1];
    if ((a === 'quality' || a === 'long') && (b === 'quality' || b === 'long')) stacked++;
  }

  // Is there real training load to recover from?
  const hasLoad = (milesRatio == null ? sessions >= 4 : milesRatio >= 0.9) || hardDays >= 2;
  const loadHigh = (milesRatio != null && milesRatio > 1.2) || hardDays >= 4 || stacked >= 2;
  const loadLow  = (milesRatio != null && milesRatio < 0.7) && hardDays <= 1;
  const recoveryLow = totalRecovery === 0 && hasLoad; // only meaningful when there's load

  const flags = [];
  if (milesRatio != null && milesRatio > 1.2) flags.push('over-goal');
  if (milesRatio != null && milesRatio < 0.7) flags.push('under-goal');
  if (hardDays >= 4) flags.push('intensity-high');
  if (stacked >= 2) flags.push('hard-stacked');
  if (recoveryLow) flags.push('low-recovery');
  if (hardDays === 0 && sessions >= 3 && (milesRatio == null || milesRatio >= 0.8)) flags.push('no-quality');
  if (sessions <= 2 && (milesRatio == null || milesRatio < 0.8)) flags.push('low-volume');

  let verdict, tone;
  if (loadHigh || recoveryLow) { verdict = 'heavy'; tone = 'warn'; }
  else if (loadLow || flags.includes('low-volume')) { verdict = 'light'; tone = 'warn'; }
  else if (flags.includes('no-quality')) { verdict = 'imbalanced'; tone = 'neutral'; }
  else { verdict = 'balanced'; tone = 'good'; }

  const mi = Math.round(runMiles * 10) / 10;
  const goalStr = goal ? `/${goal}` : '';
  let message;
  if (verdict === 'heavy') {
    const why = flags.includes('hard-stacked') ? `hard sessions are back-to-back`
      : flags.includes('over-goal') ? `${mi} mi is well over your ${goal} target`
      : flags.includes('intensity-high') ? `${hardDays} hard days is a lot`
      : `there's no recovery day against this load`;
    const fix = flags.includes('low-recovery') || totalRecovery === 0 ? `add a rest or mobility day`
      : flags.includes('hard-stacked') ? `put an easy day between the hard ones`
      : `ease one day back`;
    message = `This week is running heavy — ${why}. ${fix.charAt(0).toUpperCase() + fix.slice(1)}.`;
  } else if (verdict === 'light') {
    message = `Light on running — ${mi}${goalStr} mi across ${sessions} session${sessions === 1 ? '' : 's'}` +
      `${totalRecovery >= 3 ? ` with ${totalRecovery} recovery days` : ''}. Room to add miles or a quality session.`;
  } else if (verdict === 'imbalanced') {
    message = `Volume's there but it's all easy — add a tempo or interval session to drive fitness.`;
  } else {
    message = `Looks balanced — ${sessions} sessions, ${mi}${goalStr} mi, ${totalRecovery} recovery day${totalRecovery === 1 ? '' : 's'}. Hold it.`;
  }

  return { verdict, tone, message, runMiles: mi, milesGoal: goal, milesRatio,
    sessions, qualityDays, longDays, hardDays, strengthDays, easyDays, recoveryDays, restDays,
    totalRecovery, stacked, flags };
}

// Season read (Emil 2026-06-17): the coach looks ACROSS weeks + toward races —
// missed-goal streaks, empty weeks ahead, the next race — not just one tidy week.
// weeks: [{ start, end, actual, planned }] in calendar order (YYYY-MM-DD bounds).
// races: [{ name, date, distanceMi }]. Returns { tone, message, behind, ... }.
export function analyzeSeason(weeks, opts = {}) {
  const goal = Number(opts.weeklyRunMilesGoal) > 0 ? Number(opts.weeklyRunMilesGoal) : null;
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const races = (opts.races || [])
    .filter(r => r && r.date && r.date >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const ws = weeks || [];
  if (!ws.length || !goal) return null;

  let cur = ws.findIndex(w => w.start <= today && today <= w.end);
  if (cur < 0) cur = ws.reduce((acc, w, i) => (w.start <= today ? i : acc), 0);

  // Missed-goal streak: from the current week backward, consecutive weeks whose
  // ACTUAL run miles fell short of the goal (only weeks that have started).
  let missed = 0;
  for (let i = cur; i >= 0; i--) {
    if (ws[i].actual < goal * 0.9) missed++; else break;
  }
  // Empty weeks ahead: upcoming weeks with nothing run AND nothing planned.
  let emptyAhead = 0;
  for (let i = cur + 1; i < ws.length; i++) {
    if ((ws[i].planned || 0) === 0 && (ws[i].actual || 0) === 0) emptyAhead++; else break;
  }

  const dOut = r => Math.round((new Date(r.date + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
  const withDays = races.map(r => ({ ...r, daysOut: dOut(r) }));
  const next = withDays[0] || null;
  // A race within ~10 days is TAPER — you can't (and shouldn't) build base for it.
  const imminent = next && next.daysOut <= 10 ? next : null;
  // "Build volume" only makes sense toward a race far enough out to train for.
  const goalRace = withDays.find(r => r.daysOut > 21) || null;
  const wks = d => Math.max(1, Math.round(d / 7));

  const behind = missed >= 2 || emptyAhead >= 2;
  const volParts = [];
  if (missed >= 2) volParts.push(`you've come in under your ${goal}-mile week ${missed} weeks running`);
  else if (missed === 1) volParts.push(`last week landed under your ${goal}-mile goal`);
  if (emptyAhead >= 2) volParts.push(`the next ${emptyAhead} weeks have nothing scheduled`);
  else if (emptyAhead === 1) volParts.push(`next week has nothing scheduled yet`);
  const volLead = volParts.length ? volParts.join('; ') : null;

  let message, tone = behind ? 'warn' : 'good', mode = 'trajectory';
  if (imminent) {
    // RACE WEEK — taper. Never "add base/volume now". (Emil 2026-06-17.)
    mode = 'taper'; tone = 'good';
    message = `${imminent.name} is ${imminent.daysOut} day${imminent.daysOut === 1 ? '' : 's'} out — taper week: hold your volume, keep it easy, don't add load now.`;
    if (behind && goalRace) message += ` After it, rebuild toward ${goalRace.name} (${wks(goalRace.daysOut)} weeks out).`;
    else if (behind) message += ` Past race week, rebuild your weekly volume.`;
  } else if (volLead) {
    const fix = behind
      ? (goalRace ? `${goalRace.name} is ${wks(goalRace.daysOut)} weeks out — start rebuilding the volume now to be ready.` : `rebuild the weekly volume.`)
      : `keep the weeks filled in toward your races.`;
    message = `${volLead.charAt(0).toUpperCase() + volLead.slice(1)} — ${fix}`;
  } else if (goalRace) {
    message = `On track — ${goalRace.name} is ${wks(goalRace.daysOut)} weeks out; keep building.`;
  } else {
    message = `On track against your ${goal}-mile weeks.`;
  }
  return { tone, message, behind, mode, missedStreak: missed, emptyAhead,
    nextRace: next ? { name: next.name, date: next.date, daysOut: next.daysOut } : null,
    goalRace: goalRace ? { name: goalRace.name, daysOut: goalRace.daysOut } : null };
}
