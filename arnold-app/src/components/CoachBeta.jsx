// ─── Coach BETA tab — Phase 4r.coach.v2.surface ───────────────────────────
//
// 2026-05-24. See COACH.md for full v1/v2/v3 spec.
//
// Renders coachBriefs (v2.engine output) as a stack of coach-voice
// blocks. Each block: state badge + acknowledge headline + mechanism
// body + → next action + evidence chips + feedback affordance.
//
// Beta surface — production EdgeIQ is untouched during the 2-3 week
// evaluation period. Feedback is stored locally (no server) so we
// can review what fires (and what should fire and doesn't) before
// promoting to replace the Goal Alignment rail.
//
// Web only for now; mobile follows once the voice is calibrated.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { storage } from '../core/storage.js';
import { getGoals } from '../core/goals.js';
import { computeUserState, synthesizeRecommendations } from '../core/intelligence.js';
import { composeCoachBriefs } from '../core/coachBriefs.js';
import { composeNarrative } from '../core/narrativeComposer.js';
import { tileForSignal } from '../core/narrativeGraph.js';
import { buildTileContext, getMetric, evaluate } from '../core/derive/tileMetrics.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';
import { safeCompute } from '../core/safeCompute.js';

const FEEDBACK_KEY = 'coachFeedback';

const STATE_META = {
  act:     { label: 'ACT',     color: '#f87171', tint: 'rgba(248,113,113,0.08)', icon: '!' },
  watch:   { label: 'WATCH',   color: '#fbbf24', tint: 'rgba(251,191,36,0.07)',  icon: '⚠' },
  aligned: { label: 'ALIGNED', color: '#4ade80', tint: 'rgba(74,222,128,0.06)',  icon: '✓' },
};

function appendFeedback(entry) {
  const existing = storage.get(FEEDBACK_KEY);
  const arr = Array.isArray(existing) ? existing : [];
  arr.push({ ...entry, timestamp: new Date().toISOString() });
  storage.set(FEEDBACK_KEY, arr, { skipValidation: true });
}

function getFeedbackForBrief(briefId) {
  const all = storage.get(FEEDBACK_KEY);
  if (!Array.isArray(all)) return null;
  // Return most recent feedback entry for this brief id
  return [...all].reverse().find(f => f.briefId === briefId) || null;
}

// ─── NarrativeBlock — Phase 4r.narrative.3 ──────────────────────────────────
// Renders the structured narrative object emitted by composeNarrative()
// above the existing brief cards. The story reads top to bottom:
//   1. Leverage headline (only when problematic signals fire)
//   2. Opening paragraph — the leverage chain in prose
//   3. System map placeholder (real SVG lands in Phase 4r.narrative.4)
//   4. Secondary thread paragraphs (0–2)
//   5. Action callout — what to do + which metric to watch
//   6. Macro context — long-arc framing (goal progress + race horizon)
//   7. Personalization callouts — aligned-state learnings (DOW rhythm,
//      surfaceable correlations). Only in the aligned-state path.
//
// The brief cards below this block become the "drill into the signals"
// detail layer. Same data, different scale.

// ─── NarrativeTile — Phase 4r.narrative.4b ──────────────────────────────────
// A compact form of an existing TILE_METRICS tile, embedded inline with the
// narrative. The Coach speaks in the visual language Arnold already has —
// each narrative node carries a `displayTile` reference to the canonical
// tile, and this component renders that tile in a compact size.
//
// `signalKey`: which narrative-graph node this tile represents.
// `tileCtx`: the buildTileContext bundle (shared across all tiles for
//   consistency + perf).
// `state`: the signal's current state, used to drive the accent color.
// `isLeverage`: whether this is the leverage point — gets stronger
//   visual emphasis (filled background, border).
//
// Read-only in this phase (4b). Phase 4c adds tap-to-source-tab navigation.

