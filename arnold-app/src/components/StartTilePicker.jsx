// ─── Start-Screen Tile Picker (Phase 4b) ───────────────────────────────────
// Full-screen modal where the user toggles which 2-4 metrics show on each of
// the four Start screen categories (Run / Strength / Recovery / Body).
//
// Behavior:
//   - Min 2 selected per category. The toggle of the 2nd-last selected is
//     disabled until another metric is added.
//   - Max 4 selected per category. Once 4 are selected, the remaining
//     un-selected toggles are disabled.
//   - Unavailable metrics (no data yet — e.g. Race Predictor on a watch
//     that doesn't emit it) are greyed and labeled "needs <data source>".
//   - Selection ORDER drives display order on the Start screen. First
//     toggled = first slot. Tap a selected metric again to remove it; the
//     remaining slots compact down.
//   - Saves to storage('startTilePrefs') on every toggle (debounced).
//
// Cross-device sync: storage layer key syncs via cloud-sync default LWW.
// Last-toggled device wins, which is the intuitive behavior for a single
// user's preferences.
//
// Mounted in two places:
//   - Mobile: Start screen "Customize" link at the bottom
//   - Desktop: Goals tab "Start tile preferences" section (Phase 5)

import { useState, useEffect, useMemo, useCallback } from "react";
import { storage } from "../core/storage.js";
import {
  TILE_METRICS,
  DEFAULT_TILE_PREFS,
  metricsByCategory,
  normalizeTilePrefs,
  buildTileContext,
} from "../core/derive/tileMetrics.js";

const CATEGORIES = [
  { id: 'run',      label: 'Run',      color: '#60a5fa' },
  { id: 'strength', label: 'Strength', color: '#a78bfa' },
  { id: 'recovery', label: 'Recovery', color: '#4ade80' },
  { id: 'body',     label: 'Body',     color: '#fbbf24' },
];

// Brief plain-English descriptions for each metric. Shown under the label
// in the picker so users can decide what to enable without leaving the
// settings screen. Keep each description ≤ 90 chars — one line on mobile.
const METRIC_DESCRIPTIONS = {
  // Run
  avgRunHR:           "Average heart rate from your most recent run.",
  cadence:            "Steps per minute. Higher (170+) = lower mechanical impact.",
  racePredictor:      "Garmin's predicted finish times for 5K / 10K / Half / Marathon.",
  aerobicTE:          "Aerobic Training Effect (0-5). Endurance gain from the session.",
  paceHrRatio:        "Pace ÷ HR. Lower = better aerobic efficiency. Track the trend.",
  zone2Weekly:        "Minutes spent in Zone 2 this week. Foundation of endurance training.",
  aerobicDecoupling:  "HR drift vs pace on long runs. <5% = aerobically sound for the distance.",
  acwr:               "Acute:Chronic Workload Ratio. Sweet spot 0.8-1.3, danger zone >1.5.",
  // Strength
  epoc:               "Garmin's training load — how much recovery this session demands.",
  avgStrengthHR:      "Average HR during your most recent strength session.",
  peakStrengthHR:     "Peak HR during your most recent strength session.",
  workRestRatio:      "Total rest ÷ work for your last session. 1:>5=power, 1:1.5-5=hypertrophy, 1:<1.5=endurance.",
  activeStrengthCal:  "Active calories burned in your most recent strength session.",
  sessionDuration:    "Total time of your most recent strength session.",
  preTrainingCarbs:   "Carbs eaten in the 2 hours before your last strength session.",
  postTrainingProtein:"Protein eaten within 60 min after your last strength session.",
  // Recovery
  overnightHRV:       "Heart Rate Variability during sleep. Higher = better autonomic recovery.",
  rhr:                "Resting Heart Rate. Lower = better cardiovascular fitness.",
  sleepScore:         "Garmin's sleep quality score (0-100). Imported via Sleep CSV.",
  morningBodyBattery: "Garmin's energy reserves at wake. Needs Garmin Wellness sync (Phase 4).",
  dailyStress:        "Garmin's daytime stress score. Needs Garmin Wellness sync (Phase 4).",
  trainingReadiness:  "Garmin's holistic readiness. Needs Garmin Wellness sync (Phase 4).",
  recoveryHours:      "Hours until back to baseline. Needs Garmin Wellness sync (Phase 4).",
  sleepRegularity:    "Bedtime variance over 7 nights. Lower = more consistent sleep.",
  // Body
  totalCal:           "Today's calorie intake vs. your daily target.",
  protein:            "Today's protein (g) vs. your daily target.",
  carbs:              "Today's carbs (g) vs. your daily target.",
  fat:                "Today's fat (g) vs. your daily target.",
  fiber:              "Today's fiber (g) vs. your daily target.",
  micronutrientScore: "Percentage of tracked micronutrient targets you've hit today.",
  weightTrend:        "7-day rolling weight average — filters out daily hydration noise.",
  sodium:             "Today's sodium (mg) vs. target. Critical at high training volumes.",
};

