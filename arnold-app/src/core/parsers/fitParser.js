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

  let activityType = 'Other';
  if (sport === 'running') {
    activityType = subSport === 'treadmill' ? 'Run (treadmill)' : 'Run (outdoor)';
  } else if (sport === 'training' || sport === 'strength_training' || subSport === 'strength_training') {
    activityType = 'Strength';
  } else if (sport === 'cycling') {
    activityType = 'Cycling';
  } else if (sport === 'swimming') {
    activityType = 'Swimming';
  }

  const isRun = activityType.includes('Run');
  const isStrength = activityType === 'Strength';

  // Date/time
  const startDate = session.startTime instanceof Date ? session.startTime : new Date();
  const date = startDate.toISOString().split('T')[0];
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

  // Heart rate
  const avgHR = session.avgHeartRate ? parseInt(session.avgHeartRate) : null;
  const maxHR = session.maxHeartRate ? parseInt(session.maxHeartRate) : null;

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

  // Sets count (strength)
  const setsCount = messages.setMesgs?.length || null;
  const activeDuration = session.totalTimerTime ? Math.round(parseFloat(session.totalTimerTime)) : durationSecs;

  return {
    // Core
    date,
    time: timeStr,
    activityType,
    sport,
    subSport,
    isRun,
    isStrength,
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

    source: { type: 'fit', filename: file.name },
  };
}
