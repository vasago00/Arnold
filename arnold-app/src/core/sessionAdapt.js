// Session adaptation (Sprint 3.2d enabler) — the "I can't do the 20 today" engine.
//
// The coach's immediate value: when a session is at risk (short on time, or an
// injury flare), offer a RANKED ladder of substitutions that preserve as much of
// the session's INTENT as possible — never compromising the block. Skipping is
// framed as the only choice that actually sets you back.
//
// Two layers:
//   1. SESSION_INTENT — every session type has a purpose + the dimensions it
//      trains + whether it's load-bearing (a key session) or flexible. This is
//      the vocabulary 3.2d/3.2c build on: you can only protect a stimulus once
//      the session declares what it is.
//   2. buildSessionOptions(session, constraint, ctx) — pure. Returns the ranked
//      options for the given constraint, each with what you'd do, what it keeps,
//      and the trade-off. Least-compromise first.
//
// Substitution ladder is grounded in established endurance methodology: split
// long runs / back-to-backs keep most of the durability stimulus; marathon-pace
// long runs (Canova-style) trade duration for specificity; deep-water running is
// an impact-free ~1:1 aerobic substitute for injury (see cross-training evidence
// in HANDOVER); reduce-reps-hold-pace preserves the intensity that IS the point
// of a quality session. Coefficients here are transparent + tunable.

import { sessionAggravatesInjury, injuryNote } from './injury.js';
import { capabilitiesFor, MODALITY_ASK } from './modalities.js';

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

// Purpose + trained dimensions + whether the session is load-bearing (a key
// session whose loss hurts the block) or flexible (base/recovery).
export const SESSION_INTENT = {
  long_run:  { label: 'Long run',  purpose: 'durability, fat metabolism, time on feet', dims: ['durability', 'aerobic', 'fuel'], loadBearing: true,  family: 'run' },
  tempo:     { label: 'Tempo',     purpose: 'lactate threshold / clearance',            dims: ['threshold'],                     loadBearing: true,  family: 'run' },
  threshold: { label: 'Threshold', purpose: 'lactate threshold / clearance',            dims: ['threshold'],                     loadBearing: true,  family: 'run' },
  intervals: { label: 'Intervals', purpose: 'VO₂max / speed',                           dims: ['vo2', 'speed'],                  loadBearing: true,  family: 'run' },
  hiit:      { label: 'HIIT',      purpose: 'VO₂max / anaerobic power',                 dims: ['vo2', 'speed'],                  loadBearing: true,  family: 'run' },
  easy_run:  { label: 'Easy run',  purpose: 'aerobic base, recovery',                   dims: ['aerobic'],                       loadBearing: false, family: 'run' },
  recovery:  { label: 'Recovery run', purpose: 'active recovery',                        dims: ['recovery'],                      loadBearing: false, family: 'run' },
  strength:  { label: 'Strength',  purpose: 'durability, running economy',              dims: ['durability', 'economy'],         loadBearing: false, family: 'strength' },
  mobility:  { label: 'Mobility',  purpose: 'tissue prep, recovery',                    dims: ['recovery'],                      loadBearing: false, family: 'mobility' },
  race:      { label: 'Race',      purpose: 'compete',                                  dims: ['race'],                          loadBearing: true,  family: 'run' },
};
// Aliases for looser plan vocab.
const TYPE_ALIAS = { easy: 'easy_run', long: 'long_run', interval: 'intervals', speed: 'intervals', fartlek: 'intervals' };

export function intentFor(session) {
  const t = session?.type ? String(session.type).toLowerCase() : null;
  if (!t) return null;
  return SESSION_INTENT[t] || SESSION_INTENT[TYPE_ALIAS[t]] || null;
}

const splitAM = (mi) => Math.round(mi * 0.6);
const splitPM = (mi) => Math.round(mi * 10) / 10 - Math.round(mi * 0.6);