function NarrativeTile({ signalKey, tileCtx, state, isLeverage, narrativeLabel, narrativeValue, onNavigate }) {
  // Look up which tile represents this signal.
  const mapping = tileForSignal(signalKey);
  // Phase 4r.narrative.4c — hover state for the tappable affordance.
  const [hovered, setHovered] = useState(false);
  // Tile is tappable when (a) a navigation callback was provided AND
  // (b) the catalog declares a source tab for this signal.
  const canNavigate = !!(onNavigate && mapping?.sourceTab);
  const handleClick = canNavigate ? () => onNavigate(mapping.sourceTab) : null;

  // State → accent color (same palette as the BriefBlock state colors).
  const stateColor = (state === 'severe' || state === 'concerning' || state === 'critical')
    ? '#f87171'
    : (state === 'moderate' || state === 'slowing' || state === 'adapting' || state === 'depleted' ||
       state === 'rising' || state === 'grey-zone' || state === 'hot' || state === 'impaired' ||
       state === 'mixed' || state === 'low')
      ? '#fbbf24'
      : (state === 'mild' || state === 'sparse-easy')
        ? '#fbbf24aa'
        : '#5eead4';

  // No tile registered for this signal — render a prose-only placeholder
  // pill so the narrative chain stays visually coherent. Placeholder rows
  // are NEVER tappable (there's no source-tab target since the signal has
  // no canonical home tile yet — Phase 4d filled most of these, but any
  // remaining null mapping renders as inert here).
  if (!mapping) {
    return (
      <div style={{
        flex: '1 1 0', minWidth: 140,
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '12px 14px',
        background: isLeverage ? `${stateColor}1a` : 'rgba(255,255,255,0.03)',
        border: `0.5px solid ${isLeverage ? stateColor : 'rgba(255,255,255,0.10)'}`,
        borderRadius: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: stateColor }} aria-hidden="true" />
          {narrativeLabel}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.05 }}>
          {narrativeValue || '—'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          tile pending
        </div>
      </div>
    );
  }

  // Look up the canonical tile metric and evaluate it against the shared ctx.
  const metric = getMetric(mapping.tileId);
  const result = (tileCtx && metric) ? safeCompute('NarrativeTile:evaluate', () => evaluate(metric, tileCtx), null) : null;

  // Headline value: prefer the tile's `value` (its own formatter), else fall
  // back to the narrative value we already had on the graph node.
  const headline = result?.value != null && result.value !== '' ? result.value : (narrativeValue || '—');
  const sublabel = result?.sublabel || '';
  const unit = metric?.unit || '';
  const avg30 = result?.avg30;

  // Phase 4r.narrative.4c — when tappable, the tile renders as a button:
  // pointer cursor, hover lightens, ↗ glyph appears top-right on hover,
  // and keyboard Enter/Space activates. When NOT tappable (no callback OR
  // no source tab declared), the same DOM but a div with no handlers.
  const baseBg = isLeverage ? `${stateColor}1a` : 'rgba(255,255,255,0.03)';
  const hoverBg = isLeverage ? `${stateColor}2a` : 'rgba(255,255,255,0.06)';
  const interactiveProps = canNavigate ? {
    role: 'button',
    tabIndex: 0,
    onClick: handleClick,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    title: `Open ${metric?.label || narrativeLabel} on ${mapping.sourceTab}`,
  } : {};

  return (
    <div
      {...interactiveProps}
      style={{
        // Phase 4r.narrative.4e (sizing fix) — uniform-width tiles that
        // share the panel evenly. flex:1 distributes available space,
        // minWidth keeps each readable when the chain has many nodes.
        flex: '1 1 0', minWidth: 140,
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '12px 14px',
        background: canNavigate && hovered ? hoverBg : baseBg,
        border: `0.5px solid ${isLeverage ? stateColor : (canNavigate && hovered ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)')}`,
        borderRadius: 6,
        cursor: canNavigate ? 'pointer' : 'default',
        transition: 'background 160ms ease, border-color 160ms ease',
        outline: 'none',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: stateColor }} aria-hidden="true" />
        {metric?.label || narrativeLabel}
      </div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 5,
        fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.05,
      }}>
        <span>{headline}</span>
        {unit && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{unit}</span>}
      </div>
      {(sublabel || avg30 != null) && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {sublabel}
          {sublabel && avg30 != null ? ' · ' : ''}
          {avg30 != null && (
            <span>30d avg <span style={{ color: 'var(--text-secondary)' }}>{avg30}{unit}</span></span>
          )}
        </div>
      )}
      {/* Hover affordance: tiny ↗ glyph in the top-right corner when the
          tile is tappable AND the user is hovering. Subtle — the dot in
          the upper-left is already the state indicator, this ↗ is just
          a "tap takes you somewhere" hint that fades in. */}
      {canNavigate && (
        <span style={{
          position: 'absolute', top: 6, right: 8,
          fontSize: 11, color: 'var(--text-muted)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 160ms ease',
          pointerEvents: 'none',
        }} aria-hidden="true">↗</span>
      )}
    </div>
  );
}

