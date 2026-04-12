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
  lookupBarcode, searchFood, calculatePortion, recognizeFoodPhoto,
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

// ─── Portion Selector (reusable) ────────────────────────────────────────────
// `baseMacros` = macros for 1 serving (what the user entered or what the API returned)
// `per100g`    = per-100g macros (only available for barcode lookups)
// `servingLabel` = label for 1 serving (e.g. "30g" from barcode, or "1 portion")
// `onChange(adjustedMacros, portionLabel)` fires on every change
const PORTION_UNITS_FULL = [
  { id: 'serving', label: 'Serving' },
  { id: 'g',       label: 'Grams' },
  { id: 'oz',      label: 'Oz' },
  { id: 'ml',      label: 'mL' },
  { id: 'cup',     label: 'Cup' },
  { id: 'tbsp',    label: 'Tbsp' },
  { id: 'tsp',     label: 'Tsp' },
];
// When we only have per-serving data (manual, photo, voice), gram/oz/ml units
// don't apply — we can only scale by serving count.
const PORTION_UNITS_SERVING_ONLY = [
  { id: 'serving', label: 'Serving' },
];

function PortionSelector({ baseMacros, per100g, servingLabel, onChange }) {
  const [unit, setUnit] = useState('serving');
  const [amount, setAmount] = useState('1');
  const hasWeight = !!per100g;
  const units = hasWeight ? PORTION_UNITS_FULL : PORTION_UNITS_SERVING_ONLY;

  const recalc = useCallback((u, amt) => {
    const n = parseFloat(amt);
    if (!n || n <= 0 || !baseMacros) { onChange?.(baseMacros, '1 serving'); return; }
    if (u === 'serving') {
      const scaled = {};
      for (const k of Object.keys(baseMacros)) {
        scaled[k] = k === 'calories' ? Math.round((baseMacros[k] || 0) * n)
          : Math.round(((baseMacros[k] || 0) * n) * 10) / 10;
      }
      onChange?.(scaled, n === 1 ? '1 serving' : `${amt} servings`);
    } else if (per100g) {
      const adj = calculatePortion(per100g, n, u);
      onChange?.(adj, `${amt} ${u}`);
    }
  }, [baseMacros, per100g, onChange]);

  // Recalc on mount with defaults
  useEffect(() => { recalc('serving', '1'); }, [baseMacros]);

  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>How much?</div>
      {/* Unit buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {units.map(u => (
          <button key={u.id} onClick={() => { setUnit(u.id); recalc(u.id, amount); }}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: unit === u.id ? '1px solid rgba(96,165,250,0.5)' : '1px solid rgba(255,255,255,0.08)',
              background: unit === u.id ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
              color: unit === u.id ? '#60a5fa' : 'rgba(255,255,255,0.5)',
            }}>{u.label}</button>
        ))}
      </div>
      {/* Amount input */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* Quick buttons */}
        {[0.5, 1, 1.5, 2].map(v => (
          <button key={v} onClick={() => { setAmount(String(v)); recalc(unit, String(v)); }}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: amount === String(v) ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.06)',
              background: amount === String(v) ? 'rgba(96,165,250,0.1)' : 'rgba(255,255,255,0.03)',
              color: amount === String(v) ? '#60a5fa' : 'rgba(255,255,255,0.4)',
              minWidth: 32,
            }}>{v}</button>
        ))}
        <input value={amount}
          onChange={e => { setAmount(e.target.value); recalc(unit, e.target.value); }}
          type="number" min="0" step="any"
          style={{ width: 50, padding: '5px 6px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 12, textAlign: 'center' }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
          {unit === 'serving' ? (servingLabel || 'serving') : unit}
        </span>
      </div>
    </div>
  );
}

