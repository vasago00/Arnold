// ─── Race Focus Card ─────────────────────────────────────────────────────────
// Phase 4r.race.6 — full redesign per user feedback:
//   • Collapsed state = ONE LINE (name · countdown · date · weather)
//   • Expanded state = two-column layout (inputs left, fuel schedule right)
//   • Visual icons (bowl for pre-race, gel capsule for during, water drop)
//   • Pre-plan fuel for half+ marathons (text-entry list, persisted per race)
//   • Single-digit pace input ("9" → "9:00") now parses correctly
//   • Post-race nutrition removed (already covered by the Fuel/Play tab)
//   • Inputs smaller; Apply button matches input height
//   • No more "Readiness vs Goal" (kept removed from 4r.race.5)

import { useEffect, useState, useMemo, useRef } from "react";
import { parseLocalDate } from "../core/dateUtils.js";
import {
  buildRaceFuelingPlan,
  parsePaceSecs,
  parseFinishMin,
  secsToPaceStr,
  minToTimeStr,
  inferDistanceMi,
} from "../core/raceFueling.js";

// ── Condition info ───────────────────────────────────────────────────────────
const WMO = {
  0:  { icon: "☀", label: "Clear",         color: "#fbbf24" },
  1:  { icon: "🌤", label: "Mostly clear",  color: "#fbbf24" },
  2:  { icon: "⛅", label: "Partly cloudy", color: "#a3a3a3" },
  3:  { icon: "☁",  label: "Overcast",      color: "#94a3b8" },
  45: { icon: "🌫", label: "Fog",           color: "#cbd5e1" },
  48: { icon: "🌫", label: "Rime fog",      color: "#cbd5e1" },
  51: { icon: "🌦", label: "Drizzle",       color: "#60a5fa" },
  53: { icon: "🌦", label: "Drizzle",       color: "#60a5fa" },
  55: { icon: "🌧", label: "Heavy drizzle", color: "#60a5fa" },
  61: { icon: "🌧", label: "Light rain",    color: "#3b82f6" },
  63: { icon: "🌧", label: "Rain",          color: "#3b82f6" },
  65: { icon: "🌧", label: "Heavy rain",    color: "#2563eb" },
  71: { icon: "🌨", label: "Light snow",    color: "#e0f2fe" },
  73: { icon: "🌨", label: "Snow",          color: "#e0f2fe" },
  75: { icon: "❄",  label: "Heavy snow",    color: "#e0f2fe" },
  80: { icon: "🌧", label: "Showers",       color: "#3b82f6" },
  81: { icon: "🌧", label: "Showers",       color: "#3b82f6" },
  82: { icon: "⛈", label: "Heavy showers", color: "#8b5cf6" },
  95: { icon: "⛈", label: "Thunderstorm",  color: "#a855f7" },
  96: { icon: "⛈", label: "Storm + hail",  color: "#a855f7" },
  99: { icon: "⛈", label: "Severe storm",  color: "#a855f7" },
};
const wmoInfo = code => WMO[code] || { icon: "•", label: "—", color: "#94a3b8" };

