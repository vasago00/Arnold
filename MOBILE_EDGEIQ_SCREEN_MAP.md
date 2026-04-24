# Mobile EdgeIQ Screen — Data Source Map

Generated: 2026-04-22
Companion to: `MOBILE_START_SCREEN_MAP.md`

EdgeIQ is the second primary mobile tab. It sits on top of the nutrition/supplement
engine (the Health Systems scorecard) while also layering in training + biometric
context (the Signal Cockpit and Annual Progress). Unlike the Start screen, its
*primary* scoring loop is driven by food + supplements, not activities.

---

## 1. Architecture summary

```
localStorage (arnold:*)
│
│  keys read directly in MobileEdgeIQ:
│    activities, hrv, sleep, cronometer
│  keys read via healthSystems.js:
│    cronometer, nutritionLog, supplementsCatalog, supplementsStack,
│    supplementsLog, profile, goals, activities, dailyLogs
│  keys read via getGoals():
│    goals (all annual/weekly/daily target fields)
│
▼
healthSystems.js
│   getDailyNutrients(dateStr)            ← food + supplement totals for ONE day
│   scoreSystem(sys, nutrients, dateStr)  ← weighted avg of nutrient % targets
│   getSystemsReport(today)               ← 10 system rows (id, name, pct, status, comment)
│   getSystemDetail(systemId, today)      ← per-nutrient list for expanded panel
│   getSystemWeekly(systemId)             ← 7-day history array
│   getOptimalTargets(dateStr)            ← dynamic RDAs (weight, age, training hrs)
│
▼
MobileHome.jsx  →  export function MobileEdgeIQ({ data, onOpenTab })  (line 1855)
│    useMemo(report = getSystemsReport(today))
│    storage.get('activities' | 'hrv' | 'sleep' | 'cronometer')  (line 1866-1869)
│    8-week weeklyStats loop (line 1878)
│    cockpitItems array (line 1902)
│    MobileSystemTile × 10             (line 1487 / 1954)
│    SystemDetailPanel when expanded   (line 1538 / 1956)
│
▼
rendered sections:
  1. Header (Arnold logo + YTD pill + YTD mi pill)
  2. Health Systems card  (10 tiles + optional expanded detail panel)
  3. Signal Cockpit       (6 tiles)
  4. Annual Progress      (2 bars: Run distance, Workouts)
```

**Key insight:** The Health Systems pct is **nutrition-centric** — it answers
"did today's food + supplements hit the dynamic nutrient targets?" Training
/ body / blood values only surface inside the *expanded* detail panel as
context signals, they do **not** move the tile percentage.

---

## 2. Storage keys EdgeIQ reads

| Key (localStorage arnold:\*) | Accessed via | Used for |
|--|--|--|
| `activities` | `storage.get('activities')` (EdgeIQ line 1866, detail panel line 1552) + healthSystems.getOptimalTargets | YTD run miles, YTD total sessions, 8-week stats, Signal Cockpit weekly miles/hrs, training load input to dynamic nutrient targets |
| `dailyLogs` | `storage.get('dailyLogs')` inside getOptimalTargets (line 120) | Adds fitActivities durations to weekly training hours for nutrient target scaling |
| `sleep` | `storage.get('sleep')` (line 1868, 1553) | Latest Sleep Score + latest RHR for Cockpit + detail panel |
| `hrv` | `storage.get('hrv')` (line 1867, 1554) | Latest overnight HRV for Cockpit + detail panel |
| `weight` | `storage.get('weight')` (detail panel line 1555) | Weight / Body Fat % / Lean Mass surfaced in expanded panel |
| `cronometer` | `storage.get('cronometer')` (line 1869) + inside getDailyNutrients | Avg 30-day protein for Cockpit; authoritative micronutrient data for Health Systems scores |
| `nutritionLog` | via `getEntriesForDate(dateStr)` (nutrition.js) | Fallback nutrients when Cronometer not present (keyword-estimated) |
| `supplementsCatalog` | via `getCatalog()` (supplements.js line 253) | Per-supplement nutrient payloads |
| `supplementsStack` | via `getStack()` (line 267) | Which supplements are in the daily stack |
| `supplementsLog` | via `getTodayTaken(dateStr)` (line 286) | Which stack entries were ticked off today |
| `profile` | `getOptimalTargets` (line 101) | weight (kg), age (decades over 30) |
| `goals` | `getGoals()` (line 1865) + getOptimalTargets (line 102) | All targets on Cockpit tiles + Annual Progress bars + targetWeight fallback for nutrient models |
| `labSnapshots` | via `data.labSnapshots` prop (line 1556) | Blood markers in expanded panel's Blood section |