function NarrativeBlock({ narrative, tileCtx, onNavigate }) {
  if (!narrative) return null;
  const { story, leveragePoint, upcomingPlan, goalProgress, alignedFallback } = narrative;
  if (!story) return null;

  const headline = alignedFallback
    ? 'Aligned'
    : leveragePoint?.label
      ? `${leveragePoint.label} is the leverage`
      : 'Today';
  const headlineColor = alignedFallback ? '#4ade80'
    : leveragePoint?.state === 'severe' || leveragePoint?.state === 'concerning' || leveragePoint?.state === 'critical' ? '#f87171'
    : leveragePoint?.state === 'moderate' || leveragePoint?.state === 'slowing' || leveragePoint?.state === 'adapting' || leveragePoint?.state === 'depleted' || leveragePoint?.state === 'rising' || leveragePoint?.state === 'grey-zone' || leveragePoint?.state === 'hot' || leveragePoint?.state === 'impaired' || leveragePoint?.state === 'mixed' || leveragePoint?.state === 'low' ? '#fbbf24'
    : '#5eead4';

  return (
    <div style={{
      padding: '20px 22px',
      background: 'linear-gradient(180deg, rgba(94,234,212,0.04) 0%, rgba(255,255,255,0.015) 100%)',
      border: '0.5px solid rgba(94,234,212,0.18)',
      borderRadius: 10,
      marginBottom: 22,
    }}>

      {/* Headline */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <div style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: headlineColor,
        }}>
          {alignedFallback ? 'No leverage signal' : 'Leverage point'}
        </div>
        <div style={{
          fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.25,
        }}>
          {headline}{leveragePoint?.state && !alignedFallback ? (
            <span style={{ color: headlineColor, fontSize: 12, fontWeight: 500, marginLeft: 8, textTransform: 'lowercase' }}>
              · {leveragePoint.state}
            </span>
          ) : null}
        </div>
      </div>

      {/* Opening paragraph */}
      {story.opening && (
        <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-primary)', marginBottom: 14 }}>
          {story.opening}
        </div>
      )}

      {/* Phase 4r.narrative.4b — inline tile chain. Replaces the pill-row
          placeholder from .3 with actual TILE_METRICS components rendered
          in compact form. The Coach speaks in the visual language Arnold
          already has; each chain node embeds the canonical tile for that
          signal, connected by causal arrows.
          Phase 4r.narrative.4e (sizing fix) — tiles use flex:1 to fill
          the panel width evenly. Container uses nowrap on wide screens,
          falls back to wrap on narrow ones. */}
      {!alignedFallback && narrative.graph?.nodes?.length > 0 && (
        <div style={{
          margin: '10px 0 18px',
          padding: '12px',
          background: 'rgba(0,0,0,0.18)',
          border: '0.5px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch',
        }}>
          {narrative.graph.nodes.map((n, i) => (
            <React.Fragment key={n.signalKey}>
              {i > 0 && (
                <div style={{
                  flex: '0 0 auto',
                  display: 'flex', alignItems: 'center',
                  color: 'var(--text-muted)', fontSize: 14, opacity: 0.6,
                  padding: '0 2px',
                }} aria-hidden="true">→</div>
              )}
              <NarrativeTile
                signalKey={n.signalKey}
                tileCtx={tileCtx}
                state={n.state}
                isLeverage={n.isLeverage}
                narrativeLabel={n.label}
                narrativeValue={n.value}
                onNavigate={onNavigate}
              />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Secondary thread paragraphs */}
      {story.secondaryThreads?.map((t) => (
        <div key={t.threadId} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: 12 }}>
          {t.text}
        </div>
      ))}

      {/* Action callout */}
      {story.action?.text && (
        <div style={{
          marginTop: 14, padding: '12px 14px',
          background: 'rgba(94,234,212,0.06)',
          borderLeft: `2px solid #5eead4`,
          borderRadius: 4,
          fontSize: 13.5, lineHeight: 1.55,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: '#5eead4',
            textTransform: 'uppercase', marginBottom: 4,
          }}>
            Action
          </div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {story.action.text}
          </div>
          {story.action.metricToWatch && (
            <div style={{
              marginTop: 8, paddingTop: 8,
              borderTop: '0.5px solid rgba(94,234,212,0.18)',
              fontSize: 11, color: 'var(--text-secondary)',
              display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline',
            }}>
              <span style={{ color: '#5eead4', fontWeight: 600, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Watch
              </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {story.action.metricToWatch.label}
              </span>
              {story.action.metricToWatch.currentValue && (
                <span style={{ color: 'var(--text-muted)' }}>
                  · {story.action.metricToWatch.currentValue}
                </span>
              )}
              <span style={{ flex: '1 1 100%', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {story.action.metricToWatch.rationale}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Macro context — goal progress + race horizon */}
      {story.macroContext && (
        <div style={{
          marginTop: 14, padding: '10px 14px',
          background: 'rgba(167,139,250,0.05)',
          borderLeft: '2px solid #a78bfa',
          borderRadius: 4,
          fontSize: 12.5, lineHeight: 1.55,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: '#a78bfa',
            textTransform: 'uppercase', marginBottom: 4,
          }}>
            {story.macroContext.headline}
          </div>
          <div style={{ color: 'var(--text-primary)' }}>
            {story.macroContext.text}
          </div>
        </div>
      )}

      {/* Upcoming plan footer — show "today" and "next hard" if planner present */}
      {upcomingPlan && upcomingPlan.status === 'has-plan' && (
        <div style={{
          marginTop: 14, paddingTop: 10,
          borderTop: '0.5px solid rgba(255,255,255,0.07)',
          fontSize: 11, color: 'var(--text-muted)',
          display: 'flex', flexWrap: 'wrap', gap: 14,
        }}>
          {upcomingPlan.todayPlanned && (
            <span>
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Today:</span>{' '}
              {upcomingPlan.todayPlanned.label}
            </span>
          )}
          {upcomingPlan.nextHardSession && upcomingPlan.nextHardSession.daysOut > 0 && (
            <span>
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Next hard:</span>{' '}
              {upcomingPlan.nextHardSession.label} · {upcomingPlan.nextHardSession.dow} (+{upcomingPlan.nextHardSession.daysOut}d)
            </span>
          )}
        </div>
      )}

      {/* Aligned-state callouts (personalization findings) */}
      {alignedFallback && Array.isArray(story.callouts) && story.callouts.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--text-secondary)',
            textTransform: 'uppercase', marginBottom: 8,
          }}>
            What Arnold's learned about you
          </div>
          {story.callouts.map((c, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-primary)', marginBottom: 8 }}>
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BriefBlock({ brief, changedLabels }) {
  const meta = STATE_META[brief.state] || STATE_META.aligned;
  const [fb, setFb] = useState(() => getFeedbackForBrief(brief.id));
  const [comment, setComment] = useState('');
  const [justSent, setJustSent] = useState(false);

  // Phase 4r.signals.10 — per-chip flash. When a chip's value changed
  // since the previous render (parent computes the set), highlight it
  // teal for ~2s then fade back. Uses local state + timeout so each
  // brief's flashes are independent; clearing on unmount is automatic
  // via the cleanup function.
  const [flashing, setFlashing] = useState(() => new Set());
  useEffect(() => {
    if (!changedLabels || changedLabels.size === 0) return;
    setFlashing(new Set(changedLabels));
    const t = setTimeout(() => setFlashing(new Set()), 2000);
    return () => clearTimeout(t);
  }, [changedLabels]);

  // Phase 4r.coach.v2.surface.feedback — the comment field is now
  // always visible (not hidden behind a "this read wrong" link)
  // because the whole point of the beta is to capture observations
  // like "this brief misread my situation" without requiring the
  // user to discover an affordance. User reported on 2026-05-24
  // that the link was too buried.
  const recordFeedback = (verdict, commentText = null) => {
    const entry = {
      briefId: brief.id,
      verdict,
      comment: commentText,
      briefSnapshot: {
        state: brief.state,
        acknowledge: brief.acknowledge,
        mechanism: brief.mechanism,
        nextAction: brief.nextAction,
      },
    };
    appendFeedback(entry);
    setFb(entry);
    if (commentText) {
      setComment('');
      setJustSent(true);
      setTimeout(() => setJustSent(false), 2000);
    }
  };

  const sendComment = () => {
    const text = comment.trim();
    if (!text) return;
    // Default to whatever verdict's already on file, or 'note' if
    // the user is just commenting without thumbing.
    recordFeedback(fb?.verdict || 'note', text);
  };

  return (
    <div style={{
      background: meta.tint,
      border: '0.5px solid var(--border-default)',
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: 8,
      padding: '16px 18px',
      marginBottom: 12,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, marginBottom: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 4,
            background: `${meta.color}22`, color: meta.color,
            fontSize: 12, fontWeight: 800,
          }} aria-hidden>{meta.icon}</span>
          <span style={{
            fontSize: 10, fontWeight: 800,
            color: meta.color, letterSpacing: '0.14em',
          }}>{meta.label}</span>
          {brief.pillarsAffected?.length > 0 && (
            <span style={{
              fontSize: 9, color: 'var(--text-muted)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              marginLeft: 4,
            }}>
              {brief.pillarsAffected.join(' · ')}
            </span>
          )}
        </div>
        <span style={{
          fontSize: 9, color: 'var(--text-muted)',
          fontFamily: 'ui-monospace, monospace',
        }} title={`Pattern: ${brief.id} · priority ${brief.priority} · confidence ${brief.confidence}`}>
          {brief.id}
        </span>
      </div>

      <div style={{
        fontSize: 15, fontWeight: 600,
        color: 'var(--text-primary)',
        lineHeight: 1.4, letterSpacing: '-0.005em',
      }}>
        {brief.acknowledge}
      </div>

      <div style={{
        fontSize: 13, lineHeight: 1.55,
        color: 'var(--text-secondary)',
      }}>
        {brief.mechanism}
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        paddingTop: 8, marginTop: 2,
        borderTop: `0.5px dashed ${meta.color}40`,
      }}>
        <span aria-hidden style={{
          color: meta.color, fontWeight: 800,
          fontSize: 16, lineHeight: 1.3, flexShrink: 0,
        }}>{'→'}</span>
        <span style={{
          fontSize: 13, lineHeight: 1.45,
          color: 'var(--text-primary)', fontWeight: 500,
        }}>{brief.nextAction}</span>
      </div>

      {brief.evidence?.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          paddingTop: 8,
        }}>
          {brief.evidence.map((e, i) => {
            const flash = flashing.has(e.label);
            return (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px',
                fontSize: 10, fontFamily: 'ui-monospace, monospace',
                background: flash ? 'rgba(94,234,212,0.15)' : 'rgba(255,255,255,0.03)',
                border: flash ? '0.5px solid #5eead4' : '0.5px solid rgba(255,255,255,0.08)',
                borderRadius: 3,
                color: flash ? '#5eead4' : 'var(--text-muted)',
                boxShadow: flash ? '0 0 8px rgba(94,234,212,0.3)' : 'none',
                transition: 'background 800ms ease, border-color 800ms ease, color 800ms ease, box-shadow 800ms ease',
              }}>
                <span style={{
                  color: flash ? '#5eead4' : 'var(--text-secondary)',
                  fontWeight: 600,
                  transition: 'color 800ms ease',
                }}>{e.label}</span>
                <span>{e.value}</span>
              </span>
            );
          })}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        paddingTop: 10, marginTop: 4,
        borderTop: '0.5px dashed rgba(255,255,255,0.08)',
        fontSize: 11,
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginRight: 'auto' }}>
          {fb ? (
            <>
              Feedback recorded
              {fb.comment && <span style={{ marginLeft: 6, fontStyle: 'italic', color: 'var(--text-secondary)' }}>· note: "{fb.comment.length > 60 ? fb.comment.slice(0, 60) + '…' : fb.comment}"</span>}
            </>
          ) : 'Was this useful? Comment freely.'}
        </span>
        <button
          type="button"
          onClick={() => recordFeedback('up')}
          aria-label="Mark useful"
          style={{
            all: 'unset', position: 'relative',
            cursor: 'pointer', padding: '2px 8px',
            borderRadius: 4, fontSize: 13,
            background: fb?.verdict === 'up' ? 'rgba(74,222,128,0.18)' : 'transparent',
            color: fb?.verdict === 'up' ? '#4ade80' : 'var(--text-muted)',
            border: '0.5px solid rgba(255,255,255,0.08)',
          }}
        >{'👍'}</button>
        <button
          type="button"
          onClick={() => recordFeedback('down')}
          aria-label="Mark not useful"
          style={{
            all: 'unset', position: 'relative',
            cursor: 'pointer', padding: '2px 8px',
            borderRadius: 4, fontSize: 13,
            background: fb?.verdict === 'down' ? 'rgba(248,113,113,0.18)' : 'transparent',
            color: fb?.verdict === 'down' ? '#f87171' : 'var(--text-muted)',
            border: '0.5px solid rgba(255,255,255,0.08)',
          }}
        >{'👎'}</button>
      </div>

      {/* Always-visible comment field — see Phase 4r.coach.v2.surface.feedback
          notes above. Single-line look, but resizable. Sends on Cmd/Ctrl+Enter
          or via the Send button. Empty placeholder hints at the kind of
          observation we want ("fired wrong", "missed the actual issue", etc.). */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendComment(); }
          }}
          placeholder="Note for Arnold — what's off, missing, or worth knowing about this brief?"
          rows={1}
          style={{
            flex: 1, boxSizing: 'border-box',
            padding: '8px 10px',
            background: 'rgba(0,0,0,0.22)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            fontSize: 12, lineHeight: 1.45,
            fontFamily: "'Inter', system-ui, sans-serif",
            resize: 'vertical', minHeight: 32,
          }}
        />
        <button
          type="button"
          onClick={sendComment}
          disabled={!comment.trim()}
          title="Send note (Cmd/Ctrl+Enter)"
          style={{
            all: 'unset', position: 'relative',
            cursor: comment.trim() ? 'pointer' : 'not-allowed',
            padding: '8px 14px', fontSize: 11, fontWeight: 600,
            background: comment.trim() ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
            color: comment.trim() ? '#60a5fa' : 'var(--text-muted)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            borderRadius: 4, whiteSpace: 'nowrap',
            transition: 'opacity 0.18s',
            opacity: justSent ? 0.5 : 1,
          }}
        >{justSent ? 'Sent ✓' : 'Send'}</button>
      </div>
    </div>
  );
}

