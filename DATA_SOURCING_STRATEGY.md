# DATA_SOURCING_STRATEGY.md — provider dependency, contingency, build-vs-rent

**Status:** proposed (2026-06-19). Trigger: the Cronometer outage (an *unofficial GWT-RPC scrape*) broke nutrition entirely and exposed how exposed we are to a single 3rd-party source. Companion to `DATA_INTEGRITY_PLAN.md` (which handles *how missing data is represented*); this doc handles *where data comes from and what to do when a source fails*.

## 1. The question

Emil: when a source fails, should we (a) seamlessly switch food tracking to another provider (e.g. Garmin), or (b) build our own and cut all 3rd-party ties?

## 2. The honest framing (the real lesson)

The outage's fragility did **not** come from "using a 3rd party." It came from using an **unofficial, scraped** integration (reverse-engineered GWT-RPC that breaks whenever Cronometer rebuilds). The lesson is not "quit 3rd parties," it is:

> **Own the pipeline. Rent the data. Use sanctioned APIs, never scraping. Never depend on a single source for any metric. Always keep a manual fallback.**

What we should **own**: the source-adapter layer, the normalized data model, the in-app logging UX, the scoring, and the contingency logic.
What we should **rent** (not build): the food database, and device biometrics (they come off the watch — unbuildable).

## 3. Options, evaluated (grounded, 2026-06)

### Option A — switch food tracking to Garmin — ❌ not recommended
- Garmin *did* add nutrition logging to Garmin Connect (Jan 2026: DB search, barcode, AI photo) — but it is **gated behind paid Connect+**, and Garmin's developer program exposes **Health / Activity / Training APIs only — no nutrition API**.
- So pulling food data out means **scraping Garmin Connect** — the exact fragility class that just broke, now also paywalled. Sideways, not forward.

### Option B — build our own (cut all ties) — ❌ not fully possible, and wrong for the DB
- **Food database**: a multi-million-item, licensing-heavy moat (USDA + branded + restaurant). Don't build it; providers exist precisely because it's hard.
- **Device biometrics** (sleep, HRV, activities, weight): physically un-buildable — they come from the watch. You'll always depend on Garmin / Apple Health / Health Connect.

### Option C — own the pipeline, rent the data — ✅ recommended
1. **Source-adapter layer.** Every provider sits behind one interface writing into the normalized store. Sources become *swappable and additive*. `dataHealth()` (Integrity Phase 1) is already the switch that knows when a source is down.
2. **First-party food logger** (search + barcode) backed by a **sanctioned nutrition API** — this is the high-value contingency: removes Cronometer as a single point of failure, replaces the scrape with a stable API, and we still don't build the DB. Candidates (verify terms before choosing):
   - **Nutritionix** — ~1.9M foods, strong NLP ("2 eggs and toast"), 35k+ devs. Commercial.
   - **FatSecret Platform** — ~2.3M verified foods, 58 countries. Commercial.
   - **USDA FoodData Central** — free, official, US-centric, plainer UX.
   - **Open Food Facts** — free, crowd-sourced, barcode-strong, variable quality.
3. **Manual-entry fallback for every metric** — the ultimate insurance. If all syncs fail, the user logs it and the app accepts it (nutrition especially). Surfaced exactly when `dataHealth()` reports a gap.
4. **Prefer official device APIs over scraping** where feasible — Garmin's sanctioned Health/Activity API, Android **Health Connect**, Apple **HealthKit** — so biometric ingestion isn't a scrape either.

## 4. Target architecture (incremental, not a rewrite)

```
[ providers ]            [ adapters (common iface) ]      [ normalized store ]   [ dataHealth ]   [ scorers (typed) ]   [ UI ]
 Cronometer  ─┐
 Nutrition API├─ nutritionAdapter ─┐
 Manual entry ┘                    │
 Garmin (Health Connect/official) ─┼─►  storage buckets  ──►  availability  ──►  ok|no-data|partial  ──►  honest display
 Apple HealthKit ──────────────────┘
```
Most of the "normalized store" already exists implicitly (the storage buckets). The new work is formalizing the adapter interface + adding the nutrition logger/manual path.

## 5. Process & sequencing (important)

1. **Integrity Phase 2 FIRST** (typed results + `scoreAdherence`, migrate dcy/trainingStress/healthSystems). *Do not add sources until missing-data is handled honestly* — otherwise multi-source just adds more places for "missing → fabricated number" to hide.
2. Formalize the **source-adapter interface** (codify what the storage buckets imply).
3. Ship the **manual nutrition logger** (cheapest, always-available contingency).
4. Add **one sanctioned nutrition API** behind the adapter (after the cost/terms check below).
5. Migrate device ingestion toward **official** APIs (Health Connect / HealthKit / Garmin sanctioned).

## 6. Decision checklist to fill in before picking a nutrition API

| Provider | Monthly cost @ our volume | Rate limits | Coverage (regional/restaurant) | Barcode | NLP | Licensing/redistribution terms | Verdict |
|---|---|---|---|---|---|---|---|
| Nutritionix |  |  |  | yes | strong |  |  |
| FatSecret | free tier (Premier-Free) | not publicly published — check dashboard | ~2.3M foods, 58 countries; restaurant ok | yes (Premier) | some | sanctioned OAuth2 API | ✅ chosen — proxy built |
| USDA FDC | free |  | US-centric | partial | no |  |  |
| Open Food Facts | free |  | global, variable | strong | no |  |  |

## 6b. Build status (2026-06-21)
FatSecret wired as the PRIMARY provider behind the existing `searchFood()`/`lookupBarcode()` (Open Food Facts stays as automatic fallback). Pieces shipped: `core/fatsecret-client.js` (pure, unit-tested mappers + proxy calls), provider dispatch in `core/nutrition.js`, and a deploy-ready static-IP proxy at `cloud-worker/fatsecret-proxy/` (server.js + README). The food-logger UI + camera barcode scanning already existed (`NutritionInput.jsx`) and now use FatSecret data with no UI change. REMAINING (Emil): deploy the proxy to a static-IP host, whitelist its IP in FatSecret, set the OAuth2 secrets, then `setFatSecretEndpoint(...)`. Barcode needs FatSecret Premier scope; on free `basic` it falls back to Open Food Facts.

## 7. Bottom line
Don't move food to Garmin, and don't build a food database. Build the **adapter + manual logger now**, add a **sanctioned API** next, and prefer **official platform APIs** for device data — so no single source failing can ever again either break the app or fabricate a number.

Sources: DC Rainmaker — Garmin Connect+ nutrition (Jan 2026); Garmin Connect Developer Program (Health/Activity APIs, no nutrition API); Top nutrition APIs 2026 (Nutritionix / FatSecret / USDA / Open Food Facts).
