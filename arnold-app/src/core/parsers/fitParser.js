// ─── Garmin FIT File Parser ──────────────────────────────────────────────────
// Calibrated for Garmin FIT SDK output (Forerunner 955 Solar protocol v16/profile 21184)
import { Decoder, Stream } from '@garmin/fitsdk';

// Phase 4r.zones.3 — bin a raw HR record stream into the user's custom
// bpm zones from profile.hrZoneBpm. This is more authoritative than
// the watch-computed time-in-zone in the FIT (which uses whatever
// zone scheme the watch is currently configured for — typically
// %HRmax, not the user's customized bpm boundaries shown in Connect).
//
// Returns an array of 5 ints (Z1..Z5 seconds), or null if the records
// don't have enough HR samples to be useful.
function binRecordsToBpmZones(records, zoneBpm) {
  if (!Array.isArray(records) || records.length < 30) return null;
  if (!zoneBpm) return null;
  const buckets = [0, 0, 0, 0, 0];
  let prevT = null;
  for (const r of records) {
    const t = r.timestamp instanceof Date ? r.timestamp.getTime() : null;
    const hr = parseFloat(r.heartRate);
    if (t == null || !Number.isFinite(hr) || hr < 60 || hr > 220) {
      prevT = t;
      continue;
    }
    if (prevT != null) {
      const dt = (t - prevT) / 1000;
      if (dt > 0 && dt < 30) {
        let idx;
        if      (hr <= zoneBpm.z1Max) idx = 0;
        else if (hr <= zoneBpm.z2Max) idx = 1;
        else if (hr <= zoneBpm.z3Max) idx = 2;
        else if (hr <= zoneBpm.z4Max) idx = 3;
        else                          idx = 4;
        buckets[idx] += dt;
      }
    }
    prevT = t;
  }
  if (buckets.some(b => b > 0)) return buckets.map(b => Math.round(b));
  return null;
}

