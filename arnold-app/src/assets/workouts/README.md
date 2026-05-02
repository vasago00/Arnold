# Workout category icons

The app renders **Phosphor Icons (duotone weight)** for each workout category by
default — wired in `MobileHome.jsx`. The mapping lives in `ICON_CMP`:

| iconType   | Phosphor component   | Accent color  |
|------------|----------------------|---------------|
| `run`      | PersonSimpleRun      | blue `#6babdf` |
| `strength` | Barbell              | purple `#ab9ed4` |
| `bolt`     | Lightning            | amber `#e0b45e` |
| `bike`     | Bicycle              | green `#6bcf9a` |
| `stretch`  | PersonSimpleTaiChi   | cyan `#6fd4e4` |
| `moon`     | Moon                 | cyan `#6fd4e4` |
| `clock`    | Timer                | blue `#6babdf` |
| `pulse`    | Pulse                | red `#f87171` |

## PNG override (optional)

Drop a PNG file in this folder named after the iconType (e.g., `run.png`,
`strength.png`) and it will override the Phosphor icon for that category.
`MobileHome.jsx` uses `import.meta.glob('../assets/workouts/*.png', ...)` so
adding a file here is auto-discovered — no code change needed.

### Spec
- 256x256 px or 512x512 px square
- Transparent background (PNG-32)
- High-contrast foreground that reads against a low-alpha tint of the
  category color (the icon sits inside a 36px rounded square with that tint)
- Minimalist line art or filled silhouette — avoid photorealism

To revert a category back to the Phosphor icon, just delete the matching PNG.
