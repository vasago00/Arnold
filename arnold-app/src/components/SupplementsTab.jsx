// ─── Supplements Tab ─────────────────────────────────────────────────────────
// Three sections: the Stack (editable schedule), the Catalog (full product
// panels with nutrient breakdowns), and the Daily totals summary.
// Add/delete supplements from catalog, add/remove from stack — all managed here.

import { useState } from "react";
import {
  getCatalog, saveCatalog, getStack, saveStack, getDailyNutrientTotals,
  getAdherence, BENEFIT_TAGS, TIME_SLOTS,
} from "../core/supplements.js";

const FORM_TYPES = ['capsule','gel capsule','powder','gummy','resin','tablet','liquid','softgel'];
const BENEFIT_KEYS = Object.keys(BENEFIT_TAGS);

// ─── Auto-infer benefit tags from product name + nutrient names ──────────────
// Keyword → benefit mapping. Checked against lowercased product + nutrient text.
const BENEFIT_RULES = [
  { keys: ['melatonin','magnesium','ashwagandha','gaba','theanine','glycine','apigenin','sleep','valerian','passionflower'], tag: 'sleep' },
  { keys: ['glutamine','bcaa','creatine','collagen','recovery','electrolyte','hmb','tart cherry'], tag: 'recovery' },
  { keys: ['vitamin c','zinc','elderberry','echinacea','immune','beta-glucan','probiotic','vitamin a'], tag: 'immune' },
  { keys: ['lion.*mane','alpha-gpc','cogniti','bacopa','phosphatidylserine','nootropic','brain','acetyl','choline','nmn','resveratrol','b12','methylcobalamin','apigenin','fisetin','spermidine'], tag: 'cognition' },
  { keys: ['nmn','nad','resveratrol','spermidine','quercetin','fisetin','longevity','autophagy','sirtuin','apigenin','tmg','betaine'], tag: 'longevity' },
  { keys: ['b12','b-complex','iron','coq10','energy','caffeine','green tea','matcha','shilajit','fulvic','nmn','tmg','beetroot','beet'], tag: 'energy' },
  { keys: ['turmeric','curcumin','omega.*3','fish oil','epa','dha','boswellia','quercetin','inflam','ginger','bromelain'], tag: 'inflammation' },
  { keys: ['omega.*3','fish oil','epa','dha','coq10','cardio','heart','nitric','beetroot','beet','grape seed','hawthorn','tmg','betaine'], tag: 'cardio' },
  { keys: ['vitamin d','calcium','vitamin k','bone','magnesium'], tag: 'bone' },
  { keys: ['protein','creatine','bcaa','leucine','hmb','muscle'], tag: 'muscle' },
  { keys: ['probiotic','prebiotic','fiber','gut','digestive','enzyme','psyllium','greens','ag1','athletic greens'], tag: 'gut' },
  { keys: ['ashwagandha','maca','dhea','vitamin d','zinc','hormon','testosterone','shilajit','tongkat','fenugreek','dim'], tag: 'hormonal' },
];

function inferBenefits(product, nutrients) {
  const text = [product, ...nutrients.map(n => n.name)].join(' ').toLowerCase();
  const tags = new Set();
  for (const rule of BENEFIT_RULES) {
    for (const kw of rule.keys) {
      if (new RegExp(kw, 'i').test(text)) { tags.add(rule.tag); break; }
    }
  }
  return [...tags];
}

const emptyForm = () => ({
  brand: '', product: '', servingSize: '', form: 'capsule',
  benefits: [], notes: '', nutrients: [{ name: '', amount: '', unit: 'mg' }],
  addToStack: true, timeOfDay: 'morning',
});

