// ─── Garmin Sleep CSV Parser ─────────────────────────────────────────────────

function parseCSVLine(line) {
  const vals = []; let cur = '', inQ = false;
  for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; } else cur += ch; }
  vals.push(cur);
  return vals.map(v => v.trim().replace(/^"|"$/g, ''));
}

function num(v) { if (!v || v === '--') return null; const n = parseFloat(v.replace(/,/g, '')); return isNaN(n) ? null : n; }
function int(v) { if (!v || v === '--') return null; const n = parseInt(v.replace(/,/g, ''), 10); return isNaN(n) ? null : n; }

const MONTHS_NUM = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const MONTHS_STR = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

function parseDate(raw) {
  if (!raw) return null;
  // "2026-04-06"
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // "Apr 6, 2026" or "April 6, 2026"
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (m) { const mo = MONTHS_STR[m[1].slice(0,3).toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[2].padStart(2,'0')}`; }
  // MM/DD/YYYY
  const m2 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
  const d = new Date(raw);
  return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// Detect weekly aggregate rows like "Apr 2-8" or "Mar 26 - Apr 1" (no year).
// Returns null if not a weekly range. Assumes year based on "today" — if the
// inferred range is in the future, rolls back a year. Returns an array of
// 7 ISO date strings covering the week.
function parseWeeklyRange(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const now = new Date();
  const curYear = now.getFullYear();
  const mkISO = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const expand = (startY,startM,startD,endY,endM,endD) => {
    const start = new Date(startY,startM-1,startD);
    const end = new Date(endY,endM-1,endD);
    if (end < start) return null;
    const out = [];
    const cur = new Date(start);
    while (cur <= end) { out.push(mkISO(cur.getFullYear(),cur.getMonth()+1,cur.getDate())); cur.setDate(cur.getDate()+1); }
    return out.length >= 2 && out.length <= 14 ? out : null;
  };
  // Same month: "Apr 2-8" or "Mar 19-25"
  let m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (m) {
    const mo = MONTHS_NUM[m[1].slice(0,3).toLowerCase()];
    if (!mo) return null;
    let y = curYear;
    if (new Date(y,mo-1,parseInt(m[3],10)) > now) y--;
    return expand(y,mo,parseInt(m[2],10),y,mo,parseInt(m[3],10));
  }
  // Crosses months: "Mar 26 - Apr 1"
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2})\s*[-–]\s*([A-Za-z]{3,})\s+(\d{1,2})$/);
  if (m) {
    const mo1 = MONTHS_NUM[m[1].slice(0,3).toLowerCase()];
    const mo2 = MONTHS_NUM[m[3].slice(0,3).toLowerCase()];
    if (!mo1 || !mo2) return null;
    const d1 = parseInt(m[2],10), d2 = parseInt(m[4],10);
    // End year logic first, then back-solve start year (handles Dec→Jan wrap)
    let y2 = curYear;
    if (new Date(y2,mo2-1,d2) > now) y2--;
    const y1 = (mo1 > mo2) ? y2 - 1 : y2;
    return expand(y1,mo1,d1,y2,mo2,d2);
  }
  return null;
}

function parseDuration(v) {
  if (!v || v === '--') return { minutes: null, formatted: null };
  // "8h 2min", "7h 45min", "5h 9m", "8h", "45min", "45m", "2m"
  const hm = v.match(/(\d+)\s*h(?:\s*(\d+)\s*m(?:in)?)?/i);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const m = hm[2] ? parseInt(hm[2], 10) : 0;
    return { minutes: h * 60 + m, formatted: `${h}h ${m}m` };
  }
  const mo = v.match(/(\d+)\s*m(?:in)?\b/i);
  if (mo) return { minutes: parseInt(mo[1], 10), formatted: `${mo[1]}m` };
  return { minutes: null, formatted: null };
}

// Garmin's sleep-stage columns use "h:mm" (e.g. "1:23" = 1h 23m) rather than
// the "Xh Ymin" duration format. Returns minutes, or null on unparseable.
function parseStageMinutes(v) {
  if (!v || v === '--') return null;
  const s = String(v).trim();
  // "1:23" → 83 min; "0:47" → 47 min
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  // Plain number assumed minutes
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
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

// ─── Key-Value CSV format (single-night Garmin export) ──────────────────────
// Newer Garmin "Sleep Score 1 Day" exports aren't tabular — they're a list of
// `<Label>,<Value>` pairs for one night, e.g.:
//   Sleep Score 1 Day,
//   Date,2026-04-20
//   Sleep Duration,5h 9m
//   Sleep Score,67
//   Deep Sleep Duration,1h 34m
//   REM Duration,45m
//   Resting Heart Rate,46 bpm
//   Avg Overnight HRV,36 ms
// Returns one sleep row, or [] if no Date present.
function isKeyValueFormat(lines) {
  // If any line matches "Date,<datelike>" (key-value style), treat as KV.
  // Tabular CSVs have "Date" as a column header, not a row key with a date value.
  for (const l of lines.slice(0, 12)) {
    if (/^\s*Date\s*,\s*\d{4}-\d{2}-\d{2}/.test(l)) return true;
    if (/^\s*Date\s*,\s*[A-Za-z]+\s+\d{1,2},?\s*\d{4}/.test(l)) return true;
    if (/^\s*Date\s*,\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(l)) return true;
  }
  return false;
}

function parseKeyValueSleep(lines) {
  const kv = {};
  for (const raw of lines) {
    if (!raw || !raw.trim()) continue;
    const idx = raw.indexOf(',');
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim().toLowerCase().replace(/^\uFEFF/, '');
    const val = raw.slice(idx + 1).trim();
    if (!key || !val) continue;
    // Assign only if not already set (preserves first occurrence — "Sleep Duration"
    // appears in both the top block and the "Sleep Score Factors" block with the
    // same value, so first-wins is equivalent and simpler).
    if (!(key in kv)) kv[key] = val;
  }

  const find = (...needles) => {
    for (const k of Object.keys(kv)) {
      if (needles.every(n => k.includes(n))) return kv[k];
    }
    return null;
  };

  const date = parseDate(find('date'));
  if (!date) return [];

  const dur = parseDuration(find('sleep', 'duration'));
  const deep = parseDuration(find('deep', 'duration')).minutes;
  const rem = parseDuration(find('rem', 'duration')).minutes;
  const light = parseDuration(find('light', 'duration')).minutes;
  const awake = parseDuration(find('awake')).minutes;

  // ── Sleep Score (Garmin's proprietary value, 0-100) ─────────────────────
  // Distinct from the section-header label "Sleep Score 1 Day" (which has
  // empty value and is filtered out at line 149). find('sleep','score') will
  // return the value of "Sleep Score" row.
  const score = int(find('sleep', 'score')) ?? int(find('score'));

  const rhr = int(find('resting', 'heart')) ?? int(find('resting', 'hr'));

  // ── HRV: split numeric vs qualitative ───────────────────────────────────
  // Garmin Sleep CSV emits two rows:
  //   "Avg Overnight HRV, 41 ms"   ← numeric night value (ms)
  //   "7d Avg HRV, Balanced"        ← qualitative weekly status (string)
  // Earlier code did int(find('hrv')) which matched the first occurrence
  // (numeric), stored 41 into a field named "hrvStatus", and silently
  // dropped the "Balanced" label. Now we split into two distinct fields.
  const overnightHRV = int(find('avg', 'overnight', 'hrv'));
  const hrvStatusLabel = (() => {
    // Try several forms of the qualitative HRV row
    const candidates = [
      find('7d', 'hrv'),
      find('weekly', 'hrv'),
      find('hrv', 'status'),
    ];
    const v = candidates.find(c => c != null);
    if (!v) return null;
    // Normalize: strip whitespace, keep only the label string
    return String(v).trim() || null;
  })();

  // ── Body Battery Change (overnight delta, NOT the morning score) ────────
  // The CSV row is literally "Body Battery Change, +49" — a NIGHTLY GAIN
  // measured by the watch. Earlier code stored this as `bodyBattery` which
  // implied an absolute morning value; tiles labeled "Body Battery" then
  // displayed +49 as if it were a 0-100 score. Renamed for clarity.
  // The actual morning Body Battery score requires Garmin Connect Wellness
  // sync (Phase 4 Worker integration); HC does not expose it.
  const bodyBatteryChange = int(find('body', 'battery', 'change'))
    ?? int(find('body', 'battery'));

  // ── New fields exposed for tile registry use ────────────────────────────
  // These are present in every Garmin Sleep CSV but were previously dropped
  // on import. Each is a distinct measurement, not redundant with the
  // existing fields:
  //   overnightHR  — average HR while asleep (different from RHR which is
  //                  the lowest sustained reading)
  //   pulseOxLow   — minimum SpO2 during the night (apnea / breathing
  //                  disruption indicator)
  //   respirationLow — minimum respiratory rate during the night
  //   overnightStress — Garmin's stress score during sleep (lower = more
  //                     restorative)
  //   restlessCount — number of restless moments / micro-arousals
  const overnightHR    = int(find('avg', 'overnight', 'heart'));
  const pulseOxLow     = num(find('lowest', 'spo'));
  const respirationLow = num(find('lowest', 'respiration'));
  const overnightStress = int(find('stress', 'avg'));
  const restlessCount  = int(find('restless'));

  const spo2 = num(find('avg', 'spo')) ?? num(find('spo'));
  const resp = num(find('avg', 'respiration')) ?? num(find('respiration'));
  const quality = find('quality');

  return [{
    date,
    sleepScore: score != null ? Math.min(score, 100) : null,
    restingHR: rhr,
    overnightHR,
    bodyBatteryChange,
    pulseOx: spo2,
    pulseOxLow,
    respiration: resp,
    respirationLow,
    overnightHRV,
    hrvStatus: hrvStatusLabel,
    overnightStress,
    restlessCount,
    quality: quality || null,
    durationMinutes: dur.minutes,
    durationFormatted: dur.formatted,
    sleepNeedMinutes: null,
    bedtime: parseClock(find('bedtime')),
    wakeTime: parseClock(find('wake', 'time')),
    deepSleepMinutes: deep,
    remSleepMinutes: rem,
    lightSleepMinutes: light,
    awakeMinutes: awake,
    source: 'garmin-kv',
  }];
}

export function parseSleepCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  // New Garmin single-night export is key-value, not tabular.
  if (isKeyValueFormat(lines)) return parseKeyValueSleep(lines);

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

    const rawDate = (row[0] || '').replace(/^\uFEFF/, '');
    const dur = parseDuration(g(row, 'duration'));
    const need = parseDuration(g(row, 'sleep need'));
    // DCY §8: preserve sleep stages. Match field names hc-sync.js writes so
    // consumers see one shape regardless of whether the night came from
    // Health Connect or a CSV import.
    const deepMin  = parseStageMinutes(g(row, 'deep sleep'));
    const remMin   = parseStageMinutes(g(row, 'rem sleep'));
    const lightMin = parseStageMinutes(g(row, 'light sleep'));
    const awakeMin = parseStageMinutes(g(row, 'awake'));

    // Tabular Garmin Sleep CSV — same field-rename treatment as the key-value
    // path. See parseKeyValueSleep for the rationale on bodyBatteryChange and
    // the HRV split.
    const overnightHRVCol = int(g(row, 'avg overnight hrv')) ?? int(g(row, 'overnight hrv'));
    const hrvStatusCol = (() => {
      const v = g(row, 'hrv status');
      if (v == null) return null;
      const s = String(v).trim();
      if (!s) return null;
      // If column literally contains a number (older Garmin exports stored
      // overnight HRV ms in a column named "HRV Status"), route to numeric
      // overnightHRV instead of the qualitative slot.
      if (/^\d+(?:\.\d+)?(?:\s*ms)?$/i.test(s)) return null;
      return s;
    })();
    const base = {
      sleepScore: int(g(row, 'score')),
      restingHR: int(g(row, 'resting heart rate')) ?? int(g(row, 'avg resting hr')) ?? int(g(row, 'rhr')) ?? int(g(row, 'resting hr')),
      overnightHR: int(g(row, 'avg overnight heart')) ?? int(g(row, 'overnight heart')),
      bodyBatteryChange: int(g(row, 'body battery change')) ?? int(g(row, 'body battery')),
      pulseOx: num(g(row, 'avg spo')) ?? num(g(row, 'pulse ox')) ?? num(g(row, 'spo')),
      pulseOxLow: num(g(row, 'lowest spo')) ?? num(g(row, 'min spo')),
      respiration: num(g(row, 'avg respiration')) ?? num(g(row, 'respiration')),
      respirationLow: num(g(row, 'lowest respiration')) ?? num(g(row, 'min respiration')),
      overnightHRV: overnightHRVCol,
      hrvStatus: hrvStatusCol,
      overnightStress: int(g(row, 'stress avg')) ?? int(g(row, 'avg stress')),
      restlessCount: int(g(row, 'restless')),
      quality: g(row, 'quality') || null,
      durationMinutes: dur.minutes,
      durationFormatted: dur.formatted,
      sleepNeedMinutes: need.minutes,
      bedtime: parseClock(g(row, 'bedtime')),
      wakeTime: parseClock(g(row, 'wake time')),
      deepSleepMinutes: deepMin,
      remSleepMinutes: remMin,
      lightSleepMinutes: lightMin,
      awakeMinutes: awakeMin,
    };

    // Weekly aggregate row ("Apr 2-8") → expand into 7 daily rows carrying averages
    const weekDates = parseWeeklyRange(rawDate);
    if (weekDates) {
      for (const d of weekDates) results.push({ date: d, ...base, source: 'weekly-avg' });
      continue;
    }

    // Daily row
    const date = parseDate(rawDate);
    if (!date) continue;
    results.push({ date, ...base });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeSleep(existing, incoming) {
  const byDate = new Map();
  for (const e of existing) byDate.set(e.date, e);
  let added = 0, updated = 0;
  for (const e of incoming) {
    if (byDate.has(e.date)) {
      const prev = byDate.get(e.date);
      // Prefer real daily rows over weekly-avg expanded rows.
      // Never let a weekly-avg overwrite a real (daily / health_connect) record.
      if (e.source === 'weekly-avg' && prev.source !== 'weekly-avg') continue;
      byDate.set(e.date, { ...prev, ...e }); updated++;
    } else {
      byDate.set(e.date, e); added++;
    }
  }
  return { merged: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)), added, updated };
}

// ── Utility: filter sleep data for reliable averaging ───────────────────────
// When computing averages, exclude synthetic weekly-avg rows if a real
// daily row exists for the same date. Also caps sleepScore at 100.
export function cleanSleepForAveraging(sleepData) {
  const byDate = new Map();
  for (const s of sleepData) {
    const prev = byDate.get(s.date);
    if (!prev || (prev.source === 'weekly-avg' && s.source !== 'weekly-avg')) {
      byDate.set(s.date, s);
    }
  }
  return [...byDate.values()].map(s => ({
    ...s,
    sleepScore: s.sleepScore != null ? Math.min(s.sleepScore, 100) : null,
  }));
}
