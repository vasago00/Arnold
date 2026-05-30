// ─── ARNOLD Narrative Composer ──────────────────────────────────────────────
//
// Phase 4r.narrative.2 (2026-05-25). Takes a userState snapshot and emits a
// structured narrative object the Coach tab UI will render.
//
// What it does, end to end:
//   1. Filter signals to those in problematic states (via NARRATIVE_NODES).
//   2. Score each as a leverage candidate: severity × (1 + #downstream
//      problematic signals it sits upstream of). Tiebreak by time-to-impact.
//   3. Walk the leverage point's downstream chain through the causal graph
//      to find the connected signals that ARE problematic.
//   4. Compose the opening paragraph by stitching leverage.selfSentence
//      with causalConnector chains through the active downstream nodes.
//   5. Compose secondary-thread paragraphs for other problematic clusters
//      not in the main leverage chain.
//   6. Compose the action paragraph from leverage.actionSentence +
//      metricToWatch.
//   7. Build the graph payload (nodes + edges + leverageKey) for the
//      system-map SVG.
//   8. If NO problematic signals fire, return the aligned-state narrative
//      — names what's working + surfaces a personalization callout if
//      one is available.
//
// Pure transformer. No storage reads. Composes in milliseconds against the
// already-computed userState. Exposed as window.narrativeDebug() for
// inspection during development.

import {
  NARRATIVE_NODES,
  NARRATIVE_EDGES,
  NARRATIVE_THREADS,
  TIME_TO_IMPACT_RANK,
  downstreamChain,
  edgesAmong,
  getNode,
  eachNode,
} from './narrativeGraph.js';
// Phase 4r.utc.2 — local-timezone day. Replaces UTC fallbacks in this file.
import { localDate } from './time.js';

// ─── Punctuation helpers ────────────────────────────────────────────────────
// The composer joins sentence fragments. These helpers handle the
// "sentence vs continuing-clause" distinction so we don't end up with
// "Sleep debt is moderate. That's pulled HRV down — That's the leverage."

function stitch(self, connectors) {
  // self ends with "." (it's a full sentence). connectors are continuing
  // clauses that should chain off the prior thought without re-starting
  // a sentence each time. We trim the trailing period on `self` only
  // if there's at least one connector to chain.
  if (!connectors || connectors.length === 0) return self;
  const base = String(self).replace(/\.\s*$/, '');
  const chain = connectors.join(', ');
  return `${base}. ${chain}.`;
}

// ─── Problematic signal discovery ───────────────────────────────────────────

function findProblematicSignals(coachSignals) {
  const out = [];
  for (const [key, node] of eachNode()) {
    const state = node.getState(coachSignals);
    if (state === 'unknown' || state == null) continue;
    if (!node.isProblematic(state)) continue;
    out.push({
      key,
      state,
      severity: node.severity(state),
      timeToImpactRank: TIME_TO_IMPACT_RANK[node.timeToImpact] ?? 99,
    });
  }
  return out;
}

// ─── Leverage scoring ───────────────────────────────────────────────────────

function scoreLeverage(candidate, allProblematic) {
  // Count how many downstream signals are themselves problematic. We use
  // a 3-hop walk because chains rarely go deeper in practice and we want
  // upstream signals (sleep, fuel) to score over short-tail downstream
  // signals (recovery velocity).
  const chain = downstreamChain(candidate.key, 3);
  const problematicKeys = new Set(allProblematic.map(p => p.key));
  const downstreamProblematic = chain.slice(1).filter(k => problematicKeys.has(k)).length;
  // Score: severity weighted by downstream impact. The +1 ensures a
  // standalone severe signal can still win over a mild signal with one
  // downstream effect.
  return candidate.severity * (1 + downstreamProblematic);
}

