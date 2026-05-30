// ─── Coach Engine — v2 trade-off articulation ─────────────────────────────
//
// Phase 4r.coach.v2 (2026-05-24). See COACH.md for full spec.
//
// Reads userState (including v1 coachSignals) and emits "coach briefs"
// — structured messages in coach voice with three parts:
//   1. acknowledge: the situation, specific, with real numbers
//   2. mechanism: the why — what's actually happening physiologically
//   3. nextAction: ONE concrete action with a timeline
//
// Each brief carries a state (act / watch / aligned) so the UI can
// rank them and pick a visual treatment. Evidence chips link back to
// the v1 signals or userState numbers that triggered the brief, so the
// user can trace any claim to its source data.
//
// Architecture: each pattern is a pure function (userState → Brief|null).
// composeCoachBriefs() runs all patterns, ranks the results, returns
// the top N. New patterns drop in without touching the composer —
// add to the PATTERNS array.
//
// Beta scope (this session):
//   - patternLeveragePoint        (sleep as bottleneck on multiple goals)
//   - patternRaceSequencing       (cut + upcoming race trade-off)
//   - patternSustainability       (goal pace vs current capacity)
//   - patternEnergyAvailability   (EA below endocrine threshold)
//   - patternPersonalCorrelation  (when v1's sleep→HRV correlation surfaces)
//   - patternMutualReinforcement  (positive callout: goals supporting each other)
//   - patternAlignedBaseline      (fallback: name the calm when nothing else fires)

import { computeUserState } from './intelligence.js';
import { storage } from './storage.js';
import { getGoals } from './goals.js';
// Phase 4r.utc.2 — local-timezone day. Replaces UTC fallbacks across the file.
import { localDate } from './time.js';
// Phase 4r.coach.v2.hyrox.fix — use the unified activity universe
// (storage activities + FIT entries from dailyLogs) so manually-
// entered workouts and Garmin-imported sessions both get counted.
import { allActivities } from './dcyMath.js';
// Phase 4r.test.1 — classifier lives in a leaf module so the Node fixture
// test can import it without pulling in storage / IndexedDB.
import { classifyActivityForHyrox } from './coach/classifyActivity.js';
export { classifyActivityForHyrox };

// ─── Constants ─────────────────────────────────────────────────────────────

const STATE_RANK = { act: 3, watch: 2, aligned: 1 };

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt1(n) { return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '—'; }
function fmt0(n) { return Number.isFinite(n) ? Math.round(n).toString() : '—'; }

function daysUntil(dateIso) {
  if (!dateIso) return null;
  const target = new Date(dateIso + 'T00:00:00').getTime();
  const today  = new Date(localDate() + 'T00:00:00').getTime();
  return Math.round((target - today) / 86400000);
}

// Pull the soonest A/B priority race from goals storage. Returns
// { days, name, priority } or null.
function getNextRace() {
  try {
    const g = storage.get('goals');
    const races = Array.isArray(g?.races) ? g.races : [];
    const upcoming = races
      .map(r => ({ ...r, _days: daysUntil(r?.date) }))
      .filter(r => r._days != null && r._days >= 0)
      .sort((a, b) => a._days - b._days);
    if (!upcoming.length) return null;
    const r = upcoming[0];
    // Phase 4r.coach.v2.hyrox — include `type` so format-aware patterns
    // can detect HYROX (vs generic race) and produce tailored briefs.
    return {
      days: r._days,
      name: r.name || 'Race',
      type: r.type || null,
      priority: (r.priority || 'A').toUpperCase(),
    };
  } catch { return null; }
}

// Phase 4r.coach.v2.hyrox — helpers used by the HYROX-aware patterns.
// Detects whether the upcoming race is a HYROX by `type` field or
// fuzzy-match on the name (users may not have set type correctly).
function isHyrox(race) {
  if (!race) return false;
  if (race.type && String(race.type).toLowerCase() === 'hyrox') return true;
  if (race.name && /hyrox/i.test(race.name)) return true;
  return false;
}

// Pull activities from the last N days. Used by HYROX patterns to
// check modality coverage + intensity prep without bloating
// userState.coachSignals with race-specific aggregations.
//
// Phase 4r.coach.v2.hyrox.fix — reads `allActivities()` (storage +
// dailyLogs.fitActivities merged) rather than raw `storage.get('activities')`,
// so manually-entered workouts AND Garmin-imported sessions both get
// counted. Previously, manual SkiErg/Rowing entries weren't being
// detected when they lived in the dailyLogs.fitActivities path or had
// non-Garmin field shapes.
function getRecentActivities(days = 14) {
  try {
    const acts = allActivities() || [];
    const today = localDate();
    const cutoff = daysUntil_str(today, -days);
    return acts.filter(a => a?.date && a.date >= cutoff && a.date <= today);
  } catch { return []; }
}

// Returns YYYY-MM-DD N days from todayStr (negative = past, positive = future).
function daysUntil_str(todayStr, offset) {
  const d = new Date(todayStr + 'T00:00:00');
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Classify an activity into one of the HYROX modality buckets.
// Returns 'running', 'erg', 'strength', 'metcon', or 'other'.
//
// Phase 4r.coach.v2.hyrox.fix — checks ALL field-name variants. Garmin
// imports use `activityType`, FIT entries use `title`, manual entries
// may use `activityName`, `name`, or `notes`. User feedback 2026-05-25:
// "I have done 2 SkiErg + 2 Rowing sessions manually that Arnold isn't
// detecting" — those entries had the modality in `title` /
// `activityName`, not `type`/`activityType`.
// classifyActivityForHyrox now lives in ./coach/classifyActivity.js
// (re-exported at the top of this file) so the Node fixture test can
// import the classifier without bringing in storage / IndexedDB.

// ─── Pattern: Leverage point — sleep bottleneck ────────────────────────────
// Fires when sleep debt is moderate/severe AND downstream signals
// (HRV depression, RHR drift) confirm the impact. The point of this
// brief: sleep is a single lever that, if fixed, unblocks recovery,
// cut, and training quality simultaneously.

function patternLeveragePoint(us) {
  const cs = us?.coachSignals;
  if (!cs) return null;

  const sd  = cs.sleepDebt;
  const hrv = cs.hrvDepression;
  const rhr = cs.rhrDrift;

  const sleepBad = sd && (sd.status === 'moderate' || sd.status === 'severe');
  if (!sleepBad) return null;

  const hrvAffected = hrv && (hrv.status === 'moderate' || hrv.status === 'severe');
  const rhrAffected = rhr && (rhr.status === 'rising' || rhr.status === 'concerning');
  const downstreamHit = hrvAffected || rhrAffected;

  const goals = us.activeGoalKinds || {};
  const goalCount = [goals.weightCut, goals.endurance, goals.racePrep, goals.strength]
    .filter(Boolean).length;

  // Only fire if sleep is clearly the leverage — bad sleep + downstream
  // hit OR bad sleep + multiple active goals to protect.
  if (!downstreamHit && goalCount < 2) return null;

  const state = (sd.status === 'severe' || (hrv?.status === 'severe' || rhr?.status === 'concerning'))
    ? 'act' : 'watch';

  const ack = `Sleep is the leverage point this week — averaging ${fmt1(sd.avgHours7d)}h across 7 nights (deficit ${fmt1(sd.debt7d)}h vs ${sd.targetHours}h target).`;

  let mech = 'Chronic short sleep keeps cortisol elevated, blunts fat oxidation, and slows recovery';
  if (hrvAffected) mech += ` — your HRV is down ${fmt0(hrv.depressionMs)}ms vs your 28-day baseline`;
  if (rhrAffected) mech += `${hrvAffected ? ' and' : ' —'} resting HR is creeping up ${fmt1(rhr.slopeBpmPerWeek)}bpm/wk`;
  mech += '. Fixing sleep is the single lever that moves recovery, cut, and training quality together.';

  const nextAction = 'Add 1h tonight (lights out 1h earlier). Re-measure HRV + scale weight in 7 days before adjusting anything else in the plan.';

  const evidence = [
    { label: 'sleep 7d',     value: `${fmt1(sd.avgHours7d)}h avg · ${fmt1(sd.debt7d)}h debt` },
    hrvAffected ? { label: 'HRV',   value: `${fmt0(hrv.latest)}ms (base ${fmt0(hrv.baseline28d)}, ${hrv.consecutiveDepressedDays}d depressed)` } : null,
    rhrAffected ? { label: 'RHR',   value: `${fmt0(rhr.latest)}bpm · slope +${fmt1(rhr.slopeBpmPerWeek)}/wk` } : null,
  ].filter(Boolean);

  const goalsAff = [];
  if (goals.weightCut) goalsAff.push('weight cut');
  if (goals.racePrep)  goalsAff.push('race recovery');
  if (goals.endurance) goalsAff.push('endurance training');
  if (goals.strength)  goalsAff.push('strength gains');

  return {
    id: 'sleep-leverage',
    priority: 1,
    state,
    pillarsAffected: ['Recover', 'Body', 'Train'],
    goalsAffected: goalsAff,
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence,
    confidence: downstreamHit ? 0.9 : 0.7,
  };
}

// ─── Pattern: Race sequencing — cut + upcoming race ────────────────────────
// Fires when there's an active cut AND a race within 28 days. Names
// the trade-off and gives the sequencing rule (pause cut N days before
// race, maintenance through race week, resume after).

function patternRaceSequencing(us) {
  const goals = us?.activeGoalKinds || {};
  if (!goals.weightCut) return null;

  const race = getNextRace();
  if (!race || race.days > 28) return null;
  // Phase 4r.coach.v2.hyrox — HYROX races get their own format-aware
  // pattern set (patternHyroxGlycogenWindow, patternHyroxStationCoverage,
  // patternHyroxStrengthReadiness, patternHyroxPacingPrep). Skip the
  // generic sequencing brief to avoid duplicating + drowning out the
  // HYROX-specific guidance.
  if (isHyrox(race)) return null;

  const state = race.days <= 10 ? 'act' : 'watch';

  const ack = `Your ${race.name} race is in ${race.days}d while you're cutting. These need sequencing, not parallel execution.`;

  const mech = race.days <= 10
    ? `Race week wants full glycogen and rested legs; deficit blunts both. Cutting through the next ${race.days} days → ~1-2% glycogen-low at start line → measurably slower across the distance.`
    : `Cut and race-prep can coexist outside peak week, but the closer you get, the more recovery + glycogen win. Sequencing now beats compromising later.`;

  const nextAction = race.days <= 10
    ? `Pause the cut today: switch to maintenance kcal (use derived target + 250 kcal) through race day. Resume cut on Day ${race.days + 1}.`
    : `Plan to pause the cut ${Math.max(7, race.days - 7)}d out — i.e. around the start of race week. Until then, hold the current cut targets.`;

  return {
    id: 'race-sequencing',
    priority: 2,
    state,
    pillarsAffected: ['Goal', 'Fuel'],
    goalsAffected: ['weight cut', `${race.name} race`],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'race',     value: `${race.name} · ${race.priority}-priority` },
      { label: 'days out', value: `${race.days}d` },
      { label: 'phase',    value: us.phase || '—' },
    ],
    confidence: 0.9,
  };
}

