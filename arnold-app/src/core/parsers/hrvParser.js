// ─── Garmin HRV Status CSV Parser ────────────────────────────────────────────

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function parseCSVLine(line) {
  const vals = []; let cur = '', inQ = false;
  for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; } else cur += ch; }
  vals.push(cur);
  return vals.map(v => v.trim().replace(/^"|"$/g, ''));
}

function parseHRVDate(raw) {
  if (!raw) return null;
  // "Mar 31" or "Apr 1"
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase().slice(0, 3)];
  if (!mo) return null;
  const day = parseInt(m[2], 10);
  const now = new Date();
  let year = now.getFullYear();
  // If month is in the future, use previous year
  const candidate = new Date(year, mo - 1, day);
  if (candidate > now) year--;
  return `${year}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function stripMs(v) {
  if (!v || v === '--') return null;
  const n = parseInt(v.replace(/ms/gi, '').trim(), 10);
  return isNaN(n) ? null : n;
}

function parseBaseline(v) {
  if (!v || v === '--') return { low: null, high: null };
  // "32ms - 47ms" or "32 - 47"
  const m = v.match(/(\d+)\s*(?:ms)?\s*-\s*(\d+)\s*(?:ms)?/i);
  if (!m) return { low: null, high: null };
  return { low: parseInt(m[1], 10), high: parseInt(m[2], 10) };
}

export function parseHRVCSV(text) {
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
    if (row.length < 2) continue;

    const rawDate = g(row, 'date');
    const date = parseHRVDate(rawDate);
    if (!date) continue;

    const overnightHRV = stripMs(g(row, 'overnight hrv'));
    const baseline = parseBaseline(g(row, 'baseline'));
    const sevenDayAvg = stripMs(g(row, '7d avg') || g(row, 'seven') || g(row, '7'));

    let status = 'balanced';
    if (overnightHRV != null && baseline.high != null && overnightHRV > baseline.high) status = 'elevated';
    else if (overnightHRV != null && baseline.low != null && overnightHRV < baseline.low) status = 'low';

    results.push({ date, overnightHRV, baselineLow: baseline.low, baselineHigh: baseline.high, sevenDayAvg, status });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeHRV(existing, incoming) {
  const byDate = new Map();
  for (const e of existing) byDate.set(e.date, e);
  let added = 0, updated = 0;
  for (const e of incoming) {
    if (byDate.has(e.date)) { byDate.set(e.date, { ...byDate.get(e.date), ...e }); updated++; }
    else { byDate.set(e.date, e); added++; }
  }
  return { merged: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)), added, updated };
}
