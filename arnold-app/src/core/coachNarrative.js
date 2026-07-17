// core/coachNarrative.js — THE COACH'S MOUTH (Phase B, v1). One brain, many mouths.
// See COACH_NARRATIVE_DESIGN.md. This module is PURE: it takes a fully-assembled context
// bundle and returns, per surface, a cohesive narrative composed from ranked "coaching
// beats". The live assembler `buildCoachContext()` (reads goalResolve/trainingProfile/
// sessionAdapt/fuelForWork/cutMode/computeUserState) is a SEPARATE, storage-coupled file so
// this stays node-testable. Nothing here fabricates: a generator returns null unless the
// data supports a real claim, and every beat carries `why` = the signal it traces to.
//
// DECISIONS (Emil 2026-07-13): Start = 1–2 lines; Play/Daily = a few lines that WEAVE THE
// DISPLAYED METRICS; corrective beats expose the consequence to PERFORMANCE + HEALTH + GOAL;
// salience = impact × gravity (no fixed lever order — the right thing surfaces where it's at
// stake, purpose leads only on a clean day).

import { buildDay } from './worldModel.js';   // the day/phase temporal object (roadmap Stage 1)

// dayOf — the single time-of-day source. Prefer the assembled world model (ctx.day) when the live
// assembler provides it; otherwise DERIVE a day object from the legacy clock so this engine stays
// self-contained and every existing caller/test (which sets ctx.clock, not ctx.day) keeps working.
// One code path → the freshness/time gates below are uniform and testable, not scattered `if hour`s.
function dayOf(ctx) {
  return (ctx && ctx.day) || buildDay({
    hour: ctx?.clock?.hour,
    trainedToday: !!ctx?.today?.trainedToday,
    hasPlannedToday: !!ctx?.today?.primarySession,
  });
}

// ── Gravity by kind: how much is AT STAKE when this kind of beat fires. Risk/health/goal
// threats outrank actionable cues, which outrank affirmations. Magnitude scales it. ──
const GRAVITY = {
  reds: 0.95, injury: 0.92, conflict: 0.85, clinical: 0.82, planImpact: 0.72, readiness: 0.70,
  knockOn: 0.60, mechanism: 0.55, divergence: 0.55, learned: 0.45,
  purpose: 0.48, progress: 0.40, context: 0.30,
};

const RUN_TYPES = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit']);
const KEY_TYPES = new Set(['long_run', 'tempo', 'intervals', 'hiit']);   // missing these actually costs