// ─── Pattern: Sustainability — goal pace vs capacity ───────────────────────
// Fires when the goal trajectory demands more than the system can
// sustainably deliver (cut rate > 1.0 lb/wk, OR at RMR floor with no
// headroom, OR EA deficient while strain is elevated).

function patternSustainability(us) {
  const n = us?.numbers || {};
  const burdens = new Set(us?.burdens || []);
  const cs = us?.coachSignals || {};

  const aggressive = burdens.has('goal-aggressive') || (n.requiredLossRate != null && n.requiredLossRate > 1.0);
  const atFloor    = burdens.has('cut-at-floor') || us?.phase === 'cut-at-floor';
  const eaThin     = cs.energyAvailability?.status === 'low' || cs.energyAvailability?.status === 'deficient';
  const highStrain = cs.monotonyStrain?.status === 'high-strain';

  // Fire when the pace is structurally unsustainable, not just hard.
  if (!aggressive && !(atFloor && (eaThin || highStrain))) return null;

  const state = atFloor || cs.energyAvailability?.status === 'deficient' ? 'act' : 'watch';

  let ack;
  if (aggressive) {
    ack = `Your goal pace requires ${fmt1(n.requiredLossRate)} lb/wk, which sits above the 1.0 lb/wk sustainability ceiling.`;
  } else {
    ack = `You're at the RMR floor — there's no more deficit to add without entering metabolic adaptation.`;
  }

  let mech = '';
  if (aggressive) {
    mech = `Cutting faster than ~1 lb/wk forces the body to defend itself: RMR drops, leptin falls, lean mass starts going, and the cut stalls anyway. The math says "push harder"; the physiology says "no."`;
  } else if (atFloor) {
    mech = `At the floor, additional deficit doesn't translate to additional loss — RMR adapts downward to match intake. The lever stops being kcal-out and becomes time.`;
  }
  if (eaThin && cs.energyAvailability) {
    mech += ` Your energy availability is at ${fmt0(cs.energyAvailability.eaKcalPerKgLBM)} kcal/kg LBM (≥40 = sufficient; <30 = endocrine impact).`;
  }

  const nextAction = aggressive
    ? `Push the target date out so required pace drops to ≤0.75 lb/wk, OR accept slower progress at the current pace. Don't tighten the deficit further.`
    : `Hold intake at the current derived target. Extending the date is the lever now; tightening the deficit is not.`;

  const evidence = [
    n.requiredLossRate != null ? { label: 'pace required', value: `${fmt1(n.requiredLossRate)} lb/wk` } : null,
    n.actualLossRate != null   ? { label: 'pace actual',   value: `${fmt1(n.actualLossRate)} lb/wk` } : null,
    n.goalTarget != null && n.rmr != null ? { label: 'kcal vs RMR', value: `${fmt0(n.goalTarget)} / ${fmt0(n.rmr)}` } : null,
    cs.energyAvailability?.eaKcalPerKgLBM != null ? { label: 'EA', value: `${fmt0(cs.energyAvailability.eaKcalPerKgLBM)} kcal/kg LBM` } : null,
  ].filter(Boolean);

  return {
    id: 'sustainability-check',
    priority: 2,
    state,
    pillarsAffected: ['Goal', 'Body'],
    goalsAffected: ['weight cut'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence,
    confidence: 0.85,
  };
}

// ─── Pattern: Energy availability ──────────────────────────────────────────
// Fires when EA is below sufficient threshold (independent of why).
// Often co-fires with sustainability but stays separate because the
// action is different (eat more today vs change the plan).

function patternEnergyAvailability(us) {
  const ea = us?.coachSignals?.energyAvailability;
  if (!ea || ea.status === 'sufficient' || ea.status === 'insufficient-data') return null;

  const state = ea.status === 'deficient' ? 'act' : 'watch';

  const ack = ea.status === 'deficient'
    ? `Energy availability today is ${fmt0(ea.eaKcalPerKgLBM)} kcal/kg LBM — below the 30 kcal/kg endocrine-impact threshold.`
    : `Energy availability today is ${fmt0(ea.eaKcalPerKgLBM)} kcal/kg LBM — between 30 and 40, the "low" zone where recovery + adaptation start to suffer.`;

  const mech = `EA = (intake − exercise kcal) / lean mass. You're at ${fmt0(ea.netKcal)} kcal net over ${fmt1(ea.lbmKg)}kg LBM. Below 40 kcal/kg, the body starts down-regulating hormones, thyroid, bone turnover. Below 30 it gets worse fast.`;

  const deficitToFix = Math.max(0, Math.round((40 - ea.eaKcalPerKgLBM) * ea.lbmKg));
  const nextAction = `Add ${deficitToFix} kcal today (carbs + protein around training), or scale back today's exercise kcal. Either gets EA into the safe zone before tonight.`;

  return {
    id: 'energy-availability',
    priority: 3,
    state,
    pillarsAffected: ['Fuel', 'Body'],
    goalsAffected: ['recovery', 'hormonal health'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'EA',       value: `${fmt0(ea.eaKcalPerKgLBM)} kcal/kg LBM` },
      { label: 'intake',   value: `${fmt0(ea.intakeKcal)} kcal` },
      { label: 'exercise', value: `${fmt0(ea.exerciseKcal)} kcal` },
      { label: 'LBM',      value: `${fmt1(ea.lbmKg)} kg` },
    ],
    confidence: 0.95,
  };
}

// ─── Pattern: TDEE drift (Phase 4r.signals.2) ──────────────────────────────
// Fires when the empirical 4-week TDEE has diverged ≥5% from the prior
// 4-week baseline. Two failure modes (adapting / starvation) call for
// action; rebounding is a positive callout that the body's spend is
// recovering. Stable + insufficient stay quiet.
//
// Why this is its own brief rather than folded into EA: EA is a single-day
// snapshot ("today's intake supports recovery?"). TDEE drift is a 4-8 week
// metabolic signal ("is your maintenance level itself moving?"). They
// answer different questions and can fire independently — you can have
// sufficient EA today while quietly adapting downward over weeks.

function patternTdeeDrift(us) {
  const td = us?.coachSignals?.tdeeDrift;
  if (!td || td.status === 'stable' || td.status === 'insufficient') return null;
  // Confidence floor: don't fire on 'low' — too much noise to act on.
  if (td.confidence === 'low') return null;

  const cutting = !!(us?.activeGoalKinds?.weightCut);

  if (td.status === 'starvation') {
    return {
      id: 'tdee-drift-starvation',
      priority: 1,
      state: 'act',
      pillarsAffected: ['Fuel', 'Body'],
      goalsAffected: ['weight cut', 'hormonal health'],
      acknowledge: `Your empirical TDEE has fallen ${Math.abs(td.driftPct)}% over the last 4 weeks (${td.baselineTdee} → ${td.recentTdee} kcal/day).`,
      mechanism: `Drops past 15% are deep metabolic adaptation territory — thyroid, leptin, NEAT all defending body weight. The same deficit you held in the prior month is producing meaningfully less loss now, and the longer this runs the harder it gets to reverse.`,
      nextAction: `Schedule a 2-4 week diet break at maintenance (around ${td.recentTdee} kcal). Re-measure TDEE after; the goal is to see this number trend back up before resuming a deficit.`,
      evidence: [
        { label: 'recent 4wk TDEE',   value: `${td.recentTdee} kcal` },
        { label: 'baseline 4wk TDEE', value: `${td.baselineTdee} kcal` },
        { label: 'drift',             value: `${td.driftKcal > 0 ? '+' : ''}${td.driftKcal} kcal (${td.driftPct > 0 ? '+' : ''}${td.driftPct}%)` },
        { label: 'confidence',        value: td.confidence },
      ],
      confidence: td.confidence === 'high' ? 0.9 : 0.75,
    };
  }

  if (td.status === 'adapting') {
    return {
      id: 'tdee-drift-adapting',
      priority: 3,
      state: cutting ? 'act' : 'watch',
      pillarsAffected: ['Fuel', 'Body'],
      goalsAffected: cutting ? ['weight cut'] : ['energy availability'],
      acknowledge: `Your empirical TDEE has dropped ${Math.abs(td.driftPct)}% in the last 4 weeks (${td.baselineTdee} → ${td.recentTdee} kcal/day).`,
      mechanism: `This is the body's classic cut response — defending weight by lowering daily energy spend. Not inherently bad (it confirms the deficit is real), but the same intake will produce ~${Math.abs(td.driftPct)}% slower loss going forward. Keep the cut here and the curve flattens.`,
      nextAction: cutting
        ? `Hold the current intake but add 1500-2000 steps/day to lift NEAT, OR schedule a 7-day diet break at maintenance (~${td.recentTdee} kcal) to reset hormones before the deficit gets harder.`
        : `No action needed if you're not actively cutting — this is information. If you do start a deficit, baseline maintenance is closer to ${td.recentTdee} than ${td.baselineTdee} now.`,
      evidence: [
        { label: 'recent 4wk TDEE',   value: `${td.recentTdee} kcal` },
        { label: 'baseline 4wk TDEE', value: `${td.baselineTdee} kcal` },
        { label: 'drift',             value: `${td.driftKcal} kcal (${td.driftPct}%)` },
        { label: 'confidence',        value: td.confidence },
      ],
      confidence: td.confidence === 'high' ? 0.85 : 0.7,
    };
  }

  if (td.status === 'rebounding') {
    return {
      id: 'tdee-drift-rebounding',
      priority: 5,
      state: 'aligned',
      pillarsAffected: ['Fuel', 'Body'],
      goalsAffected: [],
      acknowledge: `Your empirical TDEE has climbed +${td.driftPct}% in the last 4 weeks (${td.baselineTdee} → ${td.recentTdee} kcal/day).`,
      mechanism: `Refeed / diet break / increased training volume — whatever caused it, the body's energy spend is recovering. If you've just been through a diet break this is the signal you waited for: TDEE is back, the cut window is open again.`,
      nextAction: `If you want to resume a deficit, ${td.recentTdee - 400}-${td.recentTdee - 250} kcal/day is a sustainable starting target (sustainable cut = ~10-15% below current empirical TDEE).`,
      evidence: [
        { label: 'recent 4wk TDEE',   value: `${td.recentTdee} kcal` },
        { label: 'baseline 4wk TDEE', value: `${td.baselineTdee} kcal` },
        { label: 'drift',             value: `+${td.driftKcal} kcal (+${td.driftPct}%)` },
      ],
      confidence: td.confidence === 'high' ? 0.85 : 0.7,
    };
  }

  return null;
}

