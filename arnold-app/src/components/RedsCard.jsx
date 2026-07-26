// RedsCard — the REDs / energy-availability SCREEN (2023 IOC standard) as a health card. Shows the overall
// traffic light, the honest summary, each indicator with its status, and the clinician hand-off. Self-contained:
// reads the athlete's real record via resolveRedsScreen. Green is reassuring, not silent — the athlete sees the
// engine that would catch a real deficit. Pure presentation over core/derive/redsScreen.js.
import { useMemo } from 'react';
import { resolveRedsScreen } from '../core/derive/redsScreen.js';
import { storage } from '../core/storage.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';

const DOT = { green: '#34d399', yellow: '#f0c33a', orange: '#fb923c', red: '#f87171' };
const T2 = 'var(--text-secondary, #b7bcc4)';
const T3 = 'var(--text-muted, #8a8f98)';

export default function RedsCard({ style }) {
  const v = useStorageVersion();
  const screen = useMemo(() => { try { return resolveRedsScreen({ storage, today: new Date().toISOString().slice(0, 10) }); } catch { return null; } }, [v]);
  if (!screen || !screen.overall || !(screen.indicators || []).length) return null;

  const st = screen.overall.status;
  const accent = DOT[st] || DOT.green;
  const card = { background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '14px 16px 12px', color: 'var(--text-primary)', ...style };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, display: 'inline-block', boxShadow: `0 0 6px ${accent}66` }} />
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', color: accent }}>ENERGY AVAILABILITY · REDs SCREEN</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: accent }}>{screen.overall.label}</span>
      </div>
      <div style={{ fontSize: 11.5, color: T2, lineHeight: 1.5, marginBottom: 11 }}>{screen.overall.summary}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {screen.indicators.map((i) => (
          <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: DOT[i.status] || DOT.green, flexShrink: 0 }} />
            <span style={{ color: i.status === 'green' ? T3 : T2, flex: 1, minWidth: 0 }}>{i.label}</span>
            {i.screening && <span style={{ fontSize: 9, color: T3, whiteSpace: 'nowrap' }}>Estimate</span>}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: T3, lineHeight: 1.45, marginTop: 11, paddingTop: 9, borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
        {screen.handoff}
      </div>
    </div>
  );
}
