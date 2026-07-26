// ─── core/planCommitment.js — what the athlete actually signed up for ─────────
//
// tierFeasibility says which options are reachable. This says which one was CHOSEN,
// and freezes the context of that choice so the coach can later ask an honest
// question: not "are you fast?" but "are you doing the thing you agreed to do?"
//
// Why this is stored rather than recomputed. The feasibility rows move every week —
// log a big block and Goal unlocks; miss three weeks and Stretch closes. That
// movement is the point, but it makes a live read useless as an accountability
// anchor: a plan that silently redefines what you committed to can never report
// that you drifted from it. So the commitment is written ONCE, at apply time, with
// the base and demonstrated volume that were true at that moment. Everything after
// is measured against it.
//
// One record, one A-race. Committing to a different race replaces it — there is no
// history here on purpose; the durable record of what was actually run lives in
// activities and careerRaces, which are the things that really happened.

import { storage } from './storage.js';

/**
 * @returns {{tier,tierLabel,goalSecs,peakMi,longRunMi,thresholdWeeks,
 *            deliversPeakMi,deliversLongMi,soloPeakMi,raceCostMi,costlyRaces,
 *            aRaceDate,aRaceName,baseAtCommit,demonstratedAtCommit,ratioAtCommit,
 *            verdictAtCommit,weeks,firstWeekKey,lastWeekKey,committedAt,triad}|null}
 */
export function getCommitment() {
  try {
    const c = storage.get('planCommitment');
    return (c && typeof c === 'object' && c.tier) ? c : null;
  } catch { return null; }
}

/**
 * Freeze the choice. Called from the one place a plan reaches the calendar.
 * @param {object} o tier row fields + the A-race it is for + the base at that moment
 */
export function setCommitment({
  tier, tierLabel = null, goalSecs, peakMi, longRunMi, thresholdWeeks,
  deliversPeakMi = null, deliversLongMi = null,
  soloPeakMi = null, raceCostMi = null, costlyRaces = null,
  aRaceDate = null, aRaceName = null,
  baseAtCommit = null, demonstratedAtCommit = null,
  ratioAtCommit = null, verdictAtCommit = null,
  weeks = null, firstWeekKey = null, lastWeekKey = null, committedAt = null,
  triad = null,
} = {}) {
  if (!tier || !(Number(goalSecs) > 0)) return null;
  const rec = {
    tier,
    // The LABEL is frozen alongside the key on purpose. `custom` is a real tier now (Emil's
    // sub-3:40 Valencia option), and its label is a finish time that exists nowhere on the
    // published ladder — so a surface that only had the key would have to invent a name for
    // it, and would invent a different one than the card that made the commitment.
    tierLabel: tierLabel || null,
    goalSecs: Number(goalSecs),
    peakMi: Number(peakMi) || null,
    longRunMi: Number(longRunMi) || null,
    thresholdWeeks: Number(thresholdWeeks) || null,
    // WANTS vs DELIVERS, frozen together. peakMi is what the finish time REQUIRES;
    // deliversPeakMi is what the ramp actually reached when the block was generated. They
    // are routinely different (at Emil's July 2026 numbers, 44 vs 35) and a surface that
    // shows one without the other is either flattering him or accusing him.
    deliversPeakMi: Number(deliversPeakMi) || null,
    deliversLongMi: Number(deliversLongMi) || null,
    // And WHY they differ, measured at commit time by LivingPlan's attribution probe:
    // what the same ramp would have peaked at with the supported marathons removed, and
    // which races cost it the difference. Frozen so the reason survives the season even
    // after those races are run and drop off the forward calendar.
    soloPeakMi: Number(soloPeakMi) || null,
    raceCostMi: Number(raceCostMi) || null,
    costlyRaces: Array.isArray(costlyRaces) && costlyRaces.length ? costlyRaces.slice(0, 6) : null,
    aRaceDate, aRaceName,
    baseAtCommit: Number(baseAtCommit) || null,
    demonstratedAtCommit: Number(demonstratedAtCommit) || null,
    ratioAtCommit: Number(ratioAtCommit) || null,
    verdictAtCommit: verdictAtCommit || null,
    weeks: Number(weeks) || null,
    // The block's actual bounds. `weeks` + committedAt was enough to COUNT weeks but not to
    // place them: a plan applied on a Saturday for a block starting the following Monday
    // would read as one week elapsed on day two. The keys are the truth; the count is not.
    firstWeekKey: typeof firstWeekKey === 'string' ? firstWeekKey : null,
    lastWeekKey: typeof lastWeekKey === 'string' ? lastWeekKey : null,
    committedAt: committedAt || new Date().toISOString(),
    // ── THE FROZEN TRIAD ──────────────────────────────────────────────────────────────
    // The three numbers that were printed on every run day of this block, as they were on
    // the day the athlete agreed to them. Written by planTiers.packTriad({rungs, weeks}).
    //
    // WHY IT MUST BE FROZEN RATHER THAN RECOMPUTED. The rebase rule asks "did you hit Reach
    // on 70% of sessions over the last four weeks", and the last four weeks are in the PAST.
    // The live triad is built FORWARD from today, so it cannot answer a question about a week
    // that has already happened; recomputing one for a past week would mean rebuilding a block
    // from a base that has since moved, and grading old runs against numbers the athlete was
    // never shown. That is a second, quietly different idea of what "Reach" meant that week —
    // precisely the parallel-systems failure this codebase refuses.
    //
    // It belongs HERE rather than in its own key for the same reason everything else in this
    // record does: it is a fact about the moment of choosing, it dies with the commitment, and
    // a triad that outlived the plan it was cut from would grade runs against a plan nobody is
    // running. Kept small by packTriad — only tierable days with a real spread, three integers
    // each — so a 20-week block is a few dozen short arrays, not a second copy of the plan.
    triad: (triad && typeof triad === 'object' && triad.weeks) ? triad : null,
  };
  try { storage.set('planCommitment', rec, { skipValidation: true }); } catch { return null; }
  return rec;
}

/**
 * Drop it. Called when the plan is pulled off the calendar — a commitment to a
 * plan that is no longer there is just a stale accusation.
 */
export function clearCommitment() {
  try { storage.set('planCommitment', null, { skipValidation: true }); } catch {}
}

/**
 * Is the stored commitment still about the race we are looking at? A commitment
 * to Berlin says nothing about how Valencia is going.
 */
export function commitmentAppliesTo(commitment, aRaceDate) {
  if (!commitment || !commitment.aRaceDate || !aRaceDate) return false;
  return commitment.aRaceDate === aRaceDate;
}

export default getCommitment;
