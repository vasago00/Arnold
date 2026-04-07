// ─── ARNOLD Training Intelligence Engine ─────────────────────────────────────
// Pure deterministic analysis — no AI. Takes parsed Garmin history, returns insights.

/**
 * Get activities within a date range.
 */
function activitiesInRange(activities, startDate, endDate) {
  return activities.filter(a => a.date >= startDate && a.date <= endDate);
}

function weeksAgoRange(weekOffset = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7; // Mon=1
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() - (dayOfWeek - 1) - weekOffset * 7 + 6);
  const startOfWeek = new Date(endOfWeek);
  startOfWeek.setDate(endOfWeek.getDate() - 6);
  const fmt = d => d.toISOString().slice(0, 10);
  // Clamp end to today
  const today = fmt(now);
  const end = fmt(endOfWeek) > today ? today : fmt(endOfWeek);
  return { start: fmt(startOfWeek), end };
}

function paceToSecs(pace) {
  if (!pace) return null;
  const parts = pace.split(':').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  return parts[0] * 60 + parts[1];
}

function secsToFmtPace(secs) {
  if (secs == null) return null;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Exported functions ──────────────────────────────────────────────────────

/**
 * Weekly training load — sum of metrics for a given week.
 * weekOffset: 0 = current week, 1 = last week, etc.
 */
export function weeklyLoad(activities, weekOffset = 0) {
  const { start, end } = weeksAgoRange(weekOffset);
  const week = activitiesInRange(activities, start, end);

  const totalMinutes = week.reduce((s, a) => s + ((a.durationSecs || 0) / 60), 0);
  const totalKm = week.reduce((s, a) => s + (a.distanceKm || 0), 0);
  const hrs = week.filter(a => a.avgHR);
  const avgHR = hrs.length ? Math.round(hrs.reduce((s, a) => s + a.avgHR, 0) / hrs.length) : null;
  const longRunKm = week.reduce((mx, a) => Math.max(mx, a.distanceKm || 0), 0);

  // Estimated load: duration-weighted HR (TRIMP-like simplified)
  const load = week.reduce((s, a) => {
    const mins = (a.durationSecs || 0) / 60;
    const hr = a.avgHR || 135; // default assumption
    return s + mins * (hr / 150); // normalized to ~150 bpm reference
  }, 0);

  return {
    start, end, sessions: week.length,
    totalMinutes: Math.round(totalMinutes),
    totalKm: Math.round(totalKm * 10) / 10,
    avgHR, longRunKm: Math.round(longRunKm * 10) / 10,
    load: Math.round(load),
  };
}

/**
 * Trend analysis — compare last 4 weeks.
 */
export function loadTrend(activities) {
  const weeks = [0, 1, 2, 3].map(i => weeklyLoad(activities, i));
  const loads = weeks.map(w => w.totalKm);

  // Simple linear trend: compare avg of recent 2 vs older 2
  const recent = (loads[0] + loads[1]) / 2;
  const older = (loads[2] + loads[3]) / 2;
  const diff = recent - older;
  const pctChange = older > 0 ? (diff / older) * 100 : 0;

  let direction = 'stable';
  if (pctChange > 10) direction = 'increasing';
  else if (pctChange < -10) direction = 'decreasing';

  let recommendation = 'Consistent training — keep it up.';
  if (direction === 'increasing' && pctChange > 25) {
    recommendation = 'Volume rising fast — watch for overtraining. Consider a deload week soon.';
  } else if (direction === 'increasing') {
    recommendation = 'Good progressive build. Maintain 10% weekly increase max.';
  } else if (direction === 'decreasing' && pctChange < -25) {
    recommendation = 'Significant volume drop. If unplanned, rebuild gradually.';
  } else if (direction === 'decreasing') {
    recommendation = 'Volume tapering — fine if intentional (race prep or recovery).';
  }

  return { direction, weeklyLoads: weeks, recommendation, pctChange: Math.round(pctChange) };
}

/**
 * Pace trend — is pace improving?
 */
export function paceTrend(activities, activityType = 'Running') {
  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
  const fmt = d => d.toISOString().slice(0, 10);

  const thisMonth = activitiesInRange(activities, fmt(d30), fmt(now))
    .filter(a => a.avgPacePerKm);
  const prevMonth = activitiesInRange(activities, fmt(d60), fmt(d30))
    .filter(a => a.avgPacePerKm);

  const avgSecs = arr => {
    if (!arr.length) return null;
    const total = arr.reduce((s, a) => s + paceToSecs(a.avgPacePerKm), 0);
    return Math.round(total / arr.length);
  };

  const cur = avgSecs(thisMonth);
  const prev = avgSecs(prevMonth);

  if (cur == null && prev == null) {
    return { trend: 'stable', avgPaceLastMonth: null, avgPacePrevMonth: null, deltaSeconds: 0 };
  }

  const delta = (cur != null && prev != null) ? cur - prev : 0;
  let trend = 'stable';
  if (delta < -5) trend = 'improving'; // faster = fewer seconds
  else if (delta > 5) trend = 'declining';

  return {
    trend,
    avgPaceLastMonth: secsToFmtPace(cur),
    avgPacePrevMonth: secsToFmtPace(prev),
    deltaSeconds: delta,
  };
}

/**
 * HR efficiency — pace per HR beat. Higher = more efficient.
 * Calculated as (speed in km/h) / avgHR * 1000
 */
export function hrEfficiency(activities) {
  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
  const fmt = d => d.toISOString().slice(0, 10);

  const calc = arr => {
    const valid = arr.filter(a => a.avgHR && a.distanceKm && a.durationSecs > 0);
    if (!valid.length) return null;
    const effs = valid.map(a => {
      const speedKmH = (a.distanceKm / a.durationSecs) * 3600;
      return (speedKmH / a.avgHR) * 1000;
    });
    return Math.round(effs.reduce((s, e) => s + e, 0) / effs.length * 10) / 10;
  };

  const current = calc(activitiesInRange(activities, fmt(d30), fmt(now)));
  const previous = calc(activitiesInRange(activities, fmt(d60), fmt(d30)));

  let trend = 'stable';
  if (current != null && previous != null) {
    const diff = current - previous;
    if (diff > 0.3) trend = 'improving';
    else if (diff < -0.3) trend = 'declining';
  }

  let interpretation = 'Not enough data.';
  if (current != null) {
    if (current > 70) interpretation = 'Excellent aerobic efficiency.';
    else if (current > 55) interpretation = 'Good efficiency — room to improve with more Zone 2.';
    else interpretation = 'Below average — focus on easy aerobic runs.';
  }

  return { current, previous, trend, interpretation };
}

/**
 * Training monotony — variety score. Too similar = burnout risk.
 * Uses coefficient of variation of daily training load over last 7 days.
 */
export function trainingMonotony(activities) {
  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const fmt = d => d.toISOString().slice(0, 10);

  // Build daily load array for last 7 days
  const dailyLoads = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = fmt(d);
    const dayActs = activities.filter(a => a.date === ds);
    const load = dayActs.reduce((s, a) => s + ((a.durationSecs || 0) / 60), 0);
    dailyLoads.push(load);
  }

  const mean = dailyLoads.reduce((s, v) => s + v, 0) / 7;
  if (mean === 0) return { score: 0, risk: 'low', recommendation: 'No recent training data.' };

  const variance = dailyLoads.reduce((s, v) => s + (v - mean) ** 2, 0) / 7;
  const sd = Math.sqrt(variance);
  const monotony = sd > 0 ? mean / sd : 10; // high monotony = low variation

  let risk = 'low';
  let recommendation = 'Good training variety.';
  if (monotony > 2.5) {
    risk = 'high';
    recommendation = 'Training too uniform — vary intensity and rest days to prevent burnout.';
  } else if (monotony > 1.5) {
    risk = 'moderate';
    recommendation = 'Moderate monotony — consider adding variety in session types.';
  }

  return { score: Math.round(monotony * 10) / 10, risk, recommendation };
}