Everything else on EdgeIQ is derived. The screen is read-only — it writes nothing.

---

## 3. Section-by-section map

### 3.1 Header  (MobileHome.jsx lines 1918-1936)

| Displayed | Variable | Source | File:line |
|--|--|--|--|
| `ARNOLD` badge + `EdgeIQ` subtitle | static | literal JSX | 1928-1930 |
| `YTD` pill | static label | literal JSX | 1933 |
| `{xxx} mi` pill | `totalMi.toFixed(0)` | sum of `distanceMi` across all activities where `date >= jan 1` of current year AND `activityType` matches `/run/i` | 1873-1874 |

### 3.2 Health Systems card  (lines 1938-1957)

**Status counts in the section header** (lines 1942-1949):

| Displayed | Variable | Derivation |
|--|--|--|
| green dot + count | `goodCount` | `report.filter(s => s.status === 'good').length` (pct ≥ 80) |
| amber dot + count | `focusCount` | pct ≥ 50 and < 80 |
| red dot + count | `defCount` | pct < 50 |

**Tile grid** (5 cols × 2 rows = 10 tiles). Source: `SYSTEMS` array in
`healthSystems.js` line 442 — the IDs and weights are static; only the `pct`
for each tile is computed per day.

| Tile (id) | Name | Contributing nutrients (weights) | Defined at |
|--|--|--|--|
| `brain` | Brain & Cognition | EPA 1, DHA 1, B12 1, Folate 0.8, B6 0.7, Mg 0.7, Quercetin 0.5, Apigenin 0.3, Vit D 0.6 | healthSystems.js:444 |
| `heart` | Heart & Blood | EPA 1, DHA 1, fiber 0.9, Potassium 0.9, Mg 0.7, Folate 0.6, Beetroot 0.5, TMG 0.3 | :454 |
| `bones` | Bones & Muscles | Ca 1, Vit D 1, Mg 0.8, Vit K 0.7, protein 0.8, Phosphorus 0.5, Creatine 0.4 | :465 |
| `gut` | Gut & Digestion | fiber 1, Probiotic 0.8, Vit A 0.4, Zn 0.5, Curcumin 0.3 | :475 |
| `immune` | Immune System | Vit C 1, Vit D 1, Zn 1, Selenium 0.6, Vit A 0.5, Quercetin 0.4, Fisetin 0.3 | :484 |
| `energy` | Energy & Strength | Fe 1, B12 0.9, carbs 0.8, Creatine 0.7, Mg 0.6, Shilajit 0.3, NMN 0.3 | :494 |
| `longevity` | Longevity | NMN 0.9, Resveratrol 0.8, Spermidine 0.7, Quercetin 0.7, Fisetin 0.7, EPA 0.5, DHA 0.5, fiber 0.5, Apigenin 0.3 | :504 |
| `sleep` | Sleep & Rest | Mg 1, Mg-L-Threonate 0.8, Ashwagandha 0.7, Apigenin 0.7, Glycine 0.4 | :517 |
| `metabolism` | Metabolism | fiber 0.9, B6 0.7, B1 0.6, B2 0.6, B3 0.7, Cr 0.5, Mg 0.6 | :528 |
| `endurance` | Endurance | carbs 1, Fe 1, B12 0.8, Na 0.6, K 0.7, Beetroot 0.5, EPA 0.4, DHA 0.4 | :538 |

