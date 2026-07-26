// RecipePath (Sprint 3; Task #53) — the training profile on mobile EdgeIQ.
// Collapsed = a compact strip (label + verdict + finish). Expanded = the node
// graphic Emil signed off on: a "projected from your recent quality runs — N over
// goal" caption, the three build pillars as ring-nodes (label + now→target ·
// status), energy edges fanning into a glowing FINISH ring, a SUPPORTING line
// (recovery / consistency / weight — real signals), and the coach's "why".
//
// Data: core/trainingProfile.js (pure, tested) + core/seasonCoach.js (coach read)
// + recovery/consistency/weight signals for the supporting line. Re-derives when
// storage changes (useStorageVersion).

import { useEffect, useState } from "react";
import { useStorageVersion } from "../hooks/useStorageVersion.js";
import { resolveTrainingProfile } from "../core/trainingProfile.js";
import { getSeasonCoach } from "../core/seasonCoach.js";
import { recoveryCoef } from "../core/dcy.js";
import { allActivities } from "../core/dcyMath.js";
import { storage } from "../core/storage.js";
import { CoachSigil } from "./CoachSigil.jsx";

const T1 = '#e8e6e0';
const T2 = '#a8a59f';
const T3 = '#7d7a72';
const T4 = '#6b7280';
const GOOD = '#34d399';
const WARN = '#fbbf24';
const BAD  = '#f87171';
const TEAL = '#5eead4';
const CARD_BG = 'rgba(255,255,255,0.03)';
const BORDER  = 'rgba(255,255,255,0.08)';

const VERDICT = {
  increase: { label: 'Increase', color: '#60a5fa' },
  hold:     { label: 'Hold',     color: '#fbbf24' },
  cut:      { label: 'Cut back', color: '#f87171' },
  taper:    { label: 'Taper',    color: '#a78bfa' },
  recover:  { label: 'Recover',  color: '#34d399' },
};
const PHASE_LABEL = { build: 'Build', 'mini-taper': 'Taper', 'race-week': 'Race', recovery: 'Recovery' };
const FEAS = {
  'on-track':  { label: 'On track',   color: '#34d399' },
  aggressive:  { label: 'Aggressive', color: '#fbbf24' },
  unrealistic: { label: 'Off target', color: '#f87171' },
};
const INGREDIENT_TINT = { volume: '#60a5fa', longest: '#5eead4', threshold: '#a78bfa' };

// NOTE: these are PEAK targets you ramp toward over the plan, so a below-peak
// value is "building", not "behind" — only the biggest gap is the weak link.
const statusWordFor = (s, isWeak) =>
  s === 'met' ? 'on recipe' :
  s === 'close' ? 'closing' :
  s === 'gap' ? (isWeak ? 'the weak link' : 'building') :
  s === 'building' ? 'building' :
  isWeak ? 'the weak link' : '';

const fmtVal = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toString());

function useCoach(storageVersion) {
  const [coach, setCoach] = useState(null);
  useEffect(() => {
    try {
      const sc = getSeasonCoach();
      setCoach(sc && sc.plan && (sc.plan.nextMarathon || sc.plan.nextRace) ? sc : null);
    } catch { setCoach(null); }
  }, [storageVersion]);
  return coach;
}