function pickLeverage(problematic) {
  if (!problematic.length) return null;
  const scored = problematic.map(p => ({ ...p, score: scoreLeverage(p, problematic) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;          // higher score wins
    if (a.timeToImpactRank !== b.timeToImpactRank) {
      return a.timeToImpactRank - b.timeToImpactRank;            // sooner-to-act wins
    }
    return b.severity - a.severity;                              // higher severity wins
  });
  return scored[0];
}

// ─── Active chain extraction ────────────────────────────────────────────────

function activeChainFor(leverageKey, problematic) {
  // Walk downstream from the leverage and keep only signals that are
  // themselves problematic. Maintains traversal order so connectors
  // chain in causally-meaningful sequence.
  const fullChain = downstreamChain(leverageKey, 3);
  const problematicKeys = new Set(problematic.map(p => p.key));
  return [leverageKey, ...fullChain.slice(1).filter(k => problematicKeys.has(k))];
}

// ─── Opening paragraph composition ──────────────────────────────────────────

function composeLeverageParagraph(leverage, activeChain, coachSignals) {
  const leverageNode = getNode(leverage.key);
  if (!leverageNode) return null;

  const self = leverageNode.selfSentence(coachSignals);
  if (!self) return null;

  // Walk the active chain — each step produces a connector from the
  // prior node to the next.
  const connectors = [];
  for (let i = 1; i < activeChain.length; i++) {
    const priorKey = activeChain[i - 1];
    const downKey  = activeChain[i];
    const priorNode = getNode(priorKey);
    if (!priorNode) continue;
    const connector = priorNode.causalConnector(downKey, coachSignals);
    if (connector) connectors.push(connector);
  }

  return stitch(self, connectors);
}

// ─── Secondary thread paragraphs ────────────────────────────────────────────

function composeSecondaryThreads(problematic, leverageKey, activeChain, coachSignals) {
  // A "secondary thread" is a cluster of problematic signals that aren't
  // already covered by the leverage chain. Group them by threadId via
  // the edges they participate in; if they share no edges with the main
  // chain, surface them as a separate paragraph.
  const chainSet = new Set(activeChain);
  const remaining = problematic.filter(p => !chainSet.has(p.key));
  if (!remaining.length) return [];

  // Group remaining problematic signals by their participating threads.
  const byThread = new Map(); // threadId -> Set<signalKey>
  for (const p of remaining) {
    const edges = NARRATIVE_EDGES.filter(e => e.from === p.key || e.to === p.key);
    for (const e of edges) {
      // Skip threads where the leverage chain already dominates.
      if (e.from === leverageKey || e.to === leverageKey) continue;
      if (chainSet.has(e.from) && chainSet.has(e.to)) continue;
      const set = byThread.get(e.threadId) || new Set();
      set.add(p.key);
      byThread.set(e.threadId, set);
    }
    // If the signal participates in no edges at all, place it under its
    // pillar-derived implicit thread (rare; usually means an isolated node).
    if (!edges.length) {
      const set = byThread.get('orphan') || new Set();
      set.add(p.key);
      byThread.set('orphan', set);
    }
  }

  // Compose at most 2 secondary thread paragraphs — more than that and the
  // narrative starts to read like a list again.
  const paragraphs = [];
  let idx = 0;
  for (const [threadId, signalSet] of byThread) {
    if (paragraphs.length >= 2) break;
    const threadMeta = NARRATIVE_THREADS[threadId];
    const signalKeys = [...signalSet];
    // Sort by severity desc so the most pressing signal leads.
    signalKeys.sort((a, b) => {
      const sa = problematic.find(p => p.key === a)?.severity || 0;
      const sb = problematic.find(p => p.key === b)?.severity || 0;
      return sb - sa;
    });
    const sentences = [];
    for (const key of signalKeys.slice(0, 2)) {
      const node = getNode(key);
      if (!node) continue;
      const s = node.selfSentence(coachSignals);
      if (s) sentences.push(s);
    }
    if (!sentences.length) continue;
    const opener = idx === 0
      ? `The second thread is ${threadMeta?.label?.toLowerCase() || 'another lane'}.`
      : `Also active: ${threadMeta?.label?.toLowerCase() || 'a third lane'}.`;
    paragraphs.push({
      threadId,
      threadLabel: threadMeta?.label || 'Other',
      text: `${opener} ${sentences.join(' ')}`,
      signalKeys,
    });
    idx++;
  }
  return paragraphs;
}

// ─── Macro context (Phase 4r.narrative.2.3) ────────────────────────────────
// The third paragraph slot. Frames the micro story inside the long-term
// goal arc. Renders below the action paragraph. Always optional — when
// no goal is set or progress is on-pace + uninteresting, this returns null
// and the UI drops the slot.
//
// The point of this paragraph is to remind the user WHY today's leverage
// matters: "this sleep call is more or less urgent depending on how much
// runway you have to your goal."

// Phase 4r.narrative.2.4 — synthesize the goal-progress paragraph with the
// race-horizon phase information. The two macro signals share one paragraph
// rather than each taking a slot: the user wants ONE long-arc story, not
// two competing ones.
function composeMacroContext(coachSignals, leveragePoint) {
  const gp = coachSignals?.goalProgress;
  const rh = coachSignals?.raceHorizon;
  const hasGoal = gp && gp.status !== 'no-goal' && gp.status !== 'insufficient';
  const hasRace = rh && rh.status !== 'general';
  // Either both, just goal, just race — but never neither.
  if (!hasGoal && !hasRace) return null;
  // Race-week / taper override: the race becomes the dominant frame even
  // if a goal is in flight, because the timeline forces it.
  if (hasRace && (rh.phase === 'race-week' || rh.phase === 'recovery')) {
    return composeRaceDominantMacro(rh, gp, leveragePoint);
  }
  // If both are active, render a merged paragraph. If only one, fall back
  // to the single-signal composers.
  if (hasGoal && hasRace) {
    return composeMergedMacro(gp, rh, leveragePoint);
  }
  if (hasGoal) {
    return composeGoalOnlyMacro(gp, leveragePoint);
  }
  return composeRaceOnlyMacro(rh, leveragePoint);
}

// Race-week or recovery: race owns the macro frame, goal is a footnote.
function composeRaceDominantMacro(rh, gp, leveragePoint) {
  if (rh.phase === 'race-week') {
    const cutWarning = rh.phaseConflict === 'cut-vs-race-week'
      ? ` You're still mid-cut — pause the deficit, eat at maintenance until race day. Glycogen + sleep are worth more than the half-pound this week.`
      : '';
    return {
      headline: `${rh.race?.name || 'Race'} is in ${rh.daysOut} days`,
      text: `Race week. Volume is low, intensity is short and sharp, sleep + glycogen are the leverage points.${cutWarning} Today's micro story matters more than usual — anything that compresses recovery now shows up at the start line.`,
      goalKind: gp?.goalKind || null,
      phase: rh.phase,
      phaseLabel: rh.phaseLabel,
      race: rh.race,
      daysOut: rh.daysOut,
    };
  }
  // recovery phase
  const daysAgo = Math.abs(rh.daysOut);
  return {
    headline: `Recovering from ${rh.race?.name || 'race'}`,
    text: `${daysAgo} days post-race. Capacity returns over 2-3 weeks — sleep, easy aerobic work, gradual return to intensity. Don't restart a deficit yet; refueling glycogen + soft-tissue repair are the priority.`,
    phase: rh.phase,
    phaseLabel: rh.phaseLabel,
    race: rh.race,
    daysOut: rh.daysOut,
  };
}

// Both signals active — most common case for race-prep runners.
function composeMergedMacro(gp, rh, leveragePoint) {
  const goalPart = goalPhrase(gp);
  const phasePart = racePhrase(rh);
  const conflictPart = rh.phaseConflict === 'cut-vs-taper'
    ? ` Cut + taper overlap is the trade-off this period — keep the deficit gentle (≤300 kcal/day), prioritize protein, plan a maintenance shift the week before race day.`
    : '';
  return {
    headline: `${rh.phaseLabel} phase · ${gp.status === 'on-pace' ? 'on-pace cut' : gp.status === 'stalled' ? 'cut stalled' : gp.status === 'behind' ? 'cut behind' : gp.status === 'ahead' ? 'cut ahead' : 'goal in flight'}`,
    text: `${goalPart} ${phasePart}${conflictPart}`,
    goalKind: gp.goalKind,
    remainingLbs: gp.remainingLbs,
    paceRatio: gp.paceRatio,
    phase: rh.phase,
    phaseLabel: rh.phaseLabel,
    race: rh.race,
    daysOut: rh.daysOut,
    phaseConflict: rh.phaseConflict,
  };
}

function composeGoalOnlyMacro(gp, leveragePoint) {
  if (gp.status === 'achieved') {
    return {
      headline: 'Goal achieved',
      text: `You're within ${(gp.remainingLbs || 0).toFixed(1)} lb of your target weight (${gp.targetLbs} lb). The cut window can close — transition to maintenance over the next 1-2 weeks, then set the next outcome.`,
      goalKind: gp.goalKind, remainingLbs: gp.remainingLbs,
    };
  }
  if (gp.status === 'stalled') {
    const moveDirection = gp.actualRatePerWeek > 0 ? 'losing too slowly' : (gp.actualRatePerWeek < 0 ? 'moving wrong direction' : 'flat');
    return {
      headline: 'Cut has stalled',
      text: `${gp.remainingLbs} lb to target but the last ${gp.weeksSpanned} weeks have been ${moveDirection} (${gp.progressRatePerWeek > 0 ? '+' : ''}${gp.progressRatePerWeek.toFixed(2)} lb/wk vs ${gp.requiredRatePerWeek} lb/wk plan). ${leveragePoint?.signalKey ? `Today's leverage point — ${leveragePoint.label} — is likely part of why.` : 'Look upstream: TDEE drift, energy availability, or undersleep are the usual culprits.'}`,
      goalKind: gp.goalKind, remainingLbs: gp.remainingLbs, paceRatio: gp.paceRatio,
    };
  }
  if (gp.status === 'behind') {
    return {
      headline: 'Slightly behind pace',
      text: `${gp.remainingLbs} lb to target at ${gp.progressRatePerWeek.toFixed(2)} lb/wk. At this rate you'll arrive in ${gp.weeksToGoalAtActualRate} weeks vs the ${gp.weeksToGoalAtRequiredRate}-week plan. Not a fire — but today's leverage point matters more than it would on-pace, because the runway is shorter than budgeted.`,
      goalKind: gp.goalKind, remainingLbs: gp.remainingLbs, paceRatio: gp.paceRatio,
    };
  }
  if (gp.status === 'ahead') {
    return {
      headline: 'Ahead of pace',
      text: `${gp.remainingLbs} lb to target at ${gp.progressRatePerWeek.toFixed(2)} lb/wk vs ${gp.requiredRatePerWeek} lb/wk plan. ${gp.weeksToGoalAtActualRate} weeks at this rate. Watch for adaptation signals — going faster than plan often means a steeper TDEE drop is coming.`,
      goalKind: gp.goalKind, remainingLbs: gp.remainingLbs, paceRatio: gp.paceRatio,
    };
  }
  if (gp.status === 'on-pace') {
    return {
      headline: 'On pace',
      text: `${gp.remainingLbs} lb to target at ${gp.progressRatePerWeek.toFixed(2)} lb/wk — right in the band. ${gp.weeksToGoalAtActualRate} weeks at this rate (plan: ${gp.weeksToGoalAtRequiredRate} weeks).`,
      goalKind: gp.goalKind, remainingLbs: gp.remainingLbs, paceRatio: gp.paceRatio,
    };
  }
  return null;
}

function composeRaceOnlyMacro(rh, leveragePoint) {
  return {
    headline: `${rh.phaseLabel} phase`,
    text: `${racePhrase(rh)} ${phaseGuidance(rh.phase)}`,
    phase: rh.phase, phaseLabel: rh.phaseLabel, race: rh.race, daysOut: rh.daysOut,
  };
}

// Short phrases reused by the merged composer.
function goalPhrase(gp) {
  if (gp.status === 'achieved')  return `Goal achieved — within ${(gp.remainingLbs || 0).toFixed(1)} lb of target.`;
  if (gp.status === 'stalled')   return `Cut has stalled: ${gp.remainingLbs} lb to target, ${gp.progressRatePerWeek > 0 ? '+' : ''}${gp.progressRatePerWeek.toFixed(2)} lb/wk over ${gp.weeksSpanned} weeks vs ${gp.requiredRatePerWeek} lb/wk plan.`;
  if (gp.status === 'behind')    return `${gp.remainingLbs} lb to target, ${gp.progressRatePerWeek.toFixed(2)} lb/wk — slightly behind pace.`;
  if (gp.status === 'ahead')     return `${gp.remainingLbs} lb to target, ${gp.progressRatePerWeek.toFixed(2)} lb/wk — ahead of plan.`;
  if (gp.status === 'on-pace')   return `${gp.remainingLbs} lb to target, on pace at ${gp.progressRatePerWeek.toFixed(2)} lb/wk.`;
  return '';
}
function racePhrase(rh) {
  const name = rh.race?.name || 'Race';
  if (rh.daysOut == null) return '';
  return `${name} in ${rh.daysOut} days (${rh.phaseLabel.toLowerCase()} phase).`;
}
function phaseGuidance(phase) {
  if (phase === 'base')  return 'Volume up, intensity moderate — building the aerobic engine. Z3 dominance is more costly later than now.';
  if (phase === 'build') return 'Race-specific intensity is the focus. Keep volume sustained, sharpen the top end.';
  if (phase === 'peak')  return 'Race-pace work, sharpening. Volume starts trending down; intensity stays.';
  if (phase === 'taper') return 'Volume drops 30-50%, intensity stays. Sleep + recovery start dominating the leverage picture.';
  return '';
}

// ─── Action paragraph ───────────────────────────────────────────────────────

function composeActionParagraph(leverage, coachSignals) {
  const node = getNode(leverage.key);
  if (!node) return null;
  const action = node.actionSentence(coachSignals);
  if (!action) return null;
  const metric = node.metricToWatch ? node.metricToWatch(coachSignals) : null;

  // Phase 4r.narrative.2.2 — splice in upcoming-plan context. If a hard
  // session lands today/tomorrow AND the leverage point would meaningfully
  // collide with it, name the collision explicitly so the user sees the
  // trade-off rather than just the recommendation.
  const planContext = upcomingPlanContextFor(leverage.key, coachSignals);
  const text = planContext ? `${planContext} ${action}` : action;

  return { text, metricToWatch: metric || null };
}

// Decide whether the leverage point's action should be prefixed with a
// note about an upcoming session. Returns a leading sentence or null.
function upcomingPlanContextFor(leverageKey, cs) {
  const up = cs?.upcomingPlan;
  if (!up || up.status !== 'has-plan') return null;
  const today    = up.next7Days?.[0];
  const tomorrow = up.next7Days?.[1];
  const next     = up.nextHardSession;
  if (!next) return null;

  // Phase 4r.narrative.5.fix.18 — `done` flag lives on each next7Days[i]
  // and tells us if the planned session was completed. When today's hard
  // session is DONE the framing flips from "do this" → "this added to
  // the load" so the Coach doesn't keep nagging about a session the user
  // has already finished.
  const todayDone    = today    && today.done    === true;
  const tomorrowDone = tomorrow && tomorrow.done === true; // rare but possible if logged early

  // Map leverage keys to phrasing tuned for their context.
  if (leverageKey === 'glycogen') {
    if (next.daysOut === 0 && next.done === true) return `Today's ${next.label.toLowerCase()} is done — focus is on refilling now.`;
    if (next.daysOut === 0)  return `You have ${next.label.toLowerCase()} on the plan today.`;
    if (next.daysOut === 1)  return `You have ${next.label.toLowerCase()} planned tomorrow.`;
    if (next.daysOut <= 3)   return `You have ${next.label.toLowerCase()} planned in ${next.daysOut} days.`;
    return null;
  }
  if (leverageKey === 'sleepDebt' || leverageKey === 'sleepQuality') {
    if (tomorrow?.intensityClass === 'hard' && !tomorrowDone) return `Tomorrow is ${tomorrow.label.toLowerCase()} on the plan — recovery tonight matters more than usual.`;
    // Today's hard session DONE: past-tense, recovery-leaning framing.
    if (today?.intensityClass    === 'hard' && todayDone)     return `Today's ${today.label.toLowerCase()} is logged — sleep debt is still the leverage; tonight's recovery is what matters now.`;
    if (today?.intensityClass    === 'hard')                   return `Today is ${today.label.toLowerCase()} on the plan, which compounds the issue.`;
    return null;
  }
  if (leverageKey === 'hrvDepression' || leverageKey === 'rhrDrift' || leverageKey === 'recoveryVelocity') {
    if (tomorrow?.intensityClass === 'hard' && !tomorrowDone) return `${tomorrow.label} is planned for tomorrow.`;
    if (today?.intensityClass    === 'hard' && todayDone)     return `Today's ${today.label.toLowerCase()} is logged — recovery from here is the focus.`;
    if (today?.intensityClass    === 'hard')                   return `${today.label} is on today's plan.`;
    if (next.daysOut <= 3)                                     return `Next hard session: ${next.label.toLowerCase()} on ${next.dow} (+${next.daysOut}d).`;
    return null;
  }
  if (leverageKey === 'tdeeDrift' || leverageKey === 'energyAvailability') {
    if (next.daysOut <= 2)   return `${next.label} is planned ${next.daysOut === 0 ? 'today' : next.daysOut === 1 ? 'tomorrow' : `in ${next.daysOut} days`}, so fuel decisions matter more this week.`;
    return null;
  }
  if (leverageKey === 'polarization' || leverageKey === 'monotonyStrain') {
    if (next.daysOut <= 1)   return `${next.label} is planned ${next.daysOut === 0 ? 'today' : 'tomorrow'} — the schedule shift can start there.`;
    return null;
  }
  return null;
}

// ─── Graph payload for visualization ────────────────────────────────────────

function buildVisualizationGraph(leverageKey, activeChain, secondaryParagraphs, coachSignals) {
  // Collect all signal keys we want represented in the visualization:
  // the active chain plus the top signal from each secondary thread.
  const keys = new Set(activeChain);
  for (const p of secondaryParagraphs) {
    if (p.signalKeys?.[0]) keys.add(p.signalKeys[0]);
  }
  const nodes = [];
  for (const key of keys) {
    const node = getNode(key);
    if (!node) continue;
    const state = node.getState(coachSignals);
    nodes.push({
      signalKey: key,
      label: node.label,
      state,
      pillar: node.pillar,
      value: extractDisplayValue(key, coachSignals),
      isLeverage: key === leverageKey,
    });
  }
  // Edges among the nodes we're showing.
  const edges = edgesAmong([...keys]).map(e => ({
    from: e.from,
    to: e.to,
    threadId: e.threadId,
    strength: e.strength,
  }));
  return { nodes, edges, leverageKey };
}

// Compact "headline value" for each signal type — used in the SVG pills
// and as the metric-to-watch currentValue when available.
function extractDisplayValue(signalKey, coachSignals) {
  const cs = coachSignals || {};
  switch (signalKey) {
    case 'sleepDebt': {
      const d = cs.sleepDebt;
      return d?.debt7d != null ? `${d.debt7d.toFixed(1)}h debt` : null;
    }
    case 'hrvDepression': {
      const h = cs.hrvDepression;
      if (!h) return null;
      if (h.latest != null && h.depressionMs != null && h.depressionMs > 0) {
        return `${Math.round(h.latest)}ms (-${Math.round(h.depressionMs)})`;
      }
      return h.latest != null ? `${Math.round(h.latest)}ms` : null;
    }
    case 'rhrDrift': {
      const r = cs.rhrDrift;
      if (!r) return null;
      return r.latest != null ? `${Math.round(r.latest)}bpm` : null;
    }
    case 'recoveryVelocity': {
      const rv = cs.recoveryVelocity;
      return rv?.avgDaysToRecover != null ? `${rv.avgDaysToRecover}d` : null;
    }
    case 'tdeeDrift': {
      const t = cs.tdeeDrift;
      return t?.recentTdee != null ? `${t.recentTdee} kcal` : null;
    }
    case 'energyAvailability': {
      const ea = cs.energyAvailability;
      return ea?.eaKcalPerKgLBM != null ? `${Math.round(ea.eaKcalPerKgLBM)} kcal/kg` : null;
    }
    case 'glycogen': {
      const g = cs.glycogen;
      return g?.adequacyRatio != null ? `${Math.round(g.adequacyRatio * 100)}%` : null;
    }
    case 'polarization': {
      const p = cs.polarization;
      return p?.easyPct != null ? `${p.easyPct}% easy` : null;
    }
    case 'sleepQuality': {
      const sq = cs.sleepQuality;
      return sq?.targetsMet != null ? `${sq.targetsMet}/4 targets` : null;
    }
    case 'monotonyStrain': {
      const m = cs.monotonyStrain;
      return m?.monotony != null ? `${m.monotony.toFixed(1)} monotony` : null;
    }
    default: return null;
  }
}

// ─── Aligned-state narrative ────────────────────────────────────────────────
// Fires when no problematic signals exist. Names what's working + surfaces
// a personalization callout (DOW rhythm or surfaceable correlation) if
// available. Stays positive without being smug — the point is for the user
// to see Arnold is paying attention even on the quiet weeks.

function composeAlignedNarrative(coachSignals) {
  const positives = [];
  const cs = coachSignals || {};

  if (cs.sleepDebt?.status === 'paid')                positives.push(`sleep is paid (${cs.sleepDebt.avgHours7d?.toFixed(1) || '?'}h avg)`);
  if (cs.hrvDepression?.status === 'normal')          positives.push(`HRV is stable near baseline (${Math.round(cs.hrvDepression.latest || 0)}ms)`);
  if (cs.rhrDrift?.status === 'stable')               positives.push('resting HR is flat');
  if (cs.recoveryVelocity?.status === 'improving')    positives.push(`recovery velocity is shortening (${cs.recoveryVelocity.avgDaysToRecover}d post-hard-session)`);
  if (cs.polarization?.status === 'polarized')        positives.push(`training distribution is polarized (${cs.polarization.easyPct}% easy)`);
  if (cs.tdeeDrift?.status === 'rebounding')          positives.push(`TDEE is climbing back (+${cs.tdeeDrift.driftPct}%)`);
  if (cs.energyAvailability?.status === 'sufficient') positives.push('energy availability is sufficient');
  if (cs.glycogen?.status === 'replete')              positives.push('glycogen is well-stocked');
  if (cs.monotonyStrain?.status === 'balanced')       positives.push('training has good easy/hard contrast');
  if (cs.sleepQuality?.status === 'restorative')      positives.push(`sleep quality is restorative (${cs.sleepQuality.targetsMet}/4 targets)`);

  // Personalization callouts — surface even when nothing else fires.
  const callouts = [];
  if (cs.dowPatterns?.status === 'meaningful') {
    const d = cs.dowPatterns;
    callouts.push(`Arnold's learned pattern: your HRV is best on ${d.highestDow?.label || '?'} (${Math.round(d.highestDow?.mean || 0)}ms avg) and lowest on ${d.lowestDow?.label || '?'} (${Math.round(d.lowestDow?.mean || 0)}ms). A ${d.spreadMs}ms weekly spread.`);
  }
  // Pick the strongest surfaceable correlation
  const corrs = [
    { key: 'sleep-hrv',          c: cs.sleepHrvCorrelation,    label: 'sleep → next-day HRV' },
    { key: 'sleep-rhr',          c: cs.sleepRhrCorr,           label: 'sleep → next-day RHR' },
    { key: 'sleep-run-quality',  c: cs.sleepRunQualityCorr,    label: 'sleep → next-day run quality' },
    { key: 'deficit-hrv',        c: cs.deficitHrvCorr,         label: 'deficit → HRV' },
    { key: 'load-sleep',         c: cs.loadSleepCorr,          label: 'weekly load → weekly sleep' },
  ].filter(x => x.c?.surfaceable);
  corrs.sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r));
  if (corrs.length) {
    const top = corrs[0];
    callouts.push(`Arnold's personal correlation for ${top.label}: ${top.c.insight}.`);
  }

  // Compose
  let opening;
  if (positives.length === 0) {
    opening = `Quiet day. Not enough data flowing yet to fire most signals — they'll start producing reads as Arnold accumulates a week or two of consistent inputs.`;
  } else {
    const positivesStr = positives.slice(0, 3).join(', ');
    opening = `Nothing pulling against you right now. ${capitalizeFirst(positivesStr)}${positives.length > 3 ? ', and a few more downstream' : ''}. This is the window to push fitness rather than recover from it.`;
  }

  // Phase 4r.narrative.2.3 — even in aligned state, surface goal progress
  // as the macro frame. "Nothing's wrong AND you're 4 weeks from target"
  // is a richer message than "nothing's wrong."
  const macroContext = composeMacroContext(cs, null);

  const story = {
    opening,
    secondaryThreads: [],
    action: {
      text: positives.length >= 3
        ? `If a quality block has been on the back burner, this is a good week to start it. Volume bumps land best on weeks like this.`
        : `Hold the current pattern. Watch for the first signal to flip — recovery velocity, polarization, or TDEE are the early-warning channels.`,
      metricToWatch: null,
    },
    macroContext,
    callouts, // personalization layer surfaced separately by the UI
  };

  return {
    asOf: cs.asOf || localDate(),
    leveragePoint: null,
    threads: [],
    story,
    graph: {
      nodes: [],
      edges: [],
      leverageKey: null,
    },
    upcomingPlan: cs.upcomingPlan || null,
    goalProgress: cs.goalProgress || null,
    alignedFallback: true,
  };
}