**How each tile's `pct` is calculated** (healthSystems.js `scoreSystem`, line 551):
```
for each nutrient N in system.weights:
  value  = nutrients[N] (+ aliases for Vit D3 / B12-methyl / Elemental Mg)
  target = getOptimalTargets(dateStr)[N]          // dynamic, see §4 below
  p      = min(value / target, 1.2)               // cap slight over-hit
  weightedSum += p * weight_N
  totalWeight += weight_N
rawScore = weightedSum / totalWeight              // 0..1 (capped at 1.2 earlier)
pct      = round(min(rawScore, 1) * 100)          // 0..100 on display
status   = pct >= 80 ? 'good' : pct >= 50 ? 'focus' : 'def'
```

**Tile rendering** (MobileSystemTile, line 1487) shows:

| Displayed | Variable | Source |
|--|--|--|
| Icon | `SYSTEM_ICONS_M[sys.id]` | static SVG per system id (line 1474) |
| Name | `sys.name.replace(' & ', '/')` | from SYSTEMS array |
| % value | `sys.pct` | from getSystemsReport (line 1857) |
| Status color | green / amber / red | pct threshold (≥80 / ≥50 / <50) |
| Fill height | `Math.max(8, sys.pct)%` | same pct, floor of 8% so empty tiles still show a faint wash |

### 3.3 Expanded System Detail Panel  (lines 1538-1851)

Shown only when the user taps a tile (`expandedSystem === sys.id`). Renders
three tabs: **Daily / Weekly / Annual**.

**Top header of panel** (lines 1622-1636):

| Displayed | Variable | Source |
|--|--|--|
| Icon chip | SYSTEM_ICONS_M[systemId] | static |
| System name | `system.name` | SYSTEMS[id].name |
| Comment | `comment` (prop) from report | `makeComment(pct, gaps, wins)` in healthSystems.js line 577 — picks top gap nutrient and phrases it as "Focus — add B12" / "Low — take Mg" / "Solid — EPA in target" |
| Big % | `detail.system.pct` | getSystemDetail's scoreSystem call |
| "today" label | static | — |

#### 3.3.1 Daily tab  (lines 1646-1718)

**Nutrients list** (line 1650) — every nutrient in `system.weights`, sorted
worst-first by pct:

| Displayed | Variable | Source |
|--|--|--|
| Short name | `n.short` | shortName() mapping in healthSystems.js line 592 |
| `{value} / {target}` | `n.value`, `n.target` | `value = nutrients[N] (+ aliases)`; target = getOptimalTargets()[N]. Rounded. getSystemDetail line 686-693 |
| `({pct}%)` | `n.pct` | round(min(value/target, 1.2) * 100) |
| Bar color | green ≥80 / amber ≥50 / red | barColor() line 1611 |

**Training signals** (line 1663, only rendered if SYSTEM_SIGNALS[id].training non-empty):

Lookup table for which signal goes to which system is `SYSTEM_SIGNALS` at
MobileHome.jsx line 1524. Each signal is resolved by `resolveSignal(name, 'daily')` line 1574:

| Signal name | Resolved value | Source of data |
|--|--|--|
| HRV | `recentHRV[0]?.overnightHRV` | `hrv` storage, filtered to rows with overnightHRV, sorted desc by date |
| RHR | `recentSleep[0]?.restingHR` | `sleep` storage, sorted desc by date, first row with restingHR |
| Sleep Score | `recentSleep.find(s => s.sleepScore)?.sleepScore` | `sleep` storage |
| Avg HR | round of avg of last-7-days run `avgHR` values | `activities` filtered to last 7d & /run/ |
| Weekly Miles | sum of `distanceMi` on last-7d runs | `activities` last 7d |
| Weekly Hours | sum of last-7d `durationSecs` / 3600 | `activities` last 7d |
| Strength Sessions | count of last-7d where `/strength\|weight\|gym/i` matches activityType | `activities` last 7d |
| Avg Pace | avg of last-7d `avgPaceRaw` parsed as m:ss | `activities` last 7d runs |

