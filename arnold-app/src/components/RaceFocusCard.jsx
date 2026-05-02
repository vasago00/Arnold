// ─── Race Focus Card ─────────────────────────────────────────────────────────
// Compact panel for the Training tab: next race + countdown,
// readiness vs goal pace, today's planned session, and a weather peek
// (fetched from Open-Meteo if race is ≤16 days out).

import { useEffect, useState } from "react";
import { parseLocalDate } from "../core/dateUtils.js";

const WMO = {
  0:  { icon: "☀", label: "Clear",         color: "#fbbf24" },
  1:  { icon: "🌤", label: "Mostly clear",  color: "#fbbf24" },
  2:  { icon: "⛅", label: "Partly cloudy", color: "#a3a3a3" },
  3:  { icon: "☁",  label: "Overcast",      color: "#94a3b8" },
  45: { icon: "🌫", label: "Fog",           color: "#cbd5e1" },
  48: { icon: "🌫", label: "Rime fog",      color: "#cbd5e1" },
  51: { icon: "🌦", label: "Light drizzle", color: "#60a5fa" },
  53: { icon: "🌦", label: "Drizzle",       color: "#60a5fa" },
  55: { icon: "🌧", label: "Heavy drizzle", color: "#60a5fa" },
  61: { icon: "🌧", label: "Light rain",    color: "#3b82f6" },
  63: { icon: "🌧", label: "Rain",          color: "#3b82f6" },
  65: { icon: "🌧", label: "Heavy rain",    color: "#2563eb" },
  71: { icon: "🌨", label: "Light snow",    color: "#e0f2fe" },
  73: { icon: "🌨", label: "Snow",          color: "#e0f2fe" },
  75: { icon: "❄",  label: "Heavy snow",    color: "#e0f2fe" },
  80: { icon: "🌧", label: "Rain showers",  color: "#3b82f6" },
  81: { icon: "🌧", label: "Rain showers",  color: "#3b82f6" },
  82: { icon: "⛈", label: "Heavy showers", color: "#8b5cf6" },
  95: { icon: "⛈", label: "Thunderstorm",  color: "#a855f7" },
  96: { icon: "⛈", label: "Storm + hail",  color: "#a855f7" },
  99: { icon: "⛈", label: "Severe storm",  color: "#a855f7" },
};
const wmoInfo = code => WMO[code] || { icon: "•", label: "—", color: "#94a3b8" };

export function RaceFocusCard({ race, goalPaceSecs, avgPace30, fmtPace, planned, plannedTypeLabel }) {
  const [weather, setWeather] = useState(null);
  const [weatherState, setWeatherState] = useState("idle"); // idle | loading | ready | error | outofrange

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
        // Try progressively simpler queries: full → drop first chunk → just second chunk → last chunk
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
          url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&start_date=${dateStr}&end_date=${dateStr}`;
        } else {
          // Climatological proxy: same calendar date, previous year
          const y = raceDate.getFullYear() - 1;
          const dateStr = `${y}-${mm}-${dd}`;
          url = `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&start_date=${dateStr}&end_date=${dateStr}`;
          historical = true;
        }
        const f = await fetch(url);
        const fj = await f.json();
        if (cancelled) return;
        const d = fj?.daily;
        if (!d?.weathercode?.[0] && d?.weathercode?.[0] !== 0) throw new Error("forecast");
        setWeather({
          code: d.weathercode[0],
          tMax: Math.round(d.temperature_2m_max[0]),
          tMin: Math.round(d.temperature_2m_min[0]),
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
    padding: '12px 16px 12px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    height: '100%',
    overflow: 'hidden',
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
        <span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>⚑ Race Focus</span>
        <span style={{fontSize:10,color:'var(--text-muted)'}}>no race scheduled</span>
      </div>
      <div style={{fontSize:11,color:'var(--text-muted)'}}>Add a target race in the Races tab to unlock training focus and countdown.</div>
    </div>
  );

  const raceDate = parseLocalDate(race.date) || new Date(NaN);
  // Days-until uses midnight-to-midnight diff. Anything else gives users
  // off-by-one results depending on what time they're checking.
  const raceMid = new Date(raceDate); raceMid.setHours(0, 0, 0, 0);
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const days = Math.round((raceMid - todayMid) / 86400000);
  const dateLbl = raceDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const delta = avgPace30 && goalPaceSecs ? Math.round(avgPace30 - goalPaceSecs) : null;
  const onTrack = delta !== null && delta <= 0;
  const barPct = avgPace30 && goalPaceSecs ? Math.max(0, Math.min(100, (goalPaceSecs / avgPace30) * 100)) : 0;

  const wx = weather ? wmoInfo(weather.code) : null;

  return (
    <div style={panel}><span style={flagStripe}/>
      {/* Title row */}
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:12}}>
        <div style={{display:'flex',alignItems:'baseline',gap:10,minWidth:0,flexWrap:'wrap'}}>
          <span style={{fontSize:15,fontWeight:500,color:'var(--text-primary)'}}>⚑ {race.name || 'Next race'}</span>
          <span style={{fontSize:11,color:accent,fontFamily:'var(--font-mono)'}}>{days}d</span>
          <span style={{fontSize:10,color:'var(--text-muted)'}}>{dateLbl}</span>
        </div>
        {(race.distanceKm || race.distanceMi) && (()=>{
          const km = race.distanceKm ? Number(race.distanceKm) : Number(race.distanceMi)*1.609;
          const mi = race.distanceMi ? Number(race.distanceMi) : Number(race.distanceKm)/1.609;
          return <span style={{fontSize:11,color:'var(--text-secondary)',fontFamily:'var(--font-mono)'}}>{mi.toFixed(mi<10?1:0)} mi · {km.toFixed(1)} km</span>;
        })()}
      </div>

      {/* Location + weather row */}
      {(race.location || wx) && (
        <div style={{display:'flex',alignItems:'center',gap:10,fontSize:11,color:'var(--text-muted)'}}>
          {race.location && <span>◉ {race.location}</span>}
          {wx && (
            <span style={{display:'inline-flex',alignItems:'center',gap:6,color:wx.color}}>
              <span style={{fontSize:16}}>{wx.icon}</span>
              <span>{wx.label}</span>
              <span style={{color:'var(--text-secondary)',fontFamily:'var(--font-mono)'}}>{weather.tMax}°/{weather.tMin}°F</span>
              {weather.precip != null && weather.precip > 0 && (
                <span style={{color:'#60a5fa'}}>· {weather.precip}% rain</span>
              )}
            </span>
          )}
          {race.location && weatherState === 'loading' && <span style={{fontStyle:'italic'}}>· checking forecast…</span>}
          {weather?.historical && <span style={{color:'var(--text-muted)',fontStyle:'italic'}}>· last year</span>}
        </div>
      )}

      <div>
        <div style={{fontSize:9,color:'var(--text-muted)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Readiness vs goal</div>
        <div style={{fontSize:11,color:'var(--text-secondary)',fontFamily:'var(--font-mono)'}}>
          Goal {fmtPace(goalPaceSecs)} · 30d {fmtPace(avgPace30)}
          {delta !== null && <span style={{color: onTrack ? 'var(--status-ok)' : 'var(--status-warn)', marginLeft:6}}>Δ {delta>=0?'+':''}{delta}s</span>}
        </div>
      </div>
    </div>
  );
}