// ─── Macro Summary Line ─────────────────────────────────────────────────────
function MacroLine({ macros }) {
  if (!macros) return null;
  return (
    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontWeight: 600, color: '#fff', fontSize: 12 }}>{macros.calories || 0}</span> cal
      {' · '}<span style={{ color: '#60a5fa' }}>{macros.protein || 0}g</span> P
      {' · '}<span style={{ color: '#fbbf24' }}>{macros.carbs || 0}g</span> C
      {' · '}<span style={{ color: '#f87171' }}>{macros.fat || 0}g</span> F
      {macros.fiber ? <span> · {macros.fiber}g fiber</span> : null}
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
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);

  // ── Portion size state (shared across all modes) ──
  const [portionMacros, setPortionMacros] = useState(null);
  const [portionLabel, setPortionLabel] = useState('1 serving');
  const handlePortionChange = useCallback((macros, label) => {
    setPortionMacros(macros);
    setPortionLabel(label || '1 serving');
  }, []);

  // ── Photo AI state ──
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoResult, setPhotoResult] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);

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
    setPortionMacros(null); setPortionLabel('1 serving');
    setPhotoResult(null); setPhotoError(''); setPhotoPreview(null);
  };

  const handleDelete = (id) => {
    deleteEntry(id);
    refresh();
  };

  // ── Barcode lookup ──
  const handleBarcodeLookup = async (code) => {
    const barcode = code || barcodeInput.trim();
    if (!barcode) return;
    setBarcodeInput(barcode);
    setBarcodeLoading(true);
    const result = await lookupBarcode(barcode);
    setBarcodeResult(result);
    setBarcodeLoading(false);
    setPortionMacros(null);
    setPortionLabel('1 serving');
  };

  // ── Photo analysis handler ──
  const handlePhotoAnalysis = useCallback(async (file) => {
    setPhotoLoading(true);
    setPhotoError('');
    setPhotoResult(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]); // strip data:... prefix
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setPhotoPreview(URL.createObjectURL(file));
      const mediaType = file.type || 'image/jpeg';
      const result = await recognizeFoodPhoto(base64, mediaType);
      if (result.error) {
        setPhotoError(result.error);
      } else {
        setPhotoResult(result);
      }
    } catch (e) {
      setPhotoError(`Analysis failed: ${e.message}`);
    } finally {
      setPhotoLoading(false);
    }
  }, []);

  // ── Camera barcode scanner ──
  const stopScanner = useCallback(() => {
    if (scanLoopRef.current) { clearInterval(scanLoopRef.current); scanLoopRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScannerActive(false);
  }, []);

  const startScanner = useCallback(async () => {
    setScannerError('');
    // Check BarcodeDetector support
    if (!('BarcodeDetector' in window)) {
      setScannerError('Camera scanning not supported in this browser. Use manual entry below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      setScannerActive(true);

      // Wait for video element to be ready
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });

      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });

      // Scan loop — check every 400ms
      let lastDetected = '';
      scanLoopRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0 && barcodes[0].rawValue !== lastDetected) {
            lastDetected = barcodes[0].rawValue;
            stopScanner();
            handleBarcodeLookup(barcodes[0].rawValue);
          }
        } catch { /* ignore detection errors during scan */ }
      }, 400);
    } catch (err) {
      setScannerError(err.name === 'NotAllowedError'
        ? 'Camera access denied. Please allow camera permissions and try again.'
        : `Camera error: ${err.message}`);
      stopScanner();
    }
  }, [stopScanner]);

  // Clean up scanner on unmount or mode change
  useEffect(() => { return () => stopScanner(); }, [stopScanner]);
  useEffect(() => { if (mode !== 'barcode') stopScanner(); }, [mode, stopScanner]);

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

              {/* ── Portion selector (serving multiplier for manual mode) ── */}
              {(manualCal || manualPro || manualCarb || manualFat) && (
                <PortionSelector
                  baseMacros={{
                    calories: parseFloat(manualCal) || 0,
                    protein: parseFloat(manualPro) || 0,
                    carbs: parseFloat(manualCarb) || 0,
                    fat: parseFloat(manualFat) || 0,
                  }}
                  onChange={handlePortionChange} />
              )}

              {/* ── Calculated macros preview ── */}
              {portionMacros && (manualCal || manualPro || manualCarb || manualFat) && (
                <MacroLine macros={{ ...portionMacros, water: parseFloat(manualWater) || 0 }} />
              )}

              <button onClick={() => {
                if (!manualName.trim() && !manualCal && !manualWater) return;
                const baseMacros = {
                  calories: parseFloat(manualCal) || 0,
                  protein: parseFloat(manualPro) || 0,
                  carbs: parseFloat(manualCarb) || 0,
                  fat: parseFloat(manualFat) || 0,
                  water: parseFloat(manualWater) || 0,
                };
                const finalMacros = portionMacros
                  ? { ...portionMacros, water: baseMacros.water }
                  : baseMacros;
                addEntry({
                  name: manualName.trim() || (manualWater ? 'Water' : 'Food'),
                  source: 'manual',
                  macros: finalMacros,
                  ...(portionMacros && portionLabel !== '1 serving' ? { portion: portionLabel } : {}),
                });
              }} style={{
                padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 13, fontWeight: 600,
              }}>Save entry</button>
            </div>
          )}

          {/* ── BARCODE MODE ─────────────────────────────────────────── */}
          {mode === 'barcode' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Camera viewfinder */}
              {scannerActive && (
                <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
                  <video ref={videoRef} playsInline muted autoPlay
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {/* Scanning overlay with crosshair */}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ width: '65%', height: '35%', border: '2px solid rgba(96,165,250,0.6)', borderRadius: 12, boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)' }} />
                  </div>
                  <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                    Point at barcode — scanning...
                  </div>
                  <button onClick={stopScanner} style={{
                    position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>×</button>
                </div>
              )}

              {/* Scan button (when camera not active) */}
              {!scannerActive && !barcodeResult && (
                <button onClick={startScanner} style={{
                  padding: '20px 16px', borderRadius: 14, cursor: 'pointer',
                  border: '2px dashed rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.06)',
                  color: '#60a5fa', fontSize: 14, fontWeight: 600, textAlign: 'center',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 28 }}>⊞</span>
                  Scan Barcode
                  <span style={{ fontSize: 10, fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>
                    Point your camera at a barcode
                  </span>
                </button>
              )}

              {/* Scanner error */}
              {scannerError && (
                <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center', padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)' }}>
                  {scannerError}
                </div>
              )}

              {/* Manual barcode fallback */}
              {!scannerActive && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleBarcodeLookup()}
                    placeholder="Or type barcode number..."
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13 }} />
                  <button onClick={() => handleBarcodeLookup()} disabled={barcodeLoading} style={{
                    padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 12, fontWeight: 600,
                  }}>{barcodeLoading ? '...' : 'Look up'}</button>
                </div>
              )}

              {/* Barcode result with portion selector */}
              {barcodeResult && (
                <div style={{ padding: '12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    {barcodeResult.imageUrl && <img src={barcodeResult.imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{barcodeResult.name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{barcodeResult.brand}{barcodeResult.servingSize ? ` · ${barcodeResult.servingSize}` : ''}</div>
                    </div>
                  </div>

                  {/* ── Portion selector (with full unit support for barcode) ── */}
                  <div style={{ marginBottom: 8 }}>
                    <PortionSelector
                      baseMacros={barcodeResult.macros}
                      per100g={barcodeResult.per100g}
                      servingLabel={barcodeResult.servingSize}
                      onChange={handlePortionChange} />
                  </div>

                  {/* ── Calculated macros ── */}
                  <MacroLine macros={portionMacros || barcodeResult.macros} />

                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button onClick={() => {
                      const m = portionMacros || barcodeResult.macros;
                      addEntry({ name: `${barcodeResult.name} (${portionLabel})`, source: 'barcode', macros: m, barcode: barcodeResult.barcode, imageUrl: barcodeResult.imageUrl });
                    }} style={{
                      flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 12, fontWeight: 600,
                    }}>Add this food</button>
                    <button onClick={() => { setBarcodeResult(null); setBarcodeInput(''); setPortionMacros(null); }} style={{
                      padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', fontSize: 12,
                    }}>Scan another</button>
                  </div>
                </div>
              )}
              {barcodeResult === null && barcodeInput && !barcodeLoading && !scannerActive && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>No product found. Try entering manually.</div>
              )}
            </div>
          )}

          {/* ── PHOTO MODE (AI Vision) ─────────────────────────────── */}
          {mode === 'photo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Photo capture (when no result yet) */}
              {!photoResult && !photoLoading && (
                <>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                    Take a photo of your food — AI will identify ingredients and estimate macros
                  </div>
                  <label style={{
                    width: '100%', padding: '24px 16px', borderRadius: 14,
                    border: '2px dashed rgba(236,72,153,0.3)', textAlign: 'center',
                    cursor: 'pointer', color: '#ec4899', fontSize: 13, fontWeight: 600,
                    background: 'rgba(236,72,153,0.06)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ fontSize: 28 }}>◉</span>
                    Take Photo or Choose Image
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>
                      Works with dishes, ingredients, or packaged products
                    </span>
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePhotoAnalysis(file);
                      }} />
                  </label>
                </>
              )}

              {/* Loading state */}
              {photoLoading && (
                <div style={{ textAlign: 'center', padding: '20px 12px' }}>
                  {photoPreview && <img src={photoPreview} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12, marginBottom: 10, opacity: 0.7 }} />}
                  <div style={{ fontSize: 12, color: '#ec4899', fontWeight: 600, marginBottom: 4 }}>Analyzing food...</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Claude Vision is identifying ingredients and estimating macros</div>
                </div>
              )}

              {/* Error */}
              {photoError && (
                <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center', padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)' }}>
                  {photoError}
                  <button onClick={() => { setPhotoError(''); setPhotoPreview(null); }} style={{
                    display: 'block', margin: '8px auto 0', padding: '6px 14px', borderRadius: 8,
                    border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', fontSize: 11,
                  }}>Try again</button>
                </div>
              )}

              {/* AI Result */}
              {photoResult && (
                <div style={{ padding: '12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(236,72,153,0.15)' }}>
                  {photoPreview && <img src={photoPreview} alt="" style={{ width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 10, marginBottom: 8 }} />}

                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{photoResult.name}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
                    {photoResult.servingSize}
                    {photoResult.confidence && <span style={{
                      marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 8, fontWeight: 600,
                      background: photoResult.confidence === 'high' ? 'rgba(74,222,128,0.15)' : photoResult.confidence === 'medium' ? 'rgba(251,191,36,0.15)' : 'rgba(239,68,68,0.15)',
                      color: photoResult.confidence === 'high' ? '#4ade80' : photoResult.confidence === 'medium' ? '#fbbf24' : '#ef4444',
                    }}>{photoResult.confidence} confidence</span>}
                  </div>

                  {/* Detected ingredients */}
                  {photoResult.items?.length > 0 && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                      {photoResult.items.map((item, i) => (
                        <span key={i}>{i > 0 ? ', ' : ''}{item.ingredient} (~{item.estimatedGrams}g)</span>
                      ))}
                    </div>
                  )}

                  {/* ── Portion selector (serving multiplier for AI photo) ── */}
                  <div style={{ marginBottom: 8 }}>
                    <PortionSelector
                      baseMacros={photoResult.macros}
                      onChange={handlePortionChange} />
                  </div>

                  {/* Calculated macros */}
                  <MacroLine macros={portionMacros || photoResult.macros} />

                  {photoResult.notes && (
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontStyle: 'italic' }}>{photoResult.notes}</div>
                  )}

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => {
                      const m = portionMacros || photoResult.macros;
                      addEntry({ name: `${photoResult.name}${portionLabel !== '1 serving' ? ` (${portionLabel})` : ''}`, source: 'photo', macros: m });
                    }} style={{
                      flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 12, fontWeight: 600,
                    }}>Add this food</button>
                    <button onClick={() => { setPhotoResult(null); setPhotoPreview(null); }} style={{
                      padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', fontSize: 12,
                    }}>Retake</button>
                  </div>
                </div>
              )}
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