// ── Icons (inline SVG, Tabler-style outline) ─────────────────────────────────
const BowlIcon = ({ size = 18, color = '#fb923c' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11h18"/><path d="M5 11a7 7 0 0 0 14 0"/>
    <path d="M6 5l1 -2"/><path d="M11 5l-0.5 -2"/><path d="M16 5l1 -2"/>
  </svg>
);
// Phase 4r.race.8 — gel sachet redrawn as a flexible-pouch shape with a
// tear-corner notch and a content-level line, like real Maurten/GU/SiS
// packets. The previous capsule shape read as a pill bottle, which is wrong.
const GelIcon = ({ size = 18, color = '#22d3ee' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* Pouch silhouette — rounded soft-pouch */}
    <path d="M8 4h6l1.5 2v13a2 2 0 0 1 -2 2h-5a2 2 0 0 1 -2 -2v-13z"/>
    {/* Torn corner / tear-off notch at top-right */}
    <path d="M14 4l1.5 2"/>
    {/* Faint horizontal seam where you'd squeeze the gel out */}
    <path d="M9 13h4"/>
  </svg>
);
const DropIcon = ({ size = 14, color = '#60a5fa' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l5.5 8.5a6.5 6.5 0 1 1 -11 0z"/>
  </svg>
);
const PlusIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
       strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14"/>
  </svg>
);
const XIcon = ({ size = 12, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
       strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M6 18L18 6"/>
  </svg>
);

// ── Lenient input normalizers ────────────────────────────────────────────────
// "8:30", "830", "9", "8.30", "8 30" → "8:30" / "9:00"
function normalizePaceStr(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  s = s.replace(/[^\d:]/g, '');
  if (s.includes(':')) {
    const [m, sec = ''] = s.split(':');
    if (!m) return '';
    const minNum = parseInt(m, 10);
    if (!sec) return `${minNum}:00`;
    return `${minNum}:${sec.padStart(2, '0').slice(0, 2)}`;
  }
  // Phase 4r.race.7 — sane two-digit interpretation.
  //   "9"   → "9:00"   (single digit = minutes only)
  //   "10"  → "10:00"  (two digits = minutes only, NOT "1:00")
  //   "12"  → "12:00"
  //   "830" → "8:30"   (three digits = M:SS)
  //   "1030" → "10:30" (four digits = MM:SS)
  // The previous 2-digit rule treated "10" as "1:00" which is nonsensical
  // for running pace — nobody runs 60 sec/mile.
  if (s.length === 1) return `${s}:00`;
  if (s.length === 2) return `${s}:00`;
  if (s.length === 3) return `${s[0]}:${s.slice(1)}`;
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2)}`;
  return s.slice(0, 5);
}

function normalizeFinishStr(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  s = s.replace(/[^\d:]/g, '');
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length === 2) {
      const [a, b] = parts;
      if (!a) return '';
      return `${parseInt(a, 10)}:${b.padStart(2, '0').slice(0, 2)}`;
    }
    if (parts.length === 3) {
      const [h, m, sec] = parts;
      return `${parseInt(h || '0', 10)}:${(m || '').padStart(2, '0').slice(0,2)}:${(sec || '').padStart(2, '0').slice(0,2)}`;
    }
    return s;
  }
  // Phase 4r.race.7 — fix 2-digit finish (was returning bare "45" which
  // doesn't parse as a finish time). Treat 1-2 digits as minutes-only.
  if (s.length === 1) return `${s}:00`;
  if (s.length === 2) return `${s}:00`;
  if (s.length === 3) return `${s[0]}:${s.slice(1)}`;
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2)}`;
  if (s.length === 5) return `${s[0]}:${s.slice(1, 3)}:${s.slice(3)}`;
  if (s.length === 6) return `${s.slice(0,2)}:${s.slice(2,4)}:${s.slice(4)}`;
  return s.slice(0, 7);
}

const isPaceValid = (s) => parsePaceSecs(s) != null;
const isFinishValid = (s) => parseFinishMin(s) != null;

