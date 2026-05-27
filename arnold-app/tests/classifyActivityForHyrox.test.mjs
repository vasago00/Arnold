// Phase 4r.test.1 — frozen-fixture regression test for the HYROX activity
// classifier. Catches the bug class where the classifier silently fails on
// data shapes we didn't anticipate (e.g. manually-entered SkiErg sessions
// where the modality lives in `name` or `notes`, not `activityType`).
//
// Run with:   node arnold-app/tests/classifyActivityForHyrox.test.mjs
// Exit code:  0 on pass, 1 on any failure.
//
// To refresh the fixture from your real storage:
//   1. Open Arnold in browser/app
//   2. Run window.coachActivitiesDebug() in console
//   3. Copy the rows + replace the activities array in user-data-2026-05.json
//   4. Update the expectations block to match
//   5. Re-run this script
//
// Why this exists: in Phase 4r.coach.v2.hyrox the classifier shipped only
// checking activityType+type, so manual SkiErg/Rowing entries (Garmin
// doesn't have those categories so the user typed the modality into name)
// classified as 'other' and the HYROX station-coverage brief incorrectly
// scolded the user for not doing any erg work. Fix: check seven field-name
// variants. This fixture pins that behavior so future rewrites of the
// classifier can't regress on the shapes we've observed.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyActivityForHyrox } from '../src/core/coach/classifyActivity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, 'fixtures', 'user-data-2026-05.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

let failures = 0;
const report = (ok, label, detail = '') => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failures++;
  }
};

console.log(`\nHYROX classifier — fixture: ${fixture._meta?.captured || 'unknown'}`);
console.log(`Activities: ${fixture.activities.length}\n`);

// 1. Every fixture row classifies into the expected bucket.
const actualByDate = {};
for (const a of fixture.activities) {
  actualByDate[a.date] = classifyActivityForHyrox(a);
}

for (const [bucket, dates] of Object.entries(fixture.expectations)) {
  for (const d of dates) {
    const actual = actualByDate[d];
    report(
      actual === bucket,
      `${d} classifies as '${bucket}'`,
      actual !== bucket ? `got '${actual}' for activity ${JSON.stringify(fixture.activities.find(a => a.date === d))}` : ''
    );
  }
}

// 2. No required bucket is empty (the regression we shipped: 'erg' was
//    coming back empty because the classifier missed manual entries).
const REQUIRED = ['running', 'erg', 'strength', 'metcon'];
const counts = Object.values(actualByDate).reduce((c, b) => {
  c[b] = (c[b] || 0) + 1;
  return c;
}, {});
for (const b of REQUIRED) {
  report(
    (counts[b] || 0) >= 1,
    `at least one '${b}' classified`,
    !counts[b] ? 'classifier returned zero — manually-entered sessions likely not being detected' : ''
  );
}

// 3. Null / undefined inputs don't blow up.
report(classifyActivityForHyrox(null) === 'other', 'null input → other');
report(classifyActivityForHyrox(undefined) === 'other', 'undefined input → other');
report(classifyActivityForHyrox({}) === 'other', 'empty object → other');

console.log(`\n${failures === 0 ? 'OK' : 'FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
