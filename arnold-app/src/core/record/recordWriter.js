// core/record/recordWriter.js — SoR orchestration (Phase 2, the brain). PURE + node-testable.
//
// Turns "the current store state + the last snapshot we wrote" into an exact WRITE PLAN — a list of file ops a
// platform sink executes. Nothing here touches disk, Drive, storage, or the clock (all injected), so the entire
// decision of WHAT the durable memory should contain is testable without a browser. The plan is deliberately
// redundant for durability + inspectability:
//   • log/<category>.jsonl   — append-only per-stream event logs (immutable history, human-greppable)
//   • log/_all.jsonl         — one chronological audit trail across every category
//   • snapshots/<day>.json   — the full projected state, once per day (point-in-time recovery)
//   • latest.json            — the newest full state (fast current read; what the app/model can load)
//   • manifest.json          — per-category counts + integrity hashes (drift/corruption detection)
//
// A first run (prevSnapshot = null) emits an upsert for every row — the initial memory. A no-op change writes
// nothing (no churn). The sink is dumb; all judgement lives here and is covered by tests.

import { projectSnapshot, diffToEvents, eventsToJsonl, buildManifest } from './systemOfRecord.js';

/**
 * buildWritePlan(readKey, prevSnapshot, { at, day }) → { changed, snapshot, events, plan }
 *   readKey(category) → stored value; `at` = injected ISO timestamp; `day` = YYYY-MM-DD (defaults from `at`).
 *   plan = [{ path, mode: 'append'|'write', content }]  — paths relative to the record root (e.g. data/).
 */
export function buildWritePlan(readKey, prevSnapshot, opts = {}) {
  const at = opts.at ?? null;
  const day = opts.day ?? (typeof at === 'string' && at.length >= 10 ? at.slice(0, 10) : null);
  const snapshot = projectSnapshot(readKey, { at });
  const events = diffToEvents(prevSnapshot, snapshot, at);

  // Nothing changed AND we already have a prior record → write nothing. (First run always writes, even if the
  // store is empty, so `latest.json`/`manifest.json` exist as the anchor for future diffs.)
  if (!events.length && prevSnapshot) {
    return { changed: false, snapshot, events: [], plan: [] };
  }

  const plan = [];
  // 1. Per-category append logs — immutable, grepable history of each stream.
  const byCat = {};
  for (const e of events) (byCat[e.cat] ||= []).push(e);
  for (const cat of Object.keys(byCat).sort()) {
    plan.push({ path: `log/${cat}.jsonl`, mode: 'append', content: eventsToJsonl(byCat[cat]) });
  }
  // 2. One chronological audit trail across everything.
  if (events.length) plan.push({ path: `log/_all.jsonl`, mode: 'append', content: eventsToJsonl(events) });
  // 3. Daily full snapshot — overwrite the day's file so it holds the latest-of-day (idempotent within a day).
  if (day) plan.push({ path: `snapshots/${day}.json`, mode: 'write', content: JSON.stringify(snapshot) });
  // 4. Newest full state + integrity manifest — always refreshed.
  plan.push({ path: `latest.json`, mode: 'write', content: JSON.stringify(snapshot) });
  plan.push({ path: `manifest.json`, mode: 'write', content: JSON.stringify(buildManifest(snapshot)) });

  return { changed: true, snapshot, events, plan };
}

// Convenience: total bytes a plan will write (for logging / rate decisions in the service layer).
export function planBytes(plan) {
  return (plan || []).reduce((n, op) => n + (op.content ? op.content.length : 0), 0);
}

export default buildWritePlan;
