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
import { useStorageVersion } from '../hooks/useStorageVersion.js';
import { TEXT, STATUS } from '../theme/tokens.js';

const FACTOR_LABEL = {
  heat: 'Heat strain', heatStrain: 'Heat strain',
  sleep: 'Sleep', sleepAcute: 'Sleep (acute)', sleepChronic: 'Sleep (chronic)',
  fuel: 'Fuel', hrv: 'HRV', rhr: 'Resting HR', load: 'Training load',
};

// Plain-language magnitude per factor (the "why", spelled out).
function magnitudeText(f, pct, unit) {
  const a = Math.abs(pct);
  const sign = pct > 0 ? '+' : '−';
  switch (f) {
    case 'heat': case 'heatStrain': return `+${a}% cardiac cost per °C above 20°`;
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
function BellCurve({ value = 0, confidence = 0, color = TEXT.muted, width = 96, height = 26 }) {
  const v = Number(value) || 0;
  const c = Math.max(0.02, Math.min(0.98, confidence || 0));
  const sigma = Math.abs(v) * Math.sqrt((1 - c) / c);
  const pad = Math.abs(v) * 0.6 || 1;
  const lo = Math.min(0, v), hi = Math.max(0, v);
  const xMin = lo - pad, xMax = hi + pad;
  const span = (xMax - xMin) || 1;
  const X = t => ((t - xMin) / span) * width;
  const muPx = X(v);
  const zeroPx = X(0);
  const sigPx = Math.max(2, Math.min(width, (sigma / span) * width));
  const topPad = 3;                 // headroom so the peak + stroke never touch the top edge
  const amp = height - topPad;
  const N = 56;
  let d = `M 0 ${height}`;
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * width;
    const y = height - amp * Math.exp(-((x - muPx) ** 2) / (2 * sigPx * sigPx));
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${width} ${height} Z`;
  const zx = Math.max(2, Math.min(width - 2, zeroPx));
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
  if (factor.startsWith('sleep'))
    return <svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>;
  if (factor === 'fuel' || factor === 'load')
    return <svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
  // hrv / rhr / default → pulse
  return <svg {...p}><path d="M3 12h4l2 6 4-12 2 6h6"/></svg>;
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
  const [open, setOpen] = useState(null);

  if (!facts) return null;

  const responses = (facts.responses || [])
    .filter(r => Number.isFinite(r.perUnitPct) && Math.abs(r.perUnitPct) >= 0.5)
    .slice(0, 3);
  const seeded = !!facts.refEquivSecs;

  const card = {
    background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)',
    borderRadius: 12, padding: '14px 16px 12px', minWidth: 0, color: TEXT.primary, ...style,
  };
  const rowBorder = '0.5px solid rgba(255,255,255,0.06)';

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M9.5 2a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 7 16a3 3 0 0 0 5 1 3 3 0 0 0 5-1 3 3 0 0 0 1.5-5.2A3 3 0 0 0 17.5 5a3 3 0 0 0-3-3 3 3 0 0 0-5 0z"/>
          </svg>
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', color: '#5eead4' }}>WHAT ARNOLD HAS LEARNED ABOUT YOU</span>
        </div>
        <span style={{ fontSize: 9, color: TEXT.faint, whiteSpace: 'nowrap' }}>your data · not a generic model</span>
      </div>
      <div style={{ fontSize: 11, color: TEXT.muted, marginBottom: 11 }}>
        The “why” behind your scores — found in your own efforts.
      </div>

      {/* Learned sensitivities (the lead) */}
      {responses.length > 0 ? responses.map(r => {
        const isOpen = open === r.factor;
        return (
          <div key={r.factor} style={{ borderTop: rowBorder }}>
            <div onClick={() => setOpen(isOpen ? null : r.factor)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', cursor: 'pointer' }}>
              <FactorIcon factor={r.factor} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{FACTOR_LABEL[r.factor] || r.factor}</div>
                <div style={{ fontSize: 11, color: TEXT.muted }}>{magnitudeText(r.factor, r.perUnitPct, r.unit)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, width: 96, flexShrink: 0 }}>
                <BellCurve value={r.perUnitPct} confidence={r.confidence || 0} color={confColor(r.confidence || 0)} width={96} height={26} />
                <span style={{ fontSize: 10, color: TEXT.muted }}>{Math.round((r.confidence || 0) * 100)}% sure</span>
              </div>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="M9 6l6 6-6 6"/>
              </svg>
            </div>
            {isOpen && (
              <div style={{ fontSize: 11, color: TEXT.secondary, lineHeight: 1.5, padding: '0 0 10px 30px' }}>
                {FACTOR_WHY[r.factor] || 'Learned from your own efforts — Arnold isolates this effect from the others as more sessions come in.'}
              </div>
            )}
          </div>
        );
      }) : (
        <div style={{ fontSize: 11, color: TEXT.secondary, lineHeight: 1.45, padding: '8px 0', borderTop: rowBorder }}>
          Still learning how heat, sleep and fuel affect you — a few more races or hard efforts run in a known context and Arnold will start quantifying your personal costs here.
        </div>
      )}

      {/* Footer: race fitness + sweat */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 11, paddingTop: 10, borderTop: '0.5px solid rgba(255,255,255,0.10)', fontSize: 11, color: TEXT.secondary }}>
        {seeded && (facts.predictions || []).length > 0 && (
          <span><span style={{ color: TEXT.faint }}>Race fitness </span>
            {(facts.predictions || []).filter(p => p.time).map(p => `${p.dist} ${p.time}`).join(' · ')}
          </span>
        )}
        {facts.sweat && (
          <span><span style={{ color: TEXT.faint }}>Sweat </span>{facts.sweat.rateLhr} L/hr</span>
        )}
        {energy && energy.maintenance && energy.maintenance.value > 0 && (
          <span>
            <span style={{ color: TEXT.faint }}>Maintenance </span>
            {energy.maintenance.value.toLocaleString()} kcal
            <span style={{ color: TEXT.faint }}> · {energy.maintenance.note}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default LearnedHero;
