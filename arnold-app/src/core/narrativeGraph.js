// ─── ARNOLD Narrative Engine — Causal Graph & Sentence Library ─────────────
//
// Phase 4r.narrative.1 (2026-05-25). Foundation for the Coach tab narrative
// redesign — see COACH.md v2.6 spec.
//
// What this file is:
//   A static description of which signals causally affect which (the
//   directed graph), grouped into named storylines (threads), plus the
//   sentence fragments each signal contributes when it appears in a
//   narrative. Pure data + pure functions. No storage reads.
//
// What this file is NOT:
//   The composer. That's narrativeComposer.js (Phase 4r.narrative.2). The
//   composer walks this graph against a current userState snapshot,
//   picks a leverage point, and assembles the paragraphs.
//
// Architectural premise:
//   Each signal node declares (a) how to read its state from coachSignals,
//   (b) whether that state is problematic (worth narrative attention),
//   (c) a severity score for leverage-point ranking, and (d) the sentence
//   templates that put its state into prose. Templates take a userState
//   snapshot so they can pull real numbers — no stitched-together prose
//   without specific values.
//
// Voice rules baked into the templates:
//   • Active voice. "Sleep debt has pulled HRV down 8ms" — not "HRV has
//     been pulled down by sleep debt."
//   • Specific numbers, not hedged. Templates that can't fill a number
//     return null and the composer routes around them.
//   • Connector phrases name causation explicitly ("that's pulled",
//     "which lengthened", "stacking with"). The mechanism lives in the
//     connector, not in the self-sentence.
//   • Action sentence: ONE action, named with the metric to watch.

// ─── Time-to-impact ranks (for leverage-point tiebreaks) ────────────────────
// Lower number = sooner-to-act. When two signals score equal as leverage
// candidates, the one with sooner time-to-impact wins.
export const TIME_TO_IMPACT_RANK = {
  immediate:   1,   // 24h action (sleep, fuel timing)
  'short-term': 2,  // days (HRV, RHR, recovery velocity)
  'medium-term': 3, // weeks (TDEE drift, polarization)
  'long-term': 4,   // months (DOW patterns, fitness trajectory)
};

// ─── Pillars (for display + grouping) ───────────────────────────────────────
export const PILLARS = ['Move', 'Fuel', 'Recover', 'Body'];

// ─── Helper formatters ──────────────────────────────────────────────────────
const fmt0 = (n) => Number.isFinite(n) ? Math.round(n).toString() : '—';
const fmt1 = (n) => Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '—';
const signed = (n) => Number.isFinite(n) ? (n > 0 ? `+${n}` : `${n}`) : '—';

// ─── Threads (named storylines) ─────────────────────────────────────────────
// A thread is a directed path through the graph. The composer surfaces
// threads whose constituent signals are currently active. Each thread
// has a short label (used in the visualization) and a one-sentence
// description (used in the prose when introducing a secondary thread).
export const NARRATIVE_THREADS = {
  'sleep-recovery': {
    label: 'Sleep → Recovery',
    description: "How sleep shapes HRV, RHR, and the body's bounce-back from training.",
  },
  'cut-adaptation': {
    label: 'Cut → Adaptation',
    description: 'How a calorie deficit affects metabolism and recovery cost over weeks.',
  },
  'fuel-timing': {
    label: 'Fuel → Performance',
    description: 'How carb supply (and timing) affects high-intensity capacity in the next 24h.',
  },
  'training-quality': {
    label: 'Training quality → Capacity',
    description: 'How intensity distribution and monotony affect sustainable load.',
  },
  'personal-rhythm': {
    label: 'Personal rhythm',
    description: 'Learned patterns specific to your weekly cycle and physiology.',
  },
};

