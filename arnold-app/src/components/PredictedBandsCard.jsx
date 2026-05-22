// ─── PredictedBandsCard (Phase 4r.intel.11 — Layer 3 UI) ───────────────────
// Shows the expected ranges the user should land in for a planned (or
// in-progress) workout. Pulls weather forecast + fatigue + personal
// baselines via predictedBands.getPredictedBands().
//
// Renders 4-6 of the most informative bands for the family in a compact
// strip — desktop and mobile both render the same component; the parent
// chooses where to slot it (Calendar drawer, Play tab pre-workout, etc.).
//
// Props:
//   family    — one of EXPECTED_RANGES families (easy_run / tempo / hiit / …)
//   dateStr   — YYYY-MM-DD for the planned workout
//   maxHR     — optional, used to convert avgHR_pctMax band → BPM range so
//               the user sees a real heart rate window rather than %max.
//
// Self-fetches asynchronously; renders a placeholder while loading and
// degrades gracefully when offline (no weather).

import { useEffect, useState } from 'react';
import { getPredictedBands, dropPin } from '../core/predictedBands.js';
import { BatteryLow } from '@phosphor-icons/react';

const FAMILY_COLOR = {
  easy_run:  '#60a5fa',
  long_run:  '#60a5fa',
  tempo:     '#fbbf24',
  intervals: '#fbbf24',
  hiit:      '#fb7185',
  strength:  '#a78bfa',
  mobility:  '#5eead4',
  cross:     '#22d3ee',
  race:      '#fb7185',
  run:       '#60a5fa',
};

// Display order + per-metric formatting. The first ~4 are surfaced by
// default; trailing ones render only when they have a band.
const DISPLAY_ORDER = [
  { id: 'avgHR_pctMax', label: 'Avg HR',     unit: '%max', toBPM: true },
  { id: 'z45Pct',       label: 'Z4-5 time',  unit: '%' },
  { id: 'z2Pct',        label: 'Z2 time',    unit: '%' },
  { id: 'cardiacDrift', label: 'Drift',      unit: '%' },
  { id: 'decoupling',   label: 'Decoupling', unit: '%' },
  { id: 'hrRecovery1m', label: 'HR rec 1m',  unit: 'bpm' },
  { id: 'aerobicTE',    label: 'Aerobic TE', unit: '/5' },
  { id: 'anaerobicTE',  label: 'Anaer TE',   unit: '/5' },
];

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 100) return String(Math.round(n));
  if (Math.abs(n) >= 10)  return n.toFixed(0);
  return n.toFixed(1);
}

function bandText(band, defMeta, maxHR) {
  if (band.toBPM && maxHR) {
    // Convert %max band → BPM band. Round to nearest BPM for readability.
    const lo = Math.round((band.min / 100) * maxHR);
    const hi = Math.round((band.max / 100) * maxHR);
    return `${lo}-${hi}`;
  }
  if (band.direction === 'lower-better') return `≤ ${fmt(band.max)}`;
  if (band.direction === 'higher-better') return `≥ ${fmt(band.min)}`;
  return `${fmt(band.min)}-${fmt(band.max)}`;
}

