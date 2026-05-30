# Arnold — Smoke Tests

Per-surface regression checklist. Run the relevant section after any
change that touches the surface, or run the whole file (~2 minutes) after
any change to shared state (intelligence layer, goalModel, energyBalance,
storage, sync, mobile.css).

Last sweep: Phase 4r.narrative.5.fix.13 (2026-05-27) — added Coach tab
Model B section, retired EdgeIQ tension band + Today's Status checks
(moved to Coach), tightened lifecycle test for the triple-listener
resume handler, added rTSS cross-surface consistency check, added
mobile Start race-badge layout check, documented web page-title
header retirement.

How to read the tags
--------------------
- `[web]` = browser at any width >600px
- `[mobile]` = browser ≤600px OR Android device via Capacitor
- `[both]` = run on both

Before you start
----------------
- [ ] DevTools console open
- [ ] Build stamp visible: `[arnold-build] Phase 4r.XXX · …`. Match against
      the phase tag in the most recent commit / response. If they don't
      match, the build is stale — force a rebuild before running tests.
- [ ] Boot fingerprint visible: `[arnold-state] …` lines printed once.
      No red errors in console (CORS/404 from third-party APIs are OK).

---

## Web tab headers `[web]` — Phase 4r.narrative.5.fix.5

The top nav highlight is now the SOLE page identifier on web tabs.
Inline `<S.st>` page-title labels were retired from Plan, Core, Labs,
Daily, Calendar (web only), EdgeIQ, Trend, Profile, and the
Supplements/Stack content area. Mobile is unchanged — the mobile
unified per-tab header still shows the page name in `Arnold.jsx`.

- [ ] On the WEB build, navigate through every nav tab in the top
      strip and confirm NO duplicate page-title text inside the
      content area. The only "page identifier" visible should be the
      active nav slot's highlight in the top strip
- [ ] Tabs that ARE allowed to keep secondary header content (NOT a
      page title — actual data):
      - EdgeIQ: the `{yearLabel} · {yearStr}` subtitle + YTD/days-in
        badges + Analyze AI button row (these carry information, not
        just the tab name)
      - Stack: the adherence subtitle (`Stack, catalog & daily nutrient
        totals · {X}% 7-day adherence`)
- [ ] On the MOBILE build, the unified per-tab header (rendered in
      Arnold.jsx ~line 1743) is STILL present on every drill-down tab
      (Play / Fuel / Daily / EdgeIQ / Calendar / Plan / Labs / Core /
      Settings). Start gets its custom cockpit header instead

---

## Calendar tab `[mobile]`

- [ ] Grid renders 6 weeks (Mon–Sun headers visible)
- [ ] Today is highlighted with cyan border + blue background tint
- [ ] Drawer renders inline below grid showing today's date
- [ ] Drawer shows `+ Plan` and `+ Add race` chips (top right of drawer header)
- [ ] **Tap a future day in the same row as today** → drawer updates to that
      day's date label, drawer is empty of completed activities, shows
      "Expected Today" if planned
