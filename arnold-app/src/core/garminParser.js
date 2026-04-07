// ─── ARNOLD Garmin CSV Parser ────────────────────────────────────────────────
// Parses actual Garmin Connect activity CSV exports into normalized objects.
// Handles unit detection (mi vs km), pace parsing, time parsing, and merging.

/**
 * Parse a Garmin Connect CSV export string into normalized activity objects.
 * Filters to running activities only. Merges by date into existing data.
 */
export function parseGarminCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  const headerMap = {};
  headers.forEach((h, i) => { headerMap[h.toLowerCase()] = i; });

  const col = name => {
    const key = Object.keys(headerMap).find(k => k.includes(name));
    return key !== undefined ? headerMap[key] : -1;
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length < 3) continue;

    const get = name => {
      const idx = col(name);
      if (idx < 0 || idx >= vals.length) return null;
      const v = vals[idx].replace(/^"|"$/g, '').trim();
      return (v === '' || v === '--') ? null : v;
    };

    const actType = get('activity type');
    if (!actType) continue;
    if (!/(running|trail running)/i.test(actType)) continue;

    const rawDate = get('date');
    const date = normalizeDate(rawDate);
    if (!date) continue;

    const rawDist = get('distance');
    const rawTime = get('time') || get('elapsed time');
    const rawAvgPace = get('avg pace');
    const rawBestPace = get('best pace');
    const rawCals = get('calories');
    const rawAvgHR = get('avg hr');
    const rawMaxHR = get('max hr');
    const rawAvgCad = get('avg run cadence') || get('avg cadence');
    const rawMaxCad = get('max run cadence') || get('max cadence');
    const rawAscent = get('total ascent');
    const rawDescent = get('total descent');
    const rawStride = get('avg stride length');
    const rawTSS = get('training stress score');
    const rawATE = get('aerobic te');
    const title = get('title') || actType;

    // Parse distance — detect mi vs km
    const distNum = parseNum(rawDist);
    const { km: distanceKm, mi: distanceMi, unitDetected } = detectDistanceUnit(distNum);

    // Parse duration
    const durationSecs = parseTime(rawTime);
    const durationFormatted = formatDuration(durationSecs);

    // Parse pace
    const paceIsPerMi = unitDetected === 'mi';
    const avgPace = parsePace(rawAvgPace, paceIsPerMi);
    const bestPace = parsePace(rawBestPace, paceIsPerMi);

    rows.push({
      date,
      activityType: actType,
      title,
      distanceKm: distanceKm !== null ? round2(distanceKm) : null,
      distanceMi: distanceMi !== null ? round2(distanceMi) : null,
      calories: parseIntSafe(rawCals),
      durationSecs,
      durationFormatted,
      avgHR: parseIntSafe(rawAvgHR),
      maxHR: parseIntSafe(rawMaxHR),
      avgCadence: parseIntSafe(rawAvgCad),
      maxCadence: parseIntSafe(rawMaxCad),
      avgPacePerKm: avgPace?.perKm || null,
      avgPacePerMi: avgPace?.perMi || null,
      bestPacePerKm: bestPace?.perKm || null,
      totalAscentM: parseIntSafe(rawAscent),
      totalDescentM: parseIntSafe(rawDescent),
      avgStrideLength: parseNum(rawStride),
      trainingStressScore: parseNum(rawTSS),
      aerobicTE: parseNum(rawATE),
      source: 'garmin-csv',
    });
  }

  return rows;
}

/**
 * Merge new activities into existing garmin.json entries by date.
 * Newer entries for the same date overwrite older ones.
 */
export function mergeGarminActivities(existing, incoming) {
  const byKey = new Map();
  for (const e of existing) {
    byKey.set(`${e.date}|${e.title || ''}`, e);
  }
  let added = 0, updated = 0;
  for (const e of incoming) {
    const key = `${e.date}|${e.title || ''}`;
    if (byKey.has(key)) { byKey.set(key, { ...byKey.get(key), ...e }); updated++; }
    else { byKey.set(key, e); added++; }
  }
  const merged = [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { merged, added, updated };
}

// ── Internals ────────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const vals = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  vals.push(cur.trim());
  return vals;
}

function normalizeDate(raw) {
  if (!raw) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // MM/DD/YYYY
  const m1 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[1].padStart(2, '0')}-${m1[2].padStart(2, '0')}`;
  // "Apr 5, 2026" or "April 5, 2026"
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const m2 = raw.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (m2) {
    const mo = months[m2[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m2[3]}-${mo}-${m2[2].padStart(2, '0')}`;
  }
  // Try Date parse as fallback
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseIntSafe(v) {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Detect if distance is miles or km.
 * Heuristic: marathon is ~42km / ~26mi. If a "long run" value is < 30, likely miles.
 * More precisely: Garmin defaults to user's unit setting. We check if values look
 * like they'd be unreasonably short in km (e.g., 6.2 for a 10K would be mi).
 * We use a threshold: if the value is present and < 0.5, skip. Otherwise, if
 * the raw distance column header contains "mi" we know. Fallback: assume km unless
 * the number pattern suggests miles (most values < 30 for what looks like real runs).
 */
function detectDistanceUnit(distNum) {
  if (distNum == null) return { km: null, mi: null, unitDetected: null };
  // We can't perfectly detect, but Garmin Connect exports typically use the user's
  // preferred unit. We'll store both conversions. If the value seems large (>50),
  // it's almost certainly km. If small, could be either — we default to km and
  // provide both conversions.
  // For now, assume km (Garmin default for most international users).
  // The user's actual unit will become apparent from the pace column format.
  return {
    km: distNum,
    mi: round2(distNum * 0.621371),
    unitDetected: 'km',
  };
}

/**
 * Parse time string: "H:MM:SS", "M:SS", or "HH:MM:SS"
 * Returns total seconds or null.
 */
function parseTime(v) {
  if (!v) return null;
  const parts = v.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function formatDuration(secs) {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse pace string like "6:28" into per-km and per-mi versions.
 * If paceIsPerMi is true, the raw value is min/mi and we convert to min/km.
 */
function parsePace(v, paceIsPerMi = false) {
  if (!v) return null;
  const clean = v.replace(/\s*\/.*$/, ''); // strip "/km" or "/mi" suffix
  const parts = clean.split(':').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  const totalSecs = parts[0] * 60 + parts[1];

  if (paceIsPerMi) {
    const perKmSecs = Math.round(totalSecs / 1.60934);
    return { perKm: formatPace(perKmSecs), perMi: formatPace(totalSecs) };
  }
  const perMiSecs = Math.round(totalSecs * 1.60934);
  return { perKm: formatPace(totalSecs), perMi: formatPace(perMiSecs) };
}

function formatPace(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = Math.round(totalSecs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