export function PredictedBandsCard({ family, dateStr, maxHR, conditions }) {
  const [state, setState] = useState({ loading: true, bands: null, source: null });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, bands: null, source: null });
    getPredictedBands({ family, dateStr, conditions })
      .then(r => { if (!cancelled) setState({ loading: false, bands: r.bands, source: r.source }); })
      .catch(()  => { if (!cancelled) setState({ loading: false, bands: [],   source: null      }); });
    return () => { cancelled = true; };
  }, [family, dateStr, conditions?.tempC, conditions?.humidityPct, refreshTrigger]);

  const handleDropPin = async () => {
    if (pinning) return;
    setPinning(true);
    setPinError(null);
    try {
      const r = await dropPin();
      if (r.ok) {
        setRefreshTrigger(n => n + 1);  // re-pull bands with new pin
      } else {
        setPinError(r.error === 'denied' ? 'permission denied'
          : r.error === 'unsupported' ? 'not supported'
          : 'failed');
      }
    } finally {
      setPinning(false);
    }
  };

  const color = FAMILY_COLOR[family] || FAMILY_COLOR.run;

  if (state.loading) {
    return (
      <div style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-md, 8px)',
        padding: '8px 12px',
        fontSize: 10, color: 'var(--text-muted)',
        letterSpacing: '0.04em',
      }}>
        Loading expected bands…
      </div>
    );
  }

  const bands = state.bands || [];
  if (!bands.length) return null;

  // Build the display list. Use DISPLAY_ORDER's known metrics first; drop
  // any that don't have a band for this family.
  const cells = [];
  for (const def of DISPLAY_ORDER) {
    const b = bands.find(x => x.metricId === def.id);
    if (!b) continue;
    cells.push({
      ...def,
      band: b,
      text: bandText({ ...b, toBPM: def.toBPM }, def, maxHR),
    });
  }
  if (!cells.length) return null;

  const src = state.source || {};
  const condBits = [];
  if (Number.isFinite(src.tempC))       condBits.push({ kind: 'text', text: `${Math.round(src.tempC)}°C` });
  if (Number.isFinite(src.humidityPct)) condBits.push({ kind: 'text', text: `${Math.round(src.humidityPct)}% RH` });
  if (src.hasFatigue)                   condBits.push({ kind: 'fatigue' });
  if (src.baselineN >= 5)               condBits.push({ kind: 'text', text: `n=${src.baselineN}` });
  // Surface the empty-state explicitly when there's literally no weather
  // (no home coords + no recent weathered activities). Helps the user
  // understand why the bands aren't conditions-adjusted.
  const noWeather = !Number.isFinite(src.tempC) && !Number.isFinite(src.humidityPct);

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderLeft: `2px solid ${color}`,
      borderRadius: 'var(--radius-md, 8px)',
      padding: '8px 10px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color, letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          Expected today
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
          {condBits.length > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap',
            }}>
              {condBits.map((b, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {i > 0 && <span aria-hidden style={{ opacity: 0.45 }}>·</span>}
                  {b.kind === 'fatigue' ? (
                    <BatteryLow
                      size={12}
                      weight="bold"
                      color="var(--text-muted)"
                      aria-label="Bands widened for accumulated fatigue"
                    >
                      <title>Bands widened for accumulated fatigue (CTL / TSB / consecutive hard days)</title>
                    </BatteryLow>
                  ) : (
                    <span>{b.text}</span>
                  )}
                </span>
              ))}
            </span>
          )}
          <button
            onClick={handleDropPin}
            disabled={pinning}
            title="Use my current location (6h cache)"
            style={{
              all: 'unset', cursor: pinning ? 'wait' : 'pointer',
              fontSize: 9, fontWeight: 600, padding: '2px 7px',
              borderRadius: 4, color,
              background: `${color}14`,
              border: `0.5px solid ${color}44`,
              letterSpacing: '0.04em', whiteSpace: 'nowrap',
              opacity: pinning ? 0.6 : 1,
            }}
          >
            {pinning ? '···' : pinError ? `📍 ${pinError}` : '📍 Drop a pin'}
          </button>
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(82px, 1fr))',
        gap: '6px 10px',
      }}>
        {cells.map(c => (
          <div key={c.id} style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.04em',
              textTransform: 'uppercase', lineHeight: 1.1,
            }}>
              {c.label}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
              <span style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
                lineHeight: 1, whiteSpace: 'nowrap',
              }}>
                {c.text}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {c.toBPM && maxHR ? 'bpm' : c.unit}
              </span>
              {c.band.personalized && (
                <span title={`personalized (n=${c.band.baselineN})`}
                  style={{ fontSize: 8, color, marginLeft: 2 }}>★</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {noWeather && (
        <div style={{
          marginTop: 6, fontSize: 9, color: 'var(--text-muted)',
          lineHeight: 1.3,
        }}>
          No weather yet · sync Garmin or set home location in Goals → Profile.
        </div>
      )}
    </div>
  );
}

export default PredictedBandsCard;