// ── modality substitution copy — how a given modality stands in for a run, worded
// for quality (work:rest at effort) vs aerobic (steady). Compromise = how far from the
// run-specific stimulus. Gated: only built for OWNED, injury-safe modalities. ──
const MODALITY_SUB = {
  treadmill:  (q, m) => ({ id: 'sub_treadmill', title: 'Take it to the treadmill', keeps: q ? 'Full session, controlled' : 'The run, indoors', keepsLevel: 'high', compromise: 0.12,
    how: `Run the same ${q ? 'workout' : 'session'} on the treadmill${m ? ` (~${m} min)` : ''} — pace + incline dialled in`, tradeoff: 'Belt feel differs slightly' }),
  pool:       (q, m) => ({ id: 'sub_pool', title: 'Take it to the pool', keeps: q ? 'VO₂ stimulus · impact-free' : 'Aerobic · impact-free', keepsLevel: 'high', compromise: 0.25,
    how: `Deep-water run${m ? ` (~${m} min)` : ' at equal effort'} — ${q ? 'match the work:rest at hard effort' : 'steady aerobic'}, zero joint load`, tradeoff: 'Not run-specific pounding' }),
  bike:       (q, m) => ({ id: 'sub_bike', title: q ? 'Bike the intervals' : 'Bike it', keeps: q ? 'VO₂ / threshold power' : 'Aerobic base', keepsLevel: q ? 'high' : 'partial', compromise: 0.3,
    how: q ? 'Match the work:rest at threshold/VO₂ effort on the bike' : `${Math.round((m || 60) * 1.4)} min easy–moderate on the bike`, tradeoff: 'Doesn’t train running economy' }),
  rower:      (q, m) => ({ id: 'sub_rower', title: 'Row it', keeps: q ? 'Power + aerobic' : 'Aerobic + upper body', keepsLevel: 'partial', compromise: 0.4,
    how: q ? 'Hard intervals on the rower — match the work:rest' : `${m || 40} min steady on the rower`, tradeoff: 'Not run-specific' }),
  elliptical: (q, m) => ({ id: 'sub_elliptical', title: 'Elliptical', keeps: 'Aerobic base', keepsLevel: 'partial', compromise: 0.42,
    how: `${m || 45} min equal-effort elliptical — impact-free`, tradeoff: 'Aerobic only, not run-specific' }),
  gym:        (_q, _m) => ({ id: 'sub_gym', title: 'Upper-body + core', keeps: 'A stimulus, legs spared', keepsLevel: 'partial', compromise: 0.5,
    how: 'Upper-body + core at the gym — keeps the habit and protects the joint', tradeoff: 'No aerobic stimulus' }),
};

/**
 * buildSessionOptions (v2) — SWAP-FIRST, equipment-GATED substitution ladder for an
 * at-risk session. Swap always leads (rest/reslot — offered even under injury, since
 * resting the joint IS the move); cross-training substitutes are gated by what the
 * athlete OWNS and, under injury, to joint-safe modalities only; the week runway is
 * flagged (time-decay). See SESSION_AGILITY_DESIGN.
 * @param session   { type, distanceMi?, minutes? }
 * @param constraint { minutesAvailable?, injury? (bool | area string) }
 * @param ctx        { easyPaceSecs?, modalities? (profile|keys|null=unknown),
 *                     weekOpenDays? (int), openDayLabels? ([str]) }
 * @returns { session, intent, constraintKind, options[], skipWarning, swapFirst,
 *            equipmentAsk, timeDecay, injury, aggravated, injuryNote } | null
 */
