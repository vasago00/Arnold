// LearnedHero — Phase 1.1 of the uplift. The Intelligence Hub's differentiator,
// promoted to a confidence-aware HERO at the top of Daily: "what Arnold has learned
// about YOU" — the relationship, the magnitude in plain language, a confidence bar,
// and a tap that explains HOW it was learned. This is the answer to the "why" the
// whole category (Garmin/WHOOP) hides. Supersedes the small HubPanel "learned" line;
// also carries race-fitness + sweat as a compact footer.
//
// Read-only: builds the hub fresh from stored history (no persist) and renders
// hubFacts — same source the old HubPanel used.
import { useMemo, useState } from 'react';
import { buildHubFromStorage } from '../core/hub/hubDebug.js';
import { energyExpenditure } from '../core/energyExpenditure.js';   // Slice 2 — energy source + confidence
import { resolveEasyZone } from '../core/derive/easyZoneResolve.js';   // P4 — reserve-anchored easy pace + zone
import { CoachSigil } from './CoachSigil.jsx';   // the Coach's mark — replaces the generic brain glyph
import { useStorageVersion } from '../hooks/useStorageVersion.js';
import { TEXT, STATUS } from '../theme/tokens.js';

// decimal min/mi → "10:05"
function fmtPace(p) {
  if (!(p > 0)) return null;
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`;
}

const FACTOR_LABEL = {
  heat: 'Heat strain', heatStrain: 'Heat strain',
  humidity: 'Humidity', elevation: 'Elevation',
  sleep: 'Sleep', sleepAcute: 'Sleep (acute)', sleepChronic: 'Sleep (chronic)',
  fuel: 'Fuel', hrv: 'HRV', rhr: 'Resting HR', load: 'Training load',
};

// Plain-language magnitude per factor (the "why", spelled out).
function magnitudeText(f, pct, unit) {
  const a = Math.abs(pct);
  const sign = pct > 0 ? '+' : '−';
  switch (f) {
    case 'heat': case 'heatStrain': return `+${a}% cardiac cost per °C above 20°`;
    case 'humidity':                return `+${a}% cardiac cost per 10% humidity`;
    case 'elevation':               return `+${a}% cardiac cost per 50 m/mi climbed`;
    case 'sleep':                   return `+${a}% session quality per hour slept`;
    case 'sleepAcute':              return `+${a}% per hour lost on a short night`;
    case 'sleepChronic':            return `+${a}%/h from your week's sleep debt`;
    case 'fuel':                    return `−${a}% per session when under-fuelled`;
    default:                        return `${sign}${a}${unit}`;
  }
}

// How each pattern was learned (revealed on tap) — honest about the method.
const FACTOR_WHY = {
  heat: 'Learned by comparing your hard efforts in the heat against cool-day efforts at the same fitness — the extra cardiac drift is yours, not a textbook number.',
  heatStrain: 'Learned by comparing your hard efforts in the heat against cool-day efforts at the same fitness — the extra cardiac drift is yours, not a textbook number.',
  humidity: 'Learned from your runs on humid days vs dry days at the same easy effort — the extra heart rate is the humidity tax on your cooling, measured on you and separated from the raw heat.',
  elevation: 'Learned from your hillier runs vs flat ones at matched effort — how much your heart rate climbs with the terrain, isolated from pace and from the weather that day.',
  sleep: 'Found by tracking how your session quality moves with the sleep you logged the night before, holding training load constant.',
  sleepAcute: 'From sessions after a short night vs. a full one, at matched load — your acute sleep cost.',
  sleepChronic: 'From weeks where your rolling sleep debt was high vs. even — the chronic drag on your training.',
  fuel: 'From sessions you ran under-fuelled vs. topped-up, controlling for intensity — your personal fuelling penalty.',
};

function confColor(c) {
  return c >= 0.6 ? STATUS.good : c >= 0.3 ? STATUS.warn : STATUS.neutral;
}

