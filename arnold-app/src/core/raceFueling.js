// ─── Race-day fueling plan (Phase 4r.race.1) ────────────────────────────────
// Builds a timed fueling + hydration schedule for an upcoming race.
//
// Inputs:
//   race            — { distanceMi?, distanceKm?, date, name, ... }
//   profile         — { weightLbs, targetRacePace, ... }
//   weatherForecast — { tempC, humidityPct } (from fetchWeatherForDate or
//                     cached Open-Meteo for the race date)
//   sweatRateLbsPerHr — observed baseline from recoverySignature summary
//                       (Phase 4r.adapt.1). Falls back to 1.5 lb/hr.
//   pace            — "MM:SS" /mi override; null → use profile.targetRacePace
//   finishTime      — "HH:MM:SS" override; null → derive from pace + distance
//                     (pace and finishTime are mutually exclusive — caller
//                     supplies one, the helper derives the other)
//
// Outputs a structured plan the EdgeIQ tile can render directly.
//
// All thresholds and multipliers are exported so the UI can show provenance
// ("based on 25°C × 70% humidity → 1.32× baseline sweat rate") and edits
// stay traceable to the science.

// ─── Tunable constants (sport-nutrition consensus values) ───────────────────

// Sweat-rate multipliers vs. temperature. Sigmoidal in reality; we step.
// Source: ACSM Position Stand on Exercise & Fluid Replacement (2007),
// plus follow-up work on heat acclimatization (Sawka et al, 2015).
export const TEMP_SWEAT_BANDS = [
  { maxC: 5,   mult: 0.65 },
  { maxC: 10,  mult: 0.80 },
  { maxC: 15,  mult: 0.90 },
  { maxC: 20,  mult: 1.00 },   // baseline anchor
  { maxC: 25,  mult: 1.20 },
  { maxC: 30,  mult: 1.45 },
  { maxC: 999, mult: 1.70 },
];

// Humidity multipliers — additive on top of temperature. Above ~70% RH
// evaporative cooling drops sharply, so fluid loss climbs without the
// cooling benefit (which is the worst combination physiologically).
export const HUMIDITY_BANDS = [
  { maxPct: 40,  mult: 0.95 },
  { maxPct: 65,  mult: 1.00 },
  { maxPct: 80,  mult: 1.10 },
  { maxPct: 100, mult: 1.20 },
];

// In-race carb intake target (g/hr) by projected finish duration.
// Shorter efforts don't deplete glycogen; longer efforts demand more.
export const CARB_RATE_BANDS = [
  { maxMin: 40,  gPerHr: 30 },    // 5K — body has enough glycogen
  { maxMin: 90,  gPerHr: 60 },    // 10K, fast HM
  { maxMin: 180, gPerHr: 70 },    // HM, fast marathon
  { maxMin: 999, gPerHr: 80 },    // long marathons / ultras — multiple-transport carbs
];

// How much of measured sweat to replace via in-race hydration. Less than
// 100% is correct — gut absorption rate caps around 800–1000 mL/hr in
// elite athletes, lower in recreational runners. Replacing all sweat
// causes GI distress; deficit is normal and tolerable up to ~2% bodyweight.
export const HYDRATION_REPLACE_FRACTION = 0.60;

// Pre-race carb load (60–90 min before start): 1 g per kg bodyweight.
export const PRE_RACE_CARB_PER_KG = 1.0;

// In-race gel cadence — every 25 minutes lands fueling before glycogen
// pulls hard, evenly spaced across most races. The schedule builder uses
// this as a target spacing; actual gel count derives from finish time.
export const GEL_INTERVAL_MIN = 25;

// Phase 4r.race.3 — standardize on a 30g gel. Real-world gels (GU, Maurten,
// SiS, Honey Stinger) sit at 22–30 g/sachet, with 25 and 30 being most
// common. 30 g rounds cleanly and matches what most runners actually carry.
export const GEL_CARB_G = 30;

// GI tolerance cap on per-hour fluid intake. Sports-science consensus is
// that even acclimated elite runners struggle to absorb more than ~800–
// 1000 mL/hr; recreational runners cap closer to 600–750 mL/hr before GI
// distress (sloshing, nausea, cramping) sets in. We clamp the
// adjusted-sweat replacement target here so the schedule never recommends
// physiologically impossible volumes — even when the math says otherwise.
export const MAX_FLUID_ML_PER_HR = 750;

// ─── Parsing helpers ───────────────────────────────────────────────────────

const KG_PER_LB = 0.4536;

