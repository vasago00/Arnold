// HubPanel — the Intelligence Hub's on-screen presence: a compact "what Arnold
// knows about you" panel for the Daily training column (fills the space under the
// activity card). Unlike the old HubCard (predictions-first, hid itself when
// unseeded), this LEADS with the hub's learned response sensitivities — the part
// that's genuinely personal and not visible anywhere else — and shows race-fitness
// predictions as a secondary strip. It always renders something: when the model
// is still cold it shows an honest "learning" state instead of an empty gap.
//
// Read-only: builds the hub fresh from stored history (buildHubFromStorage does
// NOT persist) and renders hubFacts. The deterministic engine is the brain; this
// is one of the surfaces it speaks through. See docs/HUB_CORE.md + HUB_GO_LIVE.md.

import { useMemo } from 'react';
import { buildHubFromStorage } from '../core/hub/hubDebug.js';

// Friendly names + phrasing for the learned confounders.
const FACTOR_LABEL = {
  heat: 'Heat', sleep: 'Sleep', sleepAcute: 'Sleep (acute)', sleepChronic: 'Sleep (chronic)',
  fuel: 'Fuel', hrv: 'HRV', rhr: 'Resting HR', load: 'Training load',
  heatStrain: 'Heat strain',
};

const dot = (color) => ({
  width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0,
});

function confColor(c) {
  return c >= 0.6 ? '#4ade80' : c >= 0.3 ? '#fbbf24' : '#94a3b8';
}

export function HubPanel({ style }) {
  const facts = useMemo(() => {
    try { return buildHubFromStorage().facts; } catch { return null; }
  }, []);

  if (!facts) return null;

  const responses = (facts.responses || []).filter(r => Number.isFinite(r.perUnitPct));
  const seeded = !!facts.refEquivSecs;
  const conf = facts.fitnessConfidence || 0;
  const caveat = !seeded ? 'learning'
    : conf < 0.75 ? 'training-anchored · sharpens when you race'
    : `confidence ${Math.round(conf * 100)}%`;

  const card = {
    background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)', padding: 'clamp(12px,1.2vw,16px)',
    minWidth: 0, ...style,
  };
  const hdr = {
    fontSize: 9, fontWeight: 600, color: 'var(--text-muted)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
  };
  const subCap = {
    fontSize: 8.5, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase',
  };

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span style={hdr}>Intelligence</span>
        <span style={{ fontSize: 8.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{caveat}</span>
      </div>

      {/* LEAD: what the hub has learned about YOU (the unique value). */}
      <div style={subCap}>What Arnold's learned about you</div>
      {responses.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {responses.slice(0, 3).map(r => (
            <div key={r.factor} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={dot(confColor(r.confidence || 0))} />
              <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                {FACTOR_LABEL[r.factor] || r.factor}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary, var(--text-muted))', fontVariantNumeric: 'tabular-nums' }}>
                {r.perUnitPct > 0 ? '+' : ''}{r.perUnitPct}{r.unit}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                {Math.round((r.confidence || 0) * 100)}% sure
              </span>
            </div>
          ))}
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 2 }}>
            How much each condition slows you — learned from your own confounded efforts.
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-secondary, var(--text-muted))', marginTop: 6, lineHeight: 1.4 }}>
          Still learning how heat, sleep and fuel affect you. The model picks this up from
          races and hard efforts run with a known context — a few more and it'll start
          quantifying your personal costs here.
        </div>
      )}

      {/* SECONDARY: race-fitness predictions. */}
      <div style={{ marginTop: 12, borderTop: '0.5px solid var(--border-subtle)', paddingTop: 10 }}>
        <div style={subCap}>Race fitness</div>
        {seeded ? (
          <div style={{ display: 'flex', gap: 'clamp(8px,2vw,20px)', flexWrap: 'wrap', marginTop: 6 }}>
            {(facts.predictions || []).map(p => (
              <div key={p.dist} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{p.time}</span>
                <span style={{ fontSize: 8.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{p.dist}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-secondary, var(--text-muted))', marginTop: 6 }}>
            No race-equivalent yet — log a race or a hard standard-distance effort to seed it.
          </div>
        )}
      </div>

      {/* Personal sweat rate — only once before/after-run weigh-ins have taught it. */}
      {facts.sweat && (
        <div style={{ marginTop: 12, borderTop: '0.5px solid var(--border-subtle)', paddingTop: 10 }}>
          <div style={subCap}>Sweat rate</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{facts.sweat.rateLhr} L/hr</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>at 20°C · +{facts.sweat.perDegC}/°C</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default HubPanel;
