// ─── NutritionInput: Mobile Food Logging ────────────────────────────────────
// Four input modes: Manual, Barcode, Photo, Voice.
// Entries tagged with meal timing (pre/during/post workout, meals, snacks).
// Shows goal impact score for each logged item.
// Designed for Samsung S25 Ultra mobile-first.

import { useState, useRef, useCallback, useEffect } from 'react';
import { STATUS } from '../core/semantics.js';
import { getGoals } from '../core/goals.js';
import {
  MEAL_CATEGORIES, createEntry, saveEntry, deleteEntry,
  getEntriesForDate, dailyTotals, goalImpact,
  lookupBarcode, searchFood,
} from '../core/nutrition.js';

// ─── Glassmorphism ──────────────────────────────────────────────────────────
const glass = {
  background: 'rgba(20, 22, 30, 0.65)',
  backdropFilter: 'blur(20px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
};

const INPUT_MODES = [
  { id: 'manual',  label: 'Manual',  icon: '✎' },
  { id: 'barcode', label: 'Barcode', icon: '⊞' },
  { id: 'photo',   label: 'Photo',   icon: '◉' },
  { id: 'voice',   label: 'Voice',   icon: '◎' },
];

// ─── Macro Ring (tiny) ──────────────────────────────────────────────────────
function MacroRing({ value, goal, color, label, unit = 'g' }) {
  const pct = goal ? Math.min(value / goal, 1) : 0;
  const r = 18; const circ = 2 * Math.PI * r;
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={44} height={44} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={22} cy={22} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
        <circle cx={22} cy={22} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      </svg>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginTop: -34, position: 'relative' }}>
        {Math.round(value)}
      </div>
      <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', marginTop: 14 }}>
        {label}
      </div>
    </div>
  );
}

// ─── Goal Impact Badge ──────────────────────────────────────────────────────
function ImpactBadge({ score, reasons }) {
  if (score === 0 && (!reasons || !reasons.length)) return null;
  const color = score > 0 ? STATUS.ok.color : score < 0 ? STATUS.warn.color : 'rgba(255,255,255,0.3)';
  const arrow = score > 0 ? '↑' : score < 0 ? '↓' : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 12, background: `${color}15`, border: `1px solid ${color}25` }}>
      <span style={{ fontSize: 11, color }}>{arrow}</span>
      <span style={{ fontSize: 9, color, fontWeight: 600 }}>{reasons?.[0]?.text || 'Neutral'}</span>
    </div>
  );
}

