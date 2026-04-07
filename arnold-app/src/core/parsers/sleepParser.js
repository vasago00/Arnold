// ─── Garmin Sleep CSV Parser ─────────────────────────────────────────────────

function parseCSVLine(line) {
  const vals = []; let cur = '', inQ = false;
  for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; } else cur += ch; }
  vals.push(cur);
  return vals.map(v => v.trim().replace(/^"|"$/g, ''));
}

function num(v) { if (!v || v === '--') return null; const n = parseFloat(v.replace(/,/g, '')); return isNaN(n) ? null : n; }
function int(v) { if (!v || v === '--') return null; const n = parseInt(v.replace(/,/g, ''), 10); return isNaN(n) ? null : n; }

function parseDate(raw) {
  if (!raw) return null;
  // "2026-04-06"
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // "Apr 6, 2026" or "April 6, 2026"
  const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (m) { const mo = MONTHS[m[1].slice(0,3).toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[2].padStart(2,'0')}`; }
  // MM/DD/YYYY
  const m2 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
  const d = new Date(raw);
  return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function parseDuration(v) {
  if (!v || v === '--') return { minutes: null, formatted: null };
  // "8h 2min" or "7h 45min" or "8h" or "45min"
  const hm = v.match(/(\d+)\s*h\s*(?:(\d+)\s*min)?/i);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const m = hm[2] ? parseInt(hm[2], 10) : 0;
    return { minutes: h * 60 + m, formatted: `${h}h ${m}m` };
  }
  const mo = v.match(/(\d+)\s*min/i);
  if (mo) return { minutes: parseInt(mo[1], 10), formatted: `${mo[1]}m` };
  return { minutes: null, formatted: null };
}

function parseClock(v) {
  if (!v || v === '--') return null;
  // "11:21 PM" → "23:21"
  const m = v.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2];
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  // Already 24h
  const m2 = v.match(/(\d{1,2}):(\d{2})/);
  if (m2) return `${m2[1].padStart(2, '0')}:${m2[2]}`;
  return null;
}

export function parseSleepCSV(text) {
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

    // First column (Sleep Score 7 Days) contains the date
    const rawDate = row[0];
    const date = parseDate(rawDate);
    if (!date) continue;

    const dur = parseDuration(g(row, 'duration'));
    const need = parseDuration(g(row, 'sleep need'));

    results.push({
      date,
      sleepScore: int(g(row, 'score')),
      restingHR: int(g(row, 'resting heart rate')),
      bodyBattery: int(g(row, 'body battery')),
      pulseOx: num(g(row, 'pulse ox')),
      respiration: num(g(row, 'respiration')),
      hrvStatus: int(g(row, 'hrv status')),
      quality: g(row, 'quality') || null,
      durationMinutes: dur.minutes,
      durationFormatted: dur.formatted,
      sleepNeedMinutes: need.minutes,
      bedtime: parseClock(g(row, 'bedtime')),
      wakeTime: parseClock(g(row, 'wake time')),
    });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeSleep(existing, incoming) {
  const byDate = new Map();
  for (const e of existing) byDate.set(e.date, e);
  let added = 0, updated = 0;
  for (const e of incoming) {
    if (byDate.has(e.date)) { byDate.set(e.date, { ...byDate.get(e.date), ...e }); updated++; }
    else { byDate.set(e.date, e); added++; }
  }
  return { merged: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)), added, updated };
}