function capitalizeFirst(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function composeNarrative(userState) {
  const cs = userState?.coachSignals;
  if (!cs) {
    return {
      asOf: localDate(),
      leveragePoint: null,
      threads: [],
      story: {
        opening: 'No coach signals yet — Arnold needs a week or two of data flowing through sync before the narrative engine has enough to compose against.',
        secondaryThreads: [],
        action: { text: null, metricToWatch: null },
        callouts: [],
      },
      graph: { nodes: [], edges: [], leverageKey: null },
      alignedFallback: true,
    };
  }

  const problematic = findProblematicSignals(cs);
  if (!problematic.length) {
    return composeAlignedNarrative(cs);
  }

  const leverage = pickLeverage(problematic);
  if (!leverage) {
    return composeAlignedNarrative(cs);
  }

  const activeChain = activeChainFor(leverage.key, problematic);
  const opening = composeLeverageParagraph(leverage, activeChain, cs);
  const secondaryThreads = composeSecondaryThreads(problematic, leverage.key, activeChain, cs);
  const action = composeActionParagraph(leverage, cs);
  const graph = buildVisualizationGraph(leverage.key, activeChain, secondaryThreads, cs);
  // Phase 4r.narrative.2.3 — macro context renders below action.
  const leveragePtForMacro = { signalKey: leverage.key, label: getNode(leverage.key)?.label };
  const macroContext = composeMacroContext(cs, leveragePtForMacro);

  // Active threads list = union of threadIds touched by any rendered edge.
  const activeThreadSet = new Set();
  for (const e of graph.edges) activeThreadSet.add(e.threadId);

  return {
    asOf: cs.asOf || localDate(),
    leveragePoint: {
      signalKey: leverage.key,
      label: getNode(leverage.key)?.label,
      state: leverage.state,
      severity: leverage.severity,
      score: leverage.score,
    },
    threads: [...activeThreadSet],
    story: {
      opening,
      secondaryThreads,
      action,
      macroContext, // Phase 4r.narrative.2.3 — long-arc framing
      callouts: [], // populated only in aligned-state path
    },
    graph,
    // Phase 4r.narrative.2.2 — surface the upcoming plan on the narrative so
    // the Coach tab UI can render "Tomorrow: Intervals" inline, even when
    // the leverage action sentence doesn't need it.
    upcomingPlan: cs.upcomingPlan || null,
    // Phase 4r.narrative.2.3 — surface goalProgress so the UI can show a
    // progress bar / sparkline next to the macro paragraph.
    goalProgress: cs.goalProgress || null,
    alignedFallback: false,
  };
}

// ─── Debug helper ───────────────────────────────────────────────────────────
// Run window.narrativeDebug() in the console to see the composed narrative
// for the current userState. Logs each section + returns the structured
// object so it can be inspected.

function _printUpcomingPlan(up) {
  if (!up || up.status === 'insufficient') {
    console.log('UPCOMING PLAN: (no planner data)');
    return;
  }
  const rows = (up.next7Days || []).slice(0, 5).map(d => ({
    daysOut: d.daysOut, dow: d.dow, type: d.planned?.type || '—', label: d.label, intensity: d.intensityClass,
  }));
  console.log('UPCOMING PLAN (next 5 days):');
  console.table(rows);
  if (up.nextHardSession) {
    console.log(`  next hard: ${up.nextHardSession.label} on ${up.nextHardSession.dow} (+${up.nextHardSession.daysOut}d)`);
  } else {
    console.log('  next hard: none in the next 7d');
  }
}

function _printNarrative(nr, scenarioLabel = null) {
  console.log('=== NARRATIVE DEBUG ===');
  if (scenarioLabel) console.log(`Scenario: ${scenarioLabel}`);
  if (nr.alignedFallback) {
    console.log('Status: ALIGNED (no problematic signals)');
    console.log('OPENING:', nr.story.opening);
    console.log('ACTION:', nr.story.action.text);
    if (nr.story.macroContext) {
      console.log(`MACRO [${nr.story.macroContext.headline}]:`, nr.story.macroContext.text);
    }
    if (nr.story.callouts?.length) {
      console.log('CALLOUTS:');
      nr.story.callouts.forEach((c, i) => console.log(`  ${i + 1}.`, c));
    }
  } else {
    console.log(`Leverage: ${nr.leveragePoint?.label} (${nr.leveragePoint?.state}, severity ${nr.leveragePoint?.severity}, score ${nr.leveragePoint?.score})`);
    console.log('Threads:', nr.threads);
    console.log('');
    console.log('OPENING:', nr.story.opening);
    nr.story.secondaryThreads?.forEach((t) => {
      console.log('');
      console.log(`SECONDARY [${t.threadLabel}]:`, t.text);
    });
    console.log('');
    console.log('ACTION:', nr.story.action?.text);
    if (nr.story.action?.metricToWatch) {
      console.log('WATCH:', nr.story.action.metricToWatch.label,
        '·', nr.story.action.metricToWatch.currentValue || '(no value)',
        '·', nr.story.action.metricToWatch.rationale);
    }
    if (nr.story.macroContext) {
      console.log('');
      console.log(`MACRO [${nr.story.macroContext.headline}]:`, nr.story.macroContext.text);
    }
    console.log('');
    console.log('GRAPH:');
    console.table(nr.graph.nodes.map(n => ({
      key: n.signalKey, label: n.label, state: n.state, value: n.value, leverage: n.isLeverage,
    })));
    console.log('EDGES:');
    console.table(nr.graph.edges);
  }
  console.log('');
  _printUpcomingPlan(nr.upcomingPlan);
  return nr;
}

if (typeof window !== 'undefined') {
  // Phase 4r.narrative.2.1 — narrativeDebug now accepts a `scenario` arg so
  // the user can preview the engine against canonical fixtures even when
  // their live data is quiet. See narrativeScenarios.js for the fixture
  // library; `window.narrativeScenarios()` lists them.
  window.narrativeDebug = async function (opts = {}) {
    const { scenario = null } = opts;

    // Scenario mode — bypass live data, run against a fixture.
    if (scenario) {
      const { scenarioToUserState, getScenario, listScenarios } = await import('./narrativeScenarios.js');
      if (scenario === 'all') {
        const all = listScenarios();
        for (const s of all) {
          const us = scenarioToUserState(s.key);
          const nr = composeNarrative(us);
          console.log('\n══════════════════════════════════════════════');
          _printNarrative(nr, `${s.key} — ${s.label}`);
        }
        return all;
      }
      const meta = getScenario(scenario);
      if (!meta) {
        console.warn(`Unknown scenario '${scenario}'. Run window.narrativeScenarios() for the list.`);
        return null;
      }
      const us = scenarioToUserState(scenario);
      const nr = composeNarrative(us);
      return _printNarrative(nr, `${scenario} — ${meta.label}`);
    }

    // ── Live data mode — read from storage, compose narrative ──
    // Restored after file truncation Phase 4r.narrative.5.fix.20.
    try {
      const _storage = (typeof window !== 'undefined') ? window.__arnoldStorage : null;
      if (!_storage) {
        // eslint-disable-next-line no-console
        console.warn('[narrativeDebug] window.__arnoldStorage not set yet — wait for boot to complete, then try again.');
        return null;
      }
      const { computeUserState } = await import('./intelligence.js');
      const data = {
        activities:   _storage.get('activities')   || [],
        sleep:        _storage.get('sleep')        || [],
        hrv:          _storage.get('hrv')          || [],
        weight:       _storage.get('weight')       || [],
        cronometer:   _storage.get('cronometer')   || [],
        nutritionLog: _storage.get('nutritionLog') || [],
        wellness:     _storage.get('wellness')     || [],
        planner:      _storage.get('planner')      || null,
        profile:      _storage.get('profile')      || {},
      };
      const us = computeUserState(data);
      const nr = composeNarrative(us);
      return _printNarrative(nr, 'Live data');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[narrativeDebug] failed:', e?.message || e);
      return null;
    }
  };
}