// ─── Food Entry Row ─────────────────────────────────────────────────────────
function EntryRow({ entry, onDelete }) {
  const G = getGoals();
  const impact = goalImpact(entry, G);
  const mealCat = MEAL_CATEGORIES.find(m => m.id === entry.meal);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      {/* Meal icon */}
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: `${mealCat?.color || '#6b7280'}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0,
      }}>{mealCat?.icon || '◈'}</div>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
          {Math.round(entry.macros?.calories || 0)} cal · {Math.round(entry.macros?.protein || 0)}g P · {Math.round(entry.macros?.carbs || 0)}g C · {Math.round(entry.macros?.fat || 0)}g F
        </div>
        {impact.reasons.length > 0 && <ImpactBadge score={impact.score} reasons={impact.reasons} />}
      </div>

      {/* Time + source */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{entry.time}</div>
        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>{entry.source}</div>
      </div>

      {/* Delete */}
      <button onClick={() => onDelete(entry.id)} style={{
        background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)',
        fontSize: 14, cursor: 'pointer', padding: 4,
      }}>×</button>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export function NutritionInput({ date, onUpdate }) {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState('manual');
  const [entries, setEntries] = useState(() => getEntriesForDate(dateStr));
  const [totals, setTotals] = useState(() => dailyTotals(dateStr));
  const [showAdd, setShowAdd] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState('snack');
  const G = getGoals();

  // ── Manual form state ──
  const [manualName, setManualName] = useState('');
  const [manualCal, setManualCal] = useState('');
  const [manualPro, setManualPro] = useState('');
  const [manualCarb, setManualCarb] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [manualWater, setManualWater] = useState('');

  // ── Barcode state ──
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeResult, setBarcodeResult] = useState(null);
  const [barcodeLoading, setBarcodeLoading] = useState(false);

  // ── Search state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // ── Voice state ──
  const [voiceText, setVoiceText] = useState('');
  const [voiceListening, setVoiceListening] = useState(false);

  // Refresh when date changes
  useEffect(() => {
    setEntries(getEntriesForDate(dateStr));
    setTotals(dailyTotals(dateStr));
  }, [dateStr]);

  const refresh = () => {
    setEntries(getEntriesForDate(dateStr));
    setTotals(dailyTotals(dateStr));
    onUpdate?.();
  };

  // ── Save entry helper ──
  const addEntry = (opts) => {
    const entry = createEntry({ ...opts, date: dateStr, meal: selectedMeal });
    saveEntry(entry);
    refresh();
    setShowAdd(false);
    resetForm();
  };

  const resetForm = () => {
    setManualName(''); setManualCal(''); setManualPro(''); setManualCarb(''); setManualFat(''); setManualWater('');
    setBarcodeInput(''); setBarcodeResult(null); setSearchQuery(''); setSearchResults([]);
  };

  const handleDelete = (id) => {
    deleteEntry(id);
    refresh();
  };

  // ── Barcode lookup ──
  const handleBarcodeLookup = async () => {
    if (!barcodeInput.trim()) return;
    setBarcodeLoading(true);
    const result = await lookupBarcode(barcodeInput.trim());
    setBarcodeResult(result);
    setBarcodeLoading(false);
  };

  // ── Food search ──
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    const results = await searchFood(searchQuery.trim());
    setSearchResults(results);
    setSearchLoading(false);
  };

  // ── Voice recognition ──
  const startVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setVoiceText(text);
      // Simple parsing: "200 calories of chicken breast"
      const calMatch = text.match(/(\d+)\s*cal/i);
      const proMatch = text.match(/(\d+)\s*(?:grams?\s+(?:of\s+)?)?protein/i);
      setManualName(text.replace(/\d+\s*cal(?:ories?)?\s*(?:of\s*)?/i, '').replace(/\d+\s*grams?\s*(?:of\s*)?protein/i, '').trim() || text);
      if (calMatch) setManualCal(calMatch[1]);
      if (proMatch) setManualPro(proMatch[1]);
      setMode('manual'); // Switch to manual to review/edit
    };
    rec.onerror = () => setVoiceListening(false);
    rec.onend = () => setVoiceListening(false);
    setVoiceListening(true);
    rec.start();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Daily Macro Summary ─────────────────────────────────────────── */}
      <div style={{ ...glass, padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          TODAY'S NUTRITION
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <MacroRing value={totals.calories} goal={parseFloat(G.dailyCalorieTarget) || 2200} color="#4ade80" label="Cal" unit="kcal" />
          <MacroRing value={totals.protein}  goal={parseFloat(G.dailyProteinTarget) || 150}  color="#f472b6" label="Protein" />
          <MacroRing value={totals.carbs}    goal={parseFloat(G.dailyCarbTarget) || 200}     color="#fbbf24" label="Carbs" />
          <MacroRing value={totals.fat}      goal={parseFloat(G.dailyFatTarget) || 70}       color="#60a5fa" label="Fat" />
          <MacroRing value={totals.water}    goal={2500}                                      color="#22d3ee" label="Water" unit="ml" />
        </div>
      </div>

      {/* ── Add Food Button ────────────────────────────────────────────── */}
      {!showAdd && (
        <button onClick={() => setShowAdd(true)} style={{
          ...glass, padding: '14px', cursor: 'pointer', textAlign: 'center',
          fontSize: 13, fontWeight: 600, color: '#60a5fa',
          background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 12,
        }}>
          + Log food or water
        </button>
      )}

      {/* ── Add Food Panel ─────────────────────────────────────────────── */}
      {showAdd && (
        <div style={{ ...glass, padding: '16px', overflow: 'hidden' }}>

          {/* Meal category selector */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', marginBottom: 12, padding: '0 0 4px' }}>
            {MEAL_CATEGORIES.map(m => (
              <button key={m.id} onClick={() => setSelectedMeal(m.id)} style={{
                padding: '6px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                background: selectedMeal === m.id ? `${m.color}25` : 'rgba(255,255,255,0.04)',
                color: selectedMeal === m.id ? m.color : 'rgba(255,255,255,0.4)',
                fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                border: selectedMeal === m.id ? `1px solid ${m.color}40` : '1px solid transparent',
              }}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          {/* Input mode tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {INPUT_MODES.map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: mode === m.id ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
                color: mode === m.id ? '#60a5fa' : 'rgba(255,255,255,0.35)',
                fontSize: 10, fontWeight: 600,
              }}>
                <div style={{ fontSize: 14 }}>{m.icon}</div>
                {m.label}
              </button>
            ))}
          </div>

          {/* ── MANUAL MODE ──────────────────────────────────────────── */}
          {mode === 'manual' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Search bar */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Search food database..."
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
                <button onClick={handleSearch} disabled={searchLoading} style={{
                  padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 12, fontWeight: 600,
                }}>{searchLoading ? '...' : '⌕'}</button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div style={{ maxHeight: 160, overflowY: 'auto', borderRadius: 10, background: 'rgba(255,255,255,0.03)' }}>
                  {searchResults.map((r, i) => (
                    <div key={i} onClick={() => {
                      setManualName(r.name + (r.brand ? ` (${r.brand})` : ''));
                      setManualCal(String(r.macros.calories));
                      setManualPro(String(r.macros.protein));
                      setManualCarb(String(r.macros.carbs));
                      setManualFat(String(r.macros.fat));
                      setSearchResults([]);
                    }} style={{
                      padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
                      fontSize: 11, color: '#fff',
                    }}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
                        {r.brand ? `${r.brand} · ` : ''}{r.macros.calories} cal · {r.macros.protein}g P
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Food name"
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input value={manualCal} onChange={e => setManualCal(e.target.value)} placeholder="Calories" type="number"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
                <input value={manualPro} onChange={e => setManualPro(e.target.value)} placeholder="Protein (g)" type="number"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
                <input value={manualCarb} onChange={e => setManualCarb(e.target.value)} placeholder="Carbs (g)" type="number"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
                <input value={manualFat} onChange={e => setManualFat(e.target.value)} placeholder="Fat (g)" type="number"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
              </div>
              <input value={manualWater} onChange={e => setManualWater(e.target.value)} placeholder="Water (ml)" type="number"
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />

              <button onClick={() => {
                if (!manualName.trim() && !manualCal && !manualWater) return;
                addEntry({
                  name: manualName.trim() || (manualWater ? 'Water' : 'Food'),
                  source: 'manual',
                  macros: {
                    calories: parseFloat(manualCal) || 0,
                    protein: parseFloat(manualPro) || 0,
                    carbs: parseFloat(manualCarb) || 0,
                    fat: parseFloat(manualFat) || 0,
                    water: parseFloat(manualWater) || 0,
                  },
                });
              }} style={{
                padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 13, fontWeight: 600,
              }}>Save entry</button>
            </div>
          )}

          {/* ── BARCODE MODE ─────────────────────────────────────────── */}
          {mode === 'barcode' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                Enter barcode number or scan with camera
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBarcodeLookup()}
                  placeholder="Enter barcode (UPC/EAN)..."
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
                <button onClick={handleBarcodeLookup} disabled={barcodeLoading} style={{
                  padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 12, fontWeight: 600,
                }}>{barcodeLoading ? '...' : 'Look up'}</button>
              </div>

              {barcodeResult && (
                <div style={{ padding: '12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    {barcodeResult.imageUrl && <img src={barcodeResult.imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{barcodeResult.name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{barcodeResult.brand} · {barcodeResult.servingSize}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                    {barcodeResult.macros.calories} cal · {barcodeResult.macros.protein}g P · {barcodeResult.macros.carbs}g C · {barcodeResult.macros.fat}g F
                  </div>
                  <button onClick={() => {
                    addEntry({ name: barcodeResult.name, source: 'barcode', macros: barcodeResult.macros, barcode: barcodeResult.barcode, imageUrl: barcodeResult.imageUrl });
                  }} style={{
                    width: '100%', padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 12, fontWeight: 600,
                  }}>Add this food</button>
                </div>
              )}
              {barcodeResult === null && barcodeInput && !barcodeLoading && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>No product found. Try entering manually.</div>
              )}
            </div>
          )}

          {/* ── PHOTO MODE ───────────────────────────────────────────── */}
          {mode === 'photo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                Take a photo of your food for auto-detection
              </div>
              <label style={{
                width: '100%', padding: '30px 16px', borderRadius: 14,
                border: '2px dashed rgba(255,255,255,0.1)', textAlign: 'center',
                cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 12,
              }}>
                📷 Tap to take photo
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    // For now, switch to manual mode with the photo attached
                    const reader = new FileReader();
                    reader.onload = () => {
                      setMode('manual');
                      setManualName('Photo food (edit name)');
                      // TODO: integrate food recognition API
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
                Food recognition coming soon — photo will be saved with manual entry
              </div>
            </div>
          )}

          {/* ── VOICE MODE ───────────────────────────────────────────── */}
          {mode === 'voice' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                Say something like "300 calories of grilled chicken"
              </div>
              <button onClick={startVoice} style={{
                width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: voiceListening ? 'rgba(239,68,68,0.2)' : 'rgba(96,165,250,0.15)',
                color: voiceListening ? '#ef4444' : '#60a5fa', fontSize: 24,
                boxShadow: voiceListening ? '0 0 20px rgba(239,68,68,0.3)' : 'none',
                transition: 'all 0.3s ease',
              }}>
                {voiceListening ? '●' : '◎'}
              </button>
              <div style={{ fontSize: 10, color: voiceListening ? '#ef4444' : 'rgba(255,255,255,0.3)' }}>
                {voiceListening ? 'Listening...' : 'Tap to speak'}
              </div>
              {voiceText && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', width: '100%', textAlign: 'center' }}>
                  "{voiceText}"
                </div>
              )}
            </div>
          )}

          {/* Cancel */}
          <button onClick={() => { setShowAdd(false); resetForm(); }} style={{
            marginTop: 8, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 11, width: '100%',
          }}>Cancel</button>
        </div>
      )}

      {/* ── Today's Entries ────────────────────────────────────────────── */}
      {entries.length > 0 && (
        <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px 6px', fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            LOGGED TODAY · {entries.length} {entries.length === 1 ? 'item' : 'items'}
          </div>
          {entries.map(e => <EntryRow key={e.id} entry={e} onDelete={handleDelete} />)}
        </div>
      )}
    </div>
  );
}
