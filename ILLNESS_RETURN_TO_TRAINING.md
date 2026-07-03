# Illness & Return-to-Training mode — design note / backlog

**Status:** Backlog (design note). Created 2026-06-27. Origin: Emil's real illness, June 2026.
**Strategic fit:** core "coach, not scorekeeper." Most platforms get this wrong; handling it
well is differentiating. Candidate for Sprint 2+ or the adaptive-loop track.

## The problem (the scorekeeper failure mode)
When the athlete is ill, training stops and the objective signals fall. Arnold's CURRENT
logic reads that as **detraining / undertraining**: ACWR drops, weekly miles land under
target, so the season coach nudges to *add volume and rebuild*. That is exactly the wrong
message to a body fighting an infection — Arnold would effectively nag a sick person to
train more. It must instead recognise illness and switch modes.

## Motivating case study (Emil, June 2026)
- ~1 month of **declining / poor sleep** beforehand (chronic sleep debt → lowered immune resilience).
- An **all-out 10K in cold, windy conditions** — a maximal acute stressor + likely exposure.
- **Symptom onset ~5 days later** (race ~Fri/Sat → symptoms the following Wednesday). Lagged, not immediate.
- Still feels "destroyed" the next Saturday: **extreme fatigue, beaten-down, NO fever.**
This single example carries most of the design requirements: chronic sleep debt as a
*predisposer*, a harsh maximal effort as a *trigger*, **delayed onset**, a **fever-less**
presentation, and a **slow recovery** that compounds with pre-existing fatigue.

## Detection — two doors (subjective leads, objective confirms)
1. **Manual flag (primary).** A one-tap "I'm unwell / recovering" state. Subjective illness
   often *precedes* any metric change — you can feel wrecked before RHR moves, or feel
   awful on a normal-looking morning read. The user must be able to just tell Arnold.
2. **Auto-signature (assist).** Trip a suggestion when the personal baselines move together:
   acute **RHR ↑** (several bpm over baseline), **HRV ↓**, **Body Battery ↓**, disrupted
   **sleep**, and — if Garmin provides them — elevated **respiration rate / skin temp**,
   sustained ≥ ~1 day. Arnold already holds these baselines (the RHR/HRV tiles compare to
   personal norms), so this is mostly wiring, not new sensing.
- **Be humble when ambiguous.** If signals are mixed, Arnold should *ask* ("Your RHR is up
  and HRV is down — feeling unwell, or just a hard week?") rather than confidently
  mis-prescribe. Never assert detraining over a possible illness.

## Leading risk (before illness) + lag reasoning
- **Predisposition flag:** chronic sleep debt + a recent maximal effort in harsh conditions
  = elevated illness/over-reach risk. Arnold could surface "immune load is high — protect
  recovery" *before* a crash.
- **Lag handling:** explicitly connect a hard effort + poor recovery context to a crash that
  appears days later. Do NOT read the resulting low metrics as "detraining" — attribute
  them to the likely post-viral / overreach cause.

## Coach-response changes WHILE the state is active
- **Mute** the add-volume / under-goal / calorie-deficit / "behind on miles" nags entirely.
- **Reframe rest as the work** — reassure that the training gap is expected and correct.
- **No add-load prescriptions.** The plan pauses; missed sessions are not "debt."

## Return-to-training (graded, reason shown)
- After symptoms resolve, prescribe a **deliberately easy graded return** — e.g. a short
  Z1/Z2 outing first, then build — NOT "you're N miles behind, catch up."
- General (non-medical) framing only — e.g. the common "symptoms above the neck vs below
  the neck / fatigue" caution to gate return. **Not medical advice.**
- **Don't guilt-trip** the gap. Frame the first session back as a win, not a deficit.
- Define a "recovered" exit: baselines back near norm for a few days AND the user confirms.

## Integration points
- Season coach / ACWR logic (`seasonPlan`, `planLoad`, `coachSignals`) — suppress add-volume
  branches when the state is active.
- Hub readiness / recovery signals — feed the auto-signature.
- A new persisted **state flag** (manual + auto-suggested) and a coach-voice branch.

## Wellbeing guardrails
- Arnold is not a doctor. Never push through illness; encourage rest. If symptoms are
  severe, or fatigue is prolonged / worsening, suggest the user consult a professional —
  without alarmism, and without diagnosing.

## Open questions
- RHR/HRV deviation thresholds + sustain window for the auto-signature.
- Return-ramp shape and duration (illness severity-dependent?).
- How to detect "recovered" reliably vs a dead-cat-bounce day.
- Should the predisposition (immune-load) flag ship first as a smaller, lower-risk piece?
