// ─── Hyperice Quick Add ──────────────────────────────────────────────────────
// Phase 4r.recover.1
//
// Tiny popover that opens from the post-workout card's recovery row.
// Pick product → set minutes → tap Log. Writes via hyperice.js storage
// layer; parent re-renders to pick up the new entry.

import { useState } from "react";
import { HYPERICE_PRODUCTS, logHypericeSession } from "../core/hyperice.js";
import { HypericeIcon } from "./HypericeIcon.jsx";

export function HypericeQuickAdd({ dateStr, onClose, onLogged }) {
  const [productId, setProductId] = useState('normatec');
  const [minutes, setMinutes] = useState(20);

  const onLog = () => {
    const session = logHypericeSession({ productId, minutes, dateStr });
    if (session) onLogged?.(session);
    onClose?.();
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: 'calc(100% + 4px)', right: 0,
      zIndex: 50,
      background: 'var(--bg-elevated, #1a1d23)',
      border: '0.5px solid rgba(140,140,140,0.3)',
      borderRadius: 8, padding: '10px 12px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
      minWidth: 220,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#22d3ee', letterSpacing: '0.06em' }}>HYPERICE LOG</span>
        <span style={{ flex: 1 }}/>
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer', fontSize: 12,
          color: 'rgba(255,255,255,0.4)', padding: '0 4px',
        }}>✕</button>
      </div>

      {/* Product picker — 3 cols of icon tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>
        {HYPERICE_PRODUCTS.map(p => {
          const active = productId === p.id;
          return (
            <button key={p.id} onClick={() => setProductId(p.id)}
              style={{
                all: 'unset', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '6px 4px',
                borderRadius: 4,
                background: active ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.02)',
                border: `0.5px solid ${active ? 'rgba(34,211,238,0.5)' : 'rgba(140,140,140,0.16)'}`,
                color: active ? '#22d3ee' : 'rgba(255,255,255,0.7)',
              }}>
              <HypericeIcon productId={p.id} size={20} color={active ? '#22d3ee' : 'rgba(255,255,255,0.6)'}/>
              <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em' }}>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Minutes input + Log button */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>Minutes</span>
          <input type="number" min={1} max={120} value={minutes}
            onChange={(e) => setMinutes(parseInt(e.target.value) || 0)}
            style={{
              fontSize: 12, padding: '5px 8px',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.9)',
              border: '0.5px solid rgba(140,140,140,0.25)',
              borderRadius: 4, outline: 'none',
              width: '100%', boxSizing: 'border-box',
            }}/>
        </label>
        <button onClick={onLog} style={{
          all: 'unset', cursor: 'pointer',
          fontSize: 11, fontWeight: 600,
          padding: '6px 12px', marginTop: 12,
          borderRadius: 4,
          background: 'rgba(34,211,238,0.15)',
          color: '#22d3ee',
          border: '0.5px solid rgba(34,211,238,0.4)',
        }}>Log</button>
      </div>
    </div>
  );
}