// ─── Distance inference from race name (Phase 4r.race.1b) ──────────────────
// Many users add races to the Races tab with just a name and date; distance
// is omitted because it "feels obvious" from the name. Recognize the common
// patterns so the fueling plan can still compute. Returns miles; null if no
// pattern matches.
export function inferDistanceMi(raceName) {
  if (!raceName) return null;
  const n = String(raceName).toLowerCase();
  // Numeric K (5K, 10K, 21K, 50K, 100K)
  const kMatch = n.match(/\b(\d{1,3})\s*k(m)?\b/);
  if (kMatch) {
    const km = Number(kMatch[1]);
    if (Number.isFinite(km) && km > 0 && km < 250) return +(km * 0.621371).toFixed(2);
  }
  // Numeric miles (10 mile, 50 mile, 100 mile)
  const miMatch = n.match(/\b(\d{1,3})\s*mile/);
  if (miMatch) {
    const mi = Number(miMatch[1]);
    if (Number.isFinite(mi) && mi > 0) return mi;
  }
  // Named distances
  if (/\bhalf\b/.test(n) && /\b(marathon|mara)\b/.test(n)) return 13.1094;
  if (/\bhalf\b/.test(n)) return 13.1094;                       // standalone "Half"
  if (/\bmarathon\b/.test(n) && !/\bhalf\b/.test(n)) return 26.2188;
  if (/\b26\.2\b/.test(n)) return 26.2188;
  if (/\b13\.1\b/.test(n)) return 13.1094;
  if (/\bultra\b/.test(n)) return 50;                            // typical ultra entry distance
  return null;
}

// "8:30" or "8:30 /mi" → seconds per mile. Returns null if unparseable.
export function parsePaceSecs(input) {
  if (!input) return null;
  const m = String(input).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
  return mins * 60 + secs;
}

