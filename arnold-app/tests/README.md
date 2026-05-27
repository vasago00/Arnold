# Arnold tests

Lightweight regression tests that pin specific bug-classes we've already
hit. Each test is a self-contained `.mjs` script — no test framework,
no setup. Run with `node tests/<name>.test.mjs` from `arnold-app/`.
Exit code 0 = pass, 1 = fail.

## Running all tests

```bash
cd arnold-app
node tests/classifyActivityForHyrox.test.mjs
# add more as we capture more bug-classes
```

## Why this exists

Smoke tests cover "does the surface render". These tests cover
"does the data shape we assumed still match what the user has."
The HYROX classifier was the prompt: it shipped checking only
`activityType`, so manually-entered SkiErg/Rowing sessions classified
as 'other' and the coach incorrectly scolded the user for skipping
erg work. The fix was to broaden field-checking — but without a
fixture, the same bug could regress on the next refactor.

## Adding a test

1. Capture a frozen snapshot of the relevant data shape under
   `tests/fixtures/<name>.json`. Add an `expectations` block that
   records what behavior the data should produce. Add a
   `howToRefresh` note explaining how to regenerate from real
   storage.
2. Write a `.mjs` script that imports the unit under test (it needs
   to be reachable from Node — no `window`, no IndexedDB, no React).
   If the unit lives inside a heavier module, extract it to a leaf
   file under `src/core/<area>/<unit>.js` first.
3. Assert against the fixture. Exit non-zero on any failure.

## Refreshing the HYROX classifier fixture

When your storage shape changes (new Garmin sync, new manual entry
flow, new modality you're tracking), the fixture should reflect it:

1. Open Arnold in a browser tab
2. Run `window.coachActivitiesDebug()` in the console
3. Copy the rows + replace the `activities` array in
   `fixtures/user-data-2026-05.json`
4. Update the `expectations` block so each date maps to the bucket
   you want the classifier to produce
5. Re-run `node tests/classifyActivityForHyrox.test.mjs`. If it
   fails, either the classifier has regressed (fix it) or the
   expectations are wrong for the new shape (update them).
