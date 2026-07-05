#!/usr/bin/env node
// Heavy Monte-Carlo pressure test — runs the REAL engine (adaptSession +
// prescribeFuel + composeCalorieTarget) over a large, configurable number of
// synthetic athlete-days ON DEMAND. The CI suite (sim.test.js) stays fast at
// 10k cases as a determinism guard; this is the "run as much as feasible" deep
// sweep.
//
//   npm run sim                 # default: 20,000 athletes × 30 days = 600k cases
//   npm run sim 100000 30       # 100k athletes × 30 days = 3,000,000 cases
//   npm run sim 20000 30 12345  # fixed seed (reproducible); default seed is random
//
// A random default seed means each run explores fresh ground; any hard-invariant
// violation prints its seed + indices so it can be reproduced exactly. Exit code
// is non-zero on any violation, so it can gate a release if you want.

import { runSim } from '../src/core/sim/runSim.js';

const athletes = Number(process.argv[2]) || 20000;
const days     = Number(process.argv[3]) || 30;
const seed     = Number(process.argv[4]) || (Date.now() % 2147483647);

console.log(`Monte-Carlo pressure test — ${athletes.toLocaleString()} athletes × ${days} days = ${(athletes * days).toLocaleString()} cases (seed ${seed})…`);
const t0 = Date.now();
const r = runSim({ seed, nAthletes: athletes, daysPerAthlete: days, maxStoredViolations: 40 });
const secs = (Date.now() - t0) / 1000;

console.log(`\n${r.cases.toLocaleString()} cases in ${secs.toFixed(1)}s  (${Math.round(r.cases / secs).toLocaleString()} cases/s)`);
console.log(`ok: ${r.ok}  |  hard violations: ${r.hardViolationCount}  |  aggregate margin breaches: ${r.aggregateViolations.length}`);
console.log('\nOutput distributions (transparency — eyeball for plausibility):');
console.log(JSON.stringify(r.summary, null, 2));

if (r.hardViolationCount) {
  console.log('\n⛔ HARD VIOLATIONS (sample — reproduce with the seed above + athlete/day indices):');
  console.log(JSON.stringify([...r.hardViolations, ...r.monotonicViolations], null, 2));
}
if (r.aggregateViolations.length) {
  console.log('\n⚠ AGGREGATE MARGIN BREACHES:');
  console.log(JSON.stringify(r.aggregateViolations, null, 2));
}
console.log(r.ok ? '\n✓ all invariants held.' : '\n✗ invariants broken — see above.');
process.exit(r.ok ? 0 : 1);