**Body signals** (line 1682):

| Signal name | Resolved value | Source |
|--|--|--|
| Weight | `recentWeight[0].weightLbs` | `weight` storage, desc by date |
| Body Fat % | `recentWeight[0].bodyFatPct` | `weight` storage |
| Lean Mass | `recentWeight[0].skeletalMuscleMassLbs` | `weight` storage |

**Blood markers** (line 1701) — resolved by `resolveBlood(name)` line 1596:
- Reads `data.labSnapshots` prop (not from storage directly — passed in from
  `MobileEdgeIQ({ data })`), sorts desc by date, takes `.markers` of the first.
- `value = labMarkers[name]` — literal marker from the most recent lab snapshot.
- Returns `—` if the marker key isn't present. No unit display.

#### 3.3.2 Weekly tab  (lines 1721-1773)

| Displayed | Variable | Source |
|--|--|--|
| 7-day bar chart (one bar per day Mon–Sun) | `weekly` | `getSystemWeekly(systemId)` line 699 — loops `i = 6..0`, computes `getDailyNutrients(ds)` then `scoreSystem` for each day. Returns `[{ date, pct, dayLabel }]`. Important: **re-runs full nutrient + scoring pipeline for every past day**, so each bar reflects actual logs from that day |
| "Weekly avg" | `weeklyAvg` | round of mean of weekly[].pct |
| Weekly Training row | `resolveSignal(sig, 'weekly')` | same as Daily signals — they use the same last-7d window internally; the 'weekly' branch is currently identical to 'daily' for most signals (both use wk7 activities) |

#### 3.3.3 Annual tab  (lines 1776-1849)

| Displayed | Variable | Source |
|--|--|--|
| YTD Training block | `resolveSignal(sig, 'annual')` | Uses `ytdRuns` / `ytdAll` (activities since Jan 1). Weekly Miles = `ytdRunMiles / weeksSoFar`. Weekly Hours = `ytdSeconds / 3600 / weeksSoFar`. Strength Sessions = count YTD. Avg Pace = mean over ytdRuns |
| Body (Current) block | `resolveSignal(sig, 'daily')` | Reuses daily body resolvers — snapshot from most-recent `weight` row |
| Blood (Latest Panel · date) | `resolveBlood(sig)` | `labMarkers` from most-recent `labSnapshots[0]`. Subtitle shows the snapshot date |
| Key Nutrients (Today) | first 5 of `nutrients` | Same list as Daily tab, but only top 5 (sorted worst-first) |

### 3.4 Signal Cockpit  (lines 1959-1986)

6 tiles in a 3×2 grid. Array defined at line 1902. Each has
`{ label, value, unit, goal, color }`:

| Tile label | `value` | Source | `goal` (from `getGoals()`) |
|--|--|--|--|
| Avg Miles/wk | `avgWeeklyMi.toFixed(1)` | sum of 8-week runMiles / 8 (line 1887) | `weeklyRunDistanceTarget` |
| Avg Hours/wk | `avgWeeklyHrs.toFixed(1)` | sum of 8-week `durationSecs` / 3600 / 8 (line 1888) | `weeklyTimeTargetHrs` |
| HRV | `latestHRV \|\| '—'` | `recentHRV[0].overnightHRV` (line 1892) | `targetHRV` |
| RHR | `latestRHR \|\| '—'` | `recentSleep.find(s => s.restingHR).restingHR` (line 1895) | `targetRHR` |
| Sleep | `latestSleepScore \|\| '—'` | `recentSleep.find(s => s.sleepScore).sleepScore` (line 1894) | `targetSleepScore` |
| Protein | `avgProtein \|\| '—'` | avg of `cronometer[].protein` over last 30d, where `calories > 0` (line 1900) | `dailyProteinTarget` |

