# Arnold — Data Safety Architecture Review & Control Framework

_Written after the April 2026 "Clear site data" incident in which localStorage was wiped on web and recovery required CSV re-import + manual cloud-sync re-pair._

---

## 1. Incident Post-Mortem

### What went wrong
A single browser-level action (**Chrome → Clear site data**) destroyed all 33 Arnold localStorage keys on web in one click. No in-app guard could prevent it because the action lives outside the app.

### What held up
1. Source-of-truth CSVs survived on disk in `data-imports/` (Garmin + Cronometer exports) — the Tier-B data reconstruction path worked.
2. OPFS rolling snapshots (auto-backup every 6h, 3 snapshots × 33 keys × ~527KB) remained readable after the wipe.
3. The Cloudflare relay retained an encrypted blob from prior pushes.
4. Source code was recoverable from GitHub.

### What actively failed or obstructed recovery
1. **Mobile Export Backup silently dropped the file** — the Capacitor WebView's blob-URL download path is a no-op. Fixed mid-incident via `@capacitor/filesystem` + `@capacitor/share` rewrite of `exportBackup()`.
2. **Gradle build broke** on the mobile rebuild — `@capacitor/filesystem@8.1.2` requires Kotlin 2.x stdlib, root `build.gradle` was on 1.9.22, plus a dead FileProvider declaration in `AndroidManifest.xml` that conflicted with the plugin's auto-registered provider.
3. **Bulk Historical Import UI was hidden** behind `{false && <>` in `Arnold.jsx:4923` — the single most useful recovery control was invisible until we relocated it.
4. **Cloud sync re-pair created a new slot** instead of rejoining the existing one — web auto-generated a fresh Pair ID (`aaccbfa3…`) and Salt, silently orphaning the relay blob that mobile was still writing to (`75c82b5f…`). No UI indicator said "you are now on a different relay slot than your other device."
5. **`SyncPanel` large-payload path set literal placeholder URL** `?sync=clipboard` instead of a real transfer mechanism.
6. **`.gitignore` excludes personal health data** — `public/data-imports/` and `public/arnold-sync-data.json` are gitignored by design. GitHub held code but never data.
7. **The cloud-sync push short-circuits silently** when passphrase isn't set (`cloud-sync.js:375` `if (!hasPassphrase()) return { skipped: 'no_passphrase' }`) — a fresh-install device never warns the user that it's not backing up.

---

## 2. Current Architecture Inventory

