// RaceOutlookCard — the unified Training Profile · Season Goal surface (Emil 2026-07). Renders the ONE ladder
// (Current → Target → Stretch → Ceiling, with Goal marked) plus the A-race "planet" and the "moons" (the other
// races on the calendar), all from the single live read getRaceOutlook(). Replaces the legacy "3:57 → 3:30"
// training-profile block on EdgeIQ (mobile + web). Self-contained styling so it drops into any surface.
//
// Vocabulary is fixed and shared with the engine: Current / Target / Stretch / Ceiling / Goal. "Coincide" is the
// state where the goal is reachable this cycle, so Target IS the Goal (training profile === season goal).
//
// DENSITY PASS, 2026-07-25 (Emil: "it takes too much space when not unfolded, then when unfolded the
// information is bunched up with a ton of empty space… there is way too much narrative for web and mobile").
// Three structural changes, all of them about layout rather than about dropping facts:
//   1. The collapsed Strip is ONE wrapping line instead of three stacked rows.
//   2. The expanded panel is a two-column auto-fit grid, so on a wide web card the ladder/trace column and
//      the other-races column share the width instead of the content hugging the left half.
//   3. Every prose paragraph became a labelled fact chip. The numbers all survive; the sentences around
//      them do not, except where a sentence is telling the athlete to DO something.
import React, { useEffect, useMemo, useState } from 'react';
import { useStorageVersion } from '../hooks/useStorageVersion.js';
import { getRaceOutlook } from '../core/derive/raceOutlookLive.js';
import { fmtFinish } from '../core/time.js';
import { planTrace } from '../core/planTrace.js';

const C = {
  current: '#f59e0b', target: '#5eead4', stretch: '#7dd3fc', ceiling: '#a3e635', goal: '#f472b6',
  muted: '#5b6b86', text: '#cbd5e1', bright: '#e2e8f0', bad: '#f87171', line: '#1b2740', panel: '#0d1424',
};

// How the committed plan is going. The colour rides on the ring around the committed rung, but it
// NEVER carries the meaning alone — the word is printed beside it every time, because a ring that
// is only amber tells a colourblind athlete nothing and tells everyone else nothing precise.
const STATUS = {
  'on-plan': { c: '#34d399', word: 'On plan' },
  slipping: { c: '#fbbf24', word: 'Slipping' },
  'off-plan': { c: '#f87171', word: 'Off plan' },
  'too-early': { c: '#94a3b8', word: 'Just committed' },
};

// Finish times route through the ONE formatter (core/time.js fmtFinish) — this card and
// LivingPlan each had their own, and they disagreed about the leftover seconds: Emil saw
// 3:48 here and 3:49 on "Your plan" for the same goal. Sub-hour times keep their m:ss,
// which fmtFinish deliberately does not render.
const fmt = (s) => {
  if (!(s > 0)) return '—';
  if (s >= 3600) return fmtFinish(s);
  const m = Math.floor(s / 60), ss = Math.round(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};
const isMarathon = (o) => (o.distanceKm || 0) >= 41;
const VERDICT_LABEL = { 'on-target': 'On-target', stretch: 'Stretch', 'beyond-cycle': 'Beyond cycle', 'no-goal': '' };
const VERDICT_COLOR = { 'on-target': '#5eead4', stretch: '#7dd3fc', 'beyond-cycle': '#f87171', 'no-goal': '#5b6b86' };

// Parsed off the ISO string by regex on purpose. `new Date('2026-09-27')` is midnight UTC, which in a
// negative-offset zone prints as the 26th — the same class of bug core/time.js exists to keep out.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}` : '';
};

