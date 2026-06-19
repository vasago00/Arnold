// ─── Auto-promote scoring + resolver (Phase 4o.autopromote.1) ────────────────
// Tile auto-promotion fills the empty slots on the Start screen with the
// most informative metrics for *right now*. Manual user pins always win;
// auto only claims remaining slots up to the max-4 per category limit.
//
// Goal: surface what needs attention or what the user might miss, without
// silently overriding their explicit selections.
//
// CONTRACT:
//   resolveStartTiles(category, manualPins, registry, ctx)
//     → orderedIds[]  (length 2–4, manual first, then auto-promoted)
//
// Each auto-promoted tile gets a `_autoPromoted: true` marker via the
// `enriched` return shape so the renderer can show a hollow star instead
// of a filled one (and surface the top reason on hover).

import { deriveStatus, statusFromPct } from './tileMetrics.js';

// ── Scoring weights ─────────────────────────────────────────────────────────
// Tunable. Higher = stronger pull toward promotion. Negative = pushes back.
const W = {
  statusRed:        3,
  statusAmber:      1,
  statusGreen:      0,
  statusNeutral:    0,
  recentFlip7d:     2,
  recentFlip30d:    1,
  trendWrongDir:    1,
  coachingMatch:    2,
  sessionRelevance: 1,
  staleData:       -2,    // older than 14 days
};

// Metric categories that map to today's session types.
// Used to bump tiles when they're relevant to what the user did today.
const SESSION_CATEGORY_BUMP = {
  run:      ['run', 'recovery'],          // run sessions touch run + recovery tiles
  strength: ['strength', 'recovery'],
  hyrox:    ['strength', 'recovery'],
  mixed:    ['run', 'strength', 'recovery'],
  rest:     ['recovery', 'body'],         // rest days favor recovery + body composition
};

/**
 * Score a single tile for auto-promotion. Returns a number; higher = more
 * worth surfacing. Pure function — no React, no storage reads.
 *
 * @param {object} metric   — TILE_METRICS entry (id, category, polarity, thresholds, ...)
 * @param {object} tf       — output of metric.timeframes(ctx) — { week, eightWk, weeklyHistory, ... }
 * @param {object} computed — output of metric.compute(ctx) — { value, sublabel, ... } or null
 * @param {object} promoCtx — { sessionType, activePrompts, today }
 * @returns {{ score:number, reasons:string[] }}
 */
export function scoreTile(metric, tf, computed, promoCtx = {}) {
  const reasons = [];
  let score = 0;

  // ── 0. Log-dependent gate (Phase 4q.autopromote.5) ──
  // Nutrition tiles (fuel: carbs/protein/calories/fiber; quality: micros)
  // depend on the user logging meals throughout the day. In the morning
  // before anything's been eaten, today's value is null/0 — but the
  // weekly average might be flagged amber/red and would otherwise cause
  // these tiles to auto-promote with "needs attention" framing. That's
  // misleading: there's nothing to attend to until data starts flowing.
  // So: if a log-dependent tile has no data for today, don't promote it.
  // Once the user logs breakfast/lunch and a value appears, the regular
  // weekly-average evaluation kicks back in.
  if (metric?.subgroup === 'fuel' || metric?.subgroup === 'quality') {
    const todayValue = computed?.value;
    if (todayValue == null || todayValue === 0) {
      return { score: 0, reasons: ['no data logged today yet'] };
    }
  }

  // ── 1. Status severity (current week) ──
  const currentValue = tf?.week ?? computed?.value ?? null;
  const status = (currentValue != null && metric?.thresholds)
    ? deriveStatus(currentValue, metric.thresholds)
    : 'neutral';
  if (status === 'red')        { score += W.statusRed;     reasons.push('status: needs attention'); }
  else if (status === 'amber') { score += W.statusAmber;   reasons.push('status: monitor'); }
  else if (status === 'green') { score += W.statusGreen; }
  else                          { score += W.statusNeutral; }

  // ── 2. Recency of status flip ──
  // Walk weeklyHistory backwards; find when status last differed from current.
  // Closer = stronger signal that this metric just moved.
  const history = tf?.weeklyHistory || [];
  if (history.length >= 2 && metric?.thresholds && status !== 'neutral') {
    let weeksSinceFlip = null;
    for (let i = history.length - 2; i >= 0; i--) {
      const v = history[i];
      if (v == null || !Number.isFinite(v)) continue;
      const s = deriveStatus(v, metric.thresholds);
      if (s !== status) {
        weeksSinceFlip = (history.length - 1) - i;
        break;
      }
    }
    if (weeksSinceFlip != null) {
      if (weeksSinceFlip <= 1)      { score += W.recentFlip7d;  reasons.push('flipped this week'); }
      else if (weeksSinceFlip <= 4) { score += W.recentFlip30d; reasons.push(`flipped ${weeksSinceFlip} wks ago`); }
    }
  }

  // ── 3. Trajectory wrong-direction ──
  // Polarity tells us which direction is "good". If trending the wrong way
  // (3+ consecutive moves), that's a watch-this signal.
  if (history.length >= 4 && metric?.polarity && metric.polarity !== 'neutral') {
    const recent = history.slice(-4).filter(v => v != null && Number.isFinite(v));
    if (recent.length >= 3) {
      const wantHigher = metric.polarity === 'higher-better';
      let wrongMoves = 0;
      for (let i = 1; i < recent.length; i++) {
        const delta = recent[i] - recent[i-1];
        if (wantHigher && delta < 0) wrongMoves++;
        else if (!wantHigher && delta > 0) wrongMoves++;
      }
      if (wrongMoves >= recent.length - 1 - 1) { // mostly wrong direction
        score += W.trendWrongDir;
        reasons.push(`trending ${wantHigher ? 'down' : 'up'}`);
      }
    }
  }

  // ── 4. Coaching prompt alignment ──
  // If a coaching prompt is currently flagging this metric's pillar, the
  // user is going to want to see it. metric.category usually maps directly
  // to pillar; some metrics carry their own pillar tag.
  const prompts = promoCtx.activePrompts || [];
  const metricPillar = metric.pillar || metric.category;
  if (prompts.some(p => p.pillar === metricPillar || p.metricId === metric.id)) {
    score += W.coachingMatch;
    reasons.push('flagged by coaching');
  }

  // ── 5. Today's session relevance ──
  const sessionBump = SESSION_CATEGORY_BUMP[promoCtx.sessionType] || [];
  if (sessionBump.includes(metric.category)) {
    score += W.sessionRelevance;
    reasons.push(`relevant to today's ${promoCtx.sessionType}`);
  }

  // ── 6. Freshness penalty ──
  // If the last sample is older than 14 days, the tile won't say much
  // useful — push it back so we don't surface stale numbers.
  const latestDate = tf?.latestSample?.date || computed?.sublabel || null;
  if (latestDate && promoCtx.today) {
    try {
      const ageDays = Math.round(
        (new Date(promoCtx.today + 'T12:00:00').getTime() -
         new Date(latestDate + 'T12:00:00').getTime()) / 86_400_000
      );
      if (ageDays > 14) {
        score += W.staleData;
        reasons.push(`stale (${ageDays}d old)`);
      }
    } catch {}
  }

  return { score, reasons };
}