- [ ] **Tap a future day in the BOTTOM row** of the grid → drawer updates
      to that day. (This is the row that previously absorbed taps into
      the +Add race chip's invisible overlay.)
- [ ] **Tap `+ Plan`** → workout-type modal opens with the SELECTED date
      in the title. List shows: Easy run, Tempo, Intervals, HIIT,
      Strength, Mobility, Cross-train, Rest, Race day.
- [ ] **Tap a workout type** in the modal → modal closes, toast appears
      ("Planned X"), drawer for the selected day shows the planned
      session.
- [ ] **Tap `+ Add race`** → race-catalog modal opens with `Add race for
      YYYY-MM-DD` matching the SELECTED date (NOT today, if you've
      navigated)
- [ ] **Tap `Today` button** → grid jumps back to today's month if
      navigated away, drawer updates to today
- [ ] **Tap `‹` prev month** → grid renders previous month, today
      highlighting disappears (or stays if today is in that month)
- [ ] **Tap `›` next month** → grid renders next month
- [ ] **Swipe left** on the grid → next month renders (NOT tab change to
      Core)
- [ ] **Swipe right** on the grid → previous month renders (NOT tab
      change to Fuel)

## Calendar tab `[web]`

- [ ] Grid renders, drawer renders to the right (when wide) or below (when narrow)
- [ ] Tap any day → drawer updates
- [ ] Tap selected day again → drawer toggles closed (desktop only)
- [ ] All chips behave per the mobile list above

---

## EdgeIQ (TrainingTab) `[web]`

- [ ] Page loads, no white screen
- [ ] Build stamp + boot fingerprint visible in console
- [ ] Hero rail renders: speedometer + Activity/Nutrition/Body domain
      scores + ACWR/rTSS/Cal-left/Protein-left/HRV/Sleep/Today/Race tiles
- [ ] **rTSS color consistency (Phase 4r.narrative.5.fix.11):** the rTSS
      MiniStat number color must match what the Daily-tab gauge paints
      for the same rTSS value. Both surfaces route through canonical
      `rtssBand()` in `trainingStress.js`. Quick check: ≤50 = green,
      ≤100 = blue, ≤150 = amber, >150 = red. If you see rTSS=39 painted
      RED on EdgeIQ but GREEN on Daily, the MiniStat lost its
      `type="rtss"` prop or `statusFor` no longer has the `rtss` branch.
- [ ] **Coach summary line (Phase 4r.narrative.5.fix.7-10 — Model B):**
      a thin Coach summary line renders just below the metric rail.
      Layout: Convergent Wedge sigil (left, teal) → state dot +
      lowercase italic state tag (e.g. `sleep debt · severe`) →
      `open ↗` (right, teal italic). Horizontal hairline below the
      header, then 2 lines of italic serif body prose with the
      leverage action sentence. NO severity-tinted background
      (teal-on-dark stays constant regardless of state); NO `COACH`
      wordmark. Hover lifts the teal border opacity slightly.
- [ ] Tap anywhere on the summary line → routes to the Coach tab
- [ ] **Goal Tensions + Today's Status moved to Coach (Phase 4r.narrative.5.fix.6 — Model B):**
      these two panels NO LONGER render on EdgeIQ. They live on the
      Coach tab now. If you still see "Goal tensions detected" or
      "Today's status" sections on EdgeIQ, Model B was reverted or a
      stale build is loaded. Build stamp should be ≥ fix.6.
- [ ] **Health Systems is visible on the first page** without
      scrolling (at standard 1080p / 1440x900). With the synthesis
      panels moved to Coach, this should now be reliably true.
- [ ] `window.intelligenceDebug()` in console returns `{ state, cards }`
- [ ] `window.goalModelDebug()` in console returns `{ outcome, targets,
      overrides, ledger }`
- [ ] **Recovery-debt burden parity (Phase 4r.dataspine.1 regression
      check):** in console, run `window.intelligenceDebug()` and verify
      `state.recoveryDebt` matches what `window.goalModelDebug()` shows
      for the recovery modifier component. They use the same classifier
      now; if they ever diverge, the consolidation regressed.
- [ ] **Sleep-debt burden fires correctly:** if your 7-day sleep average
      is < 6.5 hours, `state.burdens` should include `recovery-debt` (or
      `sleep-debt` once that burden lands). If it doesn't,
      `classifyChronicRecoveryDebt` is broken.

## EdgeIQ `[mobile]`

- [ ] MobileEdgeIQ renders with systems grid
- [ ] NO `BEHIND +X.X lb drift` calibration band at top of EdgeIQ
      (removed in Phase 4r.intel.24 — same fact lives in WEIGHT cockpit
      tile + the primary intelligence tile)
- [ ] **Render order is:** Header (ARNOLD / EdgeIQ / date) → Primary
      intelligence tile (combined "PRIORITY · {PILLAR}" header band +
      tile) → Health Systems grid → Signal Cockpit grid → DCY Breakdown.
      As of Phase 4r.intel.29 the tile renders its OWN combined header
      band — there is NO separate "Priority" section header outside the
      tile any more (that produced the visible "Priority" + small "GOAL"
      label repetition the user reported)
- [ ] **Combined header band** above the tile reads `PRIORITY · {PILLAR}`
      in muted uppercase on the left, a thin divider line in the middle,
      and a colored severity word badge on the right
      (`CONCERN` red / `WATCH` amber / `NOTE` blue / `ON TRACK` green).
      Header band is part of the MobileIntelligenceCards component
      — should NEVER render twice
- [ ] **Tile body** structure: thick 5px top accent line (severity
      color), subtle severity-tinted background wash (~6-8% opacity of
      severity color), NO inline pillar tag at the top of the tile body
      (it moved into the header band above), 15px bold headline as the
      visual focal point, then `→` recommendation, then optional
      `ALSO: …` footnote
- [ ] On a CONCERN-severity tile (e.g. cortisol-water-retention,
      cut-and-race-peak), the red wash + thick red top bar + red
      `CONCERN` badge should make the tile visibly LOUDER than the
      Health Systems / Signal Cockpit cells below it. If the priority
      tile looks the same weight as the surrounding cells, the tint
      isn't applying or the badge isn't rendering
- [ ] **TRAIN pillar status** is plan-aware (Phase 4r.intel.27): if a
      session is on the calendar but not yet logged, the TRAIN card
      title reads `Planned: <type> · <distance>` (e.g. `Planned: Easy
      run · 4 mi`). NEVER reads the literal string "No session today"
      when a session is actually planned for today. Rest days read
      `Rest day` or `Rest day (planned)`. Sessions already logged read
      `Session logged · X kcal credited`. Multi-day training gap reads
      `No training for Nd`
- [ ] **No occurrence of the literal string `undefined`** anywhere in
      the tile (headline OR footnote). Same template-literal bug class
      as the Start headline; the EdgeIQ tile reads from the same
      synthesizer output so any new conflict/burden definition needs
      to be checked here too
- [ ] When `intelligence.cards.length >= 2`, footnote line shows
      `ALSO: TAG phrase · TAG phrase` for the remaining cards. Footnote
      is NOT JS-truncated per chip — CSS line-clamp (2 lines, `overflowWrap:
      anywhere`) handles overflow at line boundaries. If you see a
      mid-word `…` like `slee…` or `prio…` that means JS truncation
      crept back in
- [ ] When `intelligence.cards.length === 1`, NO footnote renders (no
      empty `ALSO:` line)
- [ ] When `intelligence.cards.length === 0`, the entire tile is hidden
      (returns null — no empty box at the top of EdgeIQ)
- [ ] NO legacy InsightsPanel below the intelligence tile (removed in
      Phase 4r.intel.24 — duplicated the synthesizer output)
- [ ] Health Systems grid renders BELOW the intelligence tile (NOT above)
- [ ] Signal Cockpit grid renders unchanged below Health Systems

---

## Trend tab (Dashboard) `[web]`

- [ ] Page loads, no errors
- [ ] KRI tiles render (Activity / Nutrition / Body sections)
- [ ] Weekly Sync UI renders if no recent CSV
- [ ] AI Summary button visible

## Daily tab (LogDay) `[web + mobile]`

- [ ] Page loads, no errors
- [ ] rTSS speedometer renders if any session today
- [ ] **rTSS gauge band + color match EdgeIQ MiniStat** for the same
      value (Phase 4r.narrative.5.fix.11). Both surfaces consume the
      canonical `RTSS_BANDS` table in `trainingStress.js`. Quick check:
      if today's rTSS is 39, the Daily gauge needle sits in the GREEN
      "EASY" zone AND the EdgeIQ rTSS MiniStat reads "39" in GREEN
      with sub "easy". If the colors differ, one surface bypassed
      `rtssBand()` — check `statusFor` in Arnold.jsx still has the
      `rtss` branch and the MiniStat is called with `type="rtss"`
- [ ] Activity log shows today's sessions if any
- [ ] Nutrition log shows today's entries if any
- [ ] Planned session tile renders for today's plan if any

---

## MobileHome / Start screen `[mobile]`

- [ ] DCY readiness compass renders
- [ ] Pinned KRI tiles render (per user's pin prefs)
- [ ] Bottom nav: Start / EdgeIQ / Play / Fuel / Calendar / Core / More
- [ ] **Swipe left** through Start → goes to EdgeIQ (NOT skipping to Play)
- [ ] **Swipe right** from EdgeIQ → back to Start
- [ ] **Tap each bottom-nav slot** → correct tab renders

### Hero rail — race badge (Phase 4r.narrative.5.fix.14)

fix.12 had promoted the badge to its own row above the score; fix.14
reverted that per user feedback ("the badge belongs in the top-right
corner, not above"). The real fix is making the badge tight enough
that it doesn't squeeze the narrative column: `shortRaceName()` now
applies a city-abbreviation lookup table so "HYROX New York" renders
as "HYROX NY" (8 chars) regardless of available width.

- [ ] When a race is within 7 days, the badge renders in the TOP-RIGHT
      corner of the hero rail row, alongside the score ring on the
      left and the narrative column in the middle. NOT in its own row
      above the score
- [ ] Badge content: orange "Nd" day-count on the left, then a small
      right-aligned stack with race name (top) and date (bottom)
- [ ] **Race name is abbreviated** by `shortRaceName(name, 16)` — known
      cities (NY, LA, SF, LDN, BER, TYO, BOS, CHI, PHL, etc.) replace
      the full city name. Verify with the in-storage race: if you set
      a race name like "HYROX New York" via Plan → Races, the hero
      badge should show "HYROX NY". If you set "Berlin Marathon", it
      should show "BER Marathon"
- [ ] The intel-headline narrative below "Balanced" / status word wraps
      to 2 lines without clipping mid-sentence. If the second line ends
      with "…" mid-word, the badge is too wide (city abbreviation
      didn't fire) or the narrative-column flex sizing regressed
- [ ] When NO race is within 7 days, the badge is hidden entirely
      (not an empty pill, not a placeholder)
- [ ] **shortRaceName algorithm sanity:** in DevTools console, run
      `window.shortRaceNameDebug()` (no args) — prints a console.table
      with ~12 canonical race-name samples and their abbreviated forms.
      Spot check: `'HYROX New York'` → `'HYROX NY'`,
      `'TCS New York City Marathon'` → `'TCS NYC Marathon'`,
      `'Berlin Marathon'` → `'BER Marathon'`,
      `'Stockholm Marathon'` → `'Stockholm Marathon'` (single-word
      unknown city — no abbrev, no truncate at max=16).
      For a detailed step-by-step trace on one name, pass it:
      `window.shortRaceNameDebug('HYROX New York')` — returns
      `{ input, output, max, steps[], abbrevCount }` where `steps`
      shows what each pipeline stage produced. Useful when a new race
      name returns something unexpected — you can see which stage
      mangled it.
- [ ] **Edge case — unknown city + long name:** seed a race with a long
      unknown city name like `'HYROX Salt Lake City'`. Since SLC isn't
      in the lookup, the algorithm falls back to ellipsis truncation
      at max=16 → `'HYROX Salt La…'`. This is acceptable; add SLC to
      the lookup table if you race there

### App lifecycle — always-Start (Phase 4r.intel.29 + 4r.narrative.5.fix.13)

The resume handler now listens to THREE events for reliability across
Android Capacitor + browser bfcache: `visibilitychange`, `pageshow`,
and `focus`. A 500 ms debounce guards against the same resume firing
twice. Each reset prints a diagnostic line:
`[arnold-lifecycle] resume → reset to Start (via <source>)`.

- [ ] **Cold start:** force-kill the app (swipe away from recents), then
      relaunch. App must open on the Start screen, regardless of which
      tab was active when killed. Console shows the lifecycle log line
      once on resume (NOT on cold start — debounce prevents the
      initial-mount false-positive)
- [ ] **Resume from background:** open the app, navigate to EdgeIQ (or
      any non-Start tab). Switch to another app (Slack, camera, anything).
      Return to Arnold. App must be on the Start screen, NOT on the tab
      you left. Console shows `[arnold-lifecycle] resume → reset to
      Start (via visibilitychange|pageshow|focus)`. The source name
      tells you which listener fired on your device — if a particular
      Android build only fires `focus` and never `visibilitychange`,
      that's still working as long as one of them fires
- [ ] **Quick app-switch test:** same as above but switch away for only
      ~3 seconds. Behavior is identical — Start screen on return, ONE
      lifecycle log line (not 2-3 — the debounce should catch overlapping
      events). If you see the line print 2x in rapid succession, the
      debounce is broken
- [ ] **Desktop browser test:** open the app in browser, navigate to
      EdgeIQ, switch to another browser tab, come back. Tab should
      stay on EdgeIQ — the reset is gated to `isMobileApp` only
- [ ] **Stale modals close:** open the More overflow sheet on the
      bottom nav, switch to another app, return. More sheet should be
      closed (resume handler also calls `setMobileMoreOpen(false)`)
- [ ] **Diagnostic absence — debugging a stuck WebView:** if the user
      reports "didn't reset on resume," open `chrome://inspect` while
      connected to the device and watch for the lifecycle log line. If
      it NEVER appears across a known-good resume, the WebView isn't
      dispatching any of the three events — at that point we need to
      install `@capacitor/app` and add a fourth listener via
      `App.addListener('appStateChange', ...)`

### Intelligence headline under DCY status word (Phase 4r.intel.27)

- [ ] Headline renders beneath the status word (e.g. "Depleting") when
      the synthesizer produced at least one card with a recommendation.
      In `window.intelligenceDebug()` verify `cards.length > 0` and at
      least one card has a non-empty `recommendation` field
- [ ] Headline starts with a `→` glyph (cyan/blue, non-italic) followed
      by the recommendation text in italic muted style
- [ ] Headline contains a TODAY-SCOPED ACTION (e.g. "Add 200 kcal more",
      "Sleep 7.5h tonight", "30 min zone-2 walk"). It should NOT be a
      strategic conflict TITLE (e.g. "Weight cut + race in 10 days (A
      priority)") — that was Phase 4r.intel.25 behavior; the lead pillar
      logic in Phase 4r.intel.27 prefers Fuel > Recover > Train cards
      whose recommendations are day-actionable
- [ ] **No occurrence of the literal string `undefined`** anywhere in
      the rendered headline (template-literal interpolation bug check)
- [ ] Headline wraps to 2 lines max if long; CSS line-clamp truncates
      with `…` at the visual end of line 2 (NOT mid-word in the middle
      of line 1)
- [ ] Headline never pushes the rail wider than the viewport — the
      score ring + factor chips below stay aligned
- [ ] When the synthesizer produces no cards
      (`intelligenceDebug().cards.length === 0`), the headline is absent
      (NOT an empty italic block, NOT a lone `→` glyph)
- [ ] **PRESENCE CHECK (Phase 4r.intel.28 regression):** open
      `window.intelligenceDebug()` in console — if `cards.length > 0`
      AND at least one card has a non-empty `recommendation` field,
      the headline MUST render. If the synth has cards but the rail
      shows nothing under "Depleting", the intelHeadline memo is
      silently catching an error (or the return-shape changed).
      Check console for `[intelHeadline] synth failed:` warnings.

---

## Mobile Plan tab (Goals) `[mobile]`

- [ ] Page loads, weekly planner renders
- [ ] Tap a day in the weekly planner → workout picker opens
- [ ] Workbench section renders below

## Plan tab — Goals Hub edit forms `[web + mobile]`

After ANY change to GoalsHub.jsx, run every edit-form path. These
are full UAT-style keystroke scripts — not vague "verify the form
opens" checks. Each one specifies exactly what to type and exactly
what should result, because real bugs hide between "form opens"
and "form actually accepts and saves correct data."

The 2026-05-23 "Marathon +set blanks the screen" bug AND the
2026-05-23 "TimeInput refuses MM/SS input after HH typed" bug both
slipped past because I'd only checked that the form OPENED, not
that it actually worked under realistic input.

**Quick fields — value + save round-trip:**

- [ ] Body tile · **Target lean mass** → tap `+ set` → form opens → type `155` → tap Save → row shows `155 lb`
- [ ] Body tile · **Target weight** → tap `edit` on existing row → form pre-fills with current value → change to a new number → Save → row shows new value
- [ ] Recovery tile · **HRV baseline** → tap `+ set` → type `48` → Save → row shows `48 ms`
- [ ] Recovery tile · **Resting HR** → tap `+ set` → type `52` → Save → row shows `52 bpm`

**Performance · Endurance — TIME INPUT (3-cell H:MM:SS) UAT script:**

- [ ] Tap `+ set` on **Marathon** → THREE EMPTY cells appear (hh : mm : ss), all blank, cursor in HH
- [ ] Type `3` in HH → cell shows `3`, cursor STAYS in HH (only 1 digit)
- [ ] Press `:` key → cursor jumps to MM
- [ ] Type `1` in MM → cell shows `1`, cursor stays in MM
- [ ] Type `5` in MM → cell shows `15`, cursor AUTO-JUMPS to SS
- [ ] Type `0` `0` in SS → cell shows `00`, cursor stays in SS
- [ ] Tap Save → row shows `3:15:00` · console clean
- [ ] Tap `edit` on Marathon → cells pre-fill: HH=`3`, MM=`15`, SS=`00` (NOT empty, NOT `00:00:00`)
- [ ] Backspace in HH until empty → cursor stays in HH (no previous cell)
- [ ] Backspace in MM until empty → cursor JUMPS back to HH

- [ ] Tap `+ set` on **5K** → 3 empty cells, leave HH blank, type `2` `2` in MM → auto-advance to SS → type `0` `0` → Save → row shows `22:00`
- [ ] Edit existing 5K → cells pre-fill MM=`22`, SS=`00`, HH blank (NOT `0`)

**Performance · Strength — custom PR builder:**

- [ ] Tap `+ Add custom PR` → 5 fields appear inline (Name / Value / Unit / Date / Priority)
- [ ] Type `Pull-ups 1RM` in Name → `20` in Value → `reps` in Unit → leave Date blank → P1 in Priority → Save → row shows `Pull-ups 1RM · 20 reps`
- [ ] Tap `edit` on the saved row → fields pre-fill with current values
- [ ] Tap Delete → row removed from list

**Races:**

- [ ] Tap `+ Add` in Races tile → modal opens with race fields (Name / Date / Priority / Type / City / Distance / Goal time)
- [ ] Type `Test Race` in Name, pick a future date, A priority, Save → race appears in Races list
- [ ] Tap `edit` on the new race → modal opens pre-filled → change Name → Save → list reflects change
- [ ] Tap `Delete` in modal → race removed

**Manual pins:**

- [ ] Manual pins tile → type a value in Daily calorie target field → tap `Pin` → row updates to show "pinned X kcal (derived: Y)"
- [ ] Tap `Clear` → row reverts to derived value only
- [ ] EdgeIQ FUEL card target updates to match the pinned/derived state

**Console hygiene check after EVERY save above:**

- [ ] No red TypeError / ReferenceError / "is not a function" / "is not defined" / Hydration warnings
- [ ] No infinite-loop "Maximum update depth exceeded" warnings
- [ ] Build stamp still matches the current phase tag

---

## Sync `[both]`

- [ ] Pull-to-refresh from Start screen triggers full sync
- [ ] Toast appears confirming sync result
- [ ] No JS errors (CORS/404 from Open-Meteo or Garmin OK)
- [ ] `[tilesync]` logs visible in console showing pull/push activity

---

## Error boundaries — Phase 4r.hygiene.1

Run after any change to the tab dispatch in `Arnold.jsx` or to any
top-level tab component (TrainingTab, Dashboard, LogDay, CalendarTab,
GoalsHub, LabsModule, ClinicalModule, SupplementsTab, ProfileSettings).

- [ ] **Every tab** has an `<ErrorBoundary tabName="…">` wrapping its
      top-level component in `Arnold.jsx`. Grep `ErrorBoundary` to
      confirm 11 wrappers exist (EdgeIQ / Labs / Core / Start / Daily /
      Play / Fuel / Calendar / Plan / Supplements / Settings)
- [ ] **Inject a fake error** to verify the boundary works: in DevTools
      console, run `window.dispatchEvent(new ErrorEvent('error', { message: 'test' }))`
      to confirm the boundary doesn't catch global errors. To actually
      test it, temporarily add a `throw new Error('boundary test')` at
      the top of any tab component, render that tab — you should see
      the "Tab — render error" UI with a Retry button instead of a
      blank tab. Undo the throw before committing.
- [ ] When a tab boundary fires, console shows
      `[ErrorBoundary:<tab>] caught: …` with full stack trace
- [ ] Tapping "Retry render" inside the error UI resets the boundary
      state and re-attempts the render (state is whatever it currently
      is — fix the bug first or the retry will just throw again)
- [ ] Switching to a sibling tab and back resets the boundary
      automatically (React unmounts the errored component on tab change)

## safeCompute — Phase 4r.hygiene.1

- [ ] In console, run `console.warn('test')` — if you see your warn,
      logging works. Then trigger a known-bad derivation (e.g.
      temporarily mutate `window.localStorage` to corrupt one of the
      stores read by computeUserState). You should see
      `[MobileEdgeIQ:computeUserState] failed: …` in console — that's
      a `safeCompute`-wrapped failure surfacing cleanly. Restore
      storage when done
- [ ] Grep `try {` in `MobileHome.jsx`, `Arnold.jsx` derivation memos —
      most should be migrated to `safeCompute('label', ...)`. New
      derivation code MUST use safeCompute per CONTRIBUTING.md

## Coach tab — Model B layout `[web]` — Phase 4r.narrative.5.fix.6+

The Coach tab is the SYNTHESIS surface in Arnold (Model B). EdgeIQ
is the status/numbers surface; the Coach is the interpretation layer.
After Phase 4r.narrative.5.fix.6 (2026-05-27) the Coach tab carries
THREE synthesis blocks below the BETA header:

  1. NarrativeBlock — the full leverage-point chain + tiles (Phase 4r.narrative.3)
  2. **Goal Tensions Detected** — multi-hypothesis portfolio conflicts (moved from EdgeIQ)
  3. **Today's Status** — per-pillar day-level actions (moved from EdgeIQ)
  4. Signal Detail brief cards — per-pattern evidence (Phase 4r.coach.v2.surface)

All four read from the same `userState` so they reflect the same tick.

- [ ] Coach tab renders all four sections in order: Header → Narrative
      → Goal Tensions → Today's Status → Signal Detail
- [ ] **Goal Tensions Detected:** when `userState.goalConflicts`
      contains any conflict with severity `concern` or `attention`, a
      panel renders with a "Goal tensions detected" label, the count
      ("N active"), and up to 4 conflict rows. Each row: severity badge
      (CONCERN red / WATCH amber) + title + detail + `→` recommendation.
      If no concern/attention conflicts fire, the panel is hidden
- [ ] If >4 tensions exist, a "+N more tension(s) not shown" footer
      line appears
- [ ] **Today's Status:** below Goal Tensions, a panel with "Today's
      status" label + one-line-per-pillar tappable rows. Each row:
      pillar tag (Fuel/Recover/Train/Body/Goal) + title + `→`
      recommendation. Tapping a row routes to the pillar's source tab
- [ ] **No duplicate content** between Goal Tensions and Today's
      Status. If a pillar's conflict is in Goal Tensions, that pillar's
      synth card is filtered out of Today's Status (same dedup logic
      that previously ran on EdgeIQ)
- [ ] Each block recomputes when storage changes (Garmin sync,
      Cronometer entry, manual log) — verify by triggering a manual
      log and confirming the panels update within a tick
- [ ] Tabs Coach Focus + Goal Tensions + Today's Status DO NOT appear
      on EdgeIQ (Model B). If you see them on EdgeIQ, build is stale
      or Model B was reverted

### Coach voice — visual identity (Phase 4r.narrative.5.fix.8-10)

The Coach surfaces speak in a distinct typographic register from the
rest of Arnold (which is sans-serif cockpit data). This identity must
be consistent across the EdgeIQ summary line, the Coach tab header,
and any future Coach-flavored panel.

- [ ] **Convergent Wedge sigil** (teal circle + piercing wedge) renders
      next to every Coach-flavored block — currently on the EdgeIQ
      summary line. Source: `src/assets/coach-sigil.png`, ≤ 20 KB.
      If you see "A°" still rendered or a placeholder, the asset
      isn't bundling
- [ ] **Coach signature color is teal** (`#5eead4`) regardless of
      severity. NEVER paint the Coach panel red/amber based on state.
      Severity lives ONLY in the small state-dot inline with the
      lowercase italic state tag (e.g. `sleep debt · severe`)
- [ ] **Serif italic body text** (Georgia / Cormorant Garamond) for
      Coach prose — distinct from the sans-serif data everywhere else.
      If Coach text renders in the same font weight/style as a MiniStat
      sub, the voice has lost its identity
- [ ] NO "COACH" wordmark anywhere — the sigil + the italic typography
      IS the signature. Wordmarks were retired in fix.9

## Coach BETA tab `[web]` — Phase 4r.coach.v2.surface

- [ ] Web nav shows a `Coach` tab between EdgeIQ and Daily with a
      small cyan `BETA` chip next to the label
- [ ] Tapping `Coach` renders the beta surface without errors
- [ ] Header band shows: BETA chip, "Coach" title, today's date,
      one-paragraph explainer, and a right-side counts column
      (act / watch / aligned / fb total)
- [ ] Each brief renders as a block: state badge (icon + label) on
      the left, pillar tags + pattern id on the right, headline
      (acknowledge in 15px bold), mechanism paragraph, dashed
      separator, → next action, evidence chips below
- [ ] State badges color-coded: red `!` for ACT, amber `⚠` for WATCH,
      green `✓` for ALIGNED
- [ ] Evidence chips are monospace `key=value` pairs in subtle gray
      pills — never empty array (engine guarantees at least one)
- [ ] Per-brief feedback bar: 👍 / 👎 buttons; clicking lights up
      the active one in semantic color
- [ ] **Always-visible comment field** sits below the feedback bar
      (Phase 4r.coach.v2.surface.feedback) — single-row textarea +
      Send button, no click required to reveal. Send disabled when
      empty; Cmd/Ctrl+Enter sends from the textarea
- [ ] Submitting any feedback (👍, 👎, or comment-only) adds to
      local storage under `coachFeedback`; the `fb total` counter in
      the header increments within ~2 seconds
- [ ] When a brief already has feedback recorded with a comment, the
      "Feedback recorded · note: ..." line shows the first 60 chars
      of the most recent comment so you can see what's on file
- [ ] After sending a comment, the Send button briefly reads "Sent ✓"
      then resets to "Send"; the textarea clears
- [ ] When no briefs fire (engine returned empty), an empty-state
      block renders with `window.coachBriefsDebug()` hint, not a
      blank page
- [ ] EdgeIQ tab is unchanged by Coach BETA shipping — the production
      surface is frozen during the evaluation period
- [ ] Mobile nav does NOT include Coach (web-only for this phase;
      mobile lands once the voice is calibrated)
- [ ] No console errors on tab switch into/out of Coach

## Coach v2.5 HYROX patterns — Phase 4r.coach.v2.hyrox

Run when a HYROX race is in storage (verify via Plan → Races) and
within 28 days.

- [ ] `window.coachBriefsDebug()` shows at least one brief whose id
      begins with `hyrox-` when a HYROX race is upcoming
- [ ] `patternRaceSequencing` does NOT fire for HYROX (gated). For
      non-HYROX races (e.g. a generic running event) the generic
      pattern still fires as before
- [ ] **patternHyroxStationCoverage**: fires only when ≥1 of the 4
      modality buckets (running, erg, strength, metcon) has gaps in
      the last 14d AND race is in 1-21d window. Brief calls out
      missing modalities by name
- [ ] **patternHyroxStrengthReadiness**: fires as `aligned` when ≥2
      strength sessions/wk over last 14d (positive recognition), or
      `act/watch` when <1/wk with race ≤21d
- [ ] **patternHyroxGlycogenWindow**: fires only in 0-7d race window.
      Copy varies by days out (race today / race tomorrow / 2-3d /
      4-7d). Mentions specific carb target (6-8 g/kg BW)
- [ ] **patternHyroxPacingPrep**: fires in 4-21d window when <2
      hard sessions detected in last 14d. Recommends one race-pace
      simulation 4-5 days before race
- [ ] No console errors from any HYROX pattern on fresh boot
- [ ] When upcoming race exists but is not HYROX, no HYROX patterns
      fire (verify by inspecting brief ids — none should start with
      `hyrox-`)

## Coach Engine v2 briefs (engine only) — Phase 4r.coach.v2.engine

Run after any change to `src/core/coachBriefs.js`.

- [ ] `window.coachBriefsDebug()` returns an array of brief objects
      (could be 0–5) and prints each with its three parts in console
- [ ] Each brief has all required fields: `id`, `priority`, `state`,
      `acknowledge`, `mechanism`, `nextAction`, `evidence`,
      `confidence`. No missing or undefined values
- [ ] `state` is always one of `act` / `watch` / `aligned` — never any
      other string
- [ ] Briefs are ranked: any `act` brief comes before any `watch`
      brief, which comes before any `aligned` brief. Within the same
      state, lower `priority` number comes first
- [ ] When the user has no concerning signals, the `aligned-baseline`
      brief fires as a fallback so the list is never empty
- [ ] `acknowledge` lines contain real numbers from the user's data
      (e.g. "6.4h" not "X hours"); they're personalised, not generic
- [ ] `nextAction` lines contain a timeline ("tonight", "in 7 days",
      "before Day N") — not vague
- [ ] No brief throws when run against thin data (e.g. user with no
      sleep history). Patterns that can't compute return null silently;
      composer logs `[coachBriefs:patternName] failed:` if any do throw
- [ ] No console errors mentioning `coachBriefs` on fresh boot

## Coach Engine v1 signals — Phase 4r.coach.v1

Run after any change to `src/core/coachSignals.js` or any change to
`computeUserState`'s coachSignals attachment.

- [ ] `window.coachSignalsDebug()` in console returns an object with six
      keys: `sleepDebt`, `hrvDepression`, `rhrDrift`, `energyAvailability`,
      `monotonyStrain`, `sleepHrvCorrelation`. Console also shows a
      formatted table of one-line status summaries
- [ ] `window.intelligenceDebug()` includes a `COACH SIGNALS (v1)`
      section in its output with all six signals printed
- [ ] Each signal has a `status` field that is one of the documented
      enums (see COACH.md). For users with thin data, the status should
      be `insufficient-data` rather than throwing or returning null
- [ ] `sleepDebt`: `debt7d` is non-negative, `nightsBelow7d` is 0–7,
      `avgHours7d` is finite. With no sleep data, returns
      `{ ..., n7d: 0, status: 'paid' }` (paid = zero debt = trivially true)
- [ ] `hrvDepression`: when n < 5, returns `status: 'insufficient-data'`.
      Otherwise `latest`, `baseline28d`, `depressionPct`,
      `consecutiveDepressedDays` are all finite numbers
- [ ] `rhrDrift`: when n < 7, returns `status: 'insufficient-data'`.
      Otherwise `slopeBpmPerWeek` is finite (positive = rising, negative
      = improving)
- [ ] `energyAvailability`: requires `lbmLbs` from body comp. With no
      body comp data, returns `status: 'insufficient-data'`. Otherwise
      `eaKcalPerKgLBM` is finite
- [ ] `monotonyStrain`: `dailyLoad` is an array of 7 numbers (kcal per day
      across the last week). `monotony` is finite, `strain` is finite
- [ ] `sleepHrvCorrelation`: `surfaceable` is `true` only when `n ≥ 30`
      AND `|r| ≥ 0.3`. For most users in early data collection,
      `status: 'building-baseline'` is expected
- [ ] No console errors mentioning `computeCoachSignals` on fresh boot

## Goals v1→v2 migration — Phase 4r.dataspine.7

- [ ] On fresh boot of any user, check console for
      `[arnold-migrate] goals v1→v2 applied` log. Should appear ONCE
      per user (idempotent — second boot shouldn't re-log it).
- [ ] After migration, `window.storage?.get('goals')?.schemaVersion`
      should equal `2`
- [ ] `storage.get('goals')` should contain BOTH v2 nested structures
      (`body`, `recovery`, `performance`, `races`) AND legacy v1 flat
      fields (`targetWeight`, `dailyCalorieTarget`) during compat
      window — v1 fields deletion deferred to a follow-up phase
- [ ] If user had a manual `dailyCalorieTarget` or `dailyProteinTarget`
      in v1, the migration converts to an override. Check
      `window.goalModelDebug()?.overrides` shows `dailyCalories` /
      `dailyProtein` with the original value
- [ ] `getOutcomeGoal()` reads v2 first (`goals.body.weight.targetLbs`)
      with v1 fallback. Verify by manually setting only the v2 field
      in storage and confirming `getOutcomeGoal().targetWeightLbs`
      returns it

## Macro pipeline — Phase 4r.dataspine.4 consolidation

Run this section after any change to `goalModel.js`, `energyBalance.js`,
or any UI surface that displays a calorie / protein / carbs / fat /
fiber target.

- [ ] `window.goalModelDebug()` returns five `daily*` blocks:
      `dailyCalories`, `dailyProtein`, `dailyCarbs`, `dailyFat`,
      `dailyFiber`. Each has `effective`, `derived`, `override`,
      `source`, `explain` fields. If `dailyCarbs` etc. are missing,
      the macro derivation broke.
- [ ] The MobileHome **Today's Target** tile shows the same
      `protein / carbs / fat / fiber` numbers as the web EdgeIQ
      **TodaysTargetLine** for the same date. If they diverge,
      one surface is still reading the legacy
      `getDynamicMacroTarget` path (which now throws).
- [ ] Calendar drawer macro readouts (protein bars, carb / fat
      pills) match the same target numbers as the Nutrition tab
      goal column for the same date.
- [ ] **Deprecation guard:** in console, run
      `import('./core/calorieTarget.js').then(m => m.resolveCalorieTarget())`
      — should throw `[calorieTarget.js DEPRECATED — Phase
      4r.dataspine.4]`. Same for `getDynamicCalorieTarget()` and
      `getDynamicMacroTarget()` on energyBalance.js. If any of
      these silently returns a number, a legacy export got
      restored somewhere.
- [ ] No console errors mentioning `getDynamicMacroTarget` or
      `resolveCalorieTarget` on a fresh boot. If you see one,
      a UI consumer still imports the deprecated symbol.

## After any change to shared code, also verify:

- [ ] mobile.css changes → run full Calendar mobile section above
- [ ] intelligence.js / goalModel.js changes → EdgeIQ web + Daily web +
      run `window.intelligenceDebug()` and `window.goalModelDebug()`,
      confirm `state` matches expected
- [ ] coachingPrompts.js / insights.js changes → EdgeIQ action grid
      cards render with the new prompt/insight visible if conditions
      should fire
- [ ] energyBalance.js changes → `window.energyBalanceDebug()` in console
      returns the new TDEE / RMR / calibration values
- [ ] storage.js / migration changes → check `[arnold-state]` storage
      counts on next boot match prior counts (no data loss)
- [ ] swipe-related changes (Arnold.jsx mobileSwipe, MobileHome.jsx,
      CalendarTab.jsx swipeHandlers) → run full Calendar mobile swipe
      checks + MobileHome swipe checks

---

## Adding new checks

When a bug ships to a user that smoke tests didn't catch:
1. Add an entry to `POSTMORTEMS.md` describing the bug + cause.
2. Add a check here to the relevant surface so the next regression
   trips before reaching the user.

The doc earns its keep by growing every time we miss something.
