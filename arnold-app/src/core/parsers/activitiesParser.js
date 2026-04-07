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
    const datePart = rawDate.slice(0, 10);
    const timePart = rawDate.length > 10 ? rawDate.slice(11, 19) : null;

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
      avgPaceRaw: g(row, 'avg pace') !== '--' ? g(row, 'avg pace') : null,
      bestPaceRaw: g(row, 'best pace') !== '--' ? g(row, 'best pace') : null,
      totalAscentFt,
      totalAscentM: totalAscentFt != null ? Math.round(totalAscentFt * 0.3048) : null,
      totalDescentFt,
      totalDescentM: totalDescentFt != null ? Math.round(totalDescentFt * 0.3048) : null,
      avgStrideLength: num(g(row, 'avg stride length')),
      avgPower: int(g(row, 'avg power')),
      maxPower: int(g(row, 'max power')),
      steps: int(g(row, 'steps')),
      bodyBatteryDrain: int(g(row, 'body battery drain')),
      movingTimeSecs,
      trainingStressScore: num(g(row, 'training stress score')),
      source: 'garmin-activities-csv',
    });
  }
  return results;
}

export function mergeActivities(existing, incoming) {
  const byKey = new Map();
  for (const e of existing) byKey.set(`${e.date}|${e.title}`, e);
  let added = 0, updated = 0;
  for (const e of incoming) {
    const key = `${e.date}|${e.title}`;
    if (byKey.has(key)) { byKey.set(key, { ...byKey.get(key), ...e }); updated++; }
    else { byKey.set(key, e); added++; }
  }
  return { merged: [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date)), added, updated };
}