Progress bar under each tile = `min(value / goal, 1)`. If goal is 0 or
missing, the bar simply isn't rendered (line 1977).

**The 8-week window logic** (lines 1878-1886):
```
for i in 0..7:
  wStart = today - (7 * (7 - i) + today.getDay()) days   // aligns to Sundays
  wEnd   = wStart + 7 days
  collect activities in [wStart, wEnd)
  sum miles, hours, sessions per week
avgWeeklyMi  = sum of miles / 8
avgWeeklyHrs = sum of hours / 8
```
**Week boundary:** Cockpit weeks are **Sunday-anchored** (uses `now.getDay()`
directly, where Sunday = 0). This is *different* from the Start screen, which
forces Monday-anchored weeks. So a Sunday run can land in a different week
than the same run shows on Start.

### 3.5 Annual Progress  (lines 1988-2008)

2 bars, defined inline:

| Bar label | `actual` | `target` | Source |
|--|--|--|--|
| Run distance | `totalMi.toFixed(0)` | `G.annualRunDistanceTarget \|\| 800` | activities since Jan 1 filtered to `/run/i`, summed `distanceMi`. Default target 800 mi if goal not set. |
| Workouts | `totalSessions` | `G.annualWorkoutsTarget \|\| 200` | count of all activities since Jan 1 (runs + strength + everything). Default target 200. |

---

## 4. Dynamic nutrient targets  (why two identical days can score differently)

Every `%` on EdgeIQ runs through `getOptimalTargets(dateStr)` at
healthSystems.js:100. Targets are not static — they scale with you and with
your training load:

```
weightKg          = profile.weight * 0.4536  (or goals.targetWeight, or 175lb fallback)
age               = from profile.birthDate or profile.age, else 0
decadesOver30     = max(0, (age - 30) / 10)
weeklyTrainingHrs = sum of last-7-day activities + dailyLogs.fitActivities duration / 3600
```

For each nutrient N in `NUTRIENT_MODELS`:
```
target_N = base_N
         + (perKg_N      × weightKg)
         + (trainingAdd_N × weeklyTrainingHrs)
         + (ageAdd_N     × decadesOver30)
```

So a heavy training week **raises your protein, carb, iron, magnesium, sodium,
potassium, calories targets** — which can make a Health System *drop*
relative to an otherwise identical day. This is intentional (it reflects
elevated needs), but worth knowing when a score moves and you can't explain why
from food logs alone.

Examples (base values — scale as above):
- Protein: base 60g + 1.6 × weightKg + 3 × weeklyHrs
- Vitamin D: base 3000 IU + 500 × decadesOver30
- Magnesium: base 200mg + 4 × weightKg + 20 × weeklyHrs + 10 × decadesOver30
- Sodium: base 1500mg + 200 × weeklyHrs
- Iron: base 12mg + 2 × weeklyHrs

Full table at healthSystems.js:31 (`NUTRIENT_MODELS`).

---

## 5. Nutrient input pipeline  (how `nutrients[N]` gets built for a day)

`getDailyNutrients(dateStr)` at healthSystems.js:309 runs **in this priority
order**:

1. **Cronometer authoritative path** (line 314). If `cronometer` storage has a
   row for `dateStr` with `calories > 0`, use only these. Pulls real
   lab-grade micronutrients: Vit D, C, A, B12, Folate, Ca, Fe, Mg, Zn, K, Na,
   Selenium, omega-3 (split 50/50 EPA/DHA), plus macros.
2. **nutritionLog fallback** (line 344). If no Cronometer row, iterate
   `getEntriesForDate(dateStr)` and run `estimateFoodNutrients()` — this is
   keyword-based (salmon → EPA+DHA, spinach → K+Folate+Fe, etc.) applied per
   100 kcal of each entry. **Only macros are tracked per-entry in localStorage;
   micronutrients come entirely from keyword heuristics.**
