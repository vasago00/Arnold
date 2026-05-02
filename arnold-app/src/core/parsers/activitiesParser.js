// ─── Garmin Activities CSV Parser ─────────────────────────────────────────────

function parseCSVLine(line) {
  const vals = []; let cur = '', inQ = false;
  for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; } else cur += ch; }
  vals.push(cur);
  return vals.map(v => v.trim().replace(/^"|"$/g, ''));
}

function num(v) { if (!v || v === '--') return null; const n = parseFloat(v.replace(/,/g, '')); return isNaN(n) ? null : n; }
function int(v) { if (!v || v === '--') return null; const n = parseInt(v.replace(/,/g, ''), 10); return isNaN(n) ? null : n; }

function parseTime(v) {
  if (!v || v === '--') return null;
  const p = v.split(':').map(Number);
  if (p.some(isNaN)) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
}

// Robust Garmin date normalizer.
// Garmin's "Activities CSV" export uses US format "M/D/YYYY H:MM" — slicing
// the first 10 chars (the previous behavior) yielded "1/2/2026 1" garbage,
// which downstream `new Date(...)` parsed inconsistently and threw whole
// activities into wrong years (e.g., Jan-26 ski sessions ended up dated
// 2025-12-XX). Other Garmin endpoints emit ISO "YYYY-MM-DD HH:MM:SS";
// we accept both. Always returns a clean "YYYY-MM-DD" string in local time
// (no UTC drift) so YTD filters and date comparisons are reliable.
function normalizeDate(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const s = rawDate.trim();
  // ISO format: starts with YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US format: M/D/YYYY or MM/DD/YYYY (Garmin's CSV export default)
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const [, mon, day, year] = us;
    return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // Fallback: trust the JS parser, build local ISO
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Pull a HH:MM[:SS] substring out of a raw datetime field. Independent of
// date format — works on both "1/2/2026 11:05" and "2026-01-02 11:05:00".
function extractTime(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const m = rawDate.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}${m[3] ? ':' + m[3] : ''}`;
}

function fmtDuration(s) {
  if (s == null) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

export function parseActivitiesCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdrs = parseCSVLine(lines[0]);
  const col = {};
  hdrs.forEach((h, i) => { col[h.toLowerCase().trim()] = i; });
  const g = (row, name) => {
    const idx = Object.keys(col).find(k => k.includes(name));
    return idx !== undefined && col[idx] < row.length ? row[col[idx]] : null;
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 3) continue;

    const rawDate = g(row, 'date');
    if (!rawDate || rawDate === '--') continue;
    const datePart = normalizeDate(rawDate);
    const timePart = extractTime(rawDate);
    if (!datePart) continue;  // unparseable date → skip the row

    const distMi = num(g(row, 'distance'));
    const distKm = distMi != null ? Math.round(distMi * 1.60934 * 100) / 100 : null;
    const durationSecs = parseTime(g(row, 'time'));
    const movingTimeSecs = parseTime(g(row, 'moving time'));
    const totalAscentFt = int(g(row, 'total ascent'));
    const totalDescentFt = int(g(row, 'total descent'));

    results.push({
      date: datePart,
      time: timePart,
      activityType: g(row, 'activity type') || '',
      title: g(row, 'title') || '',
      distanceMi: distMi,
      distanceKm: distKm,
      calories: int(g(row, 'calories')),
      durationSecs,
      durationFormatted: fmtDuration(durationSecs),
      avgHR: int(g(row, 'avg hr')),
      maxHR: int(g(row, 'max hr')),
      aerobicTE: num(g(row, 'aerobic te')),
      avgCadence: int(g(row, 'avg run cadence')),
      maxCadence: int(g(row, 'max run cadence')),
      // Garmin export: runs store pace under "Avg Speed" (e.g. "9:58"), not "Avg Pace".
      // Prefer Avg Pace → Avg GAP (grade-adjusted) → Avg Speed.
      avgPaceRaw: (() => {
        const candidates = [g(row, 'avg pace'), g(row, 'avg gap'), g(row, 'avg speed')];
        for (const c of candidates) {
          if (c && c !== '--' && /^\d{1,2}:\d{2}/.test(c)) return c;
        }
        return null;
      })(),
      bestPaceRaw: (() => {
        const candidates = [g(row, 'best pace'), g(row, 'max speed')];
        for (const c of candidates) {
          if (c && c !== '--' && /^\d{1,2}:\d{2}/.test(c)) return c;
        }
        return null;
      })(),
      totalAscentFt,
      totalAscentM: totalAscentFt != null ? Math.round(totalAscentFt * 0.3048) : null,
      totalDescentFt,
      totalDescentM: totalDescentFt != null ? Math.round(totalDescentFt * 0.3048) : null,
      avgStrideLength: num(g(row, 'avg stride length')),
      avgPower: int(g(row, 'avg power')),
      maxPower: int(g(row, 'max power')),
      steps: int(g(row, 'steps')),
      totalReps: int(g(row, 'total reps')),
      setsCount: int(g(row, 'total sets')),
      bodyBatteryDrain: int(g(row, 'body battery drain')),
      movingTimeSecs,
      trainingStressScore: num(g(row, 'training stress score')),
      source: 'garmin-activities-csv',
    });
  }
  return results;
}

// Key an activity for dedup/merge. Includes start time so two same-titled
// Garmin activities on the same day (e.g. two "Running" sessions) both survive.
// Falls back gracefully when time/title aren't present.
function activityKey(a) {
  return `${a.date}|${a.title || a.activityType || ''}|${a.time || ''}`;
}

export function mergeActivities(existing, incoming) {
  const byKey = new Map();
  for (const e of existing) byKey.set(activityKey(e), e);
  let added = 0, updated = 0;
  for (const e of incoming) {
    const key = activityKey(e);
    if (byKey.has(key)) { byKey.set(key, { ...byKey.get(key), ...e }); updated++; }
    else { byKey.set(key, e); added++; }
  }
  return { merged: [...byKey.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')), added, updated };
}