/**
 * Resolve the final ordered tile list for a given category. Manual pins
 * keep their order; auto-promoted tiles fill remaining slots, sorted by
 * descending score, with stable ID-based tiebreakers.
 *
 * @param {string} category — 'run' | 'strength' | 'recovery' | 'body'
 * @param {string[]} manualPins — user's starred tile ids for this category
 * @param {Array}  registry — TILE_METRICS array (or filtered subset for category)
 * @param {object} ctx — { tileCtx, sessionType, activePrompts, today, maxSlots? }
 * @returns {{ id:string, source:'manual'|'auto', score?:number, reasons?:string[] }[]}
 */
export function resolveStartTiles(category, manualPins, registry, ctx = {}) {
  const maxSlots = ctx.maxSlots || 4;
  const result = [];
  const claimed = new Set();

  // 1. Honor manual pins first, in their original order.
  for (const id of (manualPins || [])) {
    if (claimed.has(id)) continue;
    const metric = registry.find(m => m.id === id && m.category === category);
    if (!metric) continue;
    result.push({ id, source: 'manual' });
    claimed.add(id);
    if (result.length >= maxSlots) return result;
  }

  // 2. Score every other tile in this category, take the top N.
  // The scorer is injectable (ctx.scoreFn): the Start screen passes the HUB scorer
  // (core/hub/promote.js) so the Intelligence Hub fully owns auto-promotion; the
  // legacy heuristic scoreTile is the default fallback when no hub scorer is given.
  const scoreFn = typeof ctx.scoreFn === 'function' ? ctx.scoreFn : scoreTile;
  const candidates = registry
    .filter(m => m.category === category && !claimed.has(m.id))
    .map(m => {
      let tf = null, computed = null;
      try { tf = m.timeframes?.(ctx.tileCtx) || null; } catch {}
      try { computed = m.compute?.(ctx.tileCtx) || null; } catch {}
      const { score, reasons } = scoreFn(m, tf, computed, ctx);
      return { metric: m, score, reasons };
    })
    // Filter out candidates with no value at all — can't promote a metric
    // we have no data for. Keeps the cold-start UX clean.
    .filter(c => c.score > 0 || (c.metric.compute && c.metric.compute(ctx.tileCtx)?.value != null));

  // Stable sort: score desc, then id asc as tiebreaker so renders don't flip.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.metric.id.localeCompare(b.metric.id);
  });

  // 3. Fill remaining slots.
  const slotsLeft = maxSlots - result.length;
  for (let i = 0; i < Math.min(slotsLeft, candidates.length); i++) {
    const c = candidates[i];
    result.push({
      id:      c.metric.id,
      source:  'auto',
      score:   c.score,
      reasons: c.reasons,
    });
  }

  return result;
}

/**
 * Resolve all four categories at once. Convenience wrapper for the Start
 * screen and the Trend tab — they both consume per-category id lists.
 *
 * @param {object} prefs    — { run:[], strength:[], recovery:[], body:[] } (manual pins)
 * @param {Array}  registry — TILE_METRICS
 * @param {object} ctx      — see resolveStartTiles
 * @returns {{ [category]: Array<{id, source, score?, reasons?}> }}
 */
export function resolveAllStartTiles(prefs, registry, ctx = {}) {
  const out = {};
  for (const cat of ['run', 'strength', 'recovery', 'body']) {
    out[cat] = resolveStartTiles(cat, prefs?.[cat] || [], registry, ctx);
  }
  return out;
}