3. **Supplement top-up** (line 360). Always runs, regardless of food source.
   For each stack entry ticked in `supplementsLog[dateStr]`, add that
   supplement's nutrient list × `doseMultiplier`.

This means:
- A day with a Cronometer row will score **very differently** from a day with
  only nutritionLog entries — Cronometer reflects real lab values, nutritionLog
  depends on whether your food name happens to match a keyword.
- Supplements are additive on both paths.
- **Full-day dedup** (line 350) — if the same day has multiple `meal:'full-day'`
  entries (e.g. from re-import), only the most recent by `createdAt` is used.

---

## 6. Things that might surprise you (EdgeIQ-specific)

1. **The tile % has nothing to do with training, body, or blood.** It's 100%
   driven by food + supplements. The Training/Body/Blood signals inside the
   expanded panel are **context only** — they don't affect the percentage.

2. **"Today" with nothing logged = low scores.** `findBestNutrientDate` (line
   648) explicitly **does not fall back** to yesterday's data if today is empty.
   So if you haven't logged anything yet, every tile except the ones boosted
   by taken supplements will show single-digit %. Intentional — the comment
   there says: "no fallback to previous days. If nothing is logged yet today,
   scores reflect that."

3. **Cronometer trumps manual entries entirely.** If Cronometer has any row
   for the day with calories > 0, your manual nutritionLog entries are
   **completely ignored** for nutrient calculations (supplements still count).
   Line 344: `if (!hasCronometer)`.

4. **Avg Pace on Annual tab will be wrong if `avgPaceRaw` is not in m:ss
   format.** The parse at line 1579 splits on `:` and expects `[minutes,
   seconds]`. Anything else returns null and the tile shows `—`.

5. **8-week weeks on the Cockpit are Sunday-anchored, but Start screen weeks
   are Monday-anchored.** Same raw activity can show up in different buckets
   on each screen on Sun/Mon boundary days.

6. **Default annual goals are hardcoded fallbacks.** If you haven't set
   `goals.annualRunDistanceTarget`, it defaults to 800 mi; workouts defaults to
   200. (Lines 1992-1993.) Your actual stored goal overrides these.

7. **`recentHRV` requires `overnightHRV` field.** The filter at line 1891
   silently drops rows that only have `.hrv` but no `.overnightHRV`. Same for
   RHR — only looks at sleep rows. A standalone `restingHR` logged somewhere
   else wouldn't show.

8. **Blood markers are only present if a `labSnapshots` prop was passed in.**
   `MobileEdgeIQ({ data, onOpenTab })` expects `data.labSnapshots`. If
   `MobileHome` wrapper doesn't receive this, blood tiles show `—`.

9. **`weekly` tab re-runs the full scoring pipeline 7 times per expand.** Each
   day fires `getDailyNutrients` (cronometer read + nutritionLog read +
   supplements read) and `scoreSystem`. For a heavy supplement log it's
   ~500 operations per tap. Cached only within a single render via `useMemo`
   keyed on `systemId`.

10. **`getOptimalTargets` has a simple cache keyed on `weightKg|age|weeklyHrs`.**
    If none of those change (e.g. same day, same session), targets are reused.
    But any profile edit or training log write should recompute.

11. **`cleanSleepForAveraging` filters the sleep array** before the "latest"
    picks run. This strips rows flagged as naps / outliers before
    latest-sleep-score is computed. Defined elsewhere in MobileHome.jsx.

12. **`scoreSystem` caps each nutrient at 120% of target** before weighting
    (`min(value/target, 1.2)` line 564). You can't get to 100% on a system
    by mega-dosing one nutrient — overshoot only contributes 20% of extra
    weight to that nutrient's slot, then the overall rawScore is capped at 1.

---

## 7. Key function references