/**
 * Race readiness — based on longest run, weekly volume, and weeks of training.
 */
export function raceReadiness(activities, raceDistanceKm, raceDateStr) {
  if (!activities.length || !raceDistanceKm) {
    return { score: 0, status: 'undertrained', gaps: ['No training data available'] };
  }

  const now = new Date();
  const raceDate = new Date(raceDateStr);
  const daysUntil = Math.round((raceDate - now) / (1000 * 60 * 60 * 24));
  const weeksUntil = Math.max(0, Math.round(daysUntil / 7));

  // Last 30 days of data
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const fmt = d => d.toISOString().slice(0, 10);
  const recent = activitiesInRange(activities, fmt(d30), fmt(now));

  // Metrics
  const longestRun = recent.reduce((mx, a) => Math.max(mx, a.distanceKm || 0), 0);
  const weeklyKm = recent.reduce((s, a) => s + (a.distanceKm || 0), 0) / 4.3; // ~4.3 weeks in 30 days
  const sessions = recent.length;

  // Scoring components (each 0-25, total 0-100)
  const gaps = [];

  // 1. Long run readiness: longest run should be >= 70% of race distance
  const longRunPct = longestRun / raceDistanceKm;
  let longRunScore = Math.min(25, Math.round(longRunPct / 0.7 * 25));
  if (longRunPct < 0.5) gaps.push(`Longest run (${longestRun.toFixed(1)}km) is less than 50% of race distance`);
  else if (longRunPct < 0.7) gaps.push(`Need a long run of ${(raceDistanceKm * 0.7).toFixed(0)}km+ (current: ${longestRun.toFixed(1)}km)`);

  // 2. Weekly volume: should be >= 2.5x race distance per week
  const volTarget = raceDistanceKm * 2.5;
  const volPct = weeklyKm / volTarget;
  let volScore = Math.min(25, Math.round(volPct * 25));
  if (volPct < 0.5) gaps.push(`Weekly volume (${weeklyKm.toFixed(0)}km) well below target (${volTarget.toFixed(0)}km)`);
  else if (volPct < 0.8) gaps.push(`Increase weekly volume to ${volTarget.toFixed(0)}km (current: ${weeklyKm.toFixed(0)}km)`);

  // 3. Consistency: sessions per week
  const sessPerWeek = sessions / 4.3;
  let consScore = Math.min(25, Math.round((sessPerWeek / 4) * 25)); // 4 sessions/week = full score
  if (sessPerWeek < 2) gaps.push('Running fewer than 2x per week — increase frequency');

  // 4. Time buffer: enough weeks to build
  const weeksNeeded = raceDistanceKm > 30 ? 16 : raceDistanceKm > 15 ? 10 : 6;
  let timeScore = Math.min(25, Math.round((weeksUntil / weeksNeeded) * 25));
  if (daysUntil < 0) { timeScore = 25; } // race already here — just rate readiness
  if (weeksUntil < weeksNeeded * 0.5 && longRunPct < 0.6) {
    gaps.push(`Only ${weeksUntil} weeks left — may need to adjust race goals`);
  }

  const score = Math.min(100, longRunScore + volScore + consScore + timeScore);
  let status = 'undertrained';
  if (score >= 75) status = 'ready';
  else if (score >= 40) status = 'building';

  return { score, status, gaps: gaps.slice(0, 3), daysUntil, weeksUntil };
}