// ─── Pattern: Recovery velocity (Phase 4r.signals.3) ────────────────────────
// Fires when the days-to-HRV-baseline after hard sessions has lengthened
// vs the user's own prior pattern. The actionable read is the DRIFT —
// "your body used to bounce back in 1.8 days; this month it's taking 2.6".
// Concerning > slowing > stable; improving is a positive callout.

function patternRecoveryVelocity(us) {
  const rv = us?.coachSignals?.recoveryVelocity;
  if (!rv || rv.status === 'insufficient') return null;
  if (rv.status === 'stable' && rv.confidence !== 'high') return null;

  if (rv.status === 'concerning' || rv.status === 'slowing') {
    const severe = rv.status === 'concerning';
    return {
      id: severe ? 'recovery-velocity-concerning' : 'recovery-velocity-slowing',
      priority: severe ? 2 : 4,
      state: severe ? 'act' : 'watch',
      pillarsAffected: ['Recover', 'Move'],
      goalsAffected: ['training capacity', 'race readiness'],
      acknowledge: `Recovery velocity has lengthened — your HRV is taking ${rv.avgDaysToRecover}d to return to baseline after hard sessions (vs ${rv.baselineAvg}d previously, ${rv.driftPct > 0 ? '+' : ''}${rv.driftPct}%).`,
      mechanism: severe
        ? `A ≥30% slowdown is the classic overreaching trajectory: same training load, slower autonomic recovery. Push another high week without addressing this and you slide into non-functional overreaching, where you train but stop adapting. The fix is dose-reduction, not a single rest day.`
        : `A 15-30% slowdown is the early-warning band. Could be cumulative load, undersleep, life stress — but it's measurable now while it's still cheap to reverse. The longer the trend runs, the more the curve steepens.`,
      nextAction: severe
        ? `Cut weekly TSS by 40% for the next 7-10 days (drop the hardest 1-2 sessions, keep volume but reduce intensity). Re-measure recovery velocity after — if it doesn't come back, that's a signal for a full deload week.`
        : `Take an easier week — drop the next planned hard session, replace with zone-2. Recheck velocity in 7 days; if it returns to baseline you're back on the curve, if not escalate to a deeper cut.`,
      evidence: [
        { label: 'recent avg',   value: `${rv.avgDaysToRecover}d (n=${rv.nRecent})` },
        { label: 'prior avg',    value: `${rv.baselineAvg}d (n=${rv.nBaseline})` },
        { label: 'drift',        value: `${rv.driftDays > 0 ? '+' : ''}${rv.driftDays}d (${rv.driftPct > 0 ? '+' : ''}${rv.driftPct}%)` },
        { label: 'confidence',   value: rv.confidence },
      ],
      confidence: rv.confidence === 'high' ? 0.85 : 0.7,
    };
  }

  if (rv.status === 'improving') {
    return {
      id: 'recovery-velocity-improving',
      priority: 5,
      state: 'aligned',
      pillarsAffected: ['Recover', 'Move'],
      goalsAffected: ['training capacity'],
      acknowledge: `Recovery velocity is faster — HRV is returning to baseline in ${rv.avgDaysToRecover}d after hard sessions (vs ${rv.baselineAvg}d previously, ${rv.driftPct}%).`,
      mechanism: `Same training load, quicker autonomic bounce-back. This is the most direct fitness signal Arnold can read — your body is adapting to the load, not just absorbing it.`,
      nextAction: `Capacity is there for a step-up. Either a +10-15% load week or a quality block (more intensity, same volume) before you'd see this margin disappear.`,
      evidence: [
        { label: 'recent avg', value: `${rv.avgDaysToRecover}d (n=${rv.nRecent})` },
        { label: 'prior avg',  value: `${rv.baselineAvg}d (n=${rv.nBaseline})` },
        { label: 'improvement', value: `${rv.driftDays}d (${rv.driftPct}%)` },
      ],
      confidence: rv.confidence === 'high' ? 0.85 : 0.7,
    };
  }

  return null;
}

// ─── Pattern: Glycogen state (Phase 4r.signals.4) ──────────────────────────
// Fires when 24h carb supply is meaningfully under what the user's training
// burned. The point is timing: low glycogen heading INTO a workout is
// where it costs you. Doesn't fire at `replete` or `moderate` — those are
// fine. `critical` fires `act`; `depleted` is `watch`.
//
// Honest about confidence: when meal timing isn't yet available (no
// timestamped Cronometer rows in the last 24h), the supplied side is a
// pro-rated full-day rollup — useful as a directional read but not a
// precise one. Brief copy reflects this.

function patternGlycogenState(us) {
  const g = us?.coachSignals?.glycogen;
  if (!g || g.status === 'replete' || g.status === 'moderate' || g.status === 'insufficient') return null;

  const lowConf = g.confidence === 'low';
  const timingNote = lowConf
    ? ' (estimated from daily rollup — accuracy improves as meal-timing data accumulates)'
    : '';

  if (g.status === 'critical') {
    return {
      id: 'glycogen-critical',
      priority: 2,
      state: 'act',
      pillarsAffected: ['Fuel', 'Move'],
      goalsAffected: ['training capacity', 'race readiness'],
      acknowledge: `Carb supply over the last 24h (${g.supplied24h}g stored) covers only ${Math.round(g.adequacyRatio * 100)}% of what your training burned (${g.need24h}g need)${timingNote}.`,
      mechanism: `Muscle glycogen is the primary fuel above ~75% HRmax. Below ~50% of replenishment need, Z4-5 work goes anaerobic earlier (lactate climbs faster, perceived effort spikes, pace drops at the same HR). Z2 work feels fine until 60-90 min in, then bonking risk rises.`,
      nextAction: `Eat 80-120g carbs in the next 2h (rice, oats, fruit, sports drink). If a hard session is in tomorrow's plan, also load dinner carbs tonight — overnight liver glycogen restoration is where most of the recovery happens.`,
      evidence: [
        { label: 'supplied 24h', value: `${g.supplied24h}g (carbs × 0.7)` },
        { label: 'need 24h',     value: `${g.need24h}g` },
        { label: 'ratio',        value: `${g.adequacyRatio}` },
        { label: 'Z4-5 min',     value: `${g.breakdown.z45Min}` },
        { label: 'confidence',   value: g.confidence },
      ],
      confidence: lowConf ? 0.5 : 0.8,
    };
  }

  // status === 'depleted'
  return {
    id: 'glycogen-depleted',
    priority: 4,
    state: 'watch',
    pillarsAffected: ['Fuel', 'Move'],
    goalsAffected: ['training capacity'],
    acknowledge: `Carb supply over the last 24h (${g.supplied24h}g) covers ${Math.round(g.adequacyRatio * 100)}% of training burn (${g.need24h}g)${timingNote}.`,
    mechanism: `You're in the band where moderate sessions still go fine but anything in Z4-5 or sustained Z3 will feel harder than it should. The body falls back on fat oxidation faster than carbs, which is metabolically slower — pace at the same HR drops a few percent.`,
    nextAction: `If a quality session is coming up in the next 24h, add 50-80g carbs before bed and another 40-60g 2h pre-workout. If today is a recovery/easy day, no action — depleted-then-replenished is part of the metabolic-flexibility training.`,
    evidence: [
      { label: 'supplied 24h', value: `${g.supplied24h}g` },
      { label: 'need 24h',     value: `${g.need24h}g` },
      { label: 'ratio',        value: `${g.adequacyRatio}` },
      { label: 'Z4-5 min',     value: `${g.breakdown.z45Min}` },
      { label: 'confidence',   value: g.confidence },
    ],
    confidence: lowConf ? 0.5 : 0.75,
  };
}

// ─── Pattern: Polarization (Phase 4r.signals.5) ────────────────────────────
// Z3 dominance + over-intense distributions both fire as concerns. Polarized
// fires as `aligned` (positive callout). Balanced / sparse-easy stay quiet
// unless the user has an endurance race goal (then sparse-easy becomes a
// watch — they need more base).

