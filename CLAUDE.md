# CLAUDE.md — Arnold project

This file orients any new Cowork/Claude session working in this folder.

## Resume protocol (read first)
1. **Read `DESIGN_DECISIONS.md` AND `DESIGN_LESSONS.md`** at the repo root FIRST — binding UI/design rules + hard-won
   design memory (MOCK-FIRST workflow, density/use-the-canvas/no dead black space, no progress-bar "shopping lists",
   the mobile `.arnold-compact-input`/`.arnold-compact-btn` trap, forward-looking modeling, surface de-dup). Treat both
   as law; if a rule is wrong, Emil edits the doc once. When a NEW design lesson is learned, APPEND it to
   `DESIGN_LESSONS.md` (dated) — this is our memory; keep it current.
2. **Read `HANDOVER.md`** — the canonical "where we are" state.
3. **Read `EXECUTION_PLAN_2026-06.md`** — the LIVING uplift plan (Status Board + Progress Log).
   This is the active multi-phase improvement track; keep its board + log current as steps move.
   Companion: `PRODUCT_AUDIT_2026-06.md` (the why behind the uplift).
4. Read the docs it references as needed for the active task.
5. Continue from the **Active task** / **Current focus** in `HANDOVER.md` and the uplift plan's board.
6. Update `HANDOVER.md` + the uplift plan at checkpoints; update `DESIGN_DECISIONS.md` whenever a design decision is settled.

If a previous window crashed and `HANDOVER.md` looks stale, the prior session's
transcript can be recovered via the session tools — but `HANDOVER.md` is the
primary source of truth.

## What Arnold is
A personal health & fitness intelligence app: a React + Vite web app wrapped with
Capacitor for Android, in `arnold-app/`. It ingests Garmin + Cronometer data and
produces Health System scores, a Cut Mode classifier, and a Coach layer.

## Layout
- `arnold-app/src/` — app source (core logic in `src/core/`, UI components in `src/`).
- `arnold-app/docs/` + root `*.md` (`COACH.md`, `RACES.md`, `DATAMODEL.md`,
  `POSTMORTEMS.md`, `SMOKE_TESTS.md`, etc.) — design docs and the deferred-work backlog.
- `arnold-app/android/` — Capacitor Android project.

## Environment / workflow rules
- **Build & deploy run from the user's Windows terminal**, not from the Cowork sandbox:
  ```
  cd C:\Users\Superuser\Arnold\arnold-app
  npm run build && npx cap sync android && npx cap run android
  ```
- **git push is done by the user** from the Windows terminal (sandbox mounts can be
  stale and silently skip edited files — never push from the sandbox).
- The Cowork sandbox/VM may be down; do not assume `npm`/`cap`/`git` are runnable here.
  File edits (Read/Write/Edit) always work.
- Mobile-specific UI changes go in the mobile components only (e.g. `MobileHome.jsx`),
  never the shared/web components, unless explicitly asked.

## Conventions
- Backlog lives in the docs under "deferred" / "parking lot" headings; when an item
  ships, tick it in `HANDOVER.md` and move it to "Recently shipped".
- Record notable bugs/fixes in `POSTMORTEMS.md`.
