// ─── Import Diagnostics Panel ────────────────────────────────────────────────
// Reads arnold:diagnostics (populated by storage.set on every import) and
// renders a per-collection coverage report. Surfaces silent parser gaps
// before they become invisible holes in the UI.

import { storage } from "../core/storage.js";

const COLLECTIONS = [
  { key: 'activities', label: 'Activities', color: '#3b82f6' },
  { key: 'hrv',        label: 'HRV',        color: '#a78bfa' },
  { key: 'sleep',      label: 'Sleep',      color: '#60a5fa' },
  { key: 'weight',     label: 'Weight',     color: '#4ade80' },
  { key: 'cronometer', label: 'Cronometer', color: '#fbbf24' },
];

// Fields we care about per collection — surface coverage for these explicitly.
const KEY_FIELDS = {
  activities: ['date','activityType','distanceMi','durationSecs','movingTimeSecs','avgHR','maxHR','avgPaceRaw','calories','totalReps','setsCount','bodyBatteryDrain','aerobicTE'],
  hrv:        ['date','overnightHRV','status'],
  sleep:      ['date','durationMinutes','sleepScore'],
  weight:     ['date','weight','bodyFat'],
  cronometer: ['date','calories','protein','carbs','fat','fiber','water'],
};

export function ImportDiagnostics() {
  const diag = storage.get('diagnostics') || {};
  const inv = storage.inventory();

  const panel = {
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border-default)',
    borderLeft: '3px solid #60a5fa',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
  };
  const hdr = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 };
  const sub = { fontSize: 10, color: 'var(--text-muted)', marginBottom: 12 };
  const sectionLabel = { fontSize: 9, fontWeight: 500, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, marginTop: 10 };

  return (
    <div style={panel}>
      <div style={hdr}>◇ Import Diagnostics</div>
      <div style={sub}>Per-collection coverage from the most recent import. Low percentages = parser gap or missing source data.</div>

      {COLLECTIONS.map(c => {
        const d = diag[c.key];
        const totalRows = inv[c.key] || 0;
        const fields = KEY_FIELDS[c.key] || [];
        return (
          <div key={c.key} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: c.color }}>{c.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {totalRows > 0
                  ? `${totalRows} rows${d?.rejected ? ` · ${d.rejected} rejected` : ''}${d?.ts ? ` · ${new Date(d.ts).toLocaleDateString()}` : ''}`
                  : 'no data'}
              </span>
            </div>
            {totalRows === 0 ? (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Import this collection to see coverage.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 4 }}>
                {fields.map(f => {
                  const cov = d?.coverage?.[f];
                  const pct = cov?.pct ?? 0;
                  const color = pct >= 90 ? '#4ade80' : pct >= 50 ? '#fbbf24' : pct > 0 ? '#f87171' : 'var(--text-muted)';
                  return (
                    <div key={f} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '3px 6px', background: 'var(--bg-elevated)', borderRadius: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{f}</span>
                      <span style={{ color, fontWeight: 500 }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div style={sectionLabel}>Storage inventory</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(inv).filter(([,n]) => n > 0).map(([name, count]) => (
          <span key={name} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 10, background: 'rgba(96,165,250,0.10)', color: '#60a5fa' }}>
            {name}: {count}
          </span>
        ))}
      </div>
    </div>
  );
}
