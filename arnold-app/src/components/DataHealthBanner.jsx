// DataHealthBanner — Phase 1 of DATA_INTEGRITY_PLAN.md. Surfaces, honestly and
// visibly, when a configured data source has gone stale or its sync is failing
// (e.g. the Cronometer outage). Renders nothing when everything is fresh.
// Affected scores read "—" rather than being estimated — this banner explains why.

import { useState } from 'react';
import { dataHealth, freshnessPhrase } from '../core/dataHealth.js';
import { fetchCronometerToday } from '../core/cronometer-client.js';
import { fetchGarminToday } from '../core/garmin-client.js';
import { syncRecentWeight } from '../core/garmin-weight-client.js';
import { syncRecentActivities } from '../core/garmin-activities-client.js';

const RETRY = {
  cronometer:       () => fetchCronometerToday(),
  garminWellness:   () => fetchGarminToday(),
  garminWeight:     () => syncRecentWeight({}),
  garminActivities: () => syncRecentActivities({}),
};

export function DataHealthBanner({ showToast, style }) {
  const [health, setHealth] = useState(() => { try { return dataHealth(); } catch { return null; } });
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!health || !health.anyIssue || dismissed) return null;
  const issues = health.issues;
  const anyDown = issues.some(i => i.status === 'down' || i.status === 'never');
  const accent = anyDown ? '#ef4444' : '#f59e0b';

  const retry = async () => {
    setBusy(true);
    const keys = [...new Set(issues.map(i => i.retry))];
    for (const k of keys) { try { if (RETRY[k]) await RETRY[k](); } catch {} }
    setBusy(false);
    showToast?.('Re-sync attempted');
    setTimeout(() => { try { setHealth(dataHealth()); } catch {} }, 800);
  };

  return (
    <div style={{
      background: anyDown ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
      border: `0.5px solid ${anyDown ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'}`,
      borderRadius: 10, padding: '10px 12px', margin: '8px 0', ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: accent, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
            ⚠ Data {anyDown ? 'sync failing' : 'is stale'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {issues.map((s, i) => (
              <div key={i}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.label}</span>
                {' — '}{freshnessPhrase(s)}{s.lastError ? ` · ${String(s.lastError).slice(0, 60)}` : ''}.
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
            Affected scores show “—” until this is logged or synced — they are not estimated.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'stretch' }}>
          <button onClick={retry} disabled={busy} style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, color: accent, padding: '4px 12px', borderRadius: 999, border: `0.5px solid ${accent}`, opacity: busy ? 0.5 : 1, textAlign: 'center' }}>
            {busy ? 'Syncing…' : 'Retry sync'}
          </button>
          <button onClick={() => setDismissed(true)} title="Dismiss for now" style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

export default DataHealthBanner;
