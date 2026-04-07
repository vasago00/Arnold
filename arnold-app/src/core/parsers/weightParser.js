// ─── Garmin Weight CSV Parser ─────────────────────────────────────────────────
// Handles the two-row-per-entry format:
//   " Apr 6, 2026",                    ← date row
//   7:57 AM, 190.3 lbs, 0.9 lbs, ...  ← data row

const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

function parseCSVLine(line) {
  const vals = []; let cur = '', inQ = false;
  for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; } else cur += ch; }
  vals.push(cur);
  return vals.map(v => v.trim().replace(/^"|"$/g, ''));
}

function stripUnit(v, unit) {
  if (!v || v === '--' || v === '') return null;
  const n = parseFloat(v.replace(new RegExp(unit, 'gi'), '').replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
}

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // "Apr 6, 2026" or "April 6, 2026"
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function parseClock(v) {
  if (!v) return null;
  const m = v.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m) {
    let h = parseInt(m[1], 10);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  const m2 = v.trim().match(/(\d{1,2}):(\d{2})/);
  return m2 ? `${m2[1].padStart(2, '0')}:${m2[2]}` : null;
}

export function parseWeightCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 3) return [];

  // Skip header line
  const hdrs = parseCSVLine(lines[0]);
  // Detect if first line is headers
  const isHeader = hdrs.some(h => /time|weight/i.test(h));
  const startIdx = isHeader ? 1 : 0;

  const results = [];
  let currentDate = null;

  for (let i = startIdx; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (!row.length || row.every(v => !v)) continue;

    // Check if this is a date row: first cell looks like a date, and most other cells are empty
    const firstCell = row[0];
    const dateCandidate = parseDate(firstCell);
    const emptyCells = row.slice(1).filter(v => !v || v.trim() === '').length;

    if (dateCandidate && emptyCells >= row.length - 2) {
      currentDate = dateCandidate;
      continue;
    }

    // This is a data row — pair with currentDate
    if (!currentDate) continue;

    const time = parseClock(row[0]);
    const weightLbs = stripUnit(row[1], 'lbs');
    const changeLbs = stripUnit(row[2], 'lbs');
    const bmi = stripUnit(row[3], '');
    const bodyFatPct = stripUnit(row[4], '%');
    const skeletalMuscleMassLbs = stripUnit(row[5], 'lbs');
    const boneMassLbs = stripUnit(row[6], 'lbs');
    const bodyWaterPct = stripUnit(row[7], '%');

    results.push({
      date: currentDate,
      time,
      weightLbs,
      weightKg: weightLbs != null ? Math.round(weightLbs * 0.453592 * 10) / 10 : null,
      changeLbs,
      bmi,
      bodyFatPct,
      skeletalMuscleMassLbs,
      skeletalMuscleMassKg: skeletalMuscleMassLbs != null ? Math.round(skeletalMuscleMassLbs * 0.453592 * 10) / 10 : null,
      boneMassLbs,
      bodyWaterPct,
    });

    currentDate = null; // consume the date
  }

  return results.sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeWeight(existing, incoming) {
  const byDate = new Map();
  for (const e of existing) byDate.set(e.date, e);
  let added = 0, updated = 0;
  for (const e of incoming) {
    if (byDate.has(e.date)) { byDate.set(e.date, { ...byDate.get(e.date), ...e }); updated++; }
    else { byDate.set(e.date, e); added++; }
  }
  return { merged: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)), added, updated };
}