export function buildSessionOptions(session = {}, constraint = {}, ctx = {}) {
  const intent = intentFor(session);
  if (!intent) return null;

  const easyPaceSecs = num(ctx.easyPaceSecs) || 570;              // 9:30/mi default
  const distMi = num(session.distanceMi);
  const mins = num(session.minutes) || (distMi ? Math.round(distMi * easyPaceSecs / 60) : null);
  // Injury is SELECTIVE: an area (e.g. 'knee') only aggravates certain session types.
  // A tolerated session under injury behaves normally; only an AGGRAVATED session gets
  // the offload ladder. `injury:true` (generic) aggravates everything.
  const injuryArea = typeof constraint.injury === 'string' ? constraint.injury
    : (constraint.injury && constraint.injury.area) ? constraint.injury.area
    : (constraint.injury === true ? 'generic' : null);
  const aggravated = !!injuryArea && (injuryArea === 'generic' || sessionAggravatesInjury(session.type, injuryArea));
  const avail = num(constraint.minutesAvailable);
  const timeTight = avail != null && mins != null && avail < mins * 0.85;
  const kind = aggravated ? 'injury' : timeTight ? 'time' : 'general';

  const isLong = session.type === 'long_run' || session.type === 'long';
  const isQuality = intent.dims.some(d => ['threshold', 'vo2', 'speed'].includes(d));
  const isRun = intent.family === 'run';

  // ── week runway (time-decay): the swap-target set shrinks as the week fills, and the
  // coach flags the rising cost (SESSION_AGILITY_DESIGN §4). ──
  const openDays = num(ctx.weekOpenDays);
  const dayLabels = Array.isArray(ctx.openDayLabels) ? ctx.openDayLabels.filter(Boolean) : [];
  const labelStr = dayLabels.length ? dayLabels.join(' & ') : null;
  let timeDecay = null;
  if (openDays != null) {
    const note = openDays >= 2 ? `${labelStr ? `${labelStr} are open` : 'You’ve got open days this week'} — swapping costs you nothing.`
      : openDays === 1 ? `Only ${labelStr || 'one day'} left before the weekend — swap now or it competes with the long run.`
      : `No open days left — a swap now trades against another session, so the cost is real.`;
    timeDecay = { openDays, note };
  }
  // Swap compromise scales with the runway (plenty of room → free; week full → a real cost).
  const swapCompromise = openDays == null ? 0.05 : openDays >= 2 ? 0 : openDays === 1 ? 0.08 : 0.18;

  const opts = [];
  const add = (o) => { if (o) opts.push(o); };

  // 1 ── SWAP — first-class, ALWAYS available (the missing option). Under injury it means
  // rest the joint today and reslot; otherwise do the full session on a free day.
  const swapTarget = labelStr ? ` to ${labelStr}` : ' to a free day this week';
  add(aggravated
    ? { id: 'swap', title: 'Swap it out today', keeps: 'Full session, joint rested', keepsLevel: 'full', compromise: swapCompromise, swap: true,
        how: `Rest / mobility today and move the ${intent.label.toLowerCase()}${swapTarget} — resting the ${injuryArea !== 'generic' ? injuryArea : 'joint'} is the point`,
        tradeoff: 'Uses up a free slot this week' }
    : { id: 'swap', title: 'Swap it out', keeps: 'Full stimulus', keepsLevel: 'full', compromise: swapCompromise, swap: true,
        how: `Do the full ${intent.label.toLowerCase()}${swapTarget}; take today easy or as rest`,
        tradeoff: 'Uses up a free slot this week' });

  // 2 ── MODALITY SUBSTITUTES — gated by the profile (+ joint-safe only under injury).
  // ctx.modalities null/undefined = UNKNOWN → offer none, ask instead.
  const modalitiesKnown = ctx.modalities != null;
  const caps = modalitiesKnown ? capabilitiesFor(ctx.modalities, { jointSafeOnly: aggravated }) : [];
  if (isRun) {
    for (const cap of caps) {
      // gym isn't a run substitute except as the injury "keep the habit, spare the legs" move.
      if (cap.key === 'gym' && !aggravated) continue;
      // a modality that can't carry a hard stimulus is a weak sub for a quality day — still
      // offer it (better than skipping) but its compromise already reflects that.
      const make = MODALITY_SUB[cap.key];
      if (make) add(make(isQuality, mins));
    }
  } else if (intent.family === 'strength' && modalitiesKnown && caps.some(c => c.key === 'gym')) {
    add(MODALITY_SUB.gym(false, mins));
  }

  // 3 ── REDUCE / HOLD — intent-preserving moves. These keep RUNNING load, so they're
  // dropped under injury (where the point is to offload the joint entirely).
  if (!aggravated) {
    if (isLong && distMi) {
      add({ id: 'split', title: 'Split it', keeps: '~90% durability', keepsLevel: 'high', compromise: 0.1,
        how: `${splitAM(distMi)} mi AM + ${splitPM(distMi)} mi PM`, tradeoff: 'Needs two windows today' });
      add({ id: 'shorten_quality', title: 'Shorten + sharpen', keeps: 'Specific endurance', keepsLevel: 'partial', compromise: 0.3,
        how: `${Math.round(distMi * 0.7)} mi with ${Math.round(distMi * 0.3)} @ marathon pace`, tradeoff: 'Less time-on-feet, more intensity' });
    } else if (isQuality) {
      add({ id: 'reduce_reps', title: 'Fewer reps, same pace', keeps: 'The intensity stimulus', keepsLevel: 'high', compromise: 0.2,
        how: 'Cut the volume of work but hold target pace — intensity is the point', tradeoff: 'Less total quality volume' });
    } else if (isRun) {
      add({ id: 'shorten_easy', title: 'Just do what fits', keeps: 'Most of the base', keepsLevel: 'high', compromise: 0.15,
        how: 'A shorter easy run — base days flex freely', tradeoff: 'Slightly less volume' });
    }
  }

  opts.sort((a, b) => a.compromise - b.compromise);

  // Ask-when-unknown: profile empty AND we'd have offered a cross-train swap.
  const wouldOfferModality = isRun || intent.family === 'strength';
  const equipmentAsk = (!modalitiesKnown && wouldOfferModality) ? MODALITY_ASK : null;

  const skipWarning = intent.loadBearing
    ? `Skipping a ${intent.label.toLowerCase()} is the only choice that sets your ${intent.dims[0]} back — the options above don’t.`
    : `A flexible day — missing it won’t hurt the block, but a quick swap keeps momentum.`;

  return {
    session: { type: session.type, label: intent.label, distanceMi: distMi, minutes: mins },
    intent, constraintKind: kind, options: opts, skipWarning,
    swapFirst: opts[0] && opts[0].id === 'swap',
    equipmentAsk, timeDecay,
    injury: injuryArea, aggravated,
    injuryNote: injuryArea && injuryArea !== 'generic' ? injuryNote(injuryArea, session.type) : null,
  };
}

export default buildSessionOptions;