function patternPolarization(us) {
  const p = us?.coachSignals?.polarization;
  if (!p || p.status === 'insufficient' || p.status === 'balanced') return null;

  const racePrep = !!(us?.activeGoalKinds?.racePrep);
  const endurance = !!(us?.activeGoalKinds?.endurance);

  if (p.status === 'grey-zone') {
    return {
      id: 'polarization-grey-zone',
      priority: 3,
      state: 'watch',
      pillarsAffected: ['Move'],
      goalsAffected: racePrep ? ['race readiness'] : endurance ? ['endurance'] : ['training quality'],
      acknowledge: `${p.moderatePct}% of your endurance time over the last ${p.windowDays} days has been in Z3 (moderate / tempo) — above the 15% ceiling for polarized training.`,
      mechanism: `Z3 work is the classic amateur trap: it's hard enough to feel like real training but not easy enough to build aerobic base, and not hard enough to drive VO2max gains. It taxes recovery without proportional return. Stephen Seiler's research across endurance sports puts elite distribution near 80% easy / <10% Z3 / 10-15% hard. The fix is to make your easy days easier — most "Z3 by mistake" is from running easy days at moderate pace.`,
      nextAction: `Drop one Z3 session from this week's plan. Replace with either zone-2 (sustained ~70% HRmax for 45-60min) OR a true intensity session (4-6 × 3min @ Z5 with full recovery). Either is more productive than another tempo.`,
      evidence: [
        { label: 'easy (Z1-2)',     value: `${p.easyPct}% · ${p.z1Min + p.z2Min}min` },
        { label: 'moderate (Z3)',   value: `${p.moderatePct}% · ${p.z3Min}min` },
        { label: 'hard (Z4-5)',     value: `${p.hardPct}% · ${p.z4Min + p.z5Min}min` },
        { label: 'sessions',        value: `${p.nActivities} over ${p.windowDays}d` },
      ],
      confidence: 0.85,
    };
  }

  if (p.status === 'hot') {
    return {
      id: 'polarization-hot',
      priority: 3,
      state: 'watch',
      pillarsAffected: ['Move', 'Recover'],
      goalsAffected: ['training capacity', 'recovery'],
      acknowledge: `${p.hardPct}% of your endurance time over the last ${p.windowDays} days has been Z4-5 — above the ~15% ceiling that's sustainable long-term.`,
      mechanism: `High-intensity work is what drives VO2max and lactate threshold, but it's also the highest-recovery-cost training. Sustained at ≥25% it usually compresses your easy days (you bring intensity to them too) and blocks the parasympathetic recovery that hard work depends on. Net result: more training, less adaptation.`,
      nextAction: `Add a true zone-2 session this week to anchor the easy end. ~60-75min at conversational pace (≤70% HRmax). If race-prep is the driver, that's fine for a 4-6 week block — just don't sustain past that without a recovery week.`,
      evidence: [
        { label: 'easy (Z1-2)',     value: `${p.easyPct}% · ${p.z1Min + p.z2Min}min` },
        { label: 'moderate (Z3)',   value: `${p.moderatePct}% · ${p.z3Min}min` },
        { label: 'hard (Z4-5)',     value: `${p.hardPct}% · ${p.z4Min + p.z5Min}min` },
        { label: 'sessions',        value: `${p.nActivities} over ${p.windowDays}d` },
      ],
      confidence: 0.8,
    };
  }

  if (p.status === 'sparse-easy' && (racePrep || endurance)) {
    return {
      id: 'polarization-sparse-easy',
      priority: 4,
      state: 'watch',
      pillarsAffected: ['Move'],
      goalsAffected: racePrep ? ['race readiness'] : ['endurance'],
      acknowledge: `Only ${p.easyPct}% of your endurance time has been easy (Z1-2) over the last ${p.windowDays} days — base-building work is sparse relative to your race/endurance goal.`,
      mechanism: `Aerobic capacity is built primarily in zone 2. Polarized models put 75-80% of weekly time there. Below 50% easy, the engine isn't getting the stimulus that lets the harder work convert into race-day pace.`,
      nextAction: `Add 60-90min of zone-2 work this week. Conversational pace, nose-breathing if useful as a guide. The "easy" days are where the fitness gets banked.`,
      evidence: [
        { label: 'easy (Z1-2)',     value: `${p.easyPct}% · ${p.z1Min + p.z2Min}min` },
        { label: 'moderate (Z3)',   value: `${p.moderatePct}% · ${p.z3Min}min` },
        { label: 'hard (Z4-5)',     value: `${p.hardPct}% · ${p.z4Min + p.z5Min}min` },
      ],
      confidence: 0.75,
    };
  }

  if (p.status === 'polarized') {
    return {
      id: 'polarization-polarized',
      priority: 5,
      state: 'aligned',
      pillarsAffected: ['Move'],
      goalsAffected: ['endurance', 'training quality'],
      acknowledge: `Your endurance distribution is polarized: ${p.easyPct}% easy, ${p.moderatePct}% moderate, ${p.hardPct}% hard over the last ${p.windowDays} days.`,
      mechanism: `This is the distribution endurance research keeps validating — easy days easy enough to build base + hard days hard enough to drive top-end adaptation, with minimal grey-zone tax in between. The fitness signal compounds.`,
      nextAction: `Hold the pattern. The next layer is making the easy days slightly longer (volume) rather than adding more intensity.`,
      evidence: [
        { label: 'easy (Z1-2)',     value: `${p.easyPct}%` },
        { label: 'moderate (Z3)',   value: `${p.moderatePct}%` },
        { label: 'hard (Z4-5)',     value: `${p.hardPct}%` },
      ],
      confidence: 0.85,
    };
  }

  return null;
}

// ─── Pattern: Day-of-week rhythm (Phase 4r.signals.6) ──────────────────────
// Personalization brief. Surfaces the user's weekly HRV rhythm so they can
// plan around it — schedule the hardest session for their best-recovered
// day, plan recovery work for the consistently-flat day. Fires as
// `aligned` because it's informational, not a concern (unless we ever
// detect a genuinely concerning pattern, which today's signal doesn't).

function patternDowRhythm(us) {
  const d = us?.coachSignals?.dowPatterns;
  if (!d || d.status !== 'meaningful') return null;
  const todayDow = (() => {
    try {
      const dt = new Date((d.asOf || '') + 'T12:00:00');
      return dt.getDay();
    } catch { return null; }
  })();
  const todayIsTheLow = todayDow != null && todayDow === d.lowestDow.dow;
  const todayIsTheHigh = todayDow != null && todayDow === d.highestDow.dow;

  const todayContext = todayIsTheLow
    ? ` Today is ${d.lowestDow.label} — expect the dip; this is the day to ease back, not push.`
    : todayIsTheHigh
      ? ` Today is ${d.highestDow.label} — your best-recovered day on average. Use it for quality.`
      : '';

  const ack = `Across 90 days of HRV, your weekly rhythm shows a ${d.spreadMs}ms spread (${d.spreadPct}%) between days: ${d.lowestDow.label} averages ${d.lowestDow.mean}ms (${d.lowestDow.vsOverallMs > 0 ? '+' : ''}${d.lowestDow.vsOverallMs}ms vs weekly mean), ${d.highestDow.label} averages ${d.highestDow.mean}ms (${d.highestDow.vsOverallMs > 0 ? '+' : ''}${d.highestDow.vsOverallMs}ms).${todayContext}`;

  return {
    id: 'dow-rhythm',
    priority: 5,
    state: 'aligned',
    pillarsAffected: ['Recover', 'Move'],
    goalsAffected: ['training quality'],
    acknowledge: ack,
    mechanism: `Most athletes have a stable weekly HRV rhythm shaped by their training pattern, work schedule, and lifestyle. Yours has ${Math.abs(d.lowestDow.vsOverallPct) >= 15 ? 'a clear' : 'a measurable'} dip on ${d.lowestDow.label} and best-recovered window on ${d.highestDow.label}. Arnold can see this from 90 days of data; you've probably felt it without having the number to point at.`,
    nextAction: `Schedule the hardest session of your week on ${d.highestDow.label} (or the day before — recovery state on the day matters more than the workout-day HRV). Use ${d.lowestDow.label} as a recovery / easy session day. Re-check this brief monthly — if the pattern shifts, your training has shifted with it.`,
    evidence: [
      { label: 'best day',  value: `${d.highestDow.label} · ${d.highestDow.mean}ms (n=${d.highestDow.n})` },
      { label: 'worst day', value: `${d.lowestDow.label} · ${d.lowestDow.mean}ms (n=${d.lowestDow.n})` },
      { label: 'spread',    value: `${d.spreadMs}ms (${d.spreadPct}%)` },
      { label: 'overall',   value: `${d.overallMean}ms · n=${d.n}` },
    ],
    confidence: 0.85,
  };
}

// ─── Pattern: Sleep quality / architecture (Phase 4r.signals.8a) ──────────
// Complements sleep debt. Debt is "did you sleep enough hours". Quality is
// "did those hours deliver restoration". They can disagree: an 8h night of
// fragmented light sleep is worse than a 7h consolidated one. This brief
// fires when quality is impaired — especially when duration is fine (so
// the user has the "I slept enough, why am I tired?" moment named for them).

function patternSleepQuality(us) {
  const sq = us?.coachSignals?.sleepQuality;
  if (!sq || sq.status === 'insufficient' || sq.status === 'restorative') return null;

  // Check if duration is actually fine — if it is, the brief is about
  // quality specifically (high signal). If duration is ALSO low, the
  // sleep-debt brief is already firing and we don't want to spam.
  const sd = us?.coachSignals?.sleepDebt;
  const durationOk = sd && (sd.status === 'paid' || sd.status === 'mild');

  // Skip if duration is the problem — sleep-debt brief covers that.
  if (!durationOk && sq.status !== 'impaired') return null;

  const weakness = sq.weaknesses?.[0]; // most relevant weakness
  const others = sq.weaknesses?.slice(1) || [];
  const otherList = others.length
    ? ` Also under target: ${others.map(w => w.label).join(', ')}.`
    : '';

  const ack = durationOk
    ? `Your sleep duration is fine this week, but the architecture is ${sq.status} — meeting ${sq.targetsMet}/4 quality targets. Weakest: ${weakness?.label} (${weakness?.actual} vs ${weakness?.target}).${otherList}`
    : `Sleep quality is ${sq.status} this week (${sq.targetsMet}/4 targets met) on top of the duration shortfall. Weakest: ${weakness?.label} (${weakness?.actual} vs ${weakness?.target}).${otherList}`;

  const mechByWeakness = {
    deep:  'Deep sleep (Stage N3) is when physical recovery happens — growth hormone release, glycogen restoration, muscle repair. Below 13% of total sleep, the next-day HRV and RHR signals you\'re seeing don\'t have much room to recover.',
    rem:   'REM sleep is where the autonomic system + cognitive consolidation happen. Below 18%, decision-making and emotional regulation suffer, and your perception of training effort climbs even at the same physical load.',
    eff:   'Sleep efficiency below 85% means meaningful awake time inside the bedroom window — light sleep, brief arousals, or fragmented continuity. The watch sees the difference; you feel it as "I slept a long time but don\'t feel rested."',
    awake: 'More than 3 wake events per night is fragmented sleep — even if the total hours look fine, the architecture is broken into pieces too short for deep + REM consolidation.',
  };
  const mech = mechByWeakness[weakness?.key] || 'Sleep quality has multiple dimensions; the dominant weakness this week is the one most likely worth fixing first.';

  const actionByWeakness = {
    deep:  'Cooler bedroom (≤19°C / 66°F), darker (blackout or eye mask), no alcohol within 4h of bed, no high-intensity exercise within 3h. Of those, temperature and alcohol have the largest effects on deep%.',
    rem:   'REM is sensitive to alcohol (suppresses it disproportionately) and to morning sleep (REM clusters in the second half of the night — earlier wake = less REM). Push bedtime earlier rather than oversleeping.',
    eff:   'Continuity-killers: late caffeine, late large meals, evening blue light, room too warm. Pick the most plausible one for your week and remove it for 5 nights — recheck.',
    awake: 'Wake events usually trace to caffeine half-life (8h+), late alcohol, or environmental noise. A nightcap of 1 drink can multiply wake events 2-3× without changing total time.',
  };
  const action = actionByWeakness[weakness?.key] || 'Pick the weakest dimension to address first; one good experiment per week is faster than four half-measures.';

  return {
    id: `sleep-quality-${weakness?.key || 'mixed'}`,
    priority: durationOk ? 3 : 4,
    state: sq.status === 'impaired' ? 'act' : 'watch',
    pillarsAffected: ['Recover'],
    goalsAffected: ['recovery', 'training capacity'],
    acknowledge: ack,
    mechanism: mech,
    nextAction: action,
    evidence: [
      { label: 'deep',  value: `${sq.deepAvgPct}% (target ≥13%)` },
      { label: 'rem',   value: `${sq.remAvgPct}% (target ≥18%)` },
      { label: 'eff',   value: `${sq.effAvgPct}% (target ≥85%)` },
      { label: 'wakes/night', value: `${sq.awakeAvg} (target ≤3)` },
      { label: 'nights',     value: `${sq.n}` },
    ],
    confidence: 0.85,
  };
}

