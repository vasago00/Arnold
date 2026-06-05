# Arnold — local-LLM narrative test kit

Purpose: test whether a small local model can be Arnold's "one voice" narrator —
turning structured daily data into a warm, honest coach note **without inventing
or mangling numbers**. Run the SAME prompt across each model (Qwen 3 8B, Phi-4-mini
3.8B, Gemma 3 4B) and compare. Faithfulness matters more than flair.

How to use in LM Studio:
1. Paste the **SYSTEM PROMPT** into LM Studio's "System Prompt" field.
2. Paste the **USER MESSAGE** into the chat box and send.
3. Score the output against the **PASS/FAIL checklist**.
4. Repeat for each model. (Optional: set Temperature ~0.4 for less drift.)

---

## SYSTEM PROMPT (paste into the system field)

You are the single voice of Arnold, a personal running & fitness coaching team
(a run coach, strength coach, and nutritionist speaking as ONE warm, expert voice)
talking to the athlete, Emil.

You will be given today's data as JSON. Write ONE short coach note (≤ 90 words),
in a warm, encouraging, honest tone — never alarmist, never clinical.

Hard rules:
- Use ONLY the facts and numbers in the JSON. Do NOT invent any metric, number,
  pace, advice, or comparison that is not present in the data.
- Every number you mention must match the JSON EXACTLY.
- If a field says data is missing or uncertain (e.g. "no lap data", "prior_similar": 0),
  acknowledge it honestly — do not fabricate a comparison or a target.
- Only reference a confounder if it is listed in "confounders_detected".
- No medical claims or diagnoses.
- End with ONE forward-looking line about tomorrow, using "plan_tomorrow".

After the note, output a line exactly like:
NUMBERS USED: <comma-separated list of every number you stated>

---

## USER MESSAGE (paste into the chat)

Here is today's data. Write today's coach note.

```json
{
  "date": "Wednesday, June 3",
  "athlete": "Emil",
  "readiness": { "today": 85, "rolling_7d": 87, "rolling_30d": 85, "trend": "steady" },
  "load": {
    "acwr": 0.43, "acwr_zone": "under-training",
    "rtss_today": 171, "rtss_zone": "overreaching",
    "weekly_load": 420, "chronic_avg": 380
  },
  "session": {
    "type": "HYROX (hybrid)", "duration_min": 94, "avg_hr": 159,
    "density": "1.3 reps/min", "work_rest": "no lap data",
    "effort": "92% of max HR — Tempo", "calories": 1491,
    "prior_similar": 0
  },
  "nutrition": {
    "calories_left": 380, "calorie_target": 2600,
    "protein_left_g": 40, "protein_target_g": 165, "glycogen": "moderate"
  },
  "body": {
    "hrv_ms": 38, "hrv_state": "borderline",
    "sleep_hours": 6.2, "sleep_score": 71,
    "weight_lb": 171.2, "target_weight_lb": 168
  },
  "plan_tomorrow": "Mobility",
  "confounders_detected": ["sleep debt: 6.2h last night, below your ~7.5h baseline"]
}
```

---

## PASS / FAIL checklist (score each model)

Faithfulness (the important half):
- [ ] Every number it states matches the JSON exactly (171, 0.43, 159, 6.2, 38, etc.).
      Any changed/rounded/invented number = FAIL.
- [ ] It does NOT invent advice, paces, or targets that aren't in the data.
- [ ] It handles "prior_similar": 0 honestly (e.g. "first HYROX — no baseline yet"),
      NOT by inventing a comparison.
- [ ] It only mentions the sleep-debt confounder (the one that's listed), nothing else.
- [ ] The "NUMBERS USED:" line actually matches what it wrote (a cheap groundedness check).

Quality (the nice half):
- [ ] Warm and human, not robotic; honest about the overreaching rTSS without alarm.
- [ ] Stays ≤ ~90 words, one paragraph.
- [ ] Ends with a tomorrow/Mobility line.

Interpreting results:
- Faithful + warm → this approach works; pick the smallest model that still passes.
- Fluent but invents/changes numbers → DON'T let it touch numbers; inject all numbers
  as fixed literals and let it write only the connective prose (or use a bigger model).
- Robotic but faithful → fixable with prompt/tone tuning; faithfulness is the hard part.

---

## Variation 2 — the "don't fabricate" stress test

Re-run with this minimal payload (lots missing). A good model says what it can and
flags the gaps; a weak one invents. Same system prompt.

```json
{
  "date": "Thursday, June 4",
  "athlete": "Emil",
  "readiness": { "today": null, "rolling_7d": 87, "rolling_30d": 85, "trend": "steady" },
  "session": { "type": "rest", "prior_similar": null },
  "body": { "hrv_ms": null, "sleep_hours": 7.9, "sleep_score": 88 },
  "plan_tomorrow": "Easy run",
  "confounders_detected": []
}
```

Pass: it leans on sleep (7.9h / 88) + the 87/85 readings, calls it a rest day, and does
NOT invent today's readiness, an HRV value, or a session that didn't happen.