// ─── Causal edges ───────────────────────────────────────────────────────────
// Each edge: { from, to, threadId, strength }.
//   strength: 'strong' (well-established cause-effect, fires together
//             reliably) or 'moderate' (correlative or context-dependent).
// Order: source-most-upstream first. The composer walks these to find
// downstream effects of a leverage point.
export const NARRATIVE_EDGES = [
  // Sleep-recovery thread
  { from: 'sleepDebt',         to: 'hrvDepression',    threadId: 'sleep-recovery', strength: 'strong' },
  { from: 'sleepDebt',         to: 'rhrDrift',         threadId: 'sleep-recovery', strength: 'strong' },
  { from: 'sleepDebt',         to: 'sleepQuality',     threadId: 'sleep-recovery', strength: 'moderate' },
  { from: 'sleepQuality',      to: 'hrvDepression',    threadId: 'sleep-recovery', strength: 'strong' },
  { from: 'hrvDepression',     to: 'recoveryVelocity', threadId: 'sleep-recovery', strength: 'strong' },
  { from: 'rhrDrift',          to: 'recoveryVelocity', threadId: 'sleep-recovery', strength: 'moderate' },

  // Cut-adaptation thread
  { from: 'tdeeDrift',         to: 'energyAvailability', threadId: 'cut-adaptation', strength: 'strong' },
  { from: 'energyAvailability', to: 'hrvDepression',     threadId: 'cut-adaptation', strength: 'moderate' },
  { from: 'energyAvailability', to: 'sleepQuality',      threadId: 'cut-adaptation', strength: 'moderate' },

  // Fuel-timing thread
  { from: 'glycogen',          to: 'recoveryVelocity', threadId: 'fuel-timing',     strength: 'moderate' },

  // Training-quality thread
  { from: 'polarization',      to: 'recoveryVelocity', threadId: 'training-quality', strength: 'moderate' },
  { from: 'monotonyStrain',    to: 'recoveryVelocity', threadId: 'training-quality', strength: 'moderate' },
  { from: 'monotonyStrain',    to: 'hrvDepression',    threadId: 'training-quality', strength: 'moderate' },
];

// ─── Signal nodes ───────────────────────────────────────────────────────────
// One entry per signal that can appear in a narrative. The key matches
// the property on userState.coachSignals (e.g., coachSignals.sleepDebt).