// ─── Pattern: Garmin readiness cross-check (Phase 4r.signals.8b) ───────────
// Surfaces when Garmin's training-readiness composite is low AND points at
// the factor Garmin thinks is the cause. The point is corroboration — if
// Arnold and Garmin agree, the read is high-confidence; if they disagree,
// the brief names the disagreement so the user can decide.

function patternGarminReadiness(us) {
  const gr = us?.coachSignals?.garminReadiness;
  if (!gr || gr.status === 'insufficient') return null;
  // Only fire when readiness is limited or poor. Strong/moderate stays
  // quiet (no signal to surface).
  if (gr.status === 'strong' || gr.status === 'moderate') return null;

  // Are Arnold's signals corroborating?
  const cs = us?.coachSignals || {};
  const arnoldConcerns = [];
  if (cs.sleepDebt?.status === 'moderate' || cs.sleepDebt?.status === 'severe') arnoldConcerns.push('sleep debt');
  if (cs.hrvDepression?.status === 'moderate' || cs.hrvDepression?.status === 'severe') arnoldConcerns.push('HRV');
  if (cs.rhrDrift?.status === 'rising' || cs.rhrDrift?.status === 'concerning') arnoldConcerns.push('RHR');
  if (cs.recoveryVelocity?.status === 'slowing' || cs.recoveryVelocity?.status === 'concerning') arnoldConcerns.push('recovery velocity');
  const corroborated = arnoldConcerns.length > 0;

  const severe = gr.status === 'poor';
  const factorLabel = gr.weakestFactor?.label || 'multiple factors';

  const ack = corroborated
    ? `Garmin training readiness is ${gr.score}/100 (${gr.level || gr.status}). Arnold's signals agree: ${arnoldConcerns.join(', ')} ${arnoldConcerns.length > 1 ? 'are' : 'is'} also flagged. The agreement is high-confidence — back off today.`
    : `Garmin training readiness is ${gr.score}/100 (${gr.level || gr.status}) but Arnold's recovery signals look acceptable. Garmin attributes the dip to ${factorLabel}.`;

  const mech = corroborated
    ? `Two independent composites pointing at the same load-recovery imbalance is the strongest cross-domain signal we have. Garmin's weighting (${factorLabel} ${gr.weakestFactor?.pct}% drag) and Arnold's patterns are looking at overlapping but not identical inputs — when they agree, the read is robust.`
    : `Garmin sees something in its inputs (${factorLabel}) that Arnold's current signals don't capture. Common reason: Garmin's stress-history factor uses 24h HR variability that Arnold doesn't read yet, OR an ACWR spike on a workout-type that didn't trigger Arnold's hard-session threshold. Worth heeding cautiously.`;

  const action = severe
    ? `Treat today as a recovery day. If a workout is planned, downgrade — easy zone-2 or skip. Garmin's "poor" readiness band correlates with elevated injury + illness risk for the next 24-48h.`
    : `Drop intensity on today's session. Replace planned threshold/Z4-5 work with zone-2; keep volume if you want. ${gr.recoveryHours ? `Garmin says ${gr.recoveryHours}h to full recovery — plan accordingly.` : ''}`;

  return {
    id: corroborated ? 'garmin-readiness-corroborated' : 'garmin-readiness-disagreement',
    priority: severe ? 2 : 3,
    state: severe ? 'act' : 'watch',
    pillarsAffected: ['Recover', 'Move'],
    goalsAffected: ['training quality', 'recovery'],
    acknowledge: ack,
    mechanism: mech,
    nextAction: action,
    evidence: [
      { label: 'readiness',       value: `${gr.score}/100 (${gr.level || gr.status})` },
      { label: 'weakest factor',  value: `${factorLabel}${gr.weakestFactor?.pct != null ? ` · ${gr.weakestFactor.pct}%` : ''}` },
      gr.recoveryHours != null ? { label: 'recovery time', value: `${gr.recoveryHours}h` } : null,
      corroborated ? { label: 'Arnold agrees on', value: arnoldConcerns.join(', ') } : { label: 'Arnold sees',  value: 'no concern' },
    ].filter(Boolean),
    confidence: corroborated ? 0.92 : 0.7,
  };
}

// ─── Pattern: Personal correlation surfaced ────────────────────────────────
// Fires when v1's sleepHrvCorrelation is surfaceable (n≥30, |r|≥0.3).
// This is the "Arnold learned something about you" moment. It's not
// urgent — it's confidence-building, showing the system is personalising.

function patternPersonalCorrelation(us) {
  // Phase 4r.signals.7 — iterate over ALL surfaceable personal correlations,
  // not just sleep↔HRV. Each correlation gets its own framing copy keyed
  // on a `correlationId` slot so the brief renders the most useful insight
  // (highest |r| × confidence). Brief id keeps the surfaced correlation's
  // name so feedback suppression / dedupe still work per-correlation.
  const cs = us?.coachSignals || {};
  const candidates = [
    {
      id:    'sleep-hrv',
      corr:  cs.sleepHrvCorrelation,
      pillars: ['Recover'],
      ackTpl: (c) => `+1h sleep ≈ ${c.slope > 0 ? '+' : ''}${fmt1(c.slope)}ms HRV next day for you (n=${c.n}, r=${fmt1(c.r)}).`,
      mechTpl: (c) => `${c.n} sleep-to-next-day-HRV pairs over the last 60 days. This is YOUR sleep response, not a textbook one.`,
      actionTpl: (c) => `Sleep-extension recommendations now reference this number — Arnold can project the HRV gain you'd actually see from extending sleep tonight.`,
      slopeChip: (c) => ({ label: 'slope', value: `${c.slope > 0 ? '+' : ''}${fmt1(c.slope)}ms / +1h sleep` }),
    },
    {
      id:    'sleep-rhr',
      corr:  cs.sleepRhrCorr,
      pillars: ['Recover'],
      ackTpl: (c) => `+1h sleep ≈ ${c.slope > 0 ? '+' : ''}${fmt1(c.slope)}bpm next-day RHR for you (n=${c.n}, r=${fmt1(c.r)}).`,
      mechTpl: (c) => `${c.n} sleep-to-next-day-RHR pairs over the last 60 days. Negative slope = your RHR drops when you sleep more; that's the parasympathetic recovery showing up the next morning.`,
      actionTpl: () => `Treat RHR + HRV as one composite signal — sleep moves both. If both ease back into baseline after a short night extension, the system worked.`,
      slopeChip: (c) => ({ label: 'slope', value: `${c.slope > 0 ? '+' : ''}${fmt1(c.slope)}bpm / +1h sleep` }),
    },
    {
      id:    'sleep-run-quality',
      corr:  cs.sleepRunQualityCorr,
      pillars: ['Move', 'Recover'],
      ackTpl: (c) => `+1h sleep ≈ ${c.slope > 0 ? '+' : ''}${(c.slope * 1000).toFixed(2)} EF×1000 on the next-day run for you (n=${c.n}, r=${fmt1(c.r)}).`,
      mechTpl: (c) => `${c.n} sleep-night → next-day-run pairs. EF = pace ÷ HR — a positive sleep coefficient means you run faster at the same heart rate when you sleep more. The fitness benefit of an extra hour shows up as race-day pace.`,
      actionTpl: () => `If you have a quality run planned, prioritize sleep the night before more than the night before the night before — the carryover is short.`,
      slopeChip: (c) => ({ label: 'slope', value: `${(c.slope * 1000).toFixed(2)} EF×1000 / +1h` }),
    },
    {
      id:    'deficit-hrv',
      corr:  cs.deficitHrvCorr,
      pillars: ['Fuel', 'Recover'],
      ackTpl: (c) => `Each 500 kcal of daily deficit drops your next-day HRV by ${(c.slope * -500).toFixed(1)}ms on average (n=${c.n}, r=${fmt1(c.r)}).`,
      mechTpl: (c) => `${c.n} day-of-deficit → next-day-HRV pairs. This is your endocrine system's measurable response to underfueling — a personal threshold for how deep a cut you can sustain without recovery cost.`,
      actionTpl: () => `When the cut is producing the HRV depression that fires the recovery brief, this number tells you how much to back off (target ≤300 kcal deficit on the next 2-3 days, recheck HRV).`,
      slopeChip: (c) => ({ label: 'slope', value: `${(c.slope * 100).toFixed(2)}ms / 100kcal balance` }),
    },
    {
      id:    'load-sleep',
      corr:  cs.loadSleepCorr,
      pillars: ['Move', 'Recover'],
      ackTpl: (c) => `+100 TSS / week ≈ ${c.slope > 0 ? '+' : ''}${(c.slope * 100).toFixed(2)}h average sleep that week for you (n=${c.n} weeks, r=${fmt1(c.r)}).`,
      mechTpl: (c) => `${c.n} weekly pairs of training load vs sleep duration. Negative slope = high-load weeks come at sleep cost; positive (rare) = you're recovered enough that load doesn't displace sleep. Either signal personalizes your sustainable weekly ceiling.`,
      actionTpl: (c) => c.slope < 0
        ? `Your TSS ceiling before sleep gets eaten is around ${Math.round(c.n > 0 ? (-1 / c.slope) * 0.5 : 400)} TSS/week (rough back-of-envelope from your slope). Cap weekly volume below that on weeks you need to be sharp.`
        : `Load is not displacing sleep right now — there's headroom to add volume.`,
      slopeChip: (c) => ({ label: 'slope', value: `${(c.slope * 100).toFixed(2)}h / +100 TSS/wk` }),
    },
  ];

  // Filter to surfaceable + pick the strongest (highest |r|).
  const surfaceable = candidates.filter(c => c.corr?.surfaceable);
  if (!surfaceable.length) return null;
  const pick = surfaceable.sort((a, b) => Math.abs(b.corr.r) - Math.abs(a.corr.r))[0];

  const c = pick.corr;
  return {
    id: `personal-correlation-${pick.id}`,
    priority: 4,
    state: 'aligned',
    pillarsAffected: pick.pillars,
    goalsAffected: [],
    acknowledge: `Arnold has a personal pattern for you: ${pick.ackTpl(c)}`,
    mechanism: pick.mechTpl(c),
    nextAction: pick.actionTpl(c),
    evidence: [
      { label: 'n',  value: `${c.n}` },
      { label: 'r',  value: fmt1(c.r) },
      pick.slopeChip(c),
    ],
    confidence: 0.9,
    // If there are MORE surfaceable correlations, expose them as supporting
    // evidence so the narrative engine (v2.6, deferred) can weave them in
    // without recomputing.
    additionalSurfaceable: surfaceable.slice(1).map(s => ({
      id: s.id, n: s.corr.n, r: s.corr.r, slope: s.corr.slope, insight: s.corr.insight,
    })),
  };
}

