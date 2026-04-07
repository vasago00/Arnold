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
  const date = fullText.includes('TODAY')
    ? new Date().toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

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
  const today = new Date().toISOString().split('T')[0];
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