// A labelled fact. The unit the density pass runs on: everything that used to be a sentence with a
// number buried in it is now a caption and a value, so the eye can skip the ones it does not need.
function Fact({ k, v, tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.07em', color: C.muted, fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</div>
      <div style={{ fontSize: 11.5, color: tone || C.text, fontWeight: 600, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
    </div>
  );
}
const FactRow = ({ children }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 16px', marginTop: 7 }}>{children}</div>
);

// The ladder as a legible labeled GRID — one cell per option, big mono time + a clear label. This replaced the
// absolute-positioned axis: on a linear time scale Target and Stretch sit ~2 min apart and their nodes/labels
// collided, and the micro-labels went illegible when the container stretched full-width on web. A grid never
// collides and stays readable at any width. `includeGoal` adds the Goal option (the full EdgeIQ card); the
// Calendar subset leaves the goal to the coincide line below.
function LadderGrid({ ladder, includeGoal = false, trace = null }) {
  const cells = [
    ['current', 'Current', ladder.current, C.current],
    ['target', 'Target', ladder.target, C.target],
    ['stretch', 'Stretch', ladder.stretch, C.stretch],
    ['ceiling', 'Ceiling', ladder.ceiling, C.ceiling],
  ];
  // The four rungs above are a PROGRESSION, not a sorted list, so their order is fixed. Goal and
  // the athlete's own typed time are both chosen rather than derived, so they follow the rungs —
  // sorted between themselves, because printing "Your time 3:40" to the right of "Goal 3:30"
  // would draw 3:40 as the faster of the two.
  const chosen = [];
  // Label is 'Goal', never 'Goal = Target'. Six bins on one phone row give each label ~45px; that
  // string wants ~70px, so it rendered as "GOAL = TA…" — and it was buying nothing, because
  // CoincideLine sits directly beneath and states the same fact as a whole sentence.
  if (includeGoal && ladder.goal > 0) chosen.push(['goal', 'Goal', ladder.goal, C.goal]);
  // `custom` is Emil's sub-3:40 Valencia option. It is not on the published ladder — that is the
  // whole reason it exists — so without this the Training Profile would render five rungs, none of
  // them the one the calendar was actually built on, and the two surfaces would silently disagree.
  if (trace && trace.appliesHere && trace.tier === 'custom' && trace.goalSecs > 0) {
    chosen.push(['custom', trace.label || 'Your time', trace.goalSecs, C.bright]);
  }
  chosen.sort((a, b) => b[2] - a[2]);
  cells.push(...chosen);
  const shown = cells.filter(([, , v]) => v > 0);
  if (shown.length < 2) return null;
  const committedKey = trace && trace.appliesHere ? trace.tier : null;
  const st = STATUS[trace?.status] || STATUS['too-early'];
  // ONE ROW, ALWAYS — Emil, 2026-07-26: "These buttons are too big, they should fit in one row."
  // `auto-fit minmax(84px,1fr)` needs 5×84+gaps ≈ 440px, which a 390px phone cannot give, so it
  // wrapped to 3+2 and clipped Ceiling at the right edge. An explicit `repeat(N, minmax(0,1fr))`
  // can never wrap: the bins divide whatever width exists. Two consequences are handled here rather
  // than left to chance — the type has to SHRINK to fit a 5th/6th bin on a phone (clamp(), so the
  // same declaration is 13.7px at 390px and the original 15.5px on web), and the bins must not
  // balloon back to the ~200px dead-space boxes of two rounds ago on a 1400px card, which is what
  // maxWidth pins. No media query, one layout, both surfaces.
  const nCells = shown.length;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${nCells}, minmax(0, 1fr))`, gap: 'clamp(3px, .9vw, 5px)', margin: '2px 0', maxWidth: nCells * 132 }}>
      {shown.map(([key, k, v, col]) => {
        const isCommitted = key === committedKey;
        return (
          <div key={key} style={{
            minWidth: 0, position: 'relative',
            border: isCommitted ? `1.5px solid ${st.c}` : `1px solid ${col === C.goal ? 'rgba(244,114,182,.35)' : C.line}`,
            boxShadow: isCommitted ? `0 0 0 2px ${st.c}22` : 'none',
            borderRadius: 9,
            padding: 'clamp(4px, 1.2vw, 6px) clamp(3px, 1vw, 7px)', textAlign: 'center',
            background: isCommitted ? `${st.c}0f` : (col === C.goal ? 'rgba(244,114,182,.06)' : 'rgba(255,255,255,.02)'),
          }}>
            <div style={{ fontSize: 'clamp(7px, 2.1vw, 8.5px)', textTransform: 'uppercase', letterSpacing: '.04em', color: isCommitted ? st.c : (col === C.goal ? C.goal : C.muted), fontWeight: (isCommitted || col === C.goal) ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 'clamp(11.5px, 3.5vw, 15.5px)', color: col, marginTop: 1, whiteSpace: 'nowrap' }}>{fmt(v)}</div>
            {/* The word, always — the ring's colour is a repeat of it, never the only carrier. The
                leading bullet went with the width: the ring IS the bullet, and dropping it bought
                the label the ~7px it needed to survive six-across without an ellipsis. */}
            {isCommitted && (
              <div style={{ fontSize: 'clamp(6.5px, 1.9vw, 7.5px)', textTransform: 'uppercase', letterSpacing: '.05em', color: st.c, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Committed
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// One other race, as a chip rather than a full-width bar. Seven races used to mean seven full-width rows
// each holding ~40 characters in the middle of a 1400px card — the single largest source of the empty
// space Emil flagged. They now tile.
function Moon({ o }) {
  const orb = isMarathon(o) ? (o.verdict === 'on-target' ? C.target : C.bad) : '#a78bfa';
  return (
    // Emil, 2026-07-26: "the races and times should be tighter together." Six of these stacked in one
    // phone column were ~46px apart centre-to-centre for two short lines of text. The box is the same
    // box — the air inside it is gone: padding 7/9 → 4/8, the meta line rides 1px under the name
    // instead of 2 with a 1.15 line-height, and the grid gap drops 6 → 3 at the call site.
    <div style={{ background: 'rgba(255,255,255,.02)', border: `1px solid ${C.line}`, borderRadius: 9, padding: '4px 8px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, lineHeight: 1.2 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: orb, flex: 'none' }} />
        <span style={{ color: C.bright, fontWeight: 600, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{o.name}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 12.5, color: C.target, flex: 'none' }}>{fmt(o.targetSecs)}</span>
      </div>
      <div style={{ fontSize: 9.5, color: C.muted, marginTop: 1, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {shortDate(o.date)}
        {o.goalSecs ? <> · Goal {fmt(o.goalSecs)} · <span style={{ color: VERDICT_COLOR[o.verdict] || C.muted }}>{VERDICT_LABEL[o.verdict]}</span></> : ' · Checkpoint — prove it here'}
      </div>
    </div>
  );
}

// The coincide caption. Was a full sentence in a pink box; it is the same fact in a fragment, because
// the two states differ by one word and the athlete only ever needs to know which one he is in.
function CoincideLine({ ladder, potential }) {
  if (!(ladder.goal > 0)) return null;
  return (
    <div style={{ fontSize: 10.5, color: '#94a3b8', background: 'rgba(244,114,182,.06)', border: '1px solid rgba(244,114,182,.2)', borderRadius: 8, padding: '6px 9px', marginTop: 8, lineHeight: 1.45 }}>
      <b style={{ color: '#f9a8d4' }}>Goal {fmt(ladder.goal)}</b>
      {ladder.coincide
        ? <> — reachable this cycle. Target locks onto it.</>
        : <> — beyond Target this cycle. The plan builds to <b style={{ color: C.target }}>{fmt(ladder.target)}</b>; the goal migrates forward{potential && potential.lever ? ` (lever: ${potential.lever})` : ''}.</>}
    </div>
  );
}

// ── THE TRACE BAND ────────────────────────────────────────────────────────────────────────
// Emil, 2026-07: "I need all data to sync and talk to each other. The Training Profile needs to
// sync with the plan when selected and trace it."
//
// Until now this card rendered the live ladder — what he COULD run — and had no idea which rung
// the calendar had actually been built on. Two surfaces, two answers. This band is the join, and
// every number in it comes from core/planTrace.js, which reads the frozen commitment. It computes
// nothing itself on purpose: a second opinion here is exactly the parallel system this was
// supposed to remove.
//
// The three states are deliberately different sentences, because "nothing committed", "committed
// to a different race" and "committed here, and here is how it is going" are three different
// facts and collapsing any two of them would let the card imply something untrue.
//
// Density pass: the committed state was four paragraphs. It is now a header line plus a row of
// fact chips. The only surviving sentence is the one that asks for an ACTION (rebuild / re-apply),
// because a number cannot tell you to do something.
function TraceBand({ trace, ladder }) {
  const box = (border, bg, children) => (
    <div style={{ fontSize: 10.5, color: '#94a3b8', background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 9px', marginTop: 8, lineHeight: 1.45 }}>
      {children}
    </div>
  );

  // Nothing committed. An INVITE, never an accusation — and it names the surface that owns the
  // action, because "commit a plan" with no address is the reason he had to ask where things live.
  if (!trace) {
    return box(C.line, 'rgba(255,255,255,.02)', (
      <>No plan committed. Pick a rung under <b style={{ color: C.bright }}>Your plan</b> and apply it — this card then traces it week by week.</>
    ));
  }

  // Committed, but to a different race. Shown rather than hidden: a Berlin commitment is the
  // reason nothing here is being measured, and silence would read as "you have committed nothing".
  if (!trace.appliesHere) {
    return box(C.line, 'rgba(255,255,255,.02)', (
      <>Committed to <b style={{ color: C.bright }}>{trace.aRaceName || 'another race'}</b>
        {trace.goalSecs > 0 ? <> at <b style={{ color: C.bright }}>{fmt(trace.goalSecs)}</b></> : null}
        {' '}— nothing on this ladder is measured against it.</>
    ));
  }

  const st = STATUS[trace.status] || STATUS['too-early'];
  const live = ladder ? Number(ladder[trace.tier]) || 0 : 0;
  // The rung moved. It is SUPPOSED to move — the ladder is a live read of current fitness — but a
  // card that quietly repainted the committed cell at the new time would erase the only thing a
  // commitment is for, which is being the number that does not move while you chase it.
  const drifted = live > 0 && trace.goalSecs > 0 && Math.abs(live - trace.goalSecs) >= 30;
  const shortfall = trace.wantsPeakMi != null && trace.deliversPeakMi != null && trace.shortfallMi > 2;
  // The one prose line that earns its place: it is the only content here that asks for a decision.
  const action = trace.status === 'off-plan'
    ? 'Worth rebuilding at a tier you are actually running.'
    : drifted ? `Live ${trace.tier} now reads ${fmt(live)} — regenerate to build on the newer number.` : null;

  return (
    <div style={{ background: `${st.c}0d`, border: `1px solid ${st.c}44`, borderRadius: 8, padding: '7px 9px', marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: st.c }}>● Committed</span>
        <span style={{ fontSize: 11.5, color: C.bright, fontWeight: 600 }}>{trace.label}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, fontWeight: 800, color: C.bright }}>{fmt(trace.goalSecs)}</span>
        <span style={{ fontSize: 10, color: st.c, fontWeight: 600 }}>· {st.word}</span>
        <span style={{ fontSize: 10, color: C.muted }}>
          {trace.notStarted
            ? `· starts ${trace.startsOn}`
            : (trace.weeksTotal && trace.weeksElapsed != null)
              ? `· wk ${Math.min(trace.weeksElapsed + 1, trace.weeksTotal)}/${trace.weeksTotal} · ${trace.weeksLeft} to go`
              : (trace.aRaceName || '')}
        </span>
      </div>

      <FactRow>
        {/* WANTS vs DELIVERS, frozen at commit time — the pair the card exists to make impossible to
            miss: the finish time he picked and the peak the ramp actually reached are different
            numbers. Both stay on screen; the paragraph that used to explain them does not. */}
        {trace.wantsPeakMi != null && trace.deliversPeakMi != null && (
          <Fact k="asks / plan peaks" tone={shortfall ? st.c : C.text}
            v={`${trace.wantsPeakMi} → ${trace.deliversPeakMi} mi/wk`} />
        )}
        {shortfall && trace.raceCostMi > 2 && trace.costlyRaces?.length && (
          <Fact k={`cost of racing ${trace.costlyRaces.join(' + ')}`} v={`−${trace.raceCostMi} mi/wk (solo ${trace.soloPeakMi})`} />
        )}
        {/* The accountability line — planned vs actual, over completed weeks only. */}
        {trace.countedWeeks > 0 && trace.status !== 'too-early' && (
          <Fact k={`run / planned · last ${trace.countedWeeks} wk`} tone={st.c}
            v={`${trace.actualMi} vs ${trace.plannedMi} mi/wk${trace.ratio != null ? ` (${Math.round(trace.ratio * 100)}%)` : ''}${trace.weeksShort > 0 ? ` · ${trace.weeksShort} short` : ''}`} />
        )}
      </FactRow>

      {action && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{action}</div>
      )}
    </div>
  );
}

// The COLLAPSED strip — what EdgeIQ shows at rest. ONE wrapping line: the label, the A-race, the committed
// rung and how it is going, and the headline times. It was three stacked rows (~72px tall on web) and that
// is what Emil meant by "it takes too much space when not unfolded". Everything that was on those rows is
// still here; it is laid along the line instead of down the card, so on web it is one row and on a phone it
// wraps to two. Tapping still opens the rest — glanceable first, deep second.
function Strip({ ladder, aEntry, promotion, open, onToggle, trace }) {
  const cst = trace && trace.appliesHere ? (STATUS[trace.status] || STATUS['too-early']) : null;
  const wk = cst && !trace.notStarted && trace.weeksTotal && trace.weeksElapsed != null
    ? ` · wk ${Math.min(trace.weeksElapsed + 1, trace.weeksTotal)}/${trace.weeksTotal}` : '';
  const dot = <span style={{ color: C.muted, opacity: .5, fontSize: 10 }}>·</span>;
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      style={{
        all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', width: '100%',
        alignItems: 'center', flexWrap: 'wrap', gap: '3px 8px',
        background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '8px 12px',
      }}
    >
      <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.12em', color: C.target, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Training Profile</span>
      {aEntry && (
        <>
          {dot}
          <span style={{ fontSize: 11, color: C.bright, fontWeight: 700, whiteSpace: 'nowrap' }}>{aEntry.name}</span>
          <span style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>{aEntry.weeksOut} wks{promotion ? ` · ${promotion.verdict}` : ''}</span>
        </>
      )}
      {/* Glanceable at rest: which option the calendar is actually built on, and how it is going.
          Without this the collapsed strip showed a Target the plan might not be building toward. */}
      {cst && (
        <>
          {dot}
          <span style={{ fontSize: 10, color: cst.c, fontWeight: 600, whiteSpace: 'nowrap' }}>
            ● {trace.label} {fmt(trace.goalSecs)} · {cst.word}{wk}
          </span>
        </>
      )}
      {/* Collapsed: the headline pair, pushed right. Expanded: the ladder below owns the numbers, so
          they show ONCE. */}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 5, flexShrink: 0 }}>
        {!open && ladder.target > 0 && (
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15, fontWeight: 800, color: C.target, lineHeight: 1 }}>{fmt(ladder.target)}</span>
        )}
        {!open && ladder.goal > 0 && !ladder.coincide && (
          <>
            <span style={{ fontSize: 10, color: C.muted }}>→</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: C.goal }}>{fmt(ladder.goal)}</span>
          </>
        )}
        <span style={{ fontSize: 13, color: C.muted, marginLeft: 2, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>›</span>
      </span>
    </button>
  );
}

// `compact` (Calendar "Your plan") renders ONLY the shared ladder + the coincide line — the same numbers as
// the full EdgeIQ card, no A-race planet / moons. `storageVersion` is accepted as an override but the card
// self-sources it (drop-in on any surface, like TrainingProfileCard). `collapsible` (EdgeIQ) starts closed and
// opens on tap; pass `collapsible={false}` for a surface that wants the whole thing always visible.
export function RaceOutlookCard({ storageVersion, compact = false, collapsible = true, defaultOpen = false }) {
  const liveVersion = useStorageVersion();
  const v = storageVersion != null ? storageVersion : liveVersion;
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try { setData(getRaceOutlook()); } catch { setData(null); }
  }, [v]);

  // The join, and the reason this card can finally say which option the calendar was built on.
  // Keyed on the A-race DATE, not its name — two races can share a name across years, and
  // `commitmentAppliesTo` compares dates, so anything else here would report every commitment as
  // belonging to some other race. Computed BEFORE the cold-start return: hooks cannot sit behind
  // a conditional, and a card with no ladder yet is exactly when `data` is null.
  const aRaceDateForTrace = (() => {
    if (!data || !data.aRace || !Array.isArray(data.outlook)) return null;
    return data.outlook.find((o) => o.name === data.aRace)?.date || null;
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trace = useMemo(() => {
    try { return planTrace({ aRaceDate: aRaceDateForTrace }); } catch { return null; }
  }, [v, aRaceDateForTrace]);

  if (!data || !data.ladder) {
    if (compact) return null;   // Calendar stays quiet on a cold start; EdgeIQ shows the invite below.
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '10px 12px', color: C.muted, fontSize: 11.5 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.12em', color: C.target, textTransform: 'uppercase' }}>Training Profile</span>
        <span> · Log a recent race or hard effort and your outlook comes into focus.</span>
      </div>
    );
  }

  const { ladder, outlook, aRace, potential, promotion } = data;
  const aEntry = outlook.find((o) => o.name === aRace) || null;
  const moons = outlook.filter((o) => o.name !== aRace);

  // Compact subset — the ladder + coincide line with no A-race panel or moons, for a surface that wants the
  // numbers without the depth. NOT used by the Calendar any more: the plan card already states what it's built
  // toward ("Sized to this cycle's Target"), so showing the whole ladder there just repeated EdgeIQ.
  if (compact) {
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 11 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.12em', color: C.target, textTransform: 'uppercase' }}>Outlook</span>
          {aRace && <span style={{ fontSize: 10, color: C.muted }}>{aRace}{aEntry && aEntry.weeksOut ? ` · ${aEntry.weeksOut} wks` : ''}</span>}
        </div>
        <LadderGrid ladder={ladder} trace={trace} />
        <CoincideLine ladder={ladder} potential={potential} />
        <TraceBand trace={trace} ladder={ladder} />
      </div>
    );
  }

  // A-race panel — the season anchor. Collapsed it's a one-line strip (glanceable); expanded it opens the
  // ladder grid (Current → Target → Stretch → Ceiling, Goal marked), the coincide caption, and the other
  // races. There's no separate "planet" box: the ladder IS the A-race, the strip header names it.
  //
  // The expanded body is an auto-fit TWO-COLUMN grid. On the ~1400px web card the ladder/trace column and
  // the other-races column each take half, which is the fix for "bunched up with a ton of empty space" —
  // the content was previously a single ~600px stack pinned to the left edge. Below ~700px the same rule
  // collapses to one column with no media query and no second layout to keep in sync, so mobile keeps the
  // stacked reading order it already had, just tighter.
  const isOpen = collapsible ? open : true;
  return (
    <div>
      {collapsible
        ? <Strip ladder={ladder} aEntry={aEntry} promotion={promotion} trace={trace} open={isOpen} onToggle={() => setOpen((o) => !o)} />
        : (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '8px 12px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 8px' }}>
            <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.12em', color: C.target, textTransform: 'uppercase' }}>Training Profile</span>
            {aEntry && <>
              <span style={{ color: C.muted, opacity: .5, fontSize: 10 }}>·</span>
              <span style={{ fontSize: 11, color: C.bright, fontWeight: 700 }}>{aEntry.name}</span>
              <span style={{ fontSize: 10, color: C.muted }}>{aEntry.weeksOut} wks{promotion ? ` · ${promotion.verdict}` : ''}</span>
            </>}
          </div>
        )}

      {isOpen && (
        <div style={{
          background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '11px 13px', marginTop: 6,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '10px 16px', alignItems: 'start',
        }}>
          <div style={{ minWidth: 0 }}>
            <LadderGrid ladder={ladder} includeGoal trace={trace} />
            <CoincideLine ladder={ladder} potential={potential} />
            <TraceBand trace={trace} ladder={ladder} />
          </div>

          {moons.length > 0 && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.1em', color: C.muted, textTransform: 'uppercase', margin: '0 2px 4px' }}>◐ Other races</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 3 }}>
                {moons.map((o) => <Moon key={o.name + o.date} o={o} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RaceOutlookCard;