// Confidence as an actual distribution of the LEARNED EFFECT — not a re-skinned
// bar. The bell is centred on the learned magnitude `value` (e.g. +0.71 %/°C);
// its spread is the uncertainty, and a dashed line marks zero ("no effect").
// So a high-confidence effect is a narrow mound sitting clear of zero ("we've
// nailed it"), while a low-confidence one is a broad mound spilling over zero
// ("could still be nothing yet").
//
// Spread is a confidence-derived uncertainty band, NOT a frequentist CI: the
// hub holds each effect as a Bayesian estimate whose confidence = p/(p+k0), so
// the relative spread is σ = |value|·√((1−c)/c). Under this, the effect's
// separation from zero reads as ≈√(c/(1−c)) sigmas — exactly what "% sure" means.
// The value-axis is anchored to `value` and 0 (pad ∝ |value|), so mean and the
// zero line sit at fixed x and only the WIDTH changes with confidence.
function BellCurve({ value = 0, confidence = 0, color = TEXT.muted, width = 122, height = 30 }) {
  const v = Number(value) || 0;
  const c = Math.max(0.02, Math.min(0.98, confidence || 0));
  const sigma = (Math.abs(v) * Math.sqrt((1 - c) / c)) || 1;
  // Fit the FULL curve: the axis spans ±3σ around the mean AND always includes zero,
  // so the whole bell tapers to baseline inside the box (never clipped) at any
  // confidence. Its SEPARATION from the dashed zero line still reads the certainty —
  // a narrow mound clear of zero = sure; a wide mound straddling zero = still unsure.
  const reach = 3 * sigma;
  const xMin = Math.min(0, v - reach);
  const xMax = Math.max(0, v + reach);
  const span = (xMax - xMin) || 1;
  const X = t => ((t - xMin) / span) * width;
  const zeroPx = X(0);
  const topPad = 3;                 // headroom so the peak + stroke never touch the top edge
  const amp = height - topPad;
  const N = 64;
  let d = `M 0 ${height}`;
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * width;
    const tv = xMin + (x / width) * span;                        // data value at this pixel
    const y = height - amp * Math.exp(-((tv - v) ** 2) / (2 * sigma * sigma));
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${width} ${height} Z`;
  const zx = Math.max(1, Math.min(width - 1, zeroPx));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'hidden' }} aria-hidden="true">
      <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
      <line x1={zx.toFixed(1)} y1="2" x2={zx.toFixed(1)} y2={height} stroke="rgba(255,255,255,0.40)" strokeWidth="1" strokeDasharray="2 2" />
      <path d={d} fill={color} fillOpacity="0.16" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Small inline icon per factor (no extra deps).
function FactorIcon({ factor }) {
  const c = TEXT.muted;
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0 } };
  if (factor === 'heat' || factor === 'heatStrain')
    return <svg {...p}><path d="M12 2.7c2 3 4 5.2 4 8a4 4 0 1 1-8 0c0-1.4.7-2.6 1.5-3.7C10.7 7.7 12 6 12 2.7z"/></svg>;
  if (factor === 'humidity')   // droplet
    return <svg {...p}><path d="M12 3s5 5.4 5 9a5 5 0 1 1-10 0c0-3.6 5-9 5-9z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/></svg>;
  if (factor === 'elevation')  // mountain
    return <svg {...p}><path d="M3 20h18L14 6l-3.5 6.5L8 9l-5 11z"/></svg>;
  if (factor.startsWith('sleep'))
    return <svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>;
  if (factor === 'fuel' || factor === 'load')
    return <svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
  // hrv / rhr / default → pulse
  return <svg {...p}><path d="M3 12h4l2 6 4-12 2 6h6"/></svg>;
}

// Easy-run HR DISTRIBUTION — the real density of where the athlete's runs land (avg HR), drawn over the
// zone bands (recovery → easy → grey → hard) with the ceiling marked. Same "mound" language as the
// sensitivity bells, but this one is OBSERVED DATA, not estimate-uncertainty (kept honest by its caption).
function EasyDistCurve({ dist = [], recoveryBpm, ceilingBpm, lt2Bpm, height = 58 }) {
  if (!dist.length || !(ceilingBpm > 0)) return null;
  const W = 300, H = height, base = H - 2, amp = H - 8;
  const rec = recoveryBpm || Math.round(ceilingBpm * 0.92);
  const lt2 = lt2Bpm || Math.round(ceilingBpm * 1.15);
  const lo = Math.max(95, rec - 26);
  const hi = Math.max(lt2 + 6, ceilingBpm + 12);
  const span = (hi - lo) || 1;
  const X = (hr) => ((hr - lo) / span) * W;
  const maxN = Math.max(...dist.map((d) => d.n), 1);
  const Y = (n) => base - amp * (n / maxN);
  let path = `M ${X(dist[0].hr).toFixed(1)} ${base}`;
  for (const p of dist) path += ` L ${X(p.hr).toFixed(1)} ${Y(p.n).toFixed(1)}`;
  path += ` L ${X(dist[dist.length - 1].hr).toFixed(1)} ${base} Z`;
  const R = (a, b, fill) => { const x0 = X(Math.max(a, lo)); const w = X(Math.min(b, hi)) - x0; return w > 0 ? <rect x={x0} y="0" width={w} height={base} fill={fill} /> : null; };
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }} aria-hidden="true">
      {R(lo, rec, 'rgba(94,234,212,0.10)')}
      {R(rec, ceilingBpm, 'rgba(52,211,153,0.22)')}
      {R(ceilingBpm, lt2, 'rgba(240,195,58,0.15)')}
      {R(lt2, hi, 'rgba(248,113,113,0.15)')}
      <path d={path} fill="#5eead4" fillOpacity="0.22" stroke="#5eead4" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <line x1={X(ceilingBpm)} y1="0" x2={X(ceilingBpm)} y2={base} stroke="#e8eaed" strokeWidth="1.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function LearnedHero({ style }) {
  // Re-derive whenever the storage layer fires a change (Cloud Sync pull, a new
  // Garmin/Cronometer sync, a manual edit). Without this the useMemos below ran
  // once at mount and the whole card — learned sensitivities AND the race-fitness
  // / sweat / maintenance footer — stayed frozen until a full app restart.
  const storageVersion = useStorageVersion();
  const facts = useMemo(() => {
    try { return buildHubFromStorage().facts; } catch { return null; }
  }, [storageVersion]);
  // Slice 2: the one energy service — surface maintenance + WHERE the number came from
  // (your weight trend vs estimate) so the hero's "what Arnold learned" includes energy.
  const energy = useMemo(() => {
    try { return energyExpenditure(); } catch { return null; }
  }, [storageVersion]);
  // P4 — the athlete's reserve-anchored easy pace + zone, from the app's single source of truth.
  const ez = useMemo(() => {
    try { return resolveEasyZone({ today: new Date().toISOString().slice(0, 10) }); } catch { return null; }
  }, [storageVersion]);
  const [open, setOpen] = useState(null);

  if (!facts && !ez) return null;

  // The ENVIRONMENTAL sensitivities (heat/humidity/elevation) are the model's whole
  // differentiator — the regression already gated them on having ≥3 runs with real
  // spread, so if one exists it's a genuine (if early/uncertain) read and should SHOW,
  // with the bell communicating how sure it is. Only the recovery factors get a
  // magnitude gate, to keep a trivial one from cluttering the card.
  const ENV = new Set(['heat', 'heatStrain', 'humidity', 'elevation']);
  const responses = ((facts && facts.responses) || [])
    .filter(r => Number.isFinite(r.perUnitPct) && (ENV.has(r.factor) ? Math.abs(r.perUnitPct) >= 0.02 : Math.abs(r.perUnitPct) >= 0.3))
    .slice(0, 5);   // heat · humidity · elevation · sleep · rhr — the learned environmental + recovery costs
  const seeded = !!(facts && facts.refEquivSecs);
  const showEasy = !!(ez && ez.easyPace && ez.easyCeilingBpm > 0);

  const card = {
    background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)',
    borderRadius: 12, padding: '14px 16px 12px', minWidth: 0, color: TEXT.primary, ...style,
  };
  const rowBorder = '0.5px solid rgba(255,255,255,0.06)';
  const gcell = { background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '11px 12px', minWidth: 0, cursor: 'pointer' };
  // Direction 1 grammar: a per-tile kind chip + a labelled section rule.
  const kicker = { fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap' };
  const sectionLabel = (text) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 2px 8px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: TEXT.muted }}>{text}</span>
      <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
    </div>
  );
  const races = (facts && facts.predictions || []).filter(p => p.time);

  return (
    <div style={card}>
      {/* Header — the Coach's mark */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <CoachSigil size={16} />
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', color: '#5eead4' }}>WHAT ARNOLD HAS LEARNED ABOUT YOU</span>
        </div>
        <span style={{ fontSize: 9, color: TEXT.faint, whiteSpace: 'nowrap' }}>Your data · not a generic model</span>
      </div>
      <div style={{ fontSize: 11, color: TEXT.muted, marginBottom: 12 }}>
        The “why” behind your scores — found in your own efforts.
      </div>

      {/* Direction 1 — MEASURED vs LEARNED. Two kinds of knowledge, one grammar:
          the easy-zone histogram is OBSERVED (a picture of where your runs land);
          the sensitivity bells are INFERRED effects ± confidence. A section label +
          a per-tile kicker makes that difference intentional, not accidental. */}

      {/* MEASURED — the observed hero (full width) */}
      {showEasy && (() => {
        const share = Math.round((ez.distribution?.easyShare || 0) * 100);
        const conf = ez.lt1?.confidence || 0;
        return (
          <>
            {sectionLabel('Measured — where your training sits')}
            <div onClick={() => setOpen(open === 'easy' ? null : 'easy')}
              style={{ ...gcell, background: 'rgba(94,234,212,0.05)', border: '0.5px solid rgba(94,234,212,0.18)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...kicker, color: '#7fd4e4', background: 'rgba(111,212,228,0.12)' }}>Measured</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#5eead4' }}>Easy pace &amp; zone</span>
              </div>
              <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 6, minHeight: 26, lineHeight: 1.35 }}>≤{ez.easyCeilingBpm} bpm · {fmtPace(ez.easyPace.fast)}–{fmtPace(ez.easyPace.slow)}/mi</div>
              <EasyDistCurve dist={ez.hrDist} recoveryBpm={ez.recoveryBpm} ceilingBpm={ez.easyCeilingBpm} lt2Bpm={ez.lt2Bpm} height={44} />
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 9, color: TEXT.faint }}>Recovery · <span style={{ color: '#34d399' }}>easy</span> · grey · hard</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: confColor(conf) }}>{share}% easy <span style={{ fontSize: 9.5, fontWeight: 400, color: TEXT.muted }}>· {Math.round(conf * 100)}% sure</span></span>
              </div>
            </div>
          </>
        );
      })()}

      {/* LEARNED — inferred effects + confidence (bell grid) */}
      {responses.length > 0 && (
        <>
          {sectionLabel('Learned — what the conditions cost you')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {responses.map(r => (
              <div key={r.factor} onClick={() => setOpen(open === r.factor ? null : r.factor)} style={gcell}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...kicker, color: '#b9a7e0', background: 'rgba(155,142,196,0.14)' }}>Learned</span>
                  <FactorIcon factor={r.factor} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{FACTOR_LABEL[r.factor] || r.factor}</span>
                </div>
                <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 6, minHeight: 26, lineHeight: 1.35 }}>{magnitudeText(r.factor, r.perUnitPct, r.unit)}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                  <BellCurve value={r.perUnitPct} confidence={r.confidence || 0} color={confColor(r.confidence || 0)} width={122} height={26} />
                  <span style={{ fontSize: 9.5, color: TEXT.muted, whiteSpace: 'nowrap', paddingBottom: 2 }}>{Math.round((r.confidence || 0) * 100)}% sure</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Tap-to-explain — one strip under the grid for whichever card is open */}
      {open && (() => {
        let text;
        if (open === 'easy' && showEasy) {
          const pctHrr = Math.round((ez.easyCeilingPctHrr || 0) * 100);
          const dataDriven = ez.source === 'personal-data' || String(ez.lt1?.method || '').includes('cluster');
          const share = Math.round((ez.distribution?.easyShare || 0) * 100);
          text = `Your aerobic ceiling is ${ez.easyCeilingBpm} bpm — ${pctHrr}% of your heart-rate reserve (max ${ez.hrMax} − resting ${ez.hrRest}), ${dataDriven ? 'found from where your pace stops improving as your heart rate climbs' : `from your ${ez.source} zones`}. The curve is where your runs actually land — ${share}% sit under the ceiling, at ${fmtPace(ez.easyPace.median)}/mi typical. Hold the easy days here so the hard days have something to give.`;
        } else {
          text = FACTOR_WHY[open] || 'Learned from your own efforts — Arnold isolates this effect from the others as more sessions come in.';
        }
        return <div style={{ fontSize: 11, color: TEXT.secondary, lineHeight: 1.5, marginTop: 10, paddingTop: 9, borderTop: rowBorder }}>{text}</div>;
      })()}

      {responses.length === 0 && !showEasy && (
        <div style={{ fontSize: 11, color: TEXT.secondary, lineHeight: 1.45, padding: '8px 0' }}>
          Still learning how heat, humidity, elevation, sleep and fuel affect you — a few more efforts in a known context and Arnold will quantify your personal costs here.
        </div>
      )}

      {/* Footer one-liner: race fitness · sweat · maintenance */}
      {(races.length > 0 || (facts && facts.sweat) || (energy && energy.maintenance && energy.maintenance.value > 0)) && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 11, paddingTop: 10, borderTop: '0.5px solid rgba(255,255,255,0.10)', fontSize: 11, color: TEXT.secondary }}>
          {races.length > 0 && (
            <span><span style={{ color: TEXT.faint }}>Race fitness </span>{races.map(p => `${p.dist} ${p.time}`).join(' · ')}</span>
          )}
          {facts && facts.sweat && (
            <span><span style={{ color: TEXT.faint }}>Sweat </span>{facts.sweat.rateLhr} L/hr</span>
          )}
          {energy && energy.maintenance && energy.maintenance.value > 0 && (
            <span><span style={{ color: TEXT.faint }}>Maintenance </span>{energy.maintenance.value.toLocaleString()} kcal<span style={{ color: TEXT.faint }}> · {energy.maintenance.note}</span></span>
          )}
        </div>
      )}
    </div>
  );
}

export default LearnedHero;
