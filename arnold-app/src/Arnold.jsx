import { useState, useEffect, useCallback, useMemo } from "react";
import {
  saveWorkout,
  getGarmin, saveGarmin, saveCronometer,
  getGarminActivities, saveGarminActivities,
  getGarminHRV, saveGarminHRV,
  getGarminSleep, saveGarminSleep,
  getGarminWeight, saveGarminWeight,
  getImportHistory, saveImportHistory,
} from "./core/memory.js";
import { parseGarminCSV, mergeGarminActivities } from "./core/garminParser.js";
import { parseActivitiesCSV, mergeActivities } from "./core/parsers/activitiesParser.js";
import { parseHRVCSV, mergeHRV } from "./core/parsers/hrvParser.js";
import { parseSleepCSV, mergeSleep } from "./core/parsers/sleepParser.js";
import { parseWeightCSV, mergeWeight } from "./core/parsers/weightParser.js";
import { detectCSVType } from "./core/parsers/detectType.js";
// Phase 0.5 (slice 8) — fetchAndParseICS import removed; its only consumer
// (the deleted legacy RacesTab) is gone. The live Calendar uses CalendarTab.jsx.
import { startFitPolling } from "./core/fit-relay.js";
import { parseCronometerCSV } from "./core/parsers/cronometerParser.js";
import { storage, migrateLegacyStorage, migrateSupplementKeys, attachEngine, initEncryption, getStorageWriteCount } from "./core/storage.js";
import { migrateGoalsV1ToV2 } from "./core/migrateGoalsV1ToV2.js";
import { primeVitalsCache, dcy as dcyToday } from "./core/dcy.js";
import { allActivities as _allActs } from "./core/dcyMath.js";
import { startOfDay as _startOfDay, startOfWeekMonday as _startOfWeekMonday } from "./core/dateUtils.js";
import * as dbEngine from "./core/db.js";
import { fmtHM, hrZoneFromBpm, weeklyRunVolume, weeklyStrengthVolume, ytdVolume, pacePct as derivePacePct } from "./core/derive/index.js";
import { ImportDiagnostics } from "./components/ImportDiagnostics.jsx";
import { GoalsHub } from "./components/GoalsHub.jsx";
import { buildTileContext, TILE_METRICS, deriveStatus } from "./core/derive/tileMetrics.js";
// Phase 4r.intel.1 — conditions-aware metric status. Replaces hardcoded
// "color this tile red because it's an intensity metric" with status
// computed against published norms adjusted for temp/humidity. See
// core/expectedRanges.js for the bands + adjustment math.
import { resolveAllStartTiles } from "./core/derive/autoPromote.js";
import { KRITile, InlineKRIStat } from "./components/KRITile.jsx";
import { normalizeTilePrefs } from "./core/derive/tileMetrics.js";
import { SupplementsTab } from "./components/SupplementsTab.jsx";
import { CalendarTab } from "./components/CalendarTab.jsx";
// Phase 4r.hygiene.1 — ErrorBoundary wraps each tab so a component-level
// crash (e.g. the 4r.dataspine.5 `dyn is not defined` regression) shows
// a graceful retry UI instead of blanking the whole tab.
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
// Phase 4r.coach.v2.surface — Coach BETA tab.
// CoachBeta import retired with the Coach tab (Phase 4r.coach.retire). The
// CoachBeta.jsx file is kept in tree in case we revive it as a diagnostics view.
import { CoachLine } from "./components/CoachLine.jsx";
import { CoachSigil } from "./components/CoachSigil.jsx";
import { CoachComment } from "./components/CoachComment.jsx";
import { primaryIdsFor } from "./core/presentation/storySpecs.js";
import { healthStatusColor } from "./core/presentation/healthTokens.js";
// Phase 0.5 (slice 21) — HealthTileBase + SYSTEM_ICONS now imported by
// components/HealthSystemsGrid.jsx (the web tile wrapper moved there); no
// longer referenced directly in Arnold.jsx.
import { BM, BCATS, BCAT_CLR, BCAT_ICO, bStatus, SC, SL, SC_BG, SC_BORDER } from "./core/biomarkers.js";
import { parseCSV, parseLabCSV, ndate, mapGarmin, mapCrono, mergeLogs } from "./core/importParsers.js";
import { td, fmt, Q, HRV_L, hc, dc, genId, calcPace, daysUntil, raceTypeBadge } from "./core/uiFormat.js";
import { ai, aiStream, aiSummary, buildFullPrompt } from "./core/ai.js";
import { S } from "./arnoldStyles.js";
import { LabsModule } from "./components/LabsModule.jsx";
import { ClinicalModule } from "./components/ClinicalModule.jsx";
import { WebSystemDetail } from "./components/WebSystemDetail.jsx";
import { EdgeIQ } from "./components/EdgeIQ.jsx";
import { TrainingTab } from "./components/TrainingTab.jsx";
import { LogDay } from "./components/LogDay.jsx";
import { HealthSystemsGrid } from "./components/HealthSystemsGrid.jsx";
import { CARD_GRID } from "./core/presentation/cardLayout.js";
import { PostRunWeigh } from "./components/PostRunWeigh.jsx";
import { C } from "./arnoldTheme.js";
import { StackCard } from "./components/StackCard.jsx";
import { MobileHome, MobileEdgeIQ, NAV_ITEMS, useSwipeNav, BottomNavBar, DcyDetails, NavIconForTab, WebTabIcon, TAB_LABEL, TAB_ACTIVE_COLOR, TAB_ACCENT_COLOR } from "./components/MobileHome.jsx";
import { SyncPanel, checkSyncImport, applySyncData } from "./components/SyncPanel.jsx";
import { BackupPanel } from "./components/BackupPanel.jsx";
import CloudSyncPanel from "./components/CloudSyncPanel.jsx";
import BackupStatusPanel from "./components/BackupStatusPanel.jsx";
import { startCloudSync, onCloudSyncEvent } from "./core/cloud-sync.js";
import { startAutoBackup, snapshotBeforeOp, purgeLegacyLocalStorageBackups } from "./core/backup.js";
// Phase 0.5 (slice 5) — supplement getters import removed; their only Arnold.jsx
// consumer (buildFullPrompt) moved to core/ai.js, which imports them directly.
import { AVATAR_LIBRARY } from "./core/avatars.js";
import { getGoals } from "./core/goals.js";
import { WeeklyPlanner } from "./components/WeeklyPlanner.jsx";
import { Workbench } from "./components/Workbench.jsx";
import { PlanGeneratorPanel } from "./components/PlanGeneratorPanel.jsx";
import { checkTodayCompletion } from "./core/planner.js";
import { trainingAnnotations, dailyAnnotations } from "./core/aiAnnotations.js";
import { AnnotationStrip } from "./components/AnnotationStrip.jsx";
import { CockpitRail } from "./components/CockpitRail.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { ArcDial } from "./components/ArcDial.jsx";
import { TrendBadge } from "./components/TrendBadge.jsx";
import { FocusCard } from "./components/FocusCard.jsx";
import { getSystemsReport, getSystemDetail, getSystemWeekly, getSystemCoachRead, getBioactiveStack } from "./core/healthSystems.js";
import { computeUserState as _computeUserStateForCoachRead } from "./core/intelligence.js";
import { GROUP_COLOR as BIO_GROUP_COLOR } from "./components/BioactiveStack.jsx";
import "./core/energyBalance.js"; // wires window.energyBalanceDebug()
import "./core/attribution.js";   // Intelligence Hub stage 1 — wires window.attributionDebug()
import "./core/hub/hubDebug.js";  // Intelligence Hub core loop — wires window.hubDebug() (backfill + facts)
import "./core/zonesDebug.js";    // wires window.zonesDebug() — real HR zones + time-in-zone
import "./core/zones.js";         // zone resolver + lab-test anchor; wires window.zonesResolved()/setLabTest()
import { isRun as isRunAct, isHybridWorkout as isHybridAct, activityKind, activityLabel, iconTypeFor } from "./core/activityClass.js";
import { getTopCoachingPrompts, getPromptsByPillar, runCoachingPromptsHealthProbe } from "./core/coachingPrompts.js"; // also wires window.coachingDebug()
import { runCoachBriefsHealthProbe } from "./core/coachBriefs.js";
// Phase 4r.dataspine.4 — getDynamicMacroTarget + resolveCalorieTarget
// imports removed. All consumers in Arnold.jsx now read goalModel's
// getEffectiveTargets (imported below as getDerivedTargets).
import { getCurrentBodyComp, computeRMR, safeCutHeadroom } from "./core/energyBalance.js";
import { backfillFromActivities } from "./core/learnedBaselines.js";
import { InsightsPanel } from "./components/InsightsPanel.jsx";
import { computeUserState } from "./core/intelligence.js";
import { composeNarrative } from "./core/narrativeComposer.js";
import { safeCompute } from "./core/safeCompute.js";
import { getEffectiveTargets as getDerivedTargets, getOverrides as getDerivedOverrides } from "./core/goalModel.js";
// Health system iconography — Gemini-generated line-art PNGs at 256×256 with
// dark #0b0d12 background and the system's accent color baked in. Vite
// resolves these to hashed asset URLs at build time.
// Phase 0.5 (monolith slice 4) — SYSTEM_PNGS_DESKTOP + its PNG asset imports
// moved to core/systemPngs.js; now consumed by components/HealthSystemsGrid.jsx
// (slice 21), no longer referenced directly in Arnold.jsx.
import { DataSync } from "./components/DataSync.jsx";
import { ArcDialSVG } from "./components/ArcDialSVG.jsx";
import {
  weeklyLoad, loadTrend, paceTrend, hrEfficiency,
  trainingMonotony, trainingConsistency,
} from "./core/trainingIntelligence.js";
import {
  computeRTSS, computeHrTSS, computeAcuteChronicRatio, computeTonnage, computeDensity,
  matchTemplate, computeDailyScore,
  computeRolling7d, computeRolling30d, getEffectiveMaxHR,
  RTSS_BANDS, rtssBand,
} from "./core/trainingStress.js";

// ─── Storage ──────────────────────────────────────────────────────────────────
const SK = "vitals-v4";
const DD = { profile:{name:"",goal:"",age:"",height:""}, logs:[], aiInsights:[], labSnapshots:[], clinicalTests:[] };
async function loadData(){
  // Two-tier read:
  //   Tier 1: vitals-v4 blob via window.storage — Capacitor-only API. On web
  //           this is undefined and the read MUST NOT throw out of the function
  //           or we lose Tier 2 entirely (was the cause of labs vanishing on
  //           every web reload — outer catch returned DD).
  //   Tier 2: storage layer (IDB) — cross-device source of truth for labs,
  //           clinical tests, and everything cloud-sync touches.
  // Final data = Tier 1 ∪ Tier 2, with Tier 2 winning where collections overlap
  // (because cloud-sync always writes to Tier 2, not Tier 1).
  let data = {...DD};
  // ── Tier 1: vitals-v4 (Capacitor only, optional) ──
  try {
    if (typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function') {
      const r = await window.storage.get(SK);
      if (r && r.value) {
        try { data = JSON.parse(r.value); } catch { /* keep DD */ }
      }
    }
  } catch (e) {
    console.warn('[loadData] vitals-v4 read failed (non-fatal):', e?.message || e);
  }
  // ── Tier 2: storage layer (always available — IDB cache) ──
  try {
    const sLabs = storage.get('labSnapshots');
    if (Array.isArray(sLabs) && sLabs.length) {
      const m = {};
      (data.labSnapshots || []).forEach(s => { if (s?.date) m[s.date] = s; });
      sLabs.forEach(s => {
        if (!s?.date) return;
        if (!m[s.date]) m[s.date] = s;
        else m[s.date] = { ...m[s.date], ...s, markers: { ...(m[s.date].markers || {}), ...(s.markers || {}) } };
      });
      data.labSnapshots = Object.values(m).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } else if (!Array.isArray(data.labSnapshots)) {
      data.labSnapshots = [];
    }
    const sTests = storage.get('clinicalTests');
    if (Array.isArray(sTests) && sTests.length) {
      const m = {};
      (data.clinicalTests || []).forEach(t => { const k = `${t?.date}|${t?.type}`; if (t?.date && t?.type) m[k] = t; });
      sTests.forEach(t => {
        const k = `${t?.date}|${t?.type}`;
        if (!t?.date || !t?.type) return;
        if (!m[k]) m[k] = t;
        else m[k] = { ...m[k], ...t, metrics: { ...(m[k].metrics || {}), ...(t.metrics || {}) } };
      });
      data.clinicalTests = Object.values(m).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } else if (!Array.isArray(data.clinicalTests)) {
      data.clinicalTests = [];
    }
  } catch (e) {
    console.warn('[loadData] storage layer read failed:', e?.message || e);
  }
  try { primeVitalsCache(data); } catch {}
  return data;
}
async function saveData(d){
  // Tier 1 write — Capacitor only. On web this is a no-op; persistence happens
  // through the storage layer mirror in persist() at line ~700.
  try {
    if (typeof window !== 'undefined' && window.storage && typeof window.storage.set === 'function') {
      primeVitalsCache(d);
      await window.storage.set(SK, JSON.stringify(d));
    } else {
      primeVitalsCache(d);
    }
  } catch (e) {
    console.warn('[saveData] vitals-v4 write failed (non-fatal):', e?.message || e);
  }
}

// ─── AI ───────────────────────────────────────────────────────────────────────
// Phase 0.5 (monolith slice 5) — ai / aiStream / AI_WORKER_* / AI_KEY +
// buildFullPrompt / aiSummary extracted to core/ai.js (imported at the top).

// ─── Blood Panel Reference Ranges ────────────────────────────────────────────
// ─── BM · Blood-marker registry ──────────────────────────────────────────────
// Each entry carries `desc` (Phase 4o.labs.4) — a one-line plain-English
// explainer rendered inline on the lab tile. Keep descriptions ≤ ~90
// chars so they fit two short lines without crowding the sparkline.
// Phase 0.5 (monolith slice 1) — BM + biomarker maps/helpers extracted to
// core/biomarkers.js (imported at the top of this file).
// (BCATS / BCAT_CLR / BCAT_ICO / bStatus / SC / SL / SC_BG / SC_BORDER also live
//  in core/biomarkers.js now — see the import at the top.)

// Phase 0.5 (monolith slice 2) — parseCSV / parseLabCSV / ndate / mapGarmin /
// mapCrono / mergeLogs extracted to core/importParsers.js (imported at the top).

// ─── Weather: uses fetchWeatherForDate from pdfParser.js ─────────────────────

// ─── Utilities ────────────────────────────────────────────────────────────────
// Phase 0.5 (monolith slice 3) — td / fmt / Q / HRV_L / hc / dc / genId /
// calcPace / daysUntil / raceTypeBadge extracted to core/uiFormat.js (imported
// at the top of this file).

