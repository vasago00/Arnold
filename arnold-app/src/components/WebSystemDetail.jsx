// Phase 0.5 (slice 18) — WebSystemDetail (+ its SYSTEM_SIGNALS map) extracted
// verbatim from Arnold.jsx. The web inline-expansion panel for a Health System
// tile: Daily / Weekly / Annual tabs, Coach Read, nutrient donuts, bioactive hex
// chips, training/body/blood signal grids. Internal sub-components (SignalSparkline,
// HexChip, Donut, renderSignalGrid, resolve* helpers) move with it. The only body
// change from the in-monolith original is `getUnifiedActivities()` → the underlying
// `allActivities()` import (the local delegate stayed behind in Arnold.jsx).
import { useState, useRef, useMemo, useEffect } from "react";
import { storage } from "../core/storage.js";
import { parseLocalDate } from "../core/dateUtils.js";
import { currentTrueWeightLbs } from "../core/bodyWeight.js";
import { healthStatusColor } from "../core/presentation/healthTokens.js";
import { getGoals } from "../core/goals.js";
import { getSystemDetail, getSystemWeekly, getSystemCoachRead, getBioactiveStack } from "../core/healthSystems.js";
import { computeUserState as _computeUserStateForCoachRead } from "../core/intelligence.js";
import { allActivities } from "../core/dcyMath.js";
import { cleanSleepForAveraging } from "../core/parsers/sleepParser.js";
import { isRun as isRunAct, isStrengthVolume as isStrengthVol } from "../core/activityClass.js";
import { GROUP_COLOR as BIO_GROUP_COLOR } from "./BioactiveStack.jsx";
import { CoachSigil } from "./CoachSigil.jsx";

// ── SYSTEM_SIGNALS ─────────────────────────────────────────────────────────
// Maps each Health System to the training / body / blood-marker signals
// most relevant to it. Used by WebSystemDetail to surface cross-domain
// inputs that influence the score. Mirrors the same map in MobileHome.jsx —
// keep them in sync (or extract to a shared module in a future pass).
const SYSTEM_SIGNALS = {
  brain:     { training: ['HRV', 'Sleep Score'],                       body: ['Body Fat %'],         blood: ['Vitamin B12', 'Folate', 'Vitamin D'] },
  heart:     { training: ['RHR', 'Avg HR', 'Weekly Miles'],            body: ['Weight'],             blood: ['Cholesterol', 'Triglycerides', 'CRP'] },
  bones:     { training: ['Strength Sessions', 'Weekly Hours'],        body: ['Lean Mass', 'Weight'],blood: ['Vitamin D', 'Calcium'] },
  gut:       { training: [],                                           body: ['Body Fat %'],         blood: ['CRP', 'Iron'] },
  immune:    { training: ['HRV', 'Sleep Score'],                       body: [],                     blood: ['Vitamin D', 'Vitamin C', 'Zinc', 'WBC'] },
  energy:    { training: ['Weekly Hours', 'Weekly Miles'],             body: ['Weight'],             blood: ['Iron', 'Ferritin', 'Vitamin B12'] },
  longevity: { training: ['HRV', 'RHR', 'Weekly Hours'],               body: ['Body Fat %', 'Weight'],blood: ['Glucose', 'HbA1c', 'CRP'] },
  sleep:     { training: ['Sleep Score', 'HRV', 'RHR'],                body: [],                     blood: ['Magnesium'] },
  metabolism:{ training: ['Weekly Hours', 'Weekly Miles'],             body: ['Weight', 'Body Fat %'],blood: ['Glucose', 'HbA1c', 'Triglycerides'] },
  endurance: { training: ['Weekly Miles', 'Avg Pace', 'Weekly Hours'], body: ['Weight'],             blood: ['Iron', 'Ferritin', 'Hemoglobin'] },
};

