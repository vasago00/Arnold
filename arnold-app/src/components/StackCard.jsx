// ─── Daily Stack Strip ──────────────────────────────────────────────────────
// Compact single-row strip on the Fuel tab for one-click slot logging.
// Editing (add/remove/move) happens in the dedicated Stack tab under More.

import { useState, useEffect } from "react";
import {
  getStack, getTodayTaken, takeAllInSlot, TIME_SLOTS,
} from "../core/supplements.js";

export function StackCard({ dateStr, showToast }) {
  const [stack] = useState(() => getStack());
  const [taken, setTaken] = useState(() => getTodayTaken(dateStr));

  useEffect(() => { setTaken(getTodayTaken(dateStr)); }, [dateStr]);

  const slotEntries = slot => stack.filter(s => s.timeOfDay === slot);
  const totalCount = stack.length;
  const takenCount = Object.keys(taken).length;
  const allDone = totalCount > 0 && takenCount >= totalCount;

  const onTakeAll = (slotId) => {
    const next = takeAllInSlot(dateStr, slotId);
    setTaken(next);
    showToast?.(`${TIME_SLOTS.find(s => s.id === slotId)?.label} stack logged`);
  };

  if (!stack.length) return null;

  const slotColors = { morning: '#fbbf24', afternoon: '#60a5fa', evening: '#a78bfa' };

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '7px 12px',
      marginTop: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 15 }}>💊</span>
          <span style={{ fontSize: 9, fontWeight: 500, color: allDone ? '#a78bfa' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {takenCount}/{totalCount}{allDone ? ' ✓' : ''}
          </span>
        </div>
        {/* Slot buttons */}
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {TIME_SLOTS.map(slot => {
            const entries = slotEntries(slot.id);
            const slotTaken = entries.filter(e => taken[e.id]).length;
            const done = entries.length > 0 && slotTaken === entries.length;
            const sc = slotColors[slot.id];
            return (
              <button key={slot.id}
                onClick={() => !done && onTakeAll(slot.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                  flex: 1, padding: '5px 4px', borderRadius: 8, cursor: done ? 'default' : 'pointer',
                  border: `0.5px solid ${done ? sc + '40' : 'var(--border-default)'}`,
                  background: done ? sc + '18' : 'rgba(255,255,255,0.03)',
                  color: done ? sc : 'var(--text-secondary)',
                  fontSize: 9, fontWeight: 600,
                  transition: 'all 0.15s',
                  opacity: entries.length === 0 ? 0.4 : 1,
                }}>
                <span style={{ fontSize: 11 }}>{slot.icon}</span>
                <span>{slot.label}</span>
                <span style={{ fontSize: 7, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
                  {slotTaken}/{entries.length}
                </span>
                {done && <span style={{ fontSize: 8 }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
