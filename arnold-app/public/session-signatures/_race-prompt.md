# Race signature — Gemini generation prompt

Drop the generated PNG into `public/session-signatures/race.png` (overwrites
the existing one). `SIG_VERSION` is already bumped to v10 in code so the
WebView will fetch the new image on next reload.

## Prompt (paste into Gemini Imagen)

> Stylized low-poly digital illustration of a single runner mid-stride at
> the exact moment they break a finish-line tape. The runner is shown in
> dynamic three-quarter view, chest tilted forward, front arm driving
> through the tape while the back arm pumps behind. Visible determination
> in the face. The runner figure is rendered in faceted, geometric
> low-poly style with sharp triangular planes, painted in a monochromatic
> crimson-red palette (deep #b91c1c shadows → hot #ef4444 mid-tones →
> bright #fb7185 highlights), the same visual language as a series of
> companion sport illustrations. The white finish-line tape stretches
> horizontally across the runner's chest and is mid-snap — visibly torn
> at the runner's center with frayed white fragments flying outward.
> Behind and around the runner (NOT in front of), red shards and energy
> sparks radiate outward in a motion-burst starburst pattern, like
> impact lines from a comic-book finish — clearly trailing/around the
> runner, conveying speed and triumph, never blocking the figure. A
> subtle warm-red aura backs the figure. Two or three faint horizontal
> motion-streak lines trail behind the runner indicating speed. Pure
> transparent PNG background — no scenery, no track, no crowd, no
> ground, just the figure and the burst floating in transparency.
> Square 1024×1024. Crisp edges, no soft glow halo around the figure
> boundary. Style should match a low-poly geometric athlete portrait
> series — similar visual treatment to a "speed runner," "tempo runner,"
> "alpine skier," and "strength lifter" rendered in matching low-poly
> style for the same brand.

## Notes on what to avoid

- The shards should NOT appear in front of the runner like a window
  shattering toward the camera — that's the failure mode of the
  previous render which made it look like the runner was bursting
  through red glass.
- The tape must be clearly white/light, mid-snap, with visible torn
  fragments. A solid uninterrupted ribbon won't read as "breaking the
  tape."
- The figure should sit anchored to the bottom-center of the canvas
  with the burst radiating from the runner's torso outward — no large
  empty space at bottom.
- No background — pure transparency. Any colored backdrop will need
  the chroma-keying tools in `_alpha_cleaner.html` to strip out.

## Post-generation checklist

1. Right-click in Gemini → Download
2. If the file has a fake-transparent backdrop (checkerboard rendered
   as fill instead of true alpha), run it through
   `public/session-signatures/_alpha_cleaner.html` v3.3+ (chroma-key
   mode) the same way you cleaned the other signatures
3. Drop into `public/session-signatures/race.png` (overwrite)
4. Hard-reload Arnold — the v10 cache-bust will pull the fresh image
