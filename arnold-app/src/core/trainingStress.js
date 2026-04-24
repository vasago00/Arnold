// ─── ARNOLD Training Stress Engine ────────────────────────────────────────────
// Deterministic training load computation. Two models:
//   1. Running  → rTSS (pace-based, superior to HR-based for endurance)
//   2. Strength → Tonnage (weight × reps × sets, density = tonnage/min)
//   3. Hyrox   → Density (circuit work / time)
//
// Also: composite Readiness score from training load + recovery signals.

import { paceToSecs, secsToFmtPace } from './trainingIntelligence.js';
import { storage } from './storage.js';

// Local date helper (avoids UTC rollover — toISOString uses UTC, not local tz)
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
import { getGoals } from './goals.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert pace string "mm:ss" (per mile) to speed in miles/sec */
function paceToSpeed(paceStr) {
  const secs = paceToSecs(paceStr);
  if (!secs || secs <= 0) return null;
  return 1 / secs; // miles per second
}

/** Parse "3-4 x 10" → { sets: 4, reps: 10 }. Uses upper bound for ranges. */
export function parseSetsReps(str) {
  if (!str) return { sets: 0, reps: 0 };
  const s = String(str).trim().toLowerCase();
  // Match patterns: "3-4 x 10", "3x10", "4 x 5-8", "3-4 x 5-10"
  const m = s.match(/(\d+)(?:\s*-\s*(\d+))?\s*x\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (!m) return { sets: 0, reps: 0 };
  const sets = parseInt(m[2] || m[1]) || 0; // upper bound of set range
  const reps = parseInt(m[4] || m[3]) || 0; // upper bound of rep range
  return { sets, reps };
}

/** Parse weight string → number in lbs. "25lb" → 25, "bw" → 0, "35" → 35 */
export function parseWeight(str) {
  if (!str) return 0;
  const s = String(str).trim().toLowerCase();
  if (s === 'bw' || s === 'bodyweight' || s === 'body weight') return 0;
  const m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

/** Parse rep string that may contain "e/leg" or "/leg" notation */
function parseReps(repStr) {
  if (typeof repStr === 'number') return repStr;
  if (!repStr) return 0;
  const s = String(repStr).trim();
  const m = s.match(/(\d+)/);
  const base = m ? parseInt(m[1]) : 0;
  // "10e/leg" or "5/leg" means each side — double it for total
  if (/e\/|\/leg|\/side|each/i.test(s)) return base * 2;
  return base;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. RUNNING: rTSS (Running Training Stress Score)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Compute rTSS for a single run.
 * Formula: rTSS = (T × NGP_speed × IF) / (FTP_speed × 3600) × 100
 *
 * @param {object} opts
 * @param {number} opts.durationSecs - total run time in seconds
 * @param {string} opts.avgPaceRaw   - average pace "mm:ss" per mile
 * @param {number} [opts.avgHR]      - average heart rate (for EF calc)
 * @param {string} opts.ftpPace      - functional threshold pace "mm:ss" per mile
 * @returns {{ rTSS, ngpPace, intensityFactor, efficiencyFactor }}
 */
export function computeRTSS({ durationSecs, avgPaceRaw, avgHR, ftpPace }) {
  const ngpSpeed = paceToSpeed(avgPaceRaw); // NGP ≈ avg pace (no elevation data)
  const ftpSpeed = paceToSpeed(ftpPace);
  if (!ngpSpeed || !ftpSpeed || !durationSecs) {
    return { rTSS: null, ngpPace: avgPaceRaw, intensityFactor: null, efficiencyFactor: null };
  }

  const IF = ngpSpeed / ftpSpeed; // Intensity Factor
  const rTSS = (durationSecs * ngpSpeed * IF) / (ftpSpeed * 3600) * 100;

  // Efficiency Factor: speed / HR (higher = more efficient)
  const ef = avgHR && avgHR > 0 ? (ngpSpeed * 3600 / avgHR) : null;

  return {
    rTSS: Math.round(rTSS * 10) / 10,
    ngpPace: avgPaceRaw,
    intensityFactor: Math.round(IF * 100) / 100,
    efficiencyFactor: ef ? Math.round(ef * 100) / 100 : null,
  };
}

/**
 * Compute acute (7-day) and chronic (28-day) training load + ratio.
 * @param {Array} activities - all activities from storage
 * @param {string} dateStr - reference date (usually today)
 * @param {string} ftpPace - FTP pace "mm:ss"
 * @returns {{ acuteLoad, chronicLoad, ratio, zone }}
 */
export function computeAcuteChronicRatio(activities, dateStr, ftpPace) {
  if (!activities?.length || !ftpPace) {
    return { acuteLoad: 0, chronicLoad: 0, ratio: null, zone: 'no_data' };
  }

  const ref = new Date(dateStr);
  const d7 = new Date(ref); d7.setDate(d7.getDate() - 7);
  const d28 = new Date(ref); d28.setDate(d28.getDate() - 28);
  const fmt = d => localDate(d);

  const runs = activities.filter(a =>
    /run/i.test(a.activityType || '') && a.avgPaceRaw && a.durationSecs
  );

  const sumTSS = (start, end) => {
    return runs
      .filter(r => r.date >= fmt(start) && r.date <= fmt(end))
      .reduce((sum, r) => {
        const { rTSS } = computeRTSS({
          durationSecs: r.durationSecs,
          avgPaceRaw: r.avgPaceRaw,
          ftpPace,
        });
        return sum + (rTSS || 0);
      }, 0);
  };

  const acuteLoad = sumTSS(d7, ref);
  const chronicWeekly = sumTSS(d28, ref) / 4; // average per week
  const ratio = chronicWeekly > 0 ? Math.round((acuteLoad / chronicWeekly) * 100) / 100 : null;

  let zone = 'no_data';
  if (ratio !== null) {
    if (ratio > 1.5) zone = 'danger';
    else if (ratio > 1.3) zone = 'overreaching';
    else if (ratio >= 0.8) zone = 'optimal';
    else zone = 'undertraining';
  }

  return {
    acuteLoad: Math.round(acuteLoad),
    chronicLoad: Math.round(chronicWeekly),
    ratio,
    zone,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. STRENGTH: Tonnage
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Compute tonnage from a strength template.
 * @param {object} template - { exercises: [{ name, sets, reps, weight }] }
 * @param {number} [overrideRounds] - if user did fewer/more rounds than prescribed
 * @param {number} [bodyweightLbs] - user's body weight for BW exercises
 * @returns {{ totalTonnage, exercises: [{name, sets, reps, weight, tonnage}] }}
 */
export function computeTonnage(template, overrideRounds, bodyweightLbs = 175) {
  if (!template?.exercises?.length) {
    return { totalTonnage: 0, exercises: [] };
  }

  const exercises = template.exercises.map(ex => {
    const sets = overrideRounds || ex.sets || 0;
    const reps = ex.reps || 0;
    const weight = ex.weight === 0 ? bodyweightLbs : (ex.weight || 0);
    const tonnage = weight * reps * sets;
    return { name: ex.name, sets, reps, weight, tonnage: Math.round(tonnage) };
  });

  const totalTonnage = exercises.reduce((s, e) => s + e.tonnage, 0);
  return { totalTonnage, exercises };
}

/**
 * Tonnage per minute (density metric).
 * @param {number} totalTonnage
 * @param {number} durationSecs
 * @returns {number|null}
 */
export function computeDensity(totalTonnage, durationSecs) {
  if (!totalTonnage || !durationSecs) return null;
  return Math.round(totalTonnage / (durationSecs / 60));
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. HYROX: Circuit density
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Compute Hyrox circuit density from template + Garmin duration.
 * @param {object} template - hyrox template with exercises
 * @param {number} durationSecs - total circuit time from Garmin
 * @param {number} [bodyweightLbs]
 * @returns {{ density, tonnage, durationMin }}
 */
export function computeHyroxDensity(template, durationSecs, bodyweightLbs = 175) {
  const { totalTonnage } = computeTonnage(template, null, bodyweightLbs);
  const durationMin = durationSecs ? Math.round(durationSecs / 60 * 10) / 10 : 0;
  const density = durationMin > 0 ? Math.round(totalTonnage / durationMin) : 0;
  return { density, tonnage: totalTonnage, durationMin };
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. TEMPLATE MATCHING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Match a Garmin activity to a stored strength template.
 * Matches by activity name/title containing "Day 1", "Day 2", "Hyrox", etc.
 * @param {object} activity - { activityType, activityName, title }
 * @param {Array} templates - stored templates
 * @returns {object|null} matched template
 */
export function matchTemplate(activity, templates) {
  if (!templates?.length || !activity) return null;

  const title = (activity.activityName || activity.title || activity.activityType || '').toLowerCase();

  // Direct name match
  for (const t of templates) {
    const tName = t.name.toLowerCase();
    if (title.includes(tName)) return t;
  }

  // Pattern matching: "strength day 1" → first strength template
  if (/day\s*1|week\s*1/i.test(title)) {
    return templates.find(t => t.type === 'strength' && /day\s*1|week\s*1/i.test(t.name)) || templates[0];
  }
  if (/day\s*2|week\s*2/i.test(title)) {
    return templates.find(t => t.type === 'strength' && /day\s*2|week\s*2/i.test(t.name)) || templates[1];
  }
  if (/hyrox|circuit/i.test(title)) {
    return templates.find(t => t.type === 'hyrox');
  }

  // Fall back: if it's a strength activity, return first strength template
  if (/strength/i.test(title)) {
    return templates.find(t => t.type === 'strength') || null;
  }

  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. XLSX TEMPLATE PARSER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Parse strength templates from uploaded xlsx workbook data.
 * Expects pre-read sheet data (arrays of row arrays), not raw binary.
 * @param {object} sheets - { sheetName: [[cell, cell, ...], ...] }
 * @returns {Array} templates ready for storage
 */
export function parseStrengthSheets(sheets) {
  const templates = [];

  // ── Parse "Strength Training- 2 Day" sheet ──
  const strengthSheet = sheets['Strength Training- 2 Day'] || sheets['Strength Training-2 Day'];
  if (strengthSheet) {
    let currentWeek = null;
    let exercises = [];

    for (const row of strengthSheet) {
      const a = row[0] ? String(row[0]).trim() : '';

      // Week header
      if (/^week\s*\d+/i.test(a)) {
        // Save previous week
        if (currentWeek && exercises.length) {
          templates.push({
            id: `strength-${currentWeek.toLowerCase().replace(/\s+/g, '-')}`,
            name: currentWeek === 'Week 1' ? 'Strength Day 1' : 'Strength Day 2',
            type: 'strength',
            exercises: [...exercises],
          });
        }
        currentWeek = a;
        exercises = [];
        continue;
      }

      // Exercise row: starts with letter prefix like "A. Front Rack Squat"
      if (/^[A-Z]\.\s/.test(a) && row[1]) {
        const name = a.replace(/^[A-Z]\.\s*/, '').trim();
        const { sets, reps } = parseSetsReps(row[1]);
        const weight = parseWeight(row[4]);
        exercises.push({
          name,
          sets,
          reps,
          weight,
          tempo: row[3] ? String(row[3]).trim() : '',
          rest: row[2] ? String(row[2]).trim() : '',
        });
      }

      // Stop at warm-up section
      if (/dynamic warm/i.test(a)) break;
    }

    // Save last week
    if (currentWeek && exercises.length) {
      templates.push({
        id: `strength-${currentWeek.toLowerCase().replace(/\s+/g, '-')}`,
        name: currentWeek === 'Week 1' ? 'Strength Day 1' : 'Strength Day 2',
        type: 'strength',
        exercises: [...exercises],
      });
    }
  }

  // ── Parse "Hyrox Training- Final Week" sheet ──
  const hyroxSheet = sheets['Hyrox Training- Final Week'] || sheets['Hyrox Training-Final Week'];
  if (hyroxSheet) {
    const exercises = [];
    // Hyrox has 3 rounds in columns [0-7], [9-16], [18-25]
    // Each round row: [round#, sprint, ex1, reps1, ex2, reps2, ex3, reps3]
    const circuitOffsets = [0, 9, 18];

    for (let ri = 2; ri < hyroxSheet.length; ri++) { // skip header rows
      const row = hyroxSheet[ri];
      if (!row) continue;
      const firstCell = row[0] ? String(row[0]).trim() : '';
      if (/post circuit|constantly/i.test(firstCell)) continue;
      if (!firstCell || isNaN(parseFloat(firstCell))) continue; // round number

      // Read from each circuit block
      for (const offset of circuitOffsets) {
        for (let ex = 0; ex < 3; ex++) {
          const nameIdx = offset + 2 + ex * 2;
          const repsIdx = offset + 3 + ex * 2;
          const name = row[nameIdx] ? String(row[nameIdx]).trim() : '';
          const reps = row[repsIdx];
          if (!name) continue;

          // Dedupe: if exercise already in list, accumulate reps
          const existing = exercises.find(e => e.name === name);
          const repCount = parseReps(reps);
          const weight = parseWeight(name); // extract weight from name like "Thruster-25lb"

          if (existing) {
            existing.reps += repCount;
            existing.sets++;
          } else {
            exercises.push({ name, sets: 1, reps: repCount, weight, tempo: '', rest: '' });
          }
        }
      }
    }

    if (exercises.length) {
      templates.push({
        id: 'hyrox-final-week',
        name: 'Hyrox Circuit',
        type: 'hyrox',
        exercises,
      });
    }
  }

  return templates;
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. DAILY SCORE — 3-Domain Composite
//    Activity (33%) · Nutrition (33%) · Body (33%)
//
//    Philosophy: every drop counts. Each factor is a positive deposit toward
//    the day's score. rTSS and Tonnage are DIRECT inputs — a quality session
//    fills the Activity bucket. Good food fills Nutrition. Good sleep fills
//    Body. A perfect day across all three = 100.
// ═════════════════════════════════════════════════════════════════════════════

// Per-factor weights WITHIN each domain (relative to each other).
const FACTOR_W = {
  // Activity — rTSS and Tonnage are the primary "did you do the work" signals
  rTSS:              3.0,   // today's running stress score (direct deposit)
  tonnage:           3.0,   // today's strength tonnage (direct deposit)
  acuteChronicRatio: 1.5,   // load balance guardrail (penalises extremes)
  consistency:       1.0,   // sessions this week vs goal

  // Nutrition
  protein:   3.0,   // protein adherence vs dynamic target
  calories:  2.0,   // calorie adherence vs target
  hydration: 1.0,   // water vs daily target

  // Body
  sleep:     3.0,   // sleep score (0-100)
  hrv:       2.5,   // HRV vs target
  restingHR: 1.5,   // resting HR vs target (lower is better)
};

// Benchmark targets for normalising rTSS and Tonnage to 0-1 scale.
// These represent a "solid session" — not a max effort, not a recovery jog.
// Exceeding the benchmark gives up to 1.2× credit (capped).
const RTSS_BENCHMARK    = 80;   // ~60min tempo run at ~0.9 IF
const TONNAGE_BENCHMARK = 10000; // good full-body strength session in lbs

/**
 * Compute Daily Score from real data pulled from storage.
 * Every factor is a positive deposit. Three equal domains averaged.
 *
 * @param {string} [dateStr] - reference date (YYYY-MM-DD)
 * @returns {{
 *   score: number,
 *   sessionType: 'run'|'strength'|'hyrox'|'rest'|'mixed',
 *   sessionMetric: { label: string, value: number|string } | null,
 *   domains: { activity: number|null, nutrition: number|null, body: number|null },
 *   factors: Array<{ label: string, value: string, status: string, domain: string }>
 * }}
 */
export function computeDailyScore(dateStr) {
  const goals = getGoals();
  const allActivities = storage.get('activities') || [];
  const dailyLogs = storage.get('dailyLogs') || [];
  const sleepData = storage.get('sleep') || [];
  const hrvData = storage.get('hrv') || [];
  const cronoData = storage.get('cronometer') || [];
  const nutritionLog = storage.get('nutritionLog') || [];
  const today = dateStr || localDate();

  // Merge CSV activities + daily FIT uploads into one list.
  // A day can have multiple FIT uploads (`fitActivities` array); fall back to legacy
  // singular `fitData` for older rows so both shapes are handled.
  const fitActs = [];
  for (const l of dailyLogs) {
    if (!l?.date) continue;
    const fits = Array.isArray(l.fitActivities) && l.fitActivities.length
      ? l.fitActivities
      : (l.fitData ? [l.fitData] : []);
    for (const fd of fits) {
      if (fd) fitActs.push({ ...fd, date: l.date, source: 'daily_fit' });
    }
  }
  const activities = [...allActivities.filter(a => a.source !== 'health_connect'), ...fitActs];

  const buckets = { activity: [], nutrition: [], body: [] };
  const factors = [];

  // ─── helper ──
  const lastNDays = (n) => {
    const days = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - i);
      days.push(localDate(d));
    }
    return days;
  };

  // ─── Identify today's sessions ──
  const todayActs = activities.filter(a => a.date === today);
  const todayRuns = todayActs.filter(a => /run/i.test(a.activityType || ''));
  const todayStrength = todayActs.filter(a => /strength|weight|gym/i.test(a.activityType || ''));
  const todayHyrox = todayActs.filter(a => /hyrox|circuit/i.test(a.activityType || a.activityName || ''));
  const ftpPace = goals.functionalThresholdPace || '8:30';
  const bodyweight = parseFloat(goals.targetWeight) || parseFloat(goals.weight) || 175;

  // Track session type and primary metric for the label
  let sessionType = 'rest';
  let sessionMetric = null;

  // ═══ ACTIVITY DOMAIN ═══════════════════════════════════════════════════════

  // ── rTSS (direct deposit from today's run) ──
  if (todayRuns.length > 0) {
    // Sum rTSS across all runs today (some days have doubles)
    let totalRTSS = 0;
    for (const run of todayRuns) {
      const { rTSS } = computeRTSS({
        durationSecs: run.durationSecs,
        avgPaceRaw: run.avgPaceRaw,
        avgHR: run.avgHeartRate || run.avgHR,
        ftpPace,
      });
      totalRTSS += (rTSS || 0);
    }
    if (totalRTSS > 0) {
      const val = Math.min(totalRTSS / RTSS_BENCHMARK, 1.2);
      buckets.activity.push({ val, w: FACTOR_W.rTSS });
      factors.push({
        label: 'rTSS', value: `${Math.round(totalRTSS * 10) / 10}`, domain: 'activity',
        status: val >= 0.8 ? 'good' : val >= 0.5 ? 'warning' : 'poor',
      });
      sessionType = 'run';
      sessionMetric = { label: 'rTSS', value: Math.round(totalRTSS * 10) / 10 };
    }
  }

  // ── Tonnage (direct deposit from today's strength/hyrox) ──
  const templates = storage.get('strengthTemplates') || [];
  const strengthOrHyrox = [...todayHyrox, ...todayStrength];
  if (strengthOrHyrox.length > 0) {
    let totalTonnage = 0;
    let isHyrox = false;
    for (const act of strengthOrHyrox) {
      const tpl = matchTemplate(act, templates);
      if (tpl) {
        const { totalTonnage: t } = computeTonnage(tpl, null, bodyweight);
        totalTonnage += t;
        if (tpl.type === 'hyrox') isHyrox = true;
      }
    }
    if (totalTonnage > 0) {
      const val = Math.min(totalTonnage / TONNAGE_BENCHMARK, 1.2);
      buckets.activity.push({ val, w: FACTOR_W.tonnage });
      factors.push({
        label: 'Tonnage', value: `${totalTonnage.toLocaleString()} lbs`, domain: 'activity',
        status: val >= 0.8 ? 'good' : val >= 0.5 ? 'warning' : 'poor',
      });
      if (sessionType === 'run') sessionType = 'mixed';
      else sessionType = isHyrox ? 'hyrox' : 'strength';
      // Primary metric: tonnage for strength, rTSS takes priority for mixed
      if (!sessionMetric) {
        sessionMetric = { label: 'Tonnage', value: `${totalTonnage.toLocaleString()}` };
      }
    }
  }

  // ── A:C ratio (guardrail — score input only, not shown as pill) ──
  const acr = computeAcuteChronicRatio(activities, today, ftpPace);
  if (acr.ratio !== null) {
    const dev = Math.abs(acr.ratio - 1.05);
    const val = Math.max(0, Math.min(1.2, 1 - dev / 0.7));
    buckets.activity.push({ val, w: FACTOR_W.acuteChronicRatio });
  }

  // ── Training consistency (score input only, not shown as pill) ──
  const last7 = lastNDays(7);
  const totalGoalSessions = (parseFloat(goals.weeklySpeedSessions) || 1) + (parseFloat(goals.weeklyStrengthTarget) || 2);
  const weekSessions = activities.filter(a => last7.includes(a.date) && a.durationSecs > 0).length;
  if (totalGoalSessions > 0) {
    const pct = Math.min(weekSessions / totalGoalSessions, 1.2);
    buckets.activity.push({ val: pct, w: FACTOR_W.consistency });
  }

  // ═══ NUTRITION DOMAIN ═════════════════════════════════════════════════════

  const todayNutEntries = nutritionLog.filter(e => e.date === today);
  const todayCrono = cronoData.find(c => c.date === today);
  let nutProtein = 0, nutCalories = 0, nutWater = 0, hasNutData = false;

  if (todayNutEntries.length > 0) {
    todayNutEntries.forEach(e => {
      const s = e.servings || 1;
      nutProtein  += (e.macros?.protein  || 0) * s;
      nutCalories += (e.macros?.calories || 0) * s;
      nutWater    += (e.macros?.water    || 0) * s;
    });
    hasNutData = true;
  } else if (todayCrono) {
    nutProtein  = parseFloat(todayCrono.protein)  || 0;
    nutCalories = parseFloat(todayCrono.calories) || 0;
    nutWater    = parseFloat(todayCrono.water)    || 0;
    hasNutData = true;
  }

  if (hasNutData) {
    // ── Protein ──
    const targetProtein = parseFloat(goals.dailyProteinTarget) || 150;
    if (nutProtein > 0) {
      const val = Math.min(nutProtein / targetProtein, 1.2);
      buckets.nutrition.push({ val, w: FACTOR_W.protein });
      factors.push({
        label: 'Protein', value: `${Math.round(nutProtein)}g`, domain: 'nutrition',
        status: val >= 0.85 ? 'good' : val >= 0.6 ? 'warning' : 'poor',
      });
    }

    // ── Calories ──
    const targetCals = parseFloat(goals.dailyCalorieTarget) || 2200;
    if (nutCalories > 0) {
      const ratio = nutCalories / targetCals;
      const dev = Math.abs(ratio - 1.0);
      const val = Math.max(0.2, Math.min(1.2, 1 - dev / 0.4));
      buckets.nutrition.push({ val, w: FACTOR_W.calories });
      factors.push({
        label: 'Calories', value: `${Math.round(nutCalories)}`, domain: 'nutrition',
        status: dev <= 0.10 ? 'good' : dev <= 0.25 ? 'warning' : 'poor',
      });
    }

    // ── Hydration ──
    const targetWaterL = parseFloat(goals.dailyWaterTarget) || 3;
    if (nutWater > 0) {
      const waterL = nutWater > 50 ? nutWater / 1000 : nutWater;
      const val = Math.min(waterL / targetWaterL, 1.2);
      buckets.nutrition.push({ val, w: FACTOR_W.hydration });
      factors.push({
        label: 'Hydration', value: `${waterL.toFixed(1)}L`, domain: 'nutrition',
        status: val >= 0.8 ? 'good' : val >= 0.5 ? 'warning' : 'poor',
      });
    }
  }

  // ═══ BODY DOMAIN ══════════════════════════════════════════════════════════

  // ── Sleep ──
  const recentSleep = [...sleepData]
    .filter(s => s.date && s.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const lastSleep = recentSleep[0];
  // Guard: sleepScore must be a number in 0-100 range (CSV parser can pick up
  // stray year values like 2026 from misaligned "score" columns).
  const rawSleepScore = lastSleep?.sleepScore;
  const sleepScore = (typeof rawSleepScore === 'number' && rawSleepScore > 0 && rawSleepScore <= 100)
    ? rawSleepScore
    : null;
  if (sleepScore) {
    const val = Math.min(sleepScore / 100, 1.2);
    buckets.body.push({ val, w: FACTOR_W.sleep });
    factors.push({
      label: 'Sleep', value: `${sleepScore}`, domain: 'body',
      status: sleepScore >= 80 ? 'good' : sleepScore >= 60 ? 'warning' : 'poor',
    });
  }

  // ── HRV ──
  const targetHRV = parseFloat(goals.targetHRV) || 70;
  const recentHRV = [...hrvData]
    .filter(h => h.date && h.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const lastHRV = recentHRV[0];
  const hrvVal = lastHRV?.overnightHRV;
  // Guard: HRV should be 5-200ms range (plausible human values)
  if (typeof hrvVal === 'number' && hrvVal >= 5 && hrvVal <= 200) {
    const val = Math.min(hrvVal / targetHRV, 1.2);
    buckets.body.push({ val, w: FACTOR_W.hrv });
    factors.push({
      label: 'HRV', value: `${hrvVal}ms`, domain: 'body',
      status: val >= 0.9 ? 'good' : val >= 0.7 ? 'warning' : 'poor',
    });
  }

  // ── Resting HR (lower is better) ──
  const targetRHR = parseFloat(goals.targetRHR) || 55;
  const rawRHR = lastSleep?.restingHR || recentSleep.find(s => s.restingHR)?.restingHR;
  // Guard: resting HR should be 30-120 bpm (plausible range)
  const lastRHR = (typeof rawRHR === 'number' && rawRHR >= 30 && rawRHR <= 120) ? rawRHR : null;
  if (lastRHR) {
    const ratio = targetRHR / lastRHR;
    const val = Math.max(0.2, Math.min(1.2, ratio));
    buckets.body.push({ val, w: FACTOR_W.restingHR });
    factors.push({
      label: 'Resting HR', value: `${lastRHR} bpm`, domain: 'body',
      status: lastRHR <= targetRHR * 1.05 ? 'good' : lastRHR <= targetRHR * 1.2 ? 'warning' : 'poor',
    });
  }

  // ═══ COMPOSITE ════════════════════════════════════════════════════════════
  // Each domain 0-100 independently, then averaged (skip empty domains).

  const domainScores = {};
  let activeDomains = 0, totalScore = 0;

  for (const [domain, entries] of Object.entries(buckets)) {
    if (!entries.length) continue;
    const wSum = entries.reduce((a, e) => a + e.w, 0);
    const raw = entries.reduce((a, e) => a + Math.min(e.val, 1.2) * e.w, 0) / wSum;
    const score = Math.round(Math.min(raw, 1) * 100);
    domainScores[domain] = score;
    totalScore += score;
    activeDomains++;
  }

  if (!activeDomains) {
    return {
      score: 0, sessionType: 'rest', sessionMetric: null,
      domains: { activity: null, nutrition: null, body: null },
      factors: [{ label: 'No data', value: '—', status: 'warning', domain: 'body' }],
    };
  }

  return {
    score: Math.min(Math.round(totalScore / activeDomains), 100),
    sessionType,
    sessionMetric,
    domains: {
      activity:  domainScores.activity  ?? null,
      nutrition: domainScores.nutrition ?? null,
      body:      domainScores.body      ?? null,
    },
    factors,
  };
}

// Backward-compat alias
export const computeReadinessV2 = computeDailyScore;

// ═════════════════════════════════════════════════════════════════════════════
// 7. ROLLING SCORES — compounding over time
// ═════════════════════════════════════════════════════════════════════════════

// 7-day weights: today heaviest, exponential decay.
// today 25%, yesterday 20%, day-2 15%, days 3-6 each 10%.
const ROLLING_7D_WEIGHTS = [0.25, 0.20, 0.15, 0.10, 0.10, 0.10, 0.10];

// Cache: computing daily scores for 30 days on every render is expensive.
// Key by today's date string — cache invalidates once per day.
let _rollingCache = { key: '', scores: {} };

function getDailyScoreCached(dateStr) {
  if (_rollingCache.scores[dateStr] != null) return _rollingCache.scores[dateStr];
  const result = computeDailyScore(dateStr);
  _rollingCache.scores[dateStr] = result.score;
  return result.score;
}

/**
 * Compute 7-day weighted rolling score.
 * Today counts most, each prior day counts less.
 *
 * @param {string} [refDate] - reference date (YYYY-MM-DD)
 * @returns {{ score: number, daily: number[], todayScore: object }}
 */
export function computeRolling7d(refDate) {
  const today = refDate || localDate();

  // Invalidate cache if day changed
  if (_rollingCache.key !== today) {
    _rollingCache = { key: today, scores: {} };
  }

  const daily = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - i);
    const ds = localDate(d);
    daily.push(getDailyScoreCached(ds));
  }

  // Weighted average — only count days that have data (score > 0).
  // Redistribute weights of empty days proportionally.
  let weightSum = 0;
  let valueSum = 0;
  for (let i = 0; i < 7; i++) {
    if (daily[i] > 0) {
      weightSum += ROLLING_7D_WEIGHTS[i];
      valueSum += daily[i] * ROLLING_7D_WEIGHTS[i];
    }
  }

  const score = weightSum > 0 ? Math.round(valueSum / weightSum) : 0;

  // Also return today's full result for the parenthetical
  const todayFull = computeDailyScore(today);

  return {
    score: Math.min(score, 100),
    daily,   // [today, yesterday, ..., 6 days ago]
    todayScore: todayFull,
  };
}

/**
 * Compute 30-day straight-average rolling score.
 *
 * @param {string} [refDate] - reference date (YYYY-MM-DD)
 * @returns {{ score: number, daily: number[] }}
 */
export function computeRolling30d(refDate) {
  const today = refDate || localDate();

  if (_rollingCache.key !== today) {
    _rollingCache = { key: today, scores: {} };
  }

  const daily = [];
  let sum = 0, count = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - i);
    const ds = localDate(d);
    const s = getDailyScoreCached(ds);
    daily.push(s);
    if (s > 0) { sum += s; count++; }
  }

  return {
    score: count > 0 ? Math.min(Math.round(sum / count), 100) : 0,
    daily,  // [today, yesterday, ..., 29 days ago]
  };
}