export const NARRATIVE_NODES = {
  // ─── Sleep debt ───────────────────────────────────────────────────────────
  sleepDebt: {
    label: 'Sleep debt',
    pillar: 'Recover',
    timeToImpact: 'immediate',
    // Phase 4r.narrative.4a — Tile-catalog reference. The Coach tab embeds
    // the existing tile component identified here (Arnold's visual vocabulary
    // is what the user already trusts — Coach borrows it rather than
    // inventing new graphics). sourceTab indicates which tab the tap-to-drill
    // gesture should land on. Null means no existing tile yet — Phase 4d
    // fills these gaps.
    displayTile: 'sleepScore',
    sourceTab: 'trend',
    getState: (cs) => cs?.sleepDebt?.status || 'unknown',
    isProblematic: (s) => s === 'moderate' || s === 'severe' || s === 'mild',
    severity: (s) => ({ paid: 0, mild: 1, moderate: 2, severe: 3 }[s] || 0),

    selfSentence(cs) {
      const sd = cs?.sleepDebt;
      if (!sd) return null;
      const { status, debt7d, avgHours7d, targetHours, nightsBelow7d } = sd;
      if (status === 'severe')   return `Sleep debt is severe — ${fmt1(debt7d)}h short of target across the last 7 nights (averaging ${fmt1(avgHours7d)}h vs ${targetHours}h target, ${nightsBelow7d}/7 nights short).`;
      if (status === 'moderate') return `Sleep debt is moderate — ${fmt1(debt7d)}h short across the last 7 nights (averaging ${fmt1(avgHours7d)}h vs ${targetHours}h target).`;
      if (status === 'mild')     return `Sleep debt is mild — ${fmt1(debt7d)}h short across the last 7 nights.`;
      if (status === 'paid')     return `Sleep is paid — averaging ${fmt1(avgHours7d)}h, only ${nightsBelow7d}/7 nights below target.`;
      return null;
    },

    causalConnector(downstreamKey, cs) {
      if (downstreamKey === 'hrvDepression') {
        const ms = cs?.hrvDepression?.depressionMs;
        if (ms > 0) return `That's pulled HRV down ${fmt0(ms)}ms vs your 28-day baseline`;
      }
      if (downstreamKey === 'rhrDrift') {
        const slope = cs?.rhrDrift?.slopeBpmPerWeek;
        if (slope > 0.5) return `and resting HR has drifted up ${fmt1(slope)}bpm/wk`;
      }
      if (downstreamKey === 'recoveryVelocity') {
        const rv = cs?.recoveryVelocity;
        if (rv?.avgDaysToRecover && rv?.baselineAvg) return `which has lengthened recovery velocity to ${rv.avgDaysToRecover}d post-hard-session (vs ${rv.baselineAvg}d normally)`;
      }
      if (downstreamKey === 'sleepQuality') {
        return `and the architecture is suffering too — not just hours but stages`;
      }
      return null;
    },

    actionSentence(cs) {
      const sd = cs?.sleepDebt;
      const hrs = sd?.targetHours || 7.5;
      if (sd?.status === 'severe' || sd?.status === 'moderate') {
        return `Prioritize ${hrs}h tonight (lights out an hour earlier). Drop tomorrow's hardest session if a true rest day is too aggressive. Hold the rest of the plan steady.`;
      }
      if (sd?.status === 'mild') {
        return `Bank an extra 30-45 minutes tonight before the debt grows. Easier to recover from 1h shortfall than 4h.`;
      }
      return null;
    },

    metricToWatch(cs) {
      return {
        signalKey: 'recoveryVelocity',
        label: 'Recovery velocity',
        currentValue: cs?.recoveryVelocity?.avgDaysToRecover != null
          ? `${cs.recoveryVelocity.avgDaysToRecover}d`
          : null,
        rationale: "Recovery velocity sits at the end of the sleep-recovery chain — if it shortens back toward your baseline within 7 days, the leverage worked.",
      };
    },
  },

  // ─── HRV depression ───────────────────────────────────────────────────────
  hrvDepression: {
    label: 'HRV',
    pillar: 'Recover',
    timeToImpact: 'short-term',
    displayTile: 'overnightHRV',
    sourceTab: 'trend',
    getState: (cs) => cs?.hrvDepression?.status || 'unknown',
    isProblematic: (s) => s === 'moderate' || s === 'severe' || s === 'mild',
    severity: (s) => ({ normal: 0, mild: 1, moderate: 2, severe: 3 }[s] || 0),

    selfSentence(cs) {
      const h = cs?.hrvDepression;
      if (!h) return null;
      const { status, depressionMs, depressionPct, latest, baseline28d, consecutiveDepressedDays } = h;
      if (status === 'severe')   return `HRV is severely depressed — ${fmt0(latest)}ms vs your 28-day baseline of ${fmt0(baseline28d)}ms (${signed(-depressionPct)}%, ${consecutiveDepressedDays} consecutive nights below baseline).`;
      if (status === 'moderate') return `HRV is moderately depressed — ${fmt0(latest)}ms vs baseline ${fmt0(baseline28d)}ms (${signed(-depressionPct)}%, ${consecutiveDepressedDays} nights below).`;
      if (status === 'mild')     return `HRV is mildly below your baseline — ${fmt0(latest)}ms vs ${fmt0(baseline28d)}ms (${signed(-depressionPct)}%).`;
      if (status === 'normal')   return `HRV is stable at ${fmt0(latest)}ms, near your 28-day baseline of ${fmt0(baseline28d)}ms.`;
      return null;
    },

    causalConnector(downstreamKey, cs) {
      if (downstreamKey === 'recoveryVelocity') {
        const rv = cs?.recoveryVelocity;
        if (rv?.driftPct > 15) return `and that's showing up downstream as slower recovery — ${rv.avgDaysToRecover}d post-hard-session vs ${rv.baselineAvg}d previously`;
      }
      return null;
    },

    actionSentence(cs) {
      const h = cs?.hrvDepression;
      if (h?.status === 'severe')   return `Treat today as recovery. HRV this depressed for ${h.consecutiveDepressedDays} consecutive nights is overreaching territory — drop the next hard session, push it 2-3 days out.`;
      if (h?.status === 'moderate') return `Drop the intensity on today's session. Replace planned threshold or Z4-5 work with zone-2; keep volume if you want it.`;
      return null;
    },

    metricToWatch(cs) {
      return {
        signalKey: 'hrvDepression',
        label: 'HRV',
        currentValue: cs?.hrvDepression?.latest != null ? `${fmt0(cs.hrvDepression.latest)}ms` : null,
        rationale: "Re-measure tomorrow morning. A 5+ms bounce back inside 48h means recovery is working; flat or further drop means the load is still the problem.",
      };
    },
  },

  // ─── RHR drift ────────────────────────────────────────────────────────────
  rhrDrift: {
    label: 'Resting HR',
    pillar: 'Recover',
    timeToImpact: 'short-term',
    displayTile: 'rhrTrend',
    sourceTab: 'trend',
    getState: (cs) => cs?.rhrDrift?.status || 'unknown',
    isProblematic: (s) => s === 'rising' || s === 'concerning',
    severity: (s) => ({ stable: 0, rising: 2, concerning: 3 }[s] || 0),

    selfSentence(cs) {
      const r = cs?.rhrDrift;
      if (!r) return null;
      const { status, latest, baseline28d, slopeBpmPerWeek } = r;
      if (status === 'concerning') return `Resting HR is climbing — ${fmt0(latest)}bpm latest vs ${fmt0(baseline28d)} baseline, slope ${signed(slopeBpmPerWeek)}bpm/week. Classic overreaching territory.`;
      if (status === 'rising')     return `Resting HR has drifted up — ${fmt0(latest)}bpm latest, baseline ${fmt0(baseline28d)}, slope ${signed(slopeBpmPerWeek)}bpm/wk.`;
      if (status === 'stable')     return `Resting HR is stable at ${fmt0(latest)}bpm (baseline ${fmt0(baseline28d)}).`;
      return null;
    },

    causalConnector(downstreamKey) {
      if (downstreamKey === 'recoveryVelocity') return `and recovery velocity is the third confirming voice`;
      return null;
    },

    actionSentence(cs) {
      const r = cs?.rhrDrift;
      if (r?.status === 'concerning') return `A ${fmt1(r.slopeBpmPerWeek)}bpm/wk climb is the canonical overreaching signal — schedule a 7-day deload (40-50% volume cut, intensity follows).`;
      if (r?.status === 'rising')     return `Take the next 5-7 days easy. If the slope reverses, you caught it early; if it doesn't, escalate to a full deload.`;
      return null;
    },
  },

  // ─── Recovery velocity ────────────────────────────────────────────────────
  recoveryVelocity: {
    label: 'Recovery velocity',
    pillar: 'Recover',
    timeToImpact: 'short-term',
    // Phase 4r.narrative.4d — dedicated tile shipped in TILE_METRICS.
    displayTile: 'recoveryVelocity',
    sourceTab: 'trend',
    getState: (cs) => cs?.recoveryVelocity?.status || 'unknown',
    isProblematic: (s) => s === 'slowing' || s === 'concerning',
    severity: (s) => ({ improving: 0, stable: 0, slowing: 2, concerning: 3 }[s] || 0),

    selfSentence(cs) {
      const rv = cs?.recoveryVelocity;
      if (!rv) return null;
      const { status, avgDaysToRecover, baselineAvg, driftPct, nRecent } = rv;
      if (status === 'concerning') return `Recovery velocity has lengthened ${signed(driftPct)}% — ${avgDaysToRecover}d to baseline HRV after hard sessions (vs ${baselineAvg}d previously, n=${nRecent}).`;
      if (status === 'slowing')    return `Recovery velocity is slowing — ${avgDaysToRecover}d post-hard-session vs ${baselineAvg}d previously (${signed(driftPct)}%).`;
      if (status === 'improving')  return `Recovery velocity is shortening — ${avgDaysToRecover}d post-hard-session vs ${baselineAvg}d previously (${signed(driftPct)}%). Fitness is converting.`;
      if (status === 'stable')     return `Recovery velocity is steady at ${avgDaysToRecover}d post-hard-session.`;
      return null;
    },

    // RV is usually downstream — it rarely has its own causal connector.
    causalConnector() { return null; },

    actionSentence(cs) {
      const rv = cs?.recoveryVelocity;
      if (rv?.status === 'concerning') return `Cut weekly TSS by 40% for the next 7-10 days. Drop the hardest one or two sessions; keep volume but at zone-2.`;
      if (rv?.status === 'slowing')    return `Easier next 5-7 days. Replace the next planned threshold session with zone-2.`;
      return null;
    },

    metricToWatch(cs) {
      return {
        signalKey: 'recoveryVelocity',
        label: 'Recovery velocity',
        currentValue: cs?.recoveryVelocity?.avgDaysToRecover != null ? `${cs.recoveryVelocity.avgDaysToRecover}d` : null,
        rationale: "Recheck in 7 days. Target: return toward your baseline of " + (cs?.recoveryVelocity?.baselineAvg || '?') + "d.",
      };
    },
  },

  // ─── TDEE drift ───────────────────────────────────────────────────────────
  tdeeDrift: {
    label: 'TDEE drift',
    pillar: 'Fuel',
    timeToImpact: 'medium-term',
    // Phase 4r.narrative.4d — dedicated tile shipped in TILE_METRICS.
    displayTile: 'tdeeDrift',
    sourceTab: 'trend',
    getState: (cs) => cs?.tdeeDrift?.status || 'unknown',
    isProblematic: (s) => s === 'adapting' || s === 'starvation',
    severity: (s) => ({ stable: 0, rebounding: 0, adapting: 2, starvation: 3 }[s] || 0),

    selfSentence(cs) {
      const t = cs?.tdeeDrift;
      if (!t) return null;
      const { status, recentTdee, baselineTdee, driftKcal, driftPct } = t;
      if (status === 'starvation')  return `Empirical TDEE has dropped ${Math.abs(driftPct)}% over 4 weeks (${baselineTdee} → ${recentTdee} kcal). Deep metabolic adaptation territory.`;
      if (status === 'adapting')    return `Empirical TDEE has dropped ${Math.abs(driftPct)}% over 4 weeks (${baselineTdee} → ${recentTdee} kcal). Classic cut adaptation kicking in.`;
      if (status === 'rebounding')  return `Empirical TDEE has climbed back +${driftPct}% (${baselineTdee} → ${recentTdee} kcal) — refeed/diet break worked.`;
      if (status === 'stable')      return `Empirical TDEE is stable at ${recentTdee} kcal/day.`;
      return null;
    },

    causalConnector(downstreamKey, cs) {
      if (downstreamKey === 'energyAvailability') {
        const ea = cs?.energyAvailability;
        if (ea?.eaKcalPerKgLBM != null) return `which has compressed energy availability to ${fmt0(ea.eaKcalPerKgLBM)} kcal/kg LBM`;
      }
      if (downstreamKey === 'hrvDepression') return `stacking with the recovery cost`;
      return null;
    },

    actionSentence(cs) {
      const t = cs?.tdeeDrift;
      if (t?.status === 'starvation') return `Schedule a 2-4 week diet break at maintenance (~${t.recentTdee} kcal). Re-measure TDEE after — the goal is to see this number trend back up before resuming deficit.`;
      if (t?.status === 'adapting')   return `Add 1500-2000 steps/day to lift NEAT (often more effective than dropping intake further) OR schedule a 7-day diet break at ~${t.recentTdee} kcal.`;
      return null;
    },

    metricToWatch(cs) {
      const t = cs?.tdeeDrift;
      return {
        signalKey: 'tdeeDrift',
        label: 'Empirical TDEE',
        currentValue: t?.recentTdee != null ? `${t.recentTdee} kcal` : null,
        rationale: "TDEE drift is a 4-week signal. Recheck after a deload/diet break window — the move worked if recent-4wk TDEE comes back up.",
      };
    },
  },

  // ─── Energy availability ──────────────────────────────────────────────────
  energyAvailability: {
    label: 'Energy availability',
    pillar: 'Fuel',
    timeToImpact: 'immediate',
    // Phase 4r.narrative.4d — dedicated tile shipped in TILE_METRICS.
    displayTile: 'energyAvailability',
    sourceTab: 'daily',
    getState: (cs) => cs?.energyAvailability?.status || 'unknown',
    isProblematic: (s) => s === 'low' || s === 'deficient',
    severity: (s) => ({ sufficient: 0, low: 2, deficient: 3 }[s] || 0),

    selfSentence(cs) {
      const ea = cs?.energyAvailability;
      if (!ea) return null;
      const { status, eaKcalPerKgLBM, netKcal, lbmKg } = ea;
      if (status === 'deficient')  return `Energy availability is deficient today — ${fmt0(eaKcalPerKgLBM)} kcal/kg LBM (net ${fmt0(netKcal)} kcal over ${fmt1(lbmKg)}kg LBM, below the 30 kcal/kg endocrine threshold).`;
      if (status === 'low')        return `Energy availability is low — ${fmt0(eaKcalPerKgLBM)} kcal/kg LBM (between 30 and 40, the band where recovery and adaptation start to compress).`;
      if (status === 'sufficient') return `Energy availability is sufficient at ${fmt0(eaKcalPerKgLBM)} kcal/kg LBM.`;
      return null;
    },

    causalConnector(downstreamKey, cs) {
      if (downstreamKey === 'hrvDepression')    return `and your HRV reflects it`;
      if (downstreamKey === 'sleepQuality')     return `which often shows up next in sleep architecture`;
      return null;
    },

    actionSentence(cs) {
      const ea = cs?.energyAvailability;
      if (ea?.status === 'deficient') {
        const deficit = Math.max(0, Math.round((40 - ea.eaKcalPerKgLBM) * (ea.lbmKg || 0)));
        return `Add ${deficit} kcal today — anchor it on carbs + protein around training. Either that, or scale back today's exercise calories.`;
      }
      if (ea?.status === 'low')       return `Aim to land closer to the 40 kcal/kg line today. Either eat slightly more OR ease today's workout.`;
      return null;
    },
  },

  // ─── Glycogen ─────────────────────────────────────────────────────────────
  glycogen: {
    label: 'Glycogen',
    pillar: 'Fuel',
    timeToImpact: 'immediate',
    // Phase 4r.narrative.4d — dedicated tile shipped in TILE_METRICS.
    displayTile: 'glycogen',
    sourceTab: 'daily',
    getState: (cs) => cs?.glycogen?.status || 'unknown',
    isProblematic: (s) => s === 'depleted' || s === 'critical',
    severity: (s) => ({ replete: 0, moderate: 0, depleted: 2, critical: 3 }[s] || 0),

    selfSentence(cs) {
      const g = cs?.glycogen;
      if (!g) return null;
      const { status, adequacyRatio, supplied24h, need24h, confidence } = g;
      const confTag = confidence === 'low' ? ' (low-confidence — based on daily rollup, not per-meal timing)' : '';
      if (status === 'critical') return `Glycogen state is critical — 24h supply ${supplied24h}g vs need ${need24h}g (ratio ${adequacyRatio})${confTag}.`;
      if (status === 'depleted') return `Glycogen is depleted — 24h supply ${supplied24h}g vs need ${need24h}g (ratio ${adequacyRatio})${confTag}.`;
      if (status === 'moderate') return `Glycogen is on the line — 24h supply ${supplied24h}g vs need ${need24h}g.`;
      if (status === 'replete')  return `Glycogen is well-stocked — 24h supply ${supplied24h}g covers the ${need24h}g need.`;
      return null;
    },

    causalConnector(downstreamKey, cs) {
      if (downstreamKey === 'recoveryVelocity') return `and that compounds with the recovery picture — low carbs slow glycogen restoration and HRV bounce-back together`;
      return null;
    },

    actionSentence(cs) {
      const g = cs?.glycogen;
      if (g?.status === 'critical') return `Eat 80-120g carbs in the next 2h. If a hard session is on tomorrow's plan, load dinner carbs tonight — overnight liver glycogen restoration is where most of the recovery happens.`;
      if (g?.status === 'depleted') return `Add 50-80g carbs before bed + another 40-60g 2h pre-workout if a quality session is next. If today's just easy, no action — depleted-then-replenished is part of metabolic-flexibility training.`;
      return null;
    },
  },

  // ─── Polarization ─────────────────────────────────────────────────────────
  polarization: {
    label: 'Polarization',
    pillar: 'Move',
    timeToImpact: 'medium-term',
    // zone2Weekly shows ONE band (Z2 minutes); polarization needs all three
    // (easy / moderate / hard). Phase 4d will build a stacked-bar tile.
    // For now, falling back to zone2Weekly gives users a partial visual
    // anchor — better than no tile at all.
    displayTile: 'zone2Weekly',
    sourceTab: 'trend',
    getState: (cs) => cs?.polarization?.status || 'unknown',
    isProblematic: (s) => s === 'grey-zone' || s === 'hot' || s === 'sparse-easy',
    severity: (s) => ({ polarized: 0, balanced: 0, 'sparse-easy': 1, 'grey-zone': 2, hot: 2 }[s] || 0),

    selfSentence(cs) {
      const p = cs?.polarization;
      if (!p) return null;
      const { status, easyPct, moderatePct, hardPct, nActivities, windowDays } = p;
      if (status === 'grey-zone')   return `Training distribution is grey-zone — ${moderatePct}% in Z3 over ${nActivities} sessions / ${windowDays}d, above the 15% ceiling for polarized work.`;
      if (status === 'hot')         return `Training distribution is over-intense — ${hardPct}% in Z4-5 over ${nActivities} sessions / ${windowDays}d.`;
      if (status === 'sparse-easy') return `Base-building is thin — only ${easyPct}% of endurance time has been easy (Z1-2) over the last ${windowDays}d.`;
      if (status === 'polarized')   return `Training distribution is polarized — ${easyPct}% easy / ${moderatePct}% moderate / ${hardPct}% hard. Sweet spot.`;
      return null;
    },

    causalConnector(downstreamKey) {
      if (downstreamKey === 'recoveryVelocity') return `which is part of why recovery is dragging — Z3 dominance taxes the system without proportional fitness return`;
      return null;
    },

    actionSentence(cs) {
      const p = cs?.polarization;
      if (p?.status === 'grey-zone')   return `Drop one Z3 session this week. Replace with either zone-2 (sustained 45-60min) or true intensity (4-6×3min @ Z5 with full recovery).`;
      if (p?.status === 'hot')         return `Anchor with a 60-75min zone-2 session this week. Conversational pace.`;
      if (p?.status === 'sparse-easy') return `Add 60-90min of zone-2 work this week. The aerobic engine is built here, not in the hard sessions.`;
      return null;
    },
  },

  // ─── Sleep quality (architecture) ─────────────────────────────────────────
  sleepQuality: {
    label: 'Sleep quality',
    pillar: 'Recover',
    timeToImpact: 'immediate',
    // sleepScore is the closest existing tile — it's the composite Garmin
    // score. Doesn't show stage breakdown directly. Phase 4d may add a
    // dedicated stage-percentage tile, but sleepScore is a reasonable
    // tap-through anchor for now.
    displayTile: 'sleepScore',
    sourceTab: 'trend',
    getState: (cs) => cs?.sleepQuality?.status || 'unknown',
    isProblematic: (s) => s === 'impaired' || s === 'mixed',
    severity: (s) => ({ restorative: 0, mixed: 1, impaired: 2 }[s] || 0),

    selfSentence(cs) {
      const sq = cs?.sleepQuality;
      if (!sq || !sq.targetsMet) return null;
      const { status, targetsMet, deepAvgPct, remAvgPct, effAvgPct, n, weaknesses } = sq;
      const weakStr = weaknesses?.[0]?.label || 'multiple dimensions';
      if (status === 'impaired') return `Sleep quality is impaired over the last ${n} nights — meeting ${targetsMet}/4 architecture targets. Weakest: ${weakStr}.`;
      if (status === 'mixed')    return `Sleep quality is mixed — ${targetsMet}/4 targets met, weakest in ${weakStr} (deep ${deepAvgPct}%, REM ${remAvgPct}%, eff ${effAvgPct}%).`;
      if (status === 'restorative') return `Sleep quality is restorative — meeting ${targetsMet}/4 architecture targets (deep ${deepAvgPct}%, REM ${remAvgPct}%, eff ${effAvgPct}%).`;
      return null;
    },

    causalConnector(downstreamKey) {
      if (downstreamKey === 'hrvDepression') return `which means the hours you DID sleep aren't buying the HRV recovery they should`;
      return null;
    },

    actionSentence(cs) {
      const sq = cs?.sleepQuality;
      const w = sq?.weaknesses?.[0];
      if (!w) return null;
      const actionByKey = {
        deep:  'Cooler bedroom (~19°C/66°F), no alcohol within 4h of bed, no high-intensity exercise within 3h. Of those, temperature and alcohol move deep% the most.',
        rem:   'Push bedtime earlier rather than oversleeping — REM clusters in the second half of the night. Also: alcohol disproportionately suppresses REM.',
        eff:   'Pick one continuity-killer (late caffeine, late large meal, evening blue light, warm room) and remove it for 5 nights. Recheck.',
        awake: 'Wake events usually trace to late caffeine, alcohol, or room noise. A nightcap multiplies wake events 2-3× without changing total time.',
      };
      return actionByKey[w.key] || 'Pick the weakest dimension and run one experiment for a week.';
    },
  },

  // ─── Monotony / strain (training) ─────────────────────────────────────────
  monotonyStrain: {
    label: 'Monotony',
    pillar: 'Move',
    timeToImpact: 'short-term',
    // weeklyLoad shows the total — monotony needs the variance pattern.
    // Adjacent visual; Phase 4d may add a dedicated monotony/strain dial.
    displayTile: 'weeklyLoad',
    sourceTab: 'trend',
    getState: (cs) => cs?.monotonyStrain?.status || 'unknown',
    isProblematic: (s) => s === 'monotonous' || s === 'high-strain',
    severity: (s) => ({ balanced: 0, monotonous: 2, 'high-strain': 3 }[s] || 0),

    selfSentence(cs) {
      const m = cs?.monotonyStrain;
      if (!m) return null;
      const { status, monotony, weeklyLoad, strain } = m;
      if (status === 'high-strain') return `Training is high-strain — monotony ${fmt1(monotony)}, weekly load ${fmt0(weeklyLoad)} TSS, strain ${fmt0(strain)}. No easy days to absorb the work.`;
      if (status === 'monotonous')  return `Training has gone monotonous — monotony ${fmt1(monotony)} (same load every day, ${fmt0(weeklyLoad)} TSS this week).`;
      if (status === 'balanced')    return `Training distribution is balanced — monotony ${fmt1(monotony)}, weekly load ${fmt0(weeklyLoad)} TSS.`;
      return null;
    },

    causalConnector(downstreamKey) {
      if (downstreamKey === 'recoveryVelocity') return `which is what the recovery picture is downstream of`;
      if (downstreamKey === 'hrvDepression')    return `and that's where HRV is paying for it`;
      return null;
    },

    actionSentence(cs) {
      const m = cs?.monotonyStrain;
      if (m?.status === 'high-strain') return `Insert a true recovery day this week — full rest or zone-1 walk only. Monotony drops fastest when you add contrast, not when you cut total volume.`;
      if (m?.status === 'monotonous')  return `Take one day this week as zone-1 only (or off). The variance between hard and easy is what drives adaptation.`;
      return null;
    },
  },
};