// "1:45:30" or "1:55" → total minutes (decimals OK). null on bad input.
export function parseFinishMin(input) {
  if (!input) return null;
  const parts = String(input).split(':').map(s => Number(s));
  if (parts.some(p => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// Seconds-per-mile → "MM:SS"
export function secsToPaceStr(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Minutes → "H:MM:SS"
export function minToTimeStr(mins) {
  if (!Number.isFinite(mins) || mins <= 0) return null;
  const total = Math.round(mins * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Multiplier lookups ────────────────────────────────────────────────────

export function tempSweatMult(tempC) {
  if (tempC == null || !Number.isFinite(tempC)) return 1.0;
  for (const { maxC, mult } of TEMP_SWEAT_BANDS) if (tempC < maxC) return mult;
  return 1.70;
}

export function humiditySweatMult(humidityPct) {
  if (humidityPct == null || !Number.isFinite(humidityPct)) return 1.0;
  for (const { maxPct, mult } of HUMIDITY_BANDS) if (humidityPct < maxPct) return mult;
  return 1.20;
}

export function carbRatePerHour(finishMin) {
  if (!Number.isFinite(finishMin) || finishMin <= 0) return 0;
  for (const { maxMin, gPerHr } of CARB_RATE_BANDS) if (finishMin < maxMin) return gPerHr;
  return 80;
}

// ─── Schedule construction ─────────────────────────────────────────────────

// Build a fixed-interval in-race schedule. Each row = one 30 g gel + a
// realistic sip of fluid. First gel at minute 20 (after the body has
// settled into rhythm but before glycogen depletion starts). Fluid per
// row is capped by GI tolerance — even if measured sweat says you need
// more, you can't absorb more than ~750 mL/hr.
function buildSchedule({ finishMin, totalFluidDuringMl }) {
  const startGelMin = 20;
  const out = [];

  const gelOpportunities = [];
  for (let t = startGelMin; t <= finishMin - 5; t += GEL_INTERVAL_MIN) {
    gelOpportunities.push(t);
  }
  if (gelOpportunities.length === 0) return out;

  // Per-row fluid: divide the cap'd total by the number of rows, then
  // round to the nearest 25 mL so the user gets a clean cup-sized number.
  const perRowFluidRaw = totalFluidDuringMl / gelOpportunities.length;
  const perRowFluidMl = Math.max(150, Math.min(250, Math.round(perRowFluidRaw / 25) * 25));

  for (let i = 0; i < gelOpportunities.length; i++) {
    const min = gelOpportunities[i];
    out.push({
      atMin: min,
      label: `Min ${min}`,
      fuelG: GEL_CARB_G,         // standardized 30 g — matches what runners carry
      fluidMl: perRowFluidMl,
      note: i === 0 ? 'first gel — primes bloodstream'
          : i === gelOpportunities.length - 1 ? 'last before the finish kick'
          : null,
    });
  }
  return out;
}

// ─── Public: full race fueling plan ─────────────────────────────────────────

export function buildRaceFuelingPlan({
  race,
  profile,
  weatherForecast,
  sweatRateLbsPerHr,
  pace,
  finishTime,
} = {}) {
  // ── Distance ──
  // Three sources: explicit distanceMi, explicit distanceKm, inferred from
  // race name ("Half" → 13.1, "Marathon" → 26.2, "10K" → 6.2, etc.).
  let distanceMi = Number(race?.distanceMi)
    || (Number(race?.distanceKm) > 0 ? +(Number(race.distanceKm) * 0.621371).toFixed(2) : null);
  let distanceSource = 'explicit';
  if (!distanceMi || distanceMi <= 0) {
    const inferred = inferDistanceMi(race?.name);
    if (inferred) {
      distanceMi = inferred;
      distanceSource = 'inferred';
    }
  }
  if (!distanceMi || distanceMi <= 0) return null;

  // ── Pace / finish-time reconciliation ──
  // Caller supplies one; we derive the other. If neither is supplied,
  // use the profile's stored targetRacePace as fallback.
  let paceSecs = parsePaceSecs(pace);
  let finishMin = parseFinishMin(finishTime);
  if (paceSecs && !finishMin) {
    finishMin = (paceSecs * distanceMi) / 60;
  } else if (finishMin && !paceSecs) {
    paceSecs = (finishMin * 60) / distanceMi;
  } else if (!paceSecs && !finishMin) {
    paceSecs = parsePaceSecs(profile?.targetRacePace) || 540;  // 9:00 default
    finishMin = (paceSecs * distanceMi) / 60;
  }

  // ── Bodyweight (lbs) ──
  const weightLbs = Number(profile?.weightLbs) || Number(profile?.weight) || 175;
  const weightKg = weightLbs * KG_PER_LB;

  // ── Sweat rate adjusted for weather ──
  const baseSweatLbsPerHr = Number.isFinite(sweatRateLbsPerHr) && sweatRateLbsPerHr > 0
    ? sweatRateLbsPerHr
    : 1.5;  // population fallback if we have no signature data yet
  const tempC = weatherForecast?.tempC ?? weatherForecast?.tempMaxC ?? null;
  const humidPct = weatherForecast?.humidityPct ?? weatherForecast?.humidity ?? null;
  const tMult = tempSweatMult(tempC);
  const hMult = humiditySweatMult(humidPct);
  const adjustedSweatLbsPerHr = +(baseSweatLbsPerHr * tMult * hMult).toFixed(2);
  const adjustedSweatMlPerHr = Math.round(adjustedSweatLbsPerHr * 453.592);

  // ── Carb math ──
  const gPerHr = carbRatePerHour(finishMin);
  const totalCarbsDuringG = Math.round((gPerHr * finishMin) / 60);
  const preRaceCarbG = Math.round(weightKg * PRE_RACE_CARB_PER_KG);
  const postRaceCarbG = 60;
  const postRaceProteinG = Math.round(weightKg * 0.3);  // ~25g at 85kg

  // ── Hydration math ──
  // Two ceilings: the body's actual replacement target (60% of sweat loss)
  // AND a GI-tolerance cap (~750 mL/hr). Real-world intake is min of those.
  const sweatTargetMlPerHr = adjustedSweatMlPerHr * HYDRATION_REPLACE_FRACTION;
  const cappedMlPerHr = Math.min(sweatTargetMlPerHr, MAX_FLUID_ML_PER_HR);
  const totalFluidDuringMl = Math.round(cappedMlPerHr * (finishMin / 60));
  const fluidWasCapped = sweatTargetMlPerHr > MAX_FLUID_ML_PER_HR;

  // ── Schedule ──
  // Phase 4r.race.3 — schedule uses standardized 30 g gels. Total carbs
  // is recomputed from the schedule (gel count × 30 g) so the summary
  // and the timeline always agree.
  const schedule = buildSchedule({
    finishMin,
    totalFluidDuringMl,
  });
  const schedCarbsG = schedule.reduce((s, r) => s + r.fuelG, 0);
  const schedFluidMl = schedule.reduce((s, r) => s + r.fluidMl, 0);

  return {
    inputs: {
      distanceMi,
      distanceSource,         // 'explicit' | 'inferred' — for UI provenance
      paceSecs,
      paceStr:   secsToPaceStr(paceSecs),
      finishMin,
      finishStr: minToTimeStr(finishMin),
      weightLbs,
      weightKg:  +weightKg.toFixed(1),
    },
    weather: {
      tempC,
      humidityPct: humidPct,
      tempMult:     tMult,
      humidityMult: hMult,
      combinedMult: +(tMult * hMult).toFixed(2),
      hasData:      tempC != null,
    },
    sweat: {
      baseLbsPerHr:     baseSweatLbsPerHr,
      adjustedLbsPerHr: adjustedSweatLbsPerHr,
      adjustedMlPerHr:  adjustedSweatMlPerHr,
      totalLossMl:      Math.round(adjustedSweatMlPerHr * finishMin / 60),
    },
    carbs: {
      gPerHr,
      // Schedule-derived total (gel count × 30 g) so summary matches timeline.
      totalDuringG:    schedCarbsG,
      gelCount:        schedule.length,
      gelSizeG:        GEL_CARB_G,
      preRaceG:        preRaceCarbG,
      postRaceCarbG,
      postRaceProteinG,
    },
    hydration: {
      // Same: derive total from schedule rows so the user sees a coherent plan.
      totalDuringMl:        schedFluidMl,
      perRowMl:             schedule[0]?.fluidMl ?? null,
      replaceFraction:      HYDRATION_REPLACE_FRACTION,
      maxMlPerHr:           MAX_FLUID_ML_PER_HR,
      wasCapped:            fluidWasCapped,
      preRaceMl:            550,            // standard pre-race hydration
      remainingDeficitMl:   Math.round(adjustedSweatMlPerHr * finishMin / 60 - schedFluidMl),
    },
    schedule,
  };
}
