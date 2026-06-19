# Profile / Cloud-Sync tab — audit & recommendations (2026-06-13)

> Requested by Emil: the Profile/Settings + Cloud Sync surface was built to satisfy
> "Admin" needs and may not be needed in that shape anymore. Goal: cut what's
> obsolete, make destructive actions safe, and polish the UI to the app's overall
> bar. **This is a proposal — nothing here is implemented except the Reset fix,
> which is already done. Decide what you want and I'll execute in slices.**

## Already done (this round)
- **Reset Arnold is now safe.** Moved into a **collapsed "⚠ Danger Zone"** (`<details>`,
  closed by default) with a plain-language warning. It still requires typing
  `ARNOLD` and still auto-saves a recoverable pre-op snapshot. It can no longer be
  hit by muscle memory — you have to deliberately expand it first.

---

## What's in the tab today (inventory)

The Profile tab = **Personal info** + a big block literally headed **"Admin"**.

| # | Item | What it does | Verdict |
|---|------|--------------|---------|
| 1 | **Personal info** (name, alias, birth date, height, avatar + avatar library) + Save | Core user profile | **KEEP** (minor polish) |
| 2 | **"Admin" section header** | Groups everything below under one "Admin" label | **RESHAPE** — split into user-facing groups + a collapsed "Advanced" |
| 3 | **Architecture Map** link | Opens a static dev page: component deps, storage keys, data flow, security audit | **DEV-ONLY** — not a user feature; move behind a dev flag or drop from the user build |
| 4 | **Backup & Restore** (`BackupPanel`) | Manual backup/restore of all data | **KEEP** — this is the real safety net; surface it clearly |
| 5 | **Backup status** (`BackupStatusPanel`) | Shows backup health/last-backup | **KEEP** — consider merging into #4 as one "Your Data" card |
| 6 | **Bulk Historical Import** (Load CSVs) | Fetches 5 bundled CSVs from `public/data-imports/` and **overwrites** each data key | **DEV/ADMIN** — a one-time seeding/migration tool that replaces live data. Risky for an end user. Move to Advanced (+confirm) or drop |
| 7 | **SyncPanel** (QR / URL transfer) | One-shot export of all `arnold:*` keys → compressed blob → QR/URL; import via `?sync=` | **REDUNDANT** with Cloud Sync (see below) |
| 8 | **CloudSyncPanel** | Encrypted continuous relay sync: pairing, Push/Pull/**Force pull**, crypto **self-test**, re-enter passphrase, unpair, **Garmin** + **Cronometer** creds, **Health Connect** status | **KEEP core, tuck power-tools** (see breakdown) |
| 9 | **Reset Arnold** | Full wipe | **DONE** — now in collapsed Danger Zone |
| 10 | **Dead `{false && …}` block** | Old goals fields (now live in Plan/Goals), a duplicate `DataSync`, a *second* "Danger Zone → Delete All Data", a stats line — **never renders** | **DELETE** — pure cruft |

### CloudSyncPanel, broken down
| Control | Verdict |
|---|---|
| Pair device / unpair | **KEEP** — required to set up sync |
| Push now / Pull now | **KEEP** — useful, low-risk |
| **Force pull** (overwrites local with cloud) | **ADVANCED** — destructive; tuck behind an Advanced toggle |
| **Crypto self-test** | **DEV** — hide/remove from user build |
| Re-enter passphrase | **KEEP** — recovery path |
| Cronometer credentials + Test pull | **KEEP** — real feature (nutrition) |
| Garmin credentials + Test pull | **KEEP** |
| Garmin **Backfill / Force refill / Sync activities / Enrich** | **ADVANCED** — maintenance/power-user; tuck behind Advanced |
| Garmin **Watch VO₂Max manual entry** | **KEEP** (small, useful) — or move to Personal |
| Health Connect status + Sync now | **KEEP** — this is your HC diagnostic |

---

## The core problem: three sync surfaces + dev tools mixed with user settings
1. **Redundant device-sync UIs.** `SyncPanel` (QR/URL one-shot), `CloudSyncPanel`
   (encrypted continuous relay), and the dead-block `DataSync` all do "move data
   between devices." That's confusing and doubles the maintenance surface.
   **Recommendation:** keep **Cloud Sync** as the one real path; drop `SyncPanel`
   (or demote it to a single "Quick transfer via QR" button under Advanced if you
   still use it for a fast phone↔PC hop).
2. **Dev/admin tools sit inline with everyday settings.** Architecture Map, Bulk
   Import, crypto self-test, Force pull, Garmin maintenance — all one tap away,
   several destructive. **Recommendation:** one collapsed **"Advanced"** section.
3. **Two destructive buttons** (Reset + the dead duplicate "Delete All Data").
   Reset is now safe; the duplicate is dead and should be deleted with the block.

---

## Proposed target layout for the Profile tab
```
Profile
├─ Personal            name · alias · birth date · height · avatar
├─ Your Data           Backup & Restore (+ status)            [keep, prominent]
├─ Devices & Sync      Cloud Sync: pair · push · pull · status [keep]
│   └─ Connections     Garmin · Cronometer · Health Connect    [keep]
├─ ▸ Advanced (collapsed)
│      Force pull · crypto self-test · Garmin backfill/enrich ·
│      Bulk historical import · Architecture Map · QR transfer
└─ ▸ Danger Zone (collapsed)   Reset Arnold            [DONE]
```

## Suggested execution slices (each build-verifiable)
- **A — DONE:** Reset → collapsed Danger Zone.
- **B (safe, no behavior loss):** delete the dead `{false && …}` block (old goals,
  duplicate DataSync, duplicate "Delete All Data", stats line).
- **C:** consolidate sync — drop/demote `SyncPanel` once you confirm you don't rely
  on the QR transfer.
- **D:** add a collapsed **Advanced** section; move Architecture Map, Bulk Import,
  crypto self-test, Force pull, and Garmin maintenance buttons into it.
- **E:** UI polish — group the survivors into consistent cards ("Your Data",
  "Devices & Sync", "Connections") matching the rest of the app's card style.

## Decisions (Emil, 2026-06-13) — FINAL
1. **QR `SyncPanel`** — **drop it** ("don't need QR for now"). Cloud Sync is the only path.
2. **Architecture Map + Bulk Import + crypto self-test** — **move to a collapsed Advanced** (keep, don't delete).
3. **Single user** — only Emil for now (future expansion will add features). So **simplify rather than role-gate** dev tools.
4. **Garmin maintenance buttons** (backfill / force refill / sync activities / enrich) — **move to Advanced**.

## Finalized execution plan (status)
- **A — ✅ DONE:** Reset → collapsed Danger Zone.
- **C — ✅ DONE:** dropped QR `<SyncPanel/>` render (import kept — `?sync=` handler still uses checkSyncImport/applySyncData).
- **D1 — ✅ DONE:** Architecture Map → collapsed Advanced; Bulk Historical Import → collapsed Advanced (both ProfileSettings).
- **D2 — ✅ DONE (2 of 3):** Force pull → collapsed Advanced; Garmin maintenance (backfill / force refill / sync activities /
  enrich) → collapsed Advanced (CloudSyncPanel). **Crypto self-test:** left as-is — it only renders on the *device-pairing*
  screen (unpaired state), not the everyday paired view, so it's already out of the way. Remove entirely if you want.
- **B — ✅ DONE (ROUND 60, 2026-06-14):** deleted the dead `{false&&}` block via shell line-range delete (sed by line number
  sidesteps the BOM/`✓` escape that blocked the string-match Edit tool). Removed the whole block from `{/* legacy block
  hidden */}` through its matching `</>}` (was ~137 lines), plus the now-orphaned `numField` helper it was the only consumer
  of. Verified: live goals editing is via `<GoalsHub>` (Plan tab) — unaffected; AST free-vars clean + esbuild clean.
- **E — ✅ DONE (ROUND 60, 2026-06-14):** grouped survivors under consistent **section headers** (Personal card unchanged,
  then Your Data · Devices & Sync · Connections · Advanced · Danger Zone). Implemented as labeled divider-headers, NOT nested
  cards — the sub-panels (BackupPanel/CloudSyncPanel/BackupStatusPanel) already self-card, so wrapping would double-box.
  Connections is a placeholder (no distinct content yet — Garmin/cloud live under Devices & Sync). Danger Zone collapsible
  summary shortened to "⚠ Reset Arnold" (the section header now carries "Danger Zone"). All sub-blocks preserved verbatim
  (extracted by line-range, reassembled) — zero behavior/component change. esbuild + AST free-vars clean. **Visual — needs
  Emil's build to confirm it reads right.**

> ⚠ **Tooling note:** the dead `{false&&}` block (lines ~6383–6519) and the live Bulk Import both contain a literal
> `﻿` BOM-strip escape that the Edit tool can't string-match (same limitation as the `✓` checkmark seen earlier).
> Bulk Import is handled by *wrapping around* it (no need to match the line). The dead block, however, can't be cleanly
> deleted via the tool without leaving an invalid stray statement — it's **harmless** (never renders, behind `false&&`), so
> the cleanest fix is for Emil to delete lines ~6383–6519 in a normal editor, or I leave it as inert cruft. Flagged, not blocking.