const r = (n, d = 0) => (Number.isFinite(+n) ? (+n).toFixed(d) : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const isQuality = (t) => t === 'intervals' || t === 'tempo' || t === 'hiit';

// Session → what it BUILDS, framed for the goal. (Mirrors sessionAdapt SESSION_INTENT +
// raceRecipe's strength→durability/economy science.)
const BUILDS = {
  strength:  { lever: 'durability', line: 'strength is your durability + running-economy lever' },
  long_run:  { lever: 'endurance',  line: 'the long run is the aerobic endurance the marathon is built on' },
  intervals: { lever: 'speed',      line: 'intervals sharpen the top-end speed your goal pace sits under' },
  tempo:     { lever: 'threshold',  line: 'tempo lifts the threshold you hold marathon pace beneath' },
  easy_run:  { lever: 'aerobic',    line: 'easy miles are the aerobic base everything else compounds on' },
};

// ─────────────────────────── GENERATORS (pure: ctx → beat | null) ───────────────────────────
// A beat: { id, kind, surfaces:[], claim:{text,data}, why, tone, salienceBoost? }

function gPurpose(ctx) {
  const s = ctx.today?.primarySession;
  if (!s || !BUILDS[s.type]) return null;
  // Pre-workout PREVIEW only: once today's session is logged the purpose is spent, so the Play/Daily
  // tile must move on to the post-session story (progress, fuel, recovery) instead of restating the
  // intent it showed all morning. This is the "Play tile didn't update after I logged" fix, as phase.
  if (dayOf(ctx).postWorkout) return null;
  const b = BUILDS[s.type];
  const wl = ctx.goal?.weakLink;
  const race = ctx.goal?.aRace;
  const isTheGap = wl && wl === b.lever;
  const raceTail = race?.name
    ? ` — ${isTheGap ? `the exact gap the profile flags between you and ${race.name}` : `it moves you toward ${race.name}`}${race.daysOut != null ? ` (${race.daysOut}d out)` : ''}`
    : '';
  const text = isTheGap
    ? `${cap(b.line)}${raceTail}.`
    : `${cap(b.line)}${raceTail}.`;
  return {
    id: 'purpose-' + s.type, kind: 'purpose', surfaces: ['start', 'play', 'daily'],
    claim: { text, data: { session: s.type, lever: b.lever, weakLink: wl } },
    why: `SESSION_INTENT[${s.type}] + profile.weakLink=${wl}`,
    tone: 'affirming', salienceBoost: isTheGap ? 0.15 : 0,
  };
}

function gKnockOn(ctx) {
  const today = ctx.today?.primarySession;
  const tmr = ctx.tomorrow;
  if (!today || !tmr || !tmr.type) return null;
  // Concurrent-interference: a load-bearing session (strength/long/quality) today into a
  // quality run tomorrow → protect recovery so neither is blunted.
  const loadToday = today.loadBearing || today.type === 'strength' || today.type === 'long_run';
  if (loadToday && isQuality(tmr.type)) {
    return {
      id: 'knockon-recover', kind: 'knockOn', surfaces: ['start', 'play', 'calendar'],
      claim: { text: `Tomorrow is ${tmr.label || tmr.type} — keep tonight genuinely easy: stacking today's load into a speed session too close blunts both.`,
        data: { today: today.type, tomorrow: tmr.type } },
      why: `plan.tomorrow=${tmr.type} + SESSION_INTENT.loadBearing`,
      tone: 'neutral',
    };
  }
  return null;
}

function gMechanism(ctx) {
  const s = ctx.today?.primarySession;
  const f = ctx.fuel || {};
  // Post-strength / post-long protein timing: the MPS window, not a bare gap.
  const gap = f.protein?.gap;
  if (s && (s.type === 'strength' || s.type === 'long_run') && gap > 5) {
    const dose = Math.min(40, Math.max(25, Math.round(gap)));
    return {
      id: 'mech-protein-timing', kind: 'mechanism', surfaces: ['play', 'fuel', 'daily'],
      claim: { text: `You're ${r(gap)}g of protein short of today's target — but after ${s.type === 'strength' ? 'lifting' : 'a long run'} the timing matters more than the number: ~${dose}g in the next couple hours (and before bed) is when the session actually turns into muscle instead of just a deficit.`,
        data: { proteinGap: gap, dose, target: f.protein?.target, today: f.protein?.today } },
      why: `fuelForWork.protein.gap=${gap} + MPS window (post ${s.type})`,
      tone: 'neutral',
    };
  }
  return null;
}

function gEnergyAvailability(ctx) {
  const f = ctx.fuel || {};
  if (!f.ea?.flag) return null;
  // NO-FABRICATION guard. EA = (intake − exercise)/FFM, so with NOTHING logged yet the value is ~0
  // and trivially trips the low-EA flag — that's a NO-DATA artifact ("you haven't logged food"), not
  // a RED-S violation. Never assert "under the floor" off an empty fuel day (the "0 kcal/kg FFM" false
  // alarm on the Daily screen). Require real logged intake before the deficit claim is defensible.
  const cal = f.calories;
  if (!cal || !(cal.today > 0)) return null;
  // TIMELINESS. The day's fuel isn't decided at breakfast, and a nudge at bedtime is moot — "don't
  // tell me I have no energy when I wake up / when I'm going to bed" (Emil). The EA read is meaningful
  // once the fueling day is underway; suppress in the morning and at wind-down. It resurfaces midday+.
  const _d = dayOf(ctx);
  if (_d.isMorning || _d.isWindDown) return null;
  // Corrective: expose the consequence to PERFORMANCE + HEALTH + GOAL (Emil decision #2).
  const ea = f.ea.valueKcalPerKg;
  return {
    id: 'reds-lowEA', kind: 'reds', surfaces: ['fuel', 'daily'],
    claim: { text: `Energy availability${ea != null ? ` (${r(ea)} kcal/kg FFM)` : ''} is under the RED-S floor. That's not a rounding note: sustained, it costs bone density and hormones (health), blunts the very adaptation you're training for (performance), and pushes your ${ctx.goal?.aRace?.name || 'goal'} further out. Add fuel around today's work before anything else.`,
      data: { ea, floor: f.ea.floor } },
    why: `fuelForWork.EA below floor (Mountjoy IOC 2018)`,
    tone: 'corrective', salienceBoost: 0.1,
  };
}

function gCutDivergence(ctx) {
  const b = ctx.goal?.body;
  const f = ctx.fuel || {};
  if (b?.direction !== 'cut') return null;
  const rate = b.observedRateLbPerWk;
  const defPct = f.deficitPct;
  if (rate == null || defPct == null) return null;
  const pct = Math.round(defPct * 100);
  const expectedLb = Math.round((defPct * (ctx.today?.tdee || 2500) * 7 / 3500) * 100) / 100;
  const diverges = expectedLb > 0 && rate < expectedLb * 0.6;
  const base = `You're cutting ~${r(rate, 2)} lb/wk toward ${b.targetLb} while training — a sustainable background cut, not a threat to the build.`;
  const div = diverges
    ? ` One flag: your intake math says a ${pct}% deficit (that'd be ~${r(expectedLb, 1)} lb/wk), but the scale's only moving ${r(rate, 2)} — so you're likely under-logging, or your real burn is lower than the model thinks. Trust the scale, not the deficit %.`
    : '';
  return {
    id: 'cut-divergence', kind: 'divergence', surfaces: ['fuel', 'daily'],
    claim: { text: base + div, data: { rate, deficitPct: defPct, expectedLb } },
    why: `cutMode.slope14d=${rate} vs deficitPct=${defPct}`,
    tone: diverges ? 'gentle' : 'affirming',
  };
}

function gProgress(ctx) {
  const p = ctx.plan || {};
  if (p.strengthDone == null || !p.strengthTarget) return null;
  const done = p.strengthDone, tgt = p.strengthTarget;
  const on = done >= tgt;
  return {
    id: 'progress-strength-freq', kind: 'progress', surfaces: ['play', 'daily'],
    claim: { text: on
      ? `That's ${done} of ${tgt} strength days this week — the durability work's on schedule.`
      : `That's ${done} of ${tgt} strength days this week; one more keeps the durability build honest.`,
      data: { done, target: tgt } },
    why: `planWeekSummary.strength ${done}/${tgt}`,
    tone: on ? 'affirming' : 'neutral',
  };
}

function gReadiness(ctx) {
  const rd = ctx.today?.readiness;
  if (!rd || rd.band !== 'low' || !ctx.adaptation?.reason) return null;
  return {
    id: 'readiness-adapt', kind: 'readiness', surfaces: ['start', 'play', 'daily'],
    claim: { text: `Readiness is low (${r(rd.score)}) — ${ctx.adaptation.reason}. Backing off today protects the week, it doesn't cost it.`,
      data: { score: rd.score } },
    why: `computeUserState.readiness=${rd.score} + adaptSession`,
    tone: 'gentle',
  };
}

function gLearned(ctx) {
  const h = ctx.learned?.heat;
  if (!h || !(h.confidence >= 0.4) || !(h.perUnitPct > 0) || !(ctx.today?.tempC >= 24)) return null;
  const strain = Math.round(h.perUnitPct * (ctx.today.tempC - 20));
  if (strain < 3) return null;
  return {
    id: 'learned-heat', kind: 'learned', surfaces: ['start', 'play', 'daily'],
    claim: { text: `At ${r(ctx.today.tempC)}°C you carry ~${strain}% more cardiac strain than a cool day — ease the pace and get fluids in early.`,
      data: { strain, tempC: ctx.today.tempC } },
    why: `hub heatStrain ${h.perUnitPct}%/°C (conf ${h.confidence})`,
    tone: 'neutral',
  };
}

function gClinical(ctx) {
  const c = ctx.clinical || {};
  if (c.ferritin?.low) {
    return {
      id: 'clinical-ferritin', kind: 'clinical', surfaces: ['daily', 'plan', 'edgeiq'],
      claim: { text: `Your ferritin is low${c.ferritin.value != null ? ` (${r(c.ferritin.value)})` : ''} — that's very likely why easy runs have felt harder, and it caps the aerobic adaptation you're chasing. Worth addressing before adding load.`,
        data: { ferritin: c.ferritin.value } },
      why: `biomarkers.ferritin low`,
      tone: 'corrective',
    };
  }
  if (c.dexa && c.dexa.leanTrend === 'held' && ctx.goal?.body?.direction === 'cut') {
    return {
      id: 'clinical-dexa-cut', kind: 'clinical', surfaces: ['plan', 'daily'],
      claim: { text: `The last DEXA says what you're losing is fat, not muscle — the cut's working; hold the course.`, data: {} },
      why: `bodyComp DEXA leanTrend=held during cut`,
      tone: 'affirming',
    };
  }
  return null;
}

// The LIVE RE-SOLVE (ROADMAP §B item 4 / #55): reality diverged from the plan (a run was
// missed / swapped for strength), so the week is drifting from target volume. A responsive
// coach FLAGS the impact, JUDGES it by what was missed (an easy run ≠ a long run), and OFFERS
// options — absorb / redistribute / protect the key session — without cramming it all back
// (which just spikes load). It never auto-decides; the athlete picks (conflict philosophy).
function gWeekDrift(ctx) {
  const p = ctx.plan || {};
  const missedRuns = (p.missed || []).filter(m => RUN_TYPES.has(m.type));
  if (!missedRuns.length || !(p.weekMiTarget > 0)) return null;
  const projected = p.weekMiProjected != null ? p.weekMiProjected : (p.weekMiTarget - missedRuns.reduce((s, m) => s + (m.mi || 0), 0));
  const gapMi = Math.max(0, Math.round(p.weekMiTarget - projected));
  if (gapMi < 2) return null;                             // within noise → don't nag
  const pct = Math.round((gapMi / p.weekMiTarget) * 100);
  const missedKey = missedRuns.some(m => KEY_TYPES.has(m.type));
  const easyLeft = (p.remaining || []).filter(m => m.type === 'easy_run');
  const keyLeft = (p.remaining || []).filter(m => KEY_TYPES.has(m.type));
  const missedList = missedRuns.map(m => m.type.replace('_', ' ')).join(' + ');

  // Lead honestly: only claim a strength-swap when strength was actually logged on the missed
  // day (p.swappedToStrength); otherwise the run was simply missed. (The context feeds this now
  // that gWeekDrift runs on real week data, not just the original strength-swap scenario.)
  const lead = p.swappedToStrength
    ? `You logged strength but not the ${missedList}`
    : `You didn't get the ${missedList} in this week`;
  const impact = `${lead}, so the week's tracking ~${r(projected)} mi against the ~${r(p.weekMiTarget)} target — about ${gapMi} mi (${pct}%) light.`;
  const judge = missedKey
    ? ` That one matters — it was a key session, and skipping it leaves a real hole in the ${ctx.goal?.aRace?.name || 'goal'} build.`
    : ` One easy run is inside normal week-to-week variance — after a strength day your legs may even bank the recovery — so it doesn't dent ${ctx.goal?.aRace?.name || 'the goal'} on its own.`;
  const opts = [];
  if (easyLeft.length && !missedKey) opts.push(`spread ~${gapMi} mi across your remaining easy day${easyLeft.length > 1 ? 's' : ''} without touching the long run`);
  if (keyLeft.length) opts.push(`protect ${keyLeft.map(k => k.type.replace('_', ' ')).join(' + ')} and let the easy miles go`);
  opts.push(`absorb it and take the lighter week`);
  const optStr = opts.length > 1 ? `${opts.slice(0, -1).join('; ')}; or ${opts[opts.length - 1]}` : opts[0];
  const offer = ` Your call: ${optStr}. What I wouldn't do is cram it all back — that spikes the load right when you don't want it.`;

  return {
    id: 'week-drift', kind: 'planImpact', surfaces: ['start', 'play', 'daily', 'plan', 'calendar'],
    claim: { text: impact + judge + offer, data: { gapMi, pct, projected, target: p.weekMiTarget, missedKey } },
    why: `planWeekSummary missed=${missedList} + weekMi ${r(projected)}/${r(p.weekMiTarget)}`,
    tone: missedKey ? 'corrective' : 'gentle', salienceBoost: missedKey ? 0.12 : 0,
  };
}

// Grounded FUEL STATUS — the everyday fuel voice that WEAVES THE DISPLAYED METRICS (Emil's
// decision #1). Fires whenever there's a real calorie target, so the Fuel/Daily surface speaks
// the athlete's actual intake-vs-target instead of a generic "fuel steadily" line. Pure metric
// reporting → no fabrication; it never fires without logged numbers. Low gravity (context), so
// any corrective/mechanism beat still leads; on an ordinary day it IS the line.
function gFuelStatus(ctx) {
  const f = ctx.fuel || {};
  const cal = f.calories;
  if (!cal || !(cal.target > 0)) return null;                 // no target/intake → stay silent
  const prot = f.protein;
  const pctC = cal.pct != null ? Math.round(cal.pct * 100) : null;
  const kLeft = Math.max(0, Math.round(cal.target - cal.today));
  const over = cal.pct != null && cal.pct > 1.08;
  const pGap = prot && prot.gap != null ? prot.gap : null;
  const pTail = pGap != null && pGap > 3 ? ` and ${pGap}g protein` : '';
  // Phase, not raw hour: the old `hour < 11` branch fired the "front-load protein early" nag at
  // MIDNIGHT (hour 0), and there was no wind-down wrap. day.phase fixes both — the small hours are
  // `wind_down`, where the day's intake is a WRAP, not a target to chase (Emil: don't nag food at bed).
  const day = dayOf(ctx);
  let text, tone;
  if (over) {
    text = `You're past today's ${cal.target} kcal (${cal.today} in) — no need to claw it back; just skew what's left protein-led and lighter on fat.`;
    tone = 'gentle';
  } else if (day.isWindDown) {
    text = `Day's fuel: ${cal.today} of ${cal.target} kcal in${kLeft > 60 ? ` (${kLeft} under — no need to chase it now)` : ''}. Sleep's the next input.`;
    tone = 'affirming';
  } else if (day.isMorning) {
    text = `${pctC != null ? `${pctC}% of the way to` : 'Building toward'} today's ${cal.target} kcal${prot?.target ? ` · ${prot.target}g protein` : ''} — front-load protein early so tonight isn't a scramble.`;
    tone = 'neutral';
  } else {
    text = kLeft > 0
      ? `You're at ${cal.today} of ${cal.target} kcal${pTail ? `,${pTail} to go` : ''} — about ${kLeft} kcal left, so keep meals steady and protein-forward.`
      : `Fuel's on pace — ${cal.today} of ${cal.target} kcal in, protein tracking. Keep the rhythm.`;
    tone = 'neutral';
  }
  return {
    id: 'fuel-status', kind: 'context', surfaces: ['fuel', 'daily'],
    claim: { text, data: { calToday: cal.today, calTarget: cal.target, pctC, proteinGap: pGap } },
    why: `nutrition intake ${cal.today}/${cal.target} kcal`,
    tone,
  };
}

// The DEDICATED PLAN voice (Emil): the Planner is where the plan + its execution live, so its
// surface gets its OWN oversight beat — how the week is holding to plan, the deviations/challenges
// you've made (an injury reshape), strength-frequency progress, and the net read on the goal.
// It's the plan analogue of gFuelStatus: a grounded, always-when-there's-a-plan observation that
// speaks about THIS surface's metrics, not a fuel/body message borrowed from another surface. The
// detailed missed-run re-solve stays with gWeekDrift (higher salience, leads); gPlanStatus then
// defers the volume math to it and fills in the injury / strength / goal framing so they don't repeat.
function gPlanStatus(ctx) {
  const p = ctx.plan || {};
  if (!(p.weekMiTarget > 0)) return null;                       // no running plan this week → silent
  const missedRuns = (p.missed || []).filter((m) => RUN_TYPES.has(m.type));
  const driftOwnsVolume = missedRuns.length > 0;                // gWeekDrift will speak the volume math
  const proj = p.weekMiProjected != null ? p.weekMiProjected : p.weekMiTarget;
  const remaining = (p.remaining || []).length;
  const race = ctx.goal?.aRace;
  const injury = ctx.today?.injuryArea;
  const parts = [];
  if (!driftOwnsVolume) {
    parts.push(`Your week is holding to plan — ~${r(p.weekMiTarget)} mi across the sessions${remaining ? `, ${remaining} still ahead` : ''}.`);
  }
  if (injury && injury !== 'generic') {
    parts.push(`You've reshaped it around your ${injury} — the right call: protecting the joint now keeps the block intact, and shifting the aerobic work to low-impact holds the stimulus without the pounding.`);
  }
  if (p.strengthTarget) {
    parts.push(`Strength is ${p.strengthDone || 0}/${p.strengthTarget} this week${(p.strengthDone || 0) >= p.strengthTarget ? ' — the durability work is on schedule' : ' — one more keeps the durability base honest'}.`);
  }
  if (race?.name) {
    parts.push(`${driftOwnsVolume ? 'Net' : 'Bottom line'}: still on line for ${race.name}${race.daysOut != null ? ` (${race.daysOut}d out)` : ''} as the base builds toward peak — the changes reshape the week, they don't set back the goal.`);
  }
  if (!parts.length) return null;
  return {
    id: 'plan-status', kind: 'progress', surfaces: ['plan'],
    claim: { text: parts.join(' '), data: { target: p.weekMiTarget, projected: proj, remaining, injury: injury || null } },
    why: `plan slice weekMi ${r(proj)}/${r(p.weekMiTarget)} + injury=${injury || 'none'} + strength ${p.strengthDone || 0}/${p.strengthTarget || 0}`,
    tone: driftOwnsVolume ? 'gentle' : 'affirming',
  };
}

const GENERATORS = [gPurpose, gKnockOn, gWeekDrift, gMechanism, gEnergyAvailability, gCutDivergence, gProgress, gReadiness, gLearned, gClinical, gFuelStatus, gPlanStatus];

// ─────────────────────────── RANK + RECONCILE + COMPOSE ───────────────────────────
function salience(beat, surface, ctx) {
  const base = GRAVITY[beat.kind] ?? 0.4;
  const surfaceFit = beat.surfaces.includes(surface) ? 0.15 : 0;
  const boost = beat.salienceBoost || 0;
  // Novelty: down-weight if the coach said this recently (episodic memory; 0 when absent).
  const saidAgo = ctx.memory?.saidAgoDays?.[beat.id];
  const novelty = saidAgo != null && saidAgo < 2 ? -0.25 : 0;
  // Preference: down-weight kinds the user ignores (0 when no engagement model yet).
  const pref = (ctx.memory?.kindWeight?.[beat.kind] ?? 0);
  return clamp01(base + surfaceFit + boost + novelty + pref);
}

function reconcile(beats) {
  // Suppress tonal clash: if a corrective/reds/conflict beat is present, drop the affirming
  // "progress/purpose" cheerleading AND the reassuring "your cut is fine" divergence beat that
  // would read tone-deaf next to it (a RED-S alarm + "sustainable background cut" in one breath
  // is both verbose and contradictory — Emil).
  let out = beats.filter(Boolean);
  const hasCorrective = out.some(b => b.tone === 'corrective');
  if (hasCorrective) out = out.filter(b => {
    if (b.tone === 'affirming' && (b.kind === 'progress' || b.kind === 'purpose')) return false;
    if (b.kind === 'divergence' && (b.tone === 'affirming' || b.tone === 'gentle')) return false;
    return true;
  });
  // Dedupe by id.
  const seen = new Set();
  return out.filter(b => (seen.has(b.id) ? false : seen.add(b.id)));
}

// Beats per surface. Deliberately LOW — the digest is one tight read, not a data dump. Combined
// with topic-dedup below, each surface shows the leader + at most one distinct supporting point
// (Emil: the Daily/Fuel write-up was stacking 4 same-domain beats into a wall of text).
const SURFACE_K = { start: 1, edgeiq: 2, play: 2, fuel: 2, daily: 2, plan: 2, trend: 2, calendar: 2 };

// A beat's TOPIC (coarser than kind) — selection takes at most ONE beat per topic so the paragraph
// never stacks three nutrition beats (RED-S + cut + fuel-status) or two plan beats. Distinct topics
// = distinct ideas; that's what keeps the read short and non-repetitive.
const TOPIC = {
  'reds-lowEA': 'fuel', 'mech-protein-timing': 'fuel', 'fuel-status': 'fuel',
  'cut-divergence': 'body',
  'plan-status': 'plan', 'week-drift': 'plan',
  'readiness-adapt': 'readiness', 'learned-heat': 'heat',
  'clinical-ferritin': 'clinical', 'clinical-dexa-cut': 'clinical',
  'knockon-recover': 'train',
};
const topicOf = (b) => TOPIC[b.id]
  || (b.id.startsWith('purpose') ? 'train' : b.id.startsWith('progress') ? 'train' : b.kind);

// Compose selected beats into one arc. v1 = deterministic join (the LLM phraser replaces
// ONLY this step later). Beats are full sentences carrying their metric, so a light join
// reads as a cohesive paragraph.
function compose(beats, surface) {
  if (!beats.length) return null;
  const texts = beats.map(b => b.claim.text.trim());
  return { text: texts.join(' '), tone: dominantTone(beats), beats: beats.map(b => ({ id: b.id, kind: b.kind, why: b.why })) };
}

function dominantTone(beats) {
  if (beats.some(b => b.tone === 'corrective')) return 'corrective';
  if (beats.some(b => b.tone === 'gentle')) return 'gentle';
  if (beats.some(b => b.tone === 'affirming')) return 'affirming';
  return 'neutral';
}

/**
 * narrateSurface — the one public API. Given the assembled context and a surface id,
 * returns { text, tone, beats } or null (coach stays silent when nothing grounded fires).
 */
export function narrateSurface(ctx, surface) {
  if (!ctx) return null;
  const all = reconcile(GENERATORS.map(g => { try { return g(ctx); } catch { return null; } }));
  const relevant = all
    .filter(b => b.surfaces.includes(surface))
    .map(b => ({ b, s: salience(b, surface, ctx) }))
    .sort((x, y) => y.s - x.s);
  const k = SURFACE_K[surface] ?? 2;
  // Greedy pick by salience, but at most ONE beat per topic → the leader plus distinct supporting
  // ideas, never the same domain stacked (keeps the paragraph short and non-repetitive).
  const picked = [];
  const topics = new Set();
  for (const { b } of relevant) {
    const t = topicOf(b);
    if (topics.has(t)) continue;
    topics.add(t);
    picked.push(b);
    if (picked.length >= k) break;
  }
  return compose(picked, surface);
}

/** All beats (debug / EdgeIQ depth / tests). */
export function allBeats(ctx) {
  return reconcile(GENERATORS.map(g => { try { return g(ctx); } catch { return null; } }));
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

export { GENERATORS, GRAVITY, dayOf };