// ─── Pattern: Mutual reinforcement (positive) ──────────────────────────────
// Fires when multiple active goals AND signals are good AND no concern
// conflicts. The point: name what's working, so the user sees Arnold
// noticed they're doing well, not just nagging.

function patternMutualReinforcement(us) {
  const goals = us?.activeGoalKinds || {};
  const cs    = us?.coachSignals || {};
  const conflicts = us?.goalConflicts || [];

  const hasConcern = conflicts.some(c => c.severity === 'concern');
  if (hasConcern) return null;

  const activeGoals = [
    goals.weightCut && 'weight cut',
    goals.strength  && 'strength',
    goals.endurance && 'endurance',
    goals.racePrep  && 'race prep',
  ].filter(Boolean);
  if (activeGoals.length < 2) return null;

  const sleepOk = !cs.sleepDebt || cs.sleepDebt.status === 'paid' || cs.sleepDebt.status === 'mild';
  const hrvOk   = !cs.hrvDepression || cs.hrvDepression.status === 'normal' || cs.hrvDepression.status === 'mild';
  const rhrOk   = !cs.rhrDrift || cs.rhrDrift.status === 'stable';
  const strainOk = !cs.monotonyStrain || cs.monotonyStrain.status === 'balanced';

  if (!(sleepOk && hrvOk && rhrOk && strainOk)) return null;

  const ack = `${activeGoals.join(' and ')} are coexisting — no concern signals from sleep, HRV, RHR, or training strain.`;
  const mech = `Recovery markers are absorbing the current load; your goals are reinforcing each other rather than competing. First sign of mismatch will show as HRV slope drift or sleep debt accumulation.`;
  const nextAction = `Continue the current plan. The watch points are HRV trend over the next 7 days and sleep average — if either drifts, Arnold flags it before it becomes a real issue.`;

  return {
    id: 'mutual-reinforcement',
    priority: 5,
    state: 'aligned',
    pillarsAffected: ['Goal', 'Recover'],
    goalsAffected: activeGoals,
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      cs.sleepDebt?.avgHours7d ? { label: 'sleep 7d', value: `${fmt1(cs.sleepDebt.avgHours7d)}h` } : null,
      cs.hrvDepression?.latest ? { label: 'HRV',      value: `${fmt0(cs.hrvDepression.latest)}ms` } : null,
      cs.monotonyStrain?.monotony != null ? { label: 'monotony', value: fmt1(cs.monotonyStrain.monotony) } : null,
    ].filter(Boolean),
    confidence: 0.7,
  };
}

// ─── Pattern: Aligned baseline (fallback) ──────────────────────────────────
// Always-on safety net. Fires when no other pattern produced a non-
// aligned brief. Reassures the user that Arnold is watching and
// nothing is actively wrong.

function patternAlignedBaseline(us, otherBriefs) {
  const hasActOrWatch = otherBriefs.some(b => b.state === 'act' || b.state === 'watch');
  if (hasActOrWatch) return null;

  const cs = us?.coachSignals || {};
  const ack = `All-clear: no patterns Arnold tracks are firing today.`;
  const mech = `Sleep, HRV, RHR, training strain, energy availability, and goal trajectory are all in their safe ranges. Arnold is still watching everything; this is what the screen looks like when nothing needs attention.`;
  const nextAction = `Stay on the current plan. Next automatic check is overnight as new sleep and HRV data lands.`;

  return {
    id: 'aligned-baseline',
    priority: 6,
    state: 'aligned',
    pillarsAffected: ['Goal', 'Recover', 'Fuel', 'Train'],
    goalsAffected: [],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      cs.sleepDebt?.avgHours7d != null ? { label: 'sleep 7d', value: `${fmt1(cs.sleepDebt.avgHours7d)}h` } : null,
      cs.hrvDepression?.status != null ? { label: 'HRV',      value: cs.hrvDepression.status } : null,
      cs.rhrDrift?.status != null      ? { label: 'RHR',      value: cs.rhrDrift.status } : null,
    ].filter(Boolean),
    confidence: 0.8,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITIVE / ADDITIVE PATTERNS
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase 4r.coach.v2.surface.positive (2026-05-24). User feedback:
// "there is nothing that I am doing good, there are only Act points."
//
// These patterns fire INDEPENDENTLY of whether concerns are present.
// They acknowledge what's working in the user's data — training
// consistency, HRV trend, protein discipline, weekly volume progression
// — alongside (not in place of) any concerns the negative patterns
// surface. A real coach says "sleep is the bottleneck this week, but
// your running is on track for the marathon" — both things, not just
// the problem.
//
// All four pattern as `aligned` state with priority 5 so they sort
// below act/watch in default ranking. The composer reserves slots
// for them so they always show alongside concerns, not just as
// fallback when nothing else fires.

// ─── Pattern: Training consistency ─────────────────────────────────────────
// Fires when the user has trained on 5+ of the last 7 days. Consistency
// is the single biggest predictor of multi-month goal achievement.

function patternTrainingConsistency(us) {
  // Phase 4r.coach.v2.surface.positive — read trained days from the
  // v1 monotonyStrain signal (which already has a 7-day daily-kcal
  // array). Avoids needing raw activities in userState.
  const ms = us?.coachSignals?.monotonyStrain;
  if (!ms || !Array.isArray(ms.dailyLoad)) return null;

  const trainedDays = ms.dailyLoad.filter(load => load > 0).length;
  if (trainedDays < 5) return null;

  const ack = `You've trained ${trainedDays} of the last 7 days — that's consistency.`;
  const mech = `Showing up is the single biggest predictor of multi-month goal achievement. Weekly volume, adaptation, even psychological momentum all compound off this. The athletes who hit marathon time goals aren't the ones who train hardest — they're the ones who train most consistently.`;
  const nextAction = `Hold the rhythm. If anything tightens (sleep, HRV, RHR), use it as a signal to adjust intensity, not to skip days.`;

  return {
    id: 'training-consistency',
    priority: 5,
    state: 'aligned',
    pillarsAffected: ['Train'],
    goalsAffected: us?.activeGoalKinds?.endurance ? ['endurance', 'marathon prep'] : ['training base'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'trained',     value: `${trainedDays}/7d` },
      { label: 'weekly kcal', value: fmt0(ms.weeklyLoad) },
    ],
    confidence: 0.85,
  };
}

// ─── Pattern: HRV improving ────────────────────────────────────────────────
// Fires when latest HRV is ABOVE the 28-day baseline. Means the
// parasympathetic system is winning — recovery is keeping up with
// load, or the user is in a positive adaptation phase.

function patternHrvImproving(us) {
  const hrv = us?.coachSignals?.hrvDepression;
  if (!hrv || hrv.status === 'insufficient-data') return null;
  // depressionMs is positive when depressed, negative when ABOVE baseline.
  if (hrv.depressionMs == null || hrv.depressionMs >= 0) return null;
  const lift = Math.abs(hrv.depressionMs);
  if (lift < 2) return null;

  const ack = `HRV is trending above your baseline — ${fmt0(hrv.latest)}ms today vs ${fmt0(hrv.baseline28d)}ms 28-day average (+${fmt0(lift)}ms).`;
  const mech = `An above-baseline HRV usually means parasympathetic tone is strong — recovery is keeping up with whatever load you're putting through. This is the window where harder sessions actually adapt instead of just costing recovery.`;
  const nextAction = `Whatever you're doing on recovery (sleep timing, nutrition, rest-day discipline) is working — don't change variables this week if you can avoid it.`;

  return {
    id: 'hrv-improving',
    priority: 5,
    state: 'aligned',
    pillarsAffected: ['Recover'],
    goalsAffected: ['recovery', 'training adaptation'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'HRV today', value: `${fmt0(hrv.latest)}ms` },
      { label: 'baseline',  value: `${fmt0(hrv.baseline28d)}ms` },
      { label: 'lift',      value: `+${fmt0(lift)}ms` },
    ],
    confidence: 0.85,
  };
}

// ─── Pattern: Protein consistency ──────────────────────────────────────────
// Fires when 7d average protein is at or above floor. Protein
// consistency is the single biggest body-comp lever during a cut.

function patternProteinConsistency(us) {
  const n = us?.numbers || {};
  const avg = n.proteinAvg7d;
  const floor = n.proteinFloor;
  if (avg == null || floor == null || floor <= 0) return null;

  const ratio = avg / floor;
  if (ratio < 0.9) return null;

  const aboveFloor = ratio >= 1.0;
  const ack = aboveFloor
    ? `Protein is dialled — averaging ${fmt0(avg)}g/day this week, above your ${fmt0(floor)}g floor.`
    : `Protein is close to floor — averaging ${fmt0(avg)}g/day vs ${fmt0(floor)}g target (${Math.round(ratio * 100)}%).`;
  const mech = `Through a cut, the 0.8-1g per lb of LBM floor is what stops the body from converting lean mass into the fuel the deficit demands. Hitting it consistently is the single biggest body-comp variable under your control.`;
  const nextAction = aboveFloor
    ? `Hold the routine. If you ever drop a protein source temporarily (travel, sick week), this floor is the metric to defend first.`
    : `Push the daily target ~10-15g higher to clear the floor comfortably; protein has the largest TEF cost and saturates anabolic signalling at the floor, not below it.`;

  return {
    id: 'protein-consistency',
    priority: 5,
    state: 'aligned',
    pillarsAffected: ['Fuel', 'Body'],
    goalsAffected: us?.activeGoalKinds?.weightCut ? ['cut LBM protection'] : ['recovery'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'avg 7d', value: `${fmt0(avg)}g/day` },
      { label: 'floor',  value: `${fmt0(floor)}g/day` },
      { label: 'ratio',  value: `${Math.round(ratio * 100)}%` },
    ],
    confidence: 0.9,
  };
}

