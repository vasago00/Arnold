// EasyZoneCard — "define easy honestly" (P4) as a health card. Shows the athlete's PERSONAL aerobic
// ceiling (LT1) computed on heart-rate RESERVE from their own data, the easy band, how much of their
// running is genuinely easy (the 80/20 check), recent hot-drift, and — for honesty — the inputs and
// confidence behind the estimate. Pure presentation over core/derive/easyZoneResolve.js.
import { useMemo } from 'react';
import { resolveEasyZone } from '../core/derive/easyZoneResolve.js';
import { storage } from '../core/storage.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';

const GREEN = '#34d399';
const AMBER = '#f0c33a';
const T1 = 'var(--text-primary, #e8eaed)';
const T2 = 'var(--text-secondary, #b7bcc4)';
const T3 = 'var(--text-muted, #8a8f98)';

export default function EasyZoneCard({ style }) {
  const v = useStorageVersion();
  const z = useMemo(() => { try { return resolveEasyZone({ storage, today: new Date().toISOString().slice(0, 10) }); } catch { return null; } }, [v]);
  if (!z || !(z.easyCeilingBpm > 0) || !z.distribution || !z.distribution.nRuns) return null;

  const ceil = Math.round(z.easyCeilingBpm);
  const low = Math.round(z.band?.lowBpm ?? z.guardrails?.aerobicCoreBpm ?? ceil - 8);
  const pctHrr = Math.round((z.easyCeilingPctHrr ?? z.lt1?.pctHrr ?? 0) * 100);
  const share = Math.round((z.distribution.easyShare || 0) * 100);
  const grey = Math.round((z.distribution.greyShare || 0) * 100);
  const meetsTarget = share >= 80;
  const accent = meetsTarget ? GREEN : AMBER;
  const conf = z.lt1?.confidence ?? 0;
  const confLabel = conf >= 0.7 ? 'high confidence' : conf >= 0.4 ? 'moderate confidence' : 'building — needs more runs';
  const dataDriven = z.source === 'personal-data' || String(z.lt1?.method || '').includes('cluster');
  const method = dataDriven ? 'from your own runs' : z.lt1?.method === 'fallback' ? 'central estimate' : `from your ${z.source} zones`;
  const driftN = (z.drift || []).length;
  const fmtPace = (p) => (p > 0 ? `${Math.floor(p)}:${String(Math.round((p - Math.floor(p)) * 60) % 60).padStart(2, '0')}` : null);
  const ep = z.easyPace;

  const card = { background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '14px 16px 12px', color: T1, ...style };
  const row = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 };

  return (
    <div style={card}>
      {/* header */}
      <div style={{ ...row, marginBottom: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, display: 'inline-block', boxShadow: `0 0 6px ${accent}66` }} />
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', color: accent }}>EASY ZONE · AEROBIC CEILING</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: accent }}>{ceil} bpm</span>
      </div>

      <div style={{ fontSize: 11.5, color: T2, lineHeight: 1.5, marginBottom: 11 }}>
        Your easy runs should stay at or below <strong style={{ color: T1 }}>{ceil} bpm</strong> — {pctHrr}% of your heart-rate reserve, estimated {method}. Above it, an easy day quietly becomes a workout.
      </div>

      {/* the band */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Line label="Target HR" value={`${low}–${ceil} bpm`} sub={`aerobic core → ceiling · reserve ${Math.round((z.guardrails?.aerobicCoreBpm != null ? (z.guardrails.aerobicCoreBpm - z.hrRest) / z.hrr : 0) * 100)}–${pctHrr}%`} />
        {ep && <Line label="Easy pace" value={`${fmtPace(ep.fast)}–${fmtPace(ep.slow)}/mi`} sub={`typical ${fmtPace(ep.median)}/mi · the pace that holds this HR (varies with heat & terrain)`} />}

        {/* 80/20 share bar */}
        <div style={{ marginTop: 2 }}>
          <div style={{ ...row, marginBottom: 4 }}>
            <span style={{ fontSize: 11.5, color: T2 }}>Truly easy volume</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: accent }}>{share}%</span>
          </div>
          <div style={{ position: 'relative', height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${share}%`, background: accent, borderRadius: 4 }} />
            {/* 80% target marker */}
            <div style={{ position: 'absolute', left: '80%', top: -1, bottom: -1, width: 1.5, background: T1, opacity: 0.55 }} />
          </div>
          <div style={{ fontSize: 10, color: T3, marginTop: 4, lineHeight: 1.4 }}>
            {meetsTarget
              ? `Past the 80% polarized target — ${grey > 0 ? `only ${grey}% drifts into the grey zone. ` : ''}this is the discipline that makes the hard days land.`
              : `Below the 80% target — ${grey}% is drifting into the grey zone. Easing those under ${ceil} bpm frees the quality days.`}
          </div>
        </div>
      </div>

      {/* recent drift */}
      {driftN > 0 && (
        <div style={{ fontSize: 11, color: T2, lineHeight: 1.45, marginTop: 11, paddingTop: 9, borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
          <strong style={{ color: T1 }}>{driftN}</strong> recent easy run{driftN === 1 ? '' : 's'} ran hot (over the ceiling)
          {z.restElevated >= 3 ? ` — your resting HR is up ${Math.round(z.restElevated)} bpm, so that's fatigue, not effort.` : ' — most likely heat or a tired day, not extra effort.'}
        </div>
      )}

      {/* transparency footer */}
      <div style={{ fontSize: 10, color: T3, lineHeight: 1.45, marginTop: 11, paddingTop: 9, borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
        Reserve {z.hrr} bpm (max {z.hrMax} − resting {z.hrRest}) · {confLabel} · {z.distribution.nRuns} runs. Ceiling tracks your fitness — it re-computes as your data moves.
      </div>
    </div>
  );
}

function Line({ label, value, sub }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: T2 }}>{label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: T1 }}>{value}</span>
      </div>
      {sub && <div style={{ fontSize: 10, color: T3, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