// ── WebSystemDetail — inline expansion panel for a Health System tile ─────
// Same data backbone as the mobile SystemDetailPanel (getSystemDetail +
// getSystemWeekly + SYSTEM_SIGNALS) but with web-native styling: CSS
// variables instead of mobile constants, slightly larger typography, more
// breathing room since we have desktop real estate.
//
// Renders three tabs:
//   Daily   → today's nutrient targets + training/body/blood signal snapshots
//   Weekly  → 7-day score sparkline bars + weekly training rollups
//   Annual  → YTD training totals + current body snapshot
//
// Future stages will add: 30-day trend, last-optimal detection + trigger
// hypothesis, hand-crafted recommendations, live Labs cross-references.
export function WebSystemDetail({ system, comment, onClose, data }) {
  const [tab, setTab] = useState('daily');
  const containerRef = useRef(null);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);
  const detail = useMemo(() => getSystemDetail(system.id, today), [system.id, today]);
  const weekly = useMemo(() => getSystemWeekly(system.id), [system.id]);

  // Phase 4n.3.2 — auto-scroll the panel into view when it opens, so the
  // user doesn't have to manually scroll down after clicking a tile.
  // Smooth scroll, block=start positions the panel near the top of the
  // viewport (with a small offset so the tile that was clicked stays
  // visible above it).
  useEffect(() => {
    if (containerRef.current) {
      const t = setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [system.id]);

  if (!detail) return null;
  const nutrients = detail.details || [];
  const signals = SYSTEM_SIGNALS[system.id] || { training: [], body: [], blood: [] };

  // Phase 4r.intel.upgrade.1 — Coach Read for this system. Compose userState
  // here so the panel surfaces what the Coach engine actually knows about this
  // system today. Memoized on `today` so it doesn't recompute every render.
  const coachRead = useMemo(() => {
    try {
      const us = _computeUserStateForCoachRead({
        activities:   storage.get('activities')   || [],
        sleep:        storage.get('sleep')        || [],
        hrv:          storage.get('hrv')          || [],
        weight:       storage.get('weight')       || [],
        nutritionLog: storage.get('nutritionLog') || [],
        wellness:     storage.get('wellness')     || [],
        planner:      storage.get('planner')      || null,
        profile:      { ...(storage.get('profile') || {}), ...getGoals() },
      });
      return getSystemCoachRead(system.id, us?.coachSignals || null);
    } catch (e) {
      console.warn('[CoachRead] failed for system', system.id, e?.message || e);
      return null;
    }
  }, [system.id, today]);

  // Status color mirrors the tile (shared healthStatusColor — Phase 3.2).
  const statusColor = healthStatusColor(system.status);

  // ── Resolve signal values for daily/weekly/annual contexts ──
  const activities = useMemo(() => allActivities(), []);
  const sleepData = useMemo(() => cleanSleepForAveraging(storage.get('sleep') || []), []);
  const hrvData = useMemo(() => storage.get('hrv') || [], []);
  const weightData = useMemo(() => storage.get('weight') || [], []);
  const labsSource = useMemo(() => {
    const s = storage.get('labSnapshots');
    if (Array.isArray(s) && s.length) return s;
    return data?.labSnapshots || [];
  }, [data]);
  const labMarkers = useMemo(() => {
    const sorted = [...labsSource].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sorted[0]?.markers || {};
  }, [labsSource]);

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const d7 = new Date(); d7.setDate(d7.getDate() - 7);
  const recentSleep = useMemo(() => [...sleepData].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [sleepData]);
  const recentHRV = useMemo(() => [...hrvData].filter(h => h.overnightHRV).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [hrvData]);
  const recentWeight = useMemo(() => [...weightData].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [weightData]);
  const ytdRunsLocal = useMemo(() => activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart && isRunAct(a)), [activities]);
  const ytdAll = useMemo(() => activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart), [activities]);
  const wk7 = useMemo(() => activities.filter(a => a.date && parseLocalDate(a.date) >= d7), [activities]);
  const wk7Runs = useMemo(() => wk7.filter(isRunAct), [wk7]);
  const wk7Str = useMemo(() => wk7.filter(isStrengthVol), [wk7]);

  const resolveSignal = (name, period) => {
    if (period === 'annual') {
      if (name === 'Weekly Miles') return { value: (ytdRunsLocal.reduce((s, a) => s + (a.distanceMi || 0), 0) / Math.max((now - yearStart) / 604800000, 1)).toFixed(1), unit: 'mi/wk' };
      if (name === 'Weekly Hours') return { value: (ytdAll.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600 / Math.max((now - yearStart) / 604800000, 1)).toFixed(1), unit: 'hrs/wk' };
      if (name === 'Strength Sessions') return { value: ytdAll.filter(a => /strength|weight|gym/i.test(a.activityType || '')).length, unit: 'YTD' };
      if (name === 'Avg Pace') {
        const p = ytdRunsLocal.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean);
        return p.length ? { value: `${Math.floor(p.reduce((s, v) => s + v, 0) / p.length / 60)}:${String(Math.round(p.reduce((s, v) => s + v, 0) / p.length % 60)).padStart(2, '0')}`, unit: '/mi' } : { value: '—', unit: '' };
      }
    }
    if (name === 'HRV') return { value: recentHRV[0]?.overnightHRV || recentSleep.find(s => s?.overnightHRV)?.overnightHRV || '—', unit: 'ms' };
    if (name === 'RHR') return { value: recentSleep[0]?.restingHR || '—', unit: 'bpm' };
    if (name === 'Sleep Score') return { value: recentSleep.find(s => s.sleepScore)?.sleepScore || '—', unit: '/100' };
    if (name === 'Avg HR') { const hrs = wk7Runs.map(a => a.avgHR).filter(Boolean); return { value: hrs.length ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : '—', unit: 'bpm' }; }
    if (name === 'Weekly Miles') return { value: wk7Runs.reduce((s, a) => s + (a.distanceMi || 0), 0).toFixed(1), unit: 'mi' };
    if (name === 'Weekly Hours') return { value: (wk7.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600).toFixed(1), unit: 'hrs' };
    if (name === 'Strength Sessions') return { value: wk7Str.length, unit: 'this wk' };
    if (name === 'Avg Pace') {
      const p = wk7Runs.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean);
      return p.length ? { value: `${Math.floor(p.reduce((s, v) => s + v, 0) / p.length / 60)}:${String(Math.round(p.reduce((s, v) => s + v, 0) / p.length % 60)).padStart(2, '0')}`, unit: '/mi' } : { value: '—', unit: '' };
    }
    if (name === 'Weight') return { value: currentTrueWeightLbs(recentWeight)?.toFixed(1) || '—', unit: 'lbs' };
    if (name === 'Body Fat %') return { value: recentWeight.find(w => w?.bodyFatPct > 0)?.bodyFatPct?.toFixed(1) || '—', unit: '%' };
    if (name === 'Lean Mass') return { value: recentWeight.find(w => w?.skeletalMuscleMassLbs)?.skeletalMuscleMassLbs?.toFixed(1) || '—', unit: 'lbs' };
    return { value: '—', unit: '' };
  };
  const resolveBlood = (name) => {
    const v = labMarkers[name];
    return v != null ? { value: v, unit: '' } : { value: '—', unit: '' };
  };

  const barColor = (pct) => pct >= 80 ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171';
  const weeklyAvg = weekly.length ? Math.round(weekly.reduce((s, d) => s + d.pct, 0) / weekly.length) : null;
  const weeklyMax = Math.max(...weekly.map(d => d.pct), 1);

  // ── 7-day history map per signal name (for mini sparklines) ──
  // Walks each of the last 7 days and resolves the signal value for that
  // date. Returns oldest→newest array, nulls preserved for missing data.
  const last7Days = useMemo(() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      arr.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    return arr;
  }, []);
  const sigHistory = useMemo(() => {
    const map = {};
    map['HRV'] = last7Days.map(ds => {
      const s = sleepData.find(s => s?.date === ds);
      if (s?.overnightHRV != null) return Number(s.overnightHRV);
      const h = hrvData.find(h => h?.date === ds);
      return h?.overnightHRV != null ? Number(h.overnightHRV) : null;
    });
    map['RHR'] = last7Days.map(ds => {
      const s = sleepData.find(s => s?.date === ds);
      return s?.restingHR != null ? Number(s.restingHR) : null;
    });
    map['Sleep Score'] = last7Days.map(ds => {
      const s = sleepData.find(s => s?.date === ds);
      return s?.sleepScore != null ? Math.min(Number(s.sleepScore), 100) : null;
    });
    map['Avg HR'] = last7Days.map(ds => {
      const dayRuns = activities.filter(a => a.date === ds && isRunAct(a));
      const hrs = dayRuns.map(r => r.avgHR).filter(Boolean);
      return hrs.length ? hrs.reduce((s, v) => s + v, 0) / hrs.length : null;
    });
    map['Weekly Miles'] = last7Days.map(ds => {
      const dayRuns = activities.filter(a => a.date === ds && isRunAct(a));
      return dayRuns.reduce((s, a) => s + (a.distanceMi || 0), 0) || null;
    });
    map['Weekly Hours'] = last7Days.map(ds => {
      const dayActs = activities.filter(a => a.date === ds);
      const total = dayActs.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600;
      return total > 0 ? +total.toFixed(2) : null;
    });
    map['Strength Sessions'] = last7Days.map(ds => {
      return activities.filter(a => a.date === ds && /strength|weight|gym/i.test(a.activityType || '')).length || null;
    });
    map['Avg Pace'] = last7Days.map(ds => {
      const dayRuns = activities.filter(a => a.date === ds && isRunAct(a));
      const paces = dayRuns.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean);
      return paces.length ? paces.reduce((s, v) => s + v, 0) / paces.length : null;
    });
    map['Weight'] = last7Days.map(ds => {
      const w = weightData.find(w => w?.date === ds && (w?.weightLbs || w?.weight));
      return w ? Number(w.weightLbs || w.weight) : null;
    });
    map['Body Fat %'] = last7Days.map(ds => {
      const w = weightData.find(w => w?.date === ds && w?.bodyFatPct > 0);
      return w?.bodyFatPct != null ? Number(w.bodyFatPct) : null;
    });
    map['Lean Mass'] = last7Days.map(ds => {
      const w = weightData.find(w => w?.date === ds && w?.skeletalMuscleMassLbs);
      return w?.skeletalMuscleMassLbs != null ? Number(w.skeletalMuscleMassLbs) : null;
    });
    return map;
  }, [last7Days, sleepData, hrvData, activities, weightData]);

  // Reference targets — lets each signal tile show "vs goal" context.
  const goals = getGoals();
  const sigTarget = (name) => {
    if (name === 'HRV') return parseFloat(goals?.targetHRV) || 45;
    if (name === 'RHR') return parseFloat(goals?.targetRHR) || 50;
    if (name === 'Sleep Score') return parseFloat(goals?.targetSleepScore) || 80;
    if (name === 'Avg HR') return parseFloat(goals?.targetAvgRunHR) || null;
    if (name === 'Weekly Miles') return parseFloat(goals?.weeklyRunDistanceTarget) || null;
    if (name === 'Weekly Hours') return parseFloat(goals?.weeklyTimeTargetHrs) || null;
    if (name === 'Strength Sessions') return parseFloat(goals?.weeklyStrengthTarget) || null;
    if (name === 'Weight') return parseFloat(goals?.targetWeight) || null;
    if (name === 'Body Fat %') return parseFloat(goals?.targetBodyFat) || null;
    if (name === 'Lean Mass') return parseFloat(goals?.targetLeanMass) || null;
    return null;
  };
  // Status-color logic per signal — knows direction (lower-better for HR/RHR/pace, higher-better for HRV/sleep, etc.)
  const sigColor = (name, val) => {
    if (val == null || val === '—' || !Number.isFinite(Number(val))) return 'var(--text-muted)';
    const v = Number(val);
    const t = sigTarget(name);
    if (name === 'HRV')         return v >= 40 ? '#4ade80' : v >= 30 ? '#fbbf24' : '#f87171';
    if (name === 'RHR')         return v <= 55 ? '#4ade80' : v <= 65 ? '#fbbf24' : '#f87171';
    if (name === 'Sleep Score') return v >= 80 ? '#4ade80' : v >= 60 ? '#fbbf24' : '#f87171';
    if (t == null) return 'var(--text-primary)';
    // Default: % of target, lower-better for HR-style, higher-better otherwise
    if (name === 'Avg HR')      return v <= t * 1.05 ? '#4ade80' : v <= t * 1.15 ? '#fbbf24' : '#f87171';
    const pct = v / t;
    return pct >= 0.9 ? '#4ade80' : pct >= 0.7 ? '#fbbf24' : '#f87171';
  };

  const tabStyle = (active) => ({
    flex: 1, textAlign: 'center', fontSize: 12, fontWeight: active ? 600 : 500,
    padding: '8px 0', color: active ? statusColor : 'var(--text-muted)',
    borderBottom: active ? `2px solid ${statusColor}` : '2px solid transparent',
    cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.04em',
    textTransform: 'uppercase',
  });

  const subHeaderStyle = {
    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.10em',
    marginTop: 14, marginBottom: 8,
  };
  const signalCellStyle = {
    background: 'var(--bg-elevated)',
    borderRadius: 8, padding: '8px 10px',
    border: '0.5px solid var(--border-subtle)',
    display: 'flex', flexDirection: 'column', gap: 2,
  };

  // Mini-sparkline SVG for signal tiles. Stretches to container width.
  const SignalSparkline = ({ history, color }) => {
    const valid = (history || []).filter(v => v != null && Number.isFinite(v));
    if (valid.length < 2) return <div style={{ height: 16 }}/>;
    const lo = Math.min(...valid); const hi = Math.max(...valid);
    const rng = hi - lo || 1;
    const W = 100, H = 16;
    const xS = (i) => (i / (history.length - 1)) * W;
    const yS = (v) => H - 2 - ((v - lo) / rng) * (H - 4);
    let path = ''; let inPath = false;
    history.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { inPath = false; return; }
      const p = { x: xS(i), y: yS(v) };
      path += inPath ? ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : ` M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      inPath = true;
    });
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: H, marginTop: 2 }}>
        <path d={path} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
      </svg>
    );
  };

  // Status indicator word per signal — succinct interpretation.
  const sigStatus = (name, val) => {
    if (val == null || val === '—') return null;
    const v = Number(val);
    if (!Number.isFinite(v)) return null;
    if (name === 'HRV')         return v >= 40 ? 'recovered' : v >= 30 ? 'borderline' : 'strained';
    if (name === 'RHR')         return v <= 55 ? 'fit' : v <= 65 ? 'normal' : 'elevated';
    if (name === 'Sleep Score') return v >= 80 ? 'restful' : v >= 60 ? 'fair' : 'poor';
    return null;
  };

  // ── Unified signal tile renderer — Phase 4r.intel.upgrade.4 ──
  // Same visual treatment as Coach signal tiles above. Compact, dense,
  // value-forward. Sparklines retired here to keep tile size consistent
  // with the Coach Read section; they were making Training/Body tiles
  // tower over the Coach tiles and pulled visual focus from the voice.
  // Sub-line carries the same "goal X · status" info but as a single
  // compact headline.
  const renderSignalGrid = (sigList, period, opts = {}) => {
    const list = (sigList || []).filter((sig) => {
      const r = resolveSignal(sig, period);
      const hasValue = r.value != null && r.value !== '—' && r.value !== '';
      return hasValue;
    });
    if (list.length === 0) return null;
    return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
    }}>
      {list.map((sig, i) => {
        const r = resolveSignal(sig, period);
        const valueColor = sigColor(sig, r.value);
        const target = sigTarget(sig);
        const statusWord = sigStatus(sig, r.value);
        const headline = target != null && statusWord
          ? `goal ${target}${r.unit ? ` ${r.unit}` : ''} · ${statusWord}`
          : target != null
          ? `goal ${target}${r.unit ? ` ${r.unit}` : ''}`
          : statusWord || null;
        return (
          <div key={i} style={{ ...signalCellStyle, borderColor: `${valueColor}40`, width: 210, minHeight: 72, justifyContent: 'space-between' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sig}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: valueColor, lineHeight: 1 }}>{r.value}</span>
              {r.unit && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.unit}</span>}
            </div>
            {headline && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35, marginTop: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {headline}
              </div>
            )}
          </div>
        );
      })}
    </div>
    );
  };

  return (
    <div ref={containerRef} style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${statusColor}55`,
      borderRadius: 12,
      padding: 'clamp(14px,1.4vw,18px)',
      marginTop: 10,
      animation: 'edgeiqSlideDown 0.25s ease-out',
      scrollMarginTop: 80,  // leaves space for any sticky header above
    }}>
      <style>{`@keyframes edgeiqSlideDown { from { opacity: 0; max-height: 0; transform: translateY(-8px); } to { opacity: 1; max-height: 1200px; transform: translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{system.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{comment || 'Click tile again to close'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 28, fontWeight: 600, color: statusColor, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{system.pct || 0}%</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>today</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
            aria-label="Close detail panel"
            title="Close"
          >×</button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-default)', marginBottom: 12 }}>
        <div style={tabStyle(tab === 'daily')}  onClick={() => setTab('daily')}>Daily</div>
        <div style={tabStyle(tab === 'weekly')} onClick={() => setTab('weekly')}>Weekly</div>
        <div style={tabStyle(tab === 'annual')} onClick={() => setTab('annual')}>Annual</div>
      </div>

      {/* ── Tab summary header — directional interpretation per tab ── */}
      {(() => {
        // Compute insights specific to the tab
        const lowestNutrient = nutrients.length ? [...nutrients].filter(n => n.pct != null).sort((a, b) => a.pct - b.pct)[0] : null;
        const highestNutrient = nutrients.length ? [...nutrients].filter(n => n.pct != null).sort((a, b) => b.pct - a.pct)[0] : null;
        // 7-day delta (this week's first day vs last week's same day)
        const wowDelta = weekly.length >= 7 && weekly[0]?.pct != null && weekly[6]?.pct != null
          ? weekly[0].pct - weekly[6].pct
          : null;
        // Days logged this week (any data)
        const daysLogged = weekly.filter(d => d.pct != null && d.pct > 0).length;
        // YTD trend direction (compare first half vs second half of weekly)
        const firstHalfAvg = weekly.slice(0, 3).filter(d => d.pct).map(d => d.pct);
        const secondHalfAvg = weekly.slice(4, 7).filter(d => d.pct).map(d => d.pct);
        const trendDir = firstHalfAvg.length && secondHalfAvg.length
          ? (secondHalfAvg.reduce((s,v)=>s+v,0)/secondHalfAvg.length) - (firstHalfAvg.reduce((s,v)=>s+v,0)/firstHalfAvg.length)
          : null;

        const summaryStyle = {
          background: `${statusColor}11`,
          border: `0.5px solid ${statusColor}33`,
          borderLeft: `3px solid ${statusColor}`,
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 14,
          fontSize: 12,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        };
        const labelStyle = { fontSize: 9, fontWeight: 700, color: statusColor, letterSpacing: '0.10em', textTransform: 'uppercase', marginRight: 8 };

        if (tab === 'daily') {
          // Phase 4r.intel.upgrade.2 — when the Coach line is rendering up
          // in the Daily tab body, suppress this verdict box. Two boxes
          // both saying coach-like things were two competing voices for
          // the same square inch. Coach line is the voice on Daily; this
          // summary still runs on Weekly/Annual where it carries unique
          // info (WoW delta, lab-panel age) that the Coach doesn't.
          if (coachRead && coachRead.signals.length > 0) return null;
          const score = system.pct || 0;
          const verdict = score >= 80 ? 'Strong' : score >= 50 ? 'On track' : 'Needs attention';
          const nutHook = lowestNutrient && lowestNutrient.pct < 50 ? `${lowestNutrient.short || lowestNutrient.name} ${lowestNutrient.pct}%` : null;
          const winHook = highestNutrient && highestNutrient.pct >= 100 ? `${highestNutrient.short || highestNutrient.name} ${highestNutrient.pct}%` : null;
          return (
            <div style={summaryStyle}>
              <span style={labelStyle}>Today</span>
              <span style={{ color: statusColor, fontWeight: 600 }}>{verdict}</span>
              <span> — {comment || `${system.name} score reflects today's inputs.`}</span>
              {(nutHook || winHook) && (
                <div style={{ marginTop: 6, fontSize: 11 }}>
                  {nutHook && <span style={{ color: '#f87171' }}>⚠ Lowest: {nutHook}</span>}
                  {nutHook && winHook && <span style={{ color: 'var(--text-muted)' }}>  ·  </span>}
                  {winHook && <span style={{ color: '#4ade80' }}>✓ Hit: {winHook}</span>}
                </div>
              )}
            </div>
          );
        }
        if (tab === 'weekly') {
          const dirWord = trendDir == null ? '' : trendDir > 5 ? 'trending up' : trendDir < -5 ? 'trending down' : 'flat';
          const dirColor = trendDir == null ? 'var(--text-muted)' : trendDir > 0 ? '#4ade80' : trendDir < 0 ? '#f87171' : 'var(--text-muted)';
          return (
            <div style={summaryStyle}>
              <span style={labelStyle}>This week</span>
              <span>Avg <span style={{ color: barColor(weeklyAvg || 0), fontWeight: 600 }}>{weeklyAvg || '—'}%</span></span>
              {dirWord && <span> · <span style={{ color: dirColor, fontWeight: 500 }}>{dirWord}</span></span>}
              <span style={{ color: 'var(--text-muted)' }}> · {daysLogged}/7 days with data</span>
              {wowDelta != null && (
                <span style={{ marginLeft: 8, color: wowDelta > 0 ? '#4ade80' : wowDelta < 0 ? '#f87171' : 'var(--text-muted)' }}>
                  {wowDelta > 0 ? '↑' : wowDelta < 0 ? '↓' : '→'} {Math.abs(wowDelta)} vs 7d ago
                </span>
              )}
            </div>
          );
        }
        if (tab === 'annual') {
          // Find the most recent lab panel date + age in months
          const sortedLabs = [...labsSource].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          const latestLab = sortedLabs[0];
          const labAge = latestLab?.date ? Math.round((Date.now() - new Date(`${latestLab.date}T12:00:00`).getTime()) / (30 * 86400000)) : null;
          const stale = labAge != null && labAge > 12;
          return (
            <div style={summaryStyle}>
              <span style={labelStyle}>YTD</span>
              <span>{system.name} trajectory · score today <span style={{ color: statusColor, fontWeight: 600 }}>{system.pct}%</span></span>
              {latestLab?.date ? (
                <span style={{ color: 'var(--text-muted)' }}>  ·  last lab <span style={{ color: stale ? '#fbbf24' : 'var(--text-secondary)', fontWeight: 500 }}>{latestLab.date}</span>
                  {stale && <span style={{ color: '#fbbf24' }}> ({labAge}mo old — schedule new panel)</span>}
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>  ·  <span style={{ color: '#fbbf24' }}>No lab panel on file — schedule baseline test</span></span>
              )}
            </div>
          );
        }
        return null;
      })()}

      {/* ── Daily tab ── */}
      {tab === 'daily' && (
        <div>
          {/* Phase 4r.intel.upgrade.9 — Coach line ALWAYS renders when
              coachRead is present, even with no signal tiles. Systems
              without active signals get a thoughtful fallback voice
              instead of silence. */}
          {coachRead && (
            <div style={{ marginBottom: 16 }}>
              {coachRead.coachLine && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 12 }}>
                  <CoachSigil size={18} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div style={{
                    flex: 1, minWidth: 0,
                    fontSize: 13, lineHeight: 1.55,
                    color: 'var(--text-primary)',
                  }}>
                    {coachRead.coachLine}
                  </div>
                </div>
              )}
              {coachRead.signals.length > 0 && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                {coachRead.signals.map((sig, i) => (
                  <div key={i} style={{
                    ...signalCellStyle,
                    borderColor: `${sig.color}40`,
                    width: 210,
                    minHeight: 72,
                    justifyContent: 'space-between',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{sig.label}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 18, fontWeight: 600, color: sig.color, lineHeight: 1 }}>{sig.value}</span>
                      {sig.unit && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sig.unit}</span>}
                    </div>
                    {sig.headline && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35, marginTop: 0 }}>
                        {sig.headline}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          {/* Nutrient donut rings + Bioactive hex chips — Phase 4r.intel.
              upgrade.8. Bioactives (NMN/Rv/Sp/Ap/Qc/Cur/FO/Ash/Btr/Cre/
              MgT/Shi/TMG/Fis) split out of the donut grid and rendered
              as hexagon chips matching the Daily/Nutrition/Fuel summary
              visual: same polygon shape, same category color, same
              taken/untaken treatment (filled solid vs dashed outline). */}
          {(() => {
            const visibleNutrients = (nutrients || []).filter(n =>
              n && (n.value > 0 || n.target > 0) && n.pct != null
            );
            if (visibleNutrients.length === 0) return null;

            // Detect bioactives by name and map to short code + category.
            // Source-of-truth is BioactiveStack.jsx's SHORT_CODE + group maps;
            // this is the panel-side detector that bridges the system's
            // verbose nutrient names ("NMN (Nicotinamide Mononucleotide)") to
            // the bioactive identity ({short, group}) used for hex rendering.
            // Canonical "taken today" state comes from getBioactiveStack
            // (walks the supplements log + stack + catalog). The system's
            // n.pct measures intake vs target, which gives partial dose %s;
            // taken is binary — the moment ANY dose containing the compound
            // is logged, it lights up. Matches Daily / Fuel summary exactly.
            const canonicalBio = getBioactiveStack(today);
            const takenByName = new Map(canonicalBio.map(b => [b.name, b.taken]));
            const NAME_META = {
              'NMN (Nicotinamide Mononucleotide)':           { short: 'NMN', group: 'longevity' },
              'Trans-Resveratrol':                           { short: 'Rv',  group: 'longevity' },
              'Spermidine (wheat germ extract)':             { short: 'Sp',  group: 'longevity' },
              'Trimethylglycine (TMG/Betaine anhydrous)':    { short: 'TMG', group: 'longevity' },
              'Apigenin':                                    { short: 'Ap',  group: 'longevity' },
              'Quercetin':                                   { short: 'Qc',  group: 'defense' },
              'Fisetin':                                     { short: 'Fis', group: 'neural' },
              'Turmeric (curcumin extract)':                 { short: 'Cur', group: 'defense' },
              'Fish Oil (total)':                            { short: 'FO',  group: 'defense' },
              'Ashwagandha (KSM-66)':                        { short: 'Ash', group: 'performance' },
              'Beetroot powder concentrate':                 { short: 'Btr', group: 'performance' },
              'Creatine':                                    { short: 'Cre', group: 'neural' },
              'Magnesium L-Threonate (Magtein)':             { short: 'MgT', group: 'neural' },
              'Shilajit resin':                              { short: 'Shi', group: 'adaptive' },
            };
            const bioactives = [];
            const regularNutrients = [];
            for (const n of visibleNutrients) {
              const key = n.nutrient || n.name || '';
              const meta = NAME_META[key];
              if (meta) {
                const taken = takenByName.has(key) ? takenByName.get(key) : (n.pct >= 80);
                bioactives.push({ ...n, _short: meta.short, _group: meta.group, _taken: taken });
              } else {
                regularNutrients.push(n);
              }
            }
            // Group bioactives by category for the same row-per-group layout
            // BioactiveStack uses on Daily/Nutrition/Fuel.
            const bioByGroup = {};
            for (const b of bioactives) {
              (bioByGroup[b._group] = bioByGroup[b._group] || []).push(b);
            }
            const BIO_GROUP_LABEL = {
              neural: 'Neural', longevity: 'Longevity', defense: 'Defense',
              performance: 'Perform', adaptive: 'Adaptive', other: 'Other',
            };
            const BIO_GROUP_ORDER = ['neural','longevity','defense','performance','adaptive','other'];
            const withAlpha = (hex, a) => {
              const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
              return `rgba(${r},${g},${b},${a})`;
            };
            // Single hex chip, same polygon as BioactiveStack.jsx MiniHive.
            const HexChip = ({ short, taken, color }) => (
              <svg width={28} height={28} viewBox="-15 -15 30 30" style={{ display:'block' }} fontFamily="ui-sans-serif" fontWeight={500} textAnchor="middle">
                <polygon
                  points="-12,-7 -12,7 0,14 12,7 12,-7 0,-14"
                  fill={taken ? withAlpha(color, 0.22) : 'transparent'}
                  stroke={taken ? color : withAlpha(color, 0.40)}
                  strokeWidth={1.2}
                  strokeDasharray={taken ? undefined : '2 2'}
                />
                <text y="0" dominantBaseline="central" fill={taken ? color : '#94a3b8'} fontSize={8}>{short}</text>
              </svg>
            );

            // Capitalize the display name for regular nutrients. Acronyms (Mg,
            // K, EPA, DHA, FFMI, ALMI etc.) stay as-is; ordinary lowercase
            // words get a leading capital ("beetroot" → "Beetroot").
            const capitalize = (s) => {
              if (!s) return s;
              if (/[A-Z]/.test(s)) return s;
              return s.charAt(0).toUpperCase() + s.slice(1);
            };
            // SVG donut helper — circumference math, fills stroke-dasharray.
            const Donut = ({ pct, color, size = 52 }) => {
              const stroke = 4;
              const r = (size - stroke) / 2;
              const C = 2 * Math.PI * r;
              const filled = Math.max(0, Math.min(pct / 100, 1)) * C;
              return (
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display:'block' }}>
                  <circle cx={size/2} cy={size/2} r={r}
                    fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke}/>
                  <circle cx={size/2} cy={size/2} r={r}
                    fill="none" stroke={color} strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${C - filled}`}
                    transform={`rotate(-90 ${size/2} ${size/2})`}/>
                </svg>
              );
            };
            return (
            <>
              {/* Bioactive stack — same hex chips + category colors as the
                  Daily/Nutrition/Fuel summary, so a Longevity/NMN looks
                  the same wherever it appears. Renders only when this
                  system actually weights bioactives. */}
              {Object.keys(bioByGroup).length > 0 && (
                <>
                  <div style={{ ...subHeaderStyle, marginTop: 8 }}>Bioactive stack · taken today</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {BIO_GROUP_ORDER.filter(g => bioByGroup[g] && bioByGroup[g].length).map(g => {
                      const color = BIO_GROUP_COLOR[g] || '#94a3b8';
                      const items = bioByGroup[g];
                      const takenCount = items.filter(x => x._taken).length;
                      return (
                        <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            fontSize: 10, fontWeight: 500, color,
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            minWidth: 90, flexShrink: 0,
                          }}>
                            {BIO_GROUP_LABEL[g] || g}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>
                              {takenCount}/{items.length}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {items.map((b, i) => (
                              <HexChip key={i} short={b._short} taken={b._taken} color={color} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {/* Regular nutrient donuts — only when there are non-bioactive
                  nutrients to show. */}
              {regularNutrients.length > 0 && (
              <>
              <div style={{ ...subHeaderStyle, marginTop: 8 }}>Nutrients · today's intake</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {regularNutrients.map((n, i) => {
                  const c = barColor(n.pct);
                  const name = capitalize(n.short || n.name);
                  return (
                    <div key={i} style={{
                      width: 86,
                      background: 'var(--bg-elevated)',
                      borderRadius: 8,
                      border: `0.5px solid ${c}33`,
                      padding: '8px 6px 6px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}>
                      <div style={{ position: 'relative' }}>
                        <Donut pct={n.pct} color={c}/>
                        <div style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: c, letterSpacing: '-0.02em',
                        }}>{n.pct}%</div>
                      </div>
                      <div style={{
                        fontSize: 10, fontWeight: 500, color: 'var(--text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        maxWidth: '100%', textAlign: 'center',
                      }}>{name}</div>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', lineHeight: 1 }}>
                        {n.value}/{n.target}
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
              )}
            </>
            );
          })()}

          {/* Training/body signal sections render NOTHING when all tiles in
              the section would be empty (renderSignalGrid returns null). */}
          {(() => {
            const trainingGrid = signals.training.length > 0 ? renderSignalGrid(signals.training, 'daily') : null;
            return trainingGrid ? (<><div style={subHeaderStyle}>Training signals</div>{trainingGrid}</>) : null;
          })()}
          {(() => {
            const bodyGrid = signals.body.length > 0 ? renderSignalGrid(signals.body, 'daily') : null;
            return bodyGrid ? (<><div style={subHeaderStyle}>Body signals</div>{bodyGrid}</>) : null;
          })()}
          {(() => {
            // Phase 4r.intel.upgrade.1 — only render the blood section when
            // at least one marker has a value (lab panel exists for at least
            // one of the tracked markers).
            const hasAnyBlood = signals.blood.some(sig => {
              const v = resolveBlood(sig).value;
              return v != null && v !== '—' && v !== '';
            });
            return signals.blood.length > 0 && hasAnyBlood;
          })() && (
            <>
              <div style={subHeaderStyle}>Blood markers · last lab panel</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.blood.filter(sig => { const v = resolveBlood(sig).value; return v != null && v !== '—' && v !== ''; }).length, 4)}, 1fr)`, gap: 8 }}>
                {signals.blood.filter(sig => { const v = resolveBlood(sig).value; return v != null && v !== '—' && v !== ''; }).map((sig, i) => {
                  const r = resolveBlood(sig);
                  return (
                    <div key={i} style={signalCellStyle}>
                      <div style={{ fontSize: 18, fontWeight: 600, color: r.value === '—' ? 'var(--text-muted)' : 'var(--text-primary)', lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 6 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Weekly tab ── */}
      {tab === 'weekly' && (
        <div>
          <div style={{ ...subHeaderStyle, marginTop: 0 }}>7-day score</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'flex-end' }}>
            {weekly.map((d, i) => {
              const barH = weeklyMax > 0 ? Math.max(6, Math.round((d.pct / weeklyMax) * 90)) : 6;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 10, color: barColor(d.pct), fontWeight: 600, marginBottom: 4 }}>{d.pct}</div>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 90 }}>
                    <div style={{ width: '100%', borderRadius: 4, height: barH, background: barColor(d.pct), transition: 'height 0.4s ease' }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>{d.dayLabel}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', padding: '8px 0', borderTop: '0.5px solid var(--border-subtle)' }}>
            <span style={{ fontWeight: 500 }}>Weekly avg</span>
            <span style={{ fontWeight: 600, color: barColor(weeklyAvg || 0) }}>{weeklyAvg || '—'}%</span>
          </div>
          {signals.training.length > 0 && (<><div style={subHeaderStyle}>Weekly training</div>{renderSignalGrid(signals.training, 'weekly')}</>)}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center', fontStyle: 'italic' }}>
            Nutrient scores reflect today's intake — log consistently for accurate weekly trends
          </div>
        </div>
      )}

      {/* ── Annual tab ── */}
      {tab === 'annual' && (
        <div>
          {signals.training.length > 0 && (<><div style={{ ...subHeaderStyle, marginTop: 0 }}>YTD training</div>{renderSignalGrid(signals.training, 'annual')}</>)}
          {signals.body.length > 0 && (<><div style={subHeaderStyle}>Body · current</div>{renderSignalGrid(signals.body, 'daily')}</>)}
          {signals.blood.length > 0 && (() => {
            // Lab freshness — pulled from the most recent panel that
            // contains *any* of this system's blood markers. Marker-level
            // status badges so the tile communicates what to act on.
            const sortedLabs = [...labsSource].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const latestLab = sortedLabs[0];
            const labAgeMo = latestLab?.date
              ? Math.round((Date.now() - new Date(`${latestLab.date}T12:00:00`).getTime()) / (30 * 86400000))
              : null;
            const stale = labAgeMo != null && labAgeMo > 12;
            return (
              <>
                <div style={{ ...subHeaderStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Latest labs</span>
                  {latestLab?.date ? (
                    <span style={{ fontSize: 9, color: stale ? '#fbbf24' : 'var(--text-muted)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                      panel · {latestLab.date}{stale ? ` · ${labAgeMo}mo old` : ''}
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, color: '#fbbf24', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>no panel on file</span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(3, Math.min(signals.blood.length, 4))}, 1fr)`, gap: 8 }}>
                  {signals.blood.map((sig, i) => {
                    const r = resolveBlood(sig);
                    const hasValue = r.value !== '—' && r.value != null;
                    return (
                      <div key={i} style={{ ...signalCellStyle, opacity: hasValue ? 1 : 0.65 }}>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sig}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 18, fontWeight: 600, color: hasValue ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1 }}>{r.value}</span>
                          {r.unit && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.unit}</span>}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                          {hasValue
                            ? (stale ? <span style={{ color: '#fbbf24' }}>stale — re-test</span> : <span>recorded</span>)
                            : <span style={{ color: '#fbbf24' }}>no result</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
