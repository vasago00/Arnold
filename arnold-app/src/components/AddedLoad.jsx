// AddedLoad — weight-vest / pack load rendered to MATCH the card's IconMiniTile
// exactly (icon · 11px label · 14px/600 value, single row, no border) so it sits
// consistently among the other Details tiles. Tap to open presets + custom field.
// Tooltip shows the unweighted-equivalent pace (so a weighted run isn't misread).

import { useState } from 'react';
import { getAddedLoad, setAddedLoad, unweightedEquivPaceSecs, secsToPace } from '../core/addedLoad.js';

const PRESETS = [10, 20, 40]; // common loads (lb); custom field covers the rest

export function AddedLoad({ fd, dateStr, profile, onSaved }) {
  const [lbs, setLbs] = useState(() => getAddedLoad(fd, dateStr));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const bodyLbs = parseFloat(profile?.weight) || parseFloat(profile?.targetWeight) || 175;
  const equivSecs = (lbs && fd?.avgPacePerMi) ? unweightedEquivPaceSecs(fd.avgPacePerMi, lbs, bodyLbs) : null;
  const commit = (v) => { const n = setAddedLoad(fd, dateStr, v); setLbs(n); setOpen(false); setDraft(''); onSaved?.(); };

  // Matches IconMiniTile (Arnold.jsx) exactly.
  const tile = {
    background: 'var(--bg-elevated)', borderRadius: 8, padding: '9px 11px',
    display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, cursor: 'pointer',
    boxShadow: open ? 'inset 0 0 0 0.5px var(--text-accent)' : 'none',
  };
  const labelS = { flex: 1, minWidth: 0, color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const valueS = { color: lbs ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flexShrink: 0 };
  const chip = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '6px 11px', cursor: 'pointer' };
  const inp = { width: 56, background: 'var(--bg-base)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-mono)' };
  const link = { fontSize: 11, fontWeight: 600, color: '#60a5fa', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 8, padding: '5px 11px', cursor: 'pointer' };

  return (
    <div>
      <div onClick={() => setOpen(o => !o)} style={tile} title={equivSecs ? `≈ ${secsToPace(equivSecs)} /mi unweighted` : 'Tap to log added load (vest / pack)'}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
        </svg>
        <span style={labelS}>Added load</span>
        <span style={valueS}>{lbs ? `+${lbs} lb` : 'Add'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {PRESETS.map(p => (<button key={p} onClick={() => commit(p)} style={chip}>+{p} lb</button>))}
          </div>
          {/* Custom input on its OWN row so Set/clear never clip off the narrow mobile card. */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <input type="number" inputMode="decimal" step="1" placeholder="custom lb" value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(parseFloat(draft)); }}
              style={{ ...inp, flex: 1, minWidth: 0, width: 'auto' }} />
            <button onClick={() => commit(parseFloat(draft))} style={{ ...link, flexShrink: 0, opacity: parseFloat(draft) > 0 ? 1 : 0.5 }}>Set</button>
            {lbs ? <button onClick={() => commit(0)} style={{ ...link, flexShrink: 0, color: '#f87171', background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.15)' }}>clear</button> : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default AddedLoad;
