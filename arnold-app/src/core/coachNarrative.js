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
  knockOn: 0.60, mechanism: 0.55, divergence: 0.55, durability: 0.50, potential: 0.50, execution: 0.50, learned: 0.45,
  session: 0.52, purpose: 0.48, aerobic: 0.40, progress: 0.40, context: 0.30,
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

// EXECUTION voice — the "how to run THIS session" cue. gPurpose says WHY today's session exists; this
// says HOW to execute it well. Together they turn the pre-workout tile (the first thing seen) from one
// thin line into a why + how read. Grounded in the session TYPE only — evergreen coaching knowledge
// (same class as BUILDS), never fabricated data. Distinct 'execution' kind → its own topic, so it sits
// ALONGSIDE purpose instead of deduping against it. Suppressed once trained (the job's done) and when a
// readiness adaptation is active (the back-off IS the execution guidance that day — no contradiction).
const EXECUTE = {
  easy_run:  'Run it genuinely easy — conversational, breathing controlled. The gain here is aerobic; pushing the pace only borrows from your next quality day.',
  long_run:  'Settle into a steady aerobic effort and hold form late — fuel every 30–40 min and let the back third come to you. The final hour is where the marathon adaptation actually lives.',
  tempo:     'Comfortably hard and even — the effort you could just hold for an hour, not a race. Lock the rhythm early rather than chasing splits.',
  intervals: 'Honest, full efforts on the reps with complete recovery between — quality over survival. It\'s the top-end here that lifts everything sitting under it.',
  hiit:      'Honest, full efforts on the reps with complete recovery between — quality over survival. It\'s the top-end here that lifts everything sitting under it.',
  strength:  'Move with control and intent — this is the durability and running-economy work that protects every mile. Clean, quality reps beat heavy sloppy ones.',
};
function gExecution(ctx) {
  const s = ctx.today?.primarySession;
  if (!s || !EXECUTE[s.type]) return null;
  if (dayOf(ctx).postWorkout) return null;                          // pre-workout only — spent once trained
  if (ctx.adaptation && ctx.adaptation.action) return null;         // readiness back-off owns the "how" today
  return {
    id: 'execution-' + s.type, kind: 'execution', surfaces: ['play'],
    claim: { text: EXECUTE[s.type], data: { session: s.type } },
    why: `EXECUTE[${s.type}] (type-grounded execution cue)`,
    tone: 'neutral',
  };
}