const MIN_PER_CATEGORY = 2;
const MAX_PER_CATEGORY = 4;

// Debounce so rapid toggles don't hammer storage + cloud-sync push.
let _saveTimer = null;
function debouncedSave(prefs) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      storage.set('startTilePrefs', prefs, { skipValidation: true });
    } catch (e) {
      console.warn('[startTilePicker] save failed:', e);
    }
  }, 300);
}

// ── Inner picker (embeddable inline) ────────────────────────────────────────
// Renders just the category sections + toggles. Use this when embedding
// in a regular page section (e.g. Goals tab). The modal wrapper below adds
// the bottom-sheet chrome for mobile use.
//
// Props:
//   layout — 'stacked' (default, single column — fits mobile viewports) or
//            'grid' (2x2 for desktop: Run | Strength, Recovery | Body)
export function StartTilePickerInner({ ctx, onClose, layout = 'stacked' }) {
  // Load + normalize prefs on mount. normalizeTilePrefs strips out any IDs
  // that no longer exist in the registry (e.g. verticalOscillation /
  // groundContactTime / anaerobicTE were removed during the 2026-04-27 Run
  // strict-swap). It also pads category lists below the min back up to the
  // sensible defaults. We persist the cleaned version immediately so the
  // picker UI and Start-screen render are guaranteed to agree on what's
  // selected.
  const [prefs, setPrefs] = useState(() => {
    const stored = storage.get('startTilePrefs');
    const incoming = stored || DEFAULT_TILE_PREFS;
    const cleaned = normalizeTilePrefs(incoming);
    // Surface what got dropped so the user understands why their selection
    // count went down. Quiet on first-run when there's nothing to compare.
    if (stored) {
      const dropped = {};
      for (const cat of Object.keys(cleaned)) {
        const before = stored[cat] || [];
        const after = cleaned[cat] || [];
        const lost = before.filter(id => !after.includes(id));
        if (lost.length) dropped[cat] = lost;
      }
      if (Object.keys(dropped).length) {
        console.warn('[startTilePicker] dropped stale metric ids (no longer in registry):', dropped);
        // Save the cleaned version so future loads don't re-warn.
        try { storage.set('startTilePrefs', cleaned, { skipValidation: true }); } catch {}
      }
    }
    return cleaned;
  });

  useEffect(() => {
    debouncedSave(prefs);
  }, [prefs]);

  const togglePref = useCallback((category, metricId) => {
    setPrefs(prev => {
      const current = prev[category] || [];
      const isSelected = current.includes(metricId);
      let next;
      if (isSelected) {
        if (current.length <= MIN_PER_CATEGORY) return prev;
        next = current.filter(id => id !== metricId);
      } else {
        if (current.length >= MAX_PER_CATEGORY) return prev;
        next = [...current, metricId];
      }
      return { ...prev, [category]: next };
    });
  }, []);

  // Move a selected tile up or down within its category. Used by the up/down
  // arrows on each selected metric. Position 0 = first tile shown on Start.
  const movePref = useCallback((category, metricId, direction) => {
    setPrefs(prev => {
      const current = prev[category] || [];
      const idx = current.indexOf(metricId);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= current.length) return prev;
      const next = [...current];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return { ...prev, [category]: next };
    });
  }, []);

  return (
    <div style={{ color: 'inherit', fontFamily: "inherit" }}>
      {onClose && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Customize Start screen</div>
          <button
            onClick={onClose}
            style={{
              padding: '4px 10px', fontSize: 12, fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: '#e2e8f0', borderRadius: 6, cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-muted, rgba(226,232,240,0.55))', marginBottom: 16 }}>
        Pick 2–4 metrics per category. Use the up/down arrows on selected metrics to reorder; tile 1 shows leftmost on Start.
      </div>

      <div style={layout === 'grid' ? {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        columnGap: 18,
        rowGap: 4,
      } : undefined}>
        {CATEGORIES.map(cat => (
          <CategorySection
            key={cat.id}
            category={cat}
            metrics={metricsByCategory(cat.id)}
            selected={prefs[cat.id] || []}
            onToggle={togglePref}
            onMove={movePref}
            ctx={ctx}
          />
        ))}
      </div>
    </div>
  );
}

// ── Modal wrapper (for mobile bottom-sheet use) ─────────────────────────────
export function StartTilePicker({ onClose, ctx }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 600,
          maxHeight: '90vh', overflowY: 'auto',
          background: 'rgba(16,18,24,0.98)',
          borderRadius: '20px 20px 0 0',
          padding: '20px 16px env(safe-area-inset-bottom, 16px)',
          color: '#e2e8f0',
          fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
        }}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'rgba(255,255,255,0.15)',
          margin: '0 auto 14px',
        }} />
        <StartTilePickerInner ctx={ctx} onClose={onClose} />
      </div>
    </div>
  );
}