// ─── Pattern: Weekly volume progress ───────────────────────────────────────
// Fires when training is structured with healthy variance (low monotony)
// and substantial weekly load — i.e. progressive overload happening in
// the right shape, not crushed-flat every day.

function patternWeeklyVolumeProgress(us) {
  const ms = us?.coachSignals?.monotonyStrain;
  if (!ms || !Array.isArray(ms.dailyLoad) || ms.dailyLoad.length < 7) return null;

  const thisWeek = ms.dailyLoad.reduce((s, v) => s + v, 0);
  if (thisWeek < 1500) return null;
  if (ms.status !== 'balanced') return null;

  const ack = `Weekly training load is ${fmt0(thisWeek)} kcal with healthy variance (monotony ${fmt1(ms.monotony)}) — load is structured, not crushed-flat.`;
  const mech = `Progressive overload works when load varies day-to-day — easy days enable hard days. Monotony below 1.5 means you're getting the recovery you need to actually adapt to the work. This is the right shape.`;
  const nextAction = `If HRV/RHR stay steady through the next 7 days, a 5-10% volume bump is safe. If they drift, hold this volume — adaptation is happening at the current level.`;

  return {
    id: 'volume-progress',
    priority: 5,
    state: 'aligned',
    pillarsAffected: ['Train'],
    goalsAffected: us?.activeGoalKinds?.endurance ? ['marathon prep'] : ['training adaptation'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'weekly kcal', value: fmt0(thisWeek) },
      { label: 'monotony',    value: fmt1(ms.monotony) },
      { label: 'strain',      value: fmt0(ms.strain) },
    ],
    confidence: 0.7,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSER
// ═══════════════════════════════════════════════════════════════════════════

// ─── Pattern: HYROX station coverage ───────────────────────────────────────
// Phase 4r.coach.v2.hyrox — fires when HYROX is upcoming and recent
// training has gaps in any of the 4 broad modality buckets that the
// race demands (running, ergometer, strength, mixed-modal/metcon).

function patternHyroxStationCoverage(us) {
  const race = getNextRace();
  if (!isHyrox(race) || race.days > 21 || race.days < 1) return null;

  const recentActivities = getRecentActivities(14);
  if (recentActivities.length < 2) return null;

  const coverage = { running: 0, erg: 0, strength: 0, metcon: 0 };
  for (const a of recentActivities) {
    const cls = classifyActivityForHyrox(a);
    if (cls !== 'other') coverage[cls]++;
  }

  const missing = [];
  if (coverage.running < 3) missing.push('running');
  if (coverage.strength < 2) missing.push('strength');
  if (coverage.metcon < 1)   missing.push('functional / mixed-modal');
  if (coverage.erg < 1)      missing.push('rowing or ski-erg');

  if (missing.length === 0) return null;

  const state = race.days <= 7 ? 'act' : 'watch';
  const present = Object.entries(coverage)
    .filter(([_, v]) => v > 0)
    .map(([k, v]) => `${k} (${v})`)
    .join(', ') || 'no qualifying sessions';

  const ack = `HYROX in ${race.days}d. Your last 14 days covered ${present}, but ${missing.length} key modalit${missing.length > 1 ? 'ies are' : 'y is'} missing: ${missing.join(', ')}.`;
  const mech = 'HYROX rewards station-specific stamina across 4 broad modalities (running, erg work, loaded strength, mixed-modal). A modality not trained recently is one your nervous system goes into race day cold on — that\'s where most athletes redline.';
  const nextAction = race.days <= 7
    ? `Squeeze in one short session per missing modality this week. Keep loads moderate (don't introduce DOMS) but get the muscle memory fresh.`
    : `Add 1-2 sessions for each missing modality over the next ${Math.min(race.days - 3, 10)} days. Final 3 days = taper.`;

  return {
    id: 'hyrox-station-coverage',
    priority: 1,
    state,
    pillarsAffected: ['Train', 'Goal'],
    goalsAffected: ['HYROX race performance'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'running 14d',  value: `${coverage.running}` },
      { label: 'strength 14d', value: `${coverage.strength}` },
      { label: 'metcon 14d',   value: `${coverage.metcon}` },
      { label: 'erg 14d',      value: `${coverage.erg}` },
    ],
    confidence: 0.7,
  };
}

// ─── Pattern: HYROX strength readiness ─────────────────────────────────────
// Phase 4r.coach.v2.hyrox — fires when HYROX is within 28d. Two paths:
// positive (strength is consistent — race-ready) or watch/act (strength
// is sparse, the loaded stations will be a problem).

function patternHyroxStrengthReadiness(us) {
  const race = getNextRace();
  if (!isHyrox(race) || race.days > 28 || race.days < 0) return null;

  const recentActivities = getRecentActivities(14);
  const strengthSessions = recentActivities.filter(a => {
    return classifyActivityForHyrox(a) === 'strength';
  });
  const sessionsPerWeek = strengthSessions.length / 2;

  if (sessionsPerWeek >= 2) {
    return {
      id: 'hyrox-strength-readiness',
      priority: 5,
      state: 'aligned',
      pillarsAffected: ['Train'],
      goalsAffected: ['HYROX race performance'],
      acknowledge: `Strength is holding for HYROX — ${strengthSessions.length} sessions in the last 14 days (~${fmt1(sessionsPerWeek)}/wk).`,
      mechanism: `HYROX Men's Open loads: sled push 152kg, sled pull 103kg, farmers 2×24kg, sandbag lunges 20kg. These reward absolute strength + grip endurance over peak max strength. Consistent training through race week matters more than chasing PRs.`,
      nextAction: `Keep the routine through the next ${Math.max(0, race.days - 3)} days. Final strength session 3-4 days before race; lighter, technique-focused, not maximal.`,
      evidence: [
        { label: 'strength 14d', value: `${strengthSessions.length} sessions` },
        { label: 'sled push',    value: '152kg (Men\'s Open)' },
        { label: 'farmers',      value: '2×24kg' },
      ],
      confidence: 0.75,
    };
  }

  if (sessionsPerWeek < 1 && race.days <= 21) {
    return {
      id: 'hyrox-strength-readiness',
      priority: 2,
      state: race.days <= 7 ? 'act' : 'watch',
      pillarsAffected: ['Train'],
      goalsAffected: ['HYROX race performance'],
      acknowledge: `Strength training has been sparse — ${strengthSessions.length} session${strengthSessions.length === 1 ? '' : 's'} in the last 14 days while HYROX is ${race.days}d out.`,
      mechanism: `HYROX has 4 loaded stations (sled push 152kg, sled pull 103kg, farmers 2×24kg, sandbag lunges 20kg). Race-day power output on these depends on what your nervous system has touched recently — strength is highly responsive in 1-2 week windows.`,
      nextAction: race.days <= 7
        ? `Two short, sharp strength sessions this week: 1) heavy push pattern (sled-push proxy), 6-8 sets of 6 reps; 2) farmers carry or grip work, 4-5 sets of 30s. Low volume, moderate-high intensity.`
        : `Add 2 strength sessions per week for the next ${Math.min(race.days - 3, 10)} days. Focus the loaded HYROX patterns: sled, carries, lunges.`,
      evidence: [
        { label: 'strength 14d', value: `${strengthSessions.length} sessions` },
        { label: 'recommended',  value: '2+/wk for race readiness' },
      ],
      confidence: 0.75,
    };
  }
  return null;
}

// ─── Pattern: HYROX glycogen window ────────────────────────────────────────
// Phase 4r.coach.v2.hyrox — fires inside race week (≤7d). Replaces the
// generic patternRaceSequencing for HYROX with race-format-specific
// carb-loading + recovery focus.

function patternHyroxGlycogenWindow(us) {
  const race = getNextRace();
  if (!isHyrox(race) || race.days > 7 || race.days < 0) return null;

  const state = race.days <= 3 ? 'act' : 'watch';

  let ack;
  let nextAction;
  if (race.days === 0) {
    ack = `HYROX TODAY. Pre-race fuelling window is now.`;
    nextAction = `If you ate 3-4h ago, you're set. Sip electrolytes through warm-up. Don't introduce anything new — only foods + drinks you've trained with.`;
  } else if (race.days === 1) {
    ack = `HYROX tomorrow. Today is the last full day to top up glycogen.`;
    nextAction = `High-carb breakfast and lunch (rice, pasta, potatoes, oats). Lighter dinner with familiar foods. Hydrate with electrolytes through the day. Race morning: high-carb breakfast 3-4h before start.`;
  } else if (race.days <= 3) {
    ack = `HYROX in ${race.days} days. Carb loading window is open.`;
    nextAction = `Target 6-8 g/kg bodyweight in carbs today and tomorrow (~350-450g for a Men's Open athlete). Reduce training volume sharply — glycogen replenishment + recovery > training stimulus this close.`;
  } else {
    ack = `HYROX in ${race.days} days. Start ramping carbs and trimming training intensity.`;
    nextAction = `Begin extending carb intake (5-6 g/kg/day) starting tomorrow. Drop hard training; ${race.days - 3} more days of moderate effort then full taper.`;
  }

  const mech = `HYROX expends ~900-1000 kcal across 8km running + 8 high-output stations. Muscle glycogen is the limiting fuel at race effort — race-week loading raises stored glycogen 20-30%, which translates directly to staying-power on the back half. Cutting through race week leaves you 1-2% glycogen-low at start line, which costs ~10-30s/km over HYROX distance.`;

  return {
    id: 'hyrox-glycogen-window',
    priority: race.days <= 1 ? 1 : 2,
    state,
    pillarsAffected: ['Fuel', 'Goal'],
    goalsAffected: ['HYROX race performance'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'days out',    value: `${race.days}d` },
      { label: 'race burn',   value: '~900-1000 kcal' },
      { label: 'carb target', value: '6-8 g/kg BW/day' },
    ],
    confidence: 0.9,
  };
}