// Post-workout SESSION READ. gPurpose is a PRE-workout preview and goes quiet once you train — which
// left the Play/Daily surface (the one SHOWING the run) with nothing to say about the session just
// done, so it fell through to strength-progress ("2 of 3 strength days") after an easy RUN (Emil's
// screenshot). This fills that gap: after training, acknowledge what was actually completed, framed
// by what it builds. Same 'train' topic as purpose/progress and higher gravity, so on a post-run
// surface it LEADS instead of the strength tally. Grounded (session type only — no fabricated splits).
// What the just-completed session BUILDS (the read's tail). The lead is grounded in the ACTUAL
// distance when it's logged — no fabrication; falls back to a distance-free lead otherwise.
const DONE_FRAME = {
  strength:  'the durability and running-economy that protects every mile.',
  long_run:  'the biggest aerobic block of the week.',
  intervals: 'the top-end speed your goal pace sits under, sharpened.',
  tempo:     'the threshold you hold marathon pace beneath, lifted.',
  easy_run:  'the aerobic base the whole build compounds on.',
};
function gSessionDone(ctx) {
  const s = ctx.today?.primarySession;
  if (!s || !dayOf(ctx).postWorkout || !DONE_FRAME[s.type]) return null;   // only after today's session is logged
  const dv = Number(s.distanceMi);
  const d = dv > 0 ? (Number.isInteger(dv) ? String(dv) : dv.toFixed(1)) : null;   // "16" / "7.5", never "16.0"
  const lead = {
    easy_run:  d ? `That's ${d} mi of easy running banked` : 'Easy miles banked',
    long_run:  d ? `That's your ${d} mi long run banked` : 'Long run banked',
    intervals: d ? `Intervals done — ${d} mi of work` : 'Intervals done',
    tempo:     d ? `Tempo in — ${d} mi` : 'Tempo in',
    strength:  'Strength work is in',
  }[s.type];
  return {
    id: 'session-done-' + s.type, kind: 'session', surfaces: ['start', 'play', 'daily'],
    claim: { text: `${lead} — ${DONE_FRAME[s.type]}`, data: { session: s.type, distanceMi: d != null ? dv : null } },
    why: `post-workout read of logged ${s.type}${d != null ? ` (${d} mi)` : ''}`,
    tone: 'affirming',
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

// P3 — the CHRONIC REDs screen (2023 IOC multi-indicator), distinct from the acute daily EA nudge above. Stays
// QUIET when green (the Health screen shows the traffic light; no need to nag a well-fuelled athlete). Speaks
// only when the biomarker constellation actually flags — and always defers diagnosis to a clinician.
function gRedS(ctx) {
  const s = ctx.reds;
  if (!s || !s.overall || s.overall.status === 'green') return null;
  const st = s.overall.status;
  const flagged = (s.indicators || []).filter((i) => i.status === 'orange' || i.status === 'red').map((i) => i.label);
  const text = (st === 'red' || st === 'orange')
    ? `Energy-availability screen is ${st === 'red' ? 'flagging clearly' : 'elevated'}: ${s.overall.summary}${flagged.length ? ` (${flagged.slice(0, 2).join('; ')})` : ''} ${s.handoff}`
    : `Energy-availability screen — ${s.overall.summary}`;
  return {
    id: 'reds-screen-' + st, kind: 'reds', surfaces: ['edgeiq', 'plan', 'daily'],
    claim: { text, data: { status: st, flagged } },
    why: `redsScreen ${st} (2023 IOC multi-indicator)`,
    tone: st === 'yellow' ? 'gentle' : 'corrective',
    salienceBoost: st === 'red' ? 0.15 : st === 'orange' ? 0.1 : 0,
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

// DURABILITY — the fourth pillar (P2). Reads ctx.durability (decoupling on long runs when present, else the
// long-run efficiency trend). This is the marathon-specific "can you HOLD pace late" read almost no app
// coaches; the number/trend is computed deterministically, the coach just voices it. Its own topic so it can
// co-exist with a purpose/session read rather than being deduped into the generic 'train' slot.
function gDurability(ctx) {
  const d = ctx.durability;
  if (!d || !d.label) return null;
  const bad = d.state === 'fading' || d.trend === 'declining';
  const good = d.state === 'durable' || d.trend === 'improving';
  return {
    id: 'durability-' + (d.source || 'x'), kind: 'durability', surfaces: ['play', 'plan', 'daily'],
    claim: { text: d.label, data: { source: d.source, fadePct: d.fadePct ?? null, trendPct: d.trendPct ?? null } },
    why: `durability ${d.source} state=${d.state || '-'} trend=${d.trend} n=${d.nLong}`,
    tone: bad ? 'gentle' : good ? 'affirming' : 'neutral',
  };
}

// Aerobic ceiling (the "big engine, race legs" gap). Reads ctx.potentialGap (race-anchored VDOT vs measured
// VO2max). This is UPSIDE, not a threat — it tells the athlete their engine is ahead of their race times and
// names the lever (threshold/economy), WITHOUT ever presenting the ceiling as a prediction. It only speaks when
// the gap is actionable (large/moderate) or the data needs a re-test (racing above the reading). Small/matched
// gaps stay quiet — nagging "you're near your ceiling" every day is exactly the lingering the design avoids.
function gPotentialGap(ctx) {
  const g = ctx.potentialGap;
  if (!g || !(g.confidence >= 0.4)) return null;
  const engine = g.measuredVo2, pts = g.gapVdot;
  let text, tone = 'affirming';
  if (g.magnitude === 'large') {
    text = `Your aerobic engine (VO₂max ${r(engine)}) is running ahead of your race legs — about ${r(pts, 1)} VDOT points. That's upside you bank with threshold and economy work, not more easy miles. If it converts, the ceiling is ~${g.ceilingStr} (a realistic next step is ~${g.reachStr}).`;
  } else if (g.magnitude === 'moderate') {
    text = `Your engine has a bit more than your recent races show (~${r(pts, 1)} points). Threshold work is the lever that converts it — a realistic reach is ~${g.reachStr}.`;
    tone = 'affirming';
  } else if (g.lever === 'retest') {
    text = `You're racing at or above your last measured VO₂max (${r(engine)}) — either the reading is stale or your economy is genuinely excellent. Worth a fresh VO₂max test so the ceiling recalibrates.`;
    tone = 'neutral';
  } else {
    return null;   // small / at-ceiling → not worth a daily line
  }
  return {
    id: 'potential-' + (g.source || 'x'), kind: 'potential', surfaces: ['plan', 'edgeiq', 'play'],
    claim: { text, data: { measuredVo2: engine, gapVdot: pts, ceiling: g.ceilingStr, reach: g.reachStr, lever: g.lever, source: g.source, confidence: g.confidence } },
    why: `potentialGap engine=${engine} raceVdot=${g.raceVdot} gap=${pts} lever=${g.lever} src=${g.source}(${g.confidence})`,
    tone,
    salienceBoost: g.magnitude === 'large' ? 0.08 : 0,
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

// Clinical (Stage 7 / Phase F): bloodwork + DEXA connected to training/fuel/recovery/goal. The data
// layer (clinicalCoach.buildClinicalContext) classifies the panel via the app's own reference engine
// and emits pre-framed, RANKED observations; the coach surfaces the single most salient one. SCOPE:
// flag + training relevance + professional hand-off — never a diagnosis (the claims carry the hand-off).
function gClinical(ctx) {
  const flags = ctx.clinical?.flags;
  if (!Array.isArray(flags) || !flags.length) return null;
  const top = flags[0];                                  // pre-ranked by severity in the data layer
  if (!top || !top.claim) return null;
  return {
    id: top.id, kind: 'clinical', surfaces: ['daily', 'plan', 'edgeiq'],
    claim: { text: top.claim, data: top.data || {} },
    why: top.why || 'biomarkers',
    tone: top.tone || 'corrective',
    salienceBoost: top.severity >= 0.85 ? 0.1 : 0,
  };
}

// ── NAMING A SESSION THE WAY THE ATHLETE WAS SHOWN IT ────────────────────────────────────
// Emil, on a rebuilt app: *"the Coach is still saying that I missed the easy run"* — and the
// reason it makes no sense to him is that his calendar does not say "easy run" anywhere on the
// day in question. His own stored planner holds days whose `type` and `label` disagree: one is
// `type: 'easy_run'` with `label: 'Intervals 5mi'`, another is `type: 'cycle'` labelled
// 'Tempo 5mi + strength'. `type` is the coach's internal bucket; `label` is the string printed on
// the tile and in the drawer, and it is therefore the only name for the session the athlete has
// ever seen. When they disagree, the athlete is not wrong — he is reading the screen.
//
// So: prefer the label, stripped of the distance and the "+ strength" tail so it reads as a name
// inside a sentence, and fall back to the type when no label travelled (every synthetic caller,
// the coach sim, and the four-argument computePlanSlice callers — their text is unchanged).
function nameOf(m) {
  const raw = String((m && m.label) || '')
    .replace(/\s*\+\s*strength\s*$/i, '')
    .replace(/\s*\d+(\.\d+)?\s*mi\b/ig, '')
    .trim();
  return (raw || String((m && m.type) || 'run').replace(/_/g, ' ')).toLowerCase();
}
// Which day it was, named. "You didn't get Thursday's intervals" is checkable against the
// calendar in a way "you didn't get the easy run in this week" never was. UTC arithmetic so a DST
// boundary cannot slide the answer onto the neighbouring day and name the wrong one.
const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayNameOf(m) {
  const s = m && m.date;
  if (typeof s !== 'string' || s.length !== 10) return '';
  const p = s.split('-').map(Number);
  if (p.length !== 3 || p.some(n => !Number.isFinite(n))) return '';
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return Number.isFinite(dt.getTime()) ? DOW_NAME[dt.getUTCDay()] : '';
}

// The LIVE RE-SOLVE (ROADMAP §B item 4 / #55): reality diverged from the plan (a run was
// missed / swapped for strength), so the week is drifting from target volume. A responsive
// coach FLAGS the impact, JUDGES it by what was missed (an easy run ≠ a long run), and OFFERS
// options — absorb / redistribute / protect the key session — without cramming it all back
// (which just spikes load). It never auto-decides; the athlete picks (conflict philosophy).
function gWeekDrift(ctx) {
  const p = ctx.plan || {};
  const missedRuns = (p.missed || []).filter(m => RUN_TYPES.has(m.type));
  if (!(p.weekMiTarget > 0)) return null;
  const projected = p.weekMiProjected != null ? p.weekMiProjected : (p.weekMiTarget - missedRuns.reduce((s, m) => s + (m.mi || 0), 0));
  const gapMi = Math.max(0, Math.round(p.weekMiTarget - projected));
  const pctOf = (mi) => Math.round((mi / p.weekMiTarget) * 100);
  const missedKey = missedRuns.some(m => KEY_TYPES.has(m.type));
  const easyLeft = (p.remaining || []).filter(m => m.type === 'easy_run');
  const keyLeft = (p.remaining || []).filter(m => KEY_TYPES.has(m.type));
  const missedList = missedRuns.map(nameOf).join(' + ');

  // ── WHERE THE GAP ACTUALLY CAME FROM ──────────────────────────────────────────────────
  // A week can end up light two entirely different ways: sessions you did not do, and sessions
  // you did shorter than they were written. computePlanSlice now hands over `donePlannedMi` —
  // what the plan asked of the days he DID get out on — and the two decompose exactly:
  //     gap = missedMi − (actual − donePlannedMi)
  // so the coach can stop asserting that the skipped run caused the whole hole. It usually
  // didn't. `doneUnmeasuredMi` is the honesty gate: if any logged run arrived without a
  // distance on it, the difference is not evidence of anything and no claim is made either way.
  const measured = p.weekMiActual != null && p.donePlannedMi != null && !(p.doneUnmeasuredMi > 0.5);
  const actualRaw = p.weekMiActualRaw != null ? p.weekMiActualRaw : p.weekMiActual;
  const overOnDays = measured ? (actualRaw - p.donePlannedMi) : null;   // + ran further than asked, − came in short
  const shortOnDays = overOnDays != null && overOnDays <= -0.5 ? Math.round(-overOnDays) : 0;
  const extraOnDays = overOnDays != null && overOnDays >= 0.5 ? Math.round(overOnDays) : 0;

  // ── NOTHING MISSED, BUT THE WEEK IS STILL SHORT ───────────────────────────────────────
  // The old function returned here and said nothing at all. That left the athlete who gets out
  // every single day and quietly runs 7.5 where the plan wrote 9 with a completely silent coach —
  // the same failure as the drift beat, only inverted: it used to shout about distribution and it
  // was deaf to delivery. He is owed the number either way.
  if (!missedRuns.length) {
    if (!measured || gapMi < 2 || shortOnDays < 2) return null;
    const leftMi = (p.remaining || []).reduce((s, m) => s + (m.mi || 0), 0);
    return {
      id: 'week-short', kind: 'planImpact', surfaces: ['play', 'daily', 'plan', 'calendar'],
      claim: {
        // TRIMMED in the same round it was written. The quality eval's `concise` pass rate fell to
        // 0.9994 on the first draft: at ~490 chars it crossed the 1000-char wall-of-text bound once
        // composed with plan-status on the `plan` surface — which is the exact complaint Emil has
        // now made three separate times. Every FACT survived the cut; only the padding went.
        text: `You've made every run the week asked for — they've just come in ~${shortOnDays} mi (${pctOf(shortOnDays)}%) under what was written: ${r(actualRaw)} mi where those days asked ~${r(p.donePlannedMi)}.${leftMi > 0 ? ` The week projects ~${r(projected)} against ~${r(p.weekMiTarget)}.` : ''} Showing up every day is the harder half. If you want the miles back, add them to an easy day, not the long run. If the written numbers are longer than your days allow, say so and the plan should come down to meet you.`,
        data: { shortMi: shortOnDays, actualMi: actualRaw, askedMi: p.donePlannedMi, target: p.weekMiTarget },
      },
      why: `planWeekSummary no misses, ran ${r(actualRaw)}/${r(p.donePlannedMi)} mi on the days it asked`,
      tone: 'gentle',
    };
  }

  // MILES MADE UP ELSEWHERE. A session was skipped but the week's volume is intact — the athlete
  // ran further on the days he did go out. That is a real and DIFFERENT fact from being behind, and
  // saying nothing would be its own kind of dishonesty: he moved his week around and deserves to be
  // told the move worked. Only ever emitted when the miles were actually MEASURED
  // (`weekMiActual` is set only when computePlanSlice was handed real logged distances), because
  // the alternative — inferring delivery from the plan — is what produced the wrong read in the
  // first place. A missed KEY session never reaches here: 12 easy miles do not replace a tempo,
  // and volume covering for intensity is exactly the trade a coach must refuse to praise.
  if (p.weekMiActual != null && gapMi < 2 && !missedKey) {
    const over = Math.round(p.weekMiActual - (p.weekMiTarget - (p.remaining || []).reduce((s, m) => s + (m.mi || 0), 0)));
    return {
      id: 'week-redistributed', kind: 'planImpact', surfaces: ['play', 'daily', 'plan', 'calendar'],
      claim: {
        text: `You skipped the ${missedList} but the week is whole — ${r(p.weekMiActual)} mi run against a ~${r(p.weekMiTarget)} mi week, because you went longer on the days you did get out.${over > 0 ? ` That is ~${over} mi more than the days you ran were asked for.` : ''} Volume is not the thing to fix here; if anything, watch that the made-up miles didn't turn an easy day into a hard one.`,
        data: { actualMi: p.weekMiActual, target: p.weekMiTarget, missed: missedList },
      },
      why: `planWeekSummary missed=${missedList} but actual ${r(p.weekMiActual)}/${r(p.weekMiTarget)} mi`,
      tone: 'neutral',
    };
  }
  if (gapMi < 2) return null;                             // within noise → don't nag
  const pct = pctOf(gapMi);

  // Lead honestly: only claim a strength-swap when strength was actually logged on the missed
  // day (p.swappedToStrength); otherwise the run was simply missed. (The context feeds this now
  // that gWeekDrift runs on real week data, not just the original strength-swap scenario.)
  // Name the DAY when every missed session carried a date — "Thursday's intervals" is something he
  // can check against his own calendar. Without dates the phrasing is byte-for-byte what it was.
  const named = missedRuns.length > 0 && missedRuns.every(m => dayNameOf(m));
  const missedPhrase = named
    ? missedRuns.map(m => `${dayNameOf(m)}'s ${nameOf(m)}`).join(' + ')
    : `the ${missedList} in this week`;
  const lead = p.swappedToStrength
    ? `You logged strength but not ${missedPhrase}`
    : `You didn't get ${missedPhrase}`;
  const tail = `the week's tracking ~${r(projected)} mi against the ~${r(p.weekMiTarget)} target — about ${gapMi} mi (${pct}%) light.`;
  // THE SENTENCE THAT WAS WRONG. It used to be `${lead}, so ${tail}` unconditionally — a causal
  // claim that the skipped session produced the entire gap. When he also ran 7.5 where the plan
  // said 9.0, that is simply false, and a coach that gets the cause wrong cannot be trusted on the
  // remedy. Only assert `so` when the arithmetic actually supports it.
  const impact = shortOnDays >= 1
    ? `${lead}, and you were ~${shortOnDays} mi short across the days you did run — together ${tail}`
    : extraOnDays >= 1
      ? `${lead}. You ran ~${extraOnDays} mi more than asked on the days you did get out, which covers part of it, so ${tail}`
      : `${lead}, so ${tail}`;
  const judge = missedKey
    ? ` That one matters — it was a key session, and skipping it leaves a real hole in the ${ctx.goal?.aRace?.name || 'goal'} build.`
    : ` One ${missedRuns.length > 1 ? 'missed easy day' : nameOf(missedRuns[0])} is inside normal week-to-week variance — after a strength day your legs may even bank the recovery — so it doesn't dent ${ctx.goal?.aRace?.name || 'the goal'} on its own.`;
  const opts = [];
  if (easyLeft.length && !missedKey) opts.push(`spread ~${gapMi} mi across your remaining easy day${easyLeft.length > 1 ? 's' : ''} without touching the long run`);
  if (keyLeft.length) opts.push(`protect ${keyLeft.map(nameOf).join(' + ')} and let the easy miles go`);
  opts.push(`absorb it and take the lighter week`);
  const optStr = opts.length > 1 ? `${opts.slice(0, -1).join('; ')}; or ${opts[opts.length - 1]}` : opts[0];
  const offer = ` Your call: ${optStr}. What I wouldn't do is cram it all back — that spikes the load right when you don't want it.`;

  return {
    // NB: NOT on 'start' — the drift beat is a full impact+judge+options read (~450–550 chars) and the
    // start cockpit is a one-line surface (Stage 5 quality finding: it overflowed the 420-char budget).
    // The compact cockpit shows a shorter beat; the full drift read lives where there's room to act on it.
    id: 'week-drift', kind: 'planImpact', surfaces: ['play', 'daily', 'plan', 'calendar'],
    claim: { text: impact + judge + offer, data: { gapMi, pct, projected, target: p.weekMiTarget, missedKey } },
    why: `planWeekSummary missed=${missedList} + weekMi ${r(projected)}/${r(p.weekMiTarget)}`,
    tone: missedKey ? 'corrective' : 'gentle', salienceBoost: missedKey ? 0.12 : 0,
  };
}

// RESPONSIVE re-calibration — the coach reacts to an INTENTIONAL change the moment you make it (a swap, a
// cross-train substitution, a move, a skip), acknowledges it, states the honest tax by the SESSION'S ROLE, and
// re-calibrates the rest of the week. This is the "why didn't the coach say anything when I changed the plan?"
// fix. Reads ctx.planChange (recorded at commit time). Fades after a few days so it never lingers.
// planChangeBeat — the core (pure): a change + race name → { text, brief, tone } or null. `text` is the
// full re-calibrating read for the coach surfaces; `brief` is the one-sentence version for the moment-of-
// action toast (the instant you commit the change). gPlanChange wraps it for the narrative engine, and
// planChangeLine exports it for the commit handler, so the SAME voice speaks in both places.
function planChangeBeat(c, raceName) {
  if (!c || !c.kind) return null;
  const race = raceName || 'your race';
  const XTRAIN = /bike|cycl|pool|swim|row|elliptical|cardio|ride/i;
  const ROLE = {
    long_run: { name: 'long run', key: true, tax: 'the run-specific durability it builds — impact tolerance, economy and leg endurance', role: 'marathon endurance' },
    tempo: { name: 'tempo', key: true, tax: 'the threshold stimulus', role: 'sustainable speed' },
    threshold: { name: 'threshold run', key: true, tax: 'the threshold stimulus', role: 'sustainable speed' },
    intervals: { name: 'intervals', key: true, tax: 'the VO₂/top-end stimulus', role: 'top-end speed' },
    hiit: { name: 'session', key: true, tax: 'the high-intensity stimulus', role: 'top-end speed' },
    easy_run: { name: 'easy run', key: false, tax: 'a bit of easy aerobic volume', role: 'aerobic base' },
  };
  const from = ROLE[c.fromType] || { name: (c.fromType || 'session').replace('_', ' '), key: false, tax: 'some training load', role: 'the week' };
  const toName = (c.toType || '').replace('_', ' ');
  const isXtrain = XTRAIN.test(c.toType || '') || XTRAIN.test(toName);
  let text, brief, tone = 'affirming';

  if (c.kind === 'substitute' && isXtrain) {
    const dur = c.durationMin ? `${c.durationMin}-min ` : '';
    const holds = from.key
      ? `You keep some aerobic base and — importantly — offload the joint, but ${toName} carries none of ${from.tax}. So your ${from.role} holds flat this week rather than building.`
      : `That keeps the aerobic stimulus while sparing the impact — a clean swap.`;
    const recal = from.key
      ? ` Re-calibrating: protect your other quality session this week (don't drop that too), and get the ${from.name} back next week if the knee's settled. One swap is noise; a pattern is where the base stalls.`
      : '';
    text = `You swapped your ${from.name} for a ${dur}${toName} — good call if the knee needed protecting. ${holds}${recal} Smart trade: you protect your training rather than risk a layoff.`;
    brief = from.key
      ? `Swapped your ${from.name} for a ${dur}${toName} — smart if the knee needed it; your ${from.role} holds flat this week rather than building.`
      : `Swapped your ${from.name} for a ${toName} — a clean swap that spares the impact.`;
  } else if (c.kind === 'substitute' || c.kind === 'shorten') {
    text = c.kind === 'shorten'
      ? `Shortened your ${from.name} — that keeps most of the stimulus at lower load. A sensible compromise on a day your legs need it; the week still holds together.`
      : `De-loaded your ${from.name} to ${toName || 'an easier session'} — sensible if you're managing a niggle or a down week. The week runs a touch lighter; nothing that dents ${race} on its own.`;
    brief = c.kind === 'shorten'
      ? `Shortened your ${from.name} — most of the stimulus at lower load; the week still holds.`
      : `Eased your ${from.name} to ${toName || 'a lighter session'} — the week runs a touch lighter, nothing that dents ${race}.`;
    tone = 'neutral';
  } else if (c.kind === 'move') {
    text = `Moved your ${from.name}${c.toDate ? ' out a day' : ''} — the week still balances. Just keep the day before it easy so it lands on fresh legs; where a session sits matters less than that it happens.`;
    brief = `Moved your ${from.name}${c.toDate ? ' out a day' : ''} — the week still balances; keep the day before it easy.`;
    tone = 'neutral';
  } else if (c.kind === 'skip') {
    text = from.key
      ? `You skipped your ${from.name} — that one carries the ${from.role} load, so it leaves a real hole in the ${race} build. If the body allowed it, worth getting back this week; if it didn't, protect the next key session and let this go rather than cramming it back.`
      : `You skipped an ${from.name} — inside normal week-to-week variance; it doesn't dent ${race} on its own. Carry on.`;
    brief = from.key
      ? `Skipped your ${from.name} — that one carries the ${from.role} load; worth getting back this week if the body allowed it.`
      : `Skipped an ${from.name} — inside normal variance; carry on.`;
    tone = from.key ? 'gentle' : 'affirming';
  } else return null;

  return { text, brief, tone, kind: c.kind, fromType: c.fromType, toType: c.toType, ageDays: c.ageDays };
}

// RESPONSIVE re-calibration — the coach reacts to an INTENTIONAL change the moment you make it (a swap, a
// cross-train substitution, a move, a skip), acknowledges it, states the honest tax by the SESSION'S ROLE, and
// re-calibrates the rest of the week. This is the "why didn't the coach say anything when I changed the plan?"
// fix. Reads ctx.planChange (recorded at commit time). Fades after a few days so it never lingers.
function gPlanChange(ctx) {
  const c = ctx.planChange;
  const b = planChangeBeat(c, ctx.goal?.aRace?.name);
  if (!b) return null;
  return {
    id: 'plan-change-' + c.kind, kind: 'planImpact', surfaces: ['play', 'daily', 'plan', 'calendar'],
    claim: { text: b.text, data: { kind: c.kind, fromType: c.fromType, toType: c.toType, brief: b.brief } },
    why: `planChanges ${c.kind} ${c.fromType || ''}→${c.toType || ''} (${c.ageDays ?? 0}d ago)`,
    tone: b.tone, salienceBoost: 0.14,   // a fresh decision → surface it promptly
  };
}

/**
 * planChangeLine(change, opts) — the moment-of-action voice. Given a just-committed change
 * ({ kind, fromType, toType, durationMin, toDate }) and { raceName, brief }, returns the coach's
 * one-line reaction (brief by default) to show the instant the change is made. null if not speakable.
 */
export function planChangeLine(change, opts = {}) {
  const b = planChangeBeat(change, opts.raceName);
  if (!b) return null;
  return opts.brief === false ? b.text : b.brief;
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

// DEFINE "EASY" HONESTLY (P4) — the aerobic-discipline voice. Reads ctx.easyZone (the reserve-anchored
// model): it protects the athlete's genuinely-easy volume (the 80/20 that makes the hard days land),
// names their PERSONAL easy ceiling in bpm + %reserve (not a population zone), and — most usefully —
// reacts to a fresh HOT-DRIFT day (an easy-intent run whose HR sat over the ceiling), attributing it
// honestly to fatigue (elevated resting HR) or heat rather than nagging about effort. Confidence-gated:
// when the estimate is still thin it softens the number instead of pretending precision.
function fmtShortDate(ds) {
  try {
    const [, m, d] = String(ds).slice(0, 10).split('-').map(Number);
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
  } catch { return ds; }
}
function gEasyDefinition(ctx) {
  const z = ctx.easyZone;
  if (!z || !(z.easyCeilingBpm > 0) || !z.distribution || z.distribution.nRuns < 8) return null;
  const ceil = Math.round(z.easyCeilingBpm);
  const pctHrr = Math.round((z.easyCeilingPctHrr ?? z.lt1?.pctHrr ?? 0) * 100);
  const share = Math.round((z.distribution.easyShare || 0) * 100);
  const lowConf = (z.lt1?.confidence ?? 0) < 0.3;
  const ceilPhrase = lowConf
    ? `around ${ceil} bpm (still firming up as we log more of your runs)`
    : `~${ceil} bpm (${pctHrr}% of your heart-rate reserve)`;

  // 1) a fresh hot-drift day → lead with it, attribute honestly (fatigue vs heat), don't nag effort.
  const d = z.recentDrift;
  if (d) {
    const over = Math.max(1, Math.round(d.deltaBpm));
    const why = z.restElevated >= 3
      ? `your resting HR's up ${Math.round(z.restElevated)} bpm this week, so you're carrying fatigue — that's the likely cause, not the effort.`
      : `most likely heat or a tired day — let the pace be whatever keeps the effort truly easy rather than chasing a number.`;
    return {
      id: 'easy-drift', kind: 'aerobic', surfaces: ['play', 'daily', 'plan'],
      claim: { text: `Your easy run${d.date ? ` on ${fmtShortDate(d.date)}` : ''} ran hot — about ${over} bpm over your easy ceiling (${ceilPhrase}). One day is noise; ${why} The whole point of easy is staying genuinely aerobic so the hard days have something to give.`, data: { deltaBpm: over, ceil } },
      why: `easyZone.recentDrift ${d.date} +${over}bpm restElevated=${z.restElevated}`,
      tone: 'gentle', salienceBoost: 0.12,
    };
  }
  // 2) easy volume slipping into the grey zone → nudge.
  if (share < 75) {
    return {
      id: 'easy-protect-low', kind: 'aerobic', surfaces: ['daily', 'plan'],
      claim: { text: `Only ${share}% of your running is truly easy — the rest is drifting into the grey zone (too hard to recover from, too easy to build). Keep the easy days under ${ceilPhrase}; protecting that is what lets the quality sessions actually land.`, data: { share, ceil } },
      why: `easyZone easyShare=${share}% below the 80/20 floor`,
      tone: 'gentle', salienceBoost: 0.08,
    };
  }
  // 3) doing it well → affirm and NAME the ceiling (education; low salience so it never dominates).
  return {
    id: 'easy-protect-good', kind: 'aerobic', surfaces: ['daily', 'plan'],
    claim: { text: `${share}% of your running is genuinely easy — right where polarized training wants you. Your easy ceiling is ${ceilPhrase}; staying under it is exactly what keeps the aerobic base compounding while the hard days stay sharp.`, data: { share, ceil } },
    why: `easyZone easyShare=${share}% meets the 80/20 target`,
    tone: 'affirming',
  };
}

const GENERATORS = [gPurpose, gExecution, gSessionDone, gKnockOn, gWeekDrift, gPlanChange, gMechanism, gEnergyAvailability, gRedS, gCutDivergence, gDurability, gPotentialGap, gProgress, gReadiness, gLearned, gClinical, gFuelStatus, gPlanStatus, gEasyDefinition];

// ── Surface INTENT: what the athlete needs AT THIS MOMENT, as a per-surface weight bump over beat KINDS.
// Global GRAVITY still says how much is universally at stake; this tilts the ranking toward the beats that
// serve THIS surface's job, so the same beat leads differently by where it shows. The pre/post-workout tile
// (play) is about executing/reading the session in front of you; the calendar is about plan decisions.
// Surfaces with no entry fall through to pure gravity (Daily/Fuel/Plan stay broad, as tested). ──
// play holds 2 lines (why + how). purpose leads; execution ('how') is the DEFAULT second line but sits
// deliberately BELOW the situational beats (readiness, knock-on, a fresh plan change) so a real warning
// takes the second slot instead of the evergreen how-to — the how yields, it never crowds. execution's
// weight is tuned to land above the ambient beats (progress/durability/learned) and below the situational
// ones: total ≈ 0.50+0.15+0.15 = 0.80, under knockOn's ≈ 0.91 and above durability's ≈ 0.73.
const SURFACE_INTENT = {
  play:     { purpose: 0.30, execution: 0.15, session: 0.28, readiness: 0.24, knockOn: 0.16, planImpact: 0.16, aerobic: 0.16, mechanism: 0.12, durability: 0.08 },
  start:    { readiness: 0.20, session: 0.16, purpose: 0.14 },
  calendar: { planImpact: 0.30, knockOn: 0.10 },
};

// ─────────────────────────── RANK + RECONCILE + COMPOSE ───────────────────────────
function salience(beat, surface, ctx) {
  const base = GRAVITY[beat.kind] ?? 0.4;
  const surfaceFit = beat.surfaces.includes(surface) ? 0.15 : 0;
  const intent = SURFACE_INTENT[surface]?.[beat.kind] ?? 0;   // this surface's job pulls its beats up
  const boost = beat.salienceBoost || 0;
  // Novelty: down-weight if the coach said this recently (episodic memory; 0 when absent).
  const saidAgo = ctx.memory?.saidAgoDays?.[beat.id];
  const novelty = saidAgo != null && saidAgo < 2 ? -0.25 : 0;
  // Preference: down-weight kinds the user ignores (0 when no engagement model yet).
  const pref = (ctx.memory?.kindWeight?.[beat.kind] ?? 0);
  return clamp01(base + surfaceFit + intent + boost + novelty + pref);
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
// Beats-per-surface budget, tuned to each surface's PHYSICAL space and job. This is the
// SINGLE density knob — there is no other place that decides how much the coach says per
// surface. Small mobile hero cards get ONE tight, purposeful read; roomier web panels and
// the diary digest can carry the leader + one distinct supporting idea. (Emil 2026-07:
// the mobile Play hero was a full 2-sentence paragraph — too much for that card. It is a
// SINGLE-focus surface now: the one thing that matters about the session in front of you.)
const SURFACE_K = {
  // Mobile hero cards — one tight read (small screen, single focus)
  start: 1,   // cross-dimensional brief — "the one thing"
  play:  1,   // pre/post-workout hero — the session's why (or a real warning), one line
  // Roomier surfaces — leader + at most one distinct supporting idea
  fuel:  2,   // nutrition hero — kcal/protein status, plus a mechanism/cut when it matters
  daily: 2,   // daily diary digest — warm paragraph, can breathe
  edgeiq: 2,  // library / depth screen
  plan:  2,   // web plan panel — race trajectory + drift
  trend: 2,   // web multi-week trend story
  calendar: 2,
};

// density → beat-budget resolver. A caller may ask a surface to speak tighter or fuller than
// its default without redefining the surface: 'compact' clamps to 1, 'full' allows one extra.
// No override (or 'standard') keeps the surface's declared SURFACE_K budget — so every existing
// call and test behaves exactly as before.
function resolveBudget(surface, opts) {
  const base = SURFACE_K[surface] ?? 2;
  if (opts && opts.k != null) return Math.max(1, opts.k | 0);
  if (opts && opts.density === 'compact') return Math.min(base, 1);
  if (opts && opts.density === 'full') return base + 1;
  return base;
}

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
  || (b.id.startsWith('purpose') || b.id.startsWith('session-done') || b.id.startsWith('progress') ? 'train' : b.kind);

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
 * @param {object} ctx      assembled coach context
 * @param {string} surface  surface id (play/fuel/plan/daily/start/…)
 * @param {object} [opts]   { density: 'compact'|'standard'|'full', k?: number } — optional
 *   per-call density override. Omit for the surface's declared budget (backward compatible).
 */
export function narrateSurface(ctx, surface, opts) {
  if (!ctx) return null;
  const all = reconcile(GENERATORS.map(g => { try { return g(ctx); } catch { return null; } }));
  const relevant = all
    .filter(b => b.surfaces.includes(surface))
    .map(b => ({ b, s: salience(b, surface, ctx) }))
    .sort((x, y) => y.s - x.s);
  const k = resolveBudget(surface, opts);
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