function CategorySection({ category, metrics, selected, onToggle, onMove, ctx }) {
  const selectedCount = selected.length;
  const atMax = selectedCount >= MAX_PER_CATEGORY;
  const atMin = selectedCount <= MIN_PER_CATEGORY;

  // Selected metrics first (in their picked order), then unselected
  // alphabetically. Keeps user's current picks at the top of each section.
  const sortedMetrics = (() => {
    const selectedSet = new Set(selected);
    const selectedItems = selected
      .map(id => metrics.find(m => m.id === id))
      .filter(Boolean);
    const unselectedItems = metrics
      .filter(m => !selectedSet.has(m.id))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...selectedItems, ...unselectedItems];
  })();

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Compact section header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6, paddingBottom: 4,
        borderBottom: `1px solid ${category.color}33`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: category.color }} />
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: category.color }}>
            {category.label}
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(226,232,240,0.5)' }}>
          {selectedCount}/{MAX_PER_CATEGORY}
        </div>
      </div>

      {/* Single-column dense list — each row is one metric */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {sortedMetrics.map(m => {
          const isSelected = selected.includes(m.id);
          const orderIdx = isSelected ? selected.indexOf(m.id) : -1;
          const isAvailable = m.available ? m.available(ctx) : (m.compute(ctx) != null);
          const cannotAdd = !isSelected && atMax;
          const cannotRemove = isSelected && atMin;
          const disabled = cannotAdd || cannotRemove || (!isSelected && !isAvailable);
          const canMoveUp = isSelected && orderIdx > 0;
          const canMoveDown = isSelected && orderIdx >= 0 && orderIdx < selected.length - 1;
          const description = METRIC_DESCRIPTIONS[m.id] || '';

          return (
            <div
              key={m.id}
              style={{
                display: 'flex', alignItems: 'stretch',
                background: isSelected
                  ? `${category.color}1a`
                  : 'rgba(255,255,255,0.02)',
                borderLeft: isSelected
                  ? `3px solid ${category.color}`
                  : '3px solid transparent',
                borderRadius: 4,
                opacity: disabled && !isSelected ? 0.4 : 1,
                transition: 'all 0.12s ease',
              }}
            >
              {/* Position badge gutter — only renders width for selected items */}
              {isSelected && (
                <div style={{
                  width: 22, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  color: category.color,
                }}>
                  {orderIdx + 1}
                </div>
              )}

              {/* Main click target — toggle on label click */}
              <div
                onClick={() => !disabled && onToggle(category.id, m.id)}
                style={{
                  flex: 1, minWidth: 0,
                  padding: '6px 8px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                }}
              >
                <div style={{
                  fontSize: 12, fontWeight: 600,
                  color: disabled && !isSelected ? 'rgba(226,232,240,0.4)' : '#e2e8f0',
                  lineHeight: 1.25,
                }}>
                  {m.label}
                  {!isAvailable && !isSelected && (
                    <span style={{ marginLeft: 6, fontSize: 9, color: 'rgba(226,232,240,0.4)', fontWeight: 400 }}>
                      · no data
                    </span>
                  )}
                </div>
                {description && (
                  <div style={{
                    fontSize: 10,
                    color: isSelected ? 'rgba(226,232,240,0.7)' : 'rgba(226,232,240,0.45)',
                    lineHeight: 1.3, marginTop: 1,
                  }}>
                    {description}
                  </div>
                )}
              </div>

              {/* Reorder arrows on the right edge — selected only */}
              {isSelected && (
                <div style={{
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  paddingRight: 4, gap: 1, flexShrink: 0,
                }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (canMoveUp) onMove(category.id, m.id, 'up'); }}
                    disabled={!canMoveUp}
                    aria-label="Move earlier"
                    style={{
                      width: 18, height: 14, padding: 0,
                      borderRadius: 3,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: canMoveUp ? `${category.color}40` : 'transparent',
                      color: canMoveUp ? '#e2e8f0' : 'rgba(226,232,240,0.2)',
                      cursor: canMoveUp ? 'pointer' : 'default',
                      fontSize: 8, lineHeight: 1, fontWeight: 700,
                    }}
                  >▲</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (canMoveDown) onMove(category.id, m.id, 'down'); }}
                    disabled={!canMoveDown}
                    aria-label="Move later"
                    style={{
                      width: 18, height: 14, padding: 0,
                      borderRadius: 3,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: canMoveDown ? `${category.color}40` : 'transparent',
                      color: canMoveDown ? '#e2e8f0' : 'rgba(226,232,240,0.2)',
                      cursor: canMoveDown ? 'pointer' : 'default',
                      fontSize: 8, lineHeight: 1, fontWeight: 700,
                    }}
                  >▼</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