// ─── Pattern: HYROX pacing prep ────────────────────────────────────────────
// Phase 4r.coach.v2.hyrox — fires in the 4-21d window when recent
// intensity / race-pace work is sparse. HYROX is near-redline for 60-90
// min; first hard effort of the month shouldn't be the first race station.

function patternHyroxPacingPrep(us) {
  const race = getNextRace();
  if (!isHyrox(race) || race.days > 21 || race.days < 4) return null;

  const recentActivities = getRecentActivities(14);

  const intensitySessions = recentActivities.filter(a => {
    const dur = Number(a?.durationMin)
             || Number(a?.duration_minutes)
             || (Number(a?.durationSecs) ? Number(a?.durationSecs) / 60 : 0);
    const kcal = Number(a?.kcal) || Number(a?.calories) || 0;
    const kcalPerMin = dur > 0 ? kcal / dur : 0;
    const t = String(a?.type || a?.activityType || '').toLowerCase();
    const n = String(a?.name || '').toLowerCase();
    const isHighIntensityType = /hiit|interval|tempo|threshold|hyrox|functional|metcon|sprint/i.test(`${t} ${n}`);
    return kcalPerMin > 10 || isHighIntensityType;
  });

  if (intensitySessions.length >= 2) return null;

  const state = race.days <= 10 ? 'act' : 'watch';

  const ack = `Only ${intensitySessions.length} hard / race-pace session${intensitySessions.length === 1 ? '' : 's'} in the last 14 days. HYROX in ${race.days}d benefits from race-pace prep before race day.`;
  const mech = `HYROX is a near-redline effort sustained over 60-90 minutes. Without recent race-pace simulation, the lactate-clearance + neural pathways aren't tuned for the actual demand. The first hard station on race day shouldn't be the first hard effort of the month.`;
  const nextAction = race.days <= 10
    ? `One race-pace simulation 4-5 days out: short HYROX-shape session (1km run + 2-3 stations at race effort, then 5-10 min easy). Don't repeat — one session wakes the systems up; more this close adds fatigue not fitness.`
    : `Add 1-2 intensity sessions over the next ${Math.min(race.days - 5, 10)} days. Mix run intervals with station-style work (e.g., 5×400m run @ goal pace alternating with 50m sled push).`;

  return {
    id: 'hyrox-pacing-prep',
    priority: 3,
    state,
    pillarsAffected: ['Train'],
    goalsAffected: ['HYROX race performance'],
    acknowledge: ack,
    mechanism: mech,
    nextAction,
    evidence: [
      { label: 'intensity 14d', value: `${intensitySessions.length} sessions` },
      { label: 'recommended',   value: '2+ in race-prep window' },
    ],
    confidence: 0.7,
  };
}

const PATTERNS_CONCERN = [
  patternLeveragePoint,
  patternRaceSequencing,
  patternSustainability,
  patternEnergyAvailability,
  patternTdeeDrift,
  patternRecoveryVelocity,
  patternGlycogenState,
  patternPolarization,
  patternSleepQuality,
  patternGarminReadiness,
  patternPersonalCorrelation,
  patternMutualReinforcement,
  // Phase 4r.coach.v2.hyrox — race-format-aware patterns. Fire only
  // when the upcoming race is detected as HYROX (by `type` field or
  // fuzzy name match). patternRaceSequencing is gated to skip HYROX
  // so these own the race-week messaging. patternHyroxStrengthReadiness
  // is in CONCERN because it can return act/watch (sparse strength
  // training) — when it returns aligned it ranks low naturally.
  patternHyroxStationCoverage,
  patternHyroxGlycogenWindow,
  patternHyroxPacingPrep,
  patternHyroxStrengthReadiness,
];

const PATTERNS_POSITIVE = [
  patternTrainingConsistency,
  patternHrvImproving,
  patternProteinConsistency,
  patternWeeklyVolumeProgress,
  patternDowRhythm,
];

const MAX_POSITIVE = 2;

function runPatterns(patterns, userState) {
  const out = [];
  for (const pattern of patterns) {
    try {
      const b = pattern(userState);
      if (b) out.push(b);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[coachBriefs:${pattern.name}] failed:`, e?.message || e);
    }
  }
  return out;
}


// Phase 4r.coach.v2.feedback-aware — read feedback storage to suppress
// briefs the user has explicitly dismissed in the last N days. Without
// this, identical briefs keep firing day after day even when the user
// has said "this read wrong" — feedback was disappearing into a black
// hole. User feedback 2026-05-25: "If I have addressed a comment we
// probably do not need to keep the same feedback there."
//
// Rule: any briefId with a recent feedback entry of verdict 'down' or
// any free-text comment is suppressed for SUPPRESS_DAYS days from the
// most recent feedback timestamp. After that window expires the brief
// can re-fire (user may want to re-evaluate). Positive ('up') feedback
// doesn't suppress — the user agreed with it.
const SUPPRESS_DAYS = 7;

function getSuppressedBriefIds() {
  try {
    const all = storage.get('coachFeedback');
    if (!Array.isArray(all) || !all.length) return new Set();
    const cutoff = Date.now() - SUPPRESS_DAYS * 86400000;
    // Take the MOST RECENT feedback per briefId. Only suppress if that
    // most-recent verdict is 'down' or carries a comment — if the most
    // recent thing is 'up' the user likes it now and we should show it.
    const latestByBriefId = new Map();
    for (const f of all) {
      if (!f?.briefId || !f.timestamp) continue;
      const ts = new Date(f.timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      const prev = latestByBriefId.get(f.briefId);
      if (!prev || ts > prev.ts) latestByBriefId.set(f.briefId, { ...f, ts });
    }
    const suppressed = new Set();
    for (const [briefId, f] of latestByBriefId) {
      if (f.ts < cutoff) continue;
      const isNegative = f.verdict === 'down' || (f.comment && f.comment.length > 0);
      if (isNegative) suppressed.add(briefId);
    }
    return suppressed;
  } catch { return new Set(); }
}

/**
 * Phase 4r.process.2 — boot-time health probe for coach briefs.
 * Runs every pattern, returns { totalPatterns, fires, errors:[{name,message}] }.
 * The runPatterns try/catch keeps the panel from crashing but turns
 * ReferenceErrors into silent console.warns. This probe gives the boot
 * fingerprint a single-line count so silent failures surface immediately.
 */
export function runCoachBriefsHealthProbe(userState) {
  const all = [...PATTERNS_CONCERN, ...PATTERNS_POSITIVE];
  const errors = [];
  let fires = 0;
  for (const pattern of all) {
    try {
      const b = pattern(userState);
      if (b) fires++;
    } catch (e) {
      errors.push({ name: pattern.name, message: e?.message || String(e) });
    }
  }
  return { totalPatterns: all.length, fires, errors };
}

export function composeCoachBriefs(userState, opts = {}) {
  const maxBriefs = opts.maxBriefs || 5;
  const maxPositive = opts.maxPositive ?? MAX_POSITIVE;

  const concernBriefs = runPatterns(PATTERNS_CONCERN, userState);
  const positiveBriefs = runPatterns(PATTERNS_POSITIVE, userState);

  const suppressed = getSuppressedBriefIds();
  const filteredConcerns = concernBriefs.filter(b => !suppressed.has(b.id));
  const filteredPositives = positiveBriefs.filter(b => !suppressed.has(b.id));

  filteredConcerns.sort((a, b) => {
    const sd = (STATE_RANK[b.state] || 0) - (STATE_RANK[a.state] || 0);
    if (sd !== 0) return sd;
    return (a.priority || 99) - (b.priority || 99);
  });
  filteredPositives.sort((a, b) =>
    (a.priority || 99) - (b.priority || 99) ||
    (b.confidence || 0) - (a.confidence || 0)
  );

  const positiveSlotsToReserve = Math.min(maxPositive, filteredPositives.length);
  const concernSlots = Math.max(1, maxBriefs - positiveSlotsToReserve);
  const finalConcerns = filteredConcerns.slice(0, concernSlots);
  const finalPositives = filteredPositives.slice(0, maxPositive);
  let result = [...finalConcerns, ...finalPositives];
  if (!result.length) {
    const fallback = patternAlignedBaseline(userState, []);
    if (fallback) result.push(fallback);
  }
  return result.slice(0, maxBriefs);
}

if (typeof window !== 'undefined') {
  window.coachBriefsDebug = function () {
    const data = {
      activities: storage.get('activities') || [],
      sleep:      storage.get('sleep') || [],
      hrv:        storage.get('hrv') || [],
      weight:     storage.get('weight') || [],
      cronometer: storage.get('cronometer') || [],
      profile:    { ...(storage.get('profile') || {}), ...getGoals() },
    };
    const state = computeUserState(data);
    const briefs = composeCoachBriefs(state);
    console.log('=== COACH BRIEFS v2 ===', briefs.length, 'briefs');
    briefs.forEach((b, i) => {
      console.log((i+1) + '. [' + b.state.toUpperCase() + '] ' + b.id);
      console.log('   ACK:', b.acknowledge);
      console.log('   MECH:', b.mechanism);
      console.log('   ->', b.nextAction);
    });
    return briefs;
  };

  // Phase 4r.coach.v2.activity-debug — surfaces every activity from the
  // last 14 days with all relevant fields + the bucket the classifier
  // put it in. Run after a session that should have been detected but
  // wasn't to see the raw shape and fix the classifier from real data.
  window.coachActivitiesDebug = function () {
    const acts = (allActivities() || []);
    const today = localDate();
    const cutoff = daysUntil_str(today, -14);
    const recent = acts.filter(a => a?.date && a.date >= cutoff && a.date <= today);
    console.log('=== COACH ACTIVITIES (last 14d) ===', recent.length, 'activities');
    const summary = recent.map(a => ({
      date: a.date,
      bucket: classifyActivityForHyrox(a),
      activityType: a.activityType || '',
      title: a.title || '',
      activityName: a.activityName || '',
      name: a.name || '',
      type: a.type || '',
      workoutType: a.workoutType || '',
      notes: a.notes ? String(a.notes).slice(0, 40) : '',
      kcal: a.kcal || a.calories || 0,
      source: a.source || '',
    }));
    console.table(summary);
    const counts = recent.reduce((c, a) => {
      const b = classifyActivityForHyrox(a);
      c[b] = (c[b] || 0) + 1;
      return c;
    }, {});
    console.log('Bucket counts:', counts);
    return { recent, summary, counts };
  };
}