const fmtMinAsClock = (mins) => {
  if (!Number.isFinite(mins) || mins < 0) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m} min`;
};

// ── Component ────────────────────────────────────────────────────────────────
export function RaceFocusCard({ race, goalPaceSecs, avgPace30, fmtPace, planned, plannedTypeLabel, profile, sweatRateLbsPerHr, mobile = false, onNavigateToFuel = null }) {
  const [weather, setWeather] = useState(null);
  const [weatherState, setWeatherState] = useState("idle");

  // Phase 4r.race.9 — sized so the rendered text actually fits.
  // Mono digits in this app's font are ~9px at 14px size; "8:00" needs ~36px
  // content, "1:44:48" needs ~64px content. Add 16px horizontal padding +
  // 2px border = 54px / 82px minimum. We use 70 / 96 with a 4px safety
  // margin so the value never clips no matter the font fallback.
  // Phase 4r.viz.22 — mobile inputs match web exactly: fontSize 12 (not
  // 14). The bigger 14px font was the real reason mobile boxes looked
  // tall — text glyph at 14px overflowed the 22px-tall box, forcing the
  // browser to expand it. With 12px, the box fits as expected.
  const SZ = mobile ? {
    title: 13, days: 11, dateLbl: 11, dist: 12,
    metaLine: 11, wxLine: 11,
    inputLbl: 10, inputFs: 12, inputW: 76, inputWFinish: 76,
    rowLbl: 11, rowVal: 12, rowSub: 10,
    note: 10, applyFs: 12,
  } : {
    title: 15, days: 11, dateLbl: 10, dist: 11,
    metaLine: 11, wxLine: 11,
    inputLbl: 10, inputFs: 12, inputW: 70, inputWFinish: 70,
    rowLbl: 11, rowVal: 12, rowSub: 10,
    note: 10, applyFs: 11,
  };

  const raceKey = race?.id || `${race?.name || ''}|${race?.date || ''}`;
  const overrideKey = `arnold:race-fuel:${raceKey}`;

  const [expanded, setExpanded] = useState(false);
  const [paceInput, setPaceInput] = useState('');
  const [finishInput, setFinishInput] = useState('');
  const [lastEdited, setLastEdited] = useState(null);
  const [paceUncommitted, setPaceUncommitted] = useState(false);
  const [finishUncommitted, setFinishUncommitted] = useState(false);
  const [flashField, setFlashField] = useState(null);
  const flashTimerRef = useRef(null);
  const [didInitialFill, setDidInitialFill] = useState(false);
  // Phase 4r.race.7 — clear-on-focus pattern. We save the pre-focus value
  // in a ref so onBlur can restore it if the user didn't type anything.
  const paceBeforeFocusRef = useRef(null);
  const finishBeforeFocusRef = useRef(null);

  // Phase 4r.race.8 — custom-fuel state removed from this component;
  // planning lives in the Fuel tab now. The localStorage key is still
  // reserved so a future Fuel-tab implementation can read it without
  // colliding.

  // Load saved overrides on first render.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(overrideKey) || 'null');
      if (saved) {
        if (saved.pace) setPaceInput(saved.pace);
        if (saved.finish) setFinishInput(saved.finish);
        setDidInitialFill(true);
      }
    } catch {}
  }, [overrideKey]);

  useEffect(() => {
    try {
      const payload = {};
      if (paceInput) payload.pace = paceInput;
      if (finishInput) payload.finish = finishInput;
      if (Object.keys(payload).length) localStorage.setItem(overrideKey, JSON.stringify(payload));
      else localStorage.removeItem(overrideKey);
    } catch {}
  }, [overrideKey, paceInput, finishInput]);

  const distanceMi = useMemo(() => {
    if (!race) return null;
    let d = Number(race.distanceMi) || (Number(race.distanceKm) > 0 ? Number(race.distanceKm) * 0.621371 : null);
    if (!d || d <= 0) d = inferDistanceMi(race.name);
    return d && d > 0 ? d : null;
  }, [race]);

  // Pre-plan fuel only for half-marathon-and-up — shorter races don't usually
  // need detailed planning, just one or two gels.
  const supportsCustomPlanning = distanceMi != null && distanceMi >= 13.0;

  const commitPace = () => {
    const norm = normalizePaceStr(paceInput);
    setPaceInput(norm);
    setLastEdited('pace');
    setPaceUncommitted(false);
    if (isPaceValid(norm)) {
      const secs = parsePaceSecs(norm);
      if (secs && distanceMi) {
        const totalMin = (secs * distanceMi) / 60;
        const derived = minToTimeStr(totalMin);
        if (derived && derived !== finishInput) {
          setFinishInput(derived);
          setFinishUncommitted(false);
        }
      }
      setFlashField('pace');
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashField(null), 900);
    }
  };
  const commitFinish = () => {
    const norm = normalizeFinishStr(finishInput);
    setFinishInput(norm);
    setLastEdited('finish');
    setFinishUncommitted(false);
    if (isFinishValid(norm)) {
      const totalMin = parseFinishMin(norm);
      if (totalMin && distanceMi) {
        const paceSecs = (totalMin * 60) / distanceMi;
        const derived = secsToPaceStr(paceSecs);
        if (derived && derived !== paceInput) {
          setPaceInput(derived);
          setPaceUncommitted(false);
        }
      }
      setFlashField('finish');
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashField(null), 900);
    }
  };

  // Weather fetch (unchanged from prior).
  useEffect(() => {
    if (!race?.location) return;
    const raceDate = parseLocalDate(race.date);
    if (!raceDate) return;
    const raceMid = new Date(raceDate); raceMid.setHours(0, 0, 0, 0);
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    const days = Math.round((raceMid - todayMid) / 86400000);
    if (days < 0) { setWeatherState("error"); return; }
    let cancelled = false;
    setWeatherState("loading");
    (async () => {
      try {
        const parts = race.location.split(',').map(s=>s.trim()).filter(Boolean);
        const candidates = [race.location];
        if (parts.length >= 2) candidates.push(parts.slice(1).join(', '), parts[1], parts[parts.length-1]);
        let loc = null;
        for (const q of candidates) {
          try {
            const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
            const gj = await g.json();
            if (gj?.results?.[0]) { loc = gj.results[0]; break; }
          } catch {}
        }
        if (!loc) throw new Error("geocode");
        const mm = String(raceDate.getMonth()+1).padStart(2,"0");
        const dd = String(raceDate.getDate()).padStart(2,"0");
        let url, historical = false;
        if (days <= 16) {
          const dateStr = `${raceDate.getFullYear()}-${mm}-${dd}`;
          url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,relative_humidity_2m_max,apparent_temperature_max,precipitation_probability_max&temperature_unit=fahrenheit&start_date=${dateStr}&end_date=${dateStr}`;
        } else {
          const y = raceDate.getFullYear() - 1;
          const dateStr = `${y}-${mm}-${dd}`;
          url = `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,relative_humidity_2m_max,apparent_temperature_max,precipitation_sum&temperature_unit=fahrenheit&start_date=${dateStr}&end_date=${dateStr}`;
          historical = true;
        }
        const f = await fetch(url);
        const fj = await f.json();
        if (cancelled) return;
        const d = fj?.daily;
        if (!d?.weathercode?.[0] && d?.weathercode?.[0] !== 0) throw new Error("forecast");
        const tMaxF = d.temperature_2m_max[0];
        const tMaxC = (tMaxF - 32) * (5/9);
        setWeather({
          code: d.weathercode[0],
          tMax: Math.round(tMaxF),
          tMin: Math.round(d.temperature_2m_min[0]),
          tMaxC: +tMaxC.toFixed(1),
          humidityPct: d.relative_humidity_2m_max?.[0] ?? null,
          feelsLikeF: d.apparent_temperature_max?.[0] != null ? Math.round(d.apparent_temperature_max[0]) : null,
          precip: d.precipitation_probability_max?.[0] ?? null,
          historical,
        });
        setWeatherState("ready");
      } catch {
        if (!cancelled) setWeatherState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [race?.location, race?.date]);

  const accent = '#fbbf24';
  const panel = {
    position: 'relative',
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    // Phase 4r.race.10 — even tighter collapsed strip (was 5/10/5/12,
    // now 3/10/3/12). Keeps the strip just tall enough for the line of
    // text without padding around it.
    // Phase 4r.viz.18 — explicit fixed height on collapsed strip. Padding
    // values + line-height weren't enough; the browser was adding invisible
    // vertical bulk (likely from emoji glyph metrics). Force 24px.
    padding: mobile ? (expanded ? '8px 10px 10px 12px' : '0 10px 0 12px')
                    : (expanded ? '12px 16px 12px 20px' : '0 14px 0 20px'),
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: expanded ? (mobile ? 7 : 10) : 0,
    overflow: 'hidden',
    width: '100%',
    boxSizing: 'border-box',
    height: !expanded ? (mobile ? 24 : 28) : 'auto',
    minHeight: !expanded ? (mobile ? 24 : 28) : undefined,
  };
  const flagStripe = {
    position: 'absolute',
    left: 0, top: 0, bottom: 0, width: 6,
    backgroundImage: 'conic-gradient(#111 25%, #fff 0 50%, #111 0 75%, #fff 0)',
    backgroundSize: '6px 6px',
    backgroundRepeat: 'repeat',
  };

  if (!race) return (
    <div style={panel}><span style={flagStripe}/>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between'}}>
        <span style={{fontSize:SZ.title,fontWeight:500,color:'var(--text-primary)'}}>⚑ Race Focus</span>
        <span style={{fontSize:SZ.dateLbl,color:'var(--text-muted)'}}>no race scheduled</span>
      </div>
    </div>
  );

  const raceDate = parseLocalDate(race.date) || new Date(NaN);
  const raceMid = new Date(raceDate); raceMid.setHours(0, 0, 0, 0);
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const days = Math.round((raceMid - todayMid) / 86400000);
  // Phase 4r.race.6 — compact date label for the meta row.
  const dateLbl = raceDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const dateLblFull = raceDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const wx = weather ? wmoInfo(weather.code) : null;

  const plan = useMemo(() => {
    if (!race) return null;
    const weatherForecast = weather ? { tempC: weather.tMaxC, humidityPct: weather.humidityPct } : null;
    return buildRaceFuelingPlan({
      race, profile, weatherForecast, sweatRateLbsPerHr,
      pace:       lastEdited === 'pace'   ? paceInput   : (paceInput || null),
      finishTime: lastEdited === 'finish' ? finishInput : (finishInput || null),
    });
  }, [race, weather, profile, sweatRateLbsPerHr, paceInput, finishInput, lastEdited]);

  // Pre-fill inputs once the plan resolves so user sees the active values.
  useEffect(() => {
    if (didInitialFill || !plan?.inputs) return;
    if (plan.inputs.paceStr && !paceInput) setPaceInput(plan.inputs.paceStr);
    if (plan.inputs.finishStr && !finishInput) setFinishInput(plan.inputs.finishStr);
    setDidInitialFill(true);
  }, [plan, didInitialFill, paceInput, finishInput]);

  // Phase 4r.viz.19 — input boxes locked to 22px, text right-aligned.
  // Explicit lineHeight in pixels matching the content area defeats
  // Webkit's default baseline-based vertical positioning that was
  // making the boxes appear tall regardless of height.
  const inputStyle = (uncommitted, flashing, width) => ({
    width,
    flex: '0 0 auto',
    boxSizing: 'border-box',
    padding: '0 5px',
    fontSize: SZ.inputFs,
    height: 22,
    minHeight: 22,
    maxHeight: 22,
    lineHeight: '20px',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: `0.5px solid ${flashing ? '#22c55e' : (uncommitted ? '#fbbf24' : 'var(--border-default)')}`,
    borderRadius: 4,
    fontFamily: 'var(--font-mono)',
    textAlign: 'right',
    boxShadow: flashing ? '0 0 0 2px rgba(34,197,94,0.25)' : 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    verticalAlign: 'middle',
    margin: 0,
  });

  const hasUncommitted = paceUncommitted || finishUncommitted;

  // Short race name for the collapsed line — strip parenthetical suffix.
  const shortName = (race.name || 'Next race').replace(/\s*\([^)]*\)\s*$/, '');

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={panel}><span style={flagStripe}/>

      {/* HEADER LINE — single row, click to expand */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          all: 'unset', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, width: '100%', minWidth: 0,
          // Phase 4r.viz.15 — tight line-height so the collapsed strip
          // height is bounded by the row content, not the natural font
          // line-height which adds invisible vertical padding.
          lineHeight: 1.15,
        }}
      >
        <span style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
          <span style={{fontSize:SZ.title,fontWeight:500,color:'var(--text-primary)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>
            ⚑ {expanded ? (race.name || 'Next race') : shortName}
          </span>
          <span style={{fontSize:SZ.days,color:accent,flexShrink:0}}>{days}d</span>
          {/* Collapsed only — inline date + weather chip */}
          {!expanded && (
            <>
              <span style={{fontSize:SZ.dateLbl,color:'var(--text-muted)',flexShrink:0}}>· {dateLbl}</span>
              {wx && (
                <span style={{display:'inline-flex',alignItems:'center',gap:3,flexShrink:0,color:wx.color}}>
                  <span style={{fontSize:SZ.dateLbl + 2}}>{wx.icon}</span>
                  <span style={{fontSize:SZ.dateLbl}}>{weather.tMax}°</span>
                </span>
              )}
            </>
          )}
        </span>
        <span style={{color:'var(--text-muted)',fontSize:SZ.inputFs - 2,flexShrink:0}}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {/* META LINE — date · location · weather chip (only when expanded) */}
      {expanded && (
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:SZ.metaLine,color:'var(--text-muted)',flexWrap:'wrap'}}>
          <span>{dateLblFull}</span>
          {race.location && <>
            <span>·</span>
            <span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{race.location}</span>
          </>}
          {wx && (
            <>
              <span>·</span>
              <span style={{display:'inline-flex',alignItems:'center',gap:4,color:wx.color}}>
                <span style={{fontSize:SZ.wxLine + 3}}>{wx.icon}</span>
                <span>{weather.tMax}°/{weather.tMin}°F</span>
                {weather.precip != null && weather.precip > 0 && (
                  <span style={{color:'#60a5fa'}}>· {weather.precip}% rain</span>
                )}
              </span>
            </>
          )}
          {race.location && weatherState === 'loading' && <span style={{fontStyle:'italic'}}>· checking forecast…</span>}
          {weather?.historical && <span style={{fontStyle:'italic'}}>· last year</span>}
          {(race.distanceKm || race.distanceMi || distanceMi) && <>
            <span>·</span>
            <span>
              {(distanceMi).toFixed(distanceMi<10?1:0)} mi
            </span>
          </>}
        </div>
      )}

      {/* EXPANDED BODY — two-column layout */}
      {expanded && plan && (
        <div style={{
          display:'grid',
          gridTemplateColumns: mobile ? 'minmax(0, 1fr) minmax(0, 1.05fr)' : '180px 1fr',
          gap: mobile ? 10 : 16,
          paddingTop: 4,
        }}>
          {/* ── LEFT: Inputs + sweat note ── */}
          {/* Phase 4r.viz.20 — gap reduced 6→4 so the input column is
              tighter overall. */}
          <div style={{display:'flex',flexDirection:'column',gap:4,minWidth:0}}>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:SZ.inputLbl,color:'var(--text-secondary, #94a3b8)'}}>
              <span style={{minWidth:38,flexShrink:0,fontWeight:500}}>
                Pace
                {flashField === 'pace' && <span style={{color:'#22c55e',marginLeft:3}}>✓</span>}
              </span>
              <input
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                placeholder="8:30"
                className="arnold-compact-input"
                value={paceInput}
                onFocus={() => {
                  paceBeforeFocusRef.current = paceInput;
                  setPaceInput('');
                  setPaceUncommitted(true);
                }}
                onChange={e => { setPaceInput(e.target.value); setPaceUncommitted(true); }}
                onBlur={() => {
                  if (!paceInput.trim()) {
                    setPaceInput(paceBeforeFocusRef.current || '');
                    setPaceUncommitted(false);
                    paceBeforeFocusRef.current = null;
                    return;
                  }
                  commitPace();
                  paceBeforeFocusRef.current = null;
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style={inputStyle(paceUncommitted, flashField === 'pace', SZ.inputW)}
              />
            </label>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:SZ.inputLbl,color:'var(--text-secondary, #94a3b8)'}}>
              <span style={{minWidth:38,flexShrink:0,fontWeight:500}}>
                Finish
                {flashField === 'finish' && <span style={{color:'#22c55e',marginLeft:3}}>✓</span>}
              </span>
              <input
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                placeholder="1:55:00"
                className="arnold-compact-input"
                value={finishInput}
                onFocus={() => {
                  finishBeforeFocusRef.current = finishInput;
                  setFinishInput('');
                  setFinishUncommitted(true);
                }}
                onChange={e => { setFinishInput(e.target.value); setFinishUncommitted(true); }}
                onBlur={() => {
                  if (!finishInput.trim()) {
                    setFinishInput(finishBeforeFocusRef.current || '');
                    setFinishUncommitted(false);
                    finishBeforeFocusRef.current = null;
                    return;
                  }
                  commitFinish();
                  finishBeforeFocusRef.current = null;
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style={inputStyle(finishUncommitted, flashField === 'finish', SZ.inputWFinish)}
              />
            </label>
            {mobile && hasUncommitted && (
              <button
                onClick={() => { commitPace(); commitFinish(); }}
                style={{
                  all: 'unset', cursor: 'pointer', textAlign: 'center',
                  padding: '7px 0', fontSize: SZ.applyFs, fontWeight: 500,
                  color: '#0b0f14', background: accent, borderRadius: 6,
                  width: SZ.inputWFinish,
                }}
              >Apply</button>
            )}
            {/* Compact context note */}
            <div style={{fontSize:SZ.note,color:'var(--text-muted)',lineHeight:1.45,marginTop:2}}>
              {plan.weather?.hasData ? (
                <>
                  Sweat {plan.sweat.adjustedLbsPerHr} lb/hr
                  {plan.weather.combinedMult !== 1 && <> · weather ×{plan.weather.combinedMult.toFixed(2)}</>}
                  {plan.hydration.wasCapped && <> · <span style={{color:'#fbbf24'}}>cap {plan.hydration.maxMlPerHr} mL/hr</span></>}
                </>
              ) : (
                <>Sweat {plan.sweat.baseLbsPerHr.toFixed(2)} lb/hr (pop avg)</>
              )}
            </div>
            <div style={{fontSize:SZ.note,color:'var(--text-muted)',marginTop:-4}}>
              Finish ~{fmtMinAsClock(plan.inputs.finishMin)} · {plan.carbs.totalDuringG}g · {plan.hydration.totalDuringMl} mL
            </div>
          </div>

          {/* ── RIGHT: Fuel schedule with icons ── */}
          <div style={{display:'flex',flexDirection:'column',gap:8,minWidth:0}}>
            {/* Pre-race row */}
            <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
              <BowlIcon size={20} color="#fb923c"/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:SZ.rowVal,fontWeight:500,color:'var(--text-primary)'}}>Breakfast</div>
                <div style={{fontSize:SZ.rowSub,color:'var(--text-secondary)'}}>
                  {plan.carbs.preRaceG}g carbs · {plan.hydration.preRaceMl} mL
                </div>
                <div style={{fontSize:SZ.rowSub,color:'var(--text-muted)',marginTop:1}}>60–90 min before</div>
              </div>
            </div>
            {/* During-race row (collapsed cadence) */}
            {plan.schedule.length > 0 && (
              <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
                <GelIcon size={20} color="#22d3ee"/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:SZ.rowVal,fontWeight:500,color:'var(--text-primary)',display:'flex',alignItems:'baseline',gap:6}}>
                    <span>In-race</span>
                    <span style={{fontSize:SZ.rowSub,color:'var(--text-muted)',fontWeight:400}}>× {plan.schedule.length}</span>
                  </div>
                  <div style={{fontSize:SZ.rowSub,color:'var(--text-secondary)',display:'flex',alignItems:'center',gap:3}}>
                    {plan.schedule[0].fuelG}g gel · {plan.schedule[0].fluidMl}<DropIcon size={11} color="#60a5fa"/>
                  </div>
                  <div style={{fontSize:SZ.rowSub,color:'var(--text-muted)',marginTop:1}}>
                    every {plan.schedule.length >= 2 ? Math.round(plan.schedule[1].atMin - plan.schedule[0].atMin) : 25}m · min {plan.schedule[0].atMin} → {plan.schedule[plan.schedule.length-1].atMin}
                  </div>
                </div>
              </div>
            )}
            {/* Phase 4r.race.8 — planner moved out of the race card entirely.
                For half-and-up races, show a small pill that links the user
                to the Fuel tab where the actual planning lives (less clutter
                on the race tile, single source of truth for nutrition). */}
            {/* Phase 4r.viz.17 — "Plan items in Fuel" link removed per
                user request. Race card stands alone on the Play tab. */}
          </div>
        </div>
      )}
    </div>
  );
}
