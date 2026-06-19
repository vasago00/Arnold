// HubCard — surfaces the Intelligence Hub's fitness predictions + learned response
// sensitivities on a screen, with an honest calibration caveat. Read-only: it
// loads (or first-time backfills) the persisted hub via ensureHubFromStorage and
// renders hubFacts. Renders nothing until the hub has a seeded fitness read.
// See docs/HUB_GO_LIVE.md (Step 3).

import { useEffect, useState } from 'react';
import { ensureHubFromStorage } from '../core/hub/hubDebug.js';

export function HubCard() {
  const [facts, setFacts] = useState(null);
  useEffect(() => {
    try {
      const res = ensureHubFromStorage();
      setFacts(res && res.facts ? res.facts : null);
    } catch {
      setFacts(null);
    }
  }, []);

  if (!facts || !facts.refEquivSecs) return null; // nothing trustworthy to show yet

  const conf = facts.fitnessConfidence || 0;
  // Until a race calibrates it, the read is training-anchored — say so plainly.
  const caveat = conf < 0.75
    ? 'training-anchored · sharpens when you race'
    : `confidence ${Math.round(conf * 100)}%`;

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: 'clamp(10px,1vw,14px) clamp(12px,1.2vw,16px)',
      marginBottom: 12, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Intelligence Hub · race fitness
        </span>
        <span style={{ fontSize: 8.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{caveat}</span>
      </div>

      <div style={{ display: 'flex', gap: 'clamp(10px,2vw,22px)', flexWrap: 'wrap' }}>
        {(facts.predictions || []).map(p => (
          <div key={p.dist} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{p.time}</span>
            <span style={{ fontSize: 8.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{p.dist}</span>
          </div>
        ))}
      </div>

      {facts.responses && facts.responses.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '0.5px solid var(--border-subtle)', paddingTop: 8 }}>
          <span style={{ fontSize: 8.5, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>how conditions cost you</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {facts.responses.slice(0, 3).map(r => (
              <span key={r.factor} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {r.factor} ≈ {r.perUnitPct}{r.unit}
                <span style={{ color: 'var(--text-muted)' }}> ({Math.round((r.confidence || 0) * 100)}%)</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default HubCard;
