# SESSION_AGILITY_DESIGN.md — micro + macro adaptability (2026-07-13)

> **Origin (Emil, 2026-07-13).** "I need to swap today's intervals for mobility to let my
> knee recover — and I don't have that option. Swap should be the FIRST option, especially
> early in the week; as the week fills, options shrink and the impact grows, and the coach
> should flag that. 'Hit the pool' isn't universal — the coach should ASK what I have (I've
> got a Peloton + a gym, no pool). I should be able to DRAG a workout onto another day to
> swap, and a pop-up tells me what the swap means for my week / plan / goal. This agility at
> the micro and macro level, with the coach lock-step, is what I need."

> This is the flagship differentiator: **adaptability is the coach's value** (DESIGN_LESSONS
> #6, ROADMAP §B item 4). Sibling of `COACH_NARRATIVE_DESIGN.md` — the impact pop-up *is* the
> narrative engine evaluating a proposed swap. Mock-first; the engine ladder is demonstrated
> (see §6). Not yet wired.

---

## 1. The three gaps in what exists (`sessionAdapt.js`)

`buildSessionOptions()` already returns a ranked substitution ladder, but:

1. **The swap is SUPPRESSED exactly when you need it.** "Move it" (reschedule) is offered only
   `if (!aggravated)` — so an injury-aggravated session (knee → intervals) *removes* the swap,
   on the theory "moving it doesn't fix a joint." Wrong: often the right call is to rest the
   joint today (mobility) and reslot the session. That's the missing option Emil hit.
2. **It assumes equipment.** "Take it to the pool" / "bike it" are offered unconditionally —
   no check the athlete owns a pool or bike. **There is no modality profile.**
3. **No week-awareness / time-decay.** The swap is generic ("swap an easy or rest slot") — it
   doesn't know which days are free, that early-week has room, or that late-week the runway
   shrinks and the cost rises.

Plus the **interaction** doesn't exist: no drag-to-swap, no impact pop-up.

---

## 2. Equipment / modality profile (NEW — the gate for everything)

A user setting: what you can actually train on.
`modalities: { pool, bike (Peloton/stationary), treadmill, gym (weights), elliptical, rower }`.

- Set in onboarding + Profile/Settings; editable anytime.
- **EVERY** cross-train substitution is gated by it — never offer a modality the user lacks.
- **Ask when unknown.** The first time the coach wants to offer a swap and the profile is
  empty, it ASKS: *"What do you have access to — pool · bike/Peloton · gym · treadmill? I'll
  tailor these to what you can actually do."* (One-time, then remembered — feeds `coachMemory`.)
- Modalities carry **injury-safety** tags (knee-safe: bike/pool/elliptical/rower/upper-body
  gym/mobility; knee-aggravating: running impact, heavy leg strength) so injury filtering is
  automatic.

---

## 3. Swap-first ladder (extend `buildSessionOptions` → v2)

Ranked, least-compromise first, **swap leads** (especially early week):

1. **SWAP (first-class, ALWAYS available)** — rest/mobility today, move the session to a free
   day this week. Offered even under injury (resting the joint is the point). Targets = the
   week's remaining *swappable* days; validity-checked (don't stack two hard days, don't drop
   a hard session the day before the long run).
2. **MODALITY SUBSTITUTE — gated by the profile + injury-safety.** Bike the intervals (if bike),
   pool-run (if pool), upper-body + core (if gym) — only what you HAVE and what's safe.
3. **REDUCE / HOLD** — fewer reps at pace, shorten easy, etc. (the existing intent-preserving moves).
4. **SKIP** — framed as the one real setback.

Injury-aggravated sessions get BOTH the rest-swap (#1) and the impact-free substitutes (#2),
never the "keep pounding" options.

---

## 4. Time-decay + impact flag (the macro half)

The swap-target set = remaining swappable days this week. The coach flags the shrinking runway
and rising cost:

- **Early week** (2+ open days): "It's Wed — Thu & Sat are open, so swapping costs you nothing."
- **Mid/late** (1 open): "Only Fri left before the weekend — swap now or it competes with the long run."
- **Full** (0 open): "No open days left — a swap now trades against another session; the cost is real."

This is the micro→macro bridge: a today-swap is evaluated against the *week* and the *goal*.

---

## 5. Drag-to-swap + the impact pop-up (the interaction)

The calendar ALREADY has tile drag-and-drop (moves sessions between days). Extend it:

- **Drag a session onto another day → SWAP** (exchange the two days' sessions), if the swap is
  *available* for that day/week (the validity check in §3). Invalid targets don't accept the drop.
- **On drop, an IMPACT pop-up** — this is the **coach narrative engine run on the PROPOSED
  state** (a what-if re-solve, `weekResolve` on a hypothetical): it shows what the swap means
  for the **week** (volume, session spacing, ACWR), the **plan** (does it protect the block or
  stack hard days), and the **goal** (Valencia). Then Confirm / Cancel. Example:
  > "Moving Wed intervals → Thu puts them the day before Saturday's long run — two hard days
  > back-to-back. Weekly volume's unchanged and the VO₂ block is kept, but you'd start the long
  > run tired. Swap into Friday (rest) instead? · Confirm · Cancel"
- The pop-up never blocks — it *informs* and the athlete decides (conflict philosophy).

---

## 6. Demonstrated (his case — knee, intervals Wed, has Peloton + gym, no pool)

```
  [1] Swap → mobility today, move intervals to Thu   (2 open days left — plenty of room)
  [2] Bike the intervals (Peloton)                   (VO₂ stimulus, impact-free)
  [3] Upper-body + core at the gym                   (a stimulus, spares the knee)
  [9] Skip it                                         (the one option that sets the block back)
  COACH FLAG: It's Wed — Thu & Sat to reslot, so swapping costs you nothing.
  IF UNKNOWN: "What do you have access to? I'll tailor these."
```

Pool is absent (not owned); swap leads; knee is protected. Exactly the ask.

---

## 7. Build phases (mock-first)

- **A — Equipment profile** (`core/modalities.js` + a Profile setting + the ask-when-unknown
  hook). Small, unblocks everything.
- **B — `buildSessionOptions` v2** — swap-first, equipment-gated, injury-rest option, week
  time-decay. Extends the tested `sessionAdapt.js` (update `sessionAdapt.test.js`).
- **C — `weekResolve` / what-if** — evaluate a proposed swap's week + goal impact (the pop-up's
  brain; also powers the `gWeekDrift` re-flow from the missed-session work).
- **D — Drag-to-swap + impact modal** in `CalendarTab` (drag infra exists; add swap semantics +
  the validity check + the modal that renders the what-if narrative).
- **E — Coach surfacing** — a `gSwapOffer` beat proactively offers the swap when a session is
  at-risk (injury flagged / user taps "can't do it"), on Start/Play/Calendar.

Backlog: **#62 equipment/modality profile + ask**, **#63 drag-to-swap + impact pop-up**,
sessionAdapt v2 (swap-first, gated) — all under the flagship live-re-solve umbrella (#55).