// Phase 4r.narrative.4c — translation between the abstract `sourceTab`
// values declared in narrativeGraph (which intentionally use generic names
// like 'trend' or 'daily' that aren't coupled to Arnold's tab-id model)
// and the actual Arnold web tab IDs used by setTab(). Keeps narrativeGraph
// platform-neutral so it can serve a future mobile Coach surface too —
// only this map updates per platform.
//
// Phase 4r.narrative.4c.fix — 'annual' is a LOCAL detail-panel tab inside
// Dashboard, not a top-level tab. setTab('annual') silently landed on
// nothing. The correct destination for longitudinal-tile navigation is
// 'weekly' (Dashboard / EdgeIQ) — that's where signals are grouped by
// pillar and the user finds every tile, customized or not.
const SOURCE_TAB_TO_ARNOLD_TAB = {
  trend:    'weekly',   // EdgeIQ Dashboard — full longitudinal grid per pillar
  daily:    'daily',    // Daily detail view
  start:    'training', // Start cockpit (user's customized tile grid)
  calendar: 'races',    // Calendar tab
  plan:     'goals',    // Plan tab (Goals Hub + planner)
  edgeiq:   'weekly',   // Same as trend; explicit alias for clarity
};

export function CoachBeta({ setTab } = {}) {
  const storageVersion = useStorageVersion();

  // Phase 4r.narrative.4c — onNavigate is passed down to NarrativeBlock →
  // NarrativeTile. Tap on a tile lands on the source tab (annual/daily/etc).
  // When setTab isn't provided (CoachBeta rendered outside the main tab
  // dispatch, e.g., a future preview view), tiles stay read-only.
  const onNavigate = setTab ? (sourceTab) => {
    const arnoldTab = SOURCE_TAB_TO_ARNOLD_TAB[sourceTab] || sourceTab;
    if (!arnoldTab) return;
    setTab(arnoldTab);
  } : null;

  // Phase 4r.signals.9 — track when the briefs were last recomputed so the
  // header can show "as of HH:MM · just refreshed" and the user can see the
  // engine is live. Every storage write bumps storageVersion → useMemo
  // re-runs → lastComputedAt advances to now. No timer needed.
  const [lastComputedAt, setLastComputedAt] = useState(() => Date.now());
  // Phase 4r.narrative.3 — userState is computed once and shared between the
  // narrative composer AND the brief composer. Same storage reads, same
  // tick, guaranteed-consistent view (no risk of one consuming a different
  // version of the data than the other).
  const userState = useMemo(() => safeCompute('CoachBeta:computeUserState', () => {
    const data = {
      activities: storage.get('activities') || [],
      sleep:      storage.get('sleep') || [],
      hrv:        storage.get('hrv') || [],
      weight:     storage.get('weight') || [],
      cronometer: storage.get('cronometer') || [],
      nutritionLog: storage.get('nutritionLog') || [],
      wellness:   storage.get('wellness') || [],
      planner:    storage.get('planner') || null,
      profile:    { ...(storage.get('profile') || {}), ...getGoals() },
    };
    return computeUserState(data);
  }, null), [storageVersion]);

  // Phase 4r.narrative.4b — tileCtx feeds the inline tiles rendered in the
  // narrative. Same source data as the userState above, just shaped for the
  // tile-evaluation pipeline (buildTileContext expects a specific bundle).
  // Built once per recompute, shared with every NarrativeTile.
  //
  // Phase 4r.narrative.4d — additionally pass userState.coachSignals so the
  // new coach-signal tiles (recoveryVelocity, tdeeDrift, energyAvailability,
  // glycogen) can read pre-computed v2 signal values without redoing the
  // math. Same single source of truth the narrative composer uses.
  const tileCtx = useMemo(() => safeCompute('CoachBeta:buildTileContext', () => {
    return buildTileContext({
      activities:   storage.get('activities')   || [],
      sleepData:    storage.get('sleep')        || [],
      hrvData:      storage.get('hrv')          || [],
      weightData:   storage.get('weight')       || [],
      nutritionLog: storage.get('nutritionLog') || [],
      cronometer:   storage.get('cronometer')   || [],
      dailyLogs:    storage.get('dailyLogs')    || [],
      profile:      { ...(storage.get('profile') || {}), ...getGoals() },
      wellness:     storage.get('wellness')     || [],
      races:        storage.get('races')        || [],
      coachSignals: userState?.coachSignals     || null,
    });
  }, null), [storageVersion, userState]);

  const briefs = useMemo(() => safeCompute('CoachBeta:composeBriefs', () => {
    if (!userState) return [];
    const out = composeCoachBriefs(userState, { maxBriefs: 5 });
    // Defer the state update so React doesn't warn about setting state
    // during render. queueMicrotask is enough — we want the timestamp to
    // reflect the same tick the briefs landed in.
    queueMicrotask(() => setLastComputedAt(Date.now()));
    return out;
  }, []), [userState]);

  // Phase 4r.narrative.3 — compose the narrative for the top-of-tab block.
  // Pure transformer; runs in the same render tick as the briefs above.
  const narrative = useMemo(() => safeCompute('CoachBeta:composeNarrative', () => {
    if (!userState) return null;
    return composeNarrative(userState);
  }, null), [userState]);

  // Phase 4r.narrative.5.fix.6 — synthesize the per-pillar action cards used
  // for Today's Status. Same call as TrainingTab makes, same userState the
  // narrative composer above used — so the three Coach blocks (narrative /
  // goal tensions / today's status) all reflect the same tick of data.
  const synthCards = useMemo(() => safeCompute('CoachBeta:synthesize', () => {
    if (!userState) return [];
    return synthesizeRecommendations(userState, { rawInsights: [], rawPrompts: [] }) || [];
  }, []), [userState]);

  // "Just refreshed" flag — true for 2.5s after each recompute so the
  // user sees the pulse, then settles back to a static timestamp.
  const [justRefreshed, setJustRefreshed] = useState(false);
  useEffect(() => {
    setJustRefreshed(true);
    const t = setTimeout(() => setJustRefreshed(false), 2500);
    return () => clearTimeout(t);
  }, [lastComputedAt]);

  // Phase 4r.signals.10 — per-chip change detection. Diff each brief's
  // evidence chips against the previous render. If a chip's value shifted
  // (same label, different value), mark its label as "changed" so the
  // BriefBlock can flash it. Empty Set per brief on first render — no
  // history to compare against.
  const prevBriefsRef = useRef(new Map());
  const changedLabelsByBriefId = useMemo(() => {
    const result = new Map();
    for (const b of (briefs || [])) {
      const prev = prevBriefsRef.current.get(b.id);
      const changed = new Set();
      if (prev) {
        for (const chip of (b.evidence || [])) {
          const prevChip = (prev.evidence || []).find(c => c?.label === chip.label);
          if (prevChip && String(prevChip.value) !== String(chip.value)) {
            changed.add(chip.label);
          }
        }
      }
      result.set(b.id, changed);
    }
    // Update the ref AFTER computing the diff so the next render compares
    // against THIS render's briefs.
    prevBriefsRef.current = new Map((briefs || []).map(b => [b.id, b]));
    return result;
  }, [briefs]);

  const counts = useMemo(() => {
    const c = { act: 0, watch: 0, aligned: 0 };
    for (const b of (briefs || [])) c[b.state] = (c[b.state] || 0) + 1;
    return c;
  }, [briefs]);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const [feedbackCount, setFeedbackCount] = useState(() => {
    const fb = storage.get(FEEDBACK_KEY);
    return Array.isArray(fb) ? fb.length : 0;
  });
  useEffect(() => {
    const t = setInterval(() => {
      const fb = storage.get(FEEDBACK_KEY);
      setFeedbackCount(Array.isArray(fb) ? fb.length : 0);
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 16px' }}>

      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, padding: '14px 16px',
        background: 'rgba(94,234,212,0.04)',
        border: '0.5px solid rgba(94,234,212,0.25)',
        borderRadius: 8, marginBottom: 18,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 9, fontWeight: 800,
              color: '#5eead4', letterSpacing: '0.16em',
              padding: '2px 8px', borderRadius: 3,
              background: 'rgba(94,234,212,0.12)',
            }}>BETA</span>
            <span style={{
              fontSize: 16, fontWeight: 600,
              color: 'var(--text-primary)',
            }}>Coach</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {today}. Arnold reads your sleep, HRV, RHR, energy availability,
            training strain and goal portfolio every time you open this tab,
            and surfaces the highest-leverage observations.
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
            Beta surface during the 2-3 week evaluation. Your thumbs-up / -down /
            free-text feedback is stored locally and used to calibrate the voice.
            EdgeIQ stays unchanged in the meantime.
          </div>
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          fontSize: 10, fontFamily: 'ui-monospace, monospace',
          color: 'var(--text-muted)', textAlign: 'right',
          flexShrink: 0,
        }}>
          <span><span style={{ color: '#f87171', fontWeight: 700 }}>{counts.act}</span> act</span>
          <span><span style={{ color: '#fbbf24', fontWeight: 700 }}>{counts.watch}</span> watch</span>
          <span><span style={{ color: '#4ade80', fontWeight: 700 }}>{counts.aligned}</span> aligned</span>
          <span style={{ marginTop: 4, paddingTop: 4, borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
            {feedbackCount} fb total
          </span>
          {/* Phase 4r.signals.9 — live recompute timestamp. Tells the user
              the brief list reflects this exact moment, not some morning
              snapshot. Bumps every time storage changes (Garmin run lands,
              Cronometer entry saves, weight syncs, etc.). */}
          <span
            title="Briefs recompute on every storage change (Garmin sync, Cronometer entry, weight, manual log). Updates within a tick."
            style={{
              marginTop: 4, paddingTop: 4,
              borderTop: '0.5px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5,
              transition: 'color 600ms ease',
              color: justRefreshed ? '#5eead4' : 'var(--text-muted)',
            }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: justRefreshed ? '#5eead4' : '#5eead488',
              boxShadow: justRefreshed ? '0 0 6px #5eead4' : 'none',
              transition: 'all 600ms ease',
            }} aria-hidden="true" />
            {justRefreshed ? 'just refreshed' : (
              `as of ${new Date(lastComputedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            )}
          </span>
        </div>
      </div>

      {/* Phase 4r.narrative.3 — NarrativeBlock at the top, brief cards become
          the detail drill-down below. The narrative is the story; the
          briefs are the per-signal evidence. Same data, different scale.
          Phase 4r.narrative.4b — pass tileCtx through so NarrativeTile
          can render real TILE_METRICS components inline with the chain.
          Phase 4r.narrative.4c — onNavigate makes the tiles tappable. */}
      <NarrativeBlock narrative={narrative} tileCtx={tileCtx} onNavigate={onNavigate} />

      {/* ─── Phase 4r.narrative.5.fix.6 — Goal Tensions (moved here from EdgeIQ) ─
          Multi-hypothesis synthesis layer: when 2-3 signals compound
          (cut + sleep-debt + stalled scale, cut + race in 7d, etc.) the
          conflict detector surfaces the tension EXPLAINING the trade-off.
          Lives on Coach now because it reads as the synthesis-of-the-
          synthesis — it tells you WHY the narrative says what it says. */}
      {(() => {
        const conflicts = (userState?.goalConflicts || [])
          .filter(c => c.severity === 'concern' || c.severity === 'attention');
        if (!conflicts.length) return null;
        const sev = {
          concern:   { color: '#f87171', label: 'CONCERN', tint: 'rgba(248,113,113,0.08)' },
          attention: { color: '#fbbf24', label: 'WATCH',   tint: 'rgba(251,191,36,0.07)' },
        };
        return (
          <div style={{
            marginTop: 18,
            padding: '14px 16px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.02)',
            border: '0.5px solid var(--border-subtle)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 12,
              fontSize: 10, fontWeight: 700,
              color: 'var(--text-muted)',
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
            }}>
              <span aria-hidden style={{
                width: 14, height: 14, borderRadius: '50%',
                background: 'rgba(248,113,113,0.18)', color: '#f87171',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 800,
              }}>!</span>
              <span>Goal tensions detected</span>
              <span style={{
                marginLeft: 'auto', fontSize: 9, fontWeight: 600,
                color: 'var(--text-muted)', letterSpacing: '0.04em',
              }}>
                {conflicts.length} active
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {conflicts.slice(0, 4).map(c => {
                const s = sev[c.severity] || sev.attention;
                return (
                  <div key={c.id} style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: s.tint,
                    borderLeft: `3px solid ${s.color}`,
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'baseline', gap: 8,
                      fontSize: 9, fontWeight: 700,
                      color: s.color, letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                    }}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 3,
                        background: `${s.color}26`,
                        fontSize: 9, fontWeight: 800,
                      }}>{s.label}</span>
                      <span style={{
                        color: 'var(--text-primary)',
                        fontSize: 12, fontWeight: 600,
                        letterSpacing: '0', textTransform: 'none',
                        lineHeight: 1.3,
                      }}>{c.title}</span>
                    </div>
                    {c.detail && (
                      <div style={{
                        fontSize: 11, color: 'var(--text-muted)',
                        lineHeight: 1.4, paddingLeft: 2,
                      }}>{c.detail}</div>
                    )}
                    {c.recommendation && (
                      <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                        marginTop: 2, paddingLeft: 2,
                        fontSize: 11, color: 'var(--text-secondary)',
                        lineHeight: 1.4,
                      }}>
                        <span aria-hidden style={{ color: s.color, fontWeight: 800 }}>→</span>
                        <span>{c.recommendation}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {conflicts.length > 4 && (
              <div style={{
                marginTop: 6, fontSize: 10,
                color: 'var(--text-muted)', fontStyle: 'italic',
                textAlign: 'center',
              }}>
                +{conflicts.length - 4} more tension{conflicts.length - 4 > 1 ? 's' : ''} not shown
              </div>
            )}
          </div>
        );
      })()}

      {/* ─── Phase 4r.narrative.5.fix.6 — Today's Status (moved here from EdgeIQ) ─
          Day-level operational view: per-pillar one-liner + concrete
          recommendation. Tappable rows route to the pillar's source tab.
          Filtered to exclude pillars already covered by the tension band
          above so the same conflict doesn't appear twice on the same
          screen. */}
      {(() => {
        const cards = synthCards || [];
        if (!cards.length) return null;
        const conflictPillars = new Set(
          (userState?.goalConflicts || [])
            .filter(c => c.severity === 'concern' || c.severity === 'attention')
            .map(c => {
              if (/cortisol|sleep-debt|recovery|hrv|rhr/i.test(c.id)) return 'Recover';
              if (/race|cut-and-race|peak/i.test(c.id))               return 'Goal';
              if (/strength|endurance|cut-and-strength/i.test(c.id))  return 'Goal';
              if (/protein|fuel|cal/i.test(c.id))                     return 'Fuel';
              if (/train|untrained|trained/i.test(c.id))              return 'Train';
              return 'Goal';
            })
        );
        const strip = cards.filter(c => !conflictPillars.has(c.pillar)).slice(0, 4);
        if (!strip.length) return null;

        const sevColor = {
          critical: '#f87171', concern: '#f87171',
          warning:  '#fbbf24', attention: '#fbbf24',
          info:     '#60a5fa',
          positive: '#4ade80',
        };
        const tabFor = (pillar) => {
          if (pillar === 'Fuel')    return 'daily';
          if (pillar === 'Recover') return 'weekly';
          if (pillar === 'Train')   return 'training';
          if (pillar === 'Body')    return 'weekly';
          if (pillar === 'Goal')    return 'goals';
          return 'goals';
        };

        return (
          <div style={{
            marginTop: 14,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.02)',
            border: '0.5px solid var(--border-subtle)',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700,
              color: 'var(--text-muted)',
              letterSpacing: '0.10em', textTransform: 'uppercase',
              marginBottom: 8,
            }}>Today's status</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {strip.map(row => {
                const c = sevColor[row.severity] || '#60a5fa';
                return (
                  <div
                    key={row.key}
                    onClick={() => setTab?.(tabFor(row.pillar))}
                    title={row.detail || ''}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '60px minmax(0, 1fr) minmax(0, 1.4fr)',
                      alignItems: 'center', gap: 12,
                      padding: '6px 10px',
                      borderRadius: 4,
                      background: 'rgba(255,255,255,0.015)',
                      borderLeft: `2px solid ${c}`,
                      cursor: setTab ? 'pointer' : 'default',
                      userSelect: 'none',
                      fontSize: 11,
                    }}
                  >
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 9, fontWeight: 700,
                      color: c, letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}>
                      <span aria-hidden style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: c, flexShrink: 0,
                      }}/>
                      {row.pillar}
                    </span>
                    <span style={{
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{row.title}</span>
                    {row.recommendation ? (
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        color: 'var(--text-secondary)',
                        fontSize: 10.5,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        <span aria-hidden style={{ color: c, fontWeight: 800 }}>→</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.recommendation}
                        </span>
                      </span>
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Brief cards section — "Signal detail" */}
      {(!briefs || briefs.length === 0) ? (
        <div style={{
          padding: '24px', textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 13,
          background: 'rgba(255,255,255,0.02)',
          border: '0.5px dashed rgba(255,255,255,0.12)',
          borderRadius: 8,
        }}>
          No briefs produced. Either the engine threw (check console for
          {' '}<code>[coachBriefs:...] failed:</code> warnings) or your data
          is too thin for any pattern to fire yet. Run{' '}
          <code style={{ color: 'var(--text-secondary)' }}>window.coachBriefsDebug()</code>
          {' '}in console to inspect.
        </div>
      ) : (
        <div>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 10,
            margin: '4px 2px 10px',
            fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Signal detail</span>
            <span style={{ flex: 1, height: 0, borderTop: '0.5px solid rgba(255,255,255,0.08)' }} />
            <span style={{ fontSize: 10 }}>{briefs.length} {briefs.length === 1 ? 'brief' : 'briefs'}</span>
          </div>
          {briefs.map(b => (
            <BriefBlock
              key={b.id}
              brief={b}
              changedLabels={changedLabelsByBriefId.get(b.id) || new Set()}
            />
          ))}
        </div>
      )}

      <div style={{
        marginTop: 24, padding: '10px 14px',
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 6, fontSize: 10,
        color: 'var(--text-muted)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Debug:</strong>{' '}
        <code>window.coachBriefsDebug()</code> prints full briefs;{' '}
        <code>window.coachSignalsDebug()</code> prints the v1 pattern signals;{' '}
        <code>window.intelligenceDebug()</code> prints userState + cards.
        Feedback is stored under storage key <code>{FEEDBACK_KEY}</code>.
      </div>
    </div>
  );
}