### Persistence tiers already implemented
- **L0 — localStorage** — primary hot storage, ~33 keys, survives reload but not "Clear site data".
- **L1 — IndexedDB (Dexie)** — secondary store for larger structured data, same origin-wide blast radius as L0.
- **L2 — OPFS (Origin Private File System)** — auto-snapshots every 6h, 3 rolling copies. Survives soft clears in some browsers but still origin-scoped.
- **L3 — Downloads (manual/auto)** — Tier C auto-export is scheduled; user can also click Export Backup. File lives in OS filesystem, survives any browser operation.
- **L4 — Cloudflare relay (cloud sync)** — E2E encrypted, AES-GCM, PBKDF2 600k iterations, per-pairing salt. Survives device loss entirely.
- **L5 — Source CSVs on disk** — Garmin/Cronometer raw exports at `C:\Users\Superuser\Arnold\arnold-app\public\data-imports\`. Not backed up automatically but survive anything that doesn't involve deleting files manually.
- **L6 — GitHub** — source code only; data explicitly gitignored.

### Recovery mechanisms already in place
- `BackupPanel` — Export / Import / Backup now buttons.
- `BackupStatusPanel` — shows OPFS snapshots with one-click Restore.
- `Bulk Historical Import` — CSV-driven reconstruction (now visible in active admin section).
- `CloudSyncPanel` — pair/unpair, push/pull, passphrase unlock.
- Manual passphrase re-entry on cold starts (per-session cache).

### Keys that live ONLY in app storage (no upstream equivalent)
Items with no Garmin/Cronometer source:
- Profile (age, sex, height, weight-goal, etc.)
- Goals (calorie/macro/HR-zone targets)
- Races (planned + completed, non-Garmin metadata)
- Strength workouts + templates
- Training plan / planner

These are the Tier-C "irreplaceable" keys. Losing them means re-entry is the only recovery if no backup exists.

---

## 3. Gap Analysis — why one bad click turned into a multi-hour recovery

| Gap | Consequence | Severity |
|---|---|---|
| Clear-site-data happens outside app | No in-app defense possible; must be absorbed by off-origin backups | Irreducible — design around it |
| No pre-flight snapshot before destructive ops | Reset All, Import, Pull can each wipe state with no rollback | High |
| Hidden recovery UI | Users can't reach the tool that would save them | High |
| Cloud-sync "new slot created" is silent | Devices silently drift onto different relay slots | High |
| Silent push-skip when no passphrase | Fresh device appears healthy but isn't backing up | High |
| No key-count anomaly detection | A drop from 33 → 0 keys goes unannounced | Medium |
| No write audit log | Can't diagnose "what wiped my profile" after the fact | Medium |
| Capacitor Share dependency on newly-fixed build | Mobile is the off-origin file destination; if APK is stale it falls back to the old silent-fail path | Medium |
| No cross-device health indicator | "Are web and mobile on the same relay slot?" has no visible answer | Medium |
| Source CSVs not themselves backed up | `data-imports/` would die with a disk failure | Low–Medium |

---

## 4. Control Framework — defense in depth

Five layers. Each layer independently prevents, detects, or recovers from a class of failure. Redundancy across layers means any single layer failing doesn't break the system.

### Layer 0 — Prevention (gate destructive actions)
- **Reset All Data**: require typed confirmation (`type ARNOLD to confirm`), not just a `confirm()` dialog.
- **Unpair Cloud Sync**: show pair-slot fingerprint and tracked-key count before unpair, with explicit "you will be detached from this slot" language.
- **Pair as first device**: when user leaves Pair ID + Salt blank, require an extra confirm: _"No Pair ID provided. This creates a NEW relay slot — your other devices will NOT be able to see this one. Continue?"_  **(This is the control that would have caught the re-pair drift.)**
- **Bulk Import with existing data**: warn about row counts before overwriting non-empty keys.

### Layer 1 — Pre-destructive snapshot
Before ANY destructive operation (Reset, Bulk Import, Pull, Restore-from-snapshot, Unpair), automatically:
1. Write a snapshot to OPFS tagged `pre-<operation>-<timestamp>`.
2. Keep the last 10 pre-op snapshots separately from the rolling 6h snapshots.
3. Surface them in `BackupStatusPanel` under a "Pre-operation snapshots" section.

### Layer 2 — Continuous automated backup
- **OPFS every 6h** (exists).
- **Downloads auto-export daily** — write `arnold-backup-YYYYMMDD.json` to Downloads on first boot each day. OS-filesystem persistence means one more layer survives a browser wipe.
- **Cloud push debounced 5s after any write** (exists in `cloud-sync.js` debounce path).
- **CSV source sync**: once a week, copy `public/data-imports/*.csv` to `data-imports-archive/YYYY-MM-DD/` so even the raw sources versioned.

### Layer 3 — Multi-location redundancy matrix
| Tier | Location | Frequency | Survives |
|---|---|---|---|
| L0 | localStorage | real-time | tab close |
| L1 | IndexedDB | real-time | tab close |
| L2 | OPFS | 6h + pre-op | soft clear |
| L3 | Downloads | daily + on export | browser data clear |
| L4 | Cloudflare relay | 5s debounced | device loss |
| L5 | data-imports/ CSVs | on Garmin/Cronometer export | OS disk failure (mitigate via weekly copy) |
| L6 | GitHub code | on commit | full machine loss (code only, not data) |

Goal: Tier-C (profile, goals, races, plans) must exist in **at least three non-overlapping locations** at all times: L0 + L2 + L4 is the floor.

### Layer 4 — Visibility & health
Replace `BackupStatusPanel` with a **Data Health** dashboard that's always visible in More tab, showing at a glance:
- Key count now vs. 24h ago vs. 7d ago (surface drops > 10% in red).
- Last OPFS snapshot age.
- Last Downloads auto-export age.
- Last successful cloud push age.
- Cloud-sync pair ID fingerprint (first 8 hex chars) with a "does this match my other device?" one-tap verify — ideally displayed as a colour+emoji pair so two devices showing the same colour/emoji confirms same slot at a glance.
- Passphrase state: "Set this session" vs "Not set — cloud sync is NOT running".
- Red banner when any tier is stale or broken.

### Layer 5 — Recovery wizard
A single **"Recover Data"** button in More tab that opens a wizard walking through candidate sources in priority order:
1. OPFS snapshots (fastest).
2. Pre-operation snapshots.
3. Downloads auto-export (today's and last 7 days).
4. Cloud relay (with pair-slot-aware UI).
5. Bulk CSV import from `data-imports/`.
6. Paste JSON fallback.

Each candidate shows: key count, date, file size, source. "Preview diff" before applying. No more digging through separate panels.

### Layer 6 — Write audit (observability)
Small ring buffer (last 500 writes) recording:
```
{ ts, key, prevLen, newLen, source: 'user' | 'import' | 'sync-pull' | 'restore' }
```
Stored in IndexedDB (survives localStorage wipes), exposed in a Diagnostics sub-page. Makes after-the-fact forensics possible.

---

## 5. Prioritized Action Plan

### P0 — Do this week
1. **Blank-Pair-ID warning in CloudSyncPanel** (Layer 0). 20 lines. Would have prevented the exact incident we just recovered from.
2. **"Not syncing" banner when paired but no passphrase** (Layer 4). Currently silent. 30 lines.
3. **Pair slot fingerprint display** on both web and mobile Cloud Sync status — 8 hex chars + matching emoji makes "same slot?" a glance check.
4. **Pre-operation snapshot** for Reset / Bulk Import / Pull (Layer 1). Reuse existing OPFS helper.

### P1 — Do this month
5. **Daily Downloads auto-export** (Layer 2/3). One IntersectionObserver-style check on app boot, compare to last-export timestamp in localStorage. If > 24h, run exportBackup() with `{silent: true}`.
6. **Data Health dashboard** replacing current BackupStatusPanel (Layer 4).
7. **Recovery Wizard** (Layer 5) — consolidates every restore path into one flow.
8. **Key-count anomaly detection**: on boot, if current key count is < 80% of yesterday's key count, surface a warning banner with one-click "Restore from last OPFS snapshot" button.
9. **Write audit log** (Layer 6).

### P2 — Do this quarter
10. Weekly `data-imports/` archive copy.
11. Rotating encrypted backup to a second cloud target (iCloud Drive / Google Drive / Dropbox) via file export — reduces single-provider risk.
12. Cloud sync "replay" mode — instead of LWW merge, let user review the diff and selectively accept/reject changes. Closes the "pull stomped my fresh data" worry that nearly hit during the incident.
13. On mobile, a "Verify paired slot" action that calls the relay and confirms the blob decrypts cleanly — catches stale pair config before a real emergency.

### P3 — Nice to have
14. Git-backed encrypted archive: Tier-C only, encrypted at rest, committed to a private repo on a schedule. Closes the "full machine loss + relay + OS disk failure" corner case. Requires the passphrase to restore so still secure.
15. Scheduled self-test: once a week, decrypt latest OPFS snapshot and the cloud blob, verify round-trip. Alert if either fails.

---

## 6. Implementation Cheat Sheet

For the P0 items, here's the concrete shape.

### Blank-Pair-ID warning (CloudSyncPanel.jsx, ~line 60)

```jsx
async function handlePair(e) {
  e.preventDefault();
  const pairId = form.pairId.trim();
  const salt = form.salt.trim();
  if (!pairId && !salt) {
    const proceed = confirm(
      "No Pair ID / Salt entered.\n\n" +
      "This creates a NEW relay slot — your other devices will NOT see this one.\n\n" +
      "To JOIN an existing pairing, paste the Pair ID and Salt from your other device's\n" +
      '"Pair-a-second-device values" section.\n\n' +
      "Create a new slot anyway?"
    );
    if (!proceed) return;
  }
  // … existing logic
}
```

### "Not syncing" banner (CloudSyncPanel.jsx, active state)

```jsx
{cfg.paired && !status.hasPassphrase && (
  <div style={{ background: '#5c1f1f', padding: 8, borderRadius: 6, marginBottom: 10 }}>
    ⚠ Paired but locked — cloud sync is NOT running. Enter passphrase to start.
  </div>
)}
```

### Pair slot fingerprint (both status blocks)

```jsx
function slotEmoji(pairId) {
  if (!pairId) return '—';
  const idx = parseInt(pairId.slice(0, 4), 16) % 12;
  return ['🐢','🦊','🐙','🐝','🦉','🐬','🦋','🐿','🦄','🐧','🦜','🦆'][idx];
}
// in render:
<div>Pair slot: {slotEmoji(status.pairId)} <code>{status.pairId?.slice(0,8)}…</code></div>
```

Both devices showing the same emoji + 8-char prefix = same slot. Wrong emoji = you've drifted.

### Pre-op snapshot

```js
// core/backup.js
export async function snapshotBeforeOp(opName) {
  const data = gatherData();
  const payload = { exportedAt: new Date().toISOString(), op: opName, data };
  const filename = `pre-${opName}-${Date.now()}.json`;
  await writeToOPFS(filename, JSON.stringify(payload));
  return filename;
}
```
Then call `await snapshotBeforeOp('pull')` at the start of `handleUnlock`, `await snapshotBeforeOp('reset')` before `persist(DD)`, etc.

---

## 7. Non-negotiables going forward

1. **Every destructive operation takes a snapshot first.** Non-negotiable.
2. **Paired but locked = red banner.** A silent no-sync is the most dangerous state — user thinks they're safe, they're not.
3. **Pair slot fingerprint visible on every device**, every time Cloud Sync is opened.
4. **Recovery UI is never hidden behind `{false &&}`**. If it's not ready for users, it's behind a named feature flag with a clear comment, not `false`.
5. **Tier-C keys (profile/goals/races/plans) must exist in 3+ non-overlapping locations at all times.** Current default is L0 + L2 + L4, but the moment any of those is stale > 24h, a banner fires.

---

_File lives at `C:\Users\Superuser\Arnold\DATA_SAFETY_REVIEW.md`. Update it as controls land._
