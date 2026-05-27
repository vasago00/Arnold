// ─── ARNOLD CoachLine — Phase 4r.narrative.5 ────────────────────────────────
//
// The ambient Coach surface that lives at the top of every non-Coach tab.
// One adaptive component, two render modes:
//
//   ACTION mode — when the leverage signal's pillar matches the active
//     tab's pillar (e.g., glycogen leverage + Fuel tab), the line shows
//     the actual action sentence prominently. This IS the action surface
//     for that pillar, not a breadcrumb.
//
//   STATUS mode — when the leverage doesn't target this tab's pillar
//     (e.g., sleep leverage + Calendar tab), the line shows a slim
//     navigation form: "Coach: <leverage> · <counts>" with tap-through
//     to the Coach tab.
//
// Reactivity: same useStorageVersion path the Coach tab uses. Any storage
// write (Garmin sync, Cronometer entry, manual log) bumps storageVersion →
// the line recomputes within a tick.
//
// Hidden entirely on the Coach tab itself (where the full narrative lives).

import React, { useMemo, useState, useEffect } from 'react';
import { storage } from '../core/storage.js';
import { getGoals } from '../core/goals.js';
import { safeCompute } from '../core/safeCompute.js';
import { computeUserState } from '../core/intelligence.js';
import { composeNarrative } from '../core/narrativeComposer.js';
import { getNode } from '../core/narrativeGraph.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';

// ─── Where the CoachLine appears ────────────────────────────────────────────
//
// Phase 4r.narrative.5.fix.1 — user feedback 2026-05-26: the v1 implementation
// showed the same colored alert band on every tab, which was wrong. Right
// answer: only surface the Coach where its message is ACTIONABLE on that
// tab. Two cases:
//
//   1. EdgeIQ (`weekly`) — always shows. That's the intelligence surface.
//   2. Other tabs — show only if the current leverage signal's action
//      targets that tab. Map below: signal → list of tab ids that can act.
//
// On every other tab (Daily, Start, Calendar, Trend, Labs, Core, Settings):
// the CoachLine returns null. The dedicated Coach tab remains the home for
// the full narrative; the user opens it when they want the full read.
//
// Tab ids:
//   weekly = EdgeIQ        goals  = Plan
//   nutrition_mobile = Fuel  activity = Play

const SIGNAL_ACTIONABLE_ON = {
  // Sleep / recovery axis → Plan tab (where training adjustments live)
  sleepDebt:          ['goals'],
  hrvDepression:      ['goals'],
  rhrDrift:           ['goals'],
  recoveryVelocity:   ['goals'],
  sleepQuality:       ['goals'],

  // Cut / fuel axis → Fuel tab (and Plan when training adjustment matters too)
  tdeeDrift:          ['nutrition_mobile', 'goals'],
  energyAvailability: ['nutrition_mobile'],
  glycogen:           ['nutrition_mobile'],

  // Training distribution → Plan + Play
  polarization:       ['goals', 'activity'],
  monotonyStrain:     ['goals', 'activity'],
};

// Coach line is hidden entirely on these tabs:
//   • coach_beta — Coach has the full narrative
//   • weekly (EdgeIQ) — a richer Coach panel renders INSIDE the Dashboard
//     content alongside Goal Tensions, replacing the slim banner approach.
//     Phase 4r.narrative.5.fix.3 — user feedback that the slim banner there
//     felt disconnected from the other intelligence elements.
const HIDDEN_TABS = new Set(['coach_beta', 'weekly']);

// No more always-on tabs — every appearance is now signal-targeted.
const ALWAYS_ON_TABS = new Set();

// ─── State → color helper (mirrors the Coach tab's palette) ─────────────────

