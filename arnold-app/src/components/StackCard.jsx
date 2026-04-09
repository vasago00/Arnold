// ─── Daily Stack Checklist Card ──────────────────────────────────────────────
// Compact three-column board (morning / afternoon / evening) for the Daily tab.
// Tap a pill to toggle taken. "Take all" button per column for bulk.

import { useState, useEffect } from "react";
import {
  getCatalog, getStack, getTodayTaken, toggleTaken, takeAllInSlot,
  TIME_SLOTS,
} from "../core/supplements.js";

export function StackCard({ dateStr, showToast }) {
  const [catalog] = useState(() => getCatalog());
  const [stack] = useState(() => getStack());
  const [taken, setTaken] = useState(() => getTodayTaken(dateStr));
  const [open, setOpen] = useState(false);

  useEffect(() => { setTaken(getTodayTaken(dateStr)); }, [dateStr]);

  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));
  const slotEntries = slot => stack.filter(s => s.timeOfDay === slot);
  const totalCount = stack.length;
  const takenCount = Object.keys(taken).length;

  const panel = {
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border-default)',
    borderLeft: '3px solid #a78bfa',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    marginTop: 12,
  };
  const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 };
  const title = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' };
  const sub = { fontSize: 10, color: 'var(--text-muted)' };
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 };
  const col = { display: 'flex', flexDirection: 'column', gap: 6 };
  const colHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' };
  const takeAllBtn = { fontSize: 9, background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', padding: 0 };

  const pill = (t) => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 10px', borderRadius: 14,
    background: t ? 'rgba(167,139,250,0.15)' : 'var(--bg-elevated)',
    border: `0.5px solid ${t ? 'rgba(167,139,250,0.45)' : 'var(--border-default)'}`,
    color: t ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: 11, cursor: 'pointer',
    transition: 'all 0.15s',
  });
  const pillName = { fontWeight: 500 };
  const pillTime = { fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' };

  const onToggle = (entryId) => {
    const next = toggleTaken(dateStr, entryId);
    setTaken(next);
  };
  const onTakeAll = (slotId) => {
    const next = takeAllInSlot(dateStr, slotId);
    setTaken(next);
    showToast?.(`Marked ${TIME_SLOTS.find(s=>s.id===slotId).label} stack taken`);
  };

  if (!stack.length) return null;

  return (
    <div style={panel}>
      <div style={{...header, marginBottom: open ? 10 : 0, cursor:'pointer'}} onClick={()=>setOpen(o=>!o)}>
        <div style={title}>◈ Stack <span style={sub}>· {takenCount}/{totalCount} taken</span></div>
        <span style={{...sub, fontSize:11}}>{open?'▾':'▸'}</span>
      </div>
      {open && <div style={grid}>
        {TIME_SLOTS.map(slot => {
          const entries = slotEntries(slot.id);
          if (!entries.length) return <div key={slot.id} style={col}/>;
          const allTaken = entries.every(e => taken[e.id]);
          return (
            <div key={slot.id} style={col}>
              <div style={colHeader}>
                <span>{slot.icon} {slot.label}</span>
                {!allTaken && (
                  <button style={takeAllBtn} onClick={() => onTakeAll(slot.id)}>take all</button>
                )}
              </div>
              {entries.map(e => {
                const sup = byId[e.supplementId];
                if (!sup) return null;
                const t = taken[e.id];
                const timeStr = t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
                return (
                  <div key={e.id} style={pill(t)} onClick={() => onToggle(e.id)} title={sup.product}>
                    <span style={pillName}>{sup.brand === sup.product.split(' ')[0] ? sup.product : `${sup.brand} ${sup.product.split(' ')[0]}`}</span>
                    {t ? <span style={pillTime}>{timeStr}</span> : <span style={pillTime}>○</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>}
    </div>
  );
}