// Accepts an optional opts.zoneBpm — when present, raw HR records are
// re-binned against the user's custom bpm boundaries (Path 0), which
// overrides whatever scheme the watch baked into the FIT's
// time-in-zone fields. Without zoneBpm, the parser falls back to
// Path 1/2 (the watch's own time-in-zone) and finally to null.
export async function parseFITFile(file, opts = {}) {
  const zoneBpm = opts.zoneBpm || null;
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
  const STRENGTH_SUB = /^(strength_training|cardio_strength|crossfit)$/;
  const fileName     = file?.name || '';
  const nameRunHint  = /\b(run|jog|hiit|interval|tempo|speed|track)\b/i.test(fileName);
  const nameStrHint  = /\b(strength|lift|push|pull|squat|deadlift|bench|gym)\b/i.test(fileName);
  const nameMobHint  = /\b(mobility|stretch|yoga|pilates|flexibility|breathwork)\b/i.test(fileName);
  // HYROX-style mixed run+strength workouts come through as sport=hiit
  // from our own Workbench export, or with the word "HYROX" in the
  // session name. Both should route to HIIT (not Strength) so they
  // count toward HIIT-specific metrics + the right activity card.
  const nameHyroxHint = /\bhyrox\b/i.test(fileName);

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
  } else if (
    sport === 'hiit' ||                  // Garmin sport=hiit (62) — direct HIIT sport
    sport === 'cardio' ||                // sport=cardio_training (26)
    subSport === 'hyrox' ||              // legacy: some firmwares use subSport=hyrox
    nameHyroxHint ||                     // session name contains "HYROX"
    HIIT_SUB.test(subSport) ||
    (sport === 'training' && (HIIT_SUB.test(subSport) || nameRunHint || nameHyroxHint))
  ) {
    // HIIT runs / interval workouts / HYROX. Garmin reports these as
    // sport=hiit (modern firmwares), sport=training+subSport=hiit (older),
    // or just a HYROX-named activity uploaded from any sport.
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
  // Session summary first — most Garmin watches with a native running-power
  // datafield or Stryd pod write avgPower/maxPower into the session message.
  let avgPowerW = session.avgPower ? Math.round(parseFloat(session.avgPower)) : null;
  let maxPowerW = session.maxPower ? Math.round(parseFloat(session.maxPower)) : null;
  const normalizedPower = session.normalizedPower ? Math.round(parseFloat(session.normalizedPower)) : null;
  // Phase 4r.viz.2 fallback — some watches/firmwares only write power into
  // per-second `record` messages and skip the session aggregate. If session
  // didn't carry power but the records do, synthesize avg/max from records.
  if ((!avgPowerW || !maxPowerW) && Array.isArray(messages.recordMesgs)) {
    const powerSamples = messages.recordMesgs
      .map(r => r && r.power != null ? parseFloat(r.power) : null)
      .filter(p => Number.isFinite(p) && p > 0 && p < 2000);
    if (powerSamples.length >= 30) {
      if (!avgPowerW) {
        const sum = powerSamples.reduce((a, b) => a + b, 0);
        avgPowerW = Math.round(sum / powerSamples.length);
      }
      if (!maxPowerW) {
        maxPowerW = Math.round(Math.max(...powerSamples));
      }
    }
  }

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
  // Phase 4r.viz.4 — FIT spec stores vertical oscillation in mm (with internal
  // scale of 10). Different JS FIT SDKs handle this inconsistently — some
  // return the value already in cm (e.g. 8.6), others return raw mm (e.g. 86).
  // Garmin Connect displays cm. Normalize: if the value is impossibly high
  // for cm (>25), assume mm and divide by 10.
  const avgStrideLength = session.avgStrideLength ? parseFloat(session.avgStrideLength) : null;
  let avgVerticalOscillation = session.avgVerticalOscillation ? parseFloat(session.avgVerticalOscillation) : null;
  if (avgVerticalOscillation != null && avgVerticalOscillation > 25) avgVerticalOscillation = avgVerticalOscillation / 10;
  let avgVerticalRatio = session.avgVerticalRatio ? parseFloat(session.avgVerticalRatio) : null;
  // Vertical ratio is a % — typical values 5–15. Some SDKs return scaled.
  if (avgVerticalRatio != null && avgVerticalRatio > 25) avgVerticalRatio = avgVerticalRatio / 10;
  let avgGroundContactTime = session.avgStanceTime ? Math.round(parseFloat(session.avgStanceTime)) : null;
  // Phase 4r.viz.3 fallback — same pattern as the power fix. Running dynamics
  // (vertical oscillation, vertical ratio, ground contact) require an
  // accessory (HRM-Pro/Run/Tri, Running Dynamics Pod). When the accessory is
  // paired, some firmwares write only per-second `record` messages and skip
  // the session aggregate. Synthesize avg from records when we have enough.
  if ((avgVerticalOscillation == null || avgVerticalRatio == null || avgGroundContactTime == null)
      && Array.isArray(messages.recordMesgs)) {
    const recs = messages.recordMesgs;
    const meanOf = (field, minVal, maxVal) => {
      const samples = recs.map(r => r && r[field] != null ? parseFloat(r[field]) : null)
        .filter(v => Number.isFinite(v) && v > minVal && v < maxVal);
      if (samples.length < 30) return null;
      return samples.reduce((a, b) => a + b, 0) / samples.length;
    };
    if (avgVerticalOscillation == null) {
      // Records can carry vert-osc in either cm (4–18) or mm (40–180) depending
      // on SDK. Accept both, normalize to cm afterwards.
      const v = meanOf('verticalOscillation', 4, 200);
      if (v != null) avgVerticalOscillation = v > 25 ? v / 10 : v;
    }
    if (avgVerticalRatio == null) {
      const v = meanOf('verticalRatio', 3, 200);
      if (v != null) avgVerticalRatio = v > 25 ? v / 10 : v;
    }
    if (avgGroundContactTime == null) {
      const v = meanOf('stanceTime', 150, 400);
      if (v != null) avgGroundContactTime = Math.round(v);
    }
  }

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
    // Phase 4r.zones.3 — Path 0 (authoritative when zoneBpm is provided):
    // bin the raw HR record stream against the user's custom bpm zone
    // boundaries. This makes Arnold's zones match Garmin Connect's
    // "Heart Rate Zones" panel — Connect bins by user-configured bpm
    // boundaries, while the watch's own time-in-zone fields (Path 1/2)
    // and the activity DTO's hrTimeInZone use whatever zone scheme the
    // watch is configured for (typically %HRmax). The two systems
    // diverge whenever the user customizes their zones in Connect.
    //
    // Note: when zoneBpm IS set, we do NOT fall through to Path 1/2 if
    // Path 0 fails. Path 1/2 are watch-computed and may use %HRmax —
    // returning those would silently re-introduce the mismatch. Better
    // to return null and let synthesizeZonesFromAvgHR (which now bins
    // by bpm boundaries) take over with an explicit "est." label.
    if (zoneBpm) {
      const records = messages.recordMesgs || [];
      const fromBpm = binRecordsToBpmZones(records, zoneBpm);
      if (fromBpm) return fromBpm;
      // Phase 4r.viz.32 — fall through to Path 1/2 when Path 0 fails.
      // Earlier rev refused to fall through, fearing %HRmax-binned zones
      // would silently mismatch the user's custom bpm zones. In practice
      // the resulting "no zones at all" is worse than "watch-binned
      // zones with a slight scheme mismatch" — especially for sport=hiit
      // where the FR955 doesn't always emit record samples but DOES
      // populate session.timeInHrZone. Path 1/2 produces SOMETHING the
      // user can see; the zone label can be refined later if needed.
    }
    // Path 1: session has the explicit time-in-zone array (watch-computed,
    // scheme depends on the watch's zone config).
    if (Array.isArray(session.timeInHrZone) && session.timeInHrZone.length === 5) {
      return session.timeInHrZone.map(v => Math.round(parseFloat(v) || 0));
    }
    // Path 2: session has the per-zone numbered fields (also watch-computed).
    const zones = [];
    let allFound = true;
    for (let i = 1; i <= 5; i++) {
      const candidates = [
        session[`timeInHrZone_${i}`],
        session[`timeInHrZone${i}`],
        session[`time_in_hr_zone_${i}`],
      ];
      const v = candidates.find(x => x != null);
      if (v == null) { allFound = false; break; }
      zones.push(Math.round(parseFloat(v) || 0));
    }
    if (allFound && zones.length === 5) return zones;

    // Phase 4r.zones.1 — Path 3 (local %HRmax binning) was REMOVED.
    //
    // It walked the raw HR record stream and binned each sample against
    // fixed %HRmax thresholds (60/72/82/90%). The problem: Garmin Connect
    // lets the user configure CUSTOM bpm-based zone boundaries (e.g. Z2
    // = 123-136 bpm Easy, Z3 = 137-150 bpm Aerobic), and most users do.
    // The %HRmax binner ignored those personalized boundaries, so a
    // sample at 81% maxHR landed in Path-3-Z4 (≥80%) while Garmin
    // showed it in user-configured-Z2 (123-136 bpm). On a typical
    // easy run, the displayed zones came out 2 buckets too high — Z4
    // 68% / Z5 27% for what Garmin reported as Z2 68% / Z3 27%.
    //
    // Worse, once Path 3 wrote hrZones, the Garmin worker enrichment
    // skipped the activity (it only re-fetches when hrZones == null),
    // so the wrong bins became permanent and the authoritative bpm
    // zones never reached storage.
    //
    // Now: if the FIT session doesn't ship a time-in-zone array, we
    // return null. Downstream, the Garmin worker enriches from the
    // activity DTO (which uses the user's authoritative bpm zones), or
    // synthesizeZonesFromAvgHR renders an explicitly-labeled "est."
    // estimate at display time.
    return null;
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

  // ── HR Recovery (Phase 4m.1.5) ─────────────────────────────────────────
  // Heart-rate recovery is the drop in BPM in the first 60 seconds after
  // peak exertion — a clean autonomic-nervous-system fitness signal.
  // Larger drop = better parasympathetic reactivation = better cardio
  // fitness for the load you just absorbed.
  //
  // Garmin sometimes records a `recoveryHeartRate` field on the session
  // (newer firmware), but it's not consistently present. The robust path
  // is to compute it from the record stream: find the peak HR sample,
  // then find the sample 60s after it, and subtract.
  //
  // Output is the bpm DROP (positive number = good). Returns null when:
  //   • not a run (the metric only makes sense for cardio)
  //   • run shorter than 10 min (peak is noisy on warmups)
  //   • record stream doesn't extend ≥60s past the peak (no cooldown)
  //   • peak HR or post-peak HR clamps fail physiology checks
  const hrRecovery = (() => {
    if (!isRun) return null;
    if (durationSecs < 10 * 60) return null;
    // 1. Try session-level field first — fastest path when present.
    const direct = session.recoveryHeartRate
                 ?? session.heartRateRecovery
                 ?? session.hrRecovery
                 ?? session.recovery_heart_rate
                 ?? null;
    if (direct != null) {
      const v = parseInt(direct, 10);
      // Garmin sometimes records this as the final-resting HR, sometimes
      // as the drop. Keep numbers in a sensible range either way (10-100
      // bpm drop is plausible; below 10 likely a parsing artifact).
      if (Number.isFinite(v) && v >= 5 && v <= 120) return v;
    }
    // 2. Record-level fallback. Walk the record stream, identify the
    //    peak HR sample, then look for a sample ~60s after it.
    const records = messages.recordMesgs || [];
    if (records.length < 30) return null;
    const samples = records
      .map(r => ({
        t: r.timestamp instanceof Date ? r.timestamp.getTime() : null,
        hr: parseFloat(r.heartRate),
      }))
      .filter(s => s.t != null && Number.isFinite(s.hr) && s.hr >= 60 && s.hr <= 220);
    if (samples.length < 30) return null;
    let peakIdx = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].hr > samples[peakIdx].hr) peakIdx = i;
    }
    const peak = samples[peakIdx];
    const targetT = peak.t + 60_000; // 60 seconds after peak
    // Find the closest sample at or after targetT. If we don't have one
    // (peak was within the last minute of the run), bail — we can't
    // compute recovery without the cooldown window.
    let postIdx = -1;
    for (let i = peakIdx + 1; i < samples.length; i++) {
      if (samples[i].t >= targetT) { postIdx = i; break; }
    }
    if (postIdx === -1) return null;
    const drop = Math.round(peak.hr - samples[postIdx].hr);
    if (!Number.isFinite(drop) || drop < 0 || drop > 120) return null;
    return drop;
  })();

  // ── GAP (Grade-Adjusted Pace) — Phase 4m.1.5 ─────────────────────────
  // Average GAP across the whole run, computed from records. For routes
  // with significant elevation, GAP is the truer "effort pace" because
  // it equalizes for hills using the standard formula:
  //   adj_speed = speed * (1 + grade * 0.033)   (Strava's published curve)
  // grade = altitude delta / horizontal delta; clamped to ±25%.
  // Output: pace string in MM:SS per mile; null when records insufficient
  // or the route is essentially flat (no point cluttering the tile).
  const gapPerMi = (() => {
    if (!isRun || distanceM <= 0 || durationSecs < 10 * 60) return null;
    const records = messages.recordMesgs || [];
    if (records.length < 60) return null;
    const samples = records.map(r => ({
      speed: parseFloat(r.enhancedSpeed ?? r.speed),
      alt:   parseFloat(r.enhancedAltitude ?? r.altitude),
      dist:  parseFloat(r.distance),
    })).filter(s => Number.isFinite(s.speed) && s.speed > 0.5);
    if (samples.length < 60) return null;
    // If altitude is missing for most samples, no point computing GAP.
    const withAlt = samples.filter(s => Number.isFinite(s.alt));
    if (withAlt.length < samples.length * 0.5) return null;
    let totalAdjDist = 0;
    let totalTimeSecs = 0;
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const cur = samples[i];
      const dDist = (cur.dist != null && prev.dist != null) ? (cur.dist - prev.dist) : 0;
      if (!(dDist > 0)) continue;
      const dAlt = (Number.isFinite(cur.alt) && Number.isFinite(prev.alt)) ? (cur.alt - prev.alt) : 0;
      const grade = Math.max(-0.25, Math.min(0.25, dAlt / dDist));
      const adjFactor = 1 + grade * 0.033;
      totalAdjDist += dDist * adjFactor;
      totalTimeSecs += dDist / cur.speed;
    }
    if (totalAdjDist <= 0 || totalTimeSecs <= 0) return null;
    // Bail if the difference vs raw pace is < 2s/mi — no value to report.
    const adjPaceSecsPerMi = (totalTimeSecs / totalAdjDist) * 1609.344;
    const rawPaceSecsPerMi = durationSecs / distanceMi;
    if (Math.abs(adjPaceSecsPerMi - rawPaceSecsPerMi) < 2) return null;
    return fmt(adjPaceSecsPerMi);
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

    // Phase 4m.1.5 — newly extracted Run KRIs
    hrRecovery,         // bpm drop in the 60s after peak HR — null if not computable
    gapPerMi,           // grade-adjusted pace per mile (MM:SS) — null when route is flat or records insufficient

    source: { type: 'fit', filename: file.name },
  };
}
