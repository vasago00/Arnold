# New sport signatures — Gemini prompts (v3, precise style-match)

Goal: generate **cycling, swim, walk/hike** so they are indistinguishable in
style from the existing series (`speed.png`, `ski.png`, `strength.png`, etc.).
Ski's `ski.png` already exists.

## STEP 0 — attach references (do this every time)

Attach these three PNGs to the Gemini prompt and say "match the exact art style
of these images":
- `public/session-signatures/speed.png`   (cyan runner, shard trail)
- `public/session-signatures/ski.png`      (ice-blue skier + skis/poles)
- `public/session-signatures/strength.png` (purple lifter + barbell)

Then paste the STYLE SPEC + the one sport block you're generating.

---

## STYLE SPEC  (paste this with every sport — identical for all three)

> A single athlete and their equipment rendered as FLAT geometric low-poly art:
> the entire figure is built from clearly visible flat triangular / polygonal
> facets, each facet filled with ONE solid flat color and hard straight edges
> between facets. NO smooth gradients inside facets, NO soft / painterly /
> airbrushed shading, NO photorealistic rendering.
> FACELESS — the head is a plain low-poly shape with NO facial features: no eyes,
> no nose, no mouth. A low-poly helmet, goggles, or cap is allowed as a simple
> shape, but never a rendered face.
> Monochromatic — 3 to 5 flat tones of a SINGLE hue (dark shadow facets → mid
> facets → light highlight facets), plus a few near-white facets on the brightest
> edges. No second color anywhere on the figure.
> NO outline — facets meet directly; there is NO black or dark stroke drawn
> around the figure silhouette.
> TRAILING-EDGE DISSOLVE — the back / trailing edge of the figure breaks apart
> into many small FLAT TRIANGULAR shards that scatter and disperse off that side,
> getting smaller and sparser with distance, in the same hue tones — the exact
> "speed-dissolve" shard trail seen in the attached runner and skier. This is NOT
> flames, NOT fire, NOT a radial spark starburst from the chest.
> BACKGROUND — 100% pure transparency. NO background fill, NO white, NO color
> wash, NO glow, NO aura, NO halo, NO scenery, NO ground or drop shadow.
> Dynamic three-quarter action pose, figure anchored and filling most of the
> frame. Square 1024×1024, crisp clean edges.

---

## SPORT BLOCKS  (paste ONE, after the STYLE SPEC)

### Cycling → `cycle.png`  · GOLD/YELLOW
> Subject: a road cyclist in an aggressive aero tuck, mid-pedal-stroke,
> three-quarter side view, torso low over the drop handlebars, riding a road bike
> that is rendered in the same flat low-poly facets (bike clearly present but
> secondary to the rider). Low-poly aero helmet, faceless. Hue = gold/yellow:
> #a16207 shadow facets → #eab308 mid facets → #facc15 highlight facets, a few
> near-white brightest facets. The triangular shard trail disperses off the
> rider's back and the rear wheel.

### Swim → `swim.png`  · AQUA-CYAN
> Subject: a freestyle swimmer mid-stroke, three-quarter view, one arm extended
> forward in the catch while the other finishes its underwater pull, head rotated
> to the side mid-breath (face turned away, no facial features). Faceless. Hue =
> aqua-cyan: #0e7490 shadow facets → #06b6d4 mid facets → #67e8f9 highlight
> facets, a few near-white brightest facets. The triangular shard trail disperses
> off the rear arm and the feet like a wake.

### Walk / Hike → `walk.png`  · OLIVE-GREEN
> Subject: a hiker / power-walker mid-stride, three-quarter view, strong forward
> lean, lead leg striding forward heel-first while the rear leg pushes off, arms
> swinging, a single trekking pole planted ahead. Low-poly cap or plain head,
> faceless. Hue = olive-green: #3f6212 shadow facets → #65a30d mid facets →
> #a3e635 highlight facets, a few near-white brightest facets. The triangular
> shard trail disperses off the rear leg and the swinging arm.

---

## AVOID (the failure modes seen so far)

- ❌ A rendered human FACE / eyes (the v1 cycling render had one — the series is faceless)
- ❌ White or any colored background fill
- ❌ Soft radial glow / aura / halo behind the figure
- ❌ Flames, fire, or a spark starburst from the chest
- ❌ Painterly / smooth-gradient / realistic shading
- ❌ A black outline around the figure
- ✅ Flat hard-edged facets, faceless, single hue, trailing triangular-shard dissolve, full transparency

## POST-GEN CHECKLIST (each figure)

1. Download from Gemini.
2. If a non-transparent backdrop is baked in, run it through
   `public/session-signatures/_alpha_cleaner.html` (chroma-key mode).
3. Drop into `public/session-signatures/cycle.png` / `swim.png` / `walk.png`.
4. Bump `SIG_VERSION` in `PlannedWorkoutTile.jsx` so the WebView refetches.
