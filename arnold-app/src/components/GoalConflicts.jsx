// GoalConflicts (Sprint 3.1c) — the UI that finally makes the goal model VISIBLE.
// Reads the unified goal model's conflicts and, for each, shows the trade-off BOTH
// ways and lets the user tap their choice. The coach never decides — it surfaces
// the tension + consequences; the user picks (persisted via setGoalResolution).
//
// Self-contained: gathers its own inputs synchronously and calls the pure
// buildGoalModel, so it can be dropped in with one line (<GoalConflicts />) without
// wiring. Renders nothing when there are no conflicts.

import { useMemo, useState } from 'react';
import { buildGoalModel, getGoalResolutions, setGoalResolution } from '../core/goalResolve.js';
import { getGoals } from '../core/goals.js';
import { storage } from '../core/storage.js';
import { getCurrentBodyComp } from '../core/energyBalance.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';

const SEV = { high: '#f87171', medium: '#fbbf24' };
const TEAL = '#5eead4';

export function GoalConflicts({ style }) {
  const storageVersion = useStorageVersion();
  const [tick, setTick] = useState(0);   // setGoalResolution writes raw localStorage → bump manually

  const model = useMemo(() => {
    try {
      const goals = getGoals() || {};
      const races = storage.get('races') || [];
      const comp = (() => { try { return getCurrentBodyComp(); } catch { return null; } })();
      return buildGoalModel({
        today: new Date().toISOString().slice(0, 10),
        goals, races,
        aRaceDate: goals.aRaceDate || null,
        currentWeightLbs: comp?.weightLbs ?? null,
        currentBodyFatPct: comp?.bodyFatPct ?? null,
        targetWeightDate: goals.targetWeightDate || null,
        resolutions: getGoalResolutions(),
      });
    } catch { return null; }
  }, [storageVersion, tick]);

  const conflicts = model?.conflicts || [];
  if (!conflicts.length) return null;

  const choose = (id, key) => { setGoalResolution(id, key); setTick(t => t + 1); };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)',
      borderRadius: 12, padding: '14px 16px', marginBottom: 12, color: '#e8eceb', ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: TEAL, textTransform: 'uppercase' }}>
          Goals in tension
        </span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>your call · the coach won't decide for you</span>
      </div>

      {conflicts.map(c => (
        <div key={c.id} style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 10, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: SEV[c.severity] || TEAL, flexShrink: 0, transform: 'translateY(-1px)' }} />
            <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{c.summary}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {c.options.map(o => {
              const picked = c.resolution === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => choose(c.id, picked ? null : o.key)}
                  style={{
                    all: 'unset', cursor: 'pointer', boxSizing: 'border-box',
                    padding: '9px 11px', borderRadius: 9,
                    border: `1px solid ${picked ? TEAL : 'rgba(255,255,255,0.12)'}`,
                    background: picked ? 'rgba(94,234,212,0.10)' : 'transparent',
                    transition: 'background 140ms ease, border-color 140ms ease',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: picked ? TEAL : '#e8eceb', marginBottom: 3 }}>
                    {picked ? '✓ ' : ''}{o.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.62)', lineHeight: 1.35, marginBottom: 4 }}>{o.action}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.42)', lineHeight: 1.35 }}>Cost: {o.cost}</div>
                </button>
              );
            })}
          </div>

          {!c.resolution && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginTop: 6 }}>Tap the side you want to prioritize.</div>
          )}
        </div>
      ))}
    </div>
  );
}

export default GoalConflicts;