/**
 * Streak and consistency over N days.
 */
export function trainingConsistency(activities, days = 30) {
  const now = new Date();
  const dateSet = new Set(activities.map(a => a.date));

  let activeDays = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let streakBroken = false;

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);

    if (dateSet.has(ds)) {
      activeDays++;
      if (!streakBroken) currentStreak++;
      // For longest streak we need forward counting — simplified here
    } else {
      if (!streakBroken) streakBroken = true;
    }
  }

  // Compute longest streak by forward scan
  longestStreak = 0;
  let streak = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    if (dateSet.has(ds)) { streak++; longestStreak = Math.max(longestStreak, streak); }
    else { streak = 0; }
  }

  const restDays = days - activeDays;
  const consistencyPct = Math.round((activeDays / days) * 100);

  return { activeDays, restDays, longestStreak, currentStreak, consistencyPct };
}

/**
 * Build training context string for AI Coach.
 */
export function buildTrainingContext(activities, races = [], workouts = []) {
  const lines = [];
  lines.push('[ARNOLD TRAINING CONTEXT]');
  lines.push('Clinical baseline (Mar 2025):');
  lines.push('- VO2 Max: 51 ml/kg/min (98th pct, Elite)');
  lines.push('- Bio Age: 33 (17 yrs younger than chronological)');
  lines.push('- Body Fat: 24.7% (target: 16.7%)');
  lines.push('- Visceral Fat: 1.29 lbs (target: 0.60 lbs)');
  lines.push('- Lean Mass: 134 lbs (target: 138 lbs)');
  lines.push('- RMR: 1,880 kcal');
  lines.push('');

  if (activities.length) {
    const cons = trainingConsistency(activities, 30);
    const pt = paceTrend(activities);
    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const fmt = d => d.toISOString().slice(0, 10);
    const recent = activities.filter(a => a.date >= fmt(d30) && a.date <= fmt(now));
    const totalKm = recent.reduce((s, a) => s + (a.distanceKm || 0), 0);
    const hrs = recent.filter(a => a.avgHR);
    const avgHR = hrs.length ? Math.round(hrs.reduce((s, a) => s + a.avgHR, 0) / hrs.length) : null;
    const longest = recent.reduce((mx, a) => (a.distanceKm || 0) > (mx.distanceKm || 0) ? a : mx, { distanceKm: 0 });
    const lt = loadTrend(activities);

    lines.push('Training (last 30 days from Garmin CSV):');
    lines.push(`- Sessions: ${recent.length} runs, ${totalKm.toFixed(1)} km total`);
    lines.push(`- Avg pace: ${pt.avgPaceLastMonth || 'N/A'} /km (trend: ${pt.trend})`);
    if (avgHR) lines.push(`- Avg HR: ${avgHR} bpm`);
    if (longest.distanceKm > 0) lines.push(`- Longest run: ${longest.distanceKm.toFixed(1)} km on ${longest.date}`);
    lines.push(`- Weekly load trend: ${lt.direction}`);
    lines.push(`- Consistency: ${cons.consistencyPct}% (${cons.activeDays} of 30 days active)`);
  } else {
    lines.push('Training: No Garmin CSV data imported yet.');
  }
  lines.push('');

  const upcomingRaces = races
    .filter(r => r.date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcomingRaces.length) {
    lines.push('Upcoming races:');
    for (const r of upcomingRaces.slice(0, 3)) {
      const daysLeft = Math.round((new Date(r.date) - new Date()) / (1000 * 60 * 60 * 24));
      const readiness = activities.length ? raceReadiness(activities, r.distanceKm || 42.2, r.date) : null;
      lines.push(`- ${r.name || 'Race'} on ${r.date} — ${daysLeft} days away${readiness ? ` — readiness: ${readiness.score}/100` : ''}`);
    }
  }
  lines.push('');

  const recentWorkouts = workouts.slice(0, 3);
  if (recentWorkouts.length) {
    lines.push('Recent workout reflections:');
    for (const w of recentWorkouts) {
      const ref = w.reflection ? w.reflection.slice(0, 150) : '';
      lines.push(`- ${w.date} ${w.type || ''}: ${ref}`);
    }
  }

  lines.push('[END ARNOLD CONTEXT]');
  return lines.join('\n');
}
