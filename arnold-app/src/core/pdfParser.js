// ─── ARNOLD PDF + CSV Workout Parser ─────────────────────────────────────────
// Extracts workout fields from Garmin Connect export PDFs and generic CSV files.

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ─── Date extraction from filename ───────────────────────────────────────────
// Handles: April_4_Run.pdf, April-4-2026.pdf, 2026-04-04.pdf, run_april_4.pdf
function extractDateFromFilename(filename) {
  const name = filename.toLowerCase().replace(/[_\-]/g, ' ');

  // ISO format: 2026-04-04
  const isoMatch = filename.match(/(\d{4})[_\-](\d{2})[_\-](\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const months = {
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
  };

  // Month name + day: "april 4", "apr 4"
  const monthMatch = name.match(/([a-z]+)\s+(\d{1,2})/);
  if (monthMatch && months[monthMatch[1]]) {
    const month = months[monthMatch[1]];
    const day = parseInt(monthMatch[2]);
    const year = new Date().getFullYear();
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  // Day + month: "4 april"
  const dayFirstMatch = name.match(/(\d{1,2})\s+([a-z]+)/);
  if (dayFirstMatch && months[dayFirstMatch[2]]) {
    const month = months[dayFirstMatch[2]];
    const day = parseInt(dayFirstMatch[1]);
    const year = new Date().getFullYear();
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  return null;
}

// ─── PDF extraction ───────────────────────────────────────────────────────────
export async function parseRunPDF(file) {
  const dateFromFilename = extractDateFromFilename(file.name);

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;

  let rawText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    rawText += content.items.map(item => item.str).join(' ') + '\n';
  }

  const result = extractGarminFields(rawText, file.name);
  // Prefer date from filename over PDF text
  result.date = dateFromFilename || result.date;
  return result;
}

// ─── Garmin Connect PDF field extraction (lap table + label fallback) ────────
function extractGarminFields(fullText, filename) {

  // ── STRATEGY A: Lap table row (April_4_Run.pdf style) ──────────────────
  // Page 3 has: "1 1:18:16 1:18:16 7.53 10:24 10:21 138 147 282 397 313"
  const lapRow = fullText.match(
    /\b1\s+(\d{1,2}:\d{2}:\d{2})\s+\d{1,2}:\d{2}:\d{2}\s+(\d+\.\d+)\s+(\d{1,2}:\d{2})\s+\d{1,2}:\d{2}\s+(\d{2,3})\s+(\d{2,3})\s+(\d{2,4})\s+\d+\s+(\d{2,4})/
  );

  let duration = null, durationMinutes = null;
  let distanceMi = null, distanceKm = null;
  let avgPacePerMi = null, avgPacePerKm = null;
  let avgHR = null, maxHR = null;
  let totalAscentFt = null, totalAscentM = null;
  let avgPowerW = null;

  if (lapRow) {
    duration = lapRow[1];
    const [lh, lm, ls] = duration.split(':').map(Number);
    durationMinutes = Math.round(lh * 60 + lm + ls / 60);
    distanceMi = parseFloat(lapRow[2]);
    distanceKm = parseFloat((distanceMi * 1.60934).toFixed(2));
    avgPacePerMi = lapRow[3];
    const [pm, ps] = avgPacePerMi.split(':').map(Number);
    const spk = (pm * 60 + ps) / 1.60934;
    avgPacePerKm = `${Math.floor(spk/60)}:${String(Math.round(spk%60)).padStart(2,'0')}`;
    avgHR = parseFloat(lapRow[4]);
    maxHR = parseFloat(lapRow[5]);
    totalAscentFt = parseFloat(lapRow[6]);
    totalAscentM = Math.round(totalAscentFt * 0.3048);
    avgPowerW = parseFloat(lapRow[7]);
  }

  // ── STRATEGY B: Label-based fallbacks (NY_run_April_4.pdf style) ────────

  // Duration — "1:18:16\nTime" (value BEFORE label)
  if (!duration) {
    const m = fullText.match(/(\d{1,2}:\d{2}:\d{2})\s*\n?\s*Time\b/);
    if (m) {
      duration = m[1];
      const [h,mn,s] = duration.split(':').map(Number);
      durationMinutes = Math.round(h*60 + mn + s/60);
    }
  }

  // Distance — "7.53 mi\nDistance"
  if (!distanceMi) {
    const m = fullText.match(/(\d+\.\d+)\s*mi\s*\n?\s*Distance/i);
    if (m) {
      distanceMi = parseFloat(m[1]);
      distanceKm = parseFloat((distanceMi * 1.60934).toFixed(2));
    }
  }

  // Avg pace — "10:24 /mi\nAvg Pace"
  if (!avgPacePerMi) {
    const m = fullText.match(/(\d{1,2}:\d{2})\s*\/\s*mi\s*\n?\s*Avg\s*Pace/i);
    if (m) {
      avgPacePerMi = m[1];
      const [pm2,ps2] = avgPacePerMi.split(':').map(Number);
      const spk2 = (pm2*60+ps2)/1.60934;
      avgPacePerKm = `${Math.floor(spk2/60)}:${String(Math.round(spk2%60)).padStart(2,'0')}`;
    }
  }

  // Avg HR — "138 bpm\nAvg HR"
  if (!avgHR) {
    const m = fullText.match(/(\d{2,3})\s*bpm\s*\n?\s*Avg\s*HR/i);
    if (m) avgHR = parseFloat(m[1]);
  }

  // Max HR — "147 bpm\nMax HR"
  if (!maxHR) {
    const m = fullText.match(/(\d{2,3})\s*bpm\s*\n?\s*Max\s*HR/i);
    if (m) maxHR = parseFloat(m[1]);
  }

  // Total ascent — "282 ft\nTotal Ascent"
  if (!totalAscentM) {
    const m = fullText.match(/(\d+)\s*ft\s*\n?\s*Total\s*Ascent/i);
    if (m) {
      totalAscentFt = parseFloat(m[1]);
      totalAscentM = Math.round(totalAscentFt * 0.3048);
    }
  }

  // Avg power — "313 W\nAvg Power"
  if (!avgPowerW) {
    const m = fullText.match(/(\d{2,4})\s*W\s*\n?\s*Avg\s*Power/i);
    if (m) avgPowerW = parseFloat(m[1]);
  }

  // ── CALORIES — always label-based, not in lap table ────────��────────────
  // "881\nActive Calories" — try both orderings
  const activeCalA = fullText.match(/(\d{3,4})\s*\n\s*Active\s*Calories/i);
  const activeCalB = fullText.match(/Active\s*Calories\s*\n\s*(\d{3,4})/i);
  // Also try inline: "881 Active Calories"
  const activeCalC = fullText.match(/(\d{3,4})\s+Active\s*Calories/i);
  const calories = activeCalA ? parseFloat(activeCalA[1])
    : activeCalB ? parseFloat(activeCalB[1])
    : activeCalC ? parseFloat(activeCalC[1])
    : null;

  // ── CADENCE — always label-based, on page 6 ──────────────────────────────
  // "164 spm\nAvg Run Cadence" — try both orderings
  const cadA = fullText.match(/(\d{3})\s*\n?\s*spm\s*\n?\s*Avg\s*Run\s*Cadence/i);
  const cadB = fullText.match(/Avg\s*Run\s*Cadence\s*\n?\s*(\d{3})\s*spm/i);
  // Also try inline: "164 spm Avg Run Cadence"
  const cadC = fullText.match(/(\d{3})\s+spm/i);
  const avgCadence = cadA ? parseFloat(cadA[1])
    : cadB ? parseFloat(cadB[1])
    : cadC ? parseFloat(cadC[1])
    : null;

  // ── DATE ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const localDateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const date = localDateStr;

  // ── TYPE ─────────────────────────────────────────────────────────────────
  const textL = fullText.toLowerCase();
  const type = textL.includes('running') ? 'Run (outdoor)'
    : textL.includes('treadmill') ? 'Run (treadmill)'
    : textL.includes('cycling') ? 'Cycling'
    : 'Run (outdoor)';

  // ── DEBUG ─────────────────────────────────────────────────────────────────
  if (typeof window !== 'undefined') window.__lastPdfRaw = fullText;

  return {
    date,
    type,
    distanceKm,
    distanceMi,
    duration,
    durationMinutes,
    avgPacePerKm,
    avgPacePerMi,
    totalAscentM,
    calories,
    avgHR,
    maxHR,
    avgCadence,
    avgPowerW,
    source: { type: 'pdf', filename: filename || 'unknown.pdf' },
    rawText: fullText,
  };
}

// ─── CSV single-activity extraction ──────────────────────────────────────────
export function parseWorkoutCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const values  = lines[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
  const row = {};
  headers.forEach((h, i) => { row[h] = values[i] || ''; });

  const get = (...keys) => {
    for (const k of keys) {
      const v = row[k] || row[k.replace(/ /g, '_')] || row[k.replace(/ /g, '')] || '';
      if (v) return v;
    }
    return null;
  };

  const rawDate    = get('date','activity date','start time','timestamp');
  const rawDist    = get('distance','distance (km)','distance (mi)','dist');
  const rawTime    = get('time','elapsed time','duration','moving time','total time');
  const rawHR      = get('avg hr','avg heart rate','average hr','average heart rate','heart rate avg');
  const rawMaxHR   = get('max hr','max heart rate','maximum hr');
  const rawCal     = get('calories','energy (kcal)','cal');
  const rawPace    = get('avg pace','pace','average pace');
  const rawCadence = get('avg cadence','cadence','avg run cadence');
  const rawAscent  = get('total ascent','elevation gain','ascent','climb','elevation');
  const rawPower   = get('avg power','power');

  // Distance → km
  let distanceKm = null, distanceMi = null;
  if (rawDist) {
    const n = parseFloat(rawDist);
    if (!isNaN(n)) {
      const distHeader = headers.find(h => h.includes('dist')) || '';
      const isMiles = distHeader.includes('mi') || String(rawDist).toLowerCase().includes('mi');
      if (isMiles) {
        distanceMi = n;
        distanceKm = +(n * 1.60934).toFixed(2);
      } else {
        distanceKm = n;
        distanceMi = +(n / 1.60934).toFixed(2);
      }
    }
  }

  // Duration → minutes
  let duration = rawTime || null;
  let durationMinutes = rawTime ? parseDurationToMinutes(rawTime) : null;
  if (durationMinutes != null) durationMinutes = Math.round(durationMinutes);

  // Pace
  let avgPacePerKm = null, avgPacePerMi = null;
  if (rawPace) {
    const pm = rawPace.match(/(\d{1,2})[:'′](\d{2})/);
    if (pm) {
      const paceStr = `${pm[1]}:${pm[2]}`;
      const paceHeader = headers.find(h => h.includes('pace')) || '';
      if (paceHeader.includes('mi') || rawPace.includes('/mi')) {
        avgPacePerMi = paceStr;
        const sec = parseInt(pm[1]) * 60 + parseInt(pm[2]);
        const kmSec = Math.round(sec / 1.60934);
        avgPacePerKm = `${Math.floor(kmSec / 60)}:${String(kmSec % 60).padStart(2, '0')}`;
      } else {
        avgPacePerKm = paceStr;
        const sec = parseInt(pm[1]) * 60 + parseInt(pm[2]);
        const miSec = Math.round(sec * 1.60934);
        avgPacePerMi = `${Math.floor(miSec / 60)}:${String(miSec % 60).padStart(2, '0')}`;
      }
    }
  }

  // Ascent
  let totalAscentM = null;
  if (rawAscent) {
    const n = parseFloat(rawAscent);
    if (!isNaN(n)) {
      const h = headers.find(h => h.includes('ascent') || h.includes('elevation') || h.includes('climb')) || '';
      const isFeet = h.includes('ft') || String(rawAscent).toLowerCase().includes('ft');
      totalAscentM = isFeet ? Math.round(n * 0.3048) : Math.round(n);
    }
  }

  return {
    date:           rawDate ? normaliseDate(rawDate) : null,
    type:           'Run (outdoor)',
    distanceKm,
    distanceMi,
    duration,
    durationMinutes,
    avgPacePerKm,
    avgPacePerMi,
    totalAscentM,
    calories:       rawCal  ? parseInt(rawCal) || null : null,
    avgHR:          rawHR   ? parseInt(rawHR) || null : null,
    maxHR:          rawMaxHR ? parseInt(rawMaxHR) || null : null,
    avgCadence:     rawCadence ? parseInt(rawCadence) || null : null,
    avgPowerW:      rawPower ? parseInt(rawPower) || null : null,
    source:         { type: 'csv', filename: 'upload.csv' },
    rawText:        text,
  };
}

// ─── Date matching ───────────────────────────────────────────────────────────
const MONTH_MAP = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  january:'01',february:'02',march:'03',april:'04',june:'06',
  july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
};

function matchDate(t) {
  // ISO: 2026-04-04
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // MM/DD/YYYY
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;

  // Apr 4, 2026
  m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const mon = MONTH_MAP[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2,'0')}`;
  }

  // 4 Apr 2026
  m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (m) {
    const mon = MONTH_MAP[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2,'0')}`;
  }

  return null;
}

function normaliseDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return matchDate(raw);
}

function parseDurationToMinutes(raw) {
  // h:mm:ss
  let m = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 60;
  // m:ss
  m = raw.match(/^(\d{1,3}):(\d{2})$/);
  if (m) return parseInt(m[1]) + parseInt(m[2]) / 60;
  // plain number
  const n = parseFloat(raw);
  if (!isNaN(n)) return n;
  return null;
}

// ─── Weather fetch (Open-Meteo historical + forecast) ────────────────────────
const WEATHER_CODES = {
  0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
  45:'Foggy',48:'Foggy',51:'Light drizzle',53:'Drizzle',
  61:'Light rain',63:'Moderate rain',65:'Heavy rain',
  71:'Light snow',73:'Moderate snow',80:'Rain showers',
  81:'Heavy showers',95:'Thunderstorm'
};

export async function fetchWeatherForDate(dateStr) {
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
  const isPast = dateStr < today;

  const baseUrl = isPast
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';

  const url = `${baseUrl}?latitude=40.7128&longitude=-74.0060&daily=temperature_2m_max,temperature_2m_min,weathercode,windspeed_10m_max,precipitation_sum&timezone=America%2FNew_York&start_date=${dateStr}&end_date=${dateStr}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();
    const daily = data.daily;
    if (!daily || !daily.temperature_2m_max) return null;

    return {
      date: dateStr,
      tempMaxF: Math.round(daily.temperature_2m_max[0] * 9/5 + 32),
      tempMinF: Math.round(daily.temperature_2m_min[0] * 9/5 + 32),
      tempMaxC: daily.temperature_2m_max[0],
      tempMinC: daily.temperature_2m_min[0],
      condition: WEATHER_CODES[daily.weathercode[0]] || 'Mixed conditions',
      windMph: Math.round(daily.windspeed_10m_max[0] * 0.621371),
      windKph: daily.windspeed_10m_max[0],
      precipitationMm: daily.precipitation_sum[0],
      source: isPast ? 'historical' : 'forecast'
    };
  } catch (err) {
    console.error('Weather fetch failed:', err);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CLINICAL PDF PARSING — DEXA · VO₂Max · RMR (DexaFit-style reports)
// ═════════════════════════════════════════════════════════════════════════════
// DexaFit and similar lab reports follow predictable layouts. We extract the
// raw text via pdfjs, then run a battery of regex patterns against it. Each
// metric uses a permissive label→value lookahead, so small layout variations
// (extra whitespace, line breaks, units adjacency) don't break extraction.
//
// The user gets a "preview before save" UX in the Clinical module so they
// can verify the parsed numbers look right before they hit confirm. Anything
// the parser missed renders as "—" and they can fill it in manually.

// ── Helpers ─────────────────────────────────────────────────────────────────
async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
}

// Permissive number-after-label match with optional value-range validation.
// Returns the FIRST number after any matching label that falls inside the
// allowed range. If a label-match yields a value outside the range (e.g.
// the digit inside "VT1" itself, or a footnote index), keep scanning the
// next match for that label and the next label after that.
//
// The range guard is essential — without it, "VT1 (Zone 2 boundary) 110 bpm"
// can match "VT1" then skip up to 80 non-digit chars and hit "2" from "Zone 2"
// before the real "110". Always pass [min, max] for any label that maps to a
// physiologically constrained value.
function findNum(text, labels, range = null) {
  // Allow legacy callers passing labels as varargs by detecting array shape
  if (!Array.isArray(labels)) labels = [labels];
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use \\b at start to avoid matching mid-word, smaller 40-char window so
    // we don't drift into adjacent fields.
    const re = new RegExp('\\b' + escaped + '\\b[^0-9\\-+]{0,40}([+\\-]?\\d+(?:\\.\\d+)?)', 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = parseFloat(m[1]);
      if (!Number.isFinite(v)) continue;
      if (range && (v < range[0] || v > range[1])) continue;
      return v;
    }
  }
  return null;
}

// Find a date in the PDF text. Tries MM/DD/YYYY, YYYY-MM-DD, "March 20, 2025".
function findDate(text) {
  const months = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
  // ISO
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // US format MM/DD/YYYY or M/D/YYYY
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [_, mm, dd, yyyy] = m;
    return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }
  // "March 20, 2025"
  m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m) {
    const month = months[m[1].toLowerCase()];
    return `${m[3]}-${String(month).padStart(2,'0')}-${String(parseInt(m[2])).padStart(2,'0')}`;
  }
  return null;
}

// ── Top-level dispatcher ────────────────────────────────────────────────────
// Sniffs the PDF text and routes to the right parser. Returns
// { type, date, source, filename, metrics, rawText } where rawText is the
// full extracted text — exposed so the UI can show a "raw text" debug view
// when the parser misses fields (and so the user can paste it back to a
// developer to refine patterns).
export async function parseClinicalPDF(file) {
  const text = await extractPdfText(file);
  const lower = text.toLowerCase();
  let result;
  // Order matters — VO2 reports often mention DEXA in the header, so check
  // VO2-specific tokens first.
  if (/vo[\s₂]?2.*max/i.test(lower) || /\bvo2max\b/i.test(lower) || /redline ratio/i.test(lower)) {
    result = parseVO2PDF(text, file);
  } else if (/resting metabolic|\brmr\b|metabolic rate/i.test(lower)) {
    result = parseRMRPDF(text, file);
  } else if (/dexa|body composition|dxa scan|t-?score|z-?score/i.test(lower)) {
    result = parseDexaPDF(text, file);
  } else {
    return { ok: false, error: 'unknown_clinical_pdf', filename: file.name, rawText: text };
  }
  result.rawText = text; // attach raw text for the debug view
  return result;
}

// ── DEXA parser ─────────────────────────────────────────────────────────────
// Tuned to current DexaFit report layout. Strategy is to anchor each main
// metric to its "<Label>   Change   Target" row, which DexaFit puts right
// before the actual value+unit. Regional fat / lean values come in
// predictable document order so we extract them positionally instead of by
// label-proximity (the PDF flows them with values BEFORE labels in pdfjs's
// linearized output).
function parseDexaPDF(text, file) {
  const m = {};

  // ── Helper: "<label>   Change   Target  <value> <unit>" extractor ──
  // DexaFit puts every primary metric in this exact format. Tolerant of
  // multiple whitespace patterns between fields.
  const fct = (label, unit = '', range = null) => {
    const escLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const unitPart = unit ? '\\s*' + unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    const re = new RegExp(escLabel + '\\s+Change\\s+Target[\\s\\S]{0,30}?(-?\\d+(?:\\.\\d+)?)' + unitPart, 'i');
    const mm = text.match(re);
    if (!mm) return null;
    const v = parseFloat(mm[1]);
    if (range && (v < range[0] || v > range[1])) return null;
    return v;
  };

  // ── Primary composition ──
  m.totalMass   = fct('Total mass', 'lbs', [80, 400]);
  m.bodyFatPct  = fct('Body Fat %', '%',  [3, 60]);
  m.leanMass    = fct('Lean mass', 'lbs', [50, 300]);
  m.visceralFat = fct('Visceral Fat', 'lbs', [0.1, 10]);
  m.tScore      = fct('T-Score', '', [-5, 6]);

  // ── Indices: ALMI, FFMI ──
  // Format: "ALMI   Change   Target  9.1 kg/m²   0 kg/m²   9.3 kg/m²"
  // Note: "kg/m²" has the superscript 2 char which pdfjs may emit as "²" or "2".
  m.almi = fct('ALMI', '', [4, 15]);
  m.ffmi = fct('FFMI', '', [12, 30]);

  // ── A/G Ratio: "ANDROID-TO-GYNOID RATIO (A/G RATIO)\n1.12" ──
  const agMatch = text.match(/A\/G RATIO\)?\s+(\d+(?:\.\d+)?)/i);
  if (agMatch) {
    const v = parseFloat(agMatch[1]);
    if (v >= 0.3 && v <= 2.5) m.agRatio = v;
  }

  // ── BMC: anchored to "X lbs This is the total lbs of bone mass" ──
  const bmcMatch = text.match(/(\d+(?:\.\d+)?)\s*lbs\s+This is the total/i);
  if (bmcMatch) {
    const v = parseFloat(bmcMatch[1]);
    if (v >= 1 && v <= 15) m.bmc = v;
  }

  // ── Body Score: "Body Score: B" in the scan history footer ──
  const bsMatch = text.match(/Body Score:\s+([A-F][+\-]?)\b/i);
  if (bsMatch) m.bodyScore = bsMatch[1];

  // ── Fat Mass: from scan history "187.3 baseline -- 46.3 baseline --" ──
  // The "baseline -- <num> baseline" pattern uniquely identifies fat mass
  // (sandwiched between total mass and lean mass in the scan history table).
  const fmMatch = text.match(/baseline\s+--\s+(\d+(?:\.\d+)?)\s+baseline/i);
  if (fmMatch) {
    const v = parseFloat(fmMatch[1]);
    if (v >= 5 && v <= 200) m.fatMass = v;
  }

  // ── BMD by region: anchored to "BONE MINERAL DENSITY (BMD) - g/cm²" ──
  // Within that section, format is value-then-label: "1.48  Total Body  2.59  Head  ..."
  const bmdSec = text.match(/BONE MINERAL DENSITY[\s\S]{0,500}/i);
  if (bmdSec) {
    const sec = bmdSec[0];
    const find = (label) => {
      const escLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(\\d+(?:\\.\\d+)?)\\s+' + escLabel + '\\b', 'i');
      const mm = sec.match(re);
      if (!mm) return null;
      const v = parseFloat(mm[1]);
      if (v >= 0.5 && v <= 2.5) return v;
      return null;
    };
    const tot = find('Total Body'); if (tot != null) m.bmdTotal = tot;
    const sp  = find('Spine');      if (sp  != null) m.bmdSpine = sp;
    const lg  = find('Legs');       if (lg  != null) m.bmdLegs  = lg;
    const ar  = find('Arms');       if (ar  != null) m.bmdArms  = ar;
    const hd  = find('Head');       if (hd  != null) m.bmdHead  = hd;
    const tr  = find('Trunk');      if (tr  != null) m.bmdTrunk = tr;
    const pv  = find('Pelvis');     if (pv  != null) m.bmdPelvis = pv;
    const rb  = find('Ribs');       if (rb  != null) m.bmdRibs   = rb;
  }

  // ── Regional fat % and lean lbs: positional extraction ──
  // pdfjs flows the PDF text such that "X% Y lbs" pairs appear in this
  // order: [body-fat-Total, body-fat-Arms, body-fat-Trunk, body-fat-Legs,
  //         lean-Total, lean-Arms, lean-Trunk, lean-Legs].
  // We iterate all matches once, then assign by index — much more robust
  // than trying to anchor each value to its label since labels appear
  // either before or after their values inconsistently.
  const allMatches = [];
  const pairRe = /(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*lbs/g;
  let pm;
  while ((pm = pairRe.exec(text)) !== null) {
    allMatches.push({ pct: parseFloat(pm[1]), lbs: parseFloat(pm[2]) });
  }
  // Body fat regional (% values) — entries [1..3] are arms/trunk/legs
  if (allMatches.length >= 4) {
    if (allMatches[1].pct >= 3 && allMatches[1].pct <= 60) m.fatArms  = allMatches[1].pct;
    if (allMatches[2].pct >= 3 && allMatches[2].pct <= 60) m.fatTrunk = allMatches[2].pct;
    if (allMatches[3].pct >= 3 && allMatches[3].pct <= 60) m.fatLegs  = allMatches[3].pct;
  }
  // Lean mass regional (lbs values) — entries [5..7] are arms/trunk/legs
  if (allMatches.length >= 8) {
    if (allMatches[5].lbs >=  5 && allMatches[5].lbs <=  50) m.leanArms  = allMatches[5].lbs;
    if (allMatches[6].lbs >= 20 && allMatches[6].lbs <= 150) m.leanTrunk = allMatches[6].lbs;
    if (allMatches[7].lbs >= 15 && allMatches[7].lbs <= 120) m.leanLegs  = allMatches[7].lbs;
  }

  // Strip nulls
  for (const k of Object.keys(m)) {
    if (m[k] == null || (typeof m[k] === 'number' && Number.isNaN(m[k]))) delete m[k];
  }

  return {
    ok: true,
    type: 'dexa',
    date: findDate(text) || null,
    source: 'pdf',
    filename: file.name,
    metrics: m,
  };
}

// ── VO₂Max parser ───────────────────────────────────────────────────────────
// Tuned to current DexaFit report layout. Key challenge — the report contains
// a reference table at the bottom listing world-record values like
// "HIGHEST MALE VO2MAX = 97.5" and "HIGHEST FEMALE VO2MAX = 78.6 Joan Benoit"
// which all fall in the physiological VO2max range. To avoid those, we
// REQUIRE the user's VO2max to be adjacent to the unit "ml/min/kg" or have a
// "Change ... Target" structure, since reference values don't have units.
function parseVO2PDF(text, file) {
  const m = {};

  // ── VO2max — DexaFit-specific anchored patterns ──
  // Pattern A: "X ml/min/kg" or "X ml/kg/min" (units immediately follow value).
  // The "VO 2 MAX   Change   Target  51 ml/min/kg" line guarantees this match.
  // Reference values (Oscar Svendsen, Joan Benoit) don't have units after them.
  let vo2 = null;
  const unitMatch = text.match(/(\d{2}(?:\.\d+)?)\s*ml\s*\/\s*(?:min\s*\/\s*kg|kg\s*\/\s*min)/i);
  if (unitMatch) {
    const v = parseFloat(unitMatch[1]);
    if (v >= 15 && v <= 95) vo2 = v;
  }
  // Pattern B fallback: number after "VO 2 MAX" header but BEFORE the
  // reference table (which starts with "HIGHEST" or "MAYO CLINIC").
  if (vo2 == null) {
    const headerSlice = text.split(/HIGHEST\s+(MALE|FEMALE)\s+VO2/i)[0];
    const m2 = headerSlice.match(/VO\s*2\s*MAX[^0-9]{0,200}(\d{2}(?:\.\d+)?)/i);
    if (m2) {
      const v = parseFloat(m2[1]);
      if (v >= 15 && v <= 95) vo2 = v;
    }
  }
  if (vo2 != null) m.vo2max = vo2;

  // ── Ventilatory thresholds — DexaFit format: "VT 1   110  /  67%   33%" ──
  // Anchor to label + space-separated number BEFORE the percent breakdown.
  const vt1Match = text.match(/VT\s*1\s+(\d{2,3})\s*\/?\s*\d/i);
  if (vt1Match) {
    const v = parseInt(vt1Match[1]);
    if (v >= 60 && v <= 200) m.vt1 = v;
  }
  const vt2Match = text.match(/VT\s*2\s+(\d{2,3})\s*\/?\s*\d/i);
  if (vt2Match) {
    const v = parseInt(vt2Match[1]);
    if (v >= 60 && v <= 200) m.vt2 = v;
  }

  // ── Zones — DexaFit format: "ZONE 1  LOW  ...  82-99  BEATS/MIN" ──
  // Use lazy `[\s\S]{0,200}?` with BEATS as the anchor — this is robust to
  // digits inside the zone description (Zone 4's blurb contains "VO2 max
  // improvement" which has a digit; the previous [^0-9] character class
  // couldn't span past it).
  const zoneRange = (label) => {
    const re = new RegExp(label + '\\b[\\s\\S]{0,200}?(\\d{2,3})\\s*[–\\-]\\s*(\\d{2,3})\\s*BEATS', 'i');
    const mm = text.match(re);
    if (mm) {
      const lo = parseInt(mm[1]), hi = parseInt(mm[2]);
      if (lo >= 60 && hi <= 220 && hi > lo) return [lo, hi];
    }
    return null;
  };
  const z1 = zoneRange('ZONE\\s*1');
  const z2 = zoneRange('ZONE\\s*2');
  const z3 = zoneRange('ZONE\\s*3');
  const z4 = zoneRange('ZONE\\s*4');
  if (z1) m.zone1 = z1;
  if (z2) m.zone2 = z2;
  if (z3) m.zone3 = z3;
  if (z4) m.zone4 = z4;
  // Max HR derived from Zone 4 upper bound (Zone 4 = peak HR zone)
  if (z4 && z4[1]) m.maxHR = z4[1];

  // ── Optional fields (older DexaFit reports had these; current ones don't) ──
  // Safe to attempt — range guards prevent false matches.
  const bioAge = findNum(text, ['biological age', 'fitness age'], [15, 90]);
  if (bioAge != null) m.bioAge = bioAge;
  const redline = findNum(text, ['redline ratio'], [40, 100]);
  if (redline != null) m.redlineRatio = redline;
  const leanVO2 = findNum(text, ['lean vo2', 'lean vo₂'], [30, 150]);
  if (leanVO2 != null) m.leanVO2 = leanVO2;

  // Strip any leftover nulls
  for (const k of Object.keys(m)) {
    if (m[k] == null || (typeof m[k] === 'number' && Number.isNaN(m[k]))) delete m[k];
  }

  return {
    ok: true,
    type: 'vo2max',
    date: findDate(text) || null,
    source: 'pdf',
    filename: file.name,
    metrics: m,
  };
}

// ── RMR parser ──────────────────────────────────────────────────────────────
// Tuned to DexaFit RMR report. Two layout-specific things to handle:
//   1. Calorie numbers use thousands separators ("1,880" not "1880").
//   2. Peer-average value is labeled simply "All" — too generic for findNum,
//      so we anchor to the specific "Predicted X All Y" sequence.
function parseRMRPDF(text, file) {
  const m = {};
  // Helper: parse "1,880" → 1880
  const num = (s) => {
    if (s == null) return null;
    const v = parseFloat(String(s).replace(/,/g, ''));
    return Number.isFinite(v) ? v : null;
  };
  // Number pattern: matches both "1,880" (comma-separated) AND "2256" (plain
  // 4+ digit). The previous pattern required commas for >3 digit numbers,
  // which broke TDEE extraction since DexaFit's table renders TDEE values
  // without comma separators ("2256" not "2,256"). Order matters — try
  // comma-form first, fall back to plain digits.
  const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';

  // ── RMR: "RESTING METABOLIC RATE (RMR)  1,880  FAST" ──
  let mm = text.match(new RegExp('RESTING METABOLIC RATE\\s*\\(RMR\\)\\s+' + NUM, 'i'));
  if (mm) {
    const v = num(mm[1]);
    if (v != null && v >= 800 && v <= 4500) m.rmr = v;
  }

  // ── Predicted: "Predicted   1,783" ──
  mm = text.match(new RegExp('\\bPredicted\\s+' + NUM, 'i'));
  if (mm) {
    const v = num(mm[1]);
    if (v != null && v >= 800 && v <= 4500) m.predicted = v;
  }

  // ── Peer average: "Predicted   1,783   All   1,905" ──
  // Anchor through Predicted+number to avoid matching the word "All" elsewhere.
  mm = text.match(new RegExp('Predicted\\s+' + NUM + '\\s+All\\s+' + NUM, 'i'));
  if (mm) {
    const v = num(mm[2]);
    if (v != null && v >= 800 && v <= 4500) m.peerAvg = v;
  }

  // ── RER: "PRIMARY FUEL SOURCE (RER)  0.84" ──
  mm = text.match(/\(RER\)\s+(\d+\.\d+)/i);
  if (mm) {
    const v = parseFloat(mm[1]);
    if (v >= 0.7 && v <= 1.0) m.rer = v;
  }

  // ── Fat % / Carbs %: "Fat   Carbs 53%   47%" ──
  mm = text.match(/Fat\s+Carbs\s+(\d{1,3})\s*%\s+(\d{1,3})\s*%/i);
  if (mm) {
    const fat = parseInt(mm[1]), carbs = parseInt(mm[2]);
    if (fat >= 0 && fat <= 100) m.fatPct = fat;
    if (carbs >= 0 && carbs <= 100) m.carbsPct = carbs;
  }

  // ── TDEE values: "Sedentary  Desk job ...   1256-1756   2256   2506-2756" ──
  // Pattern for each activity level: <label>...<range>-<range>   <TDEE>   <range>-<range>
  // The TDEE single number sits between the fatLoss range and leanGain range.
  const tdeeFor = (label) => {
    const escLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escLabel + '[\\s\\S]{0,200}?\\d+-\\d+\\s+' + NUM + '\\s+\\d+-\\d+', 'i');
    const mmm = text.match(re);
    if (!mmm) return null;
    const v = num(mmm[1]);
    return (v != null && v >= 1000 && v <= 7000) ? v : null;
  };
  const sed = tdeeFor('Sedentary');             if (sed != null) m.tdeeSedentary     = sed;
  const lit = tdeeFor('Lightly Active');        if (lit != null) m.tdeeLightlyActive = lit;
  const mod = tdeeFor('Moderately Active');     if (mod != null) m.tdeeModerate      = mod;
  const vac = tdeeFor('Very Active');           if (vac != null) m.tdeeVeryActive    = vac;
  const ext = tdeeFor('Extremely Active');      if (ext != null) m.tdeeExtreme       = ext;

  // Strip nulls
  for (const k of Object.keys(m)) {
    if (m[k] == null || (typeof m[k] === 'number' && Number.isNaN(m[k]))) delete m[k];
  }

  return {
    ok: true,
    type: 'rmr',
    date: findDate(text) || null,
    source: 'pdf',
    filename: file.name,
    metrics: m,
  };
}
