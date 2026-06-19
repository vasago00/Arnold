// SessionRPE — perceived-effort capture rendered to MATCH the card's IconMiniTile
// exactly (icon · 11px label · 14px/600 value, single row, no border) so it sits
// consistently among the other Details tiles. Tap to open the CR-10 picker.

import { useState } from 'react';
import { CR10, getSessionRPE, setSessionRPE, sessionLoad, loadTier } from '../core/sessionRPE.js';

export function SessionRPE({ fd, dateStr, onSaved }) {
  const [rpe, setRpe] = useState(() => getSessionRPE(fd, dateStr));
  const [open, setOpen] = useState(false);

  const load = sessionLoad(rpe, Number(fd?.durationSecs) || 0);
  const { color: loadColor } = loadTier(load);
  const pick = (v) => { setSessionRPE(fd, dateStr, v); setRpe(v); setOpen(false); onSaved?.(); };

  // Matches IconMiniTile (Arnold.jsx) exactly.
  const tile = {
    background: 'var(--bg-elevated)', borderRadius: 8, padding: '9px 11px',
    display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, cursor: 'pointer',
    boxShadow: open ? 'inset 0 0 0 0.5px var(--text-accent)' : 'none',
  };
  const labelS = { flex: 1, minWidth: 0, color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const valueS = { color: rpe != null ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flexShrink: 0 };
  const dot = (active) => ({
    width: 28, height: 28, borderRadius: 7, flexShrink: 0, border: '0.5px solid var(--border-subtle)',
    background: active ? 'var(--text-accent)' : 'var(--bg-base)', color: active ? '#0b0b0c' : 'var(--text-secondary)',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', lineHeight: '28px', textAlign: 'center',
  });

  return (
    <div>
      <div onClick={() => setOpen(o => !o)} style={tile} title={load != null ? `${load} AU sRPE load` : 'Tap to rate perceived effort'}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M3 12h4l2 5 4-12 2 7h6" />
        </svg>
        <span style={labelS}>Perceived</span>
        <span style={valueS}>{rpe != null ? `RPE ${rpe}` : 'Log'}</span>
      </div>
      {open && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {CR10.map(s => (
            <button key={s.v} onClick={() => pick(s.v)} style={dot(s.v === rpe)} title={s.label}>{s.v}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SessionRPE;
