// ─── Supplements Tab ─────────────────────────────────────────────────────────
// Three sections: the Stack (editable schedule), the Catalog (full product
// panels with nutrient breakdowns), and the Daily totals summary.

import { useState } from "react";
import {
  getCatalog, getStack, saveStack, getDailyNutrientTotals, getAdherence,
  BENEFIT_TAGS, TIME_SLOTS,
} from "../core/supplements.js";

export function SupplementsTab({ showToast }) {
  const [catalog] = useState(() => getCatalog());
  const [stack, setStack] = useState(() => getStack());
  const [expanded, setExpanded] = useState(null); // supplement id
  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));

  const adherence = getAdherence(7);
  const totals = getDailyNutrientTotals();

  const updateStackEntry = (entryId, patch) => {
    const next = stack.map(e => e.id === entryId ? { ...e, ...patch } : e);
    setStack(next);
    saveStack(next);
  };

  const removeEntry = (entryId) => {
    const next = stack.filter(e => e.id !== entryId);
    setStack(next);
    saveStack(next);
    showToast?.('Removed from stack');
  };

  const addEntry = (supplementId) => {
    const newEntry = {
      id: 's' + Date.now(),
      supplementId,
      doseMultiplier: 1,
      timeOfDay: 'morning',
    };
    const next = [...stack, newEntry];
    setStack(next);
    saveStack(next);
    showToast?.('Added to stack');
  };

  // ─── Styles ───
  const sec = { display: 'flex', flexDirection: 'column', gap: 10 };
  const title = { fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' };
  const sub = { fontSize: 10, color: 'var(--text-muted)' };
  const panel = {
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 14px',
  };
  const sectionHeader = { fontSize: 9, fontWeight: 500, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 };
  const slotGrid = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 };
  const slotCol = { display: 'flex', flexDirection: 'column', gap: 4 };
  const entryRow = {
    display: 'grid', gridTemplateColumns: '1fr 60px 28px', gap: 6,
    padding: '6px 8px', borderRadius: 6,
    background: 'var(--bg-elevated)', alignItems: 'center',
    fontSize: 11, color: 'var(--text-secondary)',
  };
  const smallBtn = { fontSize: 10, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' };
  const catalogCard = {
    padding: 10, borderRadius: 6,
    background: 'var(--bg-elevated)',
    border: '0.5px solid var(--border-default)',
    cursor: 'pointer',
  };
  const tagChip = (color) => ({
    fontSize: 8, padding: '2px 6px', borderRadius: 8,
    background: color + '22', color, border: `0.5px solid ${color}44`,
    textTransform: 'uppercase', letterSpacing: '0.04em',
  });
  const nutTile = {
    display: 'flex', justifyContent: 'space-between',
    padding: '4px 8px', fontSize: 10,
    borderBottom: '0.5px dashed var(--border-subtle)',
  };

  return (
    <div style={sec}>
      <div>
        <div style={title}>◈ Supplements</div>
        <div style={sub}>Stack, catalog, and daily nutrient totals · {adherence.pct}% 7-day adherence</div>
      </div>

      {/* ─── Daily Stack Editor ─── */}
      <div style={{ ...panel, borderLeft: '3px solid #a78bfa' }}>
        <div style={sectionHeader}>Your Daily Stack</div>
        <div style={slotGrid}>
          {TIME_SLOTS.map(slot => {
            const entries = stack.filter(e => e.timeOfDay === slot.id);
            return (
              <div key={slot.id} style={slotCol}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>{slot.icon} {slot.label}</div>
                {entries.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>—</div>
                )}
                {entries.map(e => {
                  const sup = byId[e.supplementId];
                  if (!sup) return null;
                  return (
                    <div key={e.id} style={entryRow}>
                      <span>{sup.product}</span>
                      <select
                        value={e.timeOfDay}
                        onChange={ev => updateStackEntry(e.id, { timeOfDay: ev.target.value })}
                        style={{ fontSize: 9, background: 'var(--bg-input)', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)', padding: '2px 4px' }}
                      >
                        {TIME_SLOTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      <button style={smallBtn} onClick={() => removeEntry(e.id)}>✕</button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Catalog ─── */}
      <div style={{ ...panel, borderLeft: '3px solid #60a5fa' }}>
        <div style={sectionHeader}>Catalog · {catalog.length} products</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {catalog.map(sup => {
            const isExpanded = expanded === sup.id;
            const inStack = stack.some(e => e.supplementId === sup.id);
            return (
              <div key={sup.id} style={catalogCard} onClick={() => setExpanded(isExpanded ? null : sup.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{sup.product}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{sup.brand} · {sup.servingSize}</div>
                  </div>
                  {!inStack && (
                    <button
                      style={{ fontSize: 9, padding: '3px 8px', borderRadius: 10, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '0.5px solid rgba(96,165,250,0.35)', cursor: 'pointer' }}
                      onClick={ev => { ev.stopPropagation(); addEntry(sup.id); }}
                    >+ add</button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                  {(sup.benefits || []).map(b => {
                    const tag = BENEFIT_TAGS[b];
                    if (!tag) return null;
                    return <span key={b} style={tagChip(tag.color)}>{tag.label}</span>;
                  })}
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--border-subtle)' }}>
                    {sup.notes && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 6 }}>{sup.notes}</div>}
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Nutrients per serving</div>
                    {(sup.nutrients || []).map((n, i) => (
                      <div key={i} style={nutTile}>
                        <span style={{ color: 'var(--text-secondary)' }}>{n.name}</span>
                        <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{n.amount} {n.unit}</span>
                      </div>
                    ))}
                    {sup.verify && (
                      <div style={{ fontSize: 9, color: '#fbbf24', marginTop: 6, fontStyle: 'italic' }}>
                        ⚠ Values are best-effort from published labels. Verify against your bottle.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Daily totals ─── */}
      <div style={{ ...panel, borderLeft: '3px solid #fbbf24' }}>
        <div style={sectionHeader}>Total nutrients from stack (per day)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 4 }}>
          {totals.map((n, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '3px 6px', borderBottom: '0.5px dashed var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{n.name}</span>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{Math.round(n.amount*100)/100} {n.unit}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