function stateColorFor(state) {
  if (state === 'severe' || state === 'concerning' || state === 'critical')   return '#f87171';
  if (state === 'moderate' || state === 'slowing' || state === 'adapting' ||
      state === 'depleted' || state === 'rising' || state === 'grey-zone' ||
      state === 'hot' || state === 'impaired' || state === 'mixed' || state === 'low') return '#fbbf24';
  if (state === 'mild' || state === 'sparse-easy') return '#fbbf24aa';
  return '#5eead4';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CoachLine({ tabId, setTab }) {
  const storageVersion = useStorageVersion();

  // Compose the narrative against current storage. Same single-tick
  // pipeline the Coach tab uses; cheap to run because each underlying
  // signal computation is memoized inside computeUserState.
  const narrative = useMemo(() => safeCompute('CoachLine:composeNarrative', () => {
    const data = {
      activities:   storage.get('activities')   || [],
      sleep:        storage.get('sleep')        || [],
      hrv:          storage.get('hrv')          || [],
      weight:       storage.get('weight')       || [],
      cronometer:   storage.get('cronometer')   || [],
      nutritionLog: storage.get('nutritionLog') || [],
      wellness:     storage.get('wellness')     || [],
      planner:      storage.get('planner')      || null,
      profile:      { ...(storage.get('profile') || {}), ...getGoals() },
    };
    const us = computeUserState(data);
    return composeNarrative(us);
  }, null), [storageVersion]);

  // Flash effect on recompute — gives the user a visible "Coach just updated"
  // beat when storage changes. Mirrors the Coach tab's "just refreshed"
  // pulse, scaled down for the slimmer line.
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!narrative) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 1500);
    return () => clearTimeout(t);
  }, [narrative]);

  // Don't render on Coach tab — full narrative already lives there.
  if (HIDDEN_TABS.has(tabId)) return null;
  if (!narrative) return null;

  const { leveragePoint, story, alignedFallback } = narrative;

  // Decide visibility based on the targeting map.
  // EdgeIQ always renders; other tabs only when the current leverage's
  // action is actionable on this tab.
  let shouldShow = false;
  if (ALWAYS_ON_TABS.has(tabId)) {
    shouldShow = true;
  } else if (!alignedFallback && leveragePoint?.signalKey) {
    const targets = SIGNAL_ACTIONABLE_ON[leveragePoint.signalKey] || [];
    shouldShow = targets.includes(tabId);
  }
  if (!shouldShow) return null;

  const handleClick = () => {
    if (setTab) setTab('coach_beta');
  };

  return (
    <CoachContextLine
      narrative={narrative}
      onClick={handleClick}
      pulsing={pulsing}
      isAlwaysOn={ALWAYS_ON_TABS.has(tabId)}
    />
  );
}

// ─── Single context line — Phase 4r.narrative.5.fix.1 ──────────────────────
// One subtler render mode replaces the previous v1 ACTION + STATUS modes.
// Visual contract:
//   • NO full-width colored background — reads as supporting context,
//     not as an alert banner.
//   • Thin left-border accent in the state color — small, contained.
//   • Muted text colors except the small COACH label + leverage word.
//   • Compact padding (5px vertical) so it sits under the tab nav without
//     dominating the layout.
//   • Click anywhere → Coach tab. Subtle hover state.
//   • Pulsing dot for 1.5s on recompute (same reactivity feedback as the
//     Coach tab's chip flash).

function CoachContextLine({ narrative, onClick, pulsing, isAlwaysOn }) {
  const { leveragePoint, story, alignedFallback } = narrative;
  const isAligned = alignedFallback || !leveragePoint;
  const color = isAligned ? '#5eead4' : stateColorFor(leveragePoint?.state);

  // Choose the most useful single sentence for this tab.
  // When there's an action sentence (problematic state, not aligned), show it.
  // For aligned state on EdgeIQ, show the macro context headline if present,
  // else a neutral "aligned" note. Keep it ONE sentence — the Coach tab is
  // where the full read lives.
  let body;
  if (!isAligned && story?.action?.text) {
    body = story.action.text;
  } else if (story?.macroContext?.text) {
    body = story.macroContext.text;
  } else if (isAligned) {
    body = 'No leverage signal — system aligned.';
  } else {
    body = `${leveragePoint.label} is the leverage.`;
  }

  // Small leverage tag shown before the body — anchors what the line is about.
  const leverageTag = isAligned ? 'Aligned' : leveragePoint.label;

  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Open Coach for the full read"
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        boxSizing: 'border-box',
        width: '100%',
        // Subtle: thin left border in state color, no full-width tinting.
        borderLeft: `2px solid ${color}`,
        background: hovered ? 'rgba(255,255,255,0.025)' : 'transparent',
        padding: '6px 14px',
        transition: 'background 160ms ease',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 11.5, lineHeight: 1.4,
        color: 'var(--text-secondary)',
      }}>
        {/* COACH label — small, state-colored */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
          color, textTransform: 'uppercase', flexShrink: 0,
        }}>
          {/* State dot that pulses briefly on recompute */}
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: color,
            boxShadow: pulsing ? `0 0 5px ${color}` : 'none',
            transition: 'box-shadow 500ms ease',
          }} aria-hidden="true" />
          Coach
        </span>
        {/* Leverage tag */}
        <span style={{
          color: 'var(--text-secondary)', fontWeight: 600,
          fontSize: 11, flexShrink: 0,
        }}>
          {leverageTag}
        </span>
        {/* The body sentence — allows up to 2 lines on narrow screens
            (Phase 4r.narrative.5.fix.2: user feedback that the message was
            being truncated mid-thought on Plan tab on mobile). Past 2
            lines, ellipsizes via line-clamp. */}
        <span style={{
          color: 'var(--text-secondary)', fontWeight: 400,
          flex: 1, minWidth: 0,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          lineHeight: 1.4,
        }}>
          {body}
        </span>
        {/* Tap-through chevron */}
        <span style={{
          fontSize: 10, color: 'var(--text-muted)',
          opacity: hovered ? 1 : 0.4,
          transition: 'opacity 160ms ease', flexShrink: 0,
        }} aria-hidden="true">↗</span>
      </div>
    </button>
  );
}