// ─── Graph traversal helpers ────────────────────────────────────────────────
// Used by the composer. Pure functions over the static graph above.

/** Return signalKeys that are downstream of `signalKey` in the graph. */
export function downstreamOf(signalKey) {
  return NARRATIVE_EDGES
    .filter(e => e.from === signalKey)
    .map(e => e.to);
}

/** Return signalKeys that are upstream of `signalKey` in the graph. */
export function upstreamOf(signalKey) {
  return NARRATIVE_EDGES
    .filter(e => e.to === signalKey)
    .map(e => e.from);
}

/** Walk the downstream chain from a starting signal up to maxDepth hops. */
export function downstreamChain(startKey, maxDepth = 3) {
  const chain = [startKey];
  const seen = new Set([startKey]);
  let frontier = [startKey];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next = [];
    for (const key of frontier) {
      for (const d of downstreamOf(key)) {
        if (!seen.has(d)) {
          seen.add(d);
          next.push(d);
          chain.push(d);
        }
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return chain;
}

/** Return edges that connect any pair of keys in the provided set. */
export function edgesAmong(keys) {
  const set = new Set(keys);
  return NARRATIVE_EDGES.filter(e => set.has(e.from) && set.has(e.to));
}

/** Get the node definition for a signal key, or null if not in the graph. */
export function getNode(signalKey) {
  return NARRATIVE_NODES[signalKey] || null;
}

/** Iterate every node as [key, def] entries. */
export function eachNode() {
  return Object.entries(NARRATIVE_NODES);
}

// Phase 4r.narrative.4a — convenience getters for the Coach tab UI.
// `tileForSignal(key)` returns the tile id + source tab for a given signal,
// or null if no tile is registered yet.

export function tileForSignal(signalKey) {
  const node = NARRATIVE_NODES[signalKey];
  if (!node) return null;
  if (!node.displayTile) return null;
  return { tileId: node.displayTile, sourceTab: node.sourceTab || 'trend' };
}

/** Return the list of signal keys that don't have a registered displayTile yet.
 *  Useful for Phase 4d planning + audits. */
export function signalsWithoutTiles() {
  return Object.entries(NARRATIVE_NODES)
    .filter(([, node]) => !node.displayTile)
    .map(([key]) => key);
}