export function SupplementsTab({ showToast }) {
  const [catalog, setCatalog] = useState(() => getCatalog());
  const [stack, setStack] = useState(() => getStack());
  const [expanded, setExpanded] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState(null); // supplement id
  const [slotPicker, setSlotPicker] = useState(null); // supplement id — shows slot picker inline

  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));
  const adherence = getAdherence(7);
  const totals = getDailyNutrientTotals();

  // ─── Stack helpers ───
  const addToStack = (supplementId, timeOfDay = 'morning') => {
    const newEntry = {
      id: 's' + Date.now(),
      supplementId,
      doseMultiplier: 1,
      timeOfDay,
    };
    const next = [...stack, newEntry];
    setStack(next);
    saveStack(next);
    showToast?.('Added to stack');
  };

  const removeFromStack = (supplementId) => {
    const next = stack.filter(e => e.supplementId !== supplementId);
    setStack(next);
    saveStack(next);
    showToast?.('Removed from stack');
  };

  const updateStackEntry = (entryId, patch) => {
    const next = stack.map(e => e.id === entryId ? { ...e, ...patch } : e);
    setStack(next);
    saveStack(next);
  };

  // ─── Catalog helpers ───
  const addToCatalog = () => {
    if (!form.brand.trim() || !form.product.trim()) {
      showToast?.('Brand and product name required');
      return;
    }
    const id = form.brand.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
    const nutrients = form.nutrients
      .filter(n => n.name.trim() && n.amount)
      .map(n => ({ name: n.name.trim(), amount: parseFloat(n.amount) || 0, unit: n.unit || 'mg' }));
    const newSup = {
      id,
      brand: form.brand.trim(),
      product: form.product.trim(),
      servingSize: form.servingSize.trim() || '1 serving',
      form: form.form,
      benefits: form.benefits,
      notes: form.notes.trim(),
      nutrients,
      verify: true,
    };
    const nextCat = [...catalog, newSup];
    setCatalog(nextCat);
    saveCatalog(nextCat);
    // Optionally add to stack immediately
    if (form.addToStack) {
      const entry = { id: 's' + Date.now(), supplementId: id, doseMultiplier: 1, timeOfDay: form.timeOfDay };
      const nextStack = [...stack, entry];
      setStack(nextStack);
      saveStack(nextStack);
    }
    setForm(emptyForm());
    setShowAddForm(false);
    showToast?.(form.addToStack ? `Added to catalog & ${form.timeOfDay} stack` : 'Added to catalog');
  };

  const deleteFromCatalog = (supId) => {
    const nextCatalog = catalog.filter(s => s.id !== supId);
    setCatalog(nextCatalog);
    saveCatalog(nextCatalog);
    // Also remove from stack
    const nextStack = stack.filter(e => e.supplementId !== supId);
    setStack(nextStack);
    saveStack(nextStack);
    setConfirmDelete(null);
    showToast?.('Deleted from catalog');
  };

  // ─── Form helpers ───
  // Re-infer benefits from current product + nutrients text
  const reInfer = (product, nutrients) => {
    const suggested = inferBenefits(product, nutrients);
    setForm(f => ({ ...f, benefits: suggested }));
  };

  const toggleBenefit = (key) => {
    setForm(f => ({
      ...f,
      benefits: f.benefits.includes(key)
        ? f.benefits.filter(b => b !== key)
        : [...f.benefits, key],
    }));
  };

  const onProductChange = (val) => {
    setForm(f => {
      const next = { ...f, product: val };
      // Auto-infer benefits on product name change
      const suggested = inferBenefits(val, f.nutrients);
      return { ...next, benefits: suggested };
    });
  };

  const updateNutrient = (idx, field, val) => {
    setForm(f => {
      const nuts = [...f.nutrients];
      nuts[idx] = { ...nuts[idx], [field]: val };
      const next = { ...f, nutrients: nuts };
      // Re-infer when nutrient name changes
      if (field === 'name') {
        next.benefits = inferBenefits(f.product, nuts);
      }
      return next;
    });
  };

  const addNutrientRow = () => {
    setForm(f => ({ ...f, nutrients: [...f.nutrients, { name: '', amount: '', unit: 'mg' }] }));
  };

  const removeNutrientRow = (idx) => {
    setForm(f => {
      const nuts = f.nutrients.filter((_, i) => i !== idx);
      return { ...f, nutrients: nuts, benefits: inferBenefits(f.product, nuts) };
    });
  };

  // ─── Styles ───
  const sec = { display: 'flex', flexDirection: 'column', gap: 10 };
  const titleStyle = { fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' };
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
  const catalogCard = {
    padding: 10, borderRadius: 6,
    background: 'var(--bg-elevated)',
    border: '0.5px solid var(--border-default)',
    cursor: 'pointer',
  };
  const tagChip = (color, active = true) => ({
    fontSize: 8, padding: '2px 6px', borderRadius: 8,
    background: active ? color + '22' : 'transparent',
    color: active ? color : 'var(--text-muted)',
    border: `0.5px solid ${active ? color + '44' : 'var(--border-subtle)'}`,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    cursor: 'pointer',
  });
  const nutTile = {
    display: 'flex', justifyContent: 'space-between',
    padding: '4px 8px', fontSize: 10,
    borderBottom: '0.5px dashed var(--border-subtle)',
  };
  const inputStyle = {
    fontSize: 11, padding: '6px 8px', borderRadius: 6,
    border: '0.5px solid var(--border-default)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  };
  const selectStyle = { ...inputStyle, appearance: 'auto' };
  const btnPrimary = {
    fontSize: 10, padding: '6px 14px', borderRadius: 8,
    background: 'rgba(96,165,250,0.15)', color: '#60a5fa',
    border: '0.5px solid rgba(96,165,250,0.35)', cursor: 'pointer',
    fontWeight: 600,
  };
  const btnDanger = {
    fontSize: 10, padding: '6px 14px', borderRadius: 8,
    background: 'rgba(248,113,113,0.12)', color: '#f87171',
    border: '0.5px solid rgba(248,113,113,0.3)', cursor: 'pointer',
    fontWeight: 600,
  };
  const btnGhost = {
    fontSize: 10, background: 'transparent', border: 'none',
    color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 6px',
  };
  const stackEntryRow = {
    display: 'grid', gridTemplateColumns: '1fr 80px 28px', gap: 6,
    padding: '6px 8px', borderRadius: 6,
    background: 'var(--bg-elevated)', alignItems: 'center',
    fontSize: 11, color: 'var(--text-secondary)',
  };

  // ─── Nutrient visual helpers ───
  // Group nutrients by category for visual display
  const NUT_CATEGORIES = {
    'Vitamins': { color: '#60a5fa', match: /vitamin|folate|biotin|thiamin|riboflavin|niacin|pantothenic|b12|b6|b1|b2|b3/i },
    'Minerals': { color: '#34d399', match: /calcium|magnesium|zinc|selenium|copper|manganese|chromium|iron|phosphorus|potassium|sodium/i },
    'Omega & Fats': { color: '#f472b6', match: /omega|epa|dha|fish oil|fatty/i },
    'Longevity': { color: '#c084fc', match: /nmn|resveratrol|spermidine|quercetin|fisetin|apigenin|tmg|betaine/i },
    'Adaptogens & Botanicals': { color: '#fbbf24', match: /ashwagandha|turmeric|curcumin|beetroot|beet|grape seed|shilajit|fulvic/i },
    'Other': { color: '#94a3b8', match: /.*/ },
  };

  const groupedNutrients = (() => {
    const groups = {};
    for (const cat of Object.keys(NUT_CATEGORIES)) groups[cat] = [];
    for (const n of totals) {
      let placed = false;
      for (const [cat, { match }] of Object.entries(NUT_CATEGORIES)) {
        if (cat === 'Other') continue;
        if (match.test(n.name)) { groups[cat].push(n); placed = true; break; }
      }
      if (!placed) groups['Other'].push(n);
    }
    return Object.entries(groups).filter(([, items]) => items.length > 0);
  })();

  return (
    <div style={sec}>
      <div>
        <div style={titleStyle}>◈ Supplements</div>
        <div style={sub}>Stack, catalog & daily nutrient totals · {adherence.pct}% 7-day adherence</div>
      </div>

      {/* ─── Catalog ─── */}
      <div style={{ ...panel, borderLeft: '3px solid #60a5fa' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={sectionHeader}>Catalog · {catalog.length} products</div>
          <button style={btnPrimary} onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? '− cancel' : '+ new supplement'}
          </button>
        </div>

        {/* ─── Add form ─── */}
        {showAddForm && (
          <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-elevated)', border: '0.5px solid var(--border-default)', marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Add new supplement</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <input style={inputStyle} placeholder="Brand *" value={form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
              <input style={inputStyle} placeholder="Product name *" value={form.product}
                onChange={e => onProductChange(e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <input style={inputStyle} placeholder="Serving size (e.g. 1 capsule)" value={form.servingSize}
                onChange={e => setForm(f => ({ ...f, servingSize: e.target.value }))} />
              <select style={selectStyle} value={form.form}
                onChange={e => setForm(f => ({ ...f, form: e.target.value }))}>
                {FORM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Benefits — auto-inferred, tap to adjust */}
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>
              Benefits <span style={{ color: 'var(--text-muted)', opacity: 0.7 }}>· auto-suggested · tap to adjust</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {BENEFIT_KEYS.map(key => (
                <span key={key}
                  style={tagChip(BENEFIT_TAGS[key].color, form.benefits.includes(key))}
                  onClick={() => toggleBenefit(key)}>
                  {BENEFIT_TAGS[key].label}
                </span>
              ))}
            </div>

            {/* Notes */}
            <input style={{ ...inputStyle, marginBottom: 8 }} placeholder="Notes (optional)"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

            {/* Nutrients */}
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>Nutrients per serving</div>
            {form.nutrients.map((n, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 60px 24px', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                <input style={inputStyle} placeholder="Nutrient name" value={n.name}
                  onChange={e => updateNutrient(i, 'name', e.target.value)} />
                <input style={inputStyle} placeholder="Amount" type="number" value={n.amount}
                  onChange={e => updateNutrient(i, 'amount', e.target.value)} />
                <select style={{ ...selectStyle, fontSize: 9, padding: '4px' }} value={n.unit}
                  onChange={e => updateNutrient(i, 'unit', e.target.value)}>
                  {['mg','mcg','g','IU','kcal','ml'].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                {form.nutrients.length > 1 && (
                  <button style={{ ...btnGhost, color: '#f87171', fontSize: 12, padding: 0 }}
                    onClick={() => removeNutrientRow(i)}>×</button>
                )}
              </div>
            ))}
            <button style={{ ...btnGhost, color: '#60a5fa', fontSize: 9 }} onClick={addNutrientRow}>+ add nutrient</button>

            {/* Add to stack toggle + slot picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 0', borderTop: '0.5px solid var(--border-subtle)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.addToStack}
                  onChange={e => setForm(f => ({ ...f, addToStack: e.target.checked }))}
                  style={{ accentColor: '#60a5fa' }} />
                Add to stack
              </label>
              {form.addToStack && (
                <div style={{ display: 'flex', gap: 3 }}>
                  {TIME_SLOTS.map(s => (
                    <button key={s.id}
                      style={{
                        fontSize: 8, padding: '3px 8px', borderRadius: 8, cursor: 'pointer',
                        background: form.timeOfDay === s.id ? 'rgba(96,165,250,0.18)' : 'transparent',
                        color: form.timeOfDay === s.id ? '#60a5fa' : 'var(--text-muted)',
                        border: `0.5px solid ${form.timeOfDay === s.id ? 'rgba(96,165,250,0.4)' : 'var(--border-subtle)'}`,
                      }}
                      onClick={() => setForm(f => ({ ...f, timeOfDay: s.id }))}>
                      {s.icon} {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button style={btnGhost} onClick={() => { setShowAddForm(false); setForm(emptyForm()); }}>Cancel</button>
              <button style={btnPrimary} onClick={addToCatalog}>
                {form.addToStack ? `Save & add to ${form.timeOfDay}` : 'Save to catalog'}
              </button>
            </div>
          </div>
        )}

        {/* ─── Product cards ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {catalog.map(sup => {
            const isExpanded = expanded === sup.id;
            const inStack = stack.some(e => e.supplementId === sup.id);
            const isDeleting = confirmDelete === sup.id;
            return (
              <div key={sup.id} style={catalogCard} onClick={() => setExpanded(isExpanded ? null : sup.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{sup.product}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{sup.brand} · {sup.servingSize}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 6, alignItems: 'center' }}>
                    {inStack ? (
                      <span style={{ fontSize: 8, padding: '3px 7px', borderRadius: 10, background: 'rgba(167,139,250,0.12)', color: '#a78bfa', border: '0.5px solid rgba(167,139,250,0.3)' }}>
                        ✓ in stack
                      </span>
                    ) : slotPicker === sup.id ? (
                      <div style={{ display: 'flex', gap: 3 }} onClick={ev => ev.stopPropagation()}>
                        {TIME_SLOTS.map(s => (
                          <button key={s.id}
                            style={{ fontSize: 8, padding: '3px 7px', borderRadius: 8, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '0.5px solid rgba(96,165,250,0.3)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            onClick={() => { addToStack(sup.id, s.id); setSlotPicker(null); }}>
                            {s.icon} {s.label}
                          </button>
                        ))}
                        <button style={{ fontSize: 9, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                          onClick={() => setSlotPicker(null)}>×</button>
                      </div>
                    ) : (
                      <button
                        style={{ fontSize: 9, padding: '3px 8px', borderRadius: 10, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '0.5px solid rgba(96,165,250,0.35)', cursor: 'pointer' }}
                        onClick={ev => { ev.stopPropagation(); setSlotPicker(sup.id); }}
                      >+ stack</button>
                    )}
                  </div>
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
                    {/* Actions row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTop: '0.5px solid var(--border-subtle)' }}>
                      {inStack ? (
                        <button style={{ ...btnGhost, color: '#a78bfa', fontSize: 9 }}
                          onClick={ev => { ev.stopPropagation(); removeFromStack(sup.id); }}>
                          Remove from stack
                        </button>
                      ) : slotPicker === sup.id ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={ev => ev.stopPropagation()}>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Add to:</span>
                          {TIME_SLOTS.map(s => (
                            <button key={s.id}
                              style={{ fontSize: 8, padding: '3px 7px', borderRadius: 8, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '0.5px solid rgba(96,165,250,0.3)', cursor: 'pointer' }}
                              onClick={() => { addToStack(sup.id, s.id); setSlotPicker(null); }}>
                              {s.icon} {s.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button style={{ ...btnGhost, color: '#60a5fa', fontSize: 9 }}
                          onClick={ev => { ev.stopPropagation(); setSlotPicker(sup.id); }}>
                          + Add to stack
                        </button>
                      )}
                      {isDeleting ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={ev => ev.stopPropagation()}>
                          <span style={{ fontSize: 9, color: '#f87171' }}>Delete?</span>
                          <button style={btnDanger} onClick={() => deleteFromCatalog(sup.id)}>Yes</button>
                          <button style={btnGhost} onClick={() => setConfirmDelete(null)}>No</button>
                        </div>
                      ) : (
                        <button style={{ ...btnGhost, color: '#f87171', fontSize: 9 }}
                          onClick={ev => { ev.stopPropagation(); setConfirmDelete(sup.id); }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Your Stack ─── */}
      <div style={{ ...panel, borderLeft: '3px solid #a78bfa' }}>
        <div style={sectionHeader}>Your Stack · {stack.length} items</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {TIME_SLOTS.map(slot => {
            const entries = stack.filter(e => e.timeOfDay === slot.id);
            const slotColors = { morning: '#fbbf24', afternoon: '#60a5fa', evening: '#a78bfa' };
            const sc = slotColors[slot.id] || '#a78bfa';
            return (
              <div key={slot.id}>
                {/* Slot header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
                  padding: '5px 8px', borderRadius: 6,
                  background: sc + '10',
                }}>
                  <span style={{ fontSize: 13 }}>{slot.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: sc }}>{slot.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{entries.length} items</span>
                </div>
                {/* Entries */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4 }}>
                  {entries.map(e => {
                    const sup = byId[e.supplementId];
                    if (!sup) return null;
                    return (
                      <div key={e.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 8,
                        background: 'var(--bg-elevated)',
                        border: '0.5px solid var(--border-default)',
                      }}>
                        {/* Name + brand — takes available space */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sup.product}
                          </div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>{sup.brand} · {sup.servingSize}</div>
                        </div>
                        {/* Move to different slot */}
                        <select
                          style={{ ...selectStyle, fontSize: 9, padding: '3px 4px', width: 'auto', minWidth: 72 }}
                          value={e.timeOfDay}
                          onClick={ev => ev.stopPropagation()}
                          onChange={ev => updateStackEntry(e.id, { timeOfDay: ev.target.value })}
                        >
                          {TIME_SLOTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        {/* Remove */}
                        <button style={{ ...btnGhost, color: '#f87171', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                          onClick={() => removeFromStack(e.supplementId)} title="Remove from stack">×</button>
                      </div>
                    );
                  })}
                  {entries.length === 0 && (
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 8px' }}>
                      No supplements in this slot
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Daily Nutrient Totals (visual) ─── */}
      <div style={{ ...panel, borderLeft: '3px solid #fbbf24' }}>
        <div style={sectionHeader}>Daily nutrient profile from stack</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupedNutrients.map(([category, items]) => {
            const catInfo = NUT_CATEGORIES[category];
            // Find max amount within category for relative bar scaling
            const maxAmt = Math.max(...items.map(n => n.amount), 1);
            return (
              <div key={category}>
                <div style={{ fontSize: 9, fontWeight: 600, color: catInfo.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                  {category}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {items.map((n, i) => {
                    const pct = Math.min((n.amount / maxAmt) * 100, 100);
                    const displayAmt = n.amount >= 1000
                      ? (n.amount / 1000).toFixed(1).replace(/\.0$/, '') + (n.unit === 'mg' ? 'g' : n.unit === 'mcg' ? 'mg' : 'k' + n.unit)
                      : Math.round(n.amount * 100) / 100 + ' ' + n.unit;
                    // Short nutrient name: strip parenthetical qualifiers
                    const shortNut = n.name.replace(/\s*\(.*\)\s*$/, '').replace(/^Vitamin\s+/, 'Vit ');
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 90, fontSize: 9, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={n.name}>
                          {shortNut}
                        </div>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 3,
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${catInfo.color}66, ${catInfo.color})`,
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{ width: 52, fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'right', flexShrink: 0 }}>
                          {displayAmt}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