| Function | File | Line | What it does |
|--|--|--|--|
| `MobileEdgeIQ` | MobileHome.jsx | 1855 | Top-level screen component |
| `MobileSystemTile` | MobileHome.jsx | 1487 | One of the 10 system tiles |
| `SystemDetailPanel` | MobileHome.jsx | 1538 | Expanded panel below a tapped tile |
| `resolveSignal` | MobileHome.jsx | 1574 | Maps "HRV"/"RHR"/"Weekly Miles"/etc. → numeric value |
| `resolveBlood` | MobileHome.jsx | 1596 | Maps marker name → value from latest lab snapshot |
| `SYSTEM_SIGNALS` | MobileHome.jsx | 1524 | Which training/body/blood signals belong to which system |
| `SYSTEM_ICONS_M` | MobileHome.jsx | 1474 | Inline SVG icon per system id |
| `getSystemsReport` | healthSystems.js | 655 | Returns 10-row tile report |
| `getSystemDetail` | healthSystems.js | 678 | Returns expanded-panel per-nutrient list |
| `getSystemWeekly` | healthSystems.js | 699 | 7-day history for one system |
| `getDailyNutrients` | healthSystems.js | 309 | Core food + supplement totals for one day |
| `scoreSystem` | healthSystems.js | 551 | Weighted % for one system from nutrients + targets |
| `getOptimalTargets` | healthSystems.js | 100 | Dynamic RDAs (profile + training + age) |
| `SYSTEMS` | healthSystems.js | 442 | The 10-system config w/ weights |
| `NUTRIENT_MODELS` | healthSystems.js | 31 | Per-nutrient base + perKg + trainingAdd + ageAdd |
| `makeComment` | healthSystems.js | 577 | Short human comment under the tile |
| `getEntriesForDate` | nutrition.js | 99 | nutritionLog lookup by date |
| `getCatalog / getStack / getTodayTaken` | supplements.js | 253 / 267 / 286 | Supplement plumbing |

---

## 8. Troubleshooting lookup — "where does X come from?"

| You see on EdgeIQ | Read the code at |
|--|--|
| A system tile is 0% | healthSystems.js:655 + scoreSystem:551 — trace `nutrients[N]` for each weight |
| All tiles are very low | Probably nothing logged today — findBestNutrientDate:648 doesn't fall back |
| A nutrient shows 0 in the detail panel | Check Cronometer path first (line 314); if no Cronometer, check keyword match in `FOOD_KEYWORD_NUTRIENTS` (line 191) for your food name |
| Target feels wrong | getOptimalTargets:100 — the `NUTRIENT_MODELS` table + your profile.weight / profile.age / last-7d training hours |
| HRV / RHR / Sleep not showing | Confirm a `hrv` / `sleep` row exists with the specific field (`overnightHRV`, `restingHR`, `sleepScore`) |
| Avg Pace is `—` | `avgPaceRaw` on the activity row must parse as `m:ss` (line 1579) |
| Blood markers all `—` | `data.labSnapshots` prop isn't being passed, or the marker names in `SYSTEM_SIGNALS` don't match `labSnapshots[0].markers` keys |
| Weekly Miles = 0 but I ran | activities row missing `distanceMi` or `activityType` doesn't include "run" (line 1873) |
| Protein tile on Cockpit is `—` | No `cronometer` rows in last 30d with `calories > 0` (line 1899). Protein from nutritionLog is **not** used on the Cockpit tile |
| Tile didn't update after logging food | Check if a `cronometer` row exists for today — if yes, nutritionLog writes are ignored |
| Weekly bar chart wrong for a past day | getSystemWeekly:699 re-reads that day's cronometer + nutritionLog + supplementsLog entries. Check those raw records |
| Supplement-boosted nutrient not counting | `supplementsLog[dateStr][stackEntryId]` must be truthy AND the stack entry must reference a catalog item whose `nutrients[]` contains the name |

---

Ready to dig into any of these in depth — say the word (e.g. "walk me through
how Energy & Strength scored 43% yesterday" and I'll trace it end-to-end).