const TABS=[
  {id:"training", label:"EdgeIQ",icon:"◈"},
  // Phase 4r.coach.retire — Coach BETA tab retired. The whole architectural
  // direction was "Coach should be ambient, not a tab" (mobile already
  // followed this). The web tab was the holdout duplicating the synthesis
  // surfaces. CoachBeta.jsx kept in tree in case we revive as a diagnostics
  // view; nav + tab render removed.
  {id:"daily",    label:"Daily",  icon:"⊕"},
  {id:"weekly",   label:"Trend",  icon:"◈"},
  {id:"races",    label:"Calendar", icon:"▦"},
  {id:"goals",    label:"Plan",   icon:"◎"},
  {id:"labs",     label:"Labs",   icon:"⬡"},
  {id:"clinical", label:"Core",   icon:"◉"},
  {id:"supplements",label:"Stack",icon:"◈"},
  {id:"settings", label:"Profile",icon:"◎"},
];

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════
export default function App(){
  const [tab,setTab]=useState("training");
  // Phase 4r.calendar.34 — scroll to top of viewport on tab change so users
  // don't land mid-scroll from the previous tab. Calendar opts out (it
  // scrolls to today instead — see CalendarTab.jsx).
  useEffect(() => {
    if (tab === 'races') return;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      // Some layouts use the document element as the scroll root; cover both.
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      const panel = document.querySelector('.arnold-tab-panel');
      if (panel) panel.scrollTop = 0;
    } catch {}
  }, [tab]);
  const [data,setData]=useState(DD);
  const [loading,setLoading]=useState(true);
  const [aiLoad,setAiLoad]=useState(false);
  const [aiResp,setAiResp]=useState("");
  const [aiQ,setAiQ]=useState("");
  const [aiSummLoad,setAiSummLoad]=useState(false);
  const [aiSummStream,setAiSummStream]=useState("");
  const [toast,setToast]=useState("");

  // ── Mobile detection at App level ──
  const [isMobileApp,setIsMobileApp]=useState(()=>window.innerWidth<=600);
  useEffect(()=>{
    const mq=window.matchMedia('(max-width: 600px)');
    const h=e=>setIsMobileApp(e.matches);
    mq.addEventListener('change',h);
    return()=>mq.removeEventListener('change',h);
  },[]);
  const mobileHomeActive=isMobileApp&&(tab==='training'||tab==='weekly');
  const [mobileInitView,setMobileInitView]=useState('start');
  const [mobileMoreOpen,setMobileMoreOpen]=useState(false);

  // ── Phase 4r.intel.29 + 4r.narrative.5.fix.13 — Always land on Start ───
  // Capacitor keeps the WebView alive when the user switches to another
  // app (Slack, camera, etc.) and returns. React state is preserved, so
  // by default the user lands back on whatever tab they were on. The
  // user asked for the app to ALWAYS open to Start, both on cold-start
  // (already correct — useState defaults to 'training' which renders
  // MobileHome with mobileInitView='start') and on resume (this hook).
  //
  // fix.13 (2026-05-27): user reported the resume-to-Start behavior
  // had regressed. Root cause: `document.visibilitychange` alone is
  // unreliable on Android Capacitor WebViews — it can skip firing
  // after quick app switches or when the user returns from the home
  // screen via the recents button. Fix: listen to THREE events so we
  // catch every resume path:
  //   • visibilitychange — primary trigger, works ~80% of the time
  //   • pageshow         — fires on bfcache restore (back-button, swipe)
  //   • focus            — fires when the WebView regains focus
  // We debounce via a `lastResetAt` guard so a single resume doesn't
  // fire the reset 2-3 times (which would also close any open sheet
  // the user JUST opened).
  //
  // Gated on isMobileApp so desktop users keep their current tab when
  // they Cmd-Tab to another window (desktop users actively work
  // across tabs; resetting would be intrusive).
  useEffect(() => {
    if (!isMobileApp) return;
    let lastResetAt = Date.now(); // prevent the initial-mount false-positive
    const RESET_DEBOUNCE_MS = 500;

    const resetToStart = (source) => {
      const now = Date.now();
      if (now - lastResetAt < RESET_DEBOUNCE_MS) return;
      lastResetAt = now;
      // Diagnostic log — visible in DevTools / chrome://inspect so we can
      // verify which event source actually fired the reset on a given
      // device. If the user reports "didn't reset," check console for
      // this line; if it's missing, the WebView isn't dispatching any
      // of the three events on resume on that device.
      // eslint-disable-next-line no-console
      console.log(`%c[arnold-lifecycle] resume → reset to Start (via ${source})`, 'color:#5eead4');
      setTab('training');
      setMobileInitView('start');
      setMobileMoreOpen(false);
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') resetToStart('visibilitychange');
    };
    const onPageShow = (e) => {
      // pageshow fires on every navigation INTO the page, including from
      // bfcache. The `persisted` flag is true only for bfcache restores
      // (back-forward navigation). For our purposes both count as "resume."
      resetToStart(e?.persisted ? 'pageshow:bfcache' : 'pageshow');
    };
    const onFocus = () => resetToStart('focus');

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
    };
  }, [isMobileApp]);

  // ── Mobile nav handler (for drill-down tabs — when MobileHome is NOT active) ──
  const handleMobileNav=(item)=>{
    // Phase 4r.nav.2 — Calendar promoted to primary nav. 'calendar' id
    // routes to the existing 'races' tab (Arnold.jsx tab id is still
    // 'races' for legacy storage compatibility; the UI just labels it
    // Calendar everywhere). Labs moved to the More overflow sheet.
    const tabMap={edgeiq:'weekly',play:'activity',fuel:'nutrition_mobile',core:'clinical',calendar:'races',labs:'labs'};
    if(item.id==='more'){setMobileMoreOpen(true);return;}
    if(tabMap[item.id]){
      // Track which mobile nav triggered this tab so Dashboard can decide
      // whether to render MobileHome (start) or the full EdgeIQ layout
      setMobileInitView(item.id==='edgeiq'?'edgeiq':'start');
      setTab(tabMap[item.id]);
      return;
    }
    // start, sync → go back to MobileHome
    setMobileInitView(item.id==='start'?'start':item.id);
    setTab('training');
  };

  // ── Map current tab to active nav id for mobile ──
  // Phase 4r.nav.2 — 'races' tab now highlights the Calendar nav slot;
  // 'labs' tab routes to More since Labs lives in the overflow sheet.
  const mobileActiveId=(()=>{
    if(tab==='weekly')return'edgeiq';
    if(tab==='activity')return'play';
    if(tab==='nutrition_mobile')return'fuel';
    if(tab==='daily')return'play'; // legacy daily → play
    if(tab==='clinical')return'core';
    if(tab==='races')return'calendar';
    if(tab==='labs'||tab==='goals'||tab==='supplements')return'more';
    return'start';
  })();

  // ── Swipe navigation for drill-down tabs ──
  // Phase 4r.calendar.24 — stale SWIPE_ORDER was still pointing to
  // 'labs' which had been removed from NAV_ITEMS in 4r.nav.2.
  // Result: swiping forward from Core crashed in handleMobileNav
  // (item.id on undefined) because NAV_ITEMS.find returned undefined.
  // Also: Calendar was unreachable via swipe. Now it sits between
  // Fuel and Core per 4r.calendar.24 reorder.
  const SWIPE_ORDER=['start','edgeiq','play','fuel','calendar','core'];
  // Single swipe handler for ALL mobile screens (Start, EdgeIQ, Play, Fuel,
  // Core, Labs). Earlier the gate `!mobileHomeActive` disabled it on Start &
  // EdgeIQ, leaving those screens with no working swipe — and MobileHome.jsx
  // had its own duplicate handler which double-fired on Start. Now there's
  // only one handler in the whole tree, attached to <main>.
  // Phase 4r.calendar.38 — Rebalanced swipe ownership. Yesterday's blanket
  // early-return on Calendar tab killed tab-swipe navigation entirely
  // (can't swipe away from Calendar to Fuel or Core). The correct split:
  //   • Swipe on the calendar GRID → calendar's local handler fires
  //     goNext/goPrev (month change). Its swipeHandlers wrapper calls
  //     stopPropagation, so this page-level handler never sees those
  //     touches.
  //   • Swipe on the calendar HEADER or DRAWER (outside the grid wrapper)
  //     → falls through to this page-level handler → changes tabs.
  // The "stopPropagation is racy in WebView" hypothesis from POSTMORTEMS
  // entry 2026-05-23 turned out to be wrong; the real cause of "calendar
  // swipe doesn't work" was the position-cascade bug eating ALL touches
  // before any handler saw them. With that fixed, stopPropagation works
  // reliably and the early-return is no longer needed.
  const mobileSwipe=useSwipeNav({
    onSwipeLeft:()=>{
      if(!isMobileApp)return;
      const idx=SWIPE_ORDER.indexOf(mobileActiveId);
      if(idx<0)return;
      const next=SWIPE_ORDER[Math.min(idx+1,SWIPE_ORDER.length-1)];
      if(next&&next!==mobileActiveId)handleMobileNav(NAV_ITEMS.find(n=>n.id===next));
    },
    onSwipeRight:()=>{
      if(!isMobileApp)return;
      const idx=SWIPE_ORDER.indexOf(mobileActiveId);
      if(idx<0)return;
      const prev=SWIPE_ORDER[Math.max(idx-1,0)];
      if(prev&&prev!==mobileActiveId)handleMobileNav(NAV_ITEMS.find(n=>n.id===prev));
    },
  });

  useEffect(()=>{
    // Check for incoming sync data
    const syncPayload=checkSyncImport();
    if(syncPayload&&syncPayload!=='local'){applySyncData(syncPayload,showToast);return;}
    // Phase 1: one-shot migration from legacy arnold-memory:* keys to unified arnold:* store
    migrateLegacyStorage();
    migrateSupplementKeys();
    // Phase B Turn 4 (Phase 4r.dataspine.7) — idempotent goals v1→v2
    // migration. Builds nested outcome-only structures (goals.body,
    // goals.recovery, goals.performance, goals.races) from flat v1
    // fields if a user is still on the old schema. Existing v1 fields
    // preserved during compat window; manual calorie/protein targets
    // converted to overrides so user intent isn't lost.
    try {
      const r = migrateGoalsV1ToV2();
      if (r.migrated) {
        // eslint-disable-next-line no-console
        console.log('%c[arnold-migrate] goals v1→v2 applied' +
          (r.overridesCreated?.length ? ` · overrides: ${r.overridesCreated.join(',')}` : ''),
          'background:#1f2a3a;color:#c8d9e6;padding:2px 6px;border-radius:4px;font-weight:600');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[arnold-migrate] migrateGoalsV1ToV2 threw:', e?.message || e);
    }
    // Encryption at rest: decrypt sensitive keys into memory cache, re-encrypt with session key
    initEncryption().catch(e=>console.warn('Encryption init failed, using plaintext fallback',e));
    // Phase 7: hydrate IndexedDB engine, attach, THEN run loadData so the
    // storage-layer union in loadData has actual data to read. Previously
    // loadData fired in parallel with hydrateDB and frequently saw an empty
    // storage layer.
    dbEngine.hydrateDB()
      .then(() => { attachEngine(dbEngine); })
      .catch(e => console.warn('IDB hydration failed, using localStorage', e))
      .then(() => {
        // One-time purge of legacy localStorage backup keys (now in IDB).
        // Safe & idempotent — no-op if localStorage already clean.
        try { purgeLegacyLocalStorageBackups(); } catch (e) { console.warn('[boot] backup purge failed:', e); }
        // Phase 4r.intel.10 — one-shot Layer 2 backfill. Walks every existing
        // activity to seed the learnedBaselines store on first boot after this
        // module ships. Sentinel-guarded inside backfillFromActivities so it
        // doesn't re-run on subsequent boots.
        try {
          const _acts = storage.get('activities') || [];
          const _prof = storage.get('profile')    || {};
          const r = backfillFromActivities(_acts, _prof);
          if (r && !r.skipped) {
            console.log(`[baseline] backfill scanned ${r.scanned} activities, wrote ${r.written}`);
          }
        } catch (e) { console.warn('[boot] baseline backfill failed:', e); }
        // Phase 4r.intel.11-fix — Garmin coords backfill. Stamps
        // startLatitude / startLongitude onto existing activities by re-
        // listing the recent Garmin payload, so Layer 3 predicted bands
        // can find a location to forecast weather against. Sentinel-
        // guarded inside backfillActivityCoords (24h TTL).
        (async () => {
          try {
            const { backfillActivityCoords } = await import('./core/garmin-activities-client.js');
            const r = await backfillActivityCoords({ limit: 50 });
            if (r && r.ok && !r.skipped) {
              console.log(`[garmin-coords] backfill scanned ${r.scanned} activities, updated ${r.updated}`);
            }
          } catch (e) { console.warn('[boot] coords backfill failed:', e?.message || e); }
        })();
        return loadData();
      })
      .then(d=>{
      // SEED_LABS / SEED_CLINICAL only fire on a TRULY first-run install where
      // the storage layer is empty AND there's no cloud-sync paired endpoint
      // queued to deliver real data. Without this guard, an empty pull from
      // the cloud (or a fresh device about to pull) would auto-seed fake labs
      // that masked missing real data — exactly what hid the labSnapshots
      // disappear-and-reappear bug for hours on 2026-04-26.
      const hasStorageLabs = !!(storage.get('labSnapshots') || []).length;
      const hasStorageTests = !!(storage.get('clinicalTests') || []).length;
      const isPaired = !!localStorage.getItem('arnold:cloud-sync:pair-id');
      const needSeed = !d.labSnapshots?.length && !d.clinicalTests?.length
                    && !hasStorageLabs && !hasStorageTests && !isPaired;
      if(needSeed){const s={...d,labSnapshots:SEED_LABS,clinicalTests:SEED_CLINICAL};setData(s);saveData(s);}
      else setData(d);
      setLoading(false);
      // Start auto-backup (every 6 hours)
      startAutoBackup(6 * 60 * 60 * 1000);
      // Health Connect RETIRED (Phase 4r.energy.7) — Garmin (worker) is now the
      // authoritative source for steps/energy/sleep/weight/HR on every platform, so the
      // HC periodic sync is redundant and no longer started. hc-sync.js / hc-bridge.js
      // stay in the tree (parked) for a possible future non-Garmin (Samsung/Fitbit) user.
      // Garmin periodic refresh (Phase 4r.energy.8) — keep TODAY's data (steps/energy/
      // sleep/recovery) fresh without a manual Test pull: boot + app foreground + every
      // 30 min. Replaces the retired HC loop. Runs on every platform; no-op until Garmin
      // is configured. Reloads React state after each successful pull.
      import('./core/garmin-client.js').then(({ startGarminPeriodicSync }) => {
        startGarminPeriodicSync(() => { loadData().then(d2 => setData(d2)); });
      }).catch(e => console.warn('[garmin-periodic] init failed:', e));
      // Phase 4b: dedicated FIT relay polling (60s cadence). Independent of
      // cloud-sync's encrypted-blob round-trip, so a passphrase mismatch or
      // dailyLogs version-lock cannot block FIT propagation. Every device runs
      // both push (when uploading FITs locally) and pull (poll for remotes).
      // Idempotent merge into dailyLogs.fitActivities by activity id/filename.
      startFitPolling(storage,({added,dates})=>{
        if(added>0){
          showToast(`Synced ${added} new FIT activit${added===1?'y':'ies'} from cloud`);
          loadData().then(d2=>setData(d2));
        }
      });
      // ── One-shot migration: null out HC-computed sleep scores ────────────
      // Pre-2026-04-28 HC sync (`hc-sync.js → syncSleep`) was approximating
      // Garmin's proprietary sleep score from stage durations. The values
      // diverged significantly (e.g. HC computed 86 vs Garmin's actual 75).
      // The parser was patched to write `sleepScore: null` on HC records,
      // but historic records still carry the bogus number. Wipe it on boot;
      // user can re-import Garmin Sleep CSV to repopulate with real scores.
      // Idempotent — runs once (we tag with a flag), then never again.
      try {
        const migrationFlag = 'arnold:migration:sleep-score-hc-cleared-2026-04-28';
        if (!localStorage.getItem(migrationFlag)) {
          const sleeps = storage.get('sleep') || [];
          let cleared = 0;
          const cleaned = sleeps.map(s => {
            if (s?.source === 'health_connect' && s.sleepScore != null) {
              cleared++;
              return { ...s, sleepScore: null };
            }
            return s;
          });
          if (cleared > 0) {
            storage.set('sleep', cleaned, { skipValidation: true });
            console.log(`[migrate] cleared ${cleared} HC-computed sleep scores. Re-import Garmin Sleep CSV for real scores.`);
          }
          localStorage.setItem(migrationFlag, '1');
        }
      } catch (e) { console.warn('[migrate] sleep score cleanup failed:', e); }

      // ── One-time migration: clean implausible BMI values from weight rows ──
      // Earlier weight imports occasionally had garbage BMI values (the famous
      // 5306 ghost). The Weekly card already range-guards [10, 60] for display,
      // but the bad data still lives in storage. Walk weight rows once, set
      // bmi=null on any row outside [10, 60]. Idempotent flag.
      try {
        const bmiFlag = 'arnold:migration:bmi-cleanup-2026-04-30';
        if (!localStorage.getItem(bmiFlag)) {
          const weights = storage.get('weight') || [];
          let cleaned = 0;
          const fixed = weights.map(w => {
            if (typeof w?.bmi === 'number' && (w.bmi < 10 || w.bmi > 60)) {
              cleaned++;
              return { ...w, bmi: null };
            }
            return w;
          });
          if (cleaned > 0) {
            storage.set('weight', fixed, { skipValidation: true });
            console.log(`[migrate] cleaned ${cleaned} weight rows with implausible BMI`);
          }
          localStorage.setItem(bmiFlag, '1');
        }
      } catch (e) { console.warn('[migrate] BMI cleanup failed:', e); }

      // ── One-time migration: reclassify Strength activities that have run
      //    distance. The fitParser regression on 2026-04-30 made every
      //    sport='training' activity default to 'Strength' regardless of
      //    subSport — so HIIT runs / interval runs imported between the
      //    regression and the 2026-05-01 fix are sitting in storage with
      //    activityType='Strength' but distanceMi > 0 (which is structurally
      //    impossible for resistance training). Walk the activities collection
      //    once, reclassify any "Strength with distance" record based on
      //    activity name, isRun flag, or as Run by default. ──
      try {
        const hiitFlag = 'arnold:migration:hiit-strength-fix-v2-2026-05-01';
        if (!localStorage.getItem(hiitFlag)) {
          const acts = storage.get('activities') || [];
          let fixed = 0;
          const repaired = acts.map(a => {
            const name = (a.activityName || '').toLowerCase();
            const isHiitName = /\b(hiit|interval|fartlek|cardio|sprint)\b/.test(name);
            const isRunName  = /\b(run|jog|tempo|speed|track)\b/.test(name);

            // Case A: Strength with running distance → reclassify to Run/HIIT
            if (a.activityType === 'Strength' && a.distanceMi > 0.1) {
              fixed++;
              return {
                ...a,
                activityType: isHiitName ? 'HIIT' : 'Run (outdoor)',
                isStrength: false,
                isRun: true,
                isHIIT: isHiitName,
              };
            }
            // Case B: Run with a HIIT-style name → promote to HIIT so it
            // matches planned HIIT slots in Today's Plan
            if ((a.activityType === 'Run (outdoor)' || a.activityType === 'Run (treadmill)') && isHiitName) {
              fixed++;
              return { ...a, activityType: 'HIIT', isHIIT: true, isRun: true };
            }
            return a;
          });
          if (fixed > 0) {
            storage.set('activities', repaired, { skipValidation: true });
            console.log(`[migrate] reclassified ${fixed} activities (Strength→Run/HIIT, Run→HIIT for fartlek/intervals)`);
          }
          localStorage.setItem(hiitFlag, '1');
        }
      } catch (e) { console.warn('[migrate] HIIT/Run reclassify failed:', e); }

      // ── Re-bin HIIT activities' hrZones (Phase 4r.viz.32) ──
      // Pre-Phase 4r.viz.32, the parser refused to fall back to
      // watch-recorded timeInHrZone when bpm-record binning returned null
      // (which happens often for sport=hiit, where the FR955 doesn't
      // always write record samples). Result: HIIT activities ended up
      // with hrZones=null. Now we clear hrZones on stored HIIT activities
      // so the Garmin worker re-fetches and the new parser populates
      // them from the activity DTO. Run on next app load only.
      try {
        const reBinFlag = 'arnold:migration:hiit-hrzones-rebin-2026-05-15';
        if (!localStorage.getItem(reBinFlag)) {
          const acts = storage.get('activities') || [];
          let cleared = 0;
          const updated = acts.map(a => {
            const isHIIT = a.activityType === 'HIIT' || a.isHIIT === true ||
                           /\bhyrox\b/i.test(a.activityName || '');
            if (!isHIIT) return a;
            if (a.hrZones == null) return a;   // already null — worker will fetch
            // Quick sanity: keep the existing array if it sums to a
            // non-trivial duration (>5 min) — that means it's real data.
            const arr = Array.isArray(a.hrZones) ? a.hrZones : [];
            const total = arr.reduce((s, v) => s + (Number(v) || 0), 0);
            if (total > 300) return a;          // looks legit, keep it
            cleared++;
            const { hrZones, ...rest } = a;
            return rest;
          });
          if (cleared > 0) {
            storage.set('activities', updated, { skipValidation: true });
            console.log(`[migrate] cleared empty hrZones from ${cleared} HIIT activities — worker will re-populate on next sync`);
          }
          localStorage.setItem(reBinFlag, '1');
        }
      } catch (e) { console.warn('[migrate] HIIT hrZones rebin failed:', e); }

      // ── HYROX / sport=hiit reclassification (Phase 4r.viz.27) ──
      // FitParser pre-Phase 4r.viz.27 didn't recognize sport==='hiit' or
      // HYROX-named activities — they fell through to 'Other' or got tagged
      // as 'Strength' via the old STRENGTH_RE that included "hyrox". Walk
      // stored activities once, reclassify anything matching HYROX/HIIT
      // sport heuristics to activityType='HIIT' so the activity card
      // routes through the HIIT profile (anaer TE, EPOC, work:rest, etc.).
      try {
        const hyroxFlag = 'arnold:migration:hyrox-hiit-fix-2026-05-15';
        if (!localStorage.getItem(hyroxFlag)) {
          const acts = storage.get('activities') || [];
          let fixed = 0;
          const repaired = acts.map(a => {
            const name = (a.activityName || '').toLowerCase();
            const sport = (a.sport || '').toLowerCase();
            const sub   = (a.subSport || '').toLowerCase();
            const isHyrox = /\bhyrox\b/.test(name);
            const isHiitSport = sport === 'hiit' || sub === 'hiit' || sport === 'cardio';
            if (!isHyrox && !isHiitSport) return a;
            // Only update if it isn't already HIIT.
            if (a.activityType === 'HIIT' && a.isHIIT === true) return a;
            fixed++;
            return {
              ...a,
              activityType: 'HIIT',
              isHIIT: true,
              isRun: a.distanceMi > 0,         // HIIT runs count as runs too
              isStrength: false,
            };
          });
          if (fixed > 0) {
            storage.set('activities', repaired, { skipValidation: true });
            console.log(`[migrate] reclassified ${fixed} HYROX/sport=hiit activities → activityType=HIIT`);
          }
          localStorage.setItem(hyroxFlag, '1');
        }
      } catch (e) { console.warn('[migrate] HYROX HIIT reclassify failed:', e); }

      // ── User-set RHR goal (Phase 4r.cockpit.5) ──
      // User confirmed their target RHR is 42 bpm (lower-is-better goal).
      // Set it in goals storage so the Signal Cockpit RHR tile shows the
      // right progress bar. Guarded by a flag — won't overwrite future
      // edits the user makes via the Goals Hub.
      try {
        const rhrFlag = 'arnold:migration:rhr-goal-42-2026-05-15';
        if (!localStorage.getItem(rhrFlag)) {
          const goals = storage.get('goals') || {};
          if (goals.targetRHR !== 42) {
            storage.set('goals', { ...goals, targetRHR: 42 }, { skipValidation: true });
            console.log(`[migrate] set targetRHR goal to 42 bpm`);
          }
          localStorage.setItem(rhrFlag, '1');
        }
      } catch (e) { console.warn('[migrate] RHR goal set failed:', e); }

      // ── One-time migration: derive sleepStart/wakeTime from GMT timestamps ──
      // Phase 4g added these fields to the Garmin worker normalizer + HC sync,
      // but rows already in storage lack them. Sleep Regularity tile reads
      // sleepStart, so without this backfill the tile stays blank for all
      // historical nights. Idempotent — guarded by a flag so it runs once.
      try {
        const sleepStartFlag = 'arnold:migration:sleep-start-backfill-2026-04-29';
        if (!localStorage.getItem(sleepStartFlag)) {
          const sleepRows = storage.get('sleep') || [];
          const gmtToHHMM = (gmtTs) => {
            if (gmtTs == null) return null;
            const d = new Date(gmtTs);
            if (!Number.isFinite(d.getTime())) return null;
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          };
          let updated = 0;
          const patched = sleepRows.map(r => {
            if (!r) return r;
            // Skip if already has sleepStart (newly-pulled rows)
            if (r.sleepStart) return r;
            const start = gmtToHHMM(r.sleepStartTimestampGMT);
            const wake  = gmtToHHMM(r.sleepEndTimestampGMT);
            if (!start && !wake) return r;
            updated++;
            return { ...r, sleepStart: start || null, wakeTime: wake || null };
          });
          if (updated > 0) {
            storage.set('sleep', patched, { skipValidation: true });
            console.log(`[migrate] derived sleepStart on ${updated} sleep rows from GMT timestamps`);
          }
          localStorage.setItem(sleepStartFlag, '1');
        }
      } catch (e) { console.warn('[migrate] sleepStart backfill failed:', e); }

      // ── One-time migration: clear locally-binned hrZones (Phase 4r.zones.1) ──
      // FIT parser used to fall back to %HRmax binning when the session
      // didn't ship a time-in-zone array. That ignored the user's
      // custom bpm zone boundaries from Garmin Connect (most users
      // have these), producing displays 1-2 zones too high. The bad
      // hrZones values then blocked the Garmin worker from re-fetching
      // authoritative ones (it skips activities where hrZones != null).
      //
      // FIT activities live in TWO places: the activities collection
      // (rare — only when an upstream pipeline pushed them there) and
      // dailyLogs[].fitActivities[] (the standard upload path via the
      // Today's Training UploadPill). Clean both. The Garmin worker
      // path uses source.activityId to fetch the activity DTO, which
      // re-populates hrZones from Garmin's authoritative bpm zones.
      try {
        const zoneFlag = 'arnold:migration:fit-hrzones-cleared-2026-05-09';
        if (!localStorage.getItem(zoneFlag)) {
          let cleared = 0;
          // 1) activities collection
          const acts = storage.get('activities') || [];
          const cleanedActs = acts.map(a => {
            if (!a) return a;
            const isFitSource = a.source === 'fit-daily'
              || (a.source && typeof a.source === 'object' && a.source.type === 'fit');
            if (isFitSource && Array.isArray(a.hrZones)) {
              cleared++;
              const { hrZones, ...rest } = a;
              return rest;
            }
            return a;
          });
          if (cleared > 0) {
            storage.set('activities', cleanedActs, { skipValidation: true });
          }
          // 2) dailyLogs[].fitActivities[]
          const logs = storage.get('dailyLogs') || [];
          let logsTouched = 0;
          const cleanedLogs = logs.map(log => {
            if (!log) return log;
            const fits = Array.isArray(log.fitActivities) ? log.fitActivities : null;
            if (!fits || fits.length === 0) return log;
            let logChanged = false;
            const cleanedFits = fits.map(fd => {
              if (fd && Array.isArray(fd.hrZones)) {
                cleared++;
                logChanged = true;
                const { hrZones, ...rest } = fd;
                return rest;
              }
              return fd;
            });
            if (logChanged) {
              logsTouched++;
              return { ...log, fitActivities: cleanedFits };
            }
            return log;
          });
          if (logsTouched > 0) {
            storage.set('dailyLogs', cleanedLogs, { skipValidation: true });
          }
          if (cleared > 0) {
            console.log(`[migrate] cleared locally-binned hrZones from ${cleared} FIT activities — Garmin worker will re-populate authoritative bpm zones on next sync`);
          }
          localStorage.setItem(zoneFlag, '1');
        }
      } catch (e) { console.warn('[migrate] hrZones cleanup failed:', e); }

      // ── One-time migration: scrub bogus BMI from HC weight rows
      //    + force HC weight re-sync to pull intra-day weigh-ins
      //    (Phase 4r.energy.2). Old HC sync wrote bmi = weight/feet²×703
      //    which produced ~5300 instead of ~27. Tile filter masked it
      //    in the UI, but any code reading bmi directly would have
      //    blown up. Reset bmi to null where impossible, and clear the
      //    HC weight sync flag so next sync pulls all readings (the
      //    new path dedupes by (date,time) so AM + PM both persist).
      try {
        const wFlag = 'arnold:migration:hc-weight-bmi-cleared-2026-05-10';
        if (!localStorage.getItem(wFlag)) {
          const rows = storage.get('weight') || [];
          let cleaned = 0;
          const fixed = rows.map(r => {
            if (!r) return r;
            const b = Number(r.bmi);
            if (Number.isFinite(b) && (b < 10 || b > 60)) {
              cleaned++;
              return { ...r, bmi: null };
            }
            return r;
          });
          if (cleaned > 0) {
            storage.set('weight', fixed, { skipValidation: true });
            console.log(`[migrate] nulled ${cleaned} bogus BMI values on weight rows`);
          }
          // Reset HC weight sync timestamp so a backfill re-pulls all
          // intra-day weigh-ins from Health Connect.
          try {
            localStorage.removeItem('hcSyncLastTime_weight');
            localStorage.removeItem('arnold:hc-sync:weight:lastTime');
          } catch {}
          localStorage.setItem(wFlag, '1');
        }
      } catch (e) { console.warn('[migrate] HC weight BMI cleanup failed:', e); }

      // ── Build version stamp ──
      // Bump the suffix every time you change code that affects sync semantics
      // (syncDailyEnergy target collection, dailyLogs schema, etc). Lets us
      // verify desktop and phone are running the SAME bundle by comparing
      // these stamps in their consoles.
      console.log('%c[arnold-build] Phase 4r.intel.upgrade.9 · Every Health System now has a Coach voice. Gut/Bones/Immune signal maps broadened to adjacent signals (gut: glycogen+EA+TDEE drift+monotony; bones: +goalProgress; immune: +recoveryVelocity). Added FALLBACK voice composer — when no Coach signals fire for a system, returns a tailored per-system neutral line instead of silence. Honest about thin signal coverage (e.g., gut says: "Real gut-specific signals — fiber rhythm, meal cadence — are a future build"). Panel renders Coach line whenever coachRead exists; tile grid only when signals fire. No system goes silent. 2026-05-28','background:#1f3a1f;color:#c8e6c9;padding:2px 6px;border-radius:4px;font-weight:600');
      // Phase 4r.narrative.2 + 2.1 — eager-import the composer + scenario
      // fixtures so window.narrativeDebug() and window.narrativeScenarios()
      // are registered at boot, even before the user opens the Coach tab.
      try { import('./core/narrativeComposer.js'); } catch {}
      try { import('./core/narrativeScenarios.js'); } catch {}
      // Phase 4r.process.5 — expose storage on window so debug helpers can
      // read through the IndexedDB-aware abstraction instead of bypassing
      // it via localStorage (which the Phase 7 engine no longer mirrors
      // for every collection). The previous proteinTileDebug reported
      // 0 nutritionLog rows because it read localStorage directly while
      // the actual data lived in IndexedDB.
      try { window.__arnoldStorage = storage; } catch {}

      // ── Phase 4r.process.1 — Boot-time state fingerprint ──
      // Single block of logs printing the canonical "state of the system"
      // at boot. When the user reports a bug, asking for a console
      // screenshot now surfaces the entire context (build, viewport,
      // storage counts, intelligence verdict, derived targets, active
      // overrides) in one shot — no more guessing whether the build is
      // current, whether data is present, or what state the model
      // computed. See arnold-app/SMOKE_TESTS.md.
      try {
        const _vp = `${window.innerWidth}×${window.innerHeight}`;
        const _isMobile = window.innerWidth <= 600;
        const _activities = (storage.get('activities') || []).length;
        const _sleep      = (storage.get('sleep')      || []).length;
        const _hrv        = (storage.get('hrv')        || []).length;
        const _weight     = (storage.get('weight')     || []).length;
        const _nutLog     = (storage.get('nutritionLog') || []).length;
        // Intelligence + goalModel (best-effort — these may not be
        // populated yet on first boot if storage hydration is in flight)
        let _intel = null, _targets = null, _overrides = null;
        try {
          _intel = computeUserState({
            activities: storage.get('activities') || [],
            sleep:      storage.get('sleep')      || [],
            hrv:        storage.get('hrv')        || [],
            weight:     storage.get('weight')     || [],
            cronometer: storage.get('cronometer') || [],
            profile:    storage.get('profile')    || {},
          });
        } catch {}
        try { _targets   = getDerivedTargets(); }  catch {}
        try { _overrides = getDerivedOverrides(); } catch {}
        const _fmtBurdens = _intel?.burdens?.join(', ') || 'none';
        const _calCheck = _targets?.dailyCalories;
        const _proCheck = _targets?.dailyProtein;
        const _ovCount  = _overrides ? Object.keys(_overrides).length : 0;
        const _lblStyle = 'color:#a0e0d0;font-weight:600';
        const _valStyle = 'color:#c0c0c0;font-weight:400';
        console.log('%c[arnold-state] %cviewport: ' + _vp + ' · isMobile: ' + _isMobile, _lblStyle, _valStyle);
        console.log('%c[arnold-state] %cstorage: ' + _activities + ' activities · ' + _sleep + ' sleep · ' + _hrv + ' hrv · ' + _weight + ' weight · ' + _nutLog + ' nutritionLog entries', _lblStyle, _valStyle);
        // Phase 4r.signals.10 — storage-write counter. Verifies the change-
        // listener machinery is alive. Increments on every storage.set (Garmin
        // sync, Cronometer entry, weight, manual log). At boot this is the
        // count accumulated by any sync writes that have already fired.
        console.log('%c[arnold-state] %cstorage write count (since boot): ' + getStorageWriteCount(), _lblStyle, _valStyle);
        if (_intel) {
          const _n = _intel.numbers || {};
          console.log('%c[arnold-state] %cintelligence: phase=' + _intel.phase + ' · trajectory=' + _intel.trajectory + ' · recoveryDebt=' + _intel.recoveryDebt + '/3', _lblStyle, _valStyle);
          console.log('%c[arnold-state] %cburdens: ' + _fmtBurdens, _lblStyle, _valStyle);
          console.log('%c[arnold-state] %ctrust: garminBurn=' + _intel.trust?.garminBurn + ' · intakeLog=' + _intel.trust?.intakeLog + ' · rmrModel=' + _intel.trust?.rmrModel, _lblStyle, _valStyle);
          // Phase 4r.intel.20 — surface the new Layer 1 aggregates so we
          // can verify burdens are firing on the expected inputs.
          console.log('%c[arnold-state] %csleep: 7d=' + (_n.sleepAvg7d ?? '—') + 'h · 14d=' + (_n.sleepAvg14d ?? '—') + 'h · 21d=' + (_n.sleepAvg21d ?? '—') + 'h · goal=' + (_n.sleepGoalHrs ?? '—') + 'h', _lblStyle, _valStyle);
          console.log('%c[arnold-state] %chrv: latest=' + (_n.hrvLatest ?? '—') + 'ms · baseline14d=' + (_n.hrvBaseline14d ?? '—') + 'ms · suppressedDays=' + (_n.hrvSuppressedDays ?? 0), _lblStyle, _valStyle);
          console.log('%c[arnold-state] %crhr: latest=' + (_n.rhrLatest ?? '—') + 'bpm · baseline14d=' + (_n.rhrBaseline14d ?? '—') + 'bpm · elevatedDays=' + (_n.rhrElevatedDays ?? 0), _lblStyle, _valStyle);
          console.log('%c[arnold-state] %cprotein7d=' + (_n.proteinAvg7d ?? '—') + 'g · daysSinceLastActivity=' + (_n.daysSinceLastActivity ?? '—'), _lblStyle, _valStyle);
          // Phase 4r.intel.21 — surface active goal-conflicts so the
          // user can verify which cross-domain incompatibilities the
          // detector found (or didn't).
          const _conflicts = Array.isArray(_intel.goalConflicts) ? _intel.goalConflicts : [];
          if (_conflicts.length) {
            const _cflist = _conflicts.map(c => `${c.id}(${c.severity})`).join(' · ');
            console.log('%c[arnold-state] %cconflicts: ' + _cflist, _lblStyle, _valStyle);
          } else {
            console.log('%c[arnold-state] %cconflicts: none', _lblStyle, _valStyle);
          }
          const _ak = _intel.activeGoalKinds || {};
          const _activeStr = Object.keys(_ak).filter(k => _ak[k]).join(', ') || 'none';
          console.log('%c[arnold-state] %cactive goal kinds: ' + _activeStr, _lblStyle, _valStyle);
        }
        if (_targets) {
          console.log('%c[arnold-state] %cderived targets: ' + (_calCheck?.effective ?? '—') + ' kcal (' + (_calCheck?.source || '—') + ') · ' + (_proCheck?.effective ?? '—') + 'g protein (' + (_proCheck?.source || '—') + ')', _lblStyle, _valStyle);
        }
        console.log('%c[arnold-state] %coverrides active: ' + (_ovCount > 0 ? _ovCount + ' (' + Object.keys(_overrides).join(', ') + ')' : 'none'), _lblStyle, _valStyle);
        // Phase 4r.process.2 — coach health probe. Surfaces silent rule
        // errors (ReferenceErrors swallowed by try/catch in the rule loop)
        // as a count in the boot fingerprint. Smoke test becomes: "is the
        // error count zero?" — would have caught the `dyn is not defined`
        // regression on first reload instead of waiting for a screenshot.
        try {
          const _pHealth = runCoachingPromptsHealthProbe();
          const _pErrStr = _pHealth.errors.length
            ? _pHealth.errors.map(e => `${e.name}:${e.message}`).join(' · ')
            : 'none';
          const _pStyle = _pHealth.errors.length
            ? 'color:#ff8c8c;font-weight:600'
            : _valStyle;
          console.log(
            '%c[arnold-state] %ccoach prompts: ' + _pHealth.totalRules + ' rules · ' + _pHealth.fires + ' fired · ' + _pHealth.errors.length + ' errors (' + _pErrStr + ')',
            _lblStyle, _pStyle
          );
          if (_intel) {
            const _bHealth = runCoachBriefsHealthProbe(_intel);
            const _bErrStr = _bHealth.errors.length
              ? _bHealth.errors.map(e => `${e.name}:${e.message}`).join(' · ')
              : 'none';
            const _bStyle = _bHealth.errors.length
              ? 'color:#ff8c8c;font-weight:600'
              : _valStyle;
            console.log(
              '%c[arnold-state] %ccoach briefs: ' + _bHealth.totalPatterns + ' patterns · ' + _bHealth.fires + ' fired · ' + _bHealth.errors.length + ' errors (' + _bErrStr + ')',
              _lblStyle, _bStyle
            );
          }
        } catch (e) {
          console.warn('[arnold-state] coach health probe failed:', e?.message || e);
        }
        console.log('%c[arnold-state] %cdocs: window.narrativeDebug() · window.narrativeScenarios() · window.intelligenceDebug() · window.coachSignalsDebug() · window.coachBriefsDebug() · window.coachActivitiesDebug() · window.goalModelDebug() · window.energyBalanceDebug() · window.proteinTileDebug() · window.racePredictorDebug() · window.mealTimingDebug() · window.backfillCronometerMeals() · window.shortRaceNameDebug()', _lblStyle, _valStyle);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[arnold-state] fingerprint failed:', e?.message || e);
      }
      // Phase 4r.intel.5 — to debug why a tile is painting a color, run this in
      // the browser console then re-click an activity:
      //   window.__INTEL_DEBUG__ = true
      // Every _paintM call will log: metric, value, status, band, family, conditions.

      // ── Garmin Wellness backfill (Phase 4c) ──
      // If the user has configured Garmin credentials + the Cloud Sync Worker,
      // pull any recent dates where sleepScore is null. The HC migration in
      // Phase 4b cleared bogus sleep scores — this hook fills them back in
      // with Garmin's authoritative composite score (the same number Garmin
      // Connect/the watch shows).
      //
      // Idempotent: backfillRecentBlanks only re-pulls dates without a
      // garmin-worker row. Errors are swallowed so a Garmin outage doesn't
      // stall app boot — failures surface in the Cloud Sync card UI.
      // Run once-per-day so we don't hammer the worker on every reload:
      // a single ISO-day key in localStorage gates re-runs.
      try {
        // Phase 4r.utc.1 — use local date for daily flag keys.
        // toISOString().slice(0,10) returns UTC date; in evening ET that's
        // already tomorrow, so the flag was set for the wrong day and the
        // sync could re-fire across midnight.
        const gFlag = `arnold:garmin-backfill:${td()}`;
        if (!localStorage.getItem(gFlag)) {
          // Fire-and-forget — don't block boot.
          import('./core/garmin-client.js').then(({ isGarminConfigured, backfillRecentBlanks, fetchGarminVO2Max }) => {
            if (!isGarminConfigured()) return;
            return backfillRecentBlanks({ daysBack: 14 })
              .then(r => {
                if (r?.ok) {
                  const filled = (r.results || []).filter(x => x.ok && x.sleepScore != null).length;
                  console.log(`[garmin-backfill] attempted=${r.attempted} filled=${filled}`);
                }
                // Also pull current watch VO2Max so Start summary stays fresh.
                return fetchGarminVO2Max();
              })
              .then(vo2 => {
                if (vo2?.ok && vo2?.vo2max) {
                  console.log('[garmin-vo2max]', vo2.vo2max);
                }
                localStorage.setItem(gFlag, '1');
              })
              .catch(e => console.warn('[garmin-backfill] failed:', e));
          });
        }
      } catch (e) { console.warn('[garmin-backfill] init failed:', e); }

      // Phase 4r.calendar.fix.7 — one-shot typeKey backfill.
      // The retired Garmin parser block silently rewrote Run-menu Fartlek /
      // interval / sprint runs to activityType='HIIT' before today's fix.
      // Legacy records carry no garminTypeKey, so the classifier can't
      // distinguish a corrupted Fartlek-Run from a genuine HIIT session.
      // The only reliable recovery is to re-pull each affected activity
      // from Garmin so the fixed parser populates garminTypeKey from the
      // structured menu choice. Sentinel-gated: runs exactly ONCE after
      // this build deploys, in the background, on a fresh launch. Window
      // is 60 days so multi-month history catches up (Garmin Worker is
      // rate-limited but 60d × typical training freq stays under 100 acts).
      try {
        const RESYNC_KEY = 'arnold:garmin-typeKey-backfill-v1';
        if (!localStorage.getItem(RESYNC_KEY)) {
          Promise.all([
            import('./core/garmin-activities-client.js'),
            import('./core/garmin-client.js'),
          ]).then(([acts, client]) => {
            if (!client.isGarminConfigured?.()) return;
            console.log('[typeKey-backfill] starting one-shot re-sync of last 60 days to populate garminTypeKey…');
            return acts.resyncPastActivities(60, 100).then(r => {
              if (r?.ok) {
                console.log(`[typeKey-backfill] ✓ refreshed ${r.successful}/${r.attempted} activities; ` +
                  `classifier now has Garmin\'s structured menu choice for the last 60 days.`);
                showToast?.(`✓ Re-synced ${r.successful} past activities — Fartlek vs HIIT now correctly distinguished`);
                localStorage.setItem(RESYNC_KEY, String(Date.now()));
              } else {
                console.warn('[typeKey-backfill] resync failed:', r?.error);
              }
            }).catch(e => console.warn('[typeKey-backfill] threw:', e?.message || e));
          });
        }
      } catch (e) { console.warn('[typeKey-backfill] init failed:', e); }

      // ── Garmin Activity auto-sync (Phase 4d) ──
      // Same once-per-day pattern as wellness backfill. Pulls the last 14 days
      // of activities (runs / strength / etc.), dedupes against existing
      // imports, and parses any new ones via the existing fitParser.
      // Manual FIT upload remains available as a fallback / one-off path.
      try {
        const aFlag = `arnold:garmin-activities-sync:${td()}`;  // Phase 4r.utc.1 — local date
        if (!localStorage.getItem(aFlag)) {
          import('./core/garmin-activities-client.js').then(({ syncRecentActivities }) => {
            return import('./core/garmin-client.js').then(({ isGarminConfigured }) => {
              if (!isGarminConfigured()) return;
              return syncRecentActivities({ daysBack: 14, limit: 30 })
                .then(r => {
                  if (r?.ok) {
                    console.log(`[garmin-activities] candidates=${r.candidates} skipped=${r.skipped} new=${r.successful}${r.failed ? ' failed=' + r.failed : ''}`);
                  }
                  localStorage.setItem(aFlag, '1');
                })
                .catch(e => console.warn('[garmin-activities] sync failed:', e));
            });
          });
        }
      } catch (e) { console.warn('[garmin-activities] init failed:', e); }

      // ── Cronometer meal-rows backfill (Phase 4r.signals.1) ───────────────
      // The Worker has been caching daily row arrays under cronometerLive for
      // ~14 days; until this phase those rows were only used for diagnostics
      // — never written to nutritionLog. Now that Pre-Training Carbs +
      // Post-Training Protein + meal-timing signals need per-meal timestamps,
      // backfill from the cache so historical days fill in without re-pulling
      // the Worker. Idempotent + cheap (in-memory dedupe by id prefix).
      try {
        const mFlag = `arnold:crono-meal-backfill:1`; // once-ever, not per-day — cache covers 14d window
        if (!localStorage.getItem(mFlag)) {
          import('./core/cronometer-client.js').then(({ backfillCronometerMealsFromCache }) => {
            const r = backfillCronometerMealsFromCache();
            if (r.totalRowsAdded > 0) {
              console.log(`[cronometer-meals] backfill: ${r.daysProcessed} days · ${r.totalRowsAdded} meal rows`);
            }
            localStorage.setItem(mFlag, '1');
          }).catch(e => console.warn('[cronometer-meals] backfill failed:', e));
        }
      } catch (e) { console.warn('[cronometer-meals] init failed:', e); }

      // ── Garmin weight direct sync (Phase 4r.energy.4) ────────────────────
      // Pull body-composition readings (weight, BF%, muscle mass, bone mass,
      // body water %, with sample timestamps) straight from Garmin via the
      // Cloud Sync Worker. Replaces the Health Connect path, which was
      // collapsing same-day weigh-ins and stripping body-comp fields.
      //
      // Throttle lives inside garmin-weight-client.js (30-min timestamp TTL,
      // Phase 4r.energy.7). Boot calls without force — the client's own
      // gate decides whether to hit the network. Pull-to-refresh in
      // full-sync.js passes force:true to bypass. No more per-day flag,
      // no more UTC/local-date mismatch.
      try {
        import('./core/garmin-weight-client.js').then(({ syncRecentWeight }) => {
          return syncRecentWeight({ daysBack: 30 })
            .then(r => {
              if (r?.ok && r?.skipped !== 'fresh') {
                console.log(`[garmin-weight] fetched=${r.fetched} added=${r.added} replaced=${r.replaced || 0} skipped=${r.skipped}`);
              } else if (r?.error && r.error !== 'not_configured' && r.error !== 'no_config') {
                if (!String(r.error).startsWith('http_404')) {
                  console.warn('[garmin-weight] sync:', r.error, r.detail || '');
                }
              }
            })
            .catch(e => console.warn('[garmin-weight] sync failed:', e));
        });
      } catch (e) { console.warn('[garmin-weight] init failed:', e); }

      // ── HR zone bpm boundaries (Phase 4r.zones.2) ───────────────────────
      // Cache the user's Garmin Connect HR zone configuration into
      // profile.hrZoneBpm so derive/hr.js zoneForHr() can bin against
      // the same bpm boundaries Garmin uses. TTL'd weekly; fails silently
      // if the worker endpoint isn't deployed yet — Arnold will simply
      // fall back to %HRmax until /garmin/user/hr-zones lands.
      //
      // After cache lands (or if we already have it), Phase 4r.zones.3
      // re-bins recent activities' hrZones against those boundaries by
      // re-fetching their FIT files. Garmin's API hrTimeInZone uses
      // %HRmax — different from Connect UI's bpm zones — so the only
      // way to actually MATCH Connect is to bin raw records ourselves.
      try {
        import('./core/garmin-activities-client.js').then((mod) => {
          const { fetchAndCacheHrZones, applyAdaptiveZonesIfDue, reBinActivitiesWithBpmZones, hasRebinnedAgainstBpm } = mod;
          return fetchAndCacheHrZones().then(r => {
            if (r?.ok && !r.cached) {
              console.log('[arnold] cached Garmin HR zones', r.hrZoneBpm);
            } else if (r && r.error && r.error !== 'not_configured') {
              console.warn('[arnold] HR zone fetch:', r.error, r.detail || '');
            }
            // Phase 4r.zones.4 — adaptive Karvonen recompute (only fires
            // when source: 'karvonen' is set on profile.hrZoneBpm; the
            // user opts in by manually selecting Karvonen, after which
            // zones track RHR drift on a weekly cadence).
            return applyAdaptiveZonesIfDue();
          }).then(adapt => {
            if (adapt?.updated) {
              const cf = adapt.after?.computedFrom || {};
              console.log(
                `[arnold] Karvonen zones updated (RHR=${cf.restingHR}, maxHR=${cf.maxHR}, drift=${adapt.maxDrift}bpm)`,
                adapt.drifts.map(d => `${d.zone}: ${d.old}→${d.next}`).join('  ')
              );
            } else if (adapt?.reason === 'within_threshold') {
              console.log(`[arnold] zones checked — within ${adapt.maxDrift}bpm of cached, no update (RHR=${adapt.restingHR})`);
            }
            // Re-bin trigger: runs if we have bpm boundaries cached AND
            // either we've never rebinned, OR the adaptive update just
            // cleared the flag because zones drifted.
            const profile = window.__arnoldStorage?.get('profile') || {};
            if (profile.hrZoneBpm && !hasRebinnedAgainstBpm()) {
              console.log('[arnold] re-binning recent activities against custom bpm zones…');
              return reBinActivitiesWithBpmZones({ daysBack: 30 }).then(rb => {
                if (rb?.ok && rb.rebinned > 0) {
                  console.log(`[arnold] re-binned ${rb.rebinned}/${rb.attempted} activities to bpm-custom zones`);
                } else if (rb && rb.error) {
                  console.warn('[arnold] re-bin:', rb.error);
                }
              });
            }
          });
        });
      } catch (e) { console.warn('[arnold] HR zone fetch init failed:', e); }


      // ── One-time migration: labSnapshots + clinicalTests → storage layer ──
      // Originally these lived only in the vitals-v4 blob (loadData),
      // which means they NEVER cloud-synced to paired devices. Lift them
      // into the storage layer so cloud-sync can carry them. The check
      // is idempotent: only seed the storage key if it's empty AND the
      // blob has data, so existing storage state never gets overwritten.
      try{
        const sLabs=storage.get('labSnapshots');
        if((!sLabs||!sLabs.length)&&Array.isArray(d.labSnapshots)&&d.labSnapshots.length){
          storage.set('labSnapshots',d.labSnapshots,{skipValidation:true});
          console.log(`[migrate] seeded ${d.labSnapshots.length} lab snapshots to storage layer`);
        }
        const sTests=storage.get('clinicalTests');
        if((!sTests||!sTests.length)&&Array.isArray(d.clinicalTests)&&d.clinicalTests.length){
          storage.set('clinicalTests',d.clinicalTests,{skipValidation:true});
          console.log(`[migrate] seeded ${d.clinicalTests.length} clinical tests to storage layer`);
        }
      }catch(e){console.warn('[migrate] labs/tests migration failed:',e);}
      // One-time idempotent cleanup of historical HC-sourced entries in the
      // activities collection. syncExercise was disabled in Phase 4a but
      // entries from prior versions persist with `source: 'health_connect'`
      // and inflate weekly mileage on the desktop view. This loop drops them
      // and writes back ONLY if anything was removed (no-op on later boots).
      try{
        const acts=storage.get('activities')||[];
        // Filter 1: HC-sourced ghost entries (Phase 4a legacy).
        // Filter 2: Resort Skiing entries dated 2025-12-XX — these are the
        // misdated ski sessions caused by the activitiesParser US-format
        // bug (now fixed). All real Resort Skiing happened in 2026 per
        // user's verified Garmin export. Any pre-2026 ski rows are stale
        // imports that should be dropped.
        const cleaned=acts.filter(a=>{
          if(!a)return false;
          if(a.source==='health_connect')return false;
          const isStaleSki=/ski/i.test(a.activityType||'')&&(a.date||'').startsWith('2025-');
          if(isStaleSki)return false;
          return true;
        });
        if(cleaned.length!==acts.length){
          console.log(`[boot-cleanup] purged ${acts.length-cleaned.length} stale activity rows (HC ghosts + misdated ski)`);
          storage.set('activities',cleaned,{skipValidation:true});
        }
      }catch(e){console.warn('[boot-cleanup] activities purge failed:',e);}
      // ── Temporary diagnostic for the 12.9-mile inflation bug ──
      // Prints a per-day breakdown of this week's runs from BOTH the
      // activities collection and dailyLogs.fitActivities[]. Deferred 3s
      // so the AES-GCM encryption layer is fully initialized — dailyLogs
      // is encrypted at rest and reads return empty before init.
      // Also exposes window.diagnoseRuns() so it can be called manually.
      const runDiagnostic=()=>{
        try{
          const localDateStr=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const now=new Date();
          const monday=new Date(now);
          monday.setDate(now.getDate()-(now.getDay()||7)+1);
          monday.setHours(0,0,0,0);
          const inWeek=ds=>new Date(ds+'T12:00:00')>=monday;
          const acts=storage.get('activities')||[];
          const logs=storage.get('dailyLogs')||[];
          const csvRuns=acts.filter(a=>isRunAct(a)&&a.date&&inWeek(a.date));
          const fitRuns=[];
          for(const l of logs){
            if(!l?.date||!inWeek(l.date))continue;
            const fits=Array.isArray(l.fitActivities)&&l.fitActivities.length?l.fitActivities:(l.fitData?[l.fitData]:[]);
            for(const fd of fits){
              if(isRunAct(fd))fitRuns.push({date:l.date,...fd});
            }
          }
          console.group('[diag] Weekly run inventory');
          console.log('Week starts:',localDateStr(monday));
          console.log(`activities collection size: ${acts.length}`);
          console.log(`dailyLogs collection size: ${logs.length}`);
          console.log(`From activities (this week, runs only): ${csvRuns.length}`);
          console.table(csvRuns.map(a=>({date:a.date,type:a.activityType,miles:a.distanceMi,source:a.source,title:a.title})));
          console.log(`From dailyLogs.fitActivities (this week, runs only): ${fitRuns.length}`);
          console.table(fitRuns.map(a=>({date:a.date,type:a.activityType,miles:a.distanceMi,duration:a.durationSecs||a.durationMins,startTime:a.startTime||a.time})));
          const csvTotal=csvRuns.reduce((s,a)=>s+(a.distanceMi||0),0);
          const fitTotal=fitRuns.reduce((s,a)=>s+(a.distanceMi||0),0);
          console.log(`csvRuns total: ${csvTotal.toFixed(2)} mi · fitRuns total: ${fitTotal.toFixed(2)} mi · combined: ${(csvTotal+fitTotal).toFixed(2)} mi`);
          console.log('Today\'s dailyLogs row:',logs.find(l=>l.date===localDateStr(now))||'(none)');
          console.groupEnd();
        }catch(e){console.warn('[diag] weekly run inventory failed:',e);}
      };
      // Run after encryption is online (typical init takes ~500ms).
      setTimeout(runDiagnostic,3000);
      // Also expose it for manual re-runs after data changes.
      try{window.diagnoseRuns=runDiagnostic;}catch{}

      // ── Activities-collection auditor ──
      // Why: user sees 87 YTD workouts but expects 32. Likely culprit is
      // duplicate rows from re-imported CSVs or lap-split rows. This dumps
      // the breakdown by year + activityType + dedup-by-(date,type,start)
      // so we can see exactly what's in there.
      const auditActivities=()=>{
        try{
          const acts=storage.get('activities')||[];
          const byYear={},byType={},byDateType={};
          for(const a of acts){
            const y=(a.date||'').slice(0,4)||'(no date)';
            byYear[y]=(byYear[y]||0)+1;
            const t=a.activityType||a.title||'(no type)';
            byType[t]=(byType[t]||0)+1;
            const k=`${a.date}|${(a.activityType||a.title||'')}`;
            byDateType[k]=(byDateType[k]||0)+1;
          }
          const dupes=Object.entries(byDateType).filter(([,n])=>n>1).sort((a,b)=>b[1]-a[1]).slice(0,15);
          // Filter test: simulate what the UI's YTD filter is doing.
          const yearStart=new Date(new Date().getFullYear(),0,1);
          const ytdViaDate=acts.filter(a=>a.date&&new Date(a.date)>=yearStart);
          const ytdViaString=acts.filter(a=>a.date&&(a.date+'').slice(0,4)===String(new Date().getFullYear()));
          // Sample of 2025 entries — what does new Date(a.date) actually parse to?
          const sample2025=acts.filter(a=>(a.date||'').startsWith('2025')).slice(0,3).map(a=>({raw:a.date,parsed:new Date(a.date).toString()}));
          console.group('[audit] activities collection');
          console.log('Total rows:',acts.length);
          console.log('By year:',byYear);
          console.log('By activityType (top 10):',Object.fromEntries(Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,10)));
          console.log(`Duplicate (date|type) keys: ${dupes.length} groups (showing top 15)`);
          if(dupes.length){
            console.table(dupes.map(([k,n])=>({key:k,count:n})));
            const dupCount=dupes.reduce((s,[,n])=>s+n-1,0);
            console.log(`Excess rows from duplicates: ~${dupCount}`);
          }
          console.log(`YTD count via "new Date(a.date) >= yearStart": ${ytdViaDate.length}`);
          console.log(`YTD count via string slice "2026": ${ytdViaString.length}`);
          console.log('yearStart =',yearStart.toString());
          console.log('Sample 2025 entries — raw date vs parsed:');
          console.table(sample2025);
          console.groupEnd();
        }catch(e){console.warn('[audit] failed:',e);}
      };
      setTimeout(auditActivities,3500);
      try{window.auditActivities=auditActivities;}catch{}

      // Manual wipe helper — used during the parser-bug recovery so you can
      // clear the activities collection cleanly via the storage layer (which
      // bumps version + triggers cloud-sync push) rather than localStorage.
      // Usage: wipeActivities()  → returns count wiped, then re-import CSV.
      try{
        window.wipeActivities=()=>{
          const before=(storage.get('activities')||[]).length;
          storage.set('activities',[],{skipValidation:true});
          console.log(`[wipe] cleared ${before} activities. Re-import the CSV next.`);
          return before;
        };
        // Also expose storage itself so future ad-hoc inspection is easy.
        window.__arnoldStorage=storage;
        // Expose the unified activity merge so we can diagnose count mismatches
        // between storage.get('activities') and what the dashboard actually uses.
        window.__allActs=_allActs;
        // Manual labs migration — bypasses the auto-condition entirely.
        // Reads vitals-v4 directly via window.storage and writes to the
        // storage layer (which triggers cloud-sync push). Use when the
        // boot-time auto-migration silently no-op'd.
        window.migrateLabsNow=async()=>{
          try{
            // Try every storage path the legacy code uses, in order:
            //  1. plain localStorage (web default)
            //  2. window.storage shim (Capacitor native)
            //  3. data prop already in React state (cached form)
            let blob=null;
            let source='';
            // Path 1: localStorage
            try{
              const raw=typeof localStorage!=='undefined'?localStorage.getItem(SK):null;
              if(raw){blob=JSON.parse(raw);source='localStorage';}
            }catch{}
            // Path 2: window.storage (Capacitor)
            if(!blob&&typeof window.storage?.get==='function'){
              try{
                const r=await window.storage.get(SK);
                if(r&&r.value){blob=JSON.parse(r.value);source='window.storage';}
              }catch{}
            }
            // Path 3: window.Capacitor.Preferences (newer API)
            if(!blob&&window.Capacitor?.Plugins?.Preferences){
              try{
                const r=await window.Capacitor.Plugins.Preferences.get({key:SK});
                if(r&&r.value){blob=JSON.parse(r.value);source='Capacitor.Preferences';}
              }catch{}
            }
            if(!blob){
              console.log('[migrate-now] vitals-v4 not found in localStorage, window.storage, or Capacitor.Preferences');
              console.log('[migrate-now] Tried:',{localStorage:typeof localStorage,windowStorage:typeof window.storage,capacitor:!!window.Capacitor});
              return null;
            }
            const labs=Array.isArray(blob.labSnapshots)?blob.labSnapshots:[];
            const tests=Array.isArray(blob.clinicalTests)?blob.clinicalTests:[];
            console.log(`[migrate-now] vitals-v4 found via ${source}: ${labs.length} labSnapshots, ${tests.length} clinicalTests`);
            if(labs.length)storage.set('labSnapshots',labs,{skipValidation:true});
            if(tests.length)storage.set('clinicalTests',tests,{skipValidation:true});
            console.log('[migrate-now] storage layer now has:',{labs:(storage.get('labSnapshots')||[]).length,tests:(storage.get('clinicalTests')||[]).length});
            return{labs:labs.length,tests:tests.length,source};
          }catch(e){console.error('[migrate-now] failed:',e);return null;}
        };
      }catch{}
      // Cloud sync: E2E-encrypted snapshot sync between desktop & mobile via
      // Cloudflare Worker relay. No-op until the user pairs via CloudSyncPanel.
      startCloudSync().catch(err=>console.warn('[cloud-sync] start failed:',err));
      // When a pull lands changes from another device, force-refresh React
      // state so derived views (Today's Plan tile, etc.) read the new data.
      // applySnapshot() writes via setCloudApplying(true) which deliberately
      // suppresses storage's change notifier (to avoid push feedback loops),
      // so without this listener the UI stays stale until a tab switch.
      onCloudSyncEvent((evt,payload)=>{
        if(evt==='pull:ok'&&payload?.applied>0){
          loadData().then(d2=>setData(d2));
        }
      });

      // Full-sync orchestrator (Phase 4o.fullsync.1) — pulls Cloud Sync
      // + Garmin Activities + Garmin Wellness + Cronometer + FIT relay
      // in parallel on every app open and visibility-resume. Each
      // source is throttled by its own staleness threshold so opening
      // the app twice in a row doesn't hammer the workers.
      import('./core/full-sync.js').then(({ syncEverything }) => {
        // Run a sync, then REFRESH the React tree + notify open panels so freshly
        // pulled data (Cronometer nutrition/water, Garmin, etc.) actually surfaces.
        // Previously this only console.logged, so a successful pull sat unseen in
        // storage until the user re-entered the tab.
        const runSync = (label) => syncEverything().then(r => {
          if (r.ranSources.length > 0) {
            console.log(`[full-sync] ${label} ran:`, r.ranSources, 'skipped fresh:', r.skippedFresh);
            loadData().then(d2 => setData(d2));
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('arnold:synced'));
          }
        }).catch(e => console.warn(`[full-sync] ${label} failed:`, e));

        runSync('boot');

        // Foreground resume. Capacitor's Android WebView does NOT reliably fire
        // `visibilitychange` on app resume, so we also listen on focus / pageshow /
        // resume / online. Debounced to one sync per 60s across all of them.
        let lastFg = Date.now();
        const onForeground = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          if (Date.now() - lastFg < 60_000) return;
          lastFg = Date.now();
          runSync('resume');
        };
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onForeground(); });
          document.addEventListener('resume', onForeground); // Cordova/Capacitor
        }
        if (typeof window !== 'undefined') {
          window.addEventListener('focus', onForeground);
          window.addEventListener('pageshow', onForeground);
          window.addEventListener('online', onForeground);
        }
      });
    });
  },[]);

  const persist=useCallback(async nd=>{
    setData(nd);
    await saveData(nd);
    // Mirror lab/clinical data into the storage layer too so cloud-sync
    // carries new entries to paired devices. Vitals-v4 stays the legacy
    // source-of-truth on each device; storage is the cross-device pipe.
    try{
      if(Array.isArray(nd?.labSnapshots))storage.set('labSnapshots',nd.labSnapshots,{skipValidation:true});
      if(Array.isArray(nd?.clinicalTests))storage.set('clinicalTests',nd.clinicalTests,{skipValidation:true});
    }catch(e){console.warn('[persist] labs/tests mirror failed:',e);}
  },[]);
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),2500);};

  if(loading)return(<div style={S.splash}><div style={S.si}><div style={S.pr}/><span style={S.sl}>⬡</span></div></div>);

  return(
    <div style={S.root} className={mobileHomeActive?'arnold-mobile-active':''}>
      <div style={S.bg}/>
      {/* Mobile back button when drilling into a tab */}
      {isMobileApp&&!mobileHomeActive&&tab!=='training'&&(
        <button className="arnold-mobile-back" onClick={()=>setTab('training')}>⬡</button>
      )}
      <header style={S.hdr} className="arnold-hdr">
        {(()=>{const lp=storage.get('profile')||{};const p={...(data.profile||{}),...lp};return(
<div style={S.hl}><div style={{width:44,height:44,borderRadius:8,background:"var(--accent-dim)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:600,color:"var(--text-accent)",fontFamily:"var(--font-mono)",overflow:"hidden",flexShrink:0}}>{p.avatar?<img src={p.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:(p.alias?.[0]||p.name?.[0]||"A").toUpperCase()}</div><div style={{display:"flex",flexDirection:"column",gap:2,justifyContent:"center"}}><div style={S.an}>ARNOLD</div><div style={S.as}>Health Intelligence</div></div></div>
);})()}
        <div style={S.hr} className="arnold-hdr-right">{(()=>{let n=data.profile?.name;try{const lp=storage.get('profile')||{};n=lp.name||n;}catch{}return n?<span style={{...S.un,textDecoration:"underline",textUnderlineOffset:"3px"}}>Prepared for {n}</span>:null;})()}<span style={{width:"0.5px",height:"1em",background:C.m,opacity:0.5,alignSelf:"center"}}/><span style={S.dc2}>{(()=>{const d=new Date();const s=new Date(d.getFullYear(),0,1);const wk=Math.ceil((((d-s)/86400000)+s.getDay()+1)/7);return `Week ${wk} · ${d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',year:'numeric'})}`;})()}</span></div>
      </header>
      <nav style={S.nav} className="arnold-nav">
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{...S.nb,...(tab===t.id?S.nba:{})}}><span style={{...S.ni,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><WebTabIcon tabId={t.id} color={tab===t.id?C.acc:C.s} size={18}/></span><span style={S.nl}>{t.label}{t.beta&&<span style={{marginLeft:6,fontSize:8,fontWeight:800,letterSpacing:'0.14em',color:'#5eead4',background:'rgba(94,234,212,0.14)',padding:'2px 5px',borderRadius:3,verticalAlign:'1px'}}>BETA</span>}</span></button>)}
      </nav>
      <main style={{...S.main,...(isMobileApp&&tab!=='training'?{paddingBottom:90}:{}),...(isMobileApp?{touchAction:'pan-y'}:{})}} className="arnold-main" {...(isMobileApp?mobileSwipe:{})}>
        {/* ── Phase 4q.header.2 — Unified mobile page header ──
            Every drill-down tab (NOT Start) gets the same shape:
              [A] ARNOLD                                          date
              [colored nav icon] Tab Name
            The ARNOLD brand mark sits on top as a quiet identifier (same
            "A" badge + uppercase wordmark used on Start), then the page
            title row shows the bottom-nav icon tinted in that tab's
            accent color (bolt yellow on Play, pulse red on Core, gem
            purple on EdgeIQ, etc.) so each page reads thematically.
            Padding is uniform across every tab. Date chip on the right
            only on day-anchored tabs (Play / Fuel / Daily). */}
        {/* Phase 4r.narrative.5.fix.2 + fix.22 — mobile per-tab header gate.
            Excludes BOTH `training` (Start — custom cockpit header) AND
            `weekly` (EdgeIQ — MobileEdgeIQ renders its OWN ARNOLD+EdgeIQ+date
            header internally, lines ~3910 in MobileHome.jsx). fix.2 had
            loosened this to only exclude `training`, which double-stacked
            the header on EdgeIQ (user-reported 2026-05-27). Every other
            mobile drill-down tab (Play/Fuel/Daily/Calendar/Plan/Labs/Core/
            Settings) gets this unified header since they don't render
            their own. (coach_beta is web-only — no mobile Coach tab as of
            fix.24; the Coach is ambient on mobile.) */}
        {isMobileApp&&tab!=='training'&&tab!=='weekly'&&(()=>{
          const label = TAB_LABEL[tab] || tab;
          const accentColor = TAB_ACCENT_COLOR[tab] || TAB_ACTIVE_COLOR;
          // Date persists on every drill-down tab (Phase 4q.header.5) so
          // the top-right anchor is consistent across Play/Fuel/Core/Labs/etc.
          const today=(()=>{const d=new Date();return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});})();
          // Header has zero horizontal padding — sits inside <main> which
          // mobile.css already gives 12px so the page frame is uniform.
          return(
            <div style={{padding:'10px 0 8px'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10}}>
                <div style={{minWidth:0}}>
                  {/* ARNOLD brand mark — same treatment as Start screen */}
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <div style={{
                      width:22,height:22,borderRadius:6,
                      background:'linear-gradient(135deg, rgba(91,155,213,0.15), rgba(94,196,212,0.10))',
                      border:'1px solid rgba(91,155,213,0.12)',
                      display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:10,color:'#6babdf',fontWeight:800,
                    }}>A</div>
                    <span style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.65)',letterSpacing:'0.14em'}}>ARNOLD</span>
                  </div>
                  {/* Page title row — colored nav icon + tab name */}
                  <div style={{display:'flex',alignItems:'center',gap:7,marginTop:5,minWidth:0}}>
                    <NavIconForTab tabId={tab} color={accentColor} size={18}/>
                    <span style={{
                      fontSize:16,fontWeight:600,
                      color:'var(--text-primary)',
                      letterSpacing:'0.01em',
                      whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                    }}>{label}</span>
                  </div>
                </div>
                <span style={{
                  fontSize:11,fontWeight:500,
                  color:'var(--text-muted)',
                  letterSpacing:'0.04em',
                  whiteSpace:'nowrap',
                  marginTop:4,
                }}>{today}</span>
              </div>
            </div>
          );
        })()}
        {/* Phase 4r.narrative.5b — Ambient Coach line. Mobile only.
            On web the slim banner appears between the tab nav and the
            tab's own header, which created a visual hierarchy issue
            (Coach above the tab name). Web gets integrated Coach panels
            per tab instead (e.g. EdgeIQ Coach Focus card). Mobile keeps
            the ambient line because it sits BELOW the mobile per-tab
            header in the rendered order. Phase 4r.narrative.5.fix.4. */}
        {/* Phase 4r.narrative.5.fix.27 — the old unbranded CoachLine is
            replaced by the sigil-marked CoachComment so every mobile
            coaching comment speaks in the Coach's voice. EdgeIQ (weekly)
            handles its own Coach comment inside MobileEdgeIQ; Start
            (training) inside the hero rail. Phase 4r.race.12 — Play
            (activity) and Fuel (nutrition_mobile) had their dispatch HERE
            but it rendered the Coach line FLOATING above the card. The
            Coach now lives INSIDE the relevant card on each tab (top of
            the activity card on Play; via NutritionInput's coachSlot on
            Fuel), so it visually belongs to the section it speaks about. */}
        {/* Phase 4r.hygiene.1 — Each tab wrapped in ErrorBoundary so a
            render error inside the tab content shows a retry UI instead
            of blanking the tab. tabName drives the boundary's headline
            and the DevTools console label `[ErrorBoundary:<name>]`. */}
        {tab==="weekly"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="EdgeIQ"><EdgeIQ data={data} setTab={setTab} showToast={showToast} aiSummLoad={aiSummLoad} aiSummStream={aiSummStream} mobileInitView={mobileInitView} onAiSum={async()=>{
          if(aiSummLoad)return;
          setAiSummLoad(true);setAiSummStream("");
          try{
            const ins=await aiSummary(data,chunk=>setAiSummStream(chunk));
            await persist({...data,aiInsights:[{date:td(),text:ins},...data.aiInsights.slice(0,4)]});
          }catch(e){setAiSummStream(`Error: ${e.message}`);}
          finally{setAiSummLoad(false);}
        }}/></ErrorBoundary></div>}
        {tab==="labs"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Labs"><LabsModule data={data} persist={persist} showToast={showToast}/></ErrorBoundary></div>}
        {tab==="clinical"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Core"><ClinicalModule data={data} persist={persist} showToast={showToast}/></ErrorBoundary></div>}
        {tab==="training"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Start"><TrainingTab setTab={setTab} data={data} mobileInitView={mobileInitView} onMobileInitViewUsed={()=>setMobileInitView('start')}/></ErrorBoundary></div>}
        {/* Phase 4r.coach.v2.surface — Coach BETA tab, web-only.
            Phase 4r.narrative.4c — setTab is plumbed in so the embedded
            narrative tiles can navigate to their source tab on tap. */}
        {/* Phase 4r.coach.retire — coach_beta tab removed (see TABS comment). */}
        {tab==="daily"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Daily"><LogDay data={data} persist={persist} showToast={showToast} setTab={setTab}/></ErrorBoundary></div>}
        {tab==="activity"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Play"><LogDay data={data} persist={persist} showToast={showToast} mobileView="activity" setTab={setTab}/></ErrorBoundary></div>}
        {tab==="nutrition_mobile"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Fuel"><LogDay data={data} persist={persist} showToast={showToast} mobileView="nutrition" setTab={setTab}/></ErrorBoundary></div>}
        {tab==="races"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Calendar"><CalendarTab showToast={showToast}/></ErrorBoundary></div>}
        {/* Phase 4r.dataspine.6 — Plan tab cleanup:
            - Weekly Planner removed: Calendar's "+Plan" chip is the
              single workout-assignment surface now.
            - Order: GoalsHub first (outcomes you're optimizing for),
              Workbench below (where you do the work).
            WeeklyPlanner component kept in src/components/ for now in
            case it's needed elsewhere; just unmounted here. */}
        {tab==="goals"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Plan"><div style={S.sec}>{!isMobileApp && <CoachComment surface="plan" />}<GoalsHub showToast={showToast}/><PlanGeneratorPanel showToast={showToast}/><Workbench showToast={showToast}/></div></ErrorBoundary></div>}
        {tab==="supplements"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Supplements"><SupplementsTab showToast={showToast}/></ErrorBoundary></div>}
        {tab==="settings"&&<div className="arnold-tab-panel"><ErrorBoundary tabName="Settings"><ProfileSettings data={data} persist={persist} showToast={showToast}/></ErrorBoundary></div>}
      </main>
      {/* ── Persistent mobile bottom nav (when drill-down tabs are active) ── */}
      {isMobileApp&&(
        <BottomNavBar activeNav={mobileActiveId} onNavTap={(id)=>{
          const item=NAV_ITEMS.find(n=>n.id===id);
          if(item)handleMobileNav(item);
        }} />
      )}
      {/* ── Mobile More Menu (when in drill-down tabs) ── */}
      {isMobileApp&&mobileMoreOpen&&(
        <div style={{position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(8px)'}} onClick={()=>setMobileMoreOpen(false)}>
          <div style={{position:'absolute',bottom:0,left:0,right:0,background:'rgba(16,18,24,0.98)',borderRadius:'20px 20px 0 0',padding:'20px 16px env(safe-area-inset-bottom, 16px)',animation:'mobileSheetUp 0.25s ease-out'}} onClick={e=>e.stopPropagation()}>
            <div style={{width:36,height:4,borderRadius:2,background:'rgba(255,255,255,0.15)',margin:'0 auto 16px'}}/>
            <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8}}>
              {[
                {label:'Labs',desc:'Blood panels, biomarkers, lab history',tab:'labs'},
                {label:'Cloud Sync',desc:'Pair devices, Health Connect, Cronometer',tab:'settings'},
              ].map(m=>(
                <button key={m.label} onClick={()=>{setMobileMoreOpen(false);setTab(m.tab);}} style={{padding:'16px 14px',borderRadius:14,background:'rgba(107,171,223,0.10)',border:'1px solid rgba(107,171,223,0.25)',color:'#e2e8f0',cursor:'pointer',textAlign:'left',display:'flex',flexDirection:'column',gap:4}}>
                  <span style={{fontSize:14,fontWeight:600,color:'#6BABDF'}}>{m.label}</span>
                  <span style={{fontSize:12,color:'rgba(226,232,240,0.6)'}}>{m.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {toast&&<div style={S.toast}>{toast}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLINICAL MODULE — DEXA + VO2Max + RMR
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (slice 17) — ClinicalModule extracted to components/ClinicalModule.jsx
// (imported at the top). The only body change is the lazy pdfParser import path
// (./core → ../core). Rendered by the Core/Clinical tab.

// ═══════════════════════════════════════════════════════════════════════════════
// LABS MODULE — Blood Panel
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (monolith slice 7) — LabsModule + LabSparkline extracted to
// components/LabsModule.jsx (imported at the top of this file).

// ═══════════════════════════════════════════════════════════════════════════════
// PRINCIPLES PANEL
// ═══════════════════════════════════════════════════════════════════════════════
const STATUS_CLR={optimal:"var(--status-ok)",  "on-track":"var(--accent)", "needs-work":"var(--status-warn)", critical:"var(--status-danger)", unknown:"var(--text-muted)"};
const STATUS_BG ={optimal:"var(--status-ok-bg)","on-track":"var(--accent-dim)","needs-work":"var(--status-warn-bg)",critical:"var(--status-danger-bg)",unknown:"transparent"};
const STATUS_LBL={optimal:"Optimal","on-track":"On Track","needs-work":"Needs Work",critical:"Critical",unknown:"No Data"};

// Phase 0.5 (slice 14) — DEAD CODE REMOVED: PrinciplesPanel (unreferenced;
// superseded by the Health System scores / Dashboard).

// ═══════════════════════════════════════════════════════════════════════════════
// HOME COCKPIT — Hero view: goal rings, race readiness, daily compound snapshot
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (slice 15) — DEAD CODE REMOVED: HomeCockpit (unreferenced legacy
// hero view; superseded by Dashboard / the live home surfaces).

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (slice 19) — Dashboard (the web EdgeIQ / "Trend" tab, rendered for
// tab==="weekly") extracted AND renamed to its real name EdgeIQ →
// components/EdgeIQ.jsx (imported at the top). "Dashboard" was a stale historical
// name. Only body change: getUnifiedActivities() → the underlying allActivities().
/* inert remnant — one BOM-strip line the editor can't string-match (harmless):
          const lines=txt.replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1);
*/

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING STRESS PANEL (replaces 7-day trends + Recovery)
// ═══════════════════════════════════════════════════════════════════════════════

// ZONE_COLORS / ZONE_LABELS moved to core/presentation/readinessTokens.js
// (imported at top) so the ContextCluster component can share the one source.

// Session vs-usual panel — today's logged session at a glance, upgrading to a
// "vs your usual" comparison once 2+ prior same-type sessions exist. Always
// renders when there's a session with a duration, so the gap above Nutrition
// is never empty. (Extracted from a brittle inline IIFE.)
// Phase 0.5 (slice 16) — SessionVsUsual extracted to components/SessionVsUsual.jsx
// (imported at the top). Only change: its getUnifiedActivities() call is now the
// underlying allActivities() import. Rendered by LogDay (2 call sites).

// Phase 0.5 (slice 12) — DEAD CODE REMOVED: TrainingStressPanel (unreferenced;
// live training detail lives on EdgeIQ/Dashboard).
/* residual dead markup (TrainingStressPanel Notes block) — inert:
            {saveStatus === 'saved' ? '\u2713 Saved' : 'Save daily entry'}
*/

// ─── Race Prep Banner ─────────────────────────────────────────────────────
// Phase 4r.race.9 — Fuel-tab landing for the race card's "Plan items in
// Fuel" link. Compact strip that shows when a race is in the next 21 days.
// Tap → expands into a textarea + a structured-items mini-list, persisted
// to localStorage per race key.
// Phase 0.5 (slice 13) — DEAD CODE REMOVED: RacePrepBanner (unreferenced;
// race-fuel planning lives in the Fuel tab / race tile).

// ═══════════════════════════════════════════════════════════════════════════════
// LOG TODAY + WORKOUT LOG
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (monolith decomposition) — LogDay extracted to
// components/LogDay.jsx (imported near the top of this file). The moved copy
// calls allActivities() directly in place of the old getUnifiedActivities()
// 1-line delegate; otherwise byte-identical. Recoverable from git if needed.

// Phase 0.5 (slice 11) — DEAD CODE REMOVED: WorkoutLog (the old manual workout
// logger, never rendered — superseded by the FIT-upload flow) + its cascade-dead
// helpers countExtracted, WORKOUT_TYPES, and DocIcon.

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT HUB — Garmin + Cronometer + API placeholders
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT HUB — Garmin + Cronometer + API placeholders
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (slice 20) — DEAD CODE REMOVED: IMPORT_ZONES + processImport +
// ImportHub. Defined here but never rendered anywhere in the web app (no
// <ImportHub> usage); superseded by the wired SyncPanel / DataSync panels. The
// body was moved verbatim to components/ImportHub.jsx and PARKED (not imported)
// in case it's ever re-wired — Emil can delete that file if it's not wanted.

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH SYSTEMS — 10-tile grid for EdgeIQ (moved from NutritionInput)
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.3/3.2 — SYSTEM_ICONS extracted to components/systemIcons.jsx (was a
// byte-identical copy here and in NutritionInput.jsx). Imported at the top.

// Phase 0.5 (slice 18) — SYSTEM_SIGNALS + WebSystemDetail extracted to
// components/WebSystemDetail.jsx (imported at the top). Rendered by the web
// Health Systems grid (EdgeIQ/home) as the inline tile-expansion panel.

// Phase 0.5 (slice 21) — HealthSystemTile (web wrapper) + HealthSystemsGrid
// extracted to components/HealthSystemsGrid.jsx (imported at the top). Rendered
// on the web home/EdgeIQ surface; <HealthSystemsGrid> call site unchanged.
// ALSO removed here: StartTilePickerSection — it was DEAD (defined, never
// rendered anywhere; the Start-tile picker is reached via StartTilePicker /
// StartTilePickerInner directly). Render-site checked before removal this time.

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING TAB
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (monolith decomposition) — TrainingTab extracted to
// components/TrainingTab.jsx (imported near the top of this file). The moved
// copy calls allActivities() directly in place of the old getUnifiedActivities()
// 1-line delegate; otherwise byte-identical. Recoverable from git if needed.


// ═══════════════════════════════════════════════════════════════════════════════
// RACES TAB
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 (monolith slice 8) — DEAD CODE REMOVED: the legacy RacesTab +
// RaceList + race-milestone helpers (getMilestones/getTrainingProgress/
// raceStatus) were superseded by CalendarTab.jsx and never rendered. Deleted
// (~244 lines). Recoverable from git if ever needed.

// Phase 0.5 (monolith slice 9) — DEAD CODE REMOVED: the legacy AICoach panel +
// its memory timeline. Never rendered (the AI-coach-as-a-tab was retired for the
// ambient Coach / CoachComment). Deleted (~95 lines). Recoverable from git.

// Phase 0.5 (monolith slice 5) — aiSummary / buildFullPrompt extracted to
// core/ai.js (imported at the top of this file).

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileSettings({data,persist,showToast}){
  // Single state object — never use multiple useState calls for form fields,
  // and never define an inner input component (causes remount on every keystroke).
  const[form,setForm]=useState(()=>{
    try{
      const stored=storage.get('profile')||{};
      return{...(data?.profile||{}),...stored};
    }catch{return{...(data?.profile||{})};}
  });
  const[saved,setSaved]=useState(false);
  const update=(key,val)=>setForm(prev=>({...prev,[key]:val}));

  const handleSave=async()=>{
    storage.set('profile',form,{skipValidation:true});
    try{
      await persist({...data,profile:{name:form.name,alias:form.alias,birthDate:form.birthDate,height:form.height,avatar:form.avatar,goal:form.goal,age:form.age}});
    }catch{}
    setSaved(true);
    setTimeout(()=>setSaved(false),2000);
    showToast&&showToast("✓ Profile & goals saved!");
  };

  const normalizeDate=(v)=>{
    if(!v)return v;const s=String(v).trim();
    let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(m)return `${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}-${m[1]}`;
    m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);if(m){let y=m[3];if(y.length===2)y='19'+y;return `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}-${y}`;}
    m=s.match(/^(\d{2})(\d{2})(\d{4})$/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
    m=s.match(/^(\d{4})(\d{2})(\d{2})$/);if(m)return `${m[2]}-${m[3]}-${m[1]}`;
    return s;
  };
  const normalizeHeight=(v)=>{
    if(!v)return v;const s=String(v).trim().toLowerCase();
    let m=s.match(/^(\d)[\s'\-]*(\d{1,2})"?$/);if(m)return `${m[1]}'${m[2]}"`;
    m=s.match(/^(\d)(\d{2})$/);if(m)return `${m[1]}'${m[2]}"`;
    m=s.match(/^(\d{2,3})\s*cm$/);if(m)return `${m[1]}cm`;
    m=s.match(/^(\d{2,3})$/);if(m){const n=parseInt(m[1]);if(n>=120&&n<=230)return `${n}cm`;}
    return v;
  };
  const normalizers={birthDate:normalizeDate,height:normalizeHeight};
  const commitField=(key)=>{const fn=normalizers[key];if(fn)update(key,fn(form[key]));};
  const textField=(label,key,placeholder)=>(
    <div key={key} style={S.field}>
      <label style={S.fl}>{label}</label>
      <input type="text" value={form[key]??""}
        onChange={e=>update(key,e.target.value)}
        onBlur={()=>commitField(key)}
        onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitField(key);e.target.blur();}}}
        placeholder={placeholder||""} style={S.inp}/>
    </div>
  );

  // Phase 4r.narrative.5.fix.5 — web page-title header removed (top nav
  // already says "Profile"). Mobile keeps the inline header for now;
  // the user explicitly scoped this cleanup to web only.
  const _setIsMobile = typeof window !== 'undefined' && window.innerWidth <= 600;
  return(
    <div style={S.sec}>
      {_setIsMobile && <div style={S.st}>Profile</div>}

      {/* Personal info — compact */}
      <div style={{...S.lg,marginTop:4}}>
        <div style={S.gt}>◐ Personal</div>
        <div className="arnold-profile-grid" style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:10,alignItems:"stretch"}}>
          {/* Avatar uploader — spans top of Name to bottom of BirthDate */}
          <label style={{cursor:"pointer",display:"flex",height:64,width:64,marginTop:21,flexShrink:0}}>
              <div style={{width:"100%",height:"100%",borderRadius:12,background:"var(--accent-dim)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:48,fontWeight:600,color:"var(--text-accent)",fontFamily:"var(--font-mono)",overflow:"hidden"}}>
                {form.avatar?<img src={form.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:(form.alias?.[0]||form.name?.[0]||"A").toUpperCase()}
              </div>
              <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                const f=e.target.files?.[0];if(!f)return;
                const r=new FileReader();r.onload=()=>update("avatar",r.result);r.readAsDataURL(f);
              }}/>
          </label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"clamp(10px,1vw,16px)",alignContent:"stretch"}}>
            {textField("Name","name","")}
            {textField("Alias","alias","")}
            {textField("Birth date","birthDate","YYYY-MM-DD")}
            {textField("Height","height","e.g. 5'10\" or 178cm")}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10,flexWrap:"wrap"}}>
          <span style={{fontSize:10,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>Avatar library</span>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            <div onClick={()=>update("avatar","")} title="Initial only"
              style={{width:26,height:26,borderRadius:6,overflow:"hidden",cursor:"pointer",border:!form.avatar?"1.5px solid var(--text-accent)":"0.5px solid var(--border-default)",background:"var(--accent-dim)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:600,color:"var(--text-accent)",fontFamily:"var(--font-mono)"}}>
              {(form.alias?.[0]||form.name?.[0]||"A").toUpperCase()}
            </div>
            {AVATAR_LIBRARY.map(a=>(
              <div key={a.id} onClick={()=>update("avatar",a.src)} title={a.theme}
                style={{width:26,height:26,borderRadius:6,overflow:"hidden",cursor:"pointer",border:form.avatar===a.src?"1.5px solid var(--text-accent)":"0.5px solid var(--border-default)"}}>
                <img src={a.src} alt="" style={{width:"100%",height:"100%",display:"block"}}/>
              </div>
            ))}
          </div>
          <span style={{fontSize:10,color:C.m,cursor:"pointer"}} onClick={()=>document.querySelector('input[type=file]')?.click()}>or upload own</span>
          {form.avatar&&<span style={{fontSize:10,color:C.m,cursor:"pointer"}} onClick={()=>update("avatar","")}>remove</span>}
        </div>
      </div>

      <button style={S.sb} onClick={handleSave}>{saved?'✓ Saved':'Save Profile'}</button>

      {/* ═══ SETTINGS — grouped into labeled sections (Phase E, 2026-06-14) ═══ */}
      <div style={{marginTop:8}}>
        {/* ── Your Data ── */}
        <div style={{display:'flex',alignItems:'center',gap:8,margin:'18px 0 10px'}}>
          <div style={{fontSize:"clamp(12px,0.5vw+10px,14px)",fontWeight:600,color:'var(--text-primary)',letterSpacing:'0.02em'}}>Your Data</div>
          <div style={{flex:1,height:'0.5px',background:'var(--border-subtle)'}}/>
        </div>
        {/* Backup & Restore */}
        <BackupPanel showToast={showToast}/>
        <div style={{height:1,background:C.b,margin:"8px 0"}}/>
        <BackupStatusPanel/>
        {/* ── Devices & Sync ── */}
        <div style={{display:'flex',alignItems:'center',gap:8,margin:'18px 0 10px'}}>
          <div style={{fontSize:"clamp(12px,0.5vw+10px,14px)",fontWeight:600,color:'var(--text-primary)',letterSpacing:'0.02em'}}>Devices & Sync</div>
          <div style={{flex:1,height:'0.5px',background:'var(--border-subtle)'}}/>
        </div>
        <CloudSyncPanel/>
        {/* ── Connections ── */}
        <div style={{display:'flex',alignItems:'center',gap:8,margin:'18px 0 10px'}}>
          <div style={{fontSize:"clamp(12px,0.5vw+10px,14px)",fontWeight:600,color:'var(--text-primary)',letterSpacing:'0.02em'}}>Connections</div>
          <div style={{flex:1,height:'0.5px',background:'var(--border-subtle)'}}/>
        </div>
        <div style={{fontSize:11,color:C.m,lineHeight:1.5,padding:'2px 0 8px'}}>No external connections yet — Garmin and cloud sync are managed under Devices & Sync above.</div>
        {/* ── Advanced ── */}
        <div style={{display:'flex',alignItems:'center',gap:8,margin:'18px 0 10px'}}>
          <div style={{fontSize:"clamp(12px,0.5vw+10px,14px)",fontWeight:600,color:'var(--text-primary)',letterSpacing:'0.02em'}}>Advanced</div>
          <div style={{flex:1,height:'0.5px',background:'var(--border-subtle)'}}/>
        </div>
        {/* Phase 0.5 (settings cleanup) — Architecture Map is a dev/admin tool;
            tucked into a collapsed Advanced section per Emil (single-user app). */}
        <details style={{marginTop:4,marginBottom:8}}>
          <summary style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",userSelect:"none"}}>▸ Advanced · Architecture Map (dev)</summary>
        {(()=>{
          const base=window.location.pathname.replace(/\/index\.html$/,'').replace(/\/$/,'');
          const isMobileUA=/android|iphone|ipad|ipod/i.test(navigator.userAgent);
          const href=base+(isMobileUA?'/arnold-mobile-architecture.html':'/arnold-architecture.html');
          return(
            <a href={href} target="_blank" rel="noopener noreferrer"
              onClick={e=>{
                // Defensive: if something upstream tries to preventDefault or the target=_blank
                // fails silently in a constrained webview, fall back to an explicit window.open
                // in the current tab so the user at least reaches the page.
                try{
                  const popup=window.open(href,'_blank','noopener,noreferrer');
                  if(popup){e.preventDefault();}
                }catch{/* let the native anchor take over */}
              }}
              style={{...S.lg,marginTop:8,marginBottom:8,cursor:'pointer',textDecoration:'none',display:'block'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--bg-elevated)',borderRadius:'var(--radius-md)',border:'0.5px solid var(--border-default)'}}>
                <span style={{fontSize:16}}>&#9783;</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:500,color:'var(--text-primary)'}}>Architecture Map</div>
                  <div style={{fontSize:10,color:'var(--text-muted)'}}>Component dependencies, storage keys, data flow, security audit</div>
                </div>
                <span style={{fontSize:11,color:'var(--text-muted)'}}>&#8599;</span>
              </div>
            </a>
          );
        })()}
        </details>
        <div style={{height:1,background:C.b,margin:"8px 0"}}/>
        {/* Phase 0.5 (settings cleanup) — Bulk Historical Import is a dev/seeding
            tool that OVERWRITES each data key; tucked into a collapsed Advanced
            per Emil (single-user app). */}
        <div style={{height:1,background:C.b,margin:"8px 0"}}/>
        <details style={{marginBottom:8}}>
          <summary style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",userSelect:"none"}}>▸ Advanced · Bulk Historical Import (dev)</summary>
        <div style={S.lg}>
          <div style={S.gt}>⇪ Bulk Historical Import</div>
          <div style={{fontSize:11,color:C.m,lineHeight:1.5,marginBottom:8}}>
            Loads all CSVs from <code style={{color:C.ta}}>public/data-imports/</code>: Activities, Cronometer, HRV, Sleep, Weight. Replaces current data on each key — run once after dropping fresh exports.
          </div>
          <button
            style={{...S.sb,background:C.ad,borderColor:C.ab2,color:C.ta}}
            onClick={async()=>{
              // Pre-op snapshot: rollback point in case a parser overwrites
              // good data with partial or malformed CSV rows.
              try { snapshotBeforeOp('bulk-import'); } catch(e){ console.warn('pre-op snapshot failed',e); }
              const strip=t=>t.replace(/^\uFEFF/,'');
              const load=async(name)=>{
                const r=await fetch(`/data-imports/${name}`);
                if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);
                return strip(await r.text());
              };
              const report=[];
              try{
                try{
                  const parsed=parseActivitiesCSV(await load('Activities.csv'));
                  storage.set('activities',parsed);
                  report.push(`✓ Activities: ${parsed.length} rows`);
                }catch(e){report.push(`✗ Activities: ${e.message}`);}
                try{
                  const parsed=parseCronometerCSV(await load('Cronometer-dailysummary.csv'));
                  storage.set('cronometer',parsed);
                  report.push(`✓ Cronometer: ${parsed.length} rows`);
                }catch(e){report.push(`✗ Cronometer: ${e.message}`);}
                try{
                  const parsed=parseHRVCSV(await load('HRV Status.csv'));
                  storage.set('hrv',parsed);
                  report.push(`✓ HRV: ${parsed.length} rows`);
                }catch(e){report.push(`✗ HRV: ${e.message}`);}
                try{
                  const parsed=parseSleepCSV(await load('Sleep.csv'));
                  storage.set('sleep',parsed);
                  report.push(`✓ Sleep: ${parsed.length} rows`);
                }catch(e){report.push(`✗ Sleep: ${e.message}`);}
                try{
                  const parsed=parseWeightCSV(await load('Weight.csv'));
                  storage.set('weight',parsed);
                  report.push(`✓ Weight: ${parsed.length} rows`);
                }catch(e){report.push(`✗ Weight: ${e.message}`);}
                showToast&&showToast(report.join(" · "));
                console.log("[Bulk Import]\n"+report.join("\n"));
                alert("Bulk import complete:\n\n"+report.join("\n")+"\n\nReloading to refresh all tabs…");
                window.location.reload();
              }catch(e){
                showToast&&showToast("Bulk import failed: "+e.message);
                alert("Bulk import failed: "+e.message);
              }
            }}
          >⇪ Load Historical CSVs</button>
        </div>
        </details>
        {/* ── Danger Zone ── */}
        <div style={{display:'flex',alignItems:'center',gap:8,margin:'18px 0 10px'}}>
          <div style={{fontSize:"clamp(12px,0.5vw+10px,14px)",fontWeight:600,color:'var(--text-primary)',letterSpacing:'0.02em'}}>Danger Zone</div>
          <div style={{flex:1,height:'0.5px',background:'var(--border-subtle)'}}/>
        </div>
        {/* Phase 0.5 (UI safety) — the full-wipe Reset is now tucked inside a
            collapsed <details> Danger Zone (closed by default) so it can't be
            hit by muscle memory. Expanding reveals a plain-language warning;
            the action still requires typing ARNOLD and auto-saves a pre-op
            snapshot, so even a confirmed reset is recoverable. */}
        <details style={{marginTop:4}}>
          <summary style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.dn,letterSpacing:"0.1em",textTransform:"uppercase",cursor:"pointer",userSelect:"none"}}>⚠ Reset Arnold</summary>
          <div style={{fontSize:"clamp(11px,0.4vw + 9px,12px)",color:C.m,margin:"8px 0",lineHeight:1.5}}>Permanently erases all Arnold data on this device. A recoverable pre-op snapshot is saved automatically before it runs, and you'll have to type <strong style={{color:C.t}}>ARNOLD</strong> to confirm. If your devices are paired via Cloud Sync, their copies are untouched.</div>
        <button style={S.db} onClick={()=>{
          // Double gate: (1) typed-word confirmation so it can't be done with a
          // muscle-memory Enter, (2) pre-op snapshot so even a confirmed reset
          // is recoverable from the pre-op ring.
          const typed = window.prompt('This will permanently delete ALL your Arnold data.\n\nType ARNOLD to confirm:');
          if (typed !== 'ARNOLD') { showToast('\u2717 Reset cancelled'); return; }
          try { snapshotBeforeOp('reset-all'); } catch(e){ console.warn('pre-op snapshot failed',e); }
          persist(DD).then(()=>showToast("\u2713 Arnold reset — pre-op snapshot saved if you need to roll back"));
        }}>Reset All Data</button>
        </details>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEED DATA — Emil's real results
// ═══════════════════════════════════════════════════════════════════════════════
const SEED_CLINICAL=[
  {type:"dexa",date:"2025-03-20",source:"pdf",metrics:{totalMass:187.3,leanMass:134,fatMass:46.3,bodyFatPct:24.7,visceralFat:1.29,tScore:2.80,zScore:2.50,almi:9.1,ffmi:20.2,agRatio:1.12,bmc:7.40,bodyScore:"B",fatTrunk:27.6,fatArms:20.7,fatLegs:23.2,leanTrunk:62,leanArms:15.6,leanLegs:48,bmdTotal:1.48,bmdSpine:1.24,bmdLegs:1.61,bmdArms:1.11,spinePercentile:37}},
  {type:"vo2max",date:"2025-03-20",source:"pdf",metrics:{vo2max:51,percentile:98,bioAge:33,redlineRatio:89,redlinePercentile:70,leanVO2:72,leanVO2Percentile:99,legLeanVO2:200,legLeanVO2Percentile:96,maxHR:164,vt1:110,vt2:154,zone1:[82,99],zone2:[99,138],zone3:[138,152],zone4:[152,172]}},
  {type:"rmr",date:"2025-03-27",source:"pdf",metrics:{rmr:1880,predicted:1783,peerAvg:1915,rer:0.84,fatPct:53,carbsPct:47,tdeeSedentary:2256,tdeeLightlyActive:2585,tdeeModerate:2914,tdeeVeryActive:3243,tdeeExtreme:3572}},
];

const SEED_LABS=[
  {date:"2025-12-06",source:"csv",markers:{"Glucose (mg/dL)":85,"Calcium (mg/dL)":9.4,"Magnesium (mg/dL)":2.2,"Creatine kinase (U/L)":251,"Vitamin B12 (pg/mL)":696,"Folate (ng/mL)":19.1,"Vitamin D (ng/mL)":67,"Ferritin (ng/mL)":65,"Total Cholesterol (mg/dL)":164,"Hemoglobin (g/dL)":15,"HDL Cholesterol (mg/dL)":71,"LDL Cholesterol (mg/dL)":74,"Triglycerides (mg/dL)":102,"Testosterone (ng/dL)":756,"Potassium (mmol/L)":4,"Sodium (mmol/L)":139,"White blood cells (thousands/uL)":4.7,"HbA1c (%)":5.1,"ALT (U/L)":21,"Cortisol (µg/dL)":15.2,"Iron (ug/dL)":94,"TIBC (ug/dL)":324,"Albumin (g/dL)":4.6,"Free testosterone (ng/dL)":9.42,"AST (U/L)":27,"GGT (U/L)":18,"Transferrin saturation (%)":29,"SHBG (nmol/L)":57,"hsCRP (mg/L)":0.2,"TSH (µIU/L)":1.88,"RBC (x10E6/µL)":5.09,"Hematocrit (%)":45,"Platelets (thousands/uL)":183,"RBC Magnesium (mg/dL)":4.6,"Insulin (µIU/mL)":4,"ApoB (mg/dL)":47,"Testosterone:Cortisol Ratio (Units)":64.56,"eGFR (mL/min)":104,"Creatinine (mg/dL)":0.95}},
  {date:"2025-07-30",source:"csv",markers:{"Glucose (mg/dL)":82,"Magnesium (mg/dL)":2.3,"Creatine kinase (U/L)":292,"Vitamin B12 (pg/mL)":599,"Folate (ng/mL)":19.6,"Vitamin D (ng/mL)":85,"Ferritin (ng/mL)":59,"Total Cholesterol (mg/dL)":162,"Hemoglobin (g/dL)":14.6,"HDL Cholesterol (mg/dL)":71,"LDL Cholesterol (mg/dL)":71,"Triglycerides (mg/dL)":110,"Testosterone (ng/dL)":593,"HbA1c (%)":5.2,"ALT (U/L)":26,"Cortisol (µg/dL)":18.4,"Iron (ug/dL)":67,"Albumin (g/dL)":4.7,"Free testosterone (ng/dL)":7.34,"AST (U/L)":24,"GGT (U/L)":23,"SHBG (nmol/L)":63,"hsCRP (mg/L)":0.3,"TSH (µIU/L)":3.5,"RBC (x10E6/µL)":5.01,"Hematocrit (%)":45.1,"Platelets (thousands/uL)":200,"RBC Magnesium (mg/dL)":4.8,"Insulin (µIU/mL)":8,"ApoB (mg/dL)":50,"Testosterone:Cortisol Ratio (Units)":42.91,"eGFR (mL/min)":101,"Creatinine (mg/dL)":0.98}},
  {date:"2025-04-16",source:"csv",markers:{"Glucose (mg/dL)":84,"Vitamin D (ng/mL)":62,"Vitamin B12 (pg/mL)":534,"Ferritin (ng/mL)":65,"Total Cholesterol (mg/dL)":152,"HDL Cholesterol (mg/dL)":76,"LDL Cholesterol (mg/dL)":62,"Triglycerides (mg/dL)":67,"Testosterone (ng/dL)":645,"HbA1c (%)":5.2,"ALT (U/L)":24,"Cortisol (µg/dL)":12.3,"Free testosterone (ng/dL)":8.11,"SHBG (nmol/L)":58,"hsCRP (mg/L)":0.2,"TSH (µIU/L)":2.0,"Insulin (µIU/mL)":2.5,"ApoB (mg/dL)":55,"Testosterone:Cortisol Ratio (Units)":65.58,"RBC Magnesium (mg/dL)":4.2}},
  {date:"2024-11-16",source:"csv",markers:{"Glucose (mg/dL)":82,"Vitamin D (ng/mL)":61,"Vitamin B12 (pg/mL)":381,"Ferritin (ng/mL)":63,"Total Cholesterol (mg/dL)":173,"HDL Cholesterol (mg/dL)":75,"LDL Cholesterol (mg/dL)":84,"Triglycerides (mg/dL)":68,"Testosterone (ng/dL)":599,"HbA1c (%)":5.1,"ALT (U/L)":28,"Cortisol (µg/dL)":9.2,"Free testosterone (ng/dL)":7.8,"SHBG (nmol/L)":52,"hsCRP (mg/L)":0.2,"TSH (µIU/L)":2.24,"Insulin (µIU/mL)":4.8,"ApoB (mg/dL)":65,"Testosterone:Cortisol Ratio (Units)":70.39,"RBC Magnesium (mg/dL)":5.0}},
  {date:"2024-06-21",source:"csv",markers:{"Glucose (mg/dL)":56,"Vitamin D (ng/mL)":44,"Vitamin B12 (pg/mL)":383,"Ferritin (ng/mL)":66,"Total Cholesterol (mg/dL)":177,"HDL Cholesterol (mg/dL)":72,"LDL Cholesterol (mg/dL)":86,"Triglycerides (mg/dL)":95,"Testosterone (ng/dL)":630,"HbA1c (%)":5.1,"ALT (U/L)":21,"Cortisol (µg/dL)":14,"Free testosterone (ng/dL)":8.17,"SHBG (nmol/L)":52,"hsCRP (mg/L)":0.2,"TSH (µIU/L)":2.89,"Insulin (µIU/mL)":4.5,"ApoB (mg/dL)":53,"Testosterone:Cortisol Ratio (Units)":62.76,"RBC Magnesium (mg/dL)":5.1}},
  {date:"2024-01-12",source:"csv",markers:{"Glucose (mg/dL)":79,"Vitamin D (ng/mL)":33,"Vitamin B12 (pg/mL)":331,"Ferritin (ng/mL)":65,"Total Cholesterol (mg/dL)":171,"HDL Cholesterol (mg/dL)":81,"LDL Cholesterol (mg/dL)":74,"Triglycerides (mg/dL)":75,"Testosterone (ng/dL)":670,"HbA1c (%)":5.0,"ALT (U/L)":23,"Cortisol (µg/dL)":19.2,"Free testosterone (ng/dL)":8.52,"SHBG (nmol/L)":55,"hsCRP (mg/L)":0.3,"TSH (µIU/L)":2.27,"Insulin (µIU/mL)":7.6,"ApoB (mg/dL)":55,"Testosterone:Cortisol Ratio (Units)":43.93,"RBC Magnesium (mg/dL)":5.2}},
  {date:"2023-09-13",source:"csv",markers:{"Glucose (mg/dL)":76,"Vitamin D (ng/mL)":46,"Vitamin B12 (pg/mL)":339,"Ferritin (ng/mL)":87,"Total Cholesterol (mg/dL)":161,"HDL Cholesterol (mg/dL)":71,"LDL Cholesterol (mg/dL)":70,"Triglycerides (mg/dL)":116,"Testosterone (ng/dL)":593,"HbA1c (%)":5.0,"ALT (U/L)":26,"Cortisol (µg/dL)":11.9,"Free testosterone (ng/dL)":7.54,"SHBG (nmol/L)":57,"hsCRP (mg/L)":0.4,"TSH (µIU/L)":3.1,"Insulin (µIU/mL)":4.9,"ApoB (mg/dL)":51,"Testosterone:Cortisol Ratio (Units)":64.59,"RBC Magnesium (mg/dL)":4.3}},
];

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES — design tokens mirror CSS custom properties; no hardcoded colors
// ═══════════════════════════════════════════════════════════════════════════════
// Phase 0.5 — the `C` palette moved to ./arnoldTheme.js (imported at the top).
// Phase 0.5 (monolith slice 6) — the app-wide `S` styles object extracted to
// arnoldStyles.js (imported at the top of this file).
