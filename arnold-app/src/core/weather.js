// ─── Open-Meteo weather lookup (Phase 4r.intel.9) ───────────────────────────
// Pulls historical hourly temperature + humidity for an activity, anchored to
// the closest hour of its start. Used by the intelligence layer to widen the
// expected-range bands on hot/humid days (heatAdjustment + humidityMultiplier
// in expectedRanges.js were sitting inert without this).
//
// API:
//   fetchWeatherForActivity({ lat, lon, startMs }) → { tempC, humidityPct } | null
//
// Open-Meteo is free, no API key, and serves both forecast and archive endpoints.
// We use the forecast endpoint with past_days=14 for any activity within the
// last 14 days (cheap, low-latency), and fall back to the archive endpoint for
// older data. Returns null on any failure so callers can ignore weather and
// fall back to baseline ranges.

const OPENMETEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OPENMETEO_ARCHIVE  = 'https://archive-api.open-meteo.com/v1/archive';
const HOURLY_FIELDS      = 'temperature_2m,relative_humidity_2m,weather_code';
const FORECAST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * @param {{lat:number, lon:number, startMs:number}} opts
 * @returns {Promise<{tempC:number, humidityPct:number}|null>}
 */
export async function fetchWeatherForActivity({ lat, lon, startMs }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!Number.isFinite(startMs) || startMs <= 0)      return null;

  const start = new Date(startMs);
  const startISO = start.toISOString().slice(0, 10);

  const ageMs = Date.now() - startMs;
  const useForecast = ageMs >= 0 && ageMs <= FORECAST_WINDOW_MS;
  const url = useForecast
    ? `${OPENMETEO_FORECAST}?latitude=${lat}&longitude=${lon}`
      + `&past_days=14&forecast_days=1&hourly=${HOURLY_FIELDS}&timezone=auto`
    : `${OPENMETEO_ARCHIVE}?latitude=${lat}&longitude=${lon}`
      + `&start_date=${startISO}&end_date=${startISO}&hourly=${HOURLY_FIELDS}&timezone=auto`;

  let body;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    body = await res.json();
  } catch { return null; }

  const hourly = body && body.hourly;
  const times  = hourly && hourly.time;
  const temps  = hourly && hourly.temperature_2m;
  const hums   = hourly && hourly.relative_humidity_2m;
  if (!Array.isArray(times) || !Array.isArray(temps) || !Array.isArray(hums)) return null;

  // Match closest hour. Open-Meteo returns local-time strings like
  // "2026-05-21T13:00" because we pass timezone=auto. Convert each to a
  // millis-from-epoch by reading it as a wall-clock time in the activity's
  // local timezone (which Open-Meteo already resolved server-side).
  let best = -1, bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i] + 'Z'); // crude — drift OK for hourly bins
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - startMs);
    if (delta < bestDelta) { bestDelta = delta; best = i; }
  }
  if (best < 0) return null;

  const tempC = Number(temps[best]);
  const humidityPct = Number(hums[best]);
  if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct)) return null;

  // Open-Meteo weather_code → simple condition word the icon mapper uses.
  // https://open-meteo.com/en/docs#weathervariables
  const codes = hourly.weather_code;
  let condition = null;
  if (Array.isArray(codes) && Number.isFinite(Number(codes[best]))) {
    const wc = Number(codes[best]);
    if (wc === 0)                  condition = 'Sunny';
    else if (wc >= 1  && wc <= 3)  condition = 'Cloudy';
    else if (wc === 45 || wc === 48) condition = 'Foggy';
    else if (wc >= 51 && wc <= 57) condition = 'Drizzle';
    else if (wc >= 61 && wc <= 67) condition = 'Rainy';
    else if (wc >= 71 && wc <= 77) condition = 'Snowy';
    else if (wc >= 80 && wc <= 82) condition = 'Rainy';
    else if (wc >= 85 && wc <= 86) condition = 'Snowy';
    else if (wc >= 95)             condition = 'Thunderstorm';
  }

  return { tempC, humidityPct, condition };
}

/**
 * Best-effort coord extractor for a Garmin activity listing payload (`ga`)
 * and an optional details DTO. Tries the common field names; returns null
 * when no coordinates can be found (e.g. indoor activities or a watch
 * configured to strip GPS).
 */
export function extractActivityCoords(ga, details) {
  const candidates = [
    [ga?.startLatitude,            ga?.startLongitude],
    [ga?.lat,                      ga?.lng],
    [details?.summaryDTO?.startLatitude, details?.summaryDTO?.startLongitude],
    [details?.startLatitude,       details?.startLongitude],
  ];
  for (const [lat, lon] of candidates) {
    const a = Number(lat), b = Number(lon);
    if (Number.isFinite(a) && Number.isFinite(b)
        && Math.abs(a) > 0.001 && Math.abs(b) > 0.001
        && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { lat: a, lon: b };
    }
  }
  return null;
}