// Supporting signals for the SUPPORTING line — real data, best-effort. Any signal
// that can't be computed is simply omitted (never fabricated).
function getSupporting() {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  // Recovery — the DCY recovery pillar (0..1) → %.
  try {
    const r = recoveryCoef(today);
    if (r != null && Number.isFinite(r)) out.push({ label: 'Recovery', value: `${Math.round(Math.min(1, r) * 100)}%`, tone: r >= 0.8 ? 'good' : r >= 0.6 ? 'warn' : 'bad' });
  } catch { /* ignore */ }
  // Consistency — last 6 weeks with ≥3 training days.
  try {
    const acts = allActivities() || [];
    const now = new Date();
    let hit = 0;
    for (let w = 0; w < 6; w++) {
      const end = new Date(now); end.setDate(now.getDate() - w * 7); end.setHours(23, 59, 59, 999);
      const start = new Date(end); start.setDate(end.getDate() - 6); start.setHours(0, 0, 0, 0);
      const days = new Set(acts.filter(a => { const d = a.date ? new Date(a.date + 'T12:00:00') : null; return d && d >= start && d <= end; }).map(a => a.date));
      if (days.size >= 3) hit++;
    }
    out.push({ label: 'Consistency', value: `${hit}/6 wk`, tone: hit >= 5 ? 'good' : hit >= 3 ? 'warn' : 'bad' });
  } catch { /* ignore */ }
  // Weight vs goal — v2 body-weight target vs latest reading.
  try {
    const g = storage.get('goals') || {};
    const target = Number(g?.body?.weight?.targetLbs) || null;
    const wArr = (storage.get('weight') || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const w0 = wArr[0] || {};
    const latest = Number(w0.weight ?? w0.lbs ?? w0.value ?? w0.bodyWeight) || null;
    if (latest && target) {
      const diff = Math.round(latest - target);
      out.push({ label: 'Weight', value: Math.abs(diff) <= 2 ? 'on track' : `${diff > 0 ? '+' : ''}${diff} lb`, tone: Math.abs(diff) <= 2 ? 'good' : 'warn' });
    }
  } catch { /* ignore */ }
  return out;
}

// ── compact strip: label + verdict · finish now→goal · headline ─────────────
function Strip({ profile, coach, open, onToggle }) {
  const { finish, weakLink } = profile;
  const nowColor = finish.atOrAheadOfGoal ? GOOD : (finish.goalStr && finish.now ? WARN : finish.now ? TEAL : T3);
  const v = coach && VERDICT[coach.plan.verdict];
  return (
    <button
      onClick={onToggle}
      style={{
        all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'block', width: '100%',
        background: CARD_BG, border: `1px solid ${weakLink ? 'rgba(248,113,113,0.22)' : BORDER}`,
        borderRadius: 14, padding: '11px 13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', color: TEAL }}>TRAINING PROFILE</span>
          {v && (
            <span style={{ fontSize: 9, fontWeight: 600, color: v.color, background: `${v.color}1a`, border: `0.5px solid ${v.color}55`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>
              {coach.plan.phase ? `${PHASE_LABEL[coach.plan.phase] || coach.plan.phase} · ` : ''}{v.label}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
          {/* Hide the finish number + headline when expanded — the FINISH ring below
              owns them, so 4:12 shows in one place, not three. */}
          {!open && finish.now && <span style={{ fontSize: 17, fontWeight: 800, color: nowColor, lineHeight: 1 }}>{finish.now.str}</span>}
          {/* Confidence dot — colour tracks how proven the projection is; it CHANGES as evidence builds/ages. */}
          {!open && finish.now && finish.now.confidenceScore != null && (() => {
            const s = finish.now.confidenceScore;
            const c = s >= 0.66 ? GOOD : (s >= 0.4 ? WARN : T3);
            return <span title={`${Math.round(s * 100)}% confidence`} style={{ width: 6, height: 6, borderRadius: '50%', background: c, display: 'inline-block', alignSelf: 'center', marginLeft: 1 }} />;
          })()}
          {!open && finish.goalStr && !finish.atOrAheadOfGoal && (
            <>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>→</span>
              <span style={{ fontSize: 12, color: GOOD }}>{finish.goalStr}</span>
            </>
          )}
          <span style={{ fontSize: 12, color: T3, marginLeft: 2, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
        </div>
      </div>
      {!open && <div style={{ fontSize: 11, color: T2, lineHeight: 1.4, marginTop: 6, textAlign: 'left' }}>{profile.headline}</div>}
    </button>
  );
}

// Confidence (0..1) → a word + colour. Changes as recent, consistent, proven evidence accumulates/ages,
// so the band is a LIVE signal, not decoration (Emil: "makes sense as long as it changes").
function confInfo(score) {
  if (score == null) return null;
  if (score >= 0.66) return { word: 'High', color: GOOD };
  if (score >= 0.4) return { word: 'Moderate', color: WARN };
  return { word: 'Low', color: T3 };
}
// '2026-07-13' → 'Jul 13'
function fmtAsOf(d) {
  try { const [y, m, day] = String(d).split('-').map(Number); const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${MO[(m || 1) - 1]} ${day}`; } catch { return null; }
}

// ── caption: "Projected from your recent quality runs — 43 min over goal" ────
function GapCaption({ finish }) {
  const now = finish.now;
  if (!now) return null;
  const src = now.responsive ? 'your training — updates as you train'
    : (now.confidence === 'measured' ? 'your recent quality runs' : 'your current fitness');
  const ci = confInfo(now.confidenceScore);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10.5, color: T3 }}>Projected from {src}</div>
      {now.lowStr && now.highStr && (
        <div style={{ fontSize: 11, color: T2, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>Likely <b style={{ color: T1 }}>{now.lowStr}–{now.highStr}</b></span>
          {ci && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: ci.color, display: 'inline-block' }} />
              <span style={{ color: T3 }}>{ci.word} confidence{now.bandPct != null ? ` · ±${now.bandPct}%` : ''}</span>
            </span>
          )}
          {now.asOf && <span style={{ color: T3 }}>· as of {fmtAsOf(now.asOf)}</span>}
        </div>
      )}
      {finish.goalStr && !finish.atOrAheadOfGoal && finish.gapToGoalStr && (
        <div style={{ fontSize: 13.5, fontWeight: 700, color: WARN, marginTop: 2 }}>
          {finish.gapToGoalStr.replace(/^~/, '')} <span style={{ color: T2, fontWeight: 500 }}>to your {finish.goalStr} goal</span>
        </div>
      )}
      {finish.goalStr && finish.atOrAheadOfGoal && (
        <div style={{ fontSize: 13.5, fontWeight: 700, color: GOOD, marginTop: 2 }}>At your {finish.goalStr} goal ✓</div>
      )}
      {!finish.goalStr && (
        <div style={{ fontSize: 11, color: T3, marginTop: 2 }}>Set a goal to see the gap</div>
      )}
      {/* Aerobic ceiling — a SEPARATE upside marker, never the prediction. Your engine (measured VO2max) vs
          your race legs: the gap is what threshold/economy work can convert. Distinct colour so it never reads
          as the finish itself. */}
      {now.potential && now.potential.ceilingStr && (
        <div style={{ fontSize: 11, color: T2, marginTop: 5, paddingTop: 5, borderTop: `1px solid ${T3}22`, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: TEAL, display: 'inline-block' }} />
          <span style={{ color: T3 }}>Aerobic ceiling</span>
          <b style={{ color: TEAL }}>~{now.potential.ceilingStr}</b>
          <span style={{ color: T3 }}>
            — engine ~{now.potential.gapVdot > 0 ? `+${now.potential.gapVdot}` : now.potential.gapVdot} VDOT ahead
            {now.potential.lever === 'economy+threshold' ? ' · convert with threshold + economy work'
              : now.potential.lever === 'threshold' ? ' · convert with threshold work' : ''}
            {now.potential.reachStr ? ` (realistic next step ~${now.potential.reachStr})` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

// ── node graphic: ring pillars → energy edges → glowing FINISH ring ─────────
function NodeRingGraphic({ ingredients, weakLink, finish }) {
  const ings = ingredients.slice(0, 3);
  const rows = ings.length;
  const W = 360, rowH = 42, startY = 4;
  const H = Math.max(150, startY * 2 + rows * rowH);
  const labelX = 12, nodeRX = 182;   // label on the left, node-port on the right
  const ringR = 34, ringCX = W - ringR - 12, ringCY = H / 2 + 6;   // +6 so no stream runs dead-flat
  const rowY = (i) => startY + rowH / 2 + i * rowH;
  const cColor = (g) => (weakLink && g.key === weakLink.key) ? BAD : (INGREDIENT_TINT[g.key] || TEAL);
  const nowColor = finish.atOrAheadOfGoal ? GOOD : (finish.goalStr ? WARN : TEAL);
  // Land the streams on the ring's left arc with a WIDE vertical spread (222°→138°)
  // so none is dead-flat, and end 3px inside the stroke so each plugs into the ring.
  const landing = (i) => {
    const t = rows <= 1 ? 0.5 : i / (rows - 1);
    const rad = (222 - t * 84) * Math.PI / 180;
    const r = ringR - 3;
    return { x: ringCX + r * Math.cos(rad), y: ringCY + r * Math.sin(rad) };
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="rpGlo" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="2.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      {/* edges pillar → finish — START to the RIGHT of the labels (streamX) so the
          curves never cross the text; all three fan into the ring's left arc. */}
      {ings.map((g, i) => {
        const isWeak = weakLink && g.key === weakLink.key;
        const y = rowY(i);
        const l = landing(i);
        const sx = nodeRX + 8;
        const mx = (sx + l.x) / 2;
        return (
          <path key={`e${g.key}`}
            d={`M${sx},${y} C${mx},${y} ${mx},${l.y} ${l.x},${l.y}`}
            fill="none" stroke={cColor(g)} strokeWidth={isWeak ? 2.6 : 2}
            strokeDasharray={isWeak ? '6 4' : undefined} opacity={isWeak ? 1 : 0.9} filter="url(#rpGlo)" />
        );
      })}

      {/* ring pillars + labels */}
      {ings.map((g, i) => {
        const isWeak = weakLink && g.key === weakLink.key;
        const c = cColor(g);
        const y = rowY(i);
        const value = g.target != null ? `${fmtVal(g.now)} → ${fmtVal(g.target)} ${g.unit}` : `${fmtVal(g.now)} ${g.unit}`;
        const word = statusWordFor(g.status, isWeak);
        const detail = word ? `${value} · ${word}` : value;
        return (
          <g key={`n${g.key}`}>
            <text x={labelX} y={y - 3} fill={c} fontSize="12" fontWeight="600">{g.label}</text>
            <text x={labelX} y={y + 10} fill="rgba(255,255,255,0.6)" fontSize="9">{detail}</text>
            <circle cx={nodeRX} cy={y} r={isWeak ? 8 : 7} fill="#0d1014" stroke={c} strokeWidth={isWeak ? 2.5 : 2} filter="url(#rpGlo)" />
          </g>
        );
      })}

      {/* glowing FINISH ring */}
      {finish.now && (
        <>
          <circle cx={ringCX} cy={ringCY} r={ringR + 5} fill={WARN} opacity="0.12" filter="url(#rpGlo)" />
          <circle cx={ringCX} cy={ringCY} r={ringR} fill="#0d1014" stroke="#1c2230" strokeWidth="1" />
          <circle cx={ringCX} cy={ringCY} r={ringR} fill="none" stroke={WARN} strokeWidth="2" strokeDasharray="5 4" filter="url(#rpGlo)" />
          <text x={ringCX} y={ringCY - 11} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="7.5" letterSpacing="0.12em">FINISH</text>
          <text x={ringCX} y={ringCY + 6} textAnchor="middle" fill={nowColor} fontSize="19" fontWeight="800" filter="url(#rpGlo)">{finish.now.str}</text>
          {finish.goalStr && !finish.atOrAheadOfGoal && (
            <text x={ringCX} y={ringCY + 20} textAnchor="middle" fill={GOOD} fontSize="9" fontWeight="600">goal {finish.goalStr}</text>
          )}
          {finish.goalStr && finish.atOrAheadOfGoal && (
            <text x={ringCX} y={ringCY + 20} textAnchor="middle" fill={GOOD} fontSize="9" fontWeight="600">at {finish.goalStr} ✓</text>
          )}
        </>
      )}
    </svg>
  );
}

// ── SUPPORTING line: recovery / consistency / weight ────────────────────────
function SupportingLine() {
  const items = getSupporting();
  if (!items.length) return null;
  const dot = (t) => t === 'good' ? GOOD : t === 'warn' ? WARN : t === 'bad' ? BAD : T4;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 9, paddingTop: 9, borderTop: `1px solid ${BORDER}` }}>
      <span style={{ fontSize: 8.5, color: T4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Supporting</span>
      {items.map((it, i) => (
        <span key={i} style={{ fontSize: 10.5, color: T2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: dot(it.tone) }} />{it.label} {it.value}
        </span>
      ))}
    </div>
  );
}

// ── coach "why" line with a glowing sigil dot ───────────────────────────────
function WhyRow({ coach, profile }) {
  const why = (coach && coach.plan && coach.plan.why) || profile.headline;
  const f = coach && coach.feasibility && FEAS[coach.feasibility.verdict];
  const note = f && coach.feasibility.note ? coach.feasibility.note : null;
  const text = [why, note].filter(Boolean).join(' ');   // one uniform shade, not two
  if (!text) return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${BORDER}` }}>
      <CoachSigil size={15} style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ fontSize: 11.5, color: '#c8ccd2', lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

// ── self-contained card: resolves the profile + coach, strip + tap-to-expand ─
export function TrainingProfileCard() {
  const storageVersion = useStorageVersion();
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);
  const coach = useCoach(storageVersion);

  useEffect(() => {
    let alive = true;
    resolveTrainingProfile()
      .then(p => { if (alive) setProfile(p); })
      .catch(e => { console.warn('[RecipePath] resolve failed:', e); });
    return () => { alive = false; };
  }, [storageVersion]);

  if (!profile || !profile.hasData) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <Strip profile={profile} coach={coach} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (
        <div style={{
          background: 'radial-gradient(110% 70% at 80% 55%, rgba(251,191,36,0.08), rgba(13,16,23,0) 55%), #0c0f16',
          border: '1px solid #232a38', borderRadius: 14, padding: '10px 12px', marginTop: 6,
        }}>
          <GapCaption finish={profile.finish} />
          {profile.ingredients.length > 0 && (
            <NodeRingGraphic ingredients={profile.ingredients} weakLink={profile.weakLink} finish={profile.finish} />
          )}
          <SupportingLine />
          <WhyRow coach={coach} profile={profile} />
        </div>
      )}
    </div>
  );
}

export default TrainingProfileCard;
