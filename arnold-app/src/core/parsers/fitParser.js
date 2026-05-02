// ─── Garmin FIT File Parser ──────────────────────────────────────────────────
// Calibrated for Garmin FIT SDK output (Forerunner 955 Solar protocol v16/profile 21184)
import { Decoder, Stream } from '@garmin/fitsdk';

export async function parseFITFile(file) {
  const buffer = await file.arrayBuffer();
  const stream = Stream.fromArrayBuffer(buffer);
  const decoder = new Decoder(stream);

  if (!decoder.isFIT()) throw new Error('Not a valid FIT file');

  const { messages } = decoder.read({
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: false,
  });

  // Session message contains the activity summary
  const session = messages.sessionMesgs?.[0];
  if (!session) throw new Error('No session data in FIT file');

  // Sport type detection
  const sport = (session.sport || '').toString().toLowerCase();
  const subSport = (session.subSport || '').toString().toLowerCase();

  // Garmin uses sport === 'training' as a generic envelope for any structured
  // workout — the actual modality is in `subSport`. Without checking
  // subSport carefully, sport='training' would catch Strength, HIIT runs,
  // mobility, cardio, etc. all under one bucket.
  const MOBILITY_SUB = /^(yoga|pilates|stretching|flexibility_training|mobility|breathwork|meditation)$/;
  const RUN_SUB      = /^(treadmill|trail|track|street|virtual_run|indoor_running|road)$/;
  const HIIT_SUB     = /^(hiit|cardio_training|interval_training|interval|cardio)$/;
  const STRENGTH_SUB = /^(strength_training|cardio_strength|crossfit|hyrox)$/;
  const fileName     = file?.name || '';
  const nameRunHint  = /\b(run|jog|hiit|interval|tempo|speed|track)\b/i.test(fileName);
  const nameStrHint  = /\b(strength|lift|push|pull|squat|deadlift|bench|gym)\b/i.test(fileName);
  const nameMobHint  = /\b(mobility|stretch|yoga|pilates|flexibility|breathwork)\b/i.test(fileName);

  let activityType = 'Other';
  if (sport === 'running') {
    activityType = subSport === 'treadmill' ? 'Run (treadmill)' : 'Run (outdoor)';
  } else if (
    sport === 'mobility' || sport === 'flexibility_training' || sport === 'yoga' ||
    MOBILITY_SUB.test(subSport) || nameMobHint
  ) {
    activityType = 'Mobility';
  } else if (sport === 'strength_training' || STRENGTH_SUB.test(subSport)) {
    activityType = 'Strength';
  } else if (HIIT_SUB.test(subSport) || (sport === 'training' && (HIIT_SUB.test(subSport) || nameRunHint))) {
    // HIIT runs / interval workouts. Garmin reports these as
    // sport=training, subSport=hiit (or cardio_training / interval).
    activityType = 'HIIT';
  } else if (RUN_SUB.test(subSport) || (sport === 'training' && nameRunHint)) {
    activityType = 'Run (outdoor)';
  } else if (sport === 'training') {
    // Generic structured training with no specific subSport or name hint —
    // fall back to Strength as the most common case for sport=training,
    // then let the Garmin Worker's name-based post-process refine if needed.
    activityType = nameStrHint ? 'Strength' : 'Strength';
  } else if (sport === 'cycling') {
    activityType = 'Cycling';
  } else if (sport === 'swimming') {
    activityType = 'Swimming';
  }

  // HIIT runs count as runs for distance/pace tracking AND as workouts for
  // the strength side of the planner — they're the hybrid case.
  const isRun = activityType.includes('Run') || activityType === 'HIIT';
  const isStrength = activityType === 'Strength';
  const isMobility = activityType === 'Mobility';
  const isHIIT = activityType === 'HIIT';

  // Date/time
  // Use LOCAL date components, not toISOString() — toISOString returns UTC,
  // so an evening run in EDT gets dated to "tomorrow" in UTC, then falls
  // outside the local-time week boundaries used by Weekly aggregations.
  // This was the cause of today's run showing 0 mi / 0 runs in Weekly view.
  const startDate = session.startTime instanceof Date ? session.startTime : new Date();
  const date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
  const timeStr = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Distance (meters → miles and km)
  const distanceM = parseFloat(session.totalDistance) || 0;
  const distanceKm = parseFloat((distanceM / 1000).toFixed(2));
  const distanceMi = parseFloat((distanceM / 1609.344).toFixed(2));

  // Duration (seconds)
  const durationSecs = Math.round(parseFloat(session.totalElapsedTime) || parseFloat(session.totalTimerTime) || 0);
  const durationMins = Math.round(durationSecs / 60);
  const h = Math.floor(durationSecs / 3600);
  const m = Math.floor((durationSecs % 3600) / 60);
  const s = durationSecs % 60;
  const duration = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  // Pace (for running)
  const fmt = secs => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  let avgPacePerMi = null, avgPacePerKm = null, bestPacePerMi = null;
  if (isRun && distanceM > 0 && durationSecs > 0) {
    avgPacePerKm = fmt(durationSecs / distanceKm);
    avgPacePerMi = fmt(durationSecs / distanceMi);
  }
  // Enhanced avg speed from session (overrides if present)
  if (session.enhancedAvgSpeed) {
    const mps = parseFloat(session.enhancedAvgSpeed);
    if (mps > 0) {
      avgPacePerKm = fmt(1000 / mps);
      avgPacePerMi = fmt(1609.344 / mps);
    }
  }
  if (session.enhancedMaxSpeed) {
    const mps = parseFloat(session.enhancedMaxSpeed);
    if (mps > 0) bestPacePerMi = fmt(1609.344 / mps);
  }

  // Heart rate — clamp to a physiologically plausible range so bad bytes
  // from a corrupt or idiosyncratic FIT file don't leak a huge value (e.g. a
  // session timestamp) into downstream aggregates.
  const hrOk = n => (Number.isFinite(n) && n >= 30 && n <= 250 ? n : null);
  const avgHR = session.avgHeartRate ? hrOk(parseInt(session.avgHeartRate)) : null;
  const maxHR = session.maxHeartRate ? hrOk(parseInt(session.maxHeartRate)) : null;

  // Cadence (running cadence is stored as half-steps, multiply by 2)
  const cadenceRaw = session.avgRunningCadence || session.avgCadence;
  const avgCadence = cadenceRaw ? Math.round(parseFloat(cadenceRaw) * 2) : null;
  const maxCadenceRaw = session.maxRunningCadence || session.maxCadence;
  const maxCadence = maxCadenceRaw ? Math.round(parseFloat(maxCadenceRaw) * 2) : null;

  // Power (watts)
  const avgPowerW = session.avgPower ? Math.round(parseFloat(session.avgPower)) : null;
  const maxPowerW = session.maxPower ? Math.round(parseFloat(session.maxPower)) : null;
  const normalizedPower = session.normalizedPower ? Math.round(parseFloat(session.normalizedPower)) : null;

  // Elevation (meters)
  const totalAscentM = session.totalAscent ? Math.round(parseFloat(session.totalAscent)) : null;
  const totalDescentM = session.totalDescent ? Math.round(parseFloat(session.totalDescent)) : null;
  const totalAscentFt = totalAscentM ? Math.round(totalAscentM * 3.28084) : null;

  // Calories
  const calories = session.totalCalories ? Math.round(parseFloat(session.totalCalories)) : null;

  // Training metrics
  const trainingStressScore = session.trainingStressScore ? parseFloat(session.trainingStressScore) : null;
  const aerobicTrainingEffect = session.totalTrainingEffect ? parseFloat(session.totalTrainingEffect) : null;
  const anaerobicTrainingEffect = session.totalAnaerobicTrainingEffect ? parseFloat(session.totalAnaerobicTrainingEffect) : null;

  // Stride length and vertical metrics (running)
  const avgStrideLength = session.avgStrideLength ? parseFloat(session.avgStrideLength) : null;
  const avgVerticalOscillation = session.avgVerticalOscillation ? parseFloat(session.avgVerticalOscillation) : null;
  const avgVerticalRatio = session.avgVerticalRatio ? parseFloat(session.avgVerticalRatio) : null;
  const avgGroundContactTime = session.avgStanceTime ? Math.round(parseFloat(session.avgStanceTime)) : null;

  // Moving time — totalTimerTime is the active (moving) time in FIT sessions
  const movingTimeSecs = session.totalTimerTime ? Math.round(parseFloat(session.totalTimerTime)) : null;

  // Sets + reps (strength)
  const setMesgs = messages.setMesgs || [];
  const setsCount = setMesgs.length || null;
  // Active sets only — Garmin emits setType='rest' rows interleaved with
  // 'active' ones for strength training. Counting reps from rest rows would
  // inflate volume incorrectly.
  const totalReps = setMesgs.reduce((sum, s) => {
    const t = String(s.setType || '').toLowerCase();
    if (t && t !== 'active') return sum;
    return sum + (parseInt(s.repetitions) || 0);
  }, 0) || null;
  const activeDuration = movingTimeSecs || durationSecs;

  // ── Work/Rest seconds for strength sessions ─────────────────────────────
  // Garmin records each set with setType='active' (the lift) or 'rest'
  // (the gap before the next set). Total work/rest seconds drive the
  // Work:Rest Ratio tile, which classifies a session by energy system
  //   1:>5     → strength/power (phosphagen)
  //   1:1.5–5  → hypertrophy / fast glycolytic
  //   1:<1.5   → endurance / oxidative
  // Falls back to lapMesgs[] when setMesgs aren't typed (older watches use
  // the lap button manually). Null if neither source has clear active/rest
  // separation — the metric tile then renders "—" with a "no lap data" note.
  const { totalWorkSecs, totalRestSecs } = (() => {
    let work = 0, rest = 0;
    let typedAny = false;
    for (const s of setMesgs) {
      const dur = parseFloat(s.duration);
      if (!isFinite(dur) || dur <= 0) continue;
      const t = String(s.setType || '').toLowerCase();
      if (t === 'active') { work += dur; typedAny = true; }
      else if (t === 'rest') { rest += dur; typedAny = true; }
    }
    if (typedAny && work > 0) return { totalWorkSecs: Math.round(work), totalRestSecs: Math.round(rest) };
    // Fallback: walk lapMesgs[]. Convention: 'lap_trigger=manual' alternates
    // active/rest. We treat lap.intensity='active' as work, 'rest' as rest.
    const laps = messages.lapMesgs || [];
    work = 0; rest = 0;
    for (const l of laps) {
      const dur = parseFloat(l.totalElapsedTime ?? l.totalTimerTime);
      if (!isFinite(dur) || dur <= 0) continue;
      const intensity = String(l.intensity || '').toLowerCase();
      if (intensity === 'active') work += dur;
      else if (intensity === 'rest') rest += dur;
    }
    if (work > 0 && rest > 0) return { totalWorkSecs: Math.round(work), totalRestSecs: Math.round(rest) };
    return { totalWorkSecs: null, totalRestSecs: null };
  })();

  // Body battery drain (session field if present)
  const bodyBatteryDrain = (() => {
    const start = session.bodyBatteryStart ?? session.startingBodyBattery;
    const end = session.bodyBatteryEnd ?? session.endingBodyBattery;
    if (start != null && end != null) return Math.round(parseFloat(start) - parseFloat(end));
    if (session.bodyBatteryDrain != null) return Math.round(parseFloat(session.bodyBatteryDrain));
    return null;
  })();

  // ── Phase 4b · Tile-metric additions ─────────────────────────────────────
  // HR zone breakdown — seconds spent in each of the 5 zones (Z1..Z5),
  // computed by the watch using the user's configured max HR. Garmin's FIT
  // SDK emits this either as an array `timeInHrZone[5]` or as five
  // numbered fields `timeInHrZone_1`..`timeInHrZone_5` depending on the
  // protocol version. We accept both shapes; null if the device didn't
  // record zones for this session (e.g. some strength sessions).
  const hrZones = (() => {
    if (Array.isArray(session.timeInHrZone) && session.timeInHrZone.length === 5) {
      return session.timeInHrZone.map(v => Math.round(parseFloat(v) || 0));
    }
    const zones = [];
    for (let i = 1; i <= 5; i++) {
      const candidates = [
        session[`timeInHrZone_${i}`],
        session[`timeInHrZone${i}`],
        session[`time_in_hr_zone_${i}`],
      ];
      const v = candidates.find(x => x != null);
      if (v == null) return null;
      zones.push(Math.round(parseFloat(v) || 0));
    }
    return zones;
  })();

  // EPOC / Total Training Load — Garmin's measure of aerobic + anaerobic
  // post-exercise oxygen consumption, the canonical "how much recovery does
  // this session demand" number. Field is `totalTrainingLoad` on session.
  // Distinct from `trainingStressScore` (TSS, normalized power based) and
  // the 0-5 Aerobic/Anaerobic Training Effect scores already extracted.
  const totalTrainingLoad = session.totalTrainingLoad
    ? Math.round(parseFloat(session.totalTrainingLoad))
    : null;

  // Race Predictor times (5K/10K/Half/Marathon, in seconds). Newer Garmin
  // watches store these directly on the session. Older protocol versions
  // route them through `userProfileMesgs` instead — we check both. If
  // neither has it, we fall back to null and the Run "Race Predictor" tile
  // will show "—" until Garmin Wellness sync is wired up (Phase 4).
  const racePredictor = (() => {
    const sec = v => (v != null ? Math.round(parseFloat(v)) : null);
    const t5k  = sec(session.timeFor5k    ?? session.predictedTime5k);
    const t10k = sec(session.timeFor10k   ?? session.predictedTime10k);
    const tHM  = sec(session.timeForHalf  ?? session.predictedTimeHalfMarathon);
    const tM   = sec(session.timeForMarathon ?? session.predictedTimeMarathon);
    if (t5k == null && t10k == null && tHM == null && tM == null) return null;
    return { t5k, t10k, tHM, tM };
  })();

  // Aerobic Decoupling — measures HR drift relative to pace over the course
  // of a run. The cleanest endurance-fitness diagnostic: split the run in
  // half (by time), compute pace/HR ratio for each half, return the percent
  // drift.
  //
  //   decoupling % = ((HR2/Speed2) - (HR1/Speed1)) / (HR1/Speed1) * 100
  //
  // Interpretation (rule of thumb from Friel/coaching literature):
  //   < 5%   = aerobically sound for the distance
  //   5–10%  = on the edge — pace was a touch hot
  //   > 10%  = aerobic system was overrun, will be visible as fade in races
  //
  // Only meaningful for runs ≥ 30 min — short runs don't have enough drift
  // to measure cleanly. Computed from record-level samples (1Hz from the
  // watch). Falls back to null if records are missing or too few.
  const aerobicDecoupling = (() => {
    if (!isRun || durationSecs < 30 * 60) return null;
    const records = messages.recordMesgs || [];
    if (records.length < 60) return null;

    const samples = records
      .map(r => ({
        t: r.timestamp instanceof Date ? r.timestamp.getTime() : null,
        hr: parseFloat(r.heartRate),
        speed: parseFloat(r.enhancedSpeed ?? r.speed),
      }))
      .filter(s => s.t != null && Number.isFinite(s.hr) && s.hr >= 60 && s.hr <= 220 && Number.isFinite(s.speed) && s.speed > 0.5);
    if (samples.length < 60) return null;

    const t0 = samples[0].t;
    const tEnd = samples[samples.length - 1].t;
    const tMid = t0 + (tEnd - t0) / 2;

    const half1 = samples.filter(s => s.t <= tMid);
    const half2 = samples.filter(s => s.t > tMid);
    if (half1.length < 30 || half2.length < 30) return null;

    const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const hr1 = avg(half1.map(s => s.hr));
    const sp1 = avg(half1.map(s => s.speed));
    const hr2 = avg(half2.map(s => s.hr));
    const sp2 = avg(half2.map(s => s.speed));
    const ratio1 = hr1 / sp1;
    const ratio2 = hr2 / sp2;
    if (!Number.isFinite(ratio1) || ratio1 === 0) return null;
    const decouplingPct = ((ratio2 - ratio1) / ratio1) * 100;
    return +decouplingPct.toFixed(2);
  })();

  return {
    // Core
    date,
    time: timeStr,
    activityType,
    sport,
    subSport,
    isRun,
    isStrength,
    isMobility,
    filename: file.name,

    // Distance
    distanceKm,
    distanceMi,
    distanceM,

    // Duration
    durationSecs,
    durationMins,
    duration, // formatted string
    activeDuration,

    // Pace (running)
    avgPacePerKm,
    avgPacePerMi,
    avgPaceRaw: avgPacePerMi,
    bestPacePerMi,

    // Heart rate
    avgHR,
    maxHR,

    // Cadence
    avgCadence,
    maxCadence,

    // Power
    avgPowerW,
    maxPowerW,
    normalizedPower,

    // Elevation
    totalAscentM,
    totalDescentM,
    totalAscentFt,

    // Calories
    calories,

    // Training load
    trainingStressScore,
    aerobicTrainingEffect,
    anaerobicTrainingEffect,

    // Running biomechanics
    avgStrideLength,
    avgVerticalOscillation,
    avgVerticalRatio,
    avgGroundContactTime,

    // Strength specific
    setsCount,
    totalReps,
    totalWorkSecs,    // sum of active set durations
    totalRestSecs,    // sum of rest durations between sets
    movingTimeSecs,
    bodyBatteryDrain,

    // Phase 4b tile metrics
    hrZones,            // [s in Z1, Z2, Z3, Z4, Z5] or null
    totalTrainingLoad,  // EPOC equivalent — single number, demand on recovery
    racePredictor,      // {t5k, t10k, tHM, tM} in seconds — or null
    aerobicDecoupling,  // % drift in HR/pace ratio between first and second half — null if not computable

    source: { type: 'fit', filename: file.name },
  };
}
