// Phase 0.5 (slice 16) — SessionVsUsual extracted verbatim from Arnold.jsx.
// Presentational "today vs your usual <type>" comparison block: reads the
// unified activity history and renders a 3-up metric grid (duration / HR / load)
// with a % delta vs the 6-month median of same-type sessions. The `divider` and
// `subHdr` style objects are supplied by the caller (LogDay), so this stays
// dependency-light. The only change from the in-monolith original is that the
// local `getUnifiedActivities()` delegate is inlined to its source,
// `allActivities()` from core/dcyMath.js.
import { allActivities } from "../core/dcyMath.js";
import {
  isRun as isRunAct,
  isStrength as isStrengthAct,
  isMobility as isMobilityAct,
  isHIIT as isHIITAct,
  isHybridWorkout as isHybridAct,
} from "../core/activityClass.js";

export function SessionVsUsual({ fd, todayStr, divider, subHdr }) {
  if (!fd) return null;
  // Duration may live on durationSecs OR durationMins (grouped/mobile objects
  // sometimes carry only the minutes field). Derive seconds from either.
  const fdDurSecs = Number(fd.durationSecs) > 0 ? Number(fd.durationSecs)
                  : Number(fd.durationMins) > 0 ? Number(fd.durationMins) * 60
                  : 0;
  if (!(fdDurSecs > 0)) return null;
  const acts = allActivities();

  const fdHybrid = isHybridAct(fd);
  const fdHIIT = isHIITAct(fd);
  const fdStrength = isStrengthAct(fd);
  const fdRun = isRunAct(fd);
  const fdMob = isMobilityAct(fd);

  // Same-type buckets — kept DISTINCT so a hybrid event (HYROX/CrossFit) only
  // compares against OTHER hybrids, not against interval runs (which isHIITAct
  // sweeps in and which are far shorter/lower-load → bogus +150% deltas).
  // Order matters: hybrid is the most specific, checked first.
  let sameType = null, typeKind = 'session';
  if (fdHybrid) {
    sameType = (a) => isHybridAct(a);                 // HYROX ↔ HYROX only
    typeKind = 'hybrid';
  } else if (fdHIIT) {
    sameType = (a) => isHIITAct(a) && !isHybridAct(a); // interval runs, excl. hybrids
    typeKind = 'HIIT';
  } else if (fdStrength) {
    sameType = (a) => isStrengthAct(a) && !isHybridAct(a);
    typeKind = 'strength';
  } else if (fdRun) {
    sameType = (a) => isRunAct(a) && !isHIITAct(a) && !isHybridAct(a);
    typeKind = 'run';
  } else if (fdMob) {
    sameType = (a) => isMobilityAct(a);
    typeKind = 'mobility';
  } else {
    sameType = () => false; // unclassified → no comparison, still show today
  }

  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const hist = acts.filter((a) =>
    a.date !== todayStr && sameType(a) && a.date &&
    new Date(a.date + 'T12:00:00').getTime() >= cutoff);
  const hasBaseline = hist.length >= 2;

  const median = (arr) => {
    const xs = arr.filter(Number.isFinite).sort((x, y) => x - y);
    if (!xs.length) return null;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };

  const todayMin = fdDurSecs / 60;
  const todayHR = Number(fd.avgHR || fd.avgHeartRate) || null;
  const todayLoad = Number(fd.totalTrainingLoad || fd.trainingLoad) || null;
  const histMin = hasBaseline ? median(hist.map((a) => (Number(a.durationSecs) || 0) / 60)) : null;
  const histHR = hasBaseline ? median(hist.map((a) => Number(a.avgHR || a.avgHeartRate)).filter(Boolean)) : null;
  const histLoad = hasBaseline ? median(hist.map((a) => Number(a.totalTrainingLoad || a.trainingLoad)).filter(Boolean)) : null;

  const rows = [];
  if (todayMin > 0) rows.push({ label: 'Duration', value: String(Math.round(todayMin)), unit: 'min', today: todayMin, base: histMin });
  if (todayHR)      rows.push({ label: 'Avg HR', value: String(todayHR), unit: 'bpm', today: todayHR, base: histHR });
  if (todayLoad)    rows.push({ label: 'Load', value: String(Math.round(todayLoad)), unit: '', today: todayLoad, base: histLoad });
  if (!rows.length) return null;

  const typeLabel = typeKind;
  const header = hasBaseline ? `Today vs your usual ${typeLabel}` : `Today's ${typeLabel} session`;
  const subnote = hasBaseline
    ? `vs median of your last ${hist.length} similar sessions`
    : `Building a baseline — ${hist.length} prior ${typeLabel} logged. Comparison appears once you have 2+.`;

  return (
    <>
      <div style={divider} />
      <div style={subHdr}>{header}</div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, marginTop: -2 }}>{subnote}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rows.length}, 1fr)`, gap: 8 }}>
        {rows.map((r, i) => {
          const hasDelta = r.base != null && r.base > 0;
          const pct = hasDelta ? Math.round(((r.today - r.base) / r.base) * 100) : null;
          const deltaColor = pct == null || Math.abs(pct) < 5 ? 'var(--text-muted)' : pct > 0 ? '#fbbf24' : '#22d3ee';
          return (
            <div key={i} style={{ background: 'var(--bg-elevated, rgba(255,255,255,0.03))', border: '0.5px solid var(--border-subtle, rgba(255,255,255,0.06))', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{r.label}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.1, marginTop: 2 }}>
                {r.value}<span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}> {r.unit}</span>
              </div>
              <div style={{ fontSize: 9, color: deltaColor, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                {pct == null ? 'logged' : `${pct > 0 ? '+' : ''}${pct}% vs usual`}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
