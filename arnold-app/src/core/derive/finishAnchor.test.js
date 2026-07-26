// Regression: a DEMONSTRATED race must anchor the marathon projection — training from easy base miles may
// only nudge it FASTER, never replace it with a slow easy-run estimate. This guards the exact bug Emil hit
// (2026-07-18): a 49-min 10K + 1:47 half showed a nonsense 5:57 marathon because the training-only estimate
// (from ~9:30/mi base miles) overrode the races. A race is proof of fitness; easy miles don't disprove it.
import { describe, it, expect } from 'vitest';
import { predictFinishSecs } from './tileMetrics.js';

const MARA = 42.195;
// Races are recorded as ordinary 'running' activities (Garmin has no 'race' type) and detected by
// standard distance + high effort — so the test data must look like that, not a made-up 'race' type.
// Dates are relative to now so the anchor windows (24 wk) always hold no matter when the suite runs.
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const run = (date, mi, totalSec, type, avgHR, maxHR) => ({ date, distanceMi: mi, durationSecs: totalSec, activityType: type, avgHR, maxHR });

// Emil-like history: a 10K (49:00) + a half (1:47) run at race effort, plus recent EASY base miles ~9:30/mi.
const acts = [
  run(daysAgo(70), 6.21, 49 * 60, 'running', 178, 190),
  run(daysAgo(40), 13.11, 107 * 60, 'running', 176, 190),
  ...[20, 16, 12, 8, 4].map((n) => run(daysAgo(n), 7, Math.round(7 * 9.5 * 60), 'easy_run', 150, 190)),
];

describe('marathon projection anchors on demonstrated races (not easy-run training)', () => {
  it('projects a SANE marathon (~3:30–4:20), not the 5-6h easy-run estimate', () => {
    const p = predictFinishSecs(MARA, acts);
    expect(p).toBeTruthy();
    expect(p.seconds).toBeGreaterThan(12600);   // faster than 3:30 is implausible off these races
    expect(p.seconds).toBeLessThan(15600);       // 4:20 — and nowhere near the 5:57 bug
  });
  it('is race-anchored (fitness-state primary; anchor/hub fallback), never the easy-run training-blend', () => {
    const p = predictFinishSecs(MARA, acts);
    // The fitness-state model is now the PRIMARY path (FITNESS_MODEL_ARCHITECTURE.md §13): it anchors on the
    // race observations and easy miles can't set the level. anchor/hub remain as the low-confidence fallback.
    expect(['fitness-state', 'anchor', 'hub']).toContain(p.source);
    expect(p.source).not.toBe('training-blend');
  });
  it('carries a confidence band around the anchored number', () => {
    const p = predictFinishSecs(MARA, acts);
    expect(p.low).toBeLessThan(p.seconds);
    expect(p.seconds).toBeLessThan(p.high);
    expect(p.confidence).toBeGreaterThanOrEqual(0.55);   // a real race → solid, not a low-confidence guess
  });
});
