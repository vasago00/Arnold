# Coach Sigil — Gemini generation prompt

Goal: a single-mark monogram/sigil that becomes the visual signature of "the Coach" voice across Arnold — EdgeIQ summary line, Coach tab header, mobile CoachLine, brief blocks. Once chosen, the mark replaces every textual "Coach" label so the identity carries the recognition.

---

## Prompt to paste into Gemini

Design a logo mark — a single sigil or monogram — for "the Coach," the intelligence layer of an app called **Arnold**. Arnold is a precision performance app for serious endurance athletes (runners, HYROX competitors). Its visual language is an **F1 cockpit / flight instrument panel**: dark surfaces, monoline geometric icons, sans-serif data, subtle teal and amber accents. Numbers, gauges, and chips everywhere.

The Coach is the **human voice within that cockpit**. It reads many signals (sleep, HRV, recovery, training load, nutrition, race horizon, goal progress), distills them into one observation, and recommends one action. It is an advisor, not an alarm. It speaks in serif italic prose, like a letter from a master coach — distinct from every other surface in the app, which speaks in sans-serif data.

The mark I need is the Coach's **personal signature**: it appears wherever the Coach speaks, and the typography and frame already do the work of saying "this is a message from the Coach." The mark itself just needs to be **unmistakable, sophisticated, and memorable** — a stamp.

### Hard requirements

- **Single-color vector**, deliverable as SVG. Designed in solid teal-cyan (hex `#5eead4`) on a near-black canvas (`#0a0d12`).
- **Renders cleanly at 22 × 22 pixels** (it will live inside a 22 px circle in the UI). Must also scale up to 200 px without losing identity. **No tiny detail that vanishes at small size.**
- **Maximum 3 visual elements or strokes.** Simplicity is non-negotiable.
- **No gradients, shadows, glows, or multi-color treatments** in the source vector. Flat.
- Square aspect ratio. Centered. Roughly 80% of the canvas filled.

### Tone & character

- Sophisticated. Considered. Restrained.
- Reads as a **personal mark** — the signature of a master craftsman or master coach, embossed on a private notebook — not a generic app icon.
- Could plausibly appear on the cover of a serious athlete's leather-bound training journal.
- Pairs with **serif italic body text** (Georgia / Cormorant Garamond), so the mark itself can either be (a) geometric monoline with a quiet authority, or (b) calligraphic / serif italic in character. Either works as long as it sits comfortably alongside italic prose.

### Conceptual anchors — pick ONE direction, not all

1. **The lens / iris / focal point.** The Coach focuses attention on the one thing that matters today. A small dot inside a thin geometric frame; a reticle without crosshairs; an aperture.
2. **Synthesis / summation.** Many signals condensing into one observation. A glyph that suggests convergence — a funnel, a sigma-like form, a knot, a confluence.
3. **The seal / signatory mark.** An old-world apothecary's mark, a master craftsman's monogram, a notary's stamp. Could incorporate a stylized letter (e.g. a serif italic lowercase "a" or "c") with a single distinguishing flourish — a dot, an underline, a circumflex, a small bar.
4. **The wave / pattern-read.** A single elegant line that suggests heartbeat, signal, or pattern recognition. Not a literal EKG — something more abstract: a tilde-curve, a half-wave, an arc with a punctuation point.
5. **Original geometric construction.** No obvious referent — just a memorable, considered form (think Bauhaus marks, vintage Swiss design). Two or three intersecting shapes that feel "designed" without being decorative.

### Visual register references (do NOT copy — use as register guide)

- The Hermès "H" monogram (sophistication, restraint)
- The Tag Heuer crown (precision, instrument)
- The McLaren speedmark (athletic, mechanical)
- The IBM 8-bar logo (geometric, monoline)
- The Cooper Hewitt mark (modern, considered)
- Vintage Penguin Classics colophon (signatory, literary)
- Old-world apothecary seals (personal stamp)

### Hard exclusions — do NOT use any of these

- Coach-cliché iconography: whistles, stopwatches, clipboards, dumbbells, athletes running, finish-line flags
- Brain icons, lightbulb icons, AI/robot iconography
- Speech bubbles, megaphones, quotation marks as the dominant element
- Emoji, cartoon, or playful flavor
- More than one letter (if a letter appears at all — a single letter is fine, two is not)
- Decorative ornament, fleurons, wings, halos, or laurels
- Gradients, drop shadows, glows, multi-color

### Deliverable

Produce **6 distinct variations** as a contact sheet. Each variation should explore a different concept from the list above (or a hybrid). Below each mark, include a single-sentence rationale describing the intended reading.

Render each variation at two sizes side by side: 200 × 200 px and 22 × 22 px, so I can evaluate small-size legibility.

---

## After Gemini returns

1. Pick the strongest mark (small-size legibility is the gate — if it dies at 22 px, it's wrong).
2. Export as SVG (single path / minimal nodes).
3. Drop into `arnold-app/src/assets/coach-sigil.svg` (we'll create the folder if needed).
4. I'll replace the temporary "A°" placeholder on EdgeIQ + propagate to Coach tab header + mobile CoachLine.
