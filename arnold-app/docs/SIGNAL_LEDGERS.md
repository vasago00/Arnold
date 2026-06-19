# Signal Router + Body / Hydration Ledgers

> Status: BUILD started 2026-06-06. Implements INTELLIGENCE_HUB.md principle 1
> ("every data point is valuable, but interpretation is conditional") for BODY and
> HYDRATION signals — the generalization of the two-ledger idea beyond running
> fitness. Same machinery as the hub core (the Estimate primitive + routing).

## The principle (Emil, 2026-06-06)
A scale reading means nothing on its own. 184.5 is a body-composition fact, a
fluid signal, or noise depending on WHEN it was taken and RELATIVE TO WHAT. The
hub's job is to ROUTE each data point to the right ledger at the right precision —
to "distinguish how and what information to use."

## Worked example (real day)
- 188 (yesterday, fasted) → 184.5 (this AM, fasted): −3.5 lb OVERNIGHT = fluid +
  glycogen-water turnover (and good sleep) — NOT fat. Routes to HYDRATION/recovery.
- 184.5 (fasted AM) → 182.9 (post-run, 31°C): −1.9 lb = sweat/heat loss. Routes to
  HYDRATION (sweat rate), never the body trend.
- The only body-composition signal is the SMOOTHED fasted-morning trend (~184–185),
  which one day barely moves. The ~5 lb 24h band (182.9↔188) is itself learnable as
  the personal fluctuation band → noise vs a real trend break.

## Built (cut 1) — `src/core/hub/bodyModel.js` (tested: tests/hubBody.test.mjs = 5)
- `classifyWeighIn(reading)` — context router: explicit > post-activity (within 3h
  of a run) > fasted-am (hour < 10) > other.
- `recordWeighIn(model, reading, opts)` — routes:
  • fasted-am → BODY ledger (a recency-weighted `Estimate`, half-life ~3wk; one read
    barely moves it) + emits the OVERNIGHT delta as a fluid/glycogen signal.
  • post-activity → HYDRATION signal (net sweat vs today's fasted) — body trend untouched.
  • other → ignored for the trend (too noisy).
- `bodyWeight(model)` — the smoothed trend (the real "weight") + confidence.
- `fluctuationBand(model)` — mean/SD of consecutive fasted-morning deltas = the
  personal daily swing.
- Proven: 182.9 post-run does NOT drag the trend; the trend sits ~186 (denoised),
  not at the single 184.5; overnight −3.5 and post-run 1.6 are surfaced as hydration.

## NEXT (cuts 2+)
- HYDRATION ledger as an accumulator: personal sweat rate vs temperature (use the
  REAL measured Δweight, not hydration.js's HR estimate); flag abnormal swings.
- Generalize the SIGNAL ROUTER: one ingest that classifies ANY data point (weight,
  sleep, HRV, run) → the right ledger at the right precision (the hub's nervous
  system; ingestCheckpoint + recordWeighIn are the first two routes).
- Recovery ledger: sleep quality (today's "good sleep") + overnight-Δ context.
- App wiring: tag weigh-ins on capture; protect the existing weight-trend / cut /
  energy-balance math from dehydrated post-run reads (the contamination risk today).
