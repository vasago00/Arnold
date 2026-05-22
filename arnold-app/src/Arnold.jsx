import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStorageVersion } from "./hooks/useStorageVersion.js";
import { scoreAll, getInsights } from "./core/principles.js";
import {
  saveWorkout, getWorkouts, findRelevantWorkouts, buildWorkoutMemoryContext,
  getRaces, saveRaces, getGarmin, saveGarmin, saveCronometer,
  getGarminActivities, saveGarminActivities,
  getGarminHRV, saveGarminHRV,
  getGarminSleep, saveGarminSleep,
  getGarminWeight, saveGarminWeight,
  getImportHistory, saveImportHistory,
} from "./core/memory.js";
import { parseRunPDF, parseWorkoutCSV, fetchWeatherForDate } from "./core/pdfParser.js";
import { parseGarminCSV, mergeGarminActivities } from "./core/garminParser.js";
import { parseActivitiesCSV, mergeActivities } from "./core/parsers/activitiesParser.js";
import { parseHRVCSV, mergeHRV } from "./core/parsers/hrvParser.js";
import { parseSleepCSV, mergeSleep, cleanSleepForAveraging } from "./core/parsers/sleepParser.js";
import { parseWeightCSV, mergeWeight } from "./core/parsers/weightParser.js";
import { detectCSVType } from "./core/parsers/detectType.js";
import { fetchAndParseICS } from "./core/parsers/icsParser.js";
import { parseFITFile } from "./core/parsers/fitParser.js";
import { pushFit as pushFitToRelay, startFitPolling, pullFitsNow } from "./core/fit-relay.js";
import { parseCronometerCSV, parseTodayNutrition } from "./core/parsers/cronometerParser.js";
import { storage, migrateLegacyStorage, migrateSupplementKeys, attachEngine, initEncryption } from "./core/storage.js";
import { primeVitalsCache, dcy as dcyToday } from "./core/dcy.js";
import { allActivities as _allActs } from "./core/dcyMath.js";
import { parseLocalDate, startOfDay as _startOfDay, startOfWeekMonday as _startOfWeekMonday } from "./core/dateUtils.js";
import * as dbEngine from "./core/db.js";
import { fmtHMS, fmtHM, hydrationFor, hrZoneFromBpm, weeklyRunVolume, weeklyStrengthVolume, ytdVolume, pacePct as derivePacePct } from "./core/derive/index.js";
import { computeActivityNeeds, trackReplenishment, replenishmentSummary } from "./core/activityNeeds.js";
import { startPeriodicSync, syncAll, getSyncStatus, onSyncEvent, writeBackNutrition } from "./core/hc-sync.js";
import { isNativePlatform } from "./core/hc-bridge.js";
import { ImportDiagnostics } from "./components/ImportDiagnostics.jsx";
import { GoalsHub } from "./components/GoalsHub.jsx";
import { StartTilePicker, StartTilePickerInner } from "./components/StartTilePicker.jsx";
import { buildTileContext, TILE_METRICS, deriveStatus } from "./core/derive/tileMetrics.js";
// Phase 4r.intel.1 — conditions-aware metric status. Replaces hardcoded
// "color this tile red because it's an intensity metric" with status
// computed against published norms adjusted for temp/humidity. See
// core/expectedRanges.js for the bands + adjustment math.
import { buildIntelContext, makePaint, resolveIntelMaxHR } from "./core/intelContext.js";
import { resolveAllStartTiles } from "./core/derive/autoPromote.js";
import { KRITile, InlineKRIStat } from "./components/KRITile.jsx";
import { normalizeTilePrefs } from "./core/derive/tileMetrics.js";
import { SupplementsTab } from "./components/SupplementsTab.jsx";
import { CalendarTab } from "./components/CalendarTab.jsx";
import { StackCard } from "./components/StackCard.jsx";
import { RaceFocusCard } from "./components/RaceFocusCard.jsx";
import { summarizeRecentSignatures } from "./core/derive/recoverySignature.js";
import { MobileHome, MobileEdgeIQ, NAV_ITEMS, useSwipeNav, BottomNavBar, DcyDetails, NavIconForTab, TAB_LABEL, TAB_ACTIVE_COLOR, TAB_ACCENT_COLOR } from "./components/MobileHome.jsx";
import { SyncPanel, checkSyncImport, applySyncData } from "./components/SyncPanel.jsx";
import { BackupPanel } from "./components/BackupPanel.jsx";
import CloudSyncPanel from "./components/CloudSyncPanel.jsx";
import BackupStatusPanel from "./components/BackupStatusPanel.jsx";
import { startCloudSync, onCloudSyncEvent } from "./core/cloud-sync.js";
import { startAutoBackup, snapshotBeforeOp, purgeLegacyLocalStorageBackups } from "./core/backup.js";
import { getCatalog as getSupCatalog, getStack as getSupStack, getAdherence as getSupAdherence, getDailyNutrientTotals as getSupTotals } from "./core/supplements.js";
import { AVATAR_LIBRARY } from "./core/avatars.js";
import { getGoals } from "./core/goals.js";
import { WeeklyPlanner } from "./components/WeeklyPlanner.jsx";
import { Workbench } from "./components/Workbench.jsx";
import { todayPlanned, checkTodayCompletion } from "./core/planner.js";
import { trainingAnnotations, dailyAnnotations } from "./core/aiAnnotations.js";
import { AnnotationStrip } from "./components/AnnotationStrip.jsx";
import { CockpitRail } from "./components/CockpitRail.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { ArcDial } from "./components/ArcDial.jsx";
import { TrendBadge } from "./components/TrendBadge.jsx";
import { MiniBar } from "./components/MiniBar.jsx";
import { FocusCard } from "./components/FocusCard.jsx";
import { NutritionInput as NutritionInputPanel } from "./components/NutritionInput.jsx";
import { createEntry as createNutEntry, saveEntry as saveNutEntry, getEntriesForDate as getNutEntries, deleteEntry as deleteNutEntry, dailyTotals as nutDailyTotals } from "./core/nutrition.js";
import { getSystemsReport, getSystemDetail, getSystemWeekly } from "./core/healthSystems.js";
import "./core/energyBalance.js"; // wires window.energyBalanceDebug()
import { isRun as isRunAct, isStrength as isStrengthAct, isMobility as isMobilityAct, isHIIT as isHIITAct, isHardSession, activityKind, activityLabel, iconTypeFor } from "./core/activityClass.js";
import { getTopCoachingPrompts, getPromptsByPillar } from "./core/coachingPrompts.js"; // also wires window.coachingDebug()
import { getDynamicMacroTarget, assessCalibration, recommendCalorieTarget, getCurrentBodyComp, computeRMR } from "./core/energyBalance.js";
import { resolveCalorieTarget } from "./core/calorieTarget.js";
// Health system iconography — Gemini-generated line-art PNGs at 256×256 with
// dark #0b0d12 background and the system's accent color baked in. Vite
// resolves these to hashed asset URLs at build time.
import sysBrainPng      from "./assets/systems/brain.png";
import sysHeartPng      from "./assets/systems/heart.png";
import sysBonesPng      from "./assets/systems/bones.png";
import sysGutPng        from "./assets/systems/gut.png";
import sysImmunePng     from "./assets/systems/immune.png";
import sysEnergyPng     from "./assets/systems/energy.png";
import sysLongevityPng  from "./assets/systems/longevity.png";
import sysSleepPng      from "./assets/systems/sleep.png";
import sysMetabolismPng from "./assets/systems/metabolism.png";
import sysEndurancePng  from "./assets/systems/endurance.png";
import sysHormonesPng   from "./assets/systems/hormones.png";
const SYSTEM_PNGS_DESKTOP = {
  brain: sysBrainPng, heart: sysHeartPng, bones: sysBonesPng, gut: sysGutPng,
  immune: sysImmunePng, energy: sysEnergyPng, longevity: sysLongevityPng,
  sleep: sysSleepPng, metabolism: sysMetabolismPng, endurance: sysEndurancePng,
  hormones: sysHormonesPng,
};
import { DataSync } from "./components/DataSync.jsx";
import { ArcDialSVG } from "./components/ArcDialSVG.jsx";
import {
  weeklyLoad, loadTrend, paceTrend, hrEfficiency,
  trainingMonotony, raceReadiness, trainingConsistency, buildTrainingContext,
} from "./core/trainingIntelligence.js";
import {
  computeRTSS, computeHrTSS, computeAcuteChronicRatio, computeTonnage, computeDensity,
  computeHyroxDensity, matchTemplate, computeDailyScore,
  computeRolling7d, computeRolling30d, getEffectiveMaxHR,
} from "./core/trainingStress.js";

// ─── Unified Activities: merge CSV imports + daily FIT uploads ───────────────
// Single source of truth — used everywhere that needs activity data.
// A day can have multiple activities (e.g. morning run + evening strength, or two runs).
// `dailyLogs[day].fitActivities` is the authoritative list; `fitData` is a legacy alias
// for the latest upload and is used only as a fallback for older rows without the array.
function getLogFitActivities(log) {
  if (!log) return [];
  if (Array.isArray(log.fitActivities) && log.fitActivities.length) return log.fitActivities;
  if (log.fitData) return [log.fitData];
  return [];
}

// Desktop's unified-activity reader now delegates to the single source of
// truth in core/dcyMath.js. Earlier this file held its own parallel merge
// implementation; consolidated 2026-04 into allActivities() so all four
// historical call sites (this, useMobileData, MobileEdgeIQ,
// SystemDetailPanel) read the same view.
function getUnifiedActivities() {
  return _allActs();
}

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
// Routed through the Cloud Sync Worker's /ai/messages endpoint:
//   - No CORS (Worker is server-side relative to api.anthropic.com)
//   - No API key in the bundle (ANTHROPIC_API_KEY is a Worker secret)
//   - Rate limiting (60 calls/hour per token, see worker.js handleAIMessages)
// Direct-browser path kept as a fallback for when the Worker is unconfigured.
const AI_WORKER_ENDPOINT = () => (localStorage.getItem('arnold:cloud-sync:endpoint') || '').replace(/\/$/, '');
const AI_WORKER_TOKEN    = () => localStorage.getItem('arnold:cloud-sync:token') || '';
const AI_KEY = () => import.meta.env.VITE_ANTHROPIC_API_KEY || ''; // legacy / fallback only

async function ai(system, user, max = 1200) {
  // Preferred path: Worker proxy
  const ep = AI_WORKER_ENDPOINT();
  const tok = AI_WORKER_TOKEN();
  if (ep && tok) {
    try {
      const r = await fetch(`${ep}/ai/messages`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'authorization': `Bearer ${tok}`,
        },
        body: JSON.stringify({ system, user, max, model: 'claude-sonnet-4-5-20250929' }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        // 503 ai_not_configured → fall through to direct-browser path
        if (e?.error === 'ai_not_configured') {
          /* fall through */
        } else {
          return `API error ${r.status}: ${e.error?.message || e?.detail || e?.error || 'Unknown error'}`;
        }
      } else {
        const d = await r.json();
        return d.content?.[0]?.text || 'No response.';
      }
    } catch (err) {
      console.warn('[ai] Worker proxy failed, trying direct:', err?.message || err);
      /* fall through to direct */
    }
  }
  // Fallback: direct browser → Anthropic. Requires VITE_ANTHROPIC_API_KEY in
  // the bundle and a browser-allowed key. Subject to CORS issues post-2024.
  if (!AI_KEY()) return 'AI not configured — set ANTHROPIC_API_KEY on the Worker via `wrangler secret put`, or add VITE_ANTHROPIC_API_KEY to .env';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_KEY(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-dangerous-allow-browser': 'true',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return `API error ${r.status}: ${e.error?.message || 'Unknown error'}`; }
  const d = await r.json();
  return d.content?.[0]?.text || 'No response.';
}

async function aiStream(system,user,max=1800,onChunk){
  if(!AI_KEY())throw new Error("API key not configured — add VITE_ANTHROPIC_API_KEY to arnold-app/.env");
  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:AI_HDR(),
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:max,stream:true,system,messages:[{role:"user",content:user}]}),
  });
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||`API error ${r.status}`);}
  const reader=r.body.getReader(),dec=new TextDecoder();
  let full="",buf="";
  while(true){
    const{done,value}=await reader.read();
    if(done)break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split("\n");buf=lines.pop()||"";
    for(const line of lines){
      if(!line.startsWith("data: "))continue;
      const d=line.slice(6).trim();if(d==="[DONE]")continue;
      try{const p=JSON.parse(d);if(p.type==="content_block_delta"&&p.delta?.type==="text_delta"){full+=p.delta.text;onChunk(full);}}catch{}
    }
  }
  return full;
}

// ─── Blood Panel Reference Ranges ────────────────────────────────────────────
// ─── BM · Blood-marker registry ──────────────────────────────────────────────
// Each entry carries `desc` (Phase 4o.labs.4) — a one-line plain-English
// explainer rendered inline on the lab tile. Keep descriptions ≤ ~90
// chars so they fit two short lines without crowding the sparkline.
const BM={
  "Glucose (mg/dL)":{cat:"Metabolic",opt:[72,90],warn:[90,100],unit:"mg/dL",dir:"low",lbl:"Fasting Glucose",desc:"Fasting blood sugar — high signals insulin resistance trending toward diabetes."},
  "HbA1c (%)":{cat:"Metabolic",opt:[4.6,5.3],warn:[5.3,5.7],unit:"%",dir:"low",lbl:"HbA1c",desc:"Average blood sugar over ~3 months — the long-arc glucose-control marker."},
  "Insulin (µIU/mL)":{cat:"Metabolic",opt:[2,6],warn:[6,10],unit:"µIU/mL",dir:"low",lbl:"Fasting Insulin",desc:"How hard the pancreas is working to manage glucose. High = insulin resistance."},
  "LDL Cholesterol (mg/dL)":{cat:"Lipids",opt:[40,99],warn:[99,130],unit:"mg/dL",dir:"low",lbl:"LDL",desc:"\"Bad\" cholesterol — particles that drive arterial plaque buildup."},
  "HDL Cholesterol (mg/dL)":{cat:"Lipids",opt:[60,100],warn:[50,60],unit:"mg/dL",dir:"high",lbl:"HDL",desc:"\"Good\" cholesterol — clears excess lipids back to the liver."},
  "Triglycerides (mg/dL)":{cat:"Lipids",opt:[40,100],warn:[100,150],unit:"mg/dL",dir:"low",lbl:"Triglycerides",desc:"Stored fat in blood. High = metabolic stress, often from sugar or alcohol."},
  "Total Cholesterol (mg/dL)":{cat:"Lipids",opt:[140,180],warn:[180,200],unit:"mg/dL",dir:"low",lbl:"Total Chol",desc:"Sum of all blood lipids. Less informative than LDL/HDL/ApoB on their own."},
  "ApoB (mg/dL)":{cat:"Lipids",opt:[40,80],warn:[80,100],unit:"mg/dL",dir:"low",lbl:"ApoB",desc:"Count of atherogenic particles. Best single predictor of cardiac risk."},
  "hsCRP (mg/L)":{cat:"Inflammation",opt:[0,0.5],warn:[0.5,1.0],unit:"mg/L",dir:"low",lbl:"hsCRP",desc:"Systemic inflammation marker. Tracks infection, injury, and chronic stress."},
  "Ferritin (ng/mL)":{cat:"Inflammation",opt:[50,150],warn:[150,200],unit:"ng/mL",dir:"mid",lbl:"Ferritin",desc:"Iron storage. Low = iron deficiency. High = inflammation or iron overload."},
  "Testosterone (ng/dL)":{cat:"Hormones",opt:[600,900],warn:[450,600],unit:"ng/dL",dir:"high",lbl:"Testosterone",desc:"Anabolic hormone — drives muscle, bone, libido, energy, and mood."},
  "Free testosterone (ng/dL)":{cat:"Hormones",opt:[8,15],warn:[6,8],unit:"ng/dL",dir:"high",lbl:"Free T",desc:"Bioavailable testosterone (not bound to SHBG). The active fraction."},
  "Cortisol (µg/dL)":{cat:"Hormones",opt:[8,18],warn:[18,22],unit:"µg/dL",dir:"mid",lbl:"Cortisol",desc:"Stress hormone. Chronic high = wear; chronic low = adrenal fatigue."},
  "TSH (µIU/L)":{cat:"Hormones",opt:[1.0,2.5],warn:[2.5,3.5],unit:"µIU/L",dir:"mid",lbl:"TSH",desc:"Pituitary signal to the thyroid. High TSH = thyroid under-active."},
  "SHBG (nmol/L)":{cat:"Hormones",opt:[20,55],warn:[55,70],unit:"nmol/L",dir:"mid",lbl:"SHBG",desc:"Binds sex hormones. High SHBG = less free testosterone available."},
  "Testosterone:Cortisol Ratio (Units)":{cat:"Hormones",opt:[50,100],warn:[40,50],unit:"",dir:"high",lbl:"T:C Ratio",desc:"Anabolic-to-catabolic balance. Drops during overtraining or chronic stress."},
  "Vitamin D (ng/mL)":{cat:"Nutrients",opt:[50,80],warn:[30,50],unit:"ng/mL",dir:"high",lbl:"Vitamin D",desc:"Bone, immune, mood. Low → bone loss, mood dips, weaker immunity."},
  "Vitamin B12 (pg/mL)":{cat:"Nutrients",opt:[500,900],warn:[300,500],unit:"pg/mL",dir:"high",lbl:"B12",desc:"Nerve function and red-cell synthesis. Low → fatigue, numbness, anemia."},
  "Folate (ng/mL)":{cat:"Nutrients",opt:[10,24],warn:[7,10],unit:"ng/mL",dir:"high",lbl:"Folate",desc:"DNA synthesis and red-cell maturation. Pairs with B12 for blood + nerve."},
  "Magnesium (mg/dL)":{cat:"Nutrients",opt:[2.0,2.5],warn:[1.8,2.0],unit:"mg/dL",dir:"high",lbl:"Magnesium",desc:"300+ enzyme reactions — muscle, sleep, energy. Often deficient in athletes."},
  "RBC Magnesium (mg/dL)":{cat:"Nutrients",opt:[4.2,6.0],warn:[3.5,4.2],unit:"mg/dL",dir:"high",lbl:"RBC Mg",desc:"Intracellular magnesium — better deficiency marker than serum Mg."},
  "Iron (ug/dL)":{cat:"Nutrients",opt:[70,140],warn:[50,70],unit:"µg/dL",dir:"mid",lbl:"Iron",desc:"Oxygen transport. Endurance training drains iron; low → persistent fatigue."},
  "ALT (U/L)":{cat:"Liver",opt:[7,25],warn:[25,40],unit:"U/L",dir:"low",lbl:"ALT",desc:"Liver-specific cell damage marker. Sensitive to fatty liver and alcohol."},
  "AST (U/L)":{cat:"Liver",opt:[10,30],warn:[30,40],unit:"U/L",dir:"low",lbl:"AST",desc:"Liver and muscle damage. Rises with hard training too — context matters."},
  "GGT (U/L)":{cat:"Liver",opt:[8,25],warn:[25,40],unit:"U/L",dir:"low",lbl:"GGT",desc:"Liver detox stress. Sensitive to alcohol, medications, oxidative load."},
  "Albumin (g/dL)":{cat:"Liver",opt:[4.3,5.0],warn:[4.0,4.3],unit:"g/dL",dir:"high",lbl:"Albumin",desc:"Liver-synthesised protein. Reflects nutrition status and hydration."},
  "Hemoglobin (g/dL)":{cat:"Blood",opt:[13.5,17],warn:[12,13.5],unit:"g/dL",dir:"high",lbl:"Hemoglobin",desc:"Oxygen-carrying protein in red blood cells. Low → anemia, fatigue."},
  "Hematocrit (%)":{cat:"Blood",opt:[40,50],warn:[38,40],unit:"%",dir:"mid",lbl:"Hematocrit",desc:"Percentage of blood made up of red cells. Reflects oxygen-carrying capacity."},
  "White blood cells (thousands/uL)":{cat:"Blood",opt:[4.0,7.0],warn:[3.5,4.0],unit:"K/µL",dir:"mid",lbl:"WBC",desc:"Total immune-cell count. Big shifts signal infection or immune stress."},
  "Platelets (thousands/uL)":{cat:"Blood",opt:[150,300],warn:[130,150],unit:"K/µL",dir:"mid",lbl:"Platelets",desc:"Clotting cells. Also signal repair processes and chronic inflammation."},
  "Calcium (mg/dL)":{cat:"Electrolytes",opt:[9.2,10.2],warn:[8.8,9.2],unit:"mg/dL",dir:"mid",lbl:"Calcium",desc:"Bone, muscle contraction, nerve signaling. Tightly regulated by the body."},
  "Potassium (mmol/L)":{cat:"Electrolytes",opt:[3.8,4.5],warn:[3.5,3.8],unit:"mmol/L",dir:"mid",lbl:"Potassium",desc:"Muscle, heart rhythm, nerve. Critical electrolyte for athletes."},
  "Sodium (mmol/L)":{cat:"Electrolytes",opt:[136,142],warn:[134,136],unit:"mmol/L",dir:"mid",lbl:"Sodium",desc:"Hydration and blood volume. Endurance athletes lose this through sweat."},
  "Creatine kinase (U/L)":{cat:"Inflammation",opt:[30,200],warn:[200,400],unit:"U/L",dir:"low",lbl:"CK",desc:"Muscle-damage marker. Spikes after hard training; chronic high = poor recovery."},
  "TIBC (ug/dL)":{cat:"Nutrients",opt:[250,400],warn:[220,250],unit:"µg/dL",dir:"mid",lbl:"TIBC",desc:"Iron-binding capacity. High TIBC = body upregulating carriers (iron deficient)."},
  "Transferrin saturation (%)":{cat:"Nutrients",opt:[20,45],warn:[15,20],unit:"%",dir:"mid",lbl:"Trans Sat",desc:"Percent of transferrin carrying iron. Ratio of available vs stored iron."},
  "RBC (x10E6/µL)":{cat:"Blood",opt:[4.5,5.5],warn:[4.0,4.5],unit:"M/µL",dir:"mid",lbl:"RBC",desc:"Red blood cell count — your oxygen-delivery infrastructure."},
  "eGFR (mL/min)":{cat:"Kidney",opt:[90,120],warn:[60,90],unit:"mL/min",dir:"high",lbl:"eGFR",desc:"Estimated kidney filtration rate. Lower = reduced kidney function."},
  "Creatinine (mg/dL)":{cat:"Kidney",opt:[0.7,1.2],warn:[1.2,1.4],unit:"mg/dL",dir:"low",lbl:"Creatinine",desc:"Muscle-breakdown waste cleared by kidneys. High = filtration falling behind."},
  // ── CBC differential — counts + percentages (Phase 4o.labs.3) ──────
  // All filed under "Blood" since they're part of the complete blood
  // count. Reference ranges match InsideTracker's PDF; opt is a
  // clinically reasonable sub-window inside the reference range.
  "Neutrophil count (cells/µL)":   {cat:"Blood",opt:[2500,5000],warn:[1500,7800],unit:"cells/µL",dir:"mid",lbl:"Neutrophils", desc:"Front-line bacterial-defense cells. Spike with infection or acute stress."},
  "Lymphocyte count (cells/µL)":   {cat:"Blood",opt:[1500,3000],warn:[850,3900], unit:"cells/µL",dir:"mid",lbl:"Lymphocytes", desc:"T and B cells — viral defense and long-term immune memory."},
  "Monocyte count (cells/µL)":     {cat:"Blood",opt:[300,700],  warn:[200,950],  unit:"cells/µL",dir:"mid",lbl:"Monocytes",   desc:"Tissue-cleanup immune cells. Chronic high = ongoing inflammation."},
  "Eosinophil count (cells/µL)":   {cat:"Blood",opt:[15,200],   warn:[15,500],   unit:"cells/µL",dir:"low",lbl:"Eosinophils", desc:"Allergy and parasite responders. Elevated = allergic activity."},
  "Basophil count (cells/µL)":     {cat:"Blood",opt:[0,50],     warn:[0,200],    unit:"cells/µL",dir:"low",lbl:"Basophils",   desc:"Histamine release in allergic and inflammatory reactions."},
  "Neutrophil percentage (%)":     {cat:"Blood",opt:[45,65],    warn:[39,75],    unit:"%",       dir:"mid",lbl:"Neut %",      desc:"Neutrophils as fraction of WBC. High = bacterial or acute stress."},
  "Lymphocyte percentage (%)":     {cat:"Blood",opt:[25,40],    warn:[16,47],    unit:"%",       dir:"mid",lbl:"Lymph %",     desc:"Lymphocytes as fraction of WBC. High = viral or chronic immune activity."},
  "Monocyte percentage (%)":       {cat:"Blood",opt:[5,9],      warn:[4,12],     unit:"%",       dir:"mid",lbl:"Mono %",      desc:"Monocytes as fraction of WBC. Tracks chronic inflammation."},
  "Eosinophil percentage (%)":     {cat:"Blood",opt:[0,3],      warn:[0,7],      unit:"%",       dir:"low",lbl:"Eos %",       desc:"Eosinophils as fraction of WBC. High = allergies, asthma, parasites."},
  "Basophil percentage (%)":       {cat:"Blood",opt:[0,1],      warn:[0,2],      unit:"%",       dir:"low",lbl:"Baso %",      desc:"Basophils as fraction of WBC. High = allergies or rare blood disorders."},
  // ── CBC red cell + platelet indices ──
  // MCV/MCH/MCHC characterise red-cell size and hemoglobin packing
  // (low = microcytic anemia, high = macrocytic). RDW captures size
  // dispersion (high = anisocytosis, an early anemia/inflammation
  // signal). MPV reflects platelet size — drift can flag immune or
  // marrow-stimulus changes.
  "MCV (fL)":                      {cat:"Blood",opt:[85,95],    warn:[80,100],   unit:"fL",      dir:"mid",lbl:"MCV",         desc:"Avg red-cell size. Low = microcytic (iron-def), high = macrocytic (B12/folate)."},
  "MCH (pg)":                      {cat:"Blood",opt:[28,32],    warn:[27,33],    unit:"pg",      dir:"mid",lbl:"MCH",         desc:"Average hemoglobin per red cell — pairs with MCV for anemia typing."},
  "MCHC (g/dL)":                   {cat:"Blood",opt:[33,35],    warn:[32,36],    unit:"g/dL",    dir:"mid",lbl:"MCHC",        desc:"Hemoglobin concentration in red cells (density). Stable in most cases."},
  "RDW (%)":                       {cat:"Blood",opt:[11,13],    warn:[11,15],    unit:"%",       dir:"low",lbl:"RDW",         desc:"Red-cell size variability. Rises early in anemia or chronic inflammation."},
  "MPV (fL)":                      {cat:"Blood",opt:[9,11],     warn:[7.5,12.5], unit:"fL",      dir:"mid",lbl:"MPV",         desc:"Average platelet size. Drift signals marrow activity or inflammation."},
};
const BCATS=["Metabolic","Lipids","Inflammation","Hormones","Nutrients","Liver","Blood","Electrolytes","Kidney"];
const BCAT_CLR={Metabolic:"#60a5fa",Lipids:"#f59e0b",Inflammation:"#f87171",Hormones:"#a78bfa",Nutrients:"#4ade80",Liver:"#fb923c",Blood:"#e879f9",Electrolytes:"#38bdf8",Kidney:"#94a3b8",Other:"#94a3b8"};
const BCAT_ICO={Metabolic:"◈",Lipids:"◉",Inflammation:"⚡",Hormones:"∿",Nutrients:"◆",Liver:"⊕",Blood:"○",Electrolytes:"⚛",Kidney:"◎",Other:"?"};

function bStatus(name,val){
  const m=BM[name]; if(!m||val==null)return"unknown";
  const v=parseFloat(val); const[oL,oH]=m.opt; const[wL,wH]=m.warn;
  if(v>=oL&&v<=oH)return"optimal";
  if(m.dir==="low"){ if(v>wH)return"flag"; if(v>oH)return"warn"; return"optimal"; }
  if(m.dir==="high"){ if(v<wL)return"flag"; if(v<oL)return"warn"; return"optimal"; }
  if(v<wL||v>wH)return"flag"; if(v<oL||v>oH)return"warn"; return"optimal";
}
const SC={optimal:"var(--status-ok)",warn:"var(--status-warn)",flag:"var(--status-danger)",unknown:"var(--text-muted)"};
// Status labels (Phase 4o.labs.5) — "warn" was previously labelled
// "Monitor", which sounded alarming for values that are actually within
// the lab's reference range, just outside the user-set optimal sub-window.
// "Normal" reflects the truth: in range, not optimal. The yellow colour
// stays so the visual distinction from green/red is preserved.
const SL={optimal:"Optimal",warn:"Normal",flag:"Review",unknown:"—"};
const SC_BG={optimal:"var(--status-ok-bg)",warn:"var(--status-warn-bg)",flag:"var(--status-danger-bg)",unknown:"transparent"};
const SC_BORDER={optimal:"rgba(74,222,128,0.2)",warn:"rgba(245,158,11,0.2)",flag:"rgba(248,113,113,0.2)",unknown:"transparent"};

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function parseCSV(text){
  const lines=text.trim().split(/\r?\n/); if(lines.length<2)return[];
  const hdrs=lines[0].split(",").map(h=>h.trim().replace(/^"|"$/g,"").toLowerCase());
  return lines.slice(1).map(line=>{
    const v=[]; let c="",q=false;
    for(const ch of line){ if(ch==='"')q=!q; else if(ch===","&&!q){v.push(c.trim());c="";}else c+=ch; }
    v.push(c.trim());
    const row={}; hdrs.forEach((h,i)=>{row[h]=(v[i]||"").replace(/^"|"$/g,"");});
    return row;
  }).filter(r=>Object.values(r).some(v=>v!==""));
}
function parseLabCSV(text){
  const lines=text.trim().split(/\r?\n/); if(lines.length<2)return[];
  const hdrs=lines[0].split(",").map(h=>h.replace(/^"|"$/g,"").trim());
  const dates=hdrs.slice(1); const snaps={};
  dates.forEach(d=>{snaps[d]={};});
  lines.slice(1).forEach(line=>{
    const cols=[]; let c="",q=false;
    for(const ch of line){ if(ch==='"')q=!q; else if(ch===","&&!q){cols.push(c.trim());c="";}else c+=ch; }
    cols.push(c.trim());
    const mn=cols[0].replace(/^"|"$/g,"").trim();
    dates.forEach((d,i)=>{ const v=parseFloat((cols[i+1]||"").replace(/\s/g,"")); if(!isNaN(v))snaps[d][mn]=v; });
  });
  const mmap={Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};
  return dates.map(date=>{
    let nd=date; const m=date.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
    if(m)nd=`${m[3]}-${mmap[m[1]]||"01"}-${m[2].padStart(2,"0")}`;
    return{date:nd,markers:snaps[date],source:"csv"};
  }).filter(s=>Object.keys(s.markers).length>0);
}
function ndate(raw){
  if(!raw)return null;
  if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10);
  const m=raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m)return`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  return null;
}

// ─── Garmin column mapping (structured for specific columns) ──────────────────
function mapGarmin(rows){
  const by={};
  const mg=(d,p)=>{if(!d)return;by[d]={...(by[d]||{date:d}),...p};};
  rows.forEach(r=>{
    const d=ndate(r["date"]||r["start time"]||r["activity date"]||r["calendar date"]);
    // Activity columns: Date, Activity Type, Distance, Calories, Time, Avg HR, Max HR,
    //                   Avg Pace, Best Pace, Total Ascent, Total Descent, Avg Cadence, Steps
    if(r["activity type"]!==undefined) mg(d,{
      workout:        r["activity type"]||r["title"]||"",
      workoutDuration:r["time"]||r["elapsed time"]||"",
      calories:       r["calories"]||"",
      heartRate:      r["avg hr"]||"",
      maxHR:          r["max hr"]||"",
      avgPace:        r["avg pace"]||"",
      bestPace:       r["best pace"]||"",
      totalAscent:    r["total ascent"]||"",
      totalDescent:   r["total descent"]||"",
      avgCadence:     r["avg cadence"]||"",
      steps:          r["steps"]||"",
      distance:       r["distance"]||"",
    });
    if(r["deep sleep"]!==undefined){
      // Garmin writes each stage as "h:mm". Convert to minutes per stage and
      // also keep the combined total hours for legacy consumers (DCY §8 P1).
      const stageMin=(k)=>{const v=r[k]||"";const p=v.split(":").map(Number);return (p[0]||0)*60+(p[1]||0);};
      const deepMin=stageMin("deep sleep"); const lightMin=stageMin("light sleep"); const remMin=stageMin("rem sleep"); const awakeMin=stageMin("awake");
      const totalHours=(deepMin+lightMin+remMin)/60;
      mg(d,{
        sleep: totalHours>0?totalHours.toFixed(2):"",
        deepSleepMinutes:  deepMin>0?deepMin:null,
        lightSleepMinutes: lightMin>0?lightMin:null,
        remSleepMinutes:   remMin>0?remMin:null,
        awakeMinutes:      awakeMin>0?awakeMin:null,
      });
    }
    if(r["last night"]!==undefined)mg(d,{hrv:r["last night"]||"",hrvStatus:{"balanced":"good","unbalanced":"moderate","poor":"low"}[(r["status"]||"").toLowerCase()]||""});
    if(r["weight"]!==undefined&&!r["activity type"]&&!r["last night"])mg(d,{weight:r["weight (kg)"]||r["weight"]||"",bodyFat:r["body fat %"]||""});
    if(r["avg resting hr"]!==undefined)mg(d,{heartRate:r["avg resting hr"]||""});
  });
  return Object.values(by).filter(e=>e.date);
}

// ─── Cronometer column mapping (structured for specific columns) ──────────────
function mapCrono(rows){
  const by={};
  const mg=(d,p)=>{if(!d)return;by[d]={...(by[d]||{date:d}),...p};};
  rows.forEach(r=>{
    const d=ndate(r["date"]||r["day"]);
    // Columns: Date, Energy (kcal), Protein (g), Carbohydrates (g), Fat (g),
    //          Fiber (g), Sodium (mg), Caffeine (mg)
    if(r["energy (kcal)"]!==undefined) mg(d,{
      calories:   r["energy (kcal)"]||"",
      protein:    r["protein (g)"]||"",
      carbs:      r["carbohydrates (g)"]||"",
      fat:        r["fat (g)"]||"",
      fiber:      r["fiber (g)"]||"",
      sodium:     r["sodium (mg)"]||"",
      caffeine:   r["caffeine (mg)"]||"",
    });
    if(r["metric"]!==undefined){const m=(r["metric"]||"").toLowerCase();const a=r["amount"]||"";if(m.includes("weight"))mg(d,{weight:a});if(m.includes("sleep"))mg(d,{sleep:a});if(m.includes("hrv"))mg(d,{hrv:a});}
  });
  return Object.values(by).filter(e=>e.date);
}

function mergeLogs(ex,inc,strat){
  const map={};ex.forEach(e=>{map[e.date]={...e};});
  let a=0,u=0;
  inc.forEach(e=>{
    if(!e.date)return;
    const cl=Object.fromEntries(Object.entries(e).filter(([,v])=>v!==""&&v!=null));
    if(!map[e.date]){map[e.date]=cl;a++;}
    else if(strat==="overwrite"){map[e.date]={...map[e.date],...cl};u++;}
    else if(strat==="fill"){let ch=false;Object.entries(cl).forEach(([k,v])=>{if(!map[e.date][k]||map[e.date][k]===""){map[e.date][k]=v;ch=true;}});if(ch)u++;}
  });
  return{logs:Object.values(map).sort((a,b)=>b.date.localeCompare(a.date)),added:a,updated:u};
}

// ─── Weather: uses fetchWeatherForDate from pdfParser.js ─────────────────────

// ─── Utilities ────────────────────────────────────────────────────────────────
const td=(dt=new Date())=>{const d=dt instanceof Date?dt:new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const fmt=(v,u="")=>(v!==""&&v!=null?`${v}${u}`:"—");
const Q=["—","1","2","3","4","5"];
const HRV_L={excellent:"Excellent",good:"Good",moderate:"Moderate",low:"Low"};
function hc(hrv){const n=parseFloat(hrv);if(isNaN(n))return"#aaa";if(n>=70)return"#4ade80";if(n>=50)return"#facc15";if(n>=35)return"#fb923c";return"#f87171";}
function dc(name,delta){const m=BM[name];if(!m)return"#aaa";if(m.dir==="high")return delta>0?"#4ade80":"#f87171";if(m.dir==="low")return delta<0?"#4ade80":"#f87171";return"#aaa";}
function genId(){return(crypto.randomUUID?.())||`${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function calcPace(duration,distance){
  const m=parseFloat(duration),d=parseFloat(distance);
  if(isNaN(m)||isNaN(d)||d===0)return"";
  const pm=m/d;const min=Math.floor(pm);const sec=Math.round((pm-min)*60);
  return`${min}:${sec.toString().padStart(2,"0")}`;
}
function daysUntil(dateStr){
  const now=new Date();now.setHours(0,0,0,0);
  const target=parseLocalDate(dateStr);if(!target)return 0;
  target.setHours(0,0,0,0);
  return Math.round((target-now)/(1000*60*60*24));
}
function raceTypeBadge(distKm){
  const d=parseFloat(distKm);
  if(isNaN(d))return"Other";
  if(d<=5.1)return"5K";if(d<=10.1)return"10K";if(d<=21.2)return"Half";if(d<=42.3)return"Full";return"Ultra";
}

const TABS=[
  {id:"training", label:"EdgeIQ",icon:"◈"},
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
      // Health Connect: start periodic sync if running in Capacitor (native Android)
      if(isNativePlatform()){
        startPeriodicSync();
        onSyncEvent((evt,payload)=>{
          if(evt==='sync:complete'&&payload?.totalSynced>0){
            showToast(`Health Connect synced ${payload.totalSynced} records`);
            loadData().then(d2=>setData(d2));
          }
        });
      }
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
      console.log('%c[arnold-build] Phase 4r.intel.9 · weather-on-sync-2026-05-21','background:#1f3a1f;color:#c8e6c9;padding:2px 6px;border-radius:4px;font-weight:600');
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
        // Boot sync — auto mode honors thresholds.
        syncEverything().then(r => {
          if (r.ranSources.length > 0) {
            console.log('[full-sync] boot ran:', r.ranSources, 'skipped fresh:', r.skippedFresh, 'in', r.durationMs, 'ms');
          }
        }).catch(e => console.warn('[full-sync] boot failed:', e));

        // Foreground resume (mobile background→foreground, web tab refocus)
        if (typeof document !== 'undefined') {
          let lastBoot = Date.now();
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            // Debounce: only re-sync if > 60s since last visibility-driven sync
            if (Date.now() - lastBoot < 60_000) return;
            lastBoot = Date.now();
            syncEverything().then(r => {
              if (r.ranSources.length > 0) {
                console.log('[full-sync] resume ran:', r.ranSources, 'skipped fresh:', r.skippedFresh);
              }
            }).catch(e => console.warn('[full-sync] resume failed:', e));
          });
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
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{...S.nb,...(tab===t.id?S.nba:{})}}><span style={S.ni}>{t.icon}</span><span style={S.nl}>{t.label}</span></button>)}
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
        {isMobileApp&&!mobileHomeActive&&(()=>{
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
        {tab==="weekly"&&<div className="arnold-tab-panel"><Dashboard data={data} setTab={setTab} showToast={showToast} aiSummLoad={aiSummLoad} aiSummStream={aiSummStream} mobileInitView={mobileInitView} onAiSum={async()=>{
          if(aiSummLoad)return;
          setAiSummLoad(true);setAiSummStream("");
          try{
            const ins=await aiSummary(data,chunk=>setAiSummStream(chunk));
            await persist({...data,aiInsights:[{date:td(),text:ins},...data.aiInsights.slice(0,4)]});
          }catch(e){setAiSummStream(`Error: ${e.message}`);}
          finally{setAiSummLoad(false);}
        }}/></div>}
        {tab==="labs"&&<div className="arnold-tab-panel"><LabsModule data={data} persist={persist} showToast={showToast}/></div>}
        {tab==="clinical"&&<div className="arnold-tab-panel"><ClinicalModule data={data} persist={persist} showToast={showToast}/></div>}
        {tab==="training"&&<div className="arnold-tab-panel"><TrainingTab setTab={setTab} data={data} mobileInitView={mobileInitView} onMobileInitViewUsed={()=>setMobileInitView('start')}/></div>}
        {tab==="daily"&&<div className="arnold-tab-panel"><LogDay data={data} persist={persist} showToast={showToast} setTab={setTab}/></div>}
        {tab==="activity"&&<div className="arnold-tab-panel"><LogDay data={data} persist={persist} showToast={showToast} mobileView="activity" setTab={setTab}/></div>}
        {tab==="nutrition_mobile"&&<div className="arnold-tab-panel"><LogDay data={data} persist={persist} showToast={showToast} mobileView="nutrition" setTab={setTab}/></div>}
        {tab==="races"&&<div className="arnold-tab-panel"><CalendarTab showToast={showToast}/></div>}
        {tab==="goals"&&<div className="arnold-tab-panel"><div style={S.sec}>{!isMobileApp && <div style={S.st}>Plan</div>}<WeeklyPlanner showToast={showToast}/><Workbench showToast={showToast}/><GoalsHub showToast={showToast}/></div></div>}
        {tab==="supplements"&&<div className="arnold-tab-panel"><SupplementsTab showToast={showToast}/></div>}
        {tab==="settings"&&<div className="arnold-tab-panel"><ProfileSettings data={data} persist={persist} showToast={showToast}/></div>}
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
function ClinicalModule({data,persist,showToast}){
  const [view,setView]=useState("overview");
  const [aiText,setAiText]=useState("");
  const [aiRun,setAiRun]=useState(false);

  const tests=data.clinicalTests||[];
  // All tests, grouped by type and sorted newest-first per group, so we can
  // (a) pick the latest of each type for the Overview cards, AND
  // (b) let the user navigate between historical scans inside each tab.
  const byType=tests.reduce((acc,t)=>{
    if(!t?.type) return acc;
    (acc[t.type]=acc[t.type]||[]).push(t);
    return acc;
  },{});
  Object.values(byType).forEach(arr=>arr.sort((a,b)=>(b.date||'').localeCompare(a.date||'')));

  const latest=Object.fromEntries(Object.entries(byType).map(([k,arr])=>[k,arr[0]]));

  // Per-tab selected scan date — defaults to the latest. User can flip via
  // the scan-picker chips at the top of each tab.
  const [dexaDate, setDexaDate]   = useState(latest.dexa?.date    || null);
  const [vo2Date,  setVo2Date]    = useState(latest.vo2max?.date  || null);
  const [rmrDate,  setRmrDate]    = useState(latest.rmr?.date     || null);

  const dexa=(byType.dexa  ||[]).find(t=>t.date===dexaDate) || latest.dexa;
  const vo2 =(byType.vo2max||[]).find(t=>t.date===vo2Date)  || latest.vo2max;
  const rmr =(byType.rmr   ||[]).find(t=>t.date===rmrDate)  || latest.rmr;

  // Garmin watch VO2Max — falls back into the VO2 tab when no recent lab test
  // exists. Pulled from activities collection (latest non-null vO2MaxValue).
  const garminVO2 = (() => {
    try {
      const acts = data.activities || [];
      const sorted = [...acts].sort((a,b) => (b.date||'').localeCompare(a.date||''));
      for (const a of sorted) {
        const v = a.vO2MaxValue ?? a.vo2Max ?? a.vO2Max;
        if (typeof v === 'number' && v > 0) return { value: Math.round(v * 10) / 10, date: a.date };
      }
    } catch {}
    return null;
  })();

  // Helper: format a metric value with optional unit and missing-fallback.
  const fmt = (v, unit = '', missing = '—') => {
    if (v == null || v === '') return missing;
    return unit ? `${v}${unit ? ' ' + unit : ''}` : String(v);
  };
  // Helper: render the historical-scan picker chip strip at the top of a tab.
  const ScanPicker = ({ scans, selectedDate, onSelect, accentColor }) => {
    if (!scans || scans.length <= 1) return null;
    return (
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
        {scans.map(s => (
          <button key={s.date} onClick={() => onSelect(s.date)} style={{
            fontSize:'clamp(10px,0.3vw + 9px,11px)',
            padding:'4px 10px',
            borderRadius:12,
            border:`0.5px solid ${selectedDate===s.date?accentColor:'rgba(255,255,255,0.1)'}`,
            background: selectedDate===s.date ? `${accentColor}25` : 'transparent',
            color: selectedDate===s.date ? accentColor : C.m,
            cursor:'pointer',
            letterSpacing:'0.04em',
          }}>
            {s.date}
          </button>
        ))}
      </div>
    );
  };

  // ── Garmin scale priority helpers (Phase 4g) ──
  // For metrics the daily Garmin scale measures (weight, body fat %, skeletal
  // muscle mass, BMI), prefer the most recent reading (within 7 days) over
  // the year-old lab anchor. Lab values are still kept and visible inside the
  // DEXA tab — they're just not the headline number for things that change
  // weekly. Returns { value, sourceLabel, sourceColor } per metric.
  const SCALE_FRESH_DAYS = 7;
  const scaleRows = useMemo(() => {
    const all = [...(data?.weight || [])]
      .filter(w => w?.date)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return all;
  }, [data?.weight]);
  const todayMs = Date.now();
  const isFresh = (dateStr) => {
    if (!dateStr) return false;
    const t = new Date(dateStr + 'T12:00:00').getTime();
    return Number.isFinite(t) && (todayMs - t) <= SCALE_FRESH_DAYS * 86400 * 1000;
  };
  // For each scale-able field, find the most recent row with a value.
  const latestScaleField = (key) => {
    for (const r of scaleRows) {
      if (r?.[key] != null && Number.isFinite(Number(r[key]))) {
        return { value: Number(r[key]), date: r.date };
      }
    }
    return null;
  };
  // hybrid(scaleField, labValue, labDate, fmt) — picks scale if fresh, else lab.
  // Returns { value, sub } shaped for the Overview cards.
  const hybrid = (scaleKey, labValue, labDate, opts = {}) => {
    const scale = latestScaleField(scaleKey);
    if (scale != null && isFresh(scale.date)) {
      return {
        value: opts.transform ? opts.transform(scale.value) : scale.value,
        sub: `📊 Scale · ${scale.date}`,
        source: 'scale',
      };
    }
    if (labValue != null) {
      return {
        value: opts.transform ? opts.transform(labValue) : labValue,
        sub: labDate ? `🔬 Lab · ${labDate}` : '—',
        source: 'lab',
      };
    }
    if (scale != null) {
      // Stale scale data is still better than nothing — flag the date
      return {
        value: opts.transform ? opts.transform(scale.value) : scale.value,
        sub: `📊 Scale · ${scale.date} (stale)`,
        source: 'scale-stale',
      };
    }
    return { value: null, sub: '—', source: null };
  };

  const runAI=async()=>{
    setAiRun(true);setAiText("");
    const txt=await ai(buildFullPrompt(data),
      `Analyse my complete clinical picture holistically. Cross-reference DEXA body composition, VO2Max fitness metrics, RMR metabolic data, and the most recent blood panel.
DEXA: ${JSON.stringify(dexa?.metrics||{})}
VO2Max: ${JSON.stringify(vo2?.metrics||{})}
RMR: ${JSON.stringify(rmr?.metrics||{})}
Latest Blood Panel: ${JSON.stringify((data.labSnapshots||[]).sort((a,b)=>b.date.localeCompare(a.date))[0]?.markers||{})}
Daily Logs (last 4 weeks): ${JSON.stringify((data.logs||[]).slice(0,28))}

Give: 1) Integrated health score with reasoning 2) Top 3 strengths across all tests 3) Top 3 priority improvements with specific targets 4) Key cross-test correlations (e.g. how body comp affects VO2, how RMR relates to blood markers) 5) 6-month action plan.`,1800);
    setAiText(txt);setAiRun(false);
  };

  // ── Clinical PDF upload state (Phase 4f) ──
  // User drags or picks a DEXA / VO2 / RMR PDF → parseClinicalPDF runs →
  // we show a preview modal where they can verify + edit values before save.
  const [pdfPreview, setPdfPreview] = useState(null); // { type, date, metrics, filename }
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState(null);
  const pdfInputRef = useRef();

  async function handleClinicalPdfUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfBusy(true); setPdfErr(null); setPdfPreview(null);
    try {
      const { parseClinicalPDF } = await import('./core/pdfParser.js');
      const parsed = await parseClinicalPDF(file);
      if (!parsed.ok) {
        setPdfErr(parsed.error === 'unknown_clinical_pdf'
          ? `Couldn't detect scan type from ${file.name}. Was this a DexaFit DEXA, VO2Max, or RMR report?`
          : `Parser failed: ${parsed.error}`);
      } else {
        setPdfPreview(parsed);
      }
    } catch (err) {
      setPdfErr(String(err?.message || err));
    } finally {
      setPdfBusy(false);
      if (e.target) e.target.value = '';
    }
  }

  function handleConfirmSave() {
    if (!pdfPreview) return;
    // Date fallback: if the PDF had no detectable date, use today.
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
    const date = pdfPreview.date || today;
    const next = [...(data.clinicalTests || [])];
    // Replace any existing test of same type+date (re-import case)
    const idx = next.findIndex(t => t?.type === pdfPreview.type && t?.date === date);
    const entry = { type: pdfPreview.type, date, source: 'pdf', filename: pdfPreview.filename, metrics: pdfPreview.metrics };
    if (idx >= 0) next[idx] = entry; else next.push(entry);
    persist({ ...data, clinicalTests: next });
    showToast?.(`Imported ${pdfPreview.type.toUpperCase()} scan · ${date}`);
    setView(pdfPreview.type === 'vo2max' ? 'vo2' : pdfPreview.type);
    setPdfPreview(null);
  }

  // Phase 4q.frame.3 — hide the "Body & Fitness" subhead on mobile so
  // the unified page header (Core) is the only top label and the tab
  // bar (Overview/DEXA/VO2 Max/RMR) sits closer to the page top.
  const _isMobile = typeof window !== 'undefined' && window.innerWidth <= 600;
  return(
    <div style={S.sec}>
      {!_isMobile && <div style={S.st}>◉ Body & Fitness</div>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={S.labNav}>
          {[["overview","Overview"],["dexa","DEXA"],["vo2","VO₂ Max"],["rmr","RMR"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setView(id)} style={{...S.lnb,...(view===id?S.lnba:{})}}>{lbl}</button>
          ))}
        </div>
        <button
          onClick={() => pdfInputRef.current?.click()}
          disabled={pdfBusy}
          style={{
            padding:'5px 10px', fontSize:11, fontWeight:500, letterSpacing:'0.04em',
            background:'transparent', borderWidth:'0.5px', borderStyle:'solid', borderColor:'#a78bfa',
            borderRadius:'var(--radius-sm)', color:'#a78bfa', cursor:'pointer',
          }}
          title="Upload a DexaFit DEXA / VO₂Max / RMR PDF — values auto-parse and save to your clinical history.">
          {pdfBusy ? 'Parsing…' : '↑ Upload scan'}
        </button>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{display:'none'}}
          onChange={handleClinicalPdfUpload}
        />
      </div>

      {pdfErr && (
        <div style={{padding:'8px 10px',marginBottom:8,fontSize:12,borderRadius:6,
          background:'#3a1f1f',color:'#ffd4d4',borderWidth:'0.5px',borderStyle:'solid',borderColor:'#5a2f2f'}}>
          {pdfErr}
        </div>
      )}

      {pdfPreview && (
        <div style={{padding:12,marginBottom:8,borderRadius:8,
          background:C.surf,borderWidth:'0.5px',borderStyle:'solid',borderColor:'#a78bfa'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:600,color:'#a78bfa'}}>
              Preview: {pdfPreview.type.toUpperCase()} · {pdfPreview.date || '(date not detected)'}
            </div>
            <div style={{fontSize:10,color:C.m}}>{pdfPreview.filename}</div>
          </div>
          <div style={{fontSize:11,color:C.m,marginBottom:8}}>
            {Object.keys(pdfPreview.metrics).length} fields parsed. Verify before saving — anything missing
            will show as "—" in the tab. If most fields are blank, click "Show raw PDF text" below
            and copy the contents — that lets a developer write patterns that match this exact report layout.
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))',gap:6,maxHeight:200,overflowY:'auto',marginBottom:10}}>
            {Object.entries(pdfPreview.metrics).map(([k, v]) => (
              <div key={k} style={{fontSize:11,padding:'4px 8px',background:'rgba(255,255,255,0.02)',borderRadius:4}}>
                <div style={{color:C.m,fontSize:9,letterSpacing:'0.04em',textTransform:'uppercase'}}>{k}</div>
                <div style={{color:C.t,fontWeight:500}}>{Array.isArray(v) ? `[${v.join('–')}]` : String(v)}</div>
              </div>
            ))}
          </div>
          {!pdfPreview.date && (
            <div style={{fontSize:11,color:'#fbbf24',marginBottom:6}}>
              ⚠ Date not detected. Saving will use today's date — you can edit this later in clinicalTests storage.
            </div>
          )}
          {/* Raw PDF text debug view — paste this back for parser tuning */}
          {pdfPreview.rawText && (
            <details style={{marginBottom:10}}>
              <summary style={{cursor:'pointer',fontSize:11,color:'#fbbf24',padding:'4px 0'}}>
                Show raw PDF text (for parser debugging — copy + paste back to refine patterns)
              </summary>
              <textarea
                readOnly
                value={pdfPreview.rawText}
                onClick={e => e.target.select()}
                style={{
                  width:'100%',minHeight:160,marginTop:6,padding:8,
                  fontFamily:'ui-monospace, SFMono-Regular, monospace',fontSize:10,
                  background:'#0b0d12',color:'#c8d1dc',
                  borderWidth:'0.5px',borderStyle:'solid',borderColor:'#2a2e38',
                  borderRadius:4,resize:'vertical',
                }}
              />
              <button
                onClick={() => { navigator.clipboard?.writeText(pdfPreview.rawText); showToast?.('Raw PDF text copied to clipboard'); }}
                style={{
                  marginTop:6,padding:'4px 10px',fontSize:11,
                  background:'transparent',color:'#a78bfa',
                  borderWidth:'0.5px',borderStyle:'solid',borderColor:'#a78bfa',
                  borderRadius:4,cursor:'pointer',
                }}>
                📋 Copy raw text
              </button>
            </details>
          )}
          <div style={{display:'flex',gap:6}}>
            <button onClick={handleConfirmSave} style={{
              padding:'6px 14px',fontSize:12,fontWeight:500,
              background:'#a78bfa',color:'#0b0d12',
              borderWidth:'0.5px',borderStyle:'solid',borderColor:'#a78bfa',
              borderRadius:6,cursor:'pointer',
            }}>
              Save to history
            </button>
            <button onClick={() => setPdfPreview(null)} style={{
              padding:'6px 14px',fontSize:12,
              background:'transparent',color:C.m,
              borderWidth:'0.5px',borderStyle:'solid',borderColor:'rgba(255,255,255,0.15)',
              borderRadius:6,cursor:'pointer',
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {view==="overview"&&(()=>{
        // Read latest values from each test type. Falls back to "—" when no scan exists.
        const dxa = latest.dexa?.metrics  || {};
        const v2  = latest.vo2max?.metrics || {};
        const rm  = latest.rmr?.metrics    || {};
        // Garmin watch VO2 takes over if it's newer than the lab test
        const labVO2Date = latest.vo2max?.date;
        const useWatchVO2 = garminVO2 && (!labVO2Date || garminVO2.date > labVO2Date);
        const vo2Headline = useWatchVO2 ? garminVO2.value : v2.vo2max;
        const vo2Sub      = useWatchVO2
          ? `📊 Watch · ${garminVO2.date}`
          : (v2.percentile != null
              ? `🔬 Lab · ${labVO2Date} · ${v2.percentile}th %ile`
              : (labVO2Date ? `🔬 Lab · ${labVO2Date}` : '—'));
        const fmt = (v) => v == null ? '—' : String(v);
        const fmt1 = (v) => v == null ? '—' : (Math.round(Number(v) * 10) / 10).toString();
        const fmtKcal = (v) => v == null ? '—' : Number(v).toLocaleString('en-US');

        // Hybrid metrics — scale wins when fresh, lab is the anchor otherwise.
        // bodyFatPct: scale `bodyFatPct` ↔ lab `dxa.bodyFatPct`.
        const bodyFat = hybrid('bodyFatPct', dxa.bodyFatPct, latest.dexa?.date);
        // Lean mass: scale provides skeletalMuscleMassLbs (skeletal only), DEXA provides
        // total lean (skeletal + organs + water). They aren't the same metric, so we
        // prefer the DEXA value here when present and only fall through to scale's
        // skeletal muscle reading as a directional indicator.
        const leanMass = (dxa.leanMass != null)
          ? { value: dxa.leanMass, sub: latest.dexa?.date ? `🔬 DEXA · ${latest.dexa.date}` : '—', source: 'lab' }
          : hybrid('skeletalMuscleMassLbs', null, null, { transform: v => `${v} skel.` });
        // Weight: ALWAYS prefer scale (daily reading is the freshest possible).
        const weight = hybrid('weightLbs', dxa.totalMass, latest.dexa?.date);

        const cards = [
          {label:"VO₂ Max",     value: fmt(vo2Headline),     unit:"ml/kg/min", sub: vo2Sub,                                                                                       color:"#34d399", icon:"◈"},
          {label:"Bio Age",     value: fmt(v2.bioAge),       unit:"years",     sub: v2.bioAge != null ? `🔬 Lab · ${labVO2Date}` : "—",                                          color:"#4ade80", icon:"∿"},
          {label:"Body Fat",    value: fmt1(bodyFat.value),  unit:"%",         sub: bodyFat.sub,                                                                                 color:"#f59e0b", icon:"⊗"},
          {label:"Lean Mass",   value: fmt(leanMass.value),  unit:"lbs",       sub: leanMass.sub,                                                                                color:"#a78bfa", icon:"◆"},
          {label:"Weight",      value: fmt1(weight.value),   unit:"lbs",       sub: weight.sub,                                                                                  color:"#60a5fa", icon:"⚖"},
          {label:"RMR",         value: fmtKcal(rm.rmr),      unit:"kcal",      sub: latest.rmr?.date ? `🔬 Lab · ${latest.rmr.date}` : "—",                                       color:"#4ade80", icon:"⬡"},
          {label:"T-Score",     value: fmt(dxa.tScore),      unit:"",          sub: dxa.tScore != null ? `🔬 DEXA · ${latest.dexa.date} (DEXA only)` : "—",                       color:"#4ade80", icon:"○"},
          {label:"Visceral Fat",value: fmt(dxa.visceralFat), unit:"lbs",       sub: dxa.visceralFat != null ? `🔬 DEXA · ${latest.dexa.date} (DEXA only)` : "—",                  color:"#facc15", icon:"⚡"},
          {label:"ALMI",        value: fmt(dxa.almi),        unit:"kg/m²",     sub: dxa.almi != null ? `🔬 DEXA · ${latest.dexa.date} (DEXA only)` : "—",                         color:"#fb923c", icon:"◉"},
        ];
        return (<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {cards.map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.color}40`}}>
              <div style={{fontSize:14,color:c.color,opacity:0.8}}>{c.icon}</div>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"}}>{c.value}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:3}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>{c.label}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.color,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Empty-state hint when no tests imported yet */}
        {!latest.dexa && !latest.vo2max && !latest.rmr && (
          <div style={{background:C.surf,borderWidth:'0.5px',borderStyle:'solid',borderColor:'rgba(168,139,250,0.3)',borderRadius:"var(--radius-md)",padding:14,textAlign:'center'}}>
            <div style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t,fontWeight:500,marginBottom:6}}>No clinical scans imported yet</div>
            <div style={{fontSize:"clamp(11px,0.3vw + 9px,12px)",color:C.m,marginBottom:10,lineHeight:1.5}}>
              Click <strong style={{color:'#a78bfa'}}>↑ Upload scan</strong> at the top right to drop in a DexaFit DEXA, VO₂Max, or RMR PDF.
              Values auto-extract and save to your clinical history.
            </div>
          </div>
        )}

        <button style={S.aib} onClick={runAI} disabled={aiRun}><span>✦</span>{aiRun?"Analysing all data…":"Full Cross-Test AI Analysis"}</button>
        {aiText&&!aiRun&&<div style={S.air}><div style={S.aih}>✦ Integrated Clinical Analysis</div><div style={S.ait}>{aiText}</div></div>}
      </>);
      })()}

      {view==="dexa"&&dexa&&(()=>{
        const m = dexa.metrics || {};
        // Build the cards from real metrics; fallback note is just a hint, not a target,
        // since target values were specific to one historical scan.
        const cards = [
          {lbl:"Body Score",  key:'bodyScore',   unit:"",      note:m.bodyScore ? "Composite grade" : "—", clr:"#facc15"},
          {lbl:"Total Mass",  key:'totalMass',   unit:"lbs",   note:"Total body mass",                       clr:"#f87171"},
          {lbl:"Body Fat",    key:'bodyFatPct',  unit:"%",     note:"Total body fat %",                      clr:"#fbbf24"},
          {lbl:"Lean Mass",   key:'leanMass',    unit:"lbs",   note:"Skeletal + soft lean",                  clr:"#facc15"},
          {lbl:"Visceral Fat",key:'visceralFat', unit:"lbs",   note:"Trunk fat (metabolic risk)",            clr:"#f87171"},
          {lbl:"T-Score",     key:'tScore',      unit:"",      note:"Bone vs young adult ref",                clr:"#4ade80"},
          {lbl:"ALMI",        key:'almi',        unit:"kg/m²", note:"Appendicular lean mass index",          clr:"#facc15"},
          {lbl:"FFMI",        key:'ffmi',        unit:"kg/m²", note:"Fat-free mass index",                    clr:"#facc15"},
          {lbl:"A/G Ratio",   key:'agRatio',     unit:"",      note:"Android / gynoid fat",                   clr:"#f87171"},
          {lbl:"Z-Score",     key:'zScore',      unit:"",      note:"Bone vs age-matched ref",                clr:"#4ade80"},
        ].map(c => ({...c, val: m[c.key] != null ? m[c.key] : '—'}));
        return (<>
        {/* Historical scan picker — only shows if 2+ scans exist */}
        <ScanPicker scans={byType.dexa} selectedDate={dexaDate} onSelect={setDexaDate} accentColor="#a78bfa" />
        <div style={{...S.snap,borderColor:"rgba(168,139,250,0.3)"}}>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:"#a78bfa",letterSpacing:"0.1em",textTransform:"uppercase"}}>DEXA Body Composition · {dexa.date}</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m,marginTop:2}}>{dexa.source==='pdf' ? 'Lab scan' : (dexa.source||'')}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {cards.map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}30`}}>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t}}>{c.val}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>{c.lbl}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.clr,marginTop:1}}>{c.note}</div>
            </div>
          ))}
        </div>
        {/* Regional Body Fat % — built from m.fatTrunk / m.fatArms / m.fatLegs.
            Total cell uses the overall body fat %. Bar fills are normalized to a
            30% ceiling (scan values rarely exceed that). */}
        {(m.bodyFatPct != null || m.fatTrunk != null) && (
          <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
            <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Regional Body Fat %</div>
            {[
              {region:"Total", val:m.bodyFatPct},
              {region:"Trunk", val:m.fatTrunk},
              {region:"Arms",  val:m.fatArms},
              {region:"Legs",  val:m.fatLegs},
            ].filter(r => r.val != null).map((r,i,arr)=>{
              const fill = Math.min(1, Number(r.val)/30);
              const valStr = Number(r.val).toFixed(1) + '%';
              return (
                <div key={i} style={{marginBottom:i<arr.length-1?10:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t}}>{r.region}</span>
                    <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t,fontWeight:500}}>{valStr}</span>
                  </div>
                  <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
                    <div style={{height:4,width:`${fill*100}%`,background:fill>0.75?C.dn:C.wn,borderRadius:2}}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Bone Mineral Density by Region — built from m.bmdTotal / m.bmdSpine / etc. */}
        {(m.bmdTotal != null || m.bmdSpine != null) && (
          <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
            <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Bone Mineral Density by Region</div>
            {[
              {r:"Total Body", v:m.bmdTotal,  p:m.bmdTotalPercentile},
              {r:"Spine",      v:m.bmdSpine,  p:m.spinePercentile},
              {r:"Legs",       v:m.bmdLegs,   p:m.bmdLegsPercentile},
              {r:"Arms",       v:m.bmdArms,   p:m.bmdArmsPercentile},
            ].filter(row => row.v != null).map((row,i,arr)=>{
              const valStr = `${Number(row.v).toFixed(2)} g/cm²`;
              const pStr = row.p != null ? ` · ${row.p}th %ile` : '';
              const clr = row.p == null ? '#facc15' : row.p >= 70 ? '#4ade80' : row.p >= 50 ? '#facc15' : '#f87171';
              return (
                <div key={i} style={{display:"flex",justifyContent:"space-between",borderBottom:i<arr.length-1?`0.5px solid rgba(255,255,255,0.06)`:"none",paddingBottom:i<arr.length-1?6:0,marginBottom:i<arr.length-1?6:0}}>
                  <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t}}>{row.r}</span>
                  <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:clr}}>{valStr}{pStr}</span>
                </div>
              );
            })}
          </div>
        )}
      </>);
      })()}

      {view==="vo2"&&(vo2 || garminVO2)&&(()=>{
        const m = vo2?.metrics || {};
        // If Garmin watch estimate is newer than the lab VO2 (or there's no lab),
        // surface it as the headline. Lab still rendered below as the calibrated source.
        const labDate = vo2?.date || null;
        const garminNewer = garminVO2 && (!labDate || garminVO2.date > labDate);
        const headlineVO2 = garminNewer ? garminVO2.value : (m.vo2max ?? '—');
        const headlineSource = garminNewer
          ? `Watch estimate · ${garminVO2.date}`
          : (labDate ? `Lab VO₂ Max · ${labDate}` : 'No data');
        const cards = [
          {lbl:"VO₂ Max",      val: headlineVO2,         unit:"ml/kg/min", sub: headlineSource,                                              clr:"#60a5fa"},
          {lbl:"Bio Age",      val: m.bioAge,            unit:"years",     sub: m.bioAge != null ? "Lab estimate" : "—",                     clr:"#4ade80"},
          {lbl:"Redline Ratio",val: m.redlineRatio,      unit:"%",         sub: m.redlinePercentile != null ? `${m.redlinePercentile}th %ile` : "—", clr:"#facc15"},
          {lbl:"Lean VO₂ Max", val: m.leanVO2,           unit:"ml/lm·kg",  sub: m.leanVO2Percentile != null ? `${m.leanVO2Percentile}th %ile` : "—", clr:"#4ade80"},
          {lbl:"Leg Lean VO₂", val: m.legLeanVO2,        unit:"ml/lm·kg",  sub: m.legLeanVO2Percentile != null ? `${m.legLeanVO2Percentile}th %ile` : "—", clr:"#4ade80"},
          {lbl:"Max HR",       val: m.maxHR,             unit:"bpm",       sub: "From lab test",                                               clr:"#facc15"},
        ].map(c => ({...c, val: c.val == null || c.val === '' ? '—' : c.val}));
        return (<>
        <ScanPicker scans={byType.vo2max} selectedDate={vo2Date} onSelect={setVo2Date} accentColor="#60a5fa" />
        <div style={{...S.snap,borderColor:"rgba(96,165,250,0.3)"}}>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:"#60a5fa",letterSpacing:"0.1em",textTransform:"uppercase"}}>VO₂ Max Assessment · {vo2?.date || (garminVO2 ? garminVO2.date : '—')}</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m,marginTop:2}}>{garminNewer ? `Garmin watch (lab last: ${labDate || 'never'})` : (vo2?.source==='pdf' ? 'Lab' : (vo2?.source||''))}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          {cards.map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}35`}}>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"}}>{c.val}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.05em"}}>{c.lbl}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.clr,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>
        {/* Training Zones — built from m.zone1..zone4 ([loBpm, hiBpm] arrays).
            Hidden when no zone data (e.g., Garmin watch fallback path). */}
        {(m.zone1 || m.zone2 || m.zone3 || m.zone4) && (
          <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
            <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Your Training Zones</div>
            {[
              {z:"Zone 4 · Peak",     range: m.zone4, note:"VO₂Max development & HIIT",       clr:"#f87171"},
              {z:"Zone 3 · High",     range: m.zone3, note:"Tempo — raise Redline Ratio",     clr:"#fb923c"},
              {z:"Zone 2 · Moderate", range: m.zone2, note:"Fat oxidation & mitochondria",    clr:"#60a5fa"},
              {z:"Zone 1 · Recovery", range: m.zone1, note:"Active recovery & warmup",         clr:"#4ade80"},
            ].filter(z => Array.isArray(z.range) && z.range.length === 2).map((z,i,arr)=>(
              <div key={i} style={{borderLeft:`3px solid ${z.clr}`,paddingLeft:10,marginBottom:i<arr.length-1?10:0}}>
                <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t,fontWeight:500}}>{z.z}</span>
                <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:z.clr}}>{z.range[0]}–{z.range[1]} bpm</div>
                <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>{z.note}</div>
              </div>
            ))}
          </div>
        )}
        {/* Ventilatory Thresholds — from m.vt1 / m.vt2 (bpm). */}
        {(m.vt1 != null || m.vt2 != null) && (
          <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
            <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Ventilatory Thresholds</div>
            {[
              {k:"VT1", v:m.vt1, note:"Peak fat oxidation — Zone 2 ceiling",         clr:"#4ade80"},
              {k:"VT2", v:m.vt2, note:"Rapid lactate accumulation — Zone 3/4 boundary", clr:"#f87171"},
            ].filter(t => t.v != null).map((t,i,arr)=>(
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:i<arr.length-1?8:0}}>
                <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:t.clr,fontWeight:500,minWidth:36}}>{t.k}</div>
                <div>
                  <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.t}}>{t.v} bpm</div>
                  <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>{t.note}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>);
      })()}

      {view==="rmr"&&rmr&&(()=>{
        const m = rmr.metrics || {};
        // Helper: format kcal with thousand separators
        const kcal = (v) => v == null ? '—' : Number(v).toLocaleString('en-US');
        // Net delta vs predicted — labels the user's metabolism speed.
        // Threshold lowered to ±50 because that's where DexaFit's report
        // typically flips between FAST / AVERAGE / SLOW classifications
        // (matching the verbatim label on your scan).
        const delta = (m.rmr != null && m.predicted != null) ? Math.round(m.rmr - m.predicted) : null;
        const speedLabel = delta == null ? null
          : delta >= 50  ? `Fast (+${delta} vs predicted)`
          : delta <= -50 ? `Slow (${delta} vs predicted)`
          : `Average (${delta >= 0 ? '+' : ''}${delta} vs predicted)`;
        const peerLabel = (m.rmr != null && m.peerAvg != null)
          ? (m.rmr >= m.peerAvg ? 'Above peers' : 'Below peers')
          : 'Peer reference';
        const cards = [
          {lbl:"RMR",          val: kcal(m.rmr),        unit:"kcal/day", sub: speedLabel || 'Resting metabolic rate', clr:"#4ade80"},
          {lbl:"Predicted RMR",val: kcal(m.predicted),  unit:"kcal/day", sub:'Statistical avg for age/body',           clr:"#facc15"},
          {lbl:"RER",          val: m.rer != null ? Number(m.rer).toFixed(2) : '—', unit:"", sub: (m.fatPct != null && m.carbsPct != null) ? `Fat ${m.fatPct}% / Carbs ${m.carbsPct}%` : 'Respiratory exchange ratio', clr:"#60a5fa"},
          {lbl:"Peer Average", val: kcal(m.peerAvg),    unit:"kcal/day", sub: peerLabel,                                clr:"#fb923c"},
        ];
        // TDEE rows: prefer parser-extracted PDF values, fall back to RMR × standard
        // Mifflin-St Jeor activity multipliers when the PDF didn't yield them.
        // Multipliers are the canonical ones used by every nutrition tool:
        //   Sedentary 1.2 · Lightly 1.375 · Moderately 1.55 · Very 1.725 · Extremely 1.9
        // Tagged so the UI can show "(estimated from RMR)" when computed.
        const tdeeFromRmr = (factor) => m.rmr != null ? Math.round(Number(m.rmr) * factor) : null;
        // Sanity check: a stored TDEE value is "good" only if it's within a
        // plausible range of RMR × factor (±30%). This kicks out absurd values
        // like 1 kcal that earlier parser bugs may have stored — falls through
        // to the computed value instead.
        const isSane = (stored, expected) => {
          if (stored == null) return false;
          if (expected == null) return true; // no RMR to compare; trust the stored value
          const ratio = stored / expected;
          return ratio >= 0.7 && ratio <= 1.3;
        };
        const useStored = (stored, factor) => {
          const expected = tdeeFromRmr(factor);
          return isSane(stored, expected) ? stored : expected;
        };
        const tdeeRowDefs = [
          {level:"Sedentary",         factor:1.20,  stored:m.tdeeSedentary},
          {level:"Lightly Active",    factor:1.375, stored:m.tdeeLightlyActive},
          {level:"Moderately Active", factor:1.55,  stored:m.tdeeModerate},
          {level:"Very Active",       factor:1.725, stored:m.tdeeVeryActive},
          {level:"Extremely Active",  factor:1.90,  stored:m.tdeeExtreme},
        ].map(r => ({
          level: r.level,
          tdee:  useStored(r.stored, r.factor),
          computed: !isSane(r.stored, tdeeFromRmr(r.factor)),
        }));
        const anyComputed = tdeeRowDefs.some(r => r.tdee != null && r.computed);
        const tdeeRows = tdeeRowDefs.filter(r => r.tdee != null).map(r => {
          // Fat-loss range: ~500-1000 kcal deficit. Lean-gain range: ~250-500 kcal surplus.
          const fatLossLo = Math.round(r.tdee - 1000);
          const fatLossHi = Math.round(r.tdee - 500);
          const leanLo    = Math.round(r.tdee + 250);
          const leanHi    = Math.round(r.tdee + 500);
          return {
            level: r.level,
            tdeeStr:    `${r.tdee.toLocaleString('en-US')} kcal`,
            fatLossStr: `${fatLossLo.toLocaleString('en-US')}–${fatLossHi.toLocaleString('en-US')}`,
            leanStr:    `${leanLo.toLocaleString('en-US')}–${leanHi.toLocaleString('en-US')}`,
          };
        });
        return (<>
        <ScanPicker scans={byType.rmr} selectedDate={rmrDate} onSelect={setRmrDate} accentColor="#4ade80" />
        <div style={{...S.snap,borderColor:"rgba(74,222,128,0.3)"}}>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.ta,letterSpacing:"0.1em",textTransform:"uppercase"}}>Resting Metabolic Rate · {rmr.date}</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m,marginTop:2}}>{rmr.source==='pdf' ? 'Lab' : (rmr.source||'')}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {cards.map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}35`}}>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"}}>{c.val}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.06em"}}>{c.lbl}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.clr,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>
        {/* Resting Fuel Composition — built from m.fatPct / m.carbsPct */}
        {(m.fatPct != null && m.carbsPct != null) && (
          <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
            <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.ta,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>
              Resting Fuel Composition{m.rer != null ? ` (RER ${Number(m.rer).toFixed(2)})` : ''}
            </div>
            <div style={{height:20,borderRadius:4,overflow:"hidden",display:"flex",marginBottom:6}}>
              <div style={{width:`${m.fatPct}%`,background:"#60a5fa",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#fff",fontWeight:500}}>Fat {m.fatPct}%</span></div>
              <div style={{width:`${m.carbsPct}%`,background:"#fb923c",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#fff",fontWeight:500}}>Carbs {m.carbsPct}%</span></div>
            </div>
            <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>
              RER 0.70 = pure fat oxidation; 1.0 = pure carb. {m.rer != null && m.rer < 0.80 ? 'Fat-dominant fuel use at rest.' : m.rer != null && m.rer > 0.90 ? 'Carb-dominant fuel use at rest.' : 'Balanced substrate use at rest.'}
            </div>
          </div>
        )}
        {/* TDEE table — built from the five tdee* fields */}
        {tdeeRows.length > 0 && (
          <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.ta,letterSpacing:"0.12em",textTransform:"uppercase"}}>Total Daily Energy Expenditure</div>
              {anyComputed && (
                <div style={{fontSize:9,color:C.m,fontStyle:'italic'}}>estimated · RMR × activity factor</div>
              )}
            </div>
            {tdeeRows.map((row,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1.2fr 0.8fr 1fr 1fr",borderBottom:i<tdeeRows.length-1?`0.5px solid rgba(255,255,255,0.06)`:"none",paddingBottom:5,marginBottom:5,gap:4}}>
                <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.t}}>{row.level}</div>
                <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.ta,fontWeight:500}}>{row.tdeeStr}</div>
                <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa"}}>{row.fatLossStr}</div>
                <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa"}}>{row.leanStr}</div>
              </div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1.2fr 0.8fr 1fr 1fr",marginTop:4}}>
              <div/><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m}}>TDEE</div><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa"}}>Fat Loss</div><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa"}}>Lean Gain</div>
            </div>
          </div>
        )}
      </>);
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LABS MODULE — Blood Panel
// ═══════════════════════════════════════════════════════════════════════════════
function LabsModule({data,persist,showToast}){
  const [view,setView]=useState("overview");
  const [selCat,setSelCat]=useState("Metabolic");
  const [upText,setUpText]=useState("");
  const [uploading,setUploading]=useState(false);
  const [aiTxt,setAiTxt]=useState("");
  const [aiRun,setAiRun]=useState(false);
  // Viewport tracking (Phase 4o.labs.6) — flips the marker grid from a
  // 3-up desktop layout to a 2-up mobile layout so marker names like
  // "Triglycerides" or "Magnesium" fit without truncating.
  const [isMobile,setIsMobile]=useState(()=>typeof window!=='undefined'&&window.innerWidth<=600);
  useEffect(()=>{
    if (typeof window==='undefined') return;
    const mq=window.matchMedia('(max-width: 600px)');
    const h=e=>setIsMobile(e.matches);
    mq.addEventListener('change',h);
    return ()=>mq.removeEventListener('change',h);
  },[]);
  const fileRef=useRef();
  // Swipe between blood categories (contained — doesn't bubble to outer tab swipe)
  const catSwipeRef=useRef({x:0,y:0});
  const onCatTouchStart=e=>{catSwipeRef.current={x:e.touches[0].clientX,y:e.touches[0].clientY};};
  const onCatTouchEnd=e=>{
    const dx=e.changedTouches[0].clientX-catSwipeRef.current.x;
    const dy=e.changedTouches[0].clientY-catSwipeRef.current.y;
    if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.4){
      e.stopPropagation();
      // Honour the dynamic `cats` list (BCATS + Other when present) so
      // swiping reaches the Other tab too.
      const list = (typeof cats !== 'undefined' && cats?.length) ? cats : BCATS;
      const idx=list.indexOf(selCat);
      if(dx<0&&idx<list.length-1)setSelCat(list[idx+1]);
      if(dx>0&&idx>0)setSelCat(list[idx-1]);
    }
  };

  const snaps=[...(data.labSnapshots||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const latest=snaps[0]; const prev=snaps[1];

  const sCounts={optimal:0,warn:0,flag:0};
  if(latest)Object.entries(latest.markers).forEach(([n,v])=>{const s=bStatus(n,v);if(sCounts[s]!==undefined)sCounts[s]++;});

  // ── Unmapped markers (Phase 4o.labs.2) ──────────────────────────────
  // Imported keys that don't match the BM registry. They live in storage
  // and feed AI analysis but had no UI surface until now. Sorted A→Z so
  // the Other tab is browsable. The header chip lets the user click
  // straight to it so the count discrepancy is no longer mysterious.
  const unmappedKeys = latest
    ? Object.keys(latest.markers).filter(k => !BM[k]).sort((a,b)=>a.localeCompare(b))
    : [];
  const totalCount  = latest ? Object.keys(latest.markers).length : 0;
  const mappedCount = totalCount - unmappedKeys.length;
  // Tabs: include Other only when there's something to put in it.
  const cats = unmappedKeys.length > 0 ? [...BCATS, 'Other'] : BCATS;

  const doImport=async()=>{
    if(!upText.trim()){showToast("⚠ No data");return;}
    setUploading(true);
    const ns=parseLabCSV(upText);
    if(!ns.length){showToast("⚠ Parse failed");setUploading(false);return;}
    const map={};(data.labSnapshots||[]).forEach(s=>{map[s.date]={...s};});
    let a=0,u=0;
    ns.forEach(s=>{if(!map[s.date]){map[s.date]=s;a++;}else{map[s.date]={...map[s.date],markers:{...map[s.date].markers,...s.markers}};u++;}});
    const merged=Object.values(map).sort((a,b)=>b.date.localeCompare(a.date));
    await persist({...data,labSnapshots:merged});
    showToast(`✓ Data imported successfully — ${a} new, ${u} updated`);setUpText("");setView("overview");setUploading(false);
  };

  const runAI=async()=>{
    setAiRun(true);setAiTxt("");
    const txt=await ai(buildFullPrompt(data),
      `Analyse my latest blood panel (${latest?.date}) vs previous (${prev?.date||"N/A"}).
Latest: ${JSON.stringify(latest?.markers||{})}
Previous: ${JSON.stringify(prev?.markers||{})}
Daily logs last 6 weeks: ${JSON.stringify((data.logs||[]).slice(0,42))}
Give: 1) Top 3 positives 2) Top 3 areas to address 3) Correlations with daily tracking 4) Specific action items.`,1500);
    setAiTxt(txt);setAiRun(false);
  };

  // Build sparkline data with dates for tooltips
  const sparkData=(name,n=7)=>snaps.slice(0,n).reverse().map(s=>({val:parseFloat(s.markers[name]),date:s.date,raw:s.markers[name]})).filter(p=>!isNaN(p.val));

  // Phase 4q.frame.3 — hide "Blood Panel" subhead on mobile so the
  // Labs page header is the only top label and the Overview/Upload tabs
  // sit closer to the page top (matches how Core/Play/Fuel render).
  const _isMobile = typeof window !== 'undefined' && window.innerWidth <= 600;
  return(
    <div style={S.sec}>
      {!_isMobile && <div style={S.st}>⬡ Blood Panel</div>}
      <div style={S.labNav}>
        {[["overview","Overview"],["upload","Upload"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setView(id)} style={{...S.lnb,...(view===id?S.lnba:{})}}>{lbl}</button>
        ))}
      </div>

      {view==="overview"&&<>
        {!latest&&<div style={S.empty}>No lab data. Upload a blood panel CSV.</div>}
        {latest&&<>
          <div style={S.snap}>
            <div>
              <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,color:C.acc}}>{latest.date}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,marginTop:1,display:'flex',alignItems:'baseline',gap:6,flexWrap:'wrap'}}>
                <span>{mappedCount} of {totalCount} markers</span>
                {unmappedKeys.length > 0 && (
                  <button
                    onClick={()=>setSelCat('Other')}
                    title={`Click to view: ${unmappedKeys.join(', ')}`}
                    style={{
                      background:'rgba(148,163,184,0.12)',
                      border:'0.5px solid rgba(148,163,184,0.3)',
                      borderRadius:10,
                      padding:'1px 8px',
                      color:'#94a3b8',
                      fontSize:'inherit',
                      fontFamily:'inherit',
                      cursor:'pointer',
                      letterSpacing:'0.04em',
                    }}>
                    {unmappedKeys.length} unmapped →
                  </button>
                )}
              </div>
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {/* Phase 4o.labs.5 — display labels separated from status
                  keys so "warn" shows as "normal" (in-range, not-optimal)
                  and "flag" as "review" (out-of-range), matching the
                  per-tile badges. */}
              {[
                {key:'optimal', label:'optimal', clr:'#4ade80'},
                {key:'warn',    label:'normal',  clr:'#facc15'},
                {key:'flag',    label:'review',  clr:'#f87171'},
              ].map(({key,label,clr})=>(
                <div key={key} style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",padding:"2px 7px",borderRadius:10,background:`${clr}18`,border:`0.5px solid ${clr}40`,color:clr}}>{sCounts[key]} {label}</div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:0,overflowX:"auto",borderBottom:`0.5px solid ${C.b}`}}>
            {cats.map(cat=>(
              <button key={cat} onClick={()=>setSelCat(cat)} style={{background:"none",border:"none",borderBottom:`2px solid ${selCat===cat?BCAT_CLR[cat]:"transparent"}`,color:selCat===cat?BCAT_CLR[cat]:C.m,padding:"6px 9px",cursor:"pointer",fontFamily:"inherit",fontSize:"clamp(10px,0.3vw + 9px,11px)",letterSpacing:"0.06em",whiteSpace:"nowrap",display:"flex",gap:3,alignItems:"center"}}>
                {BCAT_ICO[cat]} {cat}{cat==='Other' && unmappedKeys.length>0 ? ` (${unmappedKeys.length})` : ''}
              </button>
            ))}
          </div>
          <div onTouchStart={onCatTouchStart} onTouchEnd={onCatTouchEnd} style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2, minmax(0, 1fr))":"repeat(3, minmax(0, 1fr))",gap:7,touchAction:"pan-y"}}>
            {selCat === 'Other' ? (
              /* ── Other tab — markers imported from CSV but not in the BM
                 registry. No status colour (no thresholds defined), no
                 reference range — just the raw value, optional sparkline,
                 and a "no threshold" badge. The label is derived from the
                 raw key by stripping the trailing "(unit)" suffix. */
              unmappedKeys.map(name => {
                const val = latest.markers[name];
                const pv  = prev?.markers[name];
                const has = val != null && !isNaN(val);
                const delta = val != null && pv != null ? parseFloat(val) - parseFloat(pv) : null;
                const unitMatch = name.match(/\(([^)]+)\)\s*$/);
                const unit = unitMatch ? unitMatch[1] : '';
                const lbl  = unitMatch ? name.replace(/\s*\([^)]+\)\s*$/, '').trim() : name;
                const sd = sparkData(name);
                const tooltip = sd.map(p => `${p.date}: ${p.raw}${unit ? ' ' + unit : ''}`).join('\n');
                return (
                  <div key={name}
                    title={`${name} — not in BM registry. Add a definition to BM (Arnold.jsx:281) to enable thresholds, range, and category placement.`}
                    style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"12px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontSize:10,fontWeight:600,color:'var(--text-secondary, var(--text-primary))',letterSpacing:"0.06em",textTransform:"uppercase",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,marginRight:6}}>{lbl}</div>
                      <div style={{fontSize:10,fontWeight:500,padding:"1px 6px",borderRadius:4,background:'rgba(148,163,184,0.12)',color:'#94a3b8',border:'0.5px solid rgba(148,163,184,0.3)',letterSpacing:"0.05em",flexShrink:0,whiteSpace:"nowrap"}}>UNMAPPED</div>
                    </div>
                    <div style={{fontSize:"clamp(18px,1.5vw + 12px,24px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em",lineHeight:1.2}}>{has?val:"—"}<span style={{fontSize:11,color:C.m,fontWeight:400,marginLeft:3}}>{has?unit:""}</span></div>
                    <div style={{fontSize:11,color:C.m,marginTop:3,display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontStyle:'italic',opacity:0.75}}>no threshold defined</span>
                      {delta!==null&&<span>{delta>0?"▲":"▼"}{Math.abs(delta).toFixed(2)} from prev</span>}
                    </div>
                    <LabSparkline data={sd} color={'#94a3b8'} tooltip={tooltip}/>
                  </div>
                );
              })
            ) : (
              Object.entries(BM).filter(([,m])=>m.cat===selCat).map(([name,meta])=>{
                const val=latest.markers[name];
                const pv=prev?.markers[name];
                const stat=bStatus(name,val);
                const delta=val!=null&&pv!=null?parseFloat(val)-parseFloat(pv):null;
                const has=val!=null&&!isNaN(val);
                const sd=sparkData(name);
                const tooltip=sd.map(p=>`${p.date}: ${p.raw} ${meta.unit}`).join('\n');
                return(
                  <div key={name} style={{background:C.surf,border:`0.5px solid ${has?SC[stat]+"40":C.b}`,borderRadius:"var(--radius-md)",padding:"12px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontSize:10,fontWeight:600,color:'var(--text-secondary, var(--text-primary))',letterSpacing:"0.06em",textTransform:"uppercase",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,marginRight:6}}>{meta.lbl}</div>
                      <div style={{fontSize:10,fontWeight:500,padding:"1px 6px",borderRadius:4,background:SC_BG[stat],color:SC[stat],border:`0.5px solid ${SC_BORDER[stat]}`,letterSpacing:"0.05em",flexShrink:0,whiteSpace:"nowrap"}}>{SL[stat]}</div>
                    </div>
                    <div style={{fontSize:"clamp(18px,1.5vw + 12px,24px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em",lineHeight:1.2}}>{has?val:"—"}<span style={{fontSize:11,color:C.m,fontWeight:400,marginLeft:3}}>{has?meta.unit:""}</span></div>
                    <div style={{fontSize:11,color:C.m,marginTop:3,display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap"}}>
                      <span>{meta.opt[0]}–{meta.opt[1]} {meta.unit}</span>
                      {delta!==null&&<span style={{color:dc(name,delta)}}>{delta>0?"▲":"▼"}{Math.abs(delta).toFixed(1)} from prev</span>}
                    </div>
                    {/* Inline description (Phase 4o.labs.4) — explains
                        what the marker measures and what shifts mean.
                        Italic + slightly muted so it reads as caption,
                        not headline. Hidden when a description hasn't
                        been written yet so legacy entries don't render
                        an empty caption row. */}
                    {meta.desc && (
                      <div style={{fontSize:9.5,color:C.m,fontStyle:'italic',lineHeight:1.35,marginTop:4,opacity:0.85}}>
                        {meta.desc}
                      </div>
                    )}
                    <LabSparkline data={sd} color={SC[stat]} tooltip={tooltip}/>
                  </div>
                );
              })
            )}
          </div>
          {/* Swipe hint */}
          <div style={{display:"flex",justifyContent:"center",gap:4,padding:"6px 0"}}>
            {cats.map((cat,i)=><div key={cat} style={{width:selCat===cat?16:5,height:5,borderRadius:3,background:selCat===cat?BCAT_CLR[cat]:'rgba(255,255,255,0.12)',transition:'all 0.2s'}}/>)}
          </div>
          <button style={S.aib} onClick={runAI} disabled={aiRun}><span>✦</span>{aiRun?"Analysing…":"AI Blood Panel Analysis"}</button>
          {aiTxt&&!aiRun&&<div style={S.air}><div style={S.aih}>✦ Blood Panel Analysis · {latest.date}</div><div style={S.ait}>{aiTxt}</div></div>}
        </>}
      </>}

      {view==="upload"&&<>
        <div style={{...S.ic,borderColor:"rgba(74,222,128,0.3)"}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.acc,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Expected format</div>
          <div style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.m,lineHeight:1.6}}>Rows = markers, Columns = dates (e.g. "Dec 06 2025"). Same format as your existing bloodwork CSV. New dates added; existing dates merged.</div>
        </div>
        <div style={S.uz} onClick={()=>fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setUpText(ev.target.result);r.readAsText(f);e.target.value="";}}/>
          <div style={{fontSize:26,color:C.acc}}>⇡</div><div style={{fontSize:12,color:C.t}}>Upload CSV</div>
        </div>
        <textarea value={upText} onChange={e=>setUpText(e.target.value)} placeholder="Or paste CSV…" style={{...S.ta,minHeight:80,fontFamily:"monospace",fontSize:10}}/>
        {upText&&<button style={S.sb} onClick={doImport} disabled={uploading}>{uploading?"Importing…":"Import"}</button>}
      </>}
    </div>
  );
}

// ─── Lab Sparkline — full-width, 28px tall, with tooltip ─────────────────────
function LabSparkline({data,color,tooltip}){
  if(!data||!data.length)return<div style={{height:28,marginTop:4}}/>;
  const W=200,H=28,P=3;
  const vals=data.map(d=>d.val);
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
  const xS=i=>data.length===1?W/2:P+(i/(data.length-1))*(W-P*2);
  const yS=v=>H-P-((v-min)/range)*(H-P*2);
  const path=data.map((d,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(d.val).toFixed(1)}`).join(" ");
  const lastX=xS(data.length-1),lastY=yS(data[data.length-1].val);
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{marginTop:4,display:"block",height:28}}>
      <title>{tooltip}</title>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" opacity="0.7"/>
      <circle cx={lastX} cy={lastY} r="2.5" fill={color||"var(--accent)"} stroke="var(--bg-base)" strokeWidth="1"/>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRINCIPLES PANEL
// ═══════════════════════════════════════════════════════════════════════════════
const STATUS_CLR={optimal:"var(--status-ok)",  "on-track":"var(--accent)", "needs-work":"var(--status-warn)", critical:"var(--status-danger)", unknown:"var(--text-muted)"};
const STATUS_BG ={optimal:"var(--status-ok-bg)","on-track":"var(--accent-dim)","needs-work":"var(--status-warn-bg)",critical:"var(--status-danger-bg)",unknown:"transparent"};
const STATUS_LBL={optimal:"Optimal","on-track":"On Track","needs-work":"Needs Work",critical:"Critical",unknown:"No Data"};

function PrinciplesPanel({data}){
  // Enrich data with Garmin imports for HRV/Sleep/Nutrition scoring
  const enriched=useMemo(()=>{
    const d={...data,logs:[...(data.logs||[])]};
    const hrvData=storage.get('hrv');
    const sleepData=storage.get('sleep');
    const cronoData=storage.get('cronometer');
    // Inject latest HRV into first log entry if missing
    if(hrvData?.length){
      const latest=hrvData.find(h=>h.overnightHRV);
      if(latest&&(!d.logs[0]?.hrv||d.logs[0].hrv==="")){
        if(!d.logs.length)d.logs=[{date:latest.date}];
        d.logs[0]={...d.logs[0],hrv:String(latest.overnightHRV)};
      }
    }
    // Inject 7-day avg sleep into logs
    if(sleepData?.length){
      const recent=sleepData.slice(0,7).filter(s=>s.durationMinutes);
      if(recent.length){
        const avgH=(recent.reduce((s,e)=>s+e.durationMinutes,0)/recent.length/60).toFixed(1);
        if(!d.logs.length)d.logs=[{date:recent[0].date}];
        if(!d.logs[0].sleep||d.logs[0].sleep==="")d.logs[0]={...d.logs[0],sleep:avgH};
      }
    }
    // Inject 7-day avg calories from Cronometer
    if(cronoData?.length){
      const recent=cronoData.slice(0,7).filter(c=>c.calories);
      if(recent.length){
        const avgCal=Math.round(recent.reduce((s,e)=>s+(typeof e.calories==='number'?e.calories:parseFloat(e.calories)||0),0)/recent.length);
        if(!d.logs.length)d.logs=[{date:recent[0].date}];
        if(!d.logs[0].calories||d.logs[0].calories==="")d.logs[0]={...d.logs[0],calories:String(avgCal)};
      }
    }
    return d;
  },[data]);
  const result=scoreAll(enriched);
  const{overall,breakdown}=result;
  const insights=getInsights(result);

  const scoreColor=s=>s==null?"var(--text-muted)":s>=80?"var(--status-ok)":s>=60?"var(--accent)":s>=40?"var(--status-warn)":"var(--status-danger)";

  return(
    <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase"}}>◈ Principles Score</div>
        <div style={{display:"flex",alignItems:"baseline",gap:4}}>
          <span style={{fontSize:"clamp(28px,2vw + 18px,42px)",fontWeight:600,color:scoreColor(overall),letterSpacing:"-0.03em",lineHeight:1}}>{overall??"-"}</span>
          <span style={{fontSize:"clamp(10px,0.3vw + 9px,12px)",color:C.m}}>/100</span>
        </div>
      </div>

      {Object.entries(breakdown).map(([key,b])=>{
        const pct=b.score!=null?Math.max(0,Math.min(100,b.score)):0;
        const clr=STATUS_CLR[b.status]||C.m;
        return(
          <div key={key} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
              <span style={{fontSize:"clamp(12px,0.4vw + 10px,13px)",color:C.t}}>{b.label}</span>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {b.current!=null&&<span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m}}>{Number(b.current).toFixed(1)} {b.unit}</span>}
                <span style={{fontSize:10,padding:"1px 6px",borderRadius:3,background:STATUS_BG[b.status],color:clr,border:`0.5px solid ${clr}40`,letterSpacing:"0.04em"}}>{STATUS_LBL[b.status]}</span>
              </div>
            </div>
            <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
              <div style={{height:3,width:`${pct}%`,background:clr,borderRadius:2,transition:"width 0.4s ease"}}/>
            </div>
          </div>
        );
      })}

      {insights.length>1&&(
        <div style={{marginTop:12,paddingTop:10,borderTop:`0.5px solid ${C.bs}`}}>
          {insights.slice(1,3).map((ins,i)=>(
            <div key={i} style={{fontSize:"clamp(11px,0.4vw + 9px,12px)",color:C.s,marginBottom:4,lineHeight:1.5}}>{ins}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOME COCKPIT — Hero view: goal rings, race readiness, daily compound snapshot
// ═══════════════════════════════════════════════════════════════════════════════
function HomeCockpit({data,setTab}){
  const profile={...(storage.get('profile')||{}),...getGoals()};
  const activities=getUnifiedActivities();
  const cronometer=storage.get('cronometer')||[];
  const weightData=storage.get('weight')||[];
  const hrvData=storage.get('hrv')||[];
  const sleepData=cleanSleepForAveraging(storage.get('sleep')||[]);
  const dailyLogs=storage.get('dailyLogs')||[];

  // ── Date helpers ──
  const today=new Date();
  const yearStart=new Date(today.getFullYear(),0,1);
  const daysInYear=Math.floor((today-yearStart)/86400000)||1;
  const weeksElapsed=Math.max(daysInYear/7,1);
  const todayStr=td();

  // ── YTD activity ──
  const ytdActs=activities.filter(a=>{const d=parseLocalDate(a.date);return d&&d>=yearStart;});
  const ytdRuns=ytdActs.filter(a=>a.activityType?.toLowerCase().includes('run'));
  const ytdStrength=ytdActs.filter(a=>{const t=a.activityType?.toLowerCase()||'';return t.includes('strength')||t.includes('training');});
  const totalMi=ytdRuns.reduce((s,a)=>s+(a.distanceMi||0),0);
  const totalSessions=ytdActs.length;
  const avgWeeklyMi=totalMi/weeksElapsed;

  // ── Targets ──
  const annualRunTarget=parseFloat(profile?.annualRunDistanceTarget)||800;
  const annualWorkoutTarget=parseFloat(profile?.annualWorkoutsTarget)||200;
  const weeklyRunTarget=parseFloat(profile?.weeklyRunDistanceTarget)||20;
  const targetWeight=parseFloat(profile?.targetWeight)||175;
  const targetBF=parseFloat(profile?.targetBodyFat)||16.7;
  const goalPaceSecs=(()=>{const p=profile?.targetRacePace||'9:30';const[m,s]=p.split(':').map(Number);return m*60+(s||0);})();
  const fmtPace=s=>s?`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`:'—';

  // ── Pace ──
  const runPaces=ytdRuns.map(a=>{if(!a.avgPaceRaw)return null;const[m,s]=a.avgPaceRaw.split(':').map(Number);return m*60+(s||0);}).filter(Boolean);
  const avgPaceSecs=runPaces.length?runPaces.reduce((s,v)=>s+v,0)/runPaces.length:null;

  // ── Weight/Body ──
  const sortedW=[...weightData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const currentWeight=sortedW[0]?.weightLbs;
  const currentBF=sortedW[0]?.bodyFatPct;

  // ── Recovery (7-day) ──
  // HRV merge: Worker writes overnightHRV onto sleep rows (Phase 4c), while
  // older flow stored it in the dedicated `hrv` collection. The Weekly card
  // previously read only `hrv` and missed the worker-sourced values entirely.
  // Build a unified by-date set with worker rows winning per date.
  const d7=new Date();d7.setDate(today.getDate()-7);
  const recentSleep=sleepData.filter(s=>s.date&&parseLocalDate(s.date)>=d7);
  const mergedHrvLast7 = (() => {
    const byDate = new Map();
    for (const h of (hrvData || [])) {
      if (h?.date && parseLocalDate(h.date) >= d7 && h.overnightHRV != null && !isNaN(Number(h.overnightHRV))) {
        byDate.set(h.date, Number(h.overnightHRV));
      }
    }
    for (const s of (sleepData || [])) {
      if (s?.date && parseLocalDate(s.date) >= d7 && s.overnightHRV != null && !isNaN(Number(s.overnightHRV))) {
        byDate.set(s.date, Number(s.overnightHRV)); // worker wins over legacy
      }
    }
    return [...byDate.values()];
  })();
  const avgHRV7 = mergedHrvLast7.length
    ? Math.round(mergedHrvLast7.reduce((s, v) => s + v, 0) / mergedHrvLast7.length)
    : null;
  const recentSleepDur=recentSleep.filter(s=>s.durationMinutes);
  const avgSleepMins7=recentSleepDur.length?Math.round(recentSleepDur.reduce((s,sl)=>s+sl.durationMinutes,0)/recentSleepDur.length):null;
  // latestSleepScore — only if the most-recent row is from today/yesterday
  // AND has a non-null score. Don't fall back to a 2+ night old score —
  // that misleads "last night" when last night's row exists but the score
  // is still pending (Garmin Worker hasn't pulled it yet).
  const sortedSleepAll=[...sleepData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const latestSleepScore=(()=>{
    const top=sortedSleepAll[0];
    if(!top) return null;
    const today=td();
    const yest=(()=>{const d=new Date();d.setDate(d.getDate()-1);return td(d);})();
    if(top.date!==today && top.date!==yest) return null;
    if(top.sleepScore==null) return null;
    return Math.min(top.sleepScore,100);
  })();
  const latestRHR=sortedSleepAll[0]?.restingHR||null;

  // ── 30-day nutrition (merged: cronometer CSV + manual nutritionLog) ──
  const recentNut=(()=>{
    const days=[];
    for(let i=0;i<30;i++){
      const d=new Date();d.setDate(today.getDate()-i);
      const ds=td(d);
      const t=nutDailyTotals(ds);
      if(t.calories>0||t.protein>0) days.push({date:ds,...t});
    }
    return days;
  })();
  const avgCalories=recentNut.length?Math.round(recentNut.reduce((s,n)=>s+(n.calories||0),0)/recentNut.length):null;
  const avgProtein=recentNut.length?Math.round(recentNut.reduce((s,n)=>s+(n.protein||0),0)/recentNut.length):null;

  // ── Race countdown ──
  const nextRace=(()=>{try{const races=JSON.parse(localStorage.getItem('arnold:races')||'[]');const now2=new Date();now2.setHours(0,0,0,0);return races.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=now2;}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date))[0]||null;}catch{return null;}})();
  const raceDaysLeft=nextRace?Math.ceil((parseLocalDate(nextRace.date)-new Date(new Date().setHours(0,0,0,0)))/86400000):null;

  // ── Race readiness (uses trainingIntelligence) ──
  const raceReady=nextRace?raceReadiness(activities,nextRace.distanceKm||(nextRace.distanceMi?nextRace.distanceMi*1.609:21.1),nextRace.date):null;

  // ── Today's plan ──
  const planned=todayPlanned();
  const{completed:planCompleted}=checkTodayCompletion(todayStr,planned);
  const plannedLabel=planned?({easy_run:'Easy Run',long_run:'Long Run',tempo:'Tempo',intervals:'Intervals',strength:'Strength',hiit:'HIIT',mobility:'Mobility',cross:'Cross-train',rest:'Rest Day',race:'Race Day'}[planned.type]||(planned.type.charAt(0).toUpperCase()+planned.type.slice(1))):null;

  // ── Compound readiness score (multi-factor) ──
  const volPct=avgWeeklyMi/weeklyRunTarget;
  const pacePct=avgPaceSecs&&goalPaceSecs?Math.min(goalPaceSecs/avgPaceSecs,1):0;
  const sleepPct=latestSleepScore?latestSleepScore/100:0;
  const protPct=avgProtein?(avgProtein/(parseFloat(profile?.dailyProteinTarget)||150)):0;
  const weightPct=currentWeight&&targetWeight?Math.max(0,1-Math.abs(currentWeight-targetWeight)/30):0;
  const compoundScore=Math.round(((Math.min(volPct,1)*25)+(pacePct*25)+(sleepPct*25)+((protPct>0.85?1:protPct)*15)+(weightPct*10)));

  // ── Weekly stats for sparklines ──
  // Monday-start weeks (Sunday belongs to the previous week's Monday). Without
  // the Sunday=>6 offset, Sunday's bucket would land on tomorrow's Monday and
  // include up to a week of FUTURE-looking data — i.e. "next week" appears in
  // the rightmost column. Activity dates anchor at local noon to dodge UTC.
  const weeklyMiles=Array.from({length:8},(_,i)=>{
    const dow=today.getDay();const offset=dow===0?6:dow-1;
    const wStart=new Date(today);wStart.setDate(today.getDate()-(7*(7-i)+offset));wStart.setHours(0,0,0,0);
    const wEnd=new Date(wStart);wEnd.setDate(wStart.getDate()+7);
    return activities.filter(a=>{const d=parseLocalDate(a.date);return d&&d>=wStart&&d<wEnd&&a.activityType?.toLowerCase().includes('run');}).reduce((s,a)=>s+(a.distanceMi||0),0);
  });

  // ── Style helpers ──
  const panelStyle={background:'var(--bg-surface)',border:'0.5px solid var(--border-default)',borderRadius:'var(--radius-md)',padding:'14px 16px'};
  const divider={height:'0.5px',background:'var(--border-subtle)',margin:'10px 0'};
  const subHdr={fontSize:9,fontWeight:500,letterSpacing:'0.07em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:8};

  // ── Goal Ring — larger, more prominent than ArcDialSVG ──
  const GoalRing=({value,max,color,label,sublabel,unit,size=100})=>{
    const r=size/2-10;
    const circ=2*Math.PI*r;
    const arcLen=circ*0.78;
    const pct=Math.min(Math.max((value||0)/(max||1),0),1);
    const filled=pct*arcLen;
    const emoji=pct>=1?'✓':pct>=0.75?'↗':pct>=0.5?'→':'↘';
    return(
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-input)" strokeWidth="7" opacity="0.5"/>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={`${filled} ${circ}`}
            strokeDashoffset={-arcLen*0.14}
            strokeLinecap="round"
            transform={`rotate(135 ${size/2} ${size/2})`}
            style={{filter:`drop-shadow(0 0 4px ${color}40)`}}/>
          <text x={size/2} y={size/2-10} textAnchor="middle" fontSize="8" fill="var(--text-muted)" style={{fontFamily:'var(--font-ui)'}}>{label}</text>
          <text x={size/2} y={size/2+6} textAnchor="middle" fontSize="18" fontWeight="600" fill="var(--text-primary)" style={{fontFamily:'var(--font-ui)'}}>{sublabel}</text>
          <text x={size/2} y={size/2+20} textAnchor="middle" fontSize="9" fill={color} style={{fontFamily:'var(--font-ui)'}}>{Math.round(pct*100)}% {emoji}</text>
        </svg>
        <div style={{fontSize:9,color:'var(--text-muted)',textAlign:'center'}}>{unit}</div>
      </div>
    );
  };

  return(
    <div style={S.sec}>
      {/* ── Hero banner ── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <div>
          <div style={{fontSize:16,fontWeight:600,color:'var(--text-primary)',letterSpacing:'0.01em'}}>⬡ Cockpit</div>
          <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>Your body at a glance · {today.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',year:'numeric'})}</div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          {nextRace&&<span style={{fontSize:10,padding:'4px 10px',borderRadius:10,background:'rgba(96,165,250,0.12)',color:'#60a5fa',fontWeight:500}}>{nextRace.name||'Race'} · {raceDaysLeft===0?'Today!':raceDaysLeft<0?'Past':`${raceDaysLeft}d`}</span>}
          <span style={{fontSize:10,padding:'4px 10px',borderRadius:10,background:compoundScore>=75?'rgba(74,222,128,0.12)':compoundScore>=50?'rgba(251,191,36,0.12)':'rgba(239,68,68,0.12)',color:compoundScore>=75?'#4ade80':compoundScore>=50?'#fbbf24':'#ef4444',fontWeight:600}}>{compoundScore}/100</span>
        </div>
      </div>

      {/* ── Goal Progress Rings ── */}
      <div style={{...panelStyle,marginBottom:10}}>
        <div style={subHdr}>Annual Goals · Year to Date</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:6,alignItems:'start'}}>
          <GoalRing value={totalMi} max={annualRunTarget} color="#60a5fa" label="Miles" sublabel={Math.round(totalMi)} unit={`/ ${annualRunTarget} mi goal`} size={100}/>
          <GoalRing value={totalSessions} max={annualWorkoutTarget} color="#a78bfa" label="Workouts" sublabel={totalSessions} unit={`/ ${annualWorkoutTarget} goal`} size={100}/>
          <GoalRing value={avgPaceSecs?Math.max(0,goalPaceSecs/avgPaceSecs):0} max={1} color="#4ade80" label="Pace" sublabel={fmtPace(avgPaceSecs)} unit={`goal ${fmtPace(goalPaceSecs)} /mi`} size={100}/>
          <GoalRing value={currentWeight?Math.max(0,1-Math.abs(currentWeight-targetWeight)/30):0} max={1} color="#fbbf24" label="Weight" sublabel={currentWeight?`${currentWeight.toFixed(0)}`:' —'} unit={`target ${targetWeight} lbs`} size={100}/>
          <GoalRing value={currentBF?Math.max(0,1-Math.abs(currentBF-targetBF)/15):0} max={1} color="#f87171" label="Body Fat" sublabel={currentBF?`${currentBF.toFixed(1)}%`:'—'} unit={`target ${targetBF}%`} size={100}/>
        </div>
      </div>

      {/* ── Race Readiness + Today's Plan ── */}
      <div style={{display:'grid',gridTemplateColumns:nextRace?'1fr 1fr':'1fr',gap:10,marginBottom:10}}>
        {nextRace&&(
          <div style={{...panelStyle,borderLeft:`3px solid ${raceReady?.score>=70?'#4ade80':raceReady?.score>=40?'#fbbf24':'#ef4444'}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div>
                <div style={{fontSize:14,fontWeight:500,color:'var(--text-primary)'}}>{nextRace.name||'Next Race'}</div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>{parseLocalDate(nextRace.date)?.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · {nextRace.distanceMi?`${nextRace.distanceMi} mi`:(nextRace.distanceKm?`${nextRace.distanceKm} km`:'')}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:28,fontWeight:600,color:raceDaysLeft<=7?'#fbbf24':'var(--text-primary)',lineHeight:1}}>{raceDaysLeft===0?'Today':raceDaysLeft}</div>
                <div style={{fontSize:9,color:'var(--text-muted)'}}>{raceDaysLeft===0?'':'days left'}</div>
              </div>
            </div>
            {raceReady&&(
              <div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  <div style={{flex:1,height:6,borderRadius:3,background:'var(--bg-input)',overflow:'hidden'}}>
                    <div style={{height:'100%',borderRadius:3,background:raceReady.score>=70?'#4ade80':raceReady.score>=40?'#fbbf24':'#ef4444',width:`${Math.min(raceReady.score,100)}%`,transition:'width 0.6s ease'}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:600,color:raceReady.score>=70?'#4ade80':raceReady.score>=40?'#fbbf24':'#ef4444'}}>{raceReady.score}/100</span>
                </div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>
                  {raceReady.status==='ready'?'Race ready — maintain and taper':''}
                  {raceReady.status==='building'?'Building fitness — stay consistent':''}
                  {raceReady.status==='undertrained'?'Volume gap — increase mileage gradually':''}
                </div>
                {raceReady.gaps?.length>0&&<div style={{fontSize:9,color:'#fbbf24',marginTop:4}}>{raceReady.gaps.slice(0,2).join(' · ')}</div>}
              </div>
            )}
          </div>
        )}
        <div style={panelStyle}>
          <div style={subHdr}>Today's Plan</div>
          {planned?(
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:48,height:48,borderRadius:12,background:planCompleted?'rgba(74,222,128,0.12)':'rgba(96,165,250,0.12)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>
                {planCompleted?'✓':planned.type==='rest'?'😴':planned.type?.includes('run')?'🏃':'💪'}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:500,color:'var(--text-primary)'}}>{plannedLabel}</div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>
                  {planned.distanceMi?`${planned.distanceMi} mi`:planned.durationMin?`${planned.durationMin} min`:''}
                  {planned.notes?` · ${planned.notes}`:''}
                </div>
                <div style={{fontSize:10,fontWeight:500,color:planCompleted?'#4ade80':'#60a5fa',marginTop:2}}>{planCompleted?'Completed ✓':'Planned'}</div>
              </div>
            </div>
          ):(
            <div style={{fontSize:12,color:'var(--text-muted)',padding:'8px 0'}}>No workout planned today. <span style={{color:'#60a5fa',cursor:'pointer',textDecoration:'underline',textUnderlineOffset:'2px'}} onClick={()=>setTab('goals')}>Set up weekly plan →</span></div>
          )}
        </div>
      </div>

      {/* ── Daily Compound Snapshot — the "everything at a glance" grid ── */}
      <div style={{...panelStyle,marginBottom:10}}>
        <div style={subHdr}>Daily Compound · What Shapes You Every Day</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:10}}>

          {/* Activity */}
          <div style={{background:'var(--bg-elevated)',borderRadius:8,padding:'10px 12px',cursor:'pointer'}} onClick={()=>setTab('training')}>
            <div style={{fontSize:9,color:'#60a5fa',fontWeight:600,letterSpacing:'0.05em',marginBottom:6}}>ACTIVITY</div>
            <div style={{fontSize:20,fontWeight:600,color:'var(--text-primary)',lineHeight:1}}>{avgWeeklyMi.toFixed(1)}</div>
            <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2}}>mi/wk avg</div>
            <div style={divider}/>
            <div style={{fontSize:10,color:'var(--text-secondary)'}}>
              <div>{ytdRuns.length} runs · {ytdStrength.length} strength</div>
              <div style={{color:volPct>=0.9?'#4ade80':volPct>=0.7?'#fbbf24':'#ef4444',marginTop:2}}>{Math.round(volPct*100)}% of weekly goal</div>
            </div>
            {/* Mini sparkline */}
            <svg width="100%" height="24" viewBox="0 0 80 24" preserveAspectRatio="none" style={{marginTop:6}}>
              {weeklyMiles.length>1&&(()=>{
                const max2=Math.max(...weeklyMiles,1);
                const pts=weeklyMiles.map((v,i)=>`${(i/(weeklyMiles.length-1))*80},${24-(v/max2)*20}`).join(' ');
                return<polyline points={pts} fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.7"/>;
              })()}
            </svg>
          </div>

          {/* Nutrition */}
          <div style={{background:'var(--bg-elevated)',borderRadius:8,padding:'10px 12px',cursor:'pointer'}} onClick={()=>setTab('daily')}>
            <div style={{fontSize:9,color:'#4ade80',fontWeight:600,letterSpacing:'0.05em',marginBottom:6}}>NUTRITION</div>
            <div style={{fontSize:20,fontWeight:600,color:'var(--text-primary)',lineHeight:1}}>{avgCalories||'—'}</div>
            <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2}}>kcal/day avg</div>
            <div style={divider}/>
            <div style={{fontSize:10,color:'var(--text-secondary)'}}>
              <div>Protein: {avgProtein||0}g / {profile?.dailyProteinTarget||150}g</div>
              <div style={{color:protPct>=0.85?'#4ade80':protPct>=0.7?'#fbbf24':'#ef4444',marginTop:2}}>{Math.round(protPct*100)}% protein target</div>
            </div>
          </div>

          {/* Sleep & Recovery */}
          <div style={{background:'var(--bg-elevated)',borderRadius:8,padding:'10px 12px',cursor:'pointer'}} onClick={()=>setTab('clinical')}>
            <div style={{fontSize:9,color:'#22d3ee',fontWeight:600,letterSpacing:'0.05em',marginBottom:6}}>RECOVERY</div>
            <div style={{fontSize:20,fontWeight:600,color:'var(--text-primary)',lineHeight:1}}>{latestSleepScore||'—'}</div>
            <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2}}>sleep score (7d)</div>
            <div style={divider}/>
            <div style={{fontSize:10,color:'var(--text-secondary)'}}>
              <div>HRV: {avgHRV7||'—'}ms · RHR: {latestRHR||'—'}bpm</div>
              <div>Sleep: {avgSleepMins7?`${Math.floor(avgSleepMins7/60)}h ${avgSleepMins7%60}m`:'—'}</div>
            </div>
          </div>

          {/* Body */}
          <div style={{background:'var(--bg-elevated)',borderRadius:8,padding:'10px 12px',cursor:'pointer'}} onClick={()=>setTab('clinical')}>
            <div style={{fontSize:9,color:'#fbbf24',fontWeight:600,letterSpacing:'0.05em',marginBottom:6}}>BODY</div>
            <div style={{fontSize:20,fontWeight:600,color:'var(--text-primary)',lineHeight:1}}>{currentWeight?currentWeight.toFixed(0):'—'}</div>
            <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2}}>lbs current</div>
            <div style={divider}/>
            <div style={{fontSize:10,color:'var(--text-secondary)'}}>
              <div>BF: {currentBF?`${currentBF.toFixed(1)}%`:'—'} · Target: {targetBF}%</div>
              <div style={{color:currentWeight&&currentWeight<=targetWeight?'#4ade80':'var(--text-muted)',marginTop:2}}>{currentWeight?`${(currentWeight-targetWeight).toFixed(1)} lbs to go`:'—'}</div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Trend snapshot — 8-week weekly mileage ── */}
      <div style={panelStyle}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={subHdr}>8-Week Mileage Trend</div>
          <span style={{fontSize:10,color:'var(--text-muted)',cursor:'pointer'}} onClick={()=>setTab('training')}>EdgeIQ →</span>
        </div>
        <svg viewBox="0 0 320 70" style={{width:'100%',height:'auto'}}>
          {(()=>{
            const maxMi=Math.max(...weeklyMiles,weeklyRunTarget,1);
            const goalY=68-(weeklyRunTarget/maxMi)*56;
            return<>
              <line x1="2" y1={goalY} x2="318" y2={goalY} stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4"/>
              <text x="320" y={goalY-3} textAnchor="end" fontSize="7" fill="var(--text-muted)">{weeklyRunTarget}mi</text>
              {weeklyMiles.map((mi,i)=>{
                const barW=30;const gap=8;const x=i*(barW+gap)+12;
                const h=Math.max(2,(mi/maxMi)*56);
                const y=68-h;
                const isLast=i===7;
                const pct2=mi/weeklyRunTarget;
                const clr=pct2>=0.9?'#60a5fa':pct2>=0.7?'#fbbf24':'rgba(96,165,250,0.3)';
                return<g key={i}>
                  <rect x={x} y={y} width={barW} height={h} rx={3} fill={isLast?'#60a5fa':clr} opacity={isLast?1:0.7}/>
                  {mi>0&&<text x={x+barW/2} y={y-3} textAnchor="middle" fontSize="7" fill="var(--text-muted)">{mi.toFixed(0)}</text>}
                </g>;
              })}
            </>;
          })()}
        </svg>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:8,color:'var(--text-muted)',marginTop:4,padding:'0 12px'}}>
          <span>8 wks ago</span>
          <span>this week</span>
        </div>
      </div>

      {/* ── Quick links ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:8,marginTop:10}}>
        {[
          {label:'EdgeIQ',icon:'◈',tab:'training',color:'#a78bfa'},
          {label:'Daily Log',icon:'⊕',tab:'daily',color:'#60a5fa'},
          {label:'Body',icon:'◉',tab:'clinical',color:'#fbbf24'},
          {label:'Calendar',icon:'▦',tab:'races',color:'#4ade80'},
        ].map(q=>(
          <button key={q.tab} onClick={()=>setTab(q.tab)} style={{background:'var(--bg-surface)',border:'0.5px solid var(--border-default)',borderRadius:8,padding:'10px 8px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
            <span style={{fontSize:18,color:q.color}}>{q.icon}</span>
            <span style={{fontSize:10,color:'var(--text-secondary)',fontWeight:500}}>{q.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({data,setTab,onAiSum,aiSummLoad,aiSummStream,showToast,mobileInitView}){
  // ── Storage version (Phase 4m.2) — invalidates the KRI ctx/timeframes
  // memo whenever any storage key changes (Cloud Sync pull, manual edit).
  const storageVersion=useStorageVersion();
  // ── Mobile detection ──
  const [isDashMobile,setIsDashMobile]=useState(()=>window.innerWidth<=600);
  useEffect(()=>{const mq=window.matchMedia('(max-width: 600px)');const h=e=>setIsDashMobile(e.matches);mq.addEventListener('change',h);return()=>mq.removeEventListener('change',h);},[]);
  // ── Week boundaries ──
  const now=new Date();
  const dayOfWeek2=now.getDay();
  const monday=new Date(now);monday.setDate(now.getDate()-(dayOfWeek2===0?6:dayOfWeek2-1));monday.setHours(0,0,0,0);
  const lastMonday=new Date(monday);lastMonday.setDate(monday.getDate()-7);
  const lastSunday=new Date(monday);lastSunday.setDate(monday.getDate()-1);lastSunday.setHours(23,59,59,999);
  const sun=new Date(monday);sun.setDate(monday.getDate()+6);
  const weekLabel=`${monday.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sun.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  const yearStr=String(now.getFullYear());
  const inWk=(dateStr,start,end)=>{if(!dateStr)return false;const d=new Date(dateStr+'T12:00:00');return d>=start&&d<=end;};
  const inYear=d=>d&&d.startsWith(yearStr);

  // ── Load data ──
  const profile={...(storage.get('profile')||{}),...getGoals()};
  const activities=getUnifiedActivities();
  // Nutrition source for the Weekly snapshot card.
  // Prior bug (Phase 4g fix): read directly from the legacy `cronometer`
  // storage key, which captured only manual CSV imports — completely missed
  // the Cronometer Worker writes that land in `nutritionLog` as full-day
  // entries (id `cronometer-live:${date}`). Result: weekly card showed 0g
  // protein / blank consumed despite fresh data being available.
  //
  // Sources merged here:
  //   - nutDailyTotals(ds): nutritionLog full-day + manual + legacy cronometer
  //                         (returns calories/protein/carbs/fat/fiber/sugar/water)
  //   - nutritionLog full-day entry's `extended` block: sodium/potassium/magnesium/etc.
  //     (cronometer-client.js writes these as a separate field on the full-day entry)
  const nutrition = (() => {
    const days = [];
    const ref = new Date();
    const allNutLog = (typeof storage !== 'undefined' && storage.get('nutritionLog')) || [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(ref);
      d.setDate(ref.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const t = nutDailyTotals(ds);
      // Pull micros off the cronometer-live full-day entry's `extended` block.
      const fullDay = allNutLog
        .filter(e => e?.date === ds && e?.meal === 'full-day')
        .sort((a, b) => (b?.createdAt || '').localeCompare(a?.createdAt || ''))[0];
      const ext = fullDay?.extended || {};
      if (t.calories > 0 || t.protein > 0 || t.entryCount > 0) {
        days.push({
          date: ds,
          ...t,
          // Micronutrients (mg unless noted)
          sodium:    Number(ext.sodium) || 0,
          potassium: Number(ext.potassium) || 0,
          magnesium: Number(ext.magnesium) || 0,
          calcium:   Number(ext.calcium) || 0,
          iron:      Number(ext.iron) || 0,
          caffeine:  Number(ext.caffeine) || 0,
          alcohol:   Number(ext.alcohol) || 0,
        });
      }
    }
    return days;
  })();
  const weightData=storage.get('weight')||[];
  const sleepData=storage.get('sleep')||[];
  const hrvData=storage.get('hrv')||[];

  // ── Weekly Sync (Sunday CSV drop) ──
  const [syncStatus,setSyncStatus]=useState({});
  const [syncing,setSyncing]=useState(false);
  const handleWeeklySync=async(files)=>{
    if(!files||!files.length)return;
    setSyncing(true);
    const status={};
    const readText=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(f);});
    for(const file of files){
      const name=file.name;
      try{
        const txt=await readText(file);
        const type=detectCSVType(txt,name);
        if(type==='activities'){
          const parsed=parseActivitiesCSV(txt);
          const existing=storage.get('activities')||[];
          const {merged}=mergeActivities(existing,parsed);
          storage.set('activities',merged);
          status[name]={ok:true,count:parsed.length,type:'Activities'};
        }else if(type==='hrv'){
          const parsed=parseHRVCSV(txt);
          const existing=storage.get('hrv')||[];
          const {merged}=mergeHRV(existing,parsed);
          storage.set('hrv',merged);
          status[name]={ok:true,count:parsed.length,type:'HRV'};
        }else if(type==='sleep'){
          const parsed=parseSleepCSV(txt);
          const existing=storage.get('sleep')||[];
          const {merged}=mergeSleep(existing,parsed);
          storage.set('sleep',merged);
          status[name]={ok:true,count:parsed.length,type:'Sleep'};
        }else if(type==='weight'){
          const parsed=parseWeightCSV(txt);
          const existing=storage.get('weight')||[];
          const {merged}=mergeWeight(existing,parsed);
          storage.set('weight',merged);
          status[name]={ok:true,count:parsed.length,type:'Weight'};
        }else if(type==='resting_hr'){
          // Standalone Resting Heart Rate CSV — merge into sleep store
          const lines=txt.replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1);
          const parsed=[];
          for(const line of lines){
            const [rawDate,rawHR]=line.split(',');
            if(!rawDate||!rawHR) continue;
            const dm=rawDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            const date=dm?`${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`:null;
            const hr=parseInt(rawHR.trim(),10);
            if(date&&hr>0&&hr<=200) parsed.push({date,restingHR:hr});
          }
          const existing=storage.get('sleep')||[];
          const byDate=new Map(existing.map(r=>[r.date,r]));
          for(const r of parsed){
            const prev=byDate.get(r.date);
            if(prev) byDate.set(r.date,{...prev,restingHR:r.restingHR});
            else byDate.set(r.date,{date:r.date,restingHR:r.restingHR,source:'resting_hr_csv'});
          }
          storage.set('sleep',[...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date)));
          status[name]={ok:true,count:parsed.length,type:'Resting HR'};
        }else if(type==='cronometer'){
          const parsed=parseCronometerCSV(txt);
          const existing=storage.get('cronometer')||[];
          const byDate=new Map(existing.map(r=>[r.date,r]));
          for(const r of parsed) byDate.set(r.date,r);
          storage.set('cronometer',Array.from(byDate.values()));
          status[name]={ok:true,count:parsed.length,type:'Cronometer'};
        }else{
          status[name]={ok:false,error:'Unknown CSV type'};
        }
      }catch(e){status[name]={ok:false,error:e.message};}
      setSyncStatus({...status});
    }
    setSyncing(false);
    if(Object.values(status).some(s=>s.ok)){
      showToast&&showToast('Weekly sync complete · running AI summary…');
      try{onAiSum&&onAiSum();}catch{}
      setTimeout(()=>window.location.reload(),1500);
    }
  };

  // ── Mobile: render standalone MobileEdgeIQ for the EdgeIQ tab ──
  if(isDashMobile){
    return <MobileEdgeIQ data={data} onOpenTab={setTab} />;
  }

  // ── This/last week activities ──
  const thisWeekActs=activities.filter(a=>inWk(a.date,monday,now));
  const lastWeekActs=activities.filter(a=>inWk(a.date,lastMonday,lastSunday));
  // Canonical classifiers — single source of truth in activityClass.js.
  // HIIT counts as a run (distance) but is excluded from strength.
  const runs=isRunAct;
  const strength=isStrengthAct;
  const runCount=thisWeekActs.filter(runs).length;
  const strengthCount=thisWeekActs.filter(strength).length;
  const otherCount=thisWeekActs.filter(a=>!runs(a)&&!strength(a)&&!isMobilityAct(a)).length;

  const sum=(arr,key)=>arr.reduce((s,a)=>s+(parseFloat(a[key])||0),0);
  const avg2=(arr,key)=>arr.length?sum(arr,key)/arr.length:0;

  const weekMi=parseFloat(sum(thisWeekActs.filter(runs),'distanceMi').toFixed(1));
  const lastWeekMi=parseFloat(sum(lastWeekActs.filter(runs),'distanceMi').toFixed(1));
  const miDelta=parseFloat((weekMi-lastWeekMi).toFixed(1));

  const weekMins=Math.round(sum(thisWeekActs,'durationSecs')/60);
  const lastWeekMins=Math.round(sum(lastWeekActs,'durationSecs')/60);
  const timeDelta=weekMins-lastWeekMins;

  const weekCals=Math.round(sum(thisWeekActs,'calories'));
  const lastWeekCals=Math.round(sum(lastWeekActs,'calories'));
  const calsDelta=weekCals-lastWeekCals;

  const weekAscent=Math.round(sum(thisWeekActs.filter(runs),'totalAscentFt'));
  const lastWeekAscent=Math.round(sum(lastWeekActs.filter(runs),'totalAscentFt'));
  const ascentDelta=weekAscent-lastWeekAscent;

  const thisRunHRs=thisWeekActs.filter(runs).map(a=>a.avgHR).filter(Boolean);
  const avgHR=thisRunHRs.length?Math.round(thisRunHRs.reduce((s,v)=>s+v,0)/thisRunHRs.length):null;
  const lastRunHRs=lastWeekActs.filter(runs).map(a=>a.avgHR).filter(Boolean);
  const lastAvgHR=lastRunHRs.length?Math.round(lastRunHRs.reduce((s,v)=>s+v,0)/lastRunHRs.length):null;
  const hrDelta=avgHR&&lastAvgHR?avgHR-lastAvgHR:null;
  const hrPct=avgHR?Math.max(0,1-Math.abs(avgHR-140)/40):0;

  const strengthDelta=strengthCount-lastWeekActs.filter(strength).length;

  // Pace
  const paceToSecs=p=>{if(!p)return null;const[m,s]=p.split(':').map(Number);return(isNaN(m)||isNaN(s))?null:m*60+s;};
  const secsToMins=s=>{const m=Math.floor(s/60);const sec=Math.round(s%60);return`${m}:${String(sec).padStart(2,'0')}`;};
  const thisPaces=thisWeekActs.filter(runs).map(a=>paceToSecs(a.avgPaceRaw)).filter(Boolean);
  const avgPaceSecs=thisPaces.length?Math.round(thisPaces.reduce((s,v)=>s+v,0)/thisPaces.length):null;
  const avgPace=avgPaceSecs?secsToMins(avgPaceSecs):null;
  const lastPaces=lastWeekActs.filter(runs).map(a=>paceToSecs(a.avgPaceRaw)).filter(Boolean);
  const lastAvgPaceSecs=lastPaces.length?Math.round(lastPaces.reduce((s,v)=>s+v,0)/lastPaces.length):null;
  const paceDeltaSecs=avgPaceSecs&&lastAvgPaceSecs?lastAvgPaceSecs-avgPaceSecs:null;
  const goalPaceSecs=paceToSecs(profile?.targetRacePace)||paceToSecs('9:30');
  const pacePct=avgPaceSecs&&goalPaceSecs?Math.max(0,Math.min(1,goalPaceSecs/avgPaceSecs)):0;

  const formatDuration=mins=>{if(mins==null)return'—';const h=Math.floor(mins/60);const m=Math.round(mins%60);return h>0?`${h}h ${m}m`:`${m}m`;};

  // Nutrition
  const thisWeekNut=nutrition.filter(n=>inWk(n.date,monday,now));
  const lastWeekNut=nutrition.filter(n=>inWk(n.date,lastMonday,lastSunday));
  const avgConsumed=thisWeekNut.length?Math.round(avg2(thisWeekNut,'calories')):null;
  const avgBurned=weekCals>0&&thisWeekActs.length?Math.round(weekCals/thisWeekActs.length+1880):1880;
  const netCalories=avgConsumed?Math.round(avgConsumed-avgBurned):null;
  const consumedPct=avgConsumed?Math.min(avgConsumed/resolveCalorieTarget(todayStr,profile),1):0;
  const burnedPct=Math.min(avgBurned/2500,1);
  const avgProtein=thisWeekNut.length?avg2(thisWeekNut,'protein'):null;
  const avgCarbs=thisWeekNut.length?avg2(thisWeekNut,'carbs'):null;
  const avgFat=thisWeekNut.length?avg2(thisWeekNut,'fat'):null;
  const avgSodium=thisWeekNut.length?avg2(thisWeekNut,'sodium'):null;
  const avgPotassium=thisWeekNut.length?avg2(thisWeekNut,'potassium'):null;
  const avgMagnesium=thisWeekNut.length?avg2(thisWeekNut,'magnesium'):null;
  const proteinDelta=thisWeekNut.length&&lastWeekNut.length?Math.round(avg2(thisWeekNut,'protein')-avg2(lastWeekNut,'protein')):null;
  const carbsDelta=thisWeekNut.length&&lastWeekNut.length?Math.round(avg2(thisWeekNut,'carbs')-avg2(lastWeekNut,'carbs')):null;
  const fatDelta=thisWeekNut.length&&lastWeekNut.length?Math.round(avg2(thisWeekNut,'fat')-avg2(lastWeekNut,'fat')):null;

  // Body / Weight
  // Each metric falls through to the most recent row that HAS that field —
  // HC-sourced rows lack bodyFat/lean/BMI (HC doesn't pass them through),
  // so taking sortedWeight[0] for everything blanks those fields whenever
  // HC was the last writer. Also: defensive range-guard on BMI to filter
  // out garbage values like 5306 from any malformed CSV row.
  const sortedWeight=[...weightData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const latestW2=sortedWeight[0];
  const prevW2=sortedWeight.find(w=>w.date&&new Date(w.date+'T12:00:00')<monday);
  const findLatest = (key, validator = v => v != null) => {
    for (const r of sortedWeight) if (validator(r?.[key])) return { value: r[key], row: r };
    return null;
  };
  const findPrev = (key, validator = v => v != null) => {
    for (const r of sortedWeight) {
      if (r?.date && new Date(r.date+'T12:00:00') < monday && validator(r?.[key])) return { value: r[key], row: r };
    }
    return null;
  };
  const isPlausibleBmi = (v) => typeof v === 'number' && v >= 10 && v <= 60;
  const currentWeight   = findLatest('weightLbs')?.value || null;
  const currentBodyFat  = findLatest('bodyFatPct', v => typeof v === 'number' && v > 0 && v < 60)?.value || null;
  const currentLeanMass = findLatest('skeletalMuscleMassLbs', v => typeof v === 'number' && v > 0 && v < 300)?.value || null;
  const currentBMI      = findLatest('bmi', isPlausibleBmi)?.value || null;
  const latestWeightDate=latestW2?.date?new Date(latestW2.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';
  const weightDelta=currentWeight&&prevW2?.weightLbs?parseFloat((currentWeight-prevW2.weightLbs).toFixed(1)):null;
  // Deltas use the prior valid row of each field (not just last week's last row),
  // because if last week's last row was HC-sourced too, prevW2.bodyFatPct is null.
  const prevBodyFat  = findPrev('bodyFatPct', v => typeof v === 'number' && v > 0 && v < 60)?.value || null;
  const prevLeanMass = findPrev('skeletalMuscleMassLbs', v => typeof v === 'number' && v > 0 && v < 300)?.value || null;
  const prevBMI      = findPrev('bmi', isPlausibleBmi)?.value || null;
  const bodyFatDelta = currentBodyFat && prevBodyFat ? parseFloat((currentBodyFat - prevBodyFat).toFixed(1)) : null;
  const leanDelta    = currentLeanMass && prevLeanMass ? parseFloat((currentLeanMass - prevLeanMass).toFixed(1)) : null;
  const bmiDelta     = currentBMI && prevBMI ? parseFloat((currentBMI - prevBMI).toFixed(1)) : null;

  // HRV & Sleep
  // HRV: merge legacy hrv collection + Worker-tagged sleep rows (overnightHRV).
  // The legacy collection is empty for users on the Garmin Worker path, so
  // reading `hrvData` alone produces an empty list and the tile shows "—".
  // Worker-source wins per date when both exist.
  const mergeHrvForRange = (rangeStart, rangeEnd) => {
    const byDate = new Map();
    for (const h of (hrvData || [])) {
      if (h?.date && inWk(h.date, rangeStart, rangeEnd)
          && h.overnightHRV != null && !isNaN(Number(h.overnightHRV))) {
        byDate.set(h.date, { date: h.date, overnightHRV: Number(h.overnightHRV) });
      }
    }
    for (const s of (sleepData || [])) {
      if (s?.date && inWk(s.date, rangeStart, rangeEnd)
          && s.overnightHRV != null && !isNaN(Number(s.overnightHRV))) {
        byDate.set(s.date, { date: s.date, overnightHRV: Number(s.overnightHRV) });
      }
    }
    return [...byDate.values()];
  };
  const thisWeekHRV  = mergeHrvForRange(monday, now);
  const lastWeekHRV  = mergeHrvForRange(lastMonday, lastSunday);
  const avgHRVv      = thisWeekHRV.length ? avg2(thisWeekHRV, 'overnightHRV') : null;
  const lastAvgHRV   = lastWeekHRV.length ? avg2(lastWeekHRV, 'overnightHRV') : null;
  const hrvDelta     = avgHRVv && lastAvgHRV ? Math.round(avgHRVv - lastAvgHRV) : null;
  const thisWeekSleep=sleepData.filter(s=>inWk(s.date,monday,now));
  const lastWeekSleep=sleepData.filter(s=>inWk(s.date,lastMonday,lastSunday));
  const avgSleepMins=thisWeekSleep.length?Math.round(avg2(thisWeekSleep,'durationMinutes')):null;
  const lastAvgSleepMins=lastWeekSleep.length?Math.round(avg2(lastWeekSleep,'durationMinutes')):null;
  const sleepDelta=avgSleepMins&&lastAvgSleepMins?avgSleepMins-lastAvgSleepMins:null;
  const avgSleepScore=thisWeekSleep.length?avg2(thisWeekSleep,'sleepScore'):null;
  const lastAvgSleepScore=lastWeekSleep.length?avg2(lastWeekSleep,'sleepScore'):null;
  const scoreDelta=avgSleepScore&&lastAvgSleepScore?Math.round(avgSleepScore-lastAvgSleepScore):null;

  // ── Annual progress ──
  const yearActs=activities.filter(a=>inYear(a.date));
  const yearRuns2=yearActs.filter(runs);
  const yearDist=yearRuns2.reduce((s,a)=>s+(a.distanceMi||0),0);
  const yearWorkouts=yearActs.length;
  const d28=new Date(now);d28.setDate(d28.getDate()-28);
  const last28=activities.filter(a=>a.date>=td(d28)).filter(runs);
  const weeklyAvgDist=last28.reduce((s,a)=>s+(a.distanceMi||0),0)/4;
  const d30=new Date(now);d30.setDate(d30.getDate()-30);
  const last30Crono=nutrition.filter(c=>c.date>=td(d30)&&c.calories);
  const avg30Cal=last30Crono.length?Math.round(last30Crono.reduce((s,c)=>s+(parseFloat(c.calories)||0),0)/last30Crono.length):null;
  const avg30Pro=last30Crono.length?Math.round(last30Crono.reduce((s,c)=>s+(parseFloat(c.protein)||0),0)/last30Crono.length):null;
  const avg30Carbs=last30Crono.length?Math.round(last30Crono.reduce((s,c)=>s+(parseFloat(c.carbs)||0),0)/last30Crono.length):null;
  const avg30Fat=last30Crono.length?Math.round(last30Crono.reduce((s,c)=>s+(parseFloat(c.fat)||0),0)/last30Crono.length):null;
  // Phase 4l — Micronutrients + quality fields for the LAST 8 WEEKS Nutrition
  // tile, so it has comparable visual heft to the Training tile next to it.
  const _sumKey=(k)=>last30Crono.reduce((s,c)=>s+(parseFloat(c[k])||0),0);
  const avg30Sod  = last30Crono.length?Math.round(_sumKey('sodium')/last30Crono.length):null;
  const avg30Pot  = last30Crono.length?Math.round(_sumKey('potassium')/last30Crono.length):null;
  const avg30Mag  = last30Crono.length?Math.round(_sumKey('magnesium')/last30Crono.length):null;
  const avg30Fiber= last30Crono.length?Math.round(_sumKey('fiber')/last30Crono.length):null;
  const avg30Sugar= last30Crono.length?Math.round(_sumKey('sugar')/last30Crono.length):null;
  const _satFSum = _sumKey('saturated_fat')||_sumKey('saturatedFat')||_sumKey('satFat');
  const avg30SatF = last30Crono.length&&_satFSum?Math.round(_satFSum/last30Crono.length):null;
  // Logging coverage — out of last 30 days, how many had any nutrition logged
  const _last30Dates=(()=>{const o=new Set();for(let i=0;i<30;i++){const d=new Date();d.setDate(d.getDate()-i);o.add(td(d));}return o;})();
  const cov30Days = last30Crono.filter(c=>_last30Dates.has(c.date)).length;
  // 30-day average daily burn for the Nutrition donut: RMR floor + activity calories ÷ 30
  const last30Acts=activities.filter(a=>a.date>=td(d30));
  const last30ActKcal=last30Acts.reduce((s,a)=>s+(parseFloat(a.calories)||0),0);
  const avg30Burned=Math.round((resolveCalorieTarget(todayStr,profile)+(last30ActKcal/30)));
  const calT=resolveCalorieTarget(todayStr,profile);

  // ── Training analysis variables (Phase 4l moves from EdgeIQ) ──
  // Suffixed with Ytd / Trend where Dashboard already has same-name
  // variables for THIS-WEEK calculations (e.g. avgPaceSecs is this-week
  // pace at line 2595; mine is YTD average and gets a different name).
  const ytdStrength=yearActs.filter(isStrengthAct);
  const yearStartDt=new Date(now.getFullYear(),0,1);
  const weeksElapsed=Math.max(1,(now-yearStartDt)/(7*86400000));
  const avgWeeklyMi=yearDist/weeksElapsed;
  const avgWeeklyHrsRun=(yearRuns2.reduce((s,a)=>s+(a.durationSecs||0),0)/3600)/weeksElapsed;
  const avgWeeklyHrsStr=(ytdStrength.reduce((s,a)=>s+(a.durationSecs||0),0)/3600)/weeksElapsed;
  const runPacesYtd=yearRuns2.map(a=>{if(!a.avgPaceRaw)return null;const[m,s]=a.avgPaceRaw.split(':').map(Number);return m*60+(s||0);}).filter(Boolean);
  const avgPaceSecsYtd=runPacesYtd.length?runPacesYtd.reduce((s,v)=>s+v,0)/runPacesYtd.length:null;
  const fmtPaceTrend=s=>s?`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`:'—';
  // goalPaceSecs already exists in Dashboard scope (line 2600) — reuse it
  const avgHRTrend=yearRuns2.length?Math.round(yearRuns2.reduce((s,a)=>s+(parseFloat(a.avgHR)||0),0)/yearRuns2.filter(a=>a.avgHR).length):null;
  const longRun=Math.max(...yearRuns2.slice(-12).map(a=>a.distanceMi||0),0);
  const annualRunTarget=parseFloat(profile?.annualRunDistanceTarget)||800;
  const annualWorkoutTarget=parseFloat(profile?.annualWorkoutsTarget)||200;
  const weeklyRunTarget=parseFloat(profile?.weeklyRunDistanceTarget)||20;
  const strTarget=parseFloat(profile?.weeklyStrengthTarget)||2;
  const aeroPct=yearWorkouts>0?Math.round((yearRuns2.length/yearWorkouts)*100):62;
  const anaPct=100-aeroPct;
  // RPE: average of any logged self-reported RPE values from dailyLogs
  const allLogs=storage.get('dailyLogs')||[];
  const rpeEntries=allLogs.filter(l=>l?.rpe!=null&&!isNaN(parseFloat(l.rpe)));
  const avgRPE=rpeEntries.length?(rpeEntries.reduce((s,l)=>s+parseFloat(l.rpe),0)/rpeEntries.length).toFixed(1):null;

  // ── Live Baseline data (Phase 4l Stage B — replaces hardcoded Mar 2025) ──
  // Body composition: priority DEXA → Garmin scale → profile → estimate
  const liveBodyComp = (() => { try { return getCurrentBodyComp(); } catch { return null; } })();
  // RMR: Katch-McArdle from current LBM (live from latest body comp)
  const liveRMRResult = (() => { try { return computeRMR(); } catch { return null; } })();
  // VO2Max: priority watch override → wellness → latest activity → clinical lab test
  const clinicalTestsAll = storage.get('clinicalTests') || [];
  const wellnessAll = storage.get('wellness') || [];
  const liveVO2Max = (() => {
    const profileObj = storage.get('profile') || {};
    const manualV = Number(profileObj?.watchVO2Max);
    if (Number.isFinite(manualV) && manualV > 0) return Math.round(manualV * 10) / 10;
    const sortedW = [...wellnessAll].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    for (const w of sortedW) { const v = Number(w?.garminWatchVO2Max); if (Number.isFinite(v) && v > 0) return Math.round(v * 10) / 10; }
    const sortedActs = [...activities].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    for (const a of sortedActs) { const v = a?.vO2MaxValue ?? a?.vo2Max ?? a?.vO2Max; if (typeof v === 'number' && v > 0) return Math.round(v * 10) / 10; }
    const labV = clinicalTestsAll.filter(t => t?.type === 'vo2max' && Number(t?.metrics?.vo2max) > 0).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    return labV ? Math.round(Number(labV.metrics.vo2max) * 10) / 10 : null;
  })();

  // ── Recovery panel variables (Phase 4l Stage 2.4) ──
  const d7Trend=new Date(now);d7Trend.setDate(d7Trend.getDate()-7);
  const d30Trend=new Date(now);d30Trend.setDate(d30Trend.getDate()-30);
  const recentHRV7=hrvData.filter(h=>h?.date&&parseLocalDate(h.date)>=d7Trend&&h.overnightHRV);
  const recentHRV30=hrvData.filter(h=>h?.date&&parseLocalDate(h.date)>=d30Trend&&h.overnightHRV);
  const recentSleep7=sleepData.filter(s=>s?.date&&parseLocalDate(s.date)>=d7Trend);
  const recentSleep30=sleepData.filter(s=>s?.date&&parseLocalDate(s.date)>=d30Trend);
  const avgHRV7=recentHRV7.length?Math.round(recentHRV7.reduce((s,h)=>s+h.overnightHRV,0)/recentHRV7.length):null;
  const avgHRV30=recentHRV30.length?Math.round(recentHRV30.reduce((s,h)=>s+h.overnightHRV,0)/recentHRV30.length):null;
  const recentSleepDur7=recentSleep7.filter(s=>s.durationMinutes);
  const avgSleepMins7=recentSleepDur7.length?Math.round(recentSleepDur7.reduce((s,sl)=>s+sl.durationMinutes,0)/recentSleepDur7.length):null;
  const recentSleepDur30=recentSleep30.filter(s=>s.durationMinutes);
  const avgSleepMins30=recentSleepDur30.length?Math.round(recentSleepDur30.reduce((s,sl)=>s+sl.durationMinutes,0)/recentSleepDur30.length):null;
  const recentRHR30=recentSleep30.filter(s=>s.restingHR);
  const avgRHR30=recentRHR30.length?Math.round(recentRHR30.reduce((s,sl)=>s+sl.restingHR,0)/recentRHR30.length):null;
  const fmtSleep=m=>m?`${Math.floor(m/60)}h ${m%60}m`:'—';

  // ── 30-day Cockpit variables (Phase 4l Stage 2.3 — moved from EdgeIQ) ──
  // Latest biometrics (today/yesterday only — no stale fallback)
  const sortedSleepDash=[...sleepData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const sortedHRVDash=[...hrvData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const todayStrTrend=td();
  const yestStrTrend=(()=>{const d=new Date();d.setDate(d.getDate()-1);return td(d);})();
  const latestSleepScoreDash=(()=>{
    const top=sortedSleepDash[0];
    if(!top) return null;
    if(top.date!==todayStrTrend && top.date!==yestStrTrend) return null;
    if(top.sleepScore==null) return null;
    return Math.min(top.sleepScore,100);
  })();
  const latestRHRDash=sortedSleepDash[0]?.restingHR||null;
  const latestHRVDash=sortedHRVDash[0]?.overnightHRV||sortedHRVDash[0]?.value||null;
  const avgWeeklyHrsTotal=avgWeeklyHrsRun+avgWeeklyHrsStr;
  // 8-week stats for sparklines + Annual Trends 8-wk charts
  // Fields: mi, hrs, sleepScore, rhr, hrv, pace (avg run pace secs), weight (avg)
  const weeklyStatsTrend=Array.from({length:8},(_,i)=>{
    // ISO Mon-Sun week. JS getDay() returns 0=Sunday … 6=Saturday, so the
    // offset back to Monday is (day===0?6:day-1). Using getDay() directly
    // produced a Sunday-start window — on Sunday morning the current week
    // bucket pointed forward to next Sunday, leaving this Mon-Sat data
    // outside the bucket. (Bug fix: cockpit blank on Sundays.)
    const day=now.getDay();
    const daysBackToMon=(day===0?6:day-1);
    const ws=new Date(now);ws.setDate(now.getDate()-7*(7-i)-daysBackToMon);ws.setHours(0,0,0,0);
    const we=new Date(ws);we.setDate(ws.getDate()+7);
    const wAll=activities.filter(a=>{const d=a.date&&parseLocalDate(a.date);return d&&d>=ws&&d<we;});
    const wRuns=wAll.filter(isRunAct);
    const mi=wRuns.reduce((s,a)=>s+(a.distanceMi||0),0);
    const hrs=wAll.reduce((s,a)=>s+(a.durationSecs||0),0)/3600;
    const wSleep=sleepData.filter(s=>{const d=s.date&&parseLocalDate(s.date);return d&&d>=ws&&d<we;});
    const sScores=wSleep.filter(s=>s.sleepScore).map(s=>s.sleepScore);
    const sleepScore=sScores.length?Math.round(sScores.reduce((a,b)=>a+b,0)/sScores.length):null;
    const rhrs=wSleep.filter(s=>s.restingHR).map(s=>s.restingHR);
    const rhr=rhrs.length?Math.round(rhrs.reduce((a,b)=>a+b,0)/rhrs.length):null;
    // HRV — merge sources by date (Phase 4m.2.10 fix). Cockpit was only
    // reading hrvData (manual CSV imports); Garmin Worker writes HRV onto
    // sleepData rows (overnightHRV field). Sleep wins on date conflicts —
    // same priority as the Recovery > HRV KRI tile uses via mergedHrvByDate.
    const hrvByDate=new Map();
    for(const h of hrvData){const d=h?.date&&parseLocalDate(h.date);if(d&&d>=ws&&d<we&&h?.overnightHRV)hrvByDate.set(h.date,Number(h.overnightHRV));}
    for(const s of wSleep){if(s?.overnightHRV)hrvByDate.set(s.date,Number(s.overnightHRV));}
    const hrvs=[...hrvByDate.values()].filter(v=>Number.isFinite(v));
    const hrv=hrvs.length?Math.round(hrvs.reduce((a,b)=>a+b,0)/hrvs.length):null;
    // Avg pace this week (seconds per mile)
    const paces=wRuns.map(a=>{if(!a.avgPaceRaw)return null;const[m,s]=a.avgPaceRaw.split(':').map(Number);return m*60+(s||0);}).filter(Boolean);
    const pace=paces.length?paces.reduce((a,b)=>a+b,0)/paces.length:null;
    // Avg weight this week
    const wWeight=weightData.filter(w=>{const d=w.date&&parseLocalDate(w.date);return d&&d>=ws&&d<we;});
    const wts=wWeight.map(w=>parseFloat(w.weightLbs)).filter(v=>v>0);
    const weight=wts.length?wts.reduce((a,b)=>a+b,0)/wts.length:null;
    return {mi,hrs,sleepScore,rhr,hrv,pace,weight};
  });
  const weeklyHrsTargetTrend=parseFloat(profile?.weeklyTimeTargetHrs)||5;
  const maxHrsTrend=Math.max(...weeklyStatsTrend.map(w=>w.hrs),weeklyHrsTargetTrend,1);
  const validPacesTrend=weeklyStatsTrend.map(w=>w.pace).filter(Boolean);
  const minPaceTrend=validPacesTrend.length?Math.min(...validPacesTrend):0;
  const maxPaceTrend=validPacesTrend.length?Math.max(...validPacesTrend):1;
  const validWeightsTrend=weeklyStatsTrend.map(w=>w.weight).filter(Boolean);
  const minWtTrend=validWeightsTrend.length?Math.min(...validWeightsTrend):0;
  const maxWtTrend=validWeightsTrend.length?Math.max(...validWeightsTrend):1;
  const targetWtTrend=parseFloat(profile?.targetWeight)||175;

  const today=td();
  const allRaces=(()=>{try{return JSON.parse(localStorage.getItem('arnold:races')||'[]');}catch{return[];}})();
  const todayDate=new Date();todayDate.setHours(0,0,0,0);
  const cutoff=new Date(todayDate);cutoff.setDate(todayDate.getDate()+90);
  const upRaces=allRaces.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=todayDate&&d<=cutoff;}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date));
  const nextFutureRace=allRaces.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=todayDate;}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date))[0];

  // ── ProgBar helper ──
  const ProgBar=({label,actual,target,unit})=>{
    const pct=target?(actual||0)/target:0;
    const clr=pct>=0.9?C.ta:pct>=0.6?C.wn:C.dn;
    return<div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
        <span style={{fontSize:12,color:C.t}}>{label}</span>
        <span style={{fontSize:11,color:C.m}}>{actual!=null?`${typeof actual==='number'?actual.toFixed(actual%1?1:0):actual}`:'—'} / {target} {unit} <span style={{color:clr}}>({target?Math.round(pct*100):0}%)</span></span>
      </div>
      <div style={{height:6,background:C.inp,borderRadius:3}}><div style={{height:6,width:`${Math.min(100,pct*100)}%`,background:clr,borderRadius:3,transition:"width 0.3s"}}/></div>
    </div>;
  };

  // ── KRI context for Trend spaceship view (Phase 4m.2) ──
  // buildTileContext bundles every collection any metric might need (avoids
  // each metric reading storage individually). Memoized against the global
  // storage version so a Cloud Sync pull triggers a recompute.
  const tileCtx=useMemo(()=>buildTileContext({
    activities, sleepData: cleanSleepForAveraging(storage.get('sleep')||[]),
    hrvData: storage.get('hrv')||[], weightData: storage.get('weight')||[],
    nutritionLog: storage.get('nutritionLog')||[], cronometer: storage.get('cronometer')||[],
    dailyLogs: storage.get('dailyLogs')||[], profile,
    wellness: storage.get('wellness')||[],
    // Races live at the legacy localStorage key 'arnold:races' (used by
    // Garmin ICS sync + manual CSV imports). Race Predictor metric uses
    // the soonest future race to pick which prediction field to surface.
    races:(()=>{try{return JSON.parse(localStorage.getItem('arnold:races')||'[]');}catch{return [];}})(),
  }),[storageVersion]);
  // Pinned-to-Start-screen state for the tap-to-pin feature on KRI tiles.
  const [tilePrefs,setTilePrefs]=useState(()=>normalizeTilePrefs(storage.get('startTilePrefs')));
  useEffect(()=>{setTilePrefs(normalizeTilePrefs(storage.get('startTilePrefs')));},[storageVersion]);

  // ── Phase 4o.autopromote.4 — Web Trend tab visibility into auto-promote ──
  // Compute the same auto-promoted tile selection mobile uses, so the Trend
  // tab can render a hollow amber star on tiles that would auto-fill the
  // Start screen even though the user hasn't manually pinned them. Gives
  // the user a single coherent picture of what shows on Start without
  // having to switch devices to check.
  const promoCtxWeb = useMemo(() => {
    // Phase 4r.utc.1 — was new Date().toISOString().slice(0,10) which
    // returns UTC date. Evening ET → tomorrow's date string → no
    // activities match → sessionType incorrectly stays 'rest'.
    const today = td();
    const todays = (activities || []).filter(a => (a.date || '').startsWith(today));
    let sessionType = 'rest';
    if (todays.length) {
      const hasRun = todays.some(isRunAct);
      const hasStrength = todays.some(isStrengthAct);
      const hasHIIT = todays.some(isHIITAct);
      if (hasRun && hasStrength) sessionType = 'mixed';
      else if (hasHIIT && hasStrength) sessionType = 'hyrox';
      else if (hasRun) sessionType = 'run';
      else if (hasStrength) sessionType = 'strength';
      else sessionType = 'mixed';
    }
    let activePrompts = [];
    try { activePrompts = getTopCoachingPrompts(5) || []; } catch {}
    return { sessionType, activePrompts, today, tileCtx, maxSlots: 4 };
  }, [storageVersion, activities, tileCtx]);

  const resolvedTilesWeb = useMemo(
    () => resolveAllStartTiles(tilePrefs, TILE_METRICS, promoCtxWeb),
    [tilePrefs, promoCtxWeb]
  );
  // Toggle a KRI's presence in the user's pinned list for its category.
  // Mirrors StartTilePicker's min-2/max-4 constraint logic in spirit; this
  // is the lightweight tap-to-toggle path (the picker still does final
  // validation when you save).
  const togglePin=useCallback((metric)=>{
    setTilePrefs(prev=>{
      const cat=metric.category;
      const cur=Array.isArray(prev?.[cat])?prev[cat]:[];
      const isPinned=cur.includes(metric.id);
      let next;
      if(isPinned){
        if(cur.length<=2){showToast?.('Need at least 2 pinned per category');return prev;}
        next={...prev,[cat]:cur.filter(id=>id!==metric.id)};
      }else{
        if(cur.length>=4){showToast?.('Max 4 pinned per category — unpin one first');return prev;}
        next={...prev,[cat]:[...cur,metric.id]};
      }
      try{
        storage.set('startTilePrefs',next,{skipValidation:true});
        console.info('[tilesync][web] togglePin saved', { cat, metric: metric.id, action: isPinned?'unpin':'pin', next: next[cat] });
      }catch(e){console.warn('[togglePin] save failed',e);}
      return next;
    });
  },[showToast]);
  // Layout map per category — hero row of foundational/cumulative tiles
  // sits at the top of each section, followed by balanced sub-bands. Hero
  // rows render with a stronger sub-band header + thicker post-hero
  // divider so the eye reads the cumulative metrics first, then drops into
  // the more granular bands. Cell count per sub-band sets the grid columns
  // explicitly so rows fill evenly (no "6 in one row, 2 in the next").
  const KRI_LAYOUT={
    run:[
      // INLINE hero — these render next to the section title (no tile
      // chrome, just dial-style stats). Cumulative volume + mechanical
      // cadence belong here because they apply across all run types.
      {inline:true,
        ids:['weeklyMiles','weeklyHours','cadence']},
      {label:'Easy / Aerobic',
        ids:['avgRunHR','paceHrRatio','aerobicDecoupling','aerobicTE','zone2Weekly']},
      {label:'Speed / Anaerobic',
        ids:['avgRunPower','maxRunHR','heartRateRecovery','anaerobicTE']},
      // Load/Forecast expanded to 4 KRIs — was previously 2 wide tiles.
      // ACWR (load risk), Long Run (peak weekly distance), Weekly Load
      // (TE sum), Race Predictor (forecast).
      {label:'Load / Forecast',
        ids:['acwr','longRun','weeklyLoad','racePredictor']},
    ],
    strength:[
      {label:'Intensity',
        ids:['epoc','avgStrengthHR','peakStrengthHR','activeStrengthCal']},
      {label:'Session',
        ids:['workRestRatio','sessionDuration','preTrainingCarbs','postTrainingProtein']},
    ],
    recovery:[
      {label:'Sleep',
        ids:['overnightHRV','sleepScore','sleepRegularity','recoveryHours']},
      {label:'State',
        ids:['rhr','morningBodyBattery','dailyStress','trainingReadiness']},
    ],
    body:[
      // INLINE hero — composition stats next to "Body" label. Same
      // dial-style as Run.
      {inline:true,
        ids:['weightTrend','bodyFatPct','leanMass','bmi']},
      {label:'Fuel',
        ids:['totalCal','protein','carbs','fat']},
      {label:'Quality',
        ids:['fiber','sodium','micronutrientScore','rmr']},
    ],
  };

  const panelStyle={background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:'14px 16px'};
  // Inner sub-panels live inside section wrappers — bg-elevated lifts them
  // off the section's bg-surface; no border to avoid card-in-card nesting.
  const innerPanelStyle={background:'var(--bg-elevated)',borderRadius:'var(--radius-md)',padding:'14px 16px'};
  // Section wrapper — each timeframe (This Week / Last 8 Weeks / YTD) is one
  // container; header lives inside as first child so there's no floating gap.
  const sectionStyle={background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:'var(--radius-md)',padding:'clamp(14px,1.4vw,18px)',marginTop:'clamp(10px,1vw,14px)'};
  const sectionHdr={fontSize:10,fontWeight:600,letterSpacing:'0.12em',textTransform:'uppercase',color:C.m,marginBottom:14};
  const divider={height:'0.5px',background:C.bs,margin:'10px 0'};
  const subHdr={fontSize:9,fontWeight:500,letterSpacing:'0.07em',color:C.m,textTransform:'uppercase',marginBottom:8};

  return(
    <div style={S.sec}>

      {/* ── Cockpit · WoW values + 8-week sparkline trend ──
          Headline = THIS WEEK (Mon-Sun current). Sparkline = 8-week trend.
          Consistent timeframe across all 7 tiles.

          Carry-forward (Phase 4o.trend.1): on Monday morning the new ISO
          week is empty until samples land. Each gauge below picks live
          this-week first, then falls back to last-week's value with an
          isFallback flag so the gauge renders dimmed + tagged "last wk"
          instead of going dark. ── */}
      {(() => {
        const thisWeek = weeklyStatsTrend[7] || {};   // current week is index 7 of 8-week array
        const lastWeek = weeklyStatsTrend[6] || {};   // previous week — fallback source
        const milesHist     = weeklyStatsTrend.map(w => w.mi || 0);
        const hoursHist     = weeklyStatsTrend.map(w => w.hrs || 0);
        const hrvHist       = weeklyStatsTrend.map(w => w.hrv).filter(Boolean);
        const rhrHist       = weeklyStatsTrend.map(w => w.rhr).filter(Boolean);
        const sleepScoreHist= weeklyStatsTrend.map(w => w.sleepScore).filter(Boolean);
        // This-week's avg run HR (uses Dashboard's existing this-week avgHR var)
        const avgHrHist     = yearRuns2.slice(-8).map(r => r.avgHR || null).filter(Boolean);
        // This-week's avg daily protein (uses Dashboard's existing avgProtein var)
        const proteinHist   = nutrition.slice(0, 8).map(n => n.protein || null).reverse().filter(Boolean);
        const G = getGoals();
        // Helper: live value if non-null/non-zero, otherwise fall back to
        // last week and flag it. Volume metrics (miles, hours) treat 0 as
        // "no activity" and fall back; rate metrics (HR, RHR, HRV, sleep,
        // protein) only fall back when null because 0 is meaningful.
        const cf = (live, fallback, opts = {}) => {
          const treatZeroAsEmpty = opts.zeroIsEmpty;
          const liveEmpty = live == null || (treatZeroAsEmpty && live === 0);
          if (!liveEmpty)               return { value: live, isFallback: false };
          if (fallback == null)         return { value: null, isFallback: false };
          if (treatZeroAsEmpty && fallback === 0) return { value: null, isFallback: false };
          return { value: fallback, isFallback: true };
        };
        const miles   = cf(Number((thisWeek.mi || 0).toFixed(1)),   Number((lastWeek.mi  || 0).toFixed(1)),  { zeroIsEmpty: true });
        const hours   = cf(Number((thisWeek.hrs || 0).toFixed(1)),  Number((lastWeek.hrs || 0).toFixed(1)),  { zeroIsEmpty: true });
        const runHR   = cf(avgHR || null,            lastAvgHR || null);
        // ── Recovery metrics use the LATEST single reading, not the
        //    weekly aggregate (Phase 4o.trend.2). RHR/HRV/Sleep come from
        //    nightly sleep tracking — they exist whether or not you
        //    trained, and the most recent night is the relevant signal.
        //    Never fall back to "last wk" styling for these. ──
        const sleepSorted = [...(sleepData || [])].sort((a, b) => (b?.date || '').localeCompare(a?.date || ''));
        const latestSleep = sleepSorted[0] || null;
        const latestRHR     = latestSleep?.restingHR ?? null;
        const latestHRVval  = latestSleep?.overnightHRV ?? ((hrvData || [])[0]?.overnightHRV ?? null);
        const latestSleepSc = latestSleep?.sleepScore != null ? Math.min(latestSleep.sleepScore, 100) : null;
        const rhr     = { value: latestRHR,     isFallback: false };
        const hrv     = { value: latestHRVval,  isFallback: false };
        const sleepSc = { value: latestSleepSc, isFallback: false };
        const proteinLive = avgProtein ? Math.round(avgProtein) : null;
        const proteinPrev = lastWeekNut.length ? Math.round(avg2(lastWeekNut, 'protein')) : null;
        const protein = cf(proteinLive, proteinPrev);
        return <CockpitRail gauges={[
          { label: 'Miles',   value: miles.value,   isFallback: miles.isFallback,   unit: 'mi',   goal: G.weeklyRunDistanceTarget, history: milesHist,      color: '#60a5fa' },
          { label: 'Hours',   value: hours.value,   isFallback: hours.isFallback,   unit: 'hrs',  goal: G.weeklyTimeTargetHrs,     history: hoursHist,      color: '#a78bfa' },
          { label: 'Run HR',  value: runHR.value,   isFallback: runHR.isFallback,   unit: 'bpm',  goal: G.targetAvgRunHR,  invert: true, history: avgHrHist,  color: '#fbbf24' },
          { label: 'RHR',     value: rhr.value,     isFallback: rhr.isFallback,     unit: 'bpm',  goal: G.targetRHR,       invert: true, history: rhrHist,    color: '#f59e0b' },
          { label: 'HRV',     value: hrv.value,     isFallback: hrv.isFallback,     unit: 'ms',   goal: G.targetHRV,                   history: hrvHist,    color: '#34d399' },
          { label: 'Sleep',   value: sleepSc.value, isFallback: sleepSc.isFallback, unit: '/100', goal: G.targetSleepScore,            history: sleepScoreHist, color: '#22d3ee' },
          { label: 'Protein', value: protein.value, isFallback: protein.isFallback, unit: 'g',    goal: G.dailyProteinTarget,          history: proteinHist, color: '#f472b6' },
        ]}/>;
      })()}

      {/* ── KRI SPACESHIP · 4-area Trend matrix (Phase 4m.2) ─────────────
          Run / Activity / Recovery / Body — each a section with its full
          KRI roster. Every tile shows week / 8-wk trailing / YTD with trend
          arrows, and tap-to-pin toggles "on Start cockpit" for that
          category. This is the new primary view; THIS WEEK and YEAR TO
          DATE below stay temporarily for parity until user confirms.
          ──────────────────────────────────────────────────────────────── */}
      {(() => {
        const CATEGORY_META={
          run:      {label:'Run',      color:'#60a5fa'},
          strength: {label:'Activity', color:'#a78bfa'},
          recovery: {label:'Recovery', color:'#22d3ee'},
          body:     {label:'Body',     color:'#fbbf24'},
        };
        // Sub-band header style — hero rows get a stronger treatment so
        // the foundational tiles read as "the headline" of the section.
        const subBandHero=(catColor)=>({
          display:'flex',alignItems:'baseline',gap:8,
          borderBottom:`1px solid ${catColor}55`,    // thicker line, more saturated
          paddingBottom:6,marginBottom:10,marginTop:8,
        });
        const subBandRegular=(catColor)=>({
          display:'flex',alignItems:'baseline',gap:8,
          borderBottom:`0.5px solid ${catColor}33`,
          paddingBottom:5,marginBottom:8,marginTop:16,
        });
        const subHdrLabel=(isHero)=>({
          fontSize:isHero?12:11,fontWeight:600,
          color:isHero?'var(--text-primary)':'var(--text-secondary, var(--text-primary))',
          letterSpacing:'0.10em',textTransform:'uppercase',
        });
        const subHdrCount={fontSize:9,color:'var(--text-muted)',letterSpacing:'0.04em'};
        const _byId=Object.fromEntries(TILE_METRICS.map(m=>[m.id,m]));

        const renderCategory=(catId)=>{
          const meta=CATEGORY_META[catId];
          const groups=KRI_LAYOUT[catId]||[];
          const pinnedSet=new Set(tilePrefs?.[catId]||[]);
          // Phase 4o.autopromote.4 — separate set of IDs that the resolver
          // auto-promoted (i.e. would surface on Start despite no manual pin).
          // Reasons map lets the tile show a hover/long-press explanation.
          const resolvedForCat=resolvedTilesWeb?.[catId]||[];
          const autoPromotedSet=new Set();
          const autoReasonsById={};
          for(const e of resolvedForCat){
            if(e.source==='auto'){
              autoPromotedSet.add(e.id);
              autoReasonsById[e.id]=e.reasons||[];
            }
          }
          const colsFor=(count)=>Math.min(Math.max(count,1),5);
          // Pull the inline hero group out (if any) — it renders alongside
          // the section title rather than as a tile band below.
          const inlineHero=groups.find(g=>g.inline);
          const tileBands=groups.filter(g=>!g.inline);
          // Helper that builds tf + status for any metric id.
          const metricFor=(id)=>{
            const m=_byId[id];
            const baseMetric=m||{id,label:id.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()),category:catId,unit:'',polarity:'higher-better'};
            // Some metrics (e.g. Race Predictor) compute their label from
            // ctx (next race distance). Apply labelFor(ctx) override to
            // produce the runtime label.
            const dynamicLabel=baseMetric.labelFor?.(tileCtx);
            const metric=dynamicLabel?{...baseMetric,label:dynamicLabel}:baseMetric;
            let tf=null;
            try{tf=metric.timeframes?.(tileCtx)||null;}catch(e){console.warn(`[KRI] ${id} timeframes failed:`,e);}
            const status=tf?.week!=null?deriveStatus(tf.week, metric.thresholds):'neutral';
            // Optional per-metric formatter (e.g. Race Predictor → time string).
            const formatValue=metric.formatter||undefined;
            // Optional description line for context (e.g. Race Predictor →
            // "for RBC Brooklyn Half · May 16").
            const description=metric.descriptionFor?.(tileCtx)||undefined;
            return {metric, tf, status, formatValue, description};
          };
          return (
            <section key={catId} style={{...sectionStyle,borderLeft:`3px solid ${meta.color}`}}>
              {/* ── Section header row — title on the left, inline hero
                  stats inline next to it (chrome-less dial style), pin
                  hint on the right. ── */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:inlineHero?12:4,flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:24,flexWrap:'wrap',flex:1,minWidth:0}}>
                  <span style={{fontSize:13,fontWeight:600,color:meta.color,letterSpacing:'0.04em',whiteSpace:'nowrap'}}>{meta.label}</span>
                  {inlineHero && inlineHero.ids.map(id=>{
                    const {metric, tf, status, formatValue}=metricFor(id);
                    return (
                      <InlineKRIStat key={id} metric={metric} tf={tf} status={status}
                        formatValue={formatValue}
                        pinned={pinnedSet.has(id)}
                        autoPromoted={autoPromotedSet.has(id)}
                        autoReasons={autoReasonsById[id]}
                        onTogglePin={()=>togglePin(metric)}/>
                    );
                  })}
                </div>
                <span style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>tap a tile to pin to Start</span>
              </div>
              {/* Thin section-color divider under the inline hero — visual
                  separation between the headline stats and the detail bands. */}
              {inlineHero && <div style={{height:1,background:`${meta.color}33`,margin:'4px 0 10px'}}/>}
              {/* Detail tile bands. */}
              {tileBands.map((g,gi)=>{
                const cols=colsFor(g.ids.length);
                return (
                  <div key={gi}>
                    {g.label&&(
                      <div style={subBandRegular(meta.color)}>
                        <span style={subHdrLabel(false)}>{g.label}</span>
                        <span style={subHdrCount}>· {g.ids.length} {g.ids.length===1?'KRI':'KRIs'}</span>
                      </div>
                    )}
                    <div style={{
                      display:'grid',
                      gridTemplateColumns:`repeat(${cols}, minmax(0, 1fr))`,
                      gap:'clamp(6px,0.6vw,10px)',
                      marginLeft:g.label?6:0,
                    }}>
                      {g.ids.map(id=>{
                        const {metric, tf, status, formatValue, description}=metricFor(id);
                        return (
                          <KRITile key={id} metric={metric} tf={tf} status={status}
                            formatValue={formatValue}
                            description={description}
                            pinned={pinnedSet.has(id)}
                            autoPromoted={autoPromotedSet.has(id)}
                            autoReasons={autoReasonsById[id]}
                            onTogglePin={()=>togglePin(metric)}/>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        };
        return (
          <>
            {['run','strength','recovery','body'].map(renderCategory)}
          </>
        );
      })()}

      {/* THIS WEEK section removed (Phase 4m.2.10) — KRI Spaceship covers
          all of this in a more legible week/8-wk/YTD layout per tile. */}

      {/* LAST 8 WEEKS section removed (Phase 4m.2.10) — KRI Spaceship's
          per-tile sparklines and 8-wk avg numbers cover the same ground. */}

      {/* YEAR TO DATE section removed (Phase 4m.2.15) — Body & Fitness Live
          duplicates KRI Body Composition; Annual Progress + Next Races +
          Principles Score will get a new home elsewhere when we figure out
          where they fit best. */}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING STRESS PANEL (replaces 7-day trends + Recovery)
// ═══════════════════════════════════════════════════════════════════════════════

const ZONE_COLORS = {
  optimal:       '#4ade80',
  undertraining: '#60a5fa',
  overreaching:  '#fbbf24',
  danger:        '#f87171',
  no_data:       'var(--text-muted)',
};
const ZONE_LABELS = {
  optimal:       'Optimal',
  undertraining: 'Under-training',
  overreaching:  'Over-reaching',
  danger:        'Danger',
  no_data:       'No data',
};

function TrainingStressPanel({ todayStr, profile, panelStyle, notes, setNotes, ts, saveStatus, handleSave, S, hideNotes = false }) {
  // ── Rolling scores ──
  const rolling7 = useMemo(() => computeRolling7d(todayStr), [todayStr]);
  const rolling30 = useMemo(() => computeRolling30d(todayStr), [todayStr]);
  const daily = rolling7.todayScore || { score: 0, sessionType: 'rest', sessionMetric: null, domains: {}, factors: [] };

  // ── Per-session detail metrics (run / strength / hyrox) ──
  const ftpPace = profile?.functionalThresholdPace || '8:30';
  const bodyweight = parseFloat(profile?.targetWeight) || parseFloat(profile?.weight) || 175;

  const activities = useMemo(() => {
    const csvActs = (storage.get('activities') || []).filter(a => a.source !== 'health_connect');
    const dailyLogs = storage.get('dailyLogs') || [];
    // Iterate every FIT activity on each day (not just the legacy singular `fitData`).
    const fitActs = [];
    for (const l of dailyLogs) {
      if (!l?.date) continue;
      const fits = Array.isArray(l.fitActivities) && l.fitActivities.length
        ? l.fitActivities
        : (l.fitData ? [l.fitData] : []);
      for (const fd of fits) {
        if (fd) fitActs.push({ ...fd, date: l.date, source: 'daily_fit' });
      }
    }
    return [...csvActs, ...fitActs];
  }, [todayStr]);
  const todayActs = useMemo(() => activities.filter(a => a.date === todayStr), [activities, todayStr]);

  const runMetrics = useMemo(() => {
    const runs = todayActs.filter(isRunAct);
    if (!runs.length) return null;
    const best = runs.reduce((b, r) => (r.durationSecs || 0) > (b.durationSecs || 0) ? r : b, runs[0]);
    return computeRTSS({ durationSecs: best.durationSecs, avgPaceRaw: best.avgPaceRaw, avgHR: best.avgHeartRate || best.avgHR, ftpPace });
  }, [todayActs, ftpPace]);

  const strengthMetrics = useMemo(() => {
    const str = todayActs.filter(a => /strength|weight|gym|hyrox|circuit/i.test(a.activityType || a.activityName || ''));
    if (!str.length) return null;
    const templates = storage.get('strengthTemplates') || [];
    const act = str[0];
    const tpl = matchTemplate(act, templates);
    if (!tpl) return { type: 'no_template', duration: act.durationSecs };
    if (tpl.type === 'hyrox') return { type: 'hyrox', ...computeHyroxDensity(tpl, act.durationSecs, bodyweight), template: tpl };
    const ton = computeTonnage(tpl, null, bodyweight);
    return { type: 'strength', ...ton, density: computeDensity(ton.totalTonnage, act.durationSecs), durationSecs: act.durationSecs, template: tpl };
  }, [todayActs, bodyweight]);

  const acr = useMemo(() => computeAcuteChronicRatio(activities, todayStr, ftpPace), [activities, todayStr, ftpPace]);

  const hasRun = daily.sessionType === 'run' || daily.sessionType === 'mixed';
  const hasStrength = daily.sessionType === 'strength' || daily.sessionType === 'hyrox' || daily.sessionType === 'mixed';

  // ── Styles ──
  const pillStyle = (status) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500,
    background: status === 'good' ? 'rgba(74,222,128,0.12)' : status === 'warning' ? 'rgba(251,191,36,0.12)' : status === 'poor' ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.06)',
    color: status === 'good' ? '#4ade80' : status === 'warning' ? '#fbbf24' : status === 'poor' ? '#f87171' : 'var(--text-muted)',
  });
  const metricBox = { background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' };
  const metricVal = { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' };
  const metricLbl = { fontSize: 8, color: 'var(--text-muted)', marginTop: 2 };

  // ── Dynamic title ──
  const scoreSuffix = daily.sessionMetric
    ? ` (${daily.sessionMetric.label} ${daily.sessionMetric.value})`
    : '';

  const scoreColor = (s) => s >= 70 ? '#4ade80' : s >= 45 ? '#fbbf24' : '#f87171';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: hideNotes ? '1fr' : '2fr 1fr', gap: 12 }}>

      {/* ── Score + Training Detail ── */}
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Score{scoreSuffix}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{todayStr}</span>
        </div>

        {/* ── Dual rings + domain breakdown + factor pills ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          {/* Moon ring — 30-day average */}
          <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
            <svg width="38" height="38" viewBox="0 0 38 38">
              <circle cx="19" cy="19" r="15" fill="none" stroke="var(--bg-elevated)" strokeWidth="3.5" />
              <circle cx="19" cy="19" r="15" fill="none"
                stroke={scoreColor(rolling30.score)}
                strokeWidth="3.5" strokeLinecap="round"
                strokeDasharray={`${(rolling30.score / 100) * 94.2} 94.2`}
                transform="rotate(-90 19 19)" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{rolling30.score}</span>
              <span style={{ fontSize: 6, color: 'var(--text-muted)' }}>30d</span>
            </div>
          </div>

          {/* Main ring — 7-day weighted */}
          <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
            <svg width="56" height="56" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="24" fill="none" stroke="var(--bg-elevated)" strokeWidth="5" />
              <circle cx="28" cy="28" r="24" fill="none"
                stroke={scoreColor(rolling7.score)}
                strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${(rolling7.score / 100) * 150.8} 150.8`}
                transform="rotate(-90 28 28)" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{rolling7.score}</span>
              <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>7d</span>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            {/* Domain sub-scores (today) */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
              {[['Activity', daily.domains?.activity], ['Nutrition', daily.domains?.nutrition], ['Body', daily.domains?.body]].map(([lbl, val]) => (
                val != null && <div key={lbl} style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  <span style={{ color: scoreColor(val), fontWeight: 600 }}>{val}</span> {lbl}
                </div>
              ))}
            </div>
            {/* Factor pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(daily.factors || []).map((f, i) => (
                <span key={i} style={pillStyle(f.status)}>
                  {f.label}: {f.value}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Run detail metrics ── */}
        {hasRun && runMetrics && runMetrics.rTSS && (
          <>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Run</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
              <div style={metricBox}><div style={metricVal}>{runMetrics.rTSS}</div><div style={metricLbl}>rTSS</div></div>
              <div style={metricBox}><div style={metricVal}>{runMetrics.ngpPace || '--'}</div><div style={metricLbl}>NGP</div></div>
              <div style={metricBox}><div style={metricVal}>{runMetrics.intensityFactor ?? '--'}</div><div style={metricLbl}>IF</div></div>
              <div style={metricBox}><div style={metricVal}>{runMetrics.efficiencyFactor ?? '--'}</div><div style={metricLbl}>EF</div></div>
            </div>
          </>
        )}

        {/* ── Strength / Hyrox detail metrics ── */}
        {hasStrength && strengthMetrics && strengthMetrics.type !== 'no_template' && (
          <>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {strengthMetrics.type === 'hyrox' ? 'Hyrox' : 'Strength'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
              <div style={metricBox}>
                <div style={metricVal}>{(strengthMetrics.totalTonnage || strengthMetrics.tonnage || 0).toLocaleString()}</div>
                <div style={metricLbl}>Tonnage (lbs)</div>
              </div>
              <div style={metricBox}>
                <div style={metricVal}>{strengthMetrics.density ?? '--'}</div>
                <div style={metricLbl}>Density (lbs/min)</div>
              </div>
              <div style={metricBox}>
                <div style={metricVal}>{strengthMetrics.durationMin ? `${strengthMetrics.durationMin}` : strengthMetrics.durationSecs ? `${Math.round(strengthMetrics.durationSecs / 60)}` : '--'}</div>
                <div style={metricLbl}>Duration (min)</div>
              </div>
            </div>
            {strengthMetrics.exercises?.length > 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {strengthMetrics.exercises.map((ex, i) => (
                  <span key={i}>{ex.name} {ex.tonnage.toLocaleString()}lbs{i < strengthMetrics.exercises.length - 1 ? ' · ' : ''}</span>
                ))}
              </div>
            )}
          </>
        )}

        {hasStrength && strengthMetrics && strengthMetrics.type === 'no_template' && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '8px 0' }}>
            Strength session detected ({strengthMetrics.duration ? `${Math.round(strengthMetrics.duration / 60)} min` : '--'}). Upload a template to see tonnage breakdown.
          </div>
        )}

        {/* ── A:C load ratio bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: hasRun || hasStrength ? 8 : 0, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Acute:Chronic Load</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: ZONE_COLORS[acr.zone] }}>{acr.ratio ?? '--'}</span>
              <span style={{ fontSize: 9, color: ZONE_COLORS[acr.zone] }}>{ZONE_LABELS[acr.zone]}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <div>7d: {acr.acuteLoad} TSS</div>
            <div>28d avg: {acr.chronicLoad} TSS/wk</div>
          </div>
        </div>

        {daily.sessionType === 'rest' && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 0 4px', textAlign: 'center' }}>
            No activity logged today — rest day or upload pending
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      {!hideNotes && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Notes</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{ts}</span>
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="How did today feel? Energy, mood, reflection..."
            style={{ ...S.ta, minHeight: 70, marginBottom: 8 }} />
          <button style={{ ...S.sb, padding: '10px 14px', width: '100%' }} onClick={handleSave}>
            {saveStatus === 'saved' ? '\u2713 Saved' : 'Save daily entry'}
          </button>
        </div>
      )}

    </div>
  );
}

// ─── Race Prep Banner ─────────────────────────────────────────────────────
// Phase 4r.race.9 — Fuel-tab landing for the race card's "Plan items in
// Fuel" link. Compact strip that shows when a race is in the next 21 days.
// Tap → expands into a textarea + a structured-items mini-list, persisted
// to localStorage per race key.
function RacePrepBanner({ race, daysLeft }) {
  const raceKey = race?.id || `${race?.name || ''}|${race?.date || ''}`;
  const notesKey = `arnold:race-fuel-notes:${raceKey}`;
  const itemsKey = `arnold:race-custom-fuel:${raceKey}`;
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newWhen, setNewWhen] = useState('during');

  useEffect(() => {
    try {
      const n = localStorage.getItem(notesKey) || '';
      setNotes(n);
      const i = JSON.parse(localStorage.getItem(itemsKey) || '[]');
      if (Array.isArray(i)) setItems(i);
    } catch {}
  }, [notesKey, itemsKey]);
  useEffect(() => {
    try {
      if (notes && notes.trim()) localStorage.setItem(notesKey, notes);
      else localStorage.removeItem(notesKey);
    } catch {}
  }, [notesKey, notes]);
  useEffect(() => {
    try {
      if (items.length) localStorage.setItem(itemsKey, JSON.stringify(items));
      else localStorage.removeItem(itemsKey);
    } catch {}
  }, [itemsKey, items]);

  const accent = '#fbbf24';
  const addItem = () => {
    if (!newName.trim()) return;
    setItems(prev => [...prev, { when: newWhen, name: newName.trim(), qty: newQty.trim() || '1' }]);
    setNewName(''); setNewQty('');
  };
  const removeItem = (i) => setItems(prev => prev.filter((_, j) => j !== i));

  return (
    <div style={{
      position: 'relative',
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      // Phase 4r.viz.16 — dramatically tighter vertical padding (1px) +
      // smaller title font (13→11) to drop strip height.
      padding: open ? '8px 12px 10px 14px' : '1px 10px 1px 12px',
      marginBottom: 10,
      width: '100%',
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* Phase 4r.viz.12 — same checkered flag stripe as the Play race
          card for visual consistency across both surfaces. */}
      <span style={{
        position: 'absolute',
        left: 0, top: 0, bottom: 0, width: 6,
        backgroundImage: 'conic-gradient(#111 25%, #fff 0 50%, #111 0 75%, #fff 0)',
        backgroundSize: '6px 6px',
        backgroundRepeat: 'repeat',
      }}/>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{all:'unset',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',gap:8,lineHeight:1.15}}>
        <span style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
          <span style={{fontSize:11,fontWeight:500,color:'var(--text-primary)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            ⚑ {(race.name || 'race').replace(/\s*\([^)]*\)\s*$/, '')}
          </span>
          <span style={{fontSize:10,color:accent,fontFamily:'var(--font-mono)',flexShrink:0}}>{daysLeft}d</span>
          <span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0}}>race prep</span>
        </span>
        <span style={{fontFamily:'var(--font-mono)',color:'var(--text-muted)',fontSize:11,flexShrink:0}}>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:10}}>
          {/* Structured items list */}
          {items.length > 0 && (
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {items.map((it, i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,padding:'4px 6px',background:'var(--bg-elevated)',borderRadius:4}}>
                  <span style={{
                    fontFamily:'var(--font-mono)',fontSize:10,
                    color: it.when === 'pre' ? '#fb923c' : '#22d3ee',
                    minWidth:42,textTransform:'uppercase',letterSpacing:'0.04em',
                  }}>{it.when}</span>
                  <span style={{flex:1,color:'var(--text-primary)'}}>{it.name}</span>
                  <span style={{color:'var(--text-muted)',fontFamily:'var(--font-mono)',fontSize:11}}>{it.qty}</span>
                  <button onClick={() => removeItem(i)}
                    style={{all:'unset',cursor:'pointer',color:'var(--text-muted)',padding:'2px 4px',fontSize:13}}>×</button>
                </div>
              ))}
            </div>
          )}
          {/* Add row */}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <select value={newWhen} onChange={e => setNewWhen(e.target.value)}
              style={{fontSize:11,padding:'4px 6px',background:'var(--bg-input)',color:'var(--text-primary)',border:'0.5px solid var(--border-default)',borderRadius:4}}>
              <option value="pre">pre</option>
              <option value="during">during</option>
            </select>
            <input type="text" placeholder="e.g. Maurten 100 gel" value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              style={{flex:1,minWidth:100,fontSize:12,padding:'5px 7px',background:'var(--bg-input)',color:'var(--text-primary)',border:'0.5px solid var(--border-default)',borderRadius:4,outline:'none'}}/>
            <input type="text" placeholder="qty" value={newQty}
              onChange={e => setNewQty(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              style={{width:50,fontSize:12,padding:'5px 7px',background:'var(--bg-input)',color:'var(--text-primary)',border:'0.5px solid var(--border-default)',borderRadius:4,outline:'none',fontFamily:'var(--font-mono)'}}/>
            <button type="button" onClick={addItem}
              style={{all:'unset',cursor:'pointer',padding:'5px 10px',fontSize:12,fontWeight:500,color:'#0b0f14',background:accent,borderRadius:4}}>Add</button>
          </div>
          {/* Free-form notes */}
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Free-form notes — race-morning checklist, drop-bag contents, anything you want to remember…"
            style={{
              width:'100%',minHeight:60,resize:'vertical',
              fontSize:12,padding:'6px 8px',
              background:'var(--bg-input)',color:'var(--text-primary)',
              border:'0.5px solid var(--border-default)',borderRadius:4,
              outline:'none',fontFamily:'var(--font-sans)',lineHeight:1.4,
              boxSizing:'border-box',
            }}/>
          <div style={{fontSize:10,color:'var(--text-muted)',lineHeight:1.4}}>
            Saved per-race. Pre-race carbs + post-race recovery already auto-computed in the race tile.
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOG TODAY + WORKOUT LOG
// ═══════════════════════════════════════════════════════════════════════════════
function LogDay({data,persist,showToast,mobileView,setTab}){
  // Subscribe to global storage version so cloud-synced data (HC daily
  // energy from the phone, Cronometer worker pulls, Garmin worker pulls)
  // refreshes Today's Movement and other read-only sections live on
  // desktop without a manual reload. (Phase 4o.daily.9 fix.)
  const storageVersion = useStorageVersion();
  const ts=td(),ex=data.logs.find(l=>l.date===ts);
  const[notes,setNotes]=useState(ex?.notes||"");
  // todayFITs holds ALL of today's uploaded FIT activities (multiple per day allowed).
  // Legacy `todayFIT` = latest upload, derived below for any call sites expecting a single activity.
  const[todayFITs,setTodayFITs]=useState([]);
  const todayFIT=todayFITs.length?todayFITs[todayFITs.length-1]:null;
  const[todayNutrition,setTodayNutrition]=useState(null);
  const[fitFilename,setFitFilename]=useState(null);
  const[nutFilename,setNutFilename]=useState(null);
  const[fitError,setFitError]=useState(null);
  const[nutError,setNutError]=useState(null);
  const[nutUploadKey,setNutUploadKey]=useState(0);
  const[saveStatus,setSaveStatus]=useState(null);
  const[todayLoaded,setTodayLoaded]=useState(false);
  // Split-view toggle: false = smart grouping (hard sessions solo, easy runs
  // aggregate, strength aggregates), true = every activity gets its own card.
  const[splitView,setSplitView]=useState(false);
  const fitRef=useRef();
  const nutRef=useRef();
  const profile={...(storage.get('profile')||{}),...getGoals()};

  // Load today's saved entry on mount.
  // RULE: the Daily dashboard shows activity & nutrition ONLY for today. If the
  // latest upload is from a prior day, the dashboard stays empty until a new
  // upload happens today. Notes still load if present so reflections persist.
  useEffect(()=>{
    const today=td();
    try{
      const logs=storage.get('dailyLogs')||[];
      const todayEntry=logs.find(e=>e.date===today);
      if(todayEntry){
        // Prefer the new `fitActivities` array; fall back to legacy singular `fitData`
        const rawFits=Array.isArray(todayEntry.fitActivities)&&todayEntry.fitActivities.length
          ?todayEntry.fitActivities
          :(todayEntry.fitData?[todayEntry.fitData]:[]);
        const fitsToday=rawFits.filter(f=>f&&(!f.date||f.date===today));
        const nutIsToday=todayEntry.nutData&&(!todayEntry.nutData.date||todayEntry.nutData.date===today);
        setTodayFITs(fitsToday);
        if(nutIsToday)setTodayNutrition(todayEntry.nutData);else setTodayNutrition(null);
        if(todayEntry.notes)setNotes(todayEntry.notes);
        setTodayLoaded(!!(fitsToday.length||nutIsToday||todayEntry.notes));
      }else{
        // New day with no entry yet — ensure a clean slate
        setTodayFITs([]);setTodayNutrition(null);
      }
    }catch(e){console.error('Failed to load daily log:',e);}
  },[]);

  // Auto-persist FIT / nutrition data the moment it parses (so unsaved data isn't lost).
  // `fitActivities` is the authoritative array; `fitData` mirrors the latest upload so any
  // legacy consumer that still reads the singular field keeps working.
  useEffect(()=>{
    if(!todayFITs.length&&!todayNutrition)return;
    const today=td();
    const existing=storage.get('dailyLogs')||[];
    const todayEntry=existing.find(e=>e.date===today)||{date:today,notes:''};
    const mergedFits=todayFITs.length
      ?todayFITs
      :(Array.isArray(todayEntry.fitActivities)?todayEntry.fitActivities:(todayEntry.fitData?[todayEntry.fitData]:[]));
    const latestFit=mergedFits.length?mergedFits[mergedFits.length-1]:(todayEntry.fitData||null);
    const updated={
      ...todayEntry,
      fitActivities:mergedFits,
      fitData:latestFit,
      nutData:todayNutrition||todayEntry.nutData,
      savedAt:new Date().toISOString(),
    };
    const filtered=existing.filter(e=>e.date!==today);
    filtered.unshift(updated);
    storage.set('dailyLogs',filtered.slice(0,90),{skipValidation:true});
  },[todayFITs,todayNutrition]);

  // ── Manual sync handlers (Phase 4o.daily.3) ──
  // Garmin Worker + Cronometer Worker auto-pull on a schedule, but the user
  // wants a one-click way to force an immediate refresh from the Daily tab.
  const [syncFitState, setSyncFitState] = useState('idle'); // idle | syncing | done | error
  const [syncNutState, setSyncNutState] = useState('idle');
  // ── Garmin sync handler (Phase 4o.mobile.7) ──
  // Primary path: syncRecentActivities() — pulls fresh sessions from
  // the Garmin Worker, downloads each FIT zip, parses, dedupes by
  // activityId, and persists into the activities collection. This is
  // the same function the Cloud Sync panel uses.
  // Secondary path: pullFitsNow() — phone-paired relay fallback for
  // users without the Garmin Worker configured. Best-effort, never
  // throws; returns {ok:false, error:'not_paired'} silently when not set up.
  const handleGarminSync = useCallback(async () => {
    if (syncFitState === 'syncing') return;
    setSyncFitState('syncing');
    let added = 0, errorMsg = null, anyOk = false;
    try {
      const { syncRecentActivities } = await import('./core/garmin-activities-client.js');
      const r = await syncRecentActivities({ daysBack: 14, limit: 30 });
      if (r?.ok) {
        anyOk = true;
        added += r.added || (r.results || []).filter(x => x.ok).length || 0;
      } else if (r?.error && r.error !== 'not_configured') {
        errorMsg = r.error;
      }
    } catch (e) {
      console.warn('[handleGarminSync] Worker path failed:', e);
      errorMsg = e?.message || String(e);
    }
    // Fallback / additive: relay pull (phone-paired). Never overrides Worker.
    try {
      const r = await pullFitsNow();
      if (r?.ok) {
        anyOk = true;
        added += r.added || 0;
      }
    } catch (e) {
      console.warn('[handleGarminSync] Relay path failed (non-fatal):', e);
    }
    if (anyOk) {
      setSyncFitState('done');
      showToast?.(added > 0 ? `✓ Garmin sync — ${added} new` : '✓ Garmin sync — up to date');
      setTimeout(() => setSyncFitState('idle'), 2400);
    } else {
      setSyncFitState('error');
      showToast?.(`Garmin sync failed${errorMsg ? `: ${errorMsg}` : ' — Worker not configured. Open Settings → Cloud Sync.'}`);
      setTimeout(() => setSyncFitState('idle'), 4000);
    }
  }, [syncFitState, showToast]);
  const handleCronoSync = useCallback(async () => {
    if (syncNutState === 'syncing') return;
    setSyncNutState('syncing');
    try {
      const { fetchCronometerToday } = await import('./core/cronometer-client.js');
      await fetchCronometerToday();
      setSyncNutState('done');
      showToast?.('✓ Cronometer sync complete');
      setNutUploadKey(k => k + 1); // force NutritionInputPanel to refresh
      setTimeout(() => setSyncNutState('idle'), 2400);
    } catch (e) {
      console.warn('[handleCronoSync] failed:', e);
      setSyncNutState('error');
      showToast?.(`Cronometer sync failed: ${e?.message || e}`);
      setTimeout(() => setSyncNutState('idle'), 4000);
    }
  }, [syncNutState, showToast]);

  const handleSave=()=>{
    const today=td();
    const latestFit=todayFITs.length?todayFITs[todayFITs.length-1]:null;
    const entry={
      date:today,
      savedAt:new Date().toISOString(),
      notes,
      fitActivities:todayFITs,
      fitData:latestFit,
      nutData:todayNutrition||null,
    };
    const existing=storage.get('dailyLogs')||[];
    const updated=existing.filter(e=>e.date!==today);
    updated.unshift(entry);
    const trimmed=updated.slice(0,90);
    storage.set('dailyLogs',trimmed,{skipValidation:true});
    // Also call legacy save() for backward compat with data.logs
    save();
    setSaveStatus('saved');
    setTimeout(()=>setSaveStatus(null),3000);
  };

  const handleTodayFIT=async file=>{
    if(!file)return;
    setFitError(null);
    try{
      // Phase 4r.zones.3 — pass cached bpm zone boundaries so the parser
      // bins raw HR records against the user's custom Connect zones
      // rather than trusting the watch-computed time-in-zone fields.
      const _profile=storage.get('profile')||{};
      const _zb=_profile?.hrZoneBpm;
      const _zoneBpm=(_zb&&Number.isFinite(+_zb.z1Max)&&Number.isFinite(+_zb.z2Max)&&Number.isFinite(+_zb.z3Max)&&Number.isFinite(+_zb.z4Max))
        ?{z1Max:+_zb.z1Max,z2Max:+_zb.z2Max,z3Max:+_zb.z3Max,z4Max:+_zb.z4Max}:null;
      const parsed=await parseFITFile(file,{zoneBpm:_zoneBpm});
      // Stamp the source so fit-relay merge can dedup by filename across devices,
      // and so the local UI can identify "where did this activity come from".
      if(!parsed.source||typeof parsed.source!=='object'){
        parsed.source={type:'fit',filename:file.name};
      }else if(!parsed.source.filename){
        parsed.source.filename=file.name;
      }
      // APPEND rather than replace — two FIT uploads on the same day are both kept.
      // Dedup on a composite key so re-uploading the same file doesn't double-count.
      const fitKey=f=>`${f.date||''}|${f.activityType||''}|${f.startTime||f.time||''}|${f.durationSecs||f.durationMins||''}`;
      setTodayFITs(prev=>{
        const already=prev.some(f=>fitKey(f)===fitKey(parsed));
        return already?prev:[...prev,parsed];
      });
      setFitFilename(file.name);
      showToast(`✓ FIT parsed — ${parsed.activityType}`);
      // Phase 4b: push to FIT relay so paired devices can pull this directly,
      // independent of the encrypted-blob cloud-sync (which has been the failure
      // point for cross-device FIT propagation). Fire-and-forget — local save
      // is the source of truth, relay is best-effort transport.
      try{
        const pushRes=await pushFitToRelay(parsed.date||td(),file.name,parsed);
        if(pushRes.ok){
          console.log(`[fit-relay] pushed ${file.name} (${pushRes.bytes} bytes) for ${parsed.date}`);
        }else if(pushRes.error!=='not_paired'){
          console.warn('[fit-relay] push failed (non-fatal):',pushRes.error);
        }
      }catch(e){console.warn('[fit-relay] push threw (non-fatal):',e?.message||e);}
    }catch(e){setFitError(`Could not read FIT file: ${e.message}`);}
  };
  const handleTodayNut=async file=>{
    if(!file)return;
    setNutError(null);
    try{
      const text=await file.text();
      const parsed=parseTodayNutrition(text);
      if(!parsed)throw new Error('No nutrition data found');

      // ── Bridge Cronometer CSV into the nutritionLog so NutritionInput picks it up.
      // Remove any previous cronometer-sourced entries for this date, then insert fresh.
      const dateStr=parsed.date||todayStr;
      const existing=getNutEntries(dateStr);
      existing.filter(e=>e.source==='cronometer').forEach(e=>deleteNutEntry(e.id));

      const entry=createNutEntry({
        name:'Cronometer Daily Summary',
        date:dateStr,
        meal:'full-day',
        source:'cronometer',
        servings:1,
        macros:{
          calories:parsed.calories||0,
          protein:parsed.protein||0,
          carbs:parsed.carbs||0,
          fat:parsed.fat||0,
          fiber:parsed.fiber||0,
          sugar:parsed.sugar||0,
          water:(parsed.water||0)*1000, // stored as ml in nutritionLog
        },
      });
      saveNutEntry(entry);

      // Also write to legacy 'cronometer' storage key (for 7-day trends, weekly tab, etc.)
      const cronoAll=storage.get('cronometer')||[];
      const cronoFiltered=cronoAll.filter(c=>c.date!==dateStr);
      cronoFiltered.unshift({...parsed,date:dateStr,source:'cronometer-daily'});
      storage.set('cronometer',cronoFiltered.slice(0,365),{skipValidation:true});

      setTodayNutrition(parsed);
      setNutFilename(file.name);
      setNutUploadKey(k=>k+1); // force NutritionInput to re-read from storage
      showToast(`✓ Nutrition parsed — ${parsed.calories} kcal`);
    }catch(e){setNutError(`Could not read CSV: ${e.message}`);}
  };

  const save=async()=>{
    const cl={date:ts};
    if(notes)cl.notes=notes;
    if(fitFilename)cl.fitFile=fitFilename;
    if(nutFilename)cl.nutritionFile=nutFilename;
    if(todayFIT){
      cl.workout=todayFIT.activityType;
      if(todayFIT.distanceMi)cl.distanceMi=todayFIT.distanceMi;
      if(todayFIT.durationMins)cl.workoutDuration=String(todayFIT.durationMins);
      if(todayFIT.calories)cl.activeCalories=todayFIT.calories;
    }
    if(todayNutrition){
      cl.calories=String(todayNutrition.calories||"");
      cl.protein=String(todayNutrition.protein||"");
      cl.carbs=String(todayNutrition.carbs||"");
      cl.fat=String(todayNutrition.fat||"");
    }
    await persist({...data,logs:[cl,...data.logs.filter(l=>l.date!==ts)]});
    showToast("✓ Daily entry saved");
  };

  // Slim pill upload tile
  const UploadPill=({label,sub,accept,onFile,inputRef,loaded,filename,error})=>(
    <div
      onDragOver={e=>e.preventDefault()}
      onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)onFile(file);}}
      onClick={()=>inputRef.current?.click()}
      style={{
        display:'flex',alignItems:'center',gap:10,padding:'8px 14px',marginBottom:8,
        background:'var(--bg-surface)',
        border:`0.5px solid ${loaded?'var(--accent-border)':'var(--border-default)'}`,
        borderRadius:'var(--radius-md)',cursor:'pointer',transition:'border-color 0.15s',
      }}>
      <input ref={inputRef} type="file" accept={accept} style={{display:"none"}}
        onChange={e=>{const file=e.target.files[0];if(file)onFile(file);e.target.value="";}}/>
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{flexShrink:0}}>
        <path d="M6.5 1v7M3 4.5l3.5-3.5 3.5 3.5" stroke="var(--text-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M1 11h11" stroke="var(--text-muted)" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:500,color:'var(--text-primary)',lineHeight:1.2}}>{label}</div>
        <div style={{fontSize:10,color:'var(--text-muted)'}}>{sub}</div>
      </div>
      {loaded&&(
        <span style={{fontSize:10,color:'var(--text-accent)',display:'flex',alignItems:'center',gap:3,minWidth:0}}>
          <span>✓</span>
          <span style={{maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{filename}</span>
        </span>
      )}
      {error&&!loaded&&<span style={{fontSize:10,color:C.dn}}>{error}</span>}
    </div>
  );

  // Shared style constants — Phase 4o.mobile.9: tighter padding on
  // mobile so Strength + Nutrition cards open closer to their content
  // without losing breathing room on desktop.
  const panelStyle={background:'var(--bg-surface)',border:'0.5px solid var(--border-default)',borderRadius:'var(--radius-md)',padding: mobileView ? '10px 12px' : '14px 16px'};
  const divider={height:'0.5px',background:'var(--border-subtle)',margin:'10px 0'};
  const subHdr={fontSize:9,fontWeight:500,letterSpacing:'0.07em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:8};
  const miniTile={background:'var(--bg-elevated)',borderRadius:8,padding:'7px 8px',textAlign:'center',flex:1};
  const miniVal={fontSize:13,fontWeight:500,color:'var(--text-primary)',lineHeight:1.2};
  const miniLbl={fontSize:9,color:'var(--text-muted)',marginTop:2};

  // Phase 4r.viz.1 — Tabler-style outline icons rendered as inline SVG so we
  // don't take a dependency on @tabler/icons-react for a handful of glyphs.
  // Paths traced from the Tabler outline set (MIT). Each path assumes a 24x24
  // viewBox and renders at the size passed in.
  const ICON_PATHS = {
    route: 'M3 19h2a2 2 0 0 0 2 -2v-2a2 2 0 0 1 2 -2h6a2 2 0 0 0 2 -2v-2a2 2 0 0 1 2 -2h2 M3 5h2 M19 19h2',
    stopwatch: 'M9 3h6 M12 8v5l3 2 M12 21a8 8 0 1 0 0 -16 a8 8 0 0 0 0 16z',
    heartbeat: 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572 M3 13h2l2 -3l2 6l2 -4l2 3h6',
    shoe: 'M4 17h13a4 4 0 0 0 4 -4a1 1 0 0 0 -1 -1h-3l-3 -5l-4 1l-4 -2l-1 11z M16 8l-2 2 M5 12l-1 5',
    'wave-sine': 'M3 12c.6 -5.3 1.7 -8 3.3 -8c2.4 0 2.4 16 4.7 16s2.4 -16 4.7 -16c1.7 0 2.7 2.7 3.3 8',
    'clock-hour-4': 'M12 8v4l2 1 M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
    'heart-rate-monitor': 'M3 4h18v12h-18z M7 20h10 M9 16v4 M15 16v4 M7 10l2 -2l2 4l2 -6l2 4h2',
    mountain: 'M3 20l4.5 -8l3 4l3.5 -6l7 10z',
    flame: 'M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z',
    bolt: 'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11',
    'target-arrow': 'M12 21a9 9 0 1 1 0 -18a9 9 0 0 1 0 18z M12 17a5 5 0 1 1 0 -10a5 5 0 0 1 0 10z M12 13a1 1 0 1 1 0 -2a1 1 0 0 1 0 2',
    droplet: 'M12 3l5.5 8.5a6.5 6.5 0 1 1 -11 0z',
    bottle: 'M14 4a3 3 0 0 0 -4 0l0 3l-1.5 1.5a3 3 0 0 0 -0.5 1.5v9a2 2 0 0 0 2 2h4a2 2 0 0 0 2 -2v-9a3 3 0 0 0 -0.5 -1.5l-1.5 -1.5v-3z',
    hourglass: 'M6.5 7h11 M6.5 17h11 M6 20v-2a6 6 0 0 1 12 0v2 M6 4v2a6 6 0 0 0 12 0v-2 M5 4h14 M5 20h14',
    'arrow-up-right': 'M17 7l-10 10 M8 7h9v9',
    'arrow-right': 'M5 12h14 M13 18l6 -6 M13 6l6 6',
    'arrow-down-right': 'M7 7l10 10 M17 8v9h-9',
    // Phase 4r.viz.7 — discipline-specific glyphs.
    'barbell':   'M2 12h2 M20 12h2 M5 8v8 M19 8v8 M7 10v4 M17 10v4 M7 12h10',
    'repeat':    'M17 1l4 4 -4 4 M3 11v-1a4 4 0 0 1 4 -4h14 M7 23l-4 -4 4 -4 M21 13v1a4 4 0 0 1 -4 4h-14',
    'bike':      'M5 18a3 3 0 1 0 6 0 a3 3 0 0 0 -6 0 M19 18a3 3 0 1 0 6 0 a3 3 0 0 0 -6 0 M12 19l0 -4l-4 -3l5 -4l3 4h4',
    'gauge':     'M12 21a9 9 0 1 0 -9 -9 a9 9 0 0 0 9 9z M12 12l5 -3 M12 12l-3 3',
    'swim':      'M3 7c1 0 1.5 -1 3 -1s2 1 4 1s2 -1 4 -1s2 1 4 1s2.5 -1 3 -1 M3 12c1 0 1.5 -1 3 -1s2 1 4 1s2 -1 4 -1s2 1 4 1s2.5 -1 3 -1 M3 17c1 0 1.5 -1 3 -1s2 1 4 1s2 -1 4 -1s2 1 4 1s2.5 -1 3 -1',
    'walk':      'M13 4a1 1 0 1 0 2 0 a1 1 0 0 0 -2 0 M7 21l3 -4 M16 21l-2 -4l-3 -3l1 -6 M6 12l2 -3l4 -1l3 3l3 1',
    'lotus':     'M12 6a2 2 0 1 0 0 -4 a2 2 0 0 0 0 4 M12 8v10 M6 18c-2 -3 -3 -6 -1 -8c1 4 4 5 7 4 M18 18c2 -3 3 -6 1 -8c-1 4 -4 5 -7 4',
    'footprints':'M7 14a3 3 0 0 0 6 0v-3a3 3 0 0 0 -6 0z M11 9a3 3 0 0 0 6 0v-3a3 3 0 0 0 -6 0z M5 19l1 3 M19 19l1 3',
    'activity':  'M3 12h4l3 -8 l4 16 l3 -8 h4',
  };
  const TIcon = ({ name, size = 22, color = 'currentColor', style }) => {
    const d = ICON_PATHS[name];
    if (!d) return null;
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={style}>
        {d.split(' M ').map((seg, i) => (
          <path key={i} d={i === 0 ? seg : `M ${seg}`} />
        ))}
      </svg>
    );
  };

  // Phase 4r.viz.1 — trend chip. Compares the current value against the 30-day
  // same-activity-type median (HIIT vs HIIT, easy vs easy). `direction` is
  // 'lower-better' for pace + vert osc (smaller is improving) and
  // 'higher-better' for cadence + aerobic TE. HR uses 'lower-better' (lower
  // HR at same effort = efficiency gain).
  const computeTrend = (currentVal, baselineVal, direction = 'lower-better') => {
    if (currentVal == null || baselineVal == null || !Number.isFinite(currentVal) || !Number.isFinite(baselineVal)) return null;
    const delta = (currentVal - baselineVal) / baselineVal;
    const threshold = 0.03; // ±3%
    if (Math.abs(delta) < threshold) return 'flat';
    const better = direction === 'lower-better' ? delta < 0 : delta > 0;
    return better ? 'good' : 'bad';
  };
  const sameTypeBaseline = (acts, currentRow, field, daysBack = 30) => {
    if (!Array.isArray(acts) || !currentRow) return null;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
    const type = currentRow.activityType || '';
    const isCurrentRun = !!currentRow.isRun;
    const samples = acts
      .filter(a => {
        if (!a || a === currentRow) return false;
        if (a[field] == null || !Number.isFinite(parseFloat(a[field]))) return false;
        const d = a.date ? new Date(a.date + 'T12:00:00') : null;
        if (!d || d < cutoff) return false;
        // Match by run vs strength + type fragment so HIIT lumps with HIIT, easy with easy.
        if (isCurrentRun && !a.isRun) return false;
        if (!isCurrentRun && a.isRun) return false;
        return true;
      })
      .map(a => parseFloat(a[field]));
    if (samples.length < 3) return null;
    const sorted = samples.sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const TrendChip = ({ trend }) => {
    if (!trend) return null;
    const cfg = {
      good: { icon: 'arrow-up-right', color: '#22c55e', bg: 'rgba(34,197,94,0.18)' },
      flat: { icon: 'arrow-right', color: '#f59e0b', bg: 'rgba(245,158,11,0.18)' },
      bad: { icon: 'arrow-down-right', color: '#ef4444', bg: 'rgba(239,68,68,0.18)' },
    }[trend];
    return (
      <div style={{position:'absolute',top:6,right:6,background:cfg.bg,padding:'2px 4px',borderRadius:4,display:'inline-flex',alignItems:'center'}}>
        <TIcon name={cfg.icon} size={11} color={cfg.color}/>
      </div>
    );
  };
  // Hero metric tile — icon over value over label, optional trend chip.
  const HeroTile = ({ icon, color, value, label, trend, tint }) => (
    <div style={{
      background: tint || 'rgba(255,255,255,0.03)',
      border: `0.5px solid ${color}33`,
      borderRadius: 10, padding: '12px 8px 10px', textAlign: 'center',
      flex: 1, position: 'relative', minWidth: 0,
    }}>
      <TrendChip trend={trend}/>
      <div style={{height:30,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <TIcon name={icon} size={26} color={color}/>
      </div>
      <div style={{color:'var(--text-primary)',fontSize:15,fontWeight:500,marginTop:4,lineHeight:1}}>{value ?? '—'}</div>
      <div style={{color:'var(--text-muted)',fontSize:10,marginTop:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</div>
    </div>
  );
  // Mini tile — icon left, value+label stacked right. Used in the lower run
  // metrics and hydration rows so visual language is consistent across the card.
  const IconMiniTile = ({ icon, color, value, label, dim }) => (
    <div style={{
      background:'var(--bg-elevated)', borderRadius:8, padding:'8px 9px',
      display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0,
      opacity: dim ? 0.55 : 1,
    }}>
      <TIcon name={icon} size={18} color={color}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{color:'var(--text-primary)',fontSize:13,fontWeight:500,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{value}</div>
        <div style={{color:'var(--text-muted)',fontSize:9,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</div>
      </div>
    </div>
  );

  // ── Phase 4r.viz.11 — Plan-driven metric profiles ─────────────────────────
  // The plan type determines which metrics show (the "story" of the workout),
  // not the data itself. If user planned easy_run and HR was elevated, it
  // stays easy_run and the elevated HR shows up as a "failed-easy" signal.
  //
  // Each profile returns: { row1: HeroTile[], row2: IconMiniTile[] }
  // Tiles with null value are filtered out before render.
  const _fmt1 = v => (v != null && Number.isFinite(+v)) ? (+v).toFixed(1) : null;
  const _fmtInt = v => (v != null && Number.isFinite(+v)) ? String(Math.round(+v)) : null;
  const _fmtPct = v => (v != null && Number.isFinite(+v)) ? `${Math.round(+v)}%` : null;

  // Pace seconds-per-mile helper for trend computation.
  const _paceToSec = p => {
    if (!p || typeof p !== 'string') return null;
    const m = p.match(/(\d+):(\d{1,2})/);
    if (!m) return null;
    return parseInt(m[1])*60 + parseInt(m[2]);
  };

  // Cardiac drift % from records — first-half avg HR vs second-half avg HR.
  // Returns null if records aren't available or run was too short.
  const _cardiacDrift = (fd) => {
    const recs = fd._records || fd.records || null;
    if (!Array.isArray(recs) || recs.length < 120) return null;
    const half = Math.floor(recs.length / 2);
    const first = recs.slice(0, half).map(r => r.heartRate).filter(Number.isFinite);
    const second = recs.slice(half).map(r => r.heartRate).filter(Number.isFinite);
    if (first.length < 30 || second.length < 30) return null;
    const avg1 = first.reduce((a,b)=>a+b,0) / first.length;
    const avg2 = second.reduce((a,b)=>a+b,0) / second.length;
    return ((avg2 - avg1) / avg1) * 100;
  };

  // Determine planType for an activity. Use today's plan if it lines up,
  // else default by activity flags.
  const _resolvePlanType = (fd, plannedToday) => {
    const plan = plannedToday?.type;
    const matches = (pt) => {
      if (['easy_run','long_run','tempo','intervals'].includes(pt)) return fd.isRun && !fd.isHIIT && !fd.isWalk;
      if (pt === 'hiit') return fd.isHIIT || (fd.isRun && !fd.distanceMi);
      if (pt === 'strength') return fd.isStrength;
      if (pt === 'mobility') return fd.isMobility;
      if (pt === 'cross') return fd.isCycle || fd.isSwim || fd.isWalk;
      return false;
    };
    if (plan && matches(plan)) return plan;
    // Default by flags.
    if (fd.isHIIT) return 'hiit';
    if (fd.isMobility) return 'mobility';
    if (fd.isStrength) return 'strength';
    if (fd.isCycle) return 'cycle';
    if (fd.isSwim) return 'swim';
    if (fd.isWalk) return 'walk';
    if (fd.isRun) return 'easy_run';
    return 'easy_run';
  };

  // Build the row1 + row2 tile lists for a given planType + activity.
  // Tiles with null values are dropped at render time so missing data
  // doesn't show "—" — the row just gets shorter.
  const _buildActivityProfile = (planType, fd) => {
    // Derive zone percentages from the activity's hrZones array (seconds
    // per zone). The activity object stores hrZones (an array from the
    // FIT parser); this builds the {z1..z5} percentage object that the
    // tile profile expects. Falls back to fd.zones if present (some
    // older paths populate it directly).
    const z = (() => {
      if (fd.zones && (fd.zones.z2 != null || fd.zones.z4 != null)) return fd.zones;
      const hz = fd.hrZones;
      if (!Array.isArray(hz) || hz.length !== 5) return {};
      const total = hz.reduce((s, v) => s + (Number(v) || 0), 0);
      if (total <= 0) return {};
      const pct = n => Math.round((n / total) * 100);
      return { z1: pct(hz[0]), z2: pct(hz[1]), z3: pct(hz[2]), z4: pct(hz[3]), z5: pct(hz[4]) };
    })();
    const z2 = Number.isFinite(+z.z2) ? +z.z2 : null;
    const z34 = (Number.isFinite(+z.z3) ? +z.z3 : 0) + (Number.isFinite(+z.z4) ? +z.z4 : 0);
    const z45 = (Number.isFinite(+z.z4) ? +z.z4 : 0) + (Number.isFinite(+z.z5) ? +z.z5 : 0);
    const aeroTE = fd.aerobicTrainingEffect ?? fd.aerobicTE;
    const anaerTE = fd.anaerobicTrainingEffect ?? fd.anaerobicTE;
    const decoupling = fd.aerobicDecoupling ?? fd.decoupling ?? null;
    const drift = _cardiacDrift(fd);
    const hrRecovery = fd.hrRecoveryDrop1min ?? fd.hrRecovery1min ?? null;
    const tss = fd.trainingStressScore ?? null;
    const calories = fd.calories ?? null;
    const avgHR = safeN(fd.avgHR,'avgHR');
    const maxHR = safeN(fd.maxHR,'maxHR');
    const avgCad = safeN(fd.avgCadence,'avgCadence');
    const vert = fd.avgVerticalOscillation ?? null;

    // Phase 4r.intel.1 — intel context for status-aware coloring.
    // Replaces the old "category-color = red because metric is intense"
    // pattern with status against published norms (core/expectedRanges.js).
    // When a metric is within expected range for this family + conditions,
    // value renders in neutral primary text color. Mild outliers → amber.
    // Concerns → red. The family/category info still lives in the icon
    // and label, so the visual taxonomy is preserved.
    //
    // Conditions injection: per-activity temperature isn't currently
    // attached on sync. fd.avgTemperature may be present on some FIT
    // imports — if so, use it. Otherwise the bands are population-baseline
    // only (no heat adjustment), which still fixes the false-red issue
    // for HIIT because the band is wide enough.
    // TODO Phase 4r.intel.2 — attach per-activity weather during sync.
    // intelMaxHR with fallback chain (Phase 4r.intel.6):
    //   1. profile.maxHR via getEffectiveMaxHR (preferred — uses user-set or recent training peak)
    //   2. highest recorded maxHR across all activities (uses what your body has actually shown)
    //   3. null — let avgHR_pctMax compute to null and tiles fall to neutral
    const intelMaxHR = resolveIntelMaxHR(getEffectiveMaxHR, profile, activities);
    // Phase 4r.intel.7 — intelCtx built via shared module (core/intelContext.js)
    // so MobileHome and EdgeIQ can produce the same status colors as LogDay.
    const intelCtx = buildIntelContext({
      ...fd,
      planType,
    }, {
      activities,
      profile,
      sleep: (() => { try { return storage.get('sleep') || []; } catch { return []; } })(),
    });
    // Phase 4r.intel.7 — paint helpers from shared intel module.
    const { paintM: _paintM, paintT: _paintT } = makePaint(intelCtx);
    // For avgHR/maxHR we need %maxHR to look up the band. Compute once.
    const avgHRPctMax = (intelMaxHR && avgHR) ? (avgHR / intelMaxHR) * 100 : null;
    const maxHRPctMax = (intelMaxHR && maxHR) ? (maxHR / intelMaxHR) * 100 : null;

    const TILE = {
      // Headline tiles (Row 1 candidates)
      distance:   () => fd.distanceMi   ? { icon:'route',           color:'#60a5fa', label:'Distance · mi', value: fd.distanceMi.toFixed(1), tint:'rgba(96,165,250,0.06)' } : null,
      pace:       () => fd.avgPacePerMi ? { icon:'stopwatch',       color:'#4ade80', label:'Pace · /mi',    value: fd.avgPacePerMi,           tint:'rgba(74,222,128,0.06)' } : null,
      avgHR:      () => avgHR           ? { icon:'heartbeat',       color: _paintM('avgHR_pctMax', avgHRPctMax, '#f87171'), label:'Avg HR · bpm',  value: safeDisp(fd.avgHR,'avgHR'),tint: _paintT('avgHR_pctMax', avgHRPctMax, 'rgba(248,113,113,0.06)') } : null,
      maxHRHero:  () => maxHR           ? { icon:'heart-rate-monitor', color: _paintM('avgHR_pctMax', maxHRPctMax, '#ef4444'), label:'Max HR · bpm',value: safeDisp(fd.maxHR,'maxHR'),tint: _paintT('avgHR_pctMax', maxHRPctMax, 'rgba(239,68,68,0.06)') } : null,
      cadence:    () => avgCad          ? { icon:'shoe',            color:'#a78bfa', label:'Cadence · spm', value: safeDisp(fd.avgCadence,'avgCadence'), tint:'rgba(167,139,250,0.06)' } : null,
      vertOsc:    () => vert            ? { icon:'wave-sine',       color:'#fbbf24', label:'Vert osc · cm', value: vert.toFixed(1),           tint:'rgba(251,191,36,0.06)' } : null,
      elevation:  () => fd.totalAscentFt? { icon:'mountain',        color:'#94a3b8', label:'Elev · ft',     value: String(fd.totalAscentFt),  tint:'rgba(148,163,184,0.06)' } : null,
      duration:   () => (fd.duration && fd.duration !== '—') ? { icon:'clock-hour-4', color:'#94a3b8', label:'Duration', value: fd.duration, tint:'rgba(148,163,184,0.06)' } : null,
      z2pct:      () => z2 != null      ? { icon:'target-arrow',    color:'#4ade80', label:'Z2 time',       value: _fmtPct(z2),               tint:'rgba(74,222,128,0.06)' } : null,
      z34pct:     () => z34             ? { icon:'target-arrow',    color:'#fbbf24', label:'Z3–Z4 time',    value: _fmtPct(z34),              tint:'rgba(251,191,36,0.06)' } : null,
      z45pct:     () => z45             ? { icon:'activity',        color: _paintM('z45Pct', z45, '#fb7185'), label:'Z4–Z5 time',    value: _fmtPct(z45),              tint: _paintT('z45Pct', z45, 'rgba(251,113,133,0.06)') } : null,
      cardiacDrift: () => drift != null ? { icon:'activity',        color: _paintM('cardiacDrift', drift, '#fb7185'), label:'Cardiac drift', value: `${drift>=0?'+':''}${drift.toFixed(1)}%`, tint: _paintT('cardiacDrift', drift, 'rgba(251,113,133,0.06)') } : null,
      gap:        () => fd.avgGapPerMi  ? { icon:'mountain',        color:'#fbbf24', label:'GAP · /mi',     value: fd.avgGapPerMi,            tint:'rgba(251,191,36,0.06)' } : null,
      anaerTE:    () => anaerTE         ? { icon:'activity',        color: _paintM('anaerobicTE', anaerTE, '#fb7185'), label:'Anaer TE',      value: anaerTE.toFixed(1),        tint: _paintT('anaerobicTE', anaerTE, 'rgba(251,113,133,0.06)') } : null,
      decouplingHero: () => decoupling != null ? { icon:'wave-sine', color: _paintM('decoupling', decoupling, '#fb7185'), label:'Aero decoupling', value: `${decoupling.toFixed(1)}%`, tint: _paintT('decoupling', decoupling, 'rgba(74,222,128,0.06)') } : null,
      hrRecovery: () => hrRecovery      ? { icon:'heartbeat',       color: _paintM('hrRecovery1m', hrRecovery, '#22d3ee'), label:'HR recovery 1m', value: `−${Math.round(hrRecovery)}`, tint: _paintT('hrRecovery1m', hrRecovery, 'rgba(34,211,238,0.06)') } : null,
      sets:       () => fd.setsCount    ? { icon:'barbell',         color:'#a78bfa', label:'Sets',          value: String(fd.setsCount),      tint:'rgba(167,139,250,0.06)' } : null,
      reps:       () => fd.totalReps    ? { icon:'repeat',          color:'#fbbf24', label:'Reps',          value: String(fd.totalReps),      tint:'rgba(251,191,36,0.06)' } : null,
      bodyBatt:   () => fd.bodyBatteryDrain ? { icon:'gauge',       color:'#94a3b8', label:'Body batt',     value: `−${fd.bodyBatteryDrain}`, tint:'rgba(148,163,184,0.06)' } : null,
      avgPower:   () => fd.avgPowerW    ? { icon:'bolt',            color:'#fbbf24', label:'Avg power · W', value: String(fd.avgPowerW),      tint:'rgba(251,191,36,0.06)' } : null,
      normPower:  () => fd.normalizedPower ? { icon:'bolt',         color:'#fb923c', label:'Norm power · W',value: String(fd.normalizedPower), tint:'rgba(251,146,60,0.06)' } : null,
      avgSpeed:   () => (fd.distanceMi && fd.durationSecs) ? { icon:'gauge', color:'#22d3ee', label:'Avg · mph', value: (fd.distanceMi / (fd.durationSecs/3600)).toFixed(1), tint:'rgba(34,211,238,0.06)' } : null,
      cadenceRpm: () => avgCad          ? { icon:'repeat',          color:'#a78bfa', label:'Cadence · rpm', value: String(avgCad),            tint:'rgba(167,139,250,0.06)' } : null,
      // Hero-size version of calories (the r2_calories tile is for row 2
      // small-format). Used as a HIIT fallback when zone time / HR
      // recovery aren't recorded by the watch.
      caloriesHero: () => calories      ? { icon:'flame',           color:'#fb923c', label:'Calories',      value: String(calories),          tint:'rgba(251,146,60,0.06)' } : null,
      // Row 2 (context) tiles — same component, smaller display.
      r2_duration:   () => (fd.duration && fd.duration !== '—') ? { icon:'clock-hour-4', color:'#94a3b8', value: fd.duration,                       label:'duration' } : null,
      r2_avgHR:      () => avgHR        ? { icon:'heartbeat',          color: _paintM('avgHR_pctMax', avgHRPctMax, '#f87171'), value: safeDisp(fd.avgHR,'avgHR'),       label:'avg HR' } : null,
      r2_maxHR:      () => maxHR        ? { icon:'heart-rate-monitor', color: _paintM('avgHR_pctMax', maxHRPctMax, '#ef4444'), value: safeDisp(fd.maxHR,'maxHR'),       label:'max HR' } : null,
      r2_calories:   () => calories     ? { icon:'flame',              color:'#fb923c', value: String(calories),                  label:'calories' } : null,
      r2_aeroTE:     () => aeroTE       ? { icon:'target-arrow',       color:'#4ade80', value: aeroTE.toFixed(1),                 label:'aero TE' } : null,
      r2_anaerTE:    () => anaerTE      ? { icon:'activity',           color: _paintM('anaerobicTE', anaerTE, '#fb7185'), value: anaerTE.toFixed(1),                label:'anaer TE' } : null,
      r2_tss:        () => tss          ? { icon:'activity',           color:'#a78bfa', value: String(Math.round(tss)),            label:'TSS' } : null,
      r2_decoupling: () => decoupling != null ? { icon:'wave-sine',    color: _paintM('decoupling', decoupling, '#fbbf24'), value: `${decoupling.toFixed(1)}%`,        label:'decoupling' } : null,
      r2_z2pct:      () => z2 != null   ? { icon:'target-arrow',       color:'#4ade80', value: _fmtPct(z2),                        label:'Z2 time' } : null,
      r2_vertOsc:    () => vert         ? { icon:'wave-sine',          color:'#fbbf24', value: vert.toFixed(1),                    label:'vert osc · cm' } : null,
      r2_hrRecovery: () => hrRecovery   ? { icon:'heartbeat',          color: _paintM('hrRecovery1m', hrRecovery, '#22d3ee'), value: `−${Math.round(hrRecovery)}`,       label:'HR recov 1m' } : null,
      r2_avgPace:    () => fd.avgPacePerMi ? { icon:'stopwatch',       color:'#4ade80', value: fd.avgPacePerMi,                    label:'avg pace' } : null,
      r2_avgPower:   () => fd.avgPowerW ? { icon:'bolt',               color:'#fbbf24', value: `${fd.avgPowerW} W`,                label:'avg power' } : null,
      r2_normPower:  () => fd.normalizedPower ? { icon:'bolt',         color:'#fb923c', value: `${fd.normalizedPower} W`,          label:'NP' } : null,
      r2_avgSpeed:   () => (fd.distanceMi && fd.durationSecs) ? { icon:'gauge', color:'#22d3ee', value: `${(fd.distanceMi / (fd.durationSecs/3600)).toFixed(1)} mph`, label:'avg speed' } : null,
      r2_if:         () => (tss && fd.durationSecs) ? { icon:'gauge', color:'#a78bfa', value: Math.sqrt(tss / (fd.durationSecs/3600 * 100)).toFixed(2), label:'IF' } : null,
      r2_elevation:  () => fd.totalAscentFt ? { icon:'mountain',       color:'#94a3b8', value: `${fd.totalAscentFt} ft`,           label:'elevation' } : null,
    };

    const PROFILES = {
      easy_run:  { row1: ['distance','pace','z2pct','cardiacDrift','cadence'],
                   row2: ['r2_decoupling','r2_vertOsc','r2_aeroTE','r2_calories'] },
      long_run:  { row1: ['distance','pace','cardiacDrift','elevation','cadence'],
                   row2: ['r2_z2pct','r2_decoupling','r2_aeroTE','r2_calories'] },
      tempo:     { row1: ['distance','gap','z34pct','decouplingHero','pace'],
                   row2: ['r2_avgPace','r2_tss','r2_hrRecovery','r2_aeroTE'] },
      intervals: { row1: ['z45pct','maxHRHero','anaerTE','hrRecovery','pace'],
                   row2: ['r2_avgHR','r2_tss','r2_aeroTE','r2_calories'] },
      // HIIT — original agreed-upon design: time at high intensity +
      // peak/avg load + anaerobic stress + cardiovascular recovery. All
      // five are HIIT-specific signals. After fixing the zone-derivation
      // bug (Phase 4r.viz.32) all five populate from FR955 sport=hiit
      // activities. HR Recovery still depends on the watch computing it
      // (firmware-dependent); cardiac drift takes its slot when missing.
      hiit:      { row1: ['z45pct','maxHRHero','anaerTE','hrRecovery','avgHR','cardiacDrift'],
                   row2: ['r2_duration','r2_aeroTE','r2_tss','r2_calories'] },
      strength:  { row1: ['sets','reps','avgHR','bodyBatt','duration'],
                   row2: ['r2_tss','r2_anaerTE','r2_maxHR','r2_calories'] },
      mobility:  { row1: ['duration','avgHR','maxHRHero','r2_calories'],
                   row2: ['r2_aeroTE'] },
      cycle:     { row1: ['distance','avgPower','normPower','cadenceRpm','elevation'],
                   row2: ['r2_avgSpeed','r2_if','r2_tss','r2_avgHR'] },
      cross:     { row1: ['distance','avgPower','cadenceRpm','elevation','avgHR'],
                   row2: ['r2_avgSpeed','r2_tss','r2_aeroTE','r2_calories'] },
      swim:      { row1: ['distance','pace','avgHR','maxHRHero','duration'],
                   row2: ['r2_aeroTE','r2_calories'] },
      walk:      { row1: ['distance','pace','elevation','avgHR','cadence'],
                   row2: ['r2_avgHR','r2_calories','r2_aeroTE','r2_elevation'] },
      race:      { row1: ['distance','pace','avgHR','maxHRHero','elevation'],
                   row2: ['r2_avgPace','r2_tss','r2_aeroTE','r2_calories'] },
    };
    const profile = PROFILES[planType] || PROFILES.easy_run;
    // Map row1 ids → tile objects, drop nulls, cap at 5 so longer
    // fallback chains (HIIT has 8 ids to weather missing zone/recovery
    // data) don't push past one row.
    //
    // Build row1 with id tracking so we can dedupe row2: any metric
    // already shown in the hero shouldn't repeat in the KRI rail below.
    // R1_TO_R2 maps a row1 tile id to its row2 equivalent.
    const R1_TO_R2 = {
      duration:       'r2_duration',
      caloriesHero:   'r2_calories',
      avgHR:          'r2_avgHR',
      maxHRHero:      'r2_maxHR',
      anaerTE:        'r2_anaerTE',
      decouplingHero: 'r2_decoupling',
      hrRecovery:     'r2_hrRecovery',
      cardiacDrift:   'r2_decoupling',     // close cousin — drift / decoupling
      pace:           'r2_avgPace',
      avgPower:       'r2_avgPower',
      normPower:      'r2_normPower',
      avgSpeed:       'r2_avgSpeed',
      elevation:      'r2_elevation',
    };
    const row1Pairs = [];
    for (const k of profile.row1) {
      if (row1Pairs.length >= 5) break;
      const t = TILE[k] && TILE[k]();
      if (t) row1Pairs.push({ id: k, tile: t });
    }
    const row1 = row1Pairs.map(p => p.tile);
    const usedR2Ids = new Set(row1Pairs.map(p => R1_TO_R2[p.id]).filter(Boolean));
    const row2 = profile.row2
      .filter(k => !usedR2Ids.has(k))                 // skip any metric already in row1
      .map(k => TILE[k] && TILE[k]())
      .filter(Boolean);
    return { row1, row2 };
  };

  // fitData = today's .fit upload OR fallback to today's row from synced activities
  // Hydration row — uses pure derive/hydration.js so the formula lives in one place.
  // Phase 4r.viz.1 — icon-prefixed tiles for visual consistency with run metrics.
  const HydrationRow=({fd})=>{
    const h=hydrationFor(fd,profile);
    // Tinted-value variant: when value should use a semantic color (sweat loss
    // blue, replenish green), pass through valueColor; IconMiniTile keeps its
    // standard layout.
    const TintedTile = ({ icon, iconColor, value, label, valueColor }) => (
      <div style={{
        background:'var(--bg-elevated)', borderRadius:8, padding:'8px 9px',
        display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0,
      }}>
        <TIcon name={icon} size={18} color={iconColor}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:valueColor||'var(--text-primary)',fontSize:13,fontWeight:500,lineHeight:1.1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{value}</div>
          <div style={{color:'var(--text-muted)',fontSize:9,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</div>
        </div>
      </div>
    );
    return<>
      <div style={divider}/>
      <div style={subHdr}>Hydration</div>
      <div style={{display:'flex',gap:6}}>
        <TintedTile icon="droplet" iconColor="#60a5fa" valueColor="#60a5fa"
          value={h.sweatLossL!=null?`${h.sweatLossL.toFixed(2)} L`:'—'}
          label="est. sweat loss"/>
        <TintedTile icon="droplet" iconColor="#4ade80" valueColor="#4ade80"
          value={h.replenishL!=null?`${h.replenishL.toFixed(2)} L`:'—'}
          label="replenish water"/>
        <IconMiniTile icon="bottle" color="#94a3b8"
          value={h.replenishOz!=null?`${h.replenishOz} oz`:'—'} label="≈ in oz"/>
        <IconMiniTile icon="hourglass" color="#94a3b8"
          value={`${h.windowHrs} hrs`} label="window"/>
      </div>
    </>;
  };

  // ── Replenishment Tracker: micro-goals from activity needs engine ──
  // ReplenishTracker \u2014 Phase 4r.viz.30 redesign.
  // Compact 2-column grid of phase-coded goal cards (pre=amber, during=blue,
  // post=green). Each card: phase tag \u00b7 short label \u00b7 big value \u00b7 vs target \u00b7
  // background fill behind the card shows progress. Replaces the previous
  // long-line list which was hard to scan and visually heavy.
  const ReplenishTracker=({fd,dateStr,onGoToFuel})=>{
    const needs=computeActivityNeeds(fd,profile);
    if(!needs)return null;
    const progress=trackReplenishment(needs,dateStr);
    const summary=replenishmentSummary(progress);
    if(!progress.length)return null;
    const phaseTag={pre_workout:'PRE',during_workout:'DURING',post_workout:'POST'};
    const phaseColors={pre_workout:'#fbbf24',during_workout:'#60a5fa',post_workout:'#4ade80'};
    const unmet=progress.filter(g=>!g.met);
    // Activity context line
    const dMins=needs.durationSecs?Math.round(needs.durationSecs/60):null;
    const actType=fd.isHIIT?'HIIT':fd.isRun?'run':fd.isStrength?'strength':fd.activityType||'workout';
    // Shorten the goal label to fit on a card. "64g carbs before workout" \u2192 "carbs \u00b7 64g"
    const shortLabel=(g)=>{
      const cleaned=g.label.replace(/\s*before workout|\s*during workout|\s*within 1 hr|\s*to replenish glycogen|\(.*?\)/gi,'').trim();
      // Strip the leading number+unit if present and put it on the value row
      return cleaned.replace(/^\d+\s*(g|ml)\s+/i,'').replace(/\s+/g,' ');
    };
    return<>
      <div style={divider}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
        <div style={{...subHdr,marginBottom:0}}>Replenishment</div>
        <div style={{
          padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:600,
          background:summary.status==='complete'?'rgba(74,222,128,0.12)':summary.status==='partial'?'rgba(251,191,36,0.12)':'rgba(248,113,113,0.12)',
          color:summary.status==='complete'?'#4ade80':summary.status==='partial'?'#fbbf24':'#f87171',
        }}>{summary.met}/{summary.total} {'\u00b7'} {summary.pct}%</div>
      </div>
      <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:8}}>
        <span style={{fontWeight:500,color:fd.isHIIT?'#fb7185':fd.isRun?'#60a5fa':fd.isStrength?'#a78bfa':'var(--text-primary)'}}>{actType}</span>
        {dMins!=null&&<span> {'\u00b7'} {dMins} min</span>}
        {' \u00b7 '}<span style={{fontWeight:600,color:'var(--text-primary)'}}>{needs.caloriesBurned} kcal</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))',gap:6}}>
        {progress.map(g=>{
          const color=phaseColors[g.phase]||'#60a5fa';
          const tag=phaseTag[g.phase]||'';
          const pct=Math.max(0,Math.min(1,g.pct||0));
          const fillPct=Math.round(pct*100);
          return<div key={g.id}
            onClick={()=>!g.met&&onGoToFuel?.()}
            style={{
              position:'relative',overflow:'hidden',
              borderRadius:6,padding:'7px 9px',
              border:`0.5px solid ${g.met?color+'55':'var(--border-subtle)'}`,
              background:'var(--bg-elevated)',
              cursor:g.met?'default':onGoToFuel?'pointer':'default',
              minHeight:54,
            }}>
            {/* Progress fill behind content \u2014 subtle wash */}
            <div style={{
              position:'absolute',inset:0,
              background:`linear-gradient(to right, ${color}${g.met?'18':'10'} 0%, ${color}${g.met?'18':'10'} ${fillPct}%, transparent ${fillPct}%, transparent 100%)`,
              pointerEvents:'none',
            }}/>
            <div style={{position:'relative'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:4,marginBottom:2}}>
                <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.06em',color,opacity:0.85}}>{tag}</span>
                <span style={{fontSize:9,color:g.met?color:'var(--text-muted)',fontWeight:g.met?600:500}}>
                  {g.met?'\u2713':`${fillPct}%`}
                </span>
              </div>
              <div style={{fontSize:11,color:'var(--text-primary)',fontWeight:500,lineHeight:1.2,marginBottom:3,textTransform:'capitalize'}}>
                {shortLabel(g)}
              </div>
              <div style={{fontSize:10,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>
                <span style={{color:g.met?color:'var(--text-primary)',fontWeight:600}}>{g.consumed}</span>
                <span style={{opacity:0.5}}>{` / ${g.target}${g.unit==='ml'?'ml':'g'}`}</span>
              </div>
            </div>
          </div>;
        })}
      </div>
      {unmet.length>0&&onGoToFuel&&<div style={{textAlign:'center',marginTop:8}}>
        <button onClick={onGoToFuel} style={{fontSize:10,fontWeight:600,color:'#60a5fa',background:'rgba(96,165,250,0.08)',border:'1px solid rgba(96,165,250,0.15)',borderRadius:8,padding:'6px 16px',cursor:'pointer'}}>
          Log recovery meal in Fuel {'\u2192'}
        </button>
      </div>}
    </>;
  };

  const todayStr=td();
  // Plausibility bounds — any value outside these is treated as invalid and
  // replaced with null. Protects the UI from garbage that occasionally slips
  // through the FIT parser (e.g. a 32-bit timestamp leaking into avgHR).
  const FIT_BOUNDS={avgHR:[30,250],maxHR:[30,250],avgCadence:[20,260],maxCadence:[20,260],
    avgPowerW:[0,2000],maxPowerW:[0,2000],avgVerticalOscillation:[1,20],
    durationSecs:[0,86400],movingTimeSecs:[0,86400],distanceMi:[0,200],
    calories:[0,10000],totalAscentFt:[0,30000],trainingStressScore:[0,1000],
    aerobicTrainingEffect:[0,5],aerobicTE:[0,5],anaerobicTrainingEffect:[0,5],anaerobicTE:[0,5],
    setsCount:[0,500],totalReps:[0,5000],bodyBatteryDrain:[0,100]};
  const sanitizeFit=fd=>{
    if(!fd||typeof fd!=='object')return fd;
    const out={...fd};
    for(const k of Object.keys(FIT_BOUNDS)){
      const v=out[k];
      if(v==null)continue;
      const n=parseFloat(v);
      const b=FIT_BOUNDS[k];
      if(!Number.isFinite(n)||n<b[0]||n>b[1])out[k]=null;
      else out[k]=n;
    }
    return out;
  };
  // fitDataList: EVERY activity for today. Drives the Workout Log panel(s) below —
  // one panel renders per activity so metrics can't be hidden by later uploads or CSV rows.
  const fitDataList=(()=>{
    const inMemory=(todayFITs||[]).filter(f=>f&&(!f.date||f.date===todayStr));
    if(inMemory.length)return inMemory.map(sanitizeFit);
    const acts=getUnifiedActivities().filter(a=>a.date===todayStr);
    return acts.map(row=>{
      // Prefer the row's own classification flags (set by fitParser /
      // garmin-activities-client). Fall back to regex against activityType
      // when flags are missing — historical CSV rows lack these fields.
      // Regex updated: matches "Run (outdoor)", "Run (treadmill)", "HIIT",
      // "Trail Run", etc. — the previous /running|trail/ pattern only caught
      // legacy CSV strings and missed the modern parser's "Run (...)" labels.
      const isMobility = row.isMobility === true || /mobility|stretch|yoga|pilates|flexibility|breathwork|meditation/i.test(row.activityType||'');
      // Phase 4r.viz.7 — explicit Cycle / Swim / Walk-Hike classification so
      // each gets a discipline-appropriate render branch instead of falling
      // through to a generic activity layout.
      const isCycle = !isMobility && (row.isCycle === true || /\b(cycl|bike|biking|spin|riding|road bike|mtb|gravel|peloton)\b/i.test(row.activityType||''));
      const isSwim = !isMobility && !isCycle && (row.isSwim === true || /\b(swim|swimming|pool|open water)\b/i.test(row.activityType||''));
      const isWalk = !isMobility && !isCycle && !isSwim && (row.isWalk === true || /\b(walk|walking|hike|hiking|trekking)\b/i.test(row.activityType||'') || /\b(walk|hike)\b/i.test(row.activityName||''));
      const isRun = !isMobility && !isCycle && !isSwim && !isWalk && (row.isRun === true || row.isHIIT === true || /\b(run|jog|hiit|interval|tempo|trail|fartlek|sprint|track)\b/i.test(row.activityType||'') || /\b(run|jog|hiit|fartlek|interval|tempo)\b/i.test(row.activityName||''));
      const isStrength = !isMobility && !isCycle && !isSwim && !isWalk && !isRun && (row.isStrength === true || /strength|weight|gym|hyrox|circuit/i.test(row.activityType||''));
      // Phase 4r.viz.10 — auto-promote Run → HIIT when the data screams it.
      // Garmin records most interval workouts under sport=running so the
      // FIT parser can't always tell. Strong HIIT signals from session data:
      //   • anaerobic TE >= 1.5  (definitively HIIT/intervals)
      //   • OR no distance + duration <60min + anaer TE >= 0.8 + high avg HR
      // Conservative on purpose — false positives are more confusing than
      // false negatives. Original FIT classification still drives `isRun`.
      const _anaerTE = row.anaerobicTrainingEffect ?? row.anaerobicTE;
      const _autoHIIT = isRun && (
        (Number.isFinite(_anaerTE) && _anaerTE >= 1.5)
        || (!row.distanceMi && row.durationSecs && row.durationSecs < 60*60
            && Number.isFinite(_anaerTE) && _anaerTE >= 0.8)
      );
      const isHIIT = row.isHIIT === true || row.activityType === 'HIIT' || _autoHIIT;
      const mins=row.durationSecs?Math.round(row.durationSecs/60):null;
      return sanitizeFit({
        ...row,
        isRun,isStrength,isMobility,isHIIT,
        isCycle, isSwim, isWalk,
        durationMins:mins,
        duration:row.durationFormatted||(mins?`${mins} min`:'—'),
        avgPacePerMi:row.avgPaceRaw,
        // Power aliasing — FIT parser writes avgPowerW/maxPowerW, legacy CSV
        // uses avgPower/maxPower. Prefer the FIT field, fall back to CSV.
        // (Phase 4r.viz.2: previously this line overwrote the FIT value with
        // the CSV alias, blanking out power on every Garmin-synced run.)
        avgPowerW: row.avgPowerW ?? row.avgPower,
        maxPowerW: row.maxPowerW ?? row.maxPower,
        // Training Effect aliasing — Garmin FIT parser writes
        // aerobicTrainingEffect / anaerobicTrainingEffect, while older CSV
        // imports use aerobicTE / anaerobicTE. Prefer the FIT field, fall
        // back to CSV. (Phase 4d: previously this line overwrote the FIT
        // value with the CSV alias, blanking out auto-imported workouts.)
        aerobicTrainingEffect: row.aerobicTrainingEffect ?? row.aerobicTE,
        anaerobicTrainingEffect: row.anaerobicTrainingEffect ?? row.anaerobicTE,
        // Bidirectional aliases so UI code reading either name works.
        aerobicTE: row.aerobicTrainingEffect ?? row.aerobicTE,
        anaerobicTE: row.anaerobicTrainingEffect ?? row.anaerobicTE,
        source:'activities-csv',
      });
    });
  })();
  // Legacy single-value reference used by save() below and by any older readers.
  // When the day has multiple activities, this is the latest (or only) one.
  const fitData=fitDataList.length?fitDataList[fitDataList.length-1]:null;
  // Aggregate totals across all of today's activities (shown in a summary strip when N>1)
  const fitTotals=fitDataList.reduce((acc,fd)=>{
    acc.distanceMi+=(fd?.distanceMi||0);
    acc.durationSecs+=(fd?.durationSecs||(fd?.durationMins?fd.durationMins*60:0));
    acc.calories+=(fd?.calories||0);
    return acc;
  },{distanceMi:0,durationSecs:0,calories:0});
  const fmtDurTotal=s=>{const h=Math.floor(s/3600),m=Math.round((s%3600)/60);return h>0?`${h}h${String(m).padStart(2,'0')}m`:`${m}m`;};

  // Final display-level guard: any numeric still outside FIT_BOUNDS by the time
  // it hits a dial is replaced with null/'—'. Belt-and-suspenders on top of
  // sanitizeFit (storage load) and clean() (aggregation) — catches anything
  // that slipped through both, including a stale HMR state.
  const safeN=(v,field)=>{
    if(v==null)return null;
    const n=parseFloat(v);
    if(!Number.isFinite(n))return null;
    const b=FIT_BOUNDS[field];
    if(b&&(n<b[0]||n>b[1]))return null;
    return n;
  };
  const safeDisp=(v,field)=>{const n=safeN(v,field);return n==null?'—':n;};

  // ─── Group same-type activities & compute cumulative metrics ────────────────
  // Smart grouping for multi-workout days:
  //   • Hard sessions (HIIT / Fartlek / intervals / tempo / sprint / track)
  //     render SOLO — their pace splits, HR profile, power, TE are
  //     individually meaningful and can't be averaged with other runs.
  //   • Easy / Z2 / recovery / long-slow runs aggregate into one "today's
  //     easy mileage" card.
  //   • Strength sessions aggregate by default (cumulative tonnage / sets).
  //   • Mobility renders solo (each session has its own focus).
  //   • Cycling / swim render solo.
  // The user can flip the splitView toggle to render every activity on its
  // own card regardless of kind.
  const fitGroups=(()=>{
    if(!fitDataList.length)return[];
    const groupKey=(fd,i)=>{
      // Toggle on: every activity is its own card (unique per index)
      if (splitView) return `solo__${i}`;
      // Hard sessions and mobility are inherently solo (different focus per session)
      if (isHardSession(fd) || isMobilityAct(fd)) return `solo__${i}`;
      // Easy runs aggregate together
      if (isRunAct(fd)) return 'run-easy';
      // Strength aggregates
      if (isStrengthAct(fd)) return 'strength';
      // Other sports — solo
      return `solo__${i}`;
    };
    const buckets=new Map();
    fitDataList.forEach((fd,i)=>{
      const k=groupKey(fd,i);
      if(!buckets.has(k))buckets.set(k,[]);
      buckets.get(k).push({...fd,_origIdx:i});
    });
    const parsePaceSecs=p=>{const m=(p||'').match(/^(\d+):(\d+)/);return m?+m[1]*60+ +m[2]:null;};
    const fmtPaceSecs=s=>{const m=Math.floor(s/60),sec=Math.round(s%60);return `${m}:${String(sec).padStart(2,'0')}`;};
    const fmtHMS=s=>{if(!s)return'—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.round(s%60);return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;};
    // Reuse the same FIT_BOUNDS defined above for the single-item sanitizer so
    // every plausibility rule lives in one place.
    const clean=(v,f)=>{
      const n=parseFloat(v);
      if(!Number.isFinite(n))return null;
      const b=FIT_BOUNDS[f];
      if(b&&(n<b[0]||n>b[1]))return null;
      return n;
    };
    const out=[];
    for(const[key,items]of buckets){
      if(items.length===1){out.push({...items[0],_groupCount:1,_groupKey:key,_groupItems:items});continue;}
      const sum=f=>items.reduce((s,it)=>{const n=clean(it[f],f);return s+(n||0);},0);
      const max=f=>{let m=null;for(const it of items){const n=clean(it[f],f);if(n!=null&&(m==null||n>m))m=n;}return m;};
      const wAvg=(f,wf)=>{let t=0,w=0;for(const it of items){const v=clean(it[f],f),ww=clean(it[wf],wf);if(v!=null&&ww!=null&&ww>0){t+=v*ww;w+=ww;}}return w?t/w:null;};
      const durationSecs=sum('durationSecs');
      const movingTimeSecs=sum('movingTimeSecs')||durationSecs;
      const distanceMi=sum('distanceMi');
      const calories=sum('calories');
      const isRun=items[0].isRun,isStrength=items[0].isStrength;
      const agg={
        ...items[items.length-1], // latest as base (preserves activityId/time for key)
        _groupCount:items.length,
        _groupKey:key,
        _groupItems:items,
        durationSecs,movingTimeSecs,distanceMi,calories,
        totalAscentFt:sum('totalAscentFt')||null,
        maxHR:max('maxHR'),
        maxCadence:max('maxCadence'),
        maxPowerW:max('maxPowerW'),
        avgHR:wAvg('avgHR','durationSecs'),
        aerobicTrainingEffect:sum('aerobicTrainingEffect')||null,
        aerobicTE:sum('aerobicTE')||null,
      };
      // Time range "HH:MM → HH:MM"
      const times=items.map(it=>it.time).filter(Boolean);
      agg.time=times.length>1?`${times[0]} → ${times[times.length-1]}`:(times[0]||'');
      if(isRun){
        // Pace: distance-weighted average over avgPacePerMi strings
        let paceSum=0,dSum=0;
        for(const it of items){const ps=parsePaceSecs(it.avgPacePerMi),d=parseFloat(it.distanceMi)||0;if(ps&&d){paceSum+=ps*d;dSum+=d;}}
        agg.avgPacePerMi=dSum?fmtPaceSecs(paceSum/dSum):(items[items.length-1].avgPacePerMi||null);
        // Vertical osc: distance-weighted
        let vSum=0,vW=0;
        for(const it of items){const v=parseFloat(it.avgVerticalOscillation),d=parseFloat(it.distanceMi)||0;if(v&&d){vSum+=v*d;vW+=d;}}
        agg.avgVerticalOscillation=vW?vSum/vW:null;
        // Cadence / power: duration-weighted
        agg.avgCadence=wAvg('avgCadence','durationSecs');
        agg.avgPowerW=wAvg('avgPowerW','durationSecs');
        // Rebuild duration display from summed seconds
        agg.duration=fmtHMS(durationSecs);
        agg.durationMins=durationSecs?Math.round(durationSecs/60):null;
      }
      if(isStrength){
        agg.setsCount=sum('setsCount')||null;
        agg.totalReps=sum('totalReps')||null;
        agg.trainingStressScore=sum('trainingStressScore')||null;
        agg.anaerobicTE=sum('anaerobicTE')||null;
        agg.bodyBatteryDrain=sum('bodyBatteryDrain')||null;
      }
      out.push(agg);
    }
    // Stable ordering: runs first, strength next, everything else after
    const rank=k=>k==='run'?0:k==='strength'?1:2;
    return out.sort((a,b)=>rank(a._groupKey)-rank(b._groupKey));
  })();
  const nutData=(todayNutrition&&(!todayNutrition.date||todayNutrition.date===todayStr))?todayNutrition:null;
  // Phase 4r.fuel.1 — dynamic daily target (RMR + activity + NEAT + TEF per day)
  const calT=resolveCalorieTarget(todayStr, profile);

  // Pace helpers
  const paceToSecs=p=>{if(!p)return 0;const[m,s]=p.split(':').map(Number);return(isNaN(m)||isNaN(s))?0:m*60+s;};
  const secsToPace=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
  const pacePctFn=(actualPace,goalPace)=>{
    const a=paceToSecs(actualPace),g=paceToSecs(goalPace||'9:30');
    return a>0?Math.min(g/a,1):0;
  };

  // Weekly miles for "Vs Goal"
  const weeklyMiles=(()=>{
    const acts=getUnifiedActivities();
    const monday=new Date();
    monday.setDate(monday.getDate()-(monday.getDay()||7)+1);
    monday.setHours(0,0,0,0);
    return acts.filter(a=>a.date&&parseLocalDate(a.date)>=monday&&isRunAct(a))
      .reduce((sum,a)=>sum+(a.distanceMi||0),0);
  })();

  // ── 7-day data series ──
  const last7Days=(()=>{
    const arr=[];
    for(let i=6;i>=0;i--){
      const d=new Date();d.setDate(d.getDate()-i);d.setHours(0,0,0,0);
      arr.push(td(d));
    }
    return arr;
  })();

  const allActs=getUnifiedActivities();
  const allCrono=storage.get('cronometer')||[];
  const allWeight=storage.get('weight')||[];
  const allSleep=cleanSleepForAveraging(storage.get('sleep')||[]);
  const allHRV=storage.get('hrv')||[];

  // Daily miles
  const dailyMiles=last7Days.map(d=>{
    const dayActs=allActs.filter(a=>a.date===d&&isRunAct(a));
    return dayActs.reduce((s,a)=>s+(a.distanceMi||0),0);
  });
  // Daily pace (avg of running activities, in seconds)
  const dailyPaceSecs=last7Days.map(d=>{
    const dayActs=allActs.filter(a=>a.date===d&&isRunAct(a));
    const paces=dayActs.map(a=>paceToSecs(a.avgPaceRaw)).filter(Boolean);
    return paces.length?paces.reduce((a,b)=>a+b,0)/paces.length:null;
  });
  // Daily calories
  const dailyCals=last7Days.map(d=>{
    const r=allCrono.find(c=>c.date===d);
    return r?parseFloat(r.calories)||null:null;
  });
  // Daily weight
  const dailyWeight=last7Days.map(d=>{
    const r=allWeight.find(w=>w.date===d);
    return r?r.weightLbs||null:null;
  });
  // Daily sleep hours
  const dailySleep=last7Days.map(d=>{
    const r=allSleep.find(s=>s.date===d);
    return r?.durationMinutes?r.durationMinutes/60:null;
  });
  // Daily HRV
  const dailyHRV=last7Days.map(d=>{
    const r=allHRV.find(h=>h.date===d);
    return r?.overnightHRV||null;
  });
  const hrvBaselineLow=allHRV.find(h=>h.baselineLow)?.baselineLow||null;
  const hrvBaselineHigh=allHRV.find(h=>h.baselineHigh)?.baselineHigh||null;

  // Latest recovery metrics
  const latestSleep=[...allSleep].sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
  const latestHRV=[...allHRV].sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];

  // Helper: build polyline points string from data array
  const buildPoints=(data,maxV)=>{
    if(maxV<=0)return '';
    return data.map((val,i)=>{
      if(val==null||isNaN(val))return null;
      const x=i===0?2:i===6?98:(i/6)*96+2;
      const y=42-Math.min(val/maxV,1)*36+2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(' ');
  };

  // Pace chart needs special handling: lower=better so invert y
  const buildPacePoints=(data)=>{
    const valid=data.filter(p=>p!=null);
    if(valid.length<2)return '';
    const mn=Math.min(...valid),mx=Math.max(...valid),rng=mx-mn||1;
    return data.map((val,i)=>{
      if(val==null)return null;
      const x=i===0?2:i===6?98:(i/6)*96+2;
      // Invert: lower secs = higher position
      const y=42-((mx-val)/rng)*36+2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(' ');
  };

  const dotsCount=arr=>arr.filter(v=>v!=null&&!isNaN(v)).length;

  // Trends
  const milesTrend=(()=>{
    const v=dailyMiles.filter(x=>x>0);
    if(v.length<2)return null;
    const recent=dailyMiles.slice(4).filter(x=>x>0);
    const early=dailyMiles.slice(0,3).filter(x=>x>0);
    const r=recent.length?recent.reduce((a,b)=>a+b,0)/recent.length:0;
    const e=early.length?early.reduce((a,b)=>a+b,0)/early.length:0;
    return r-e;
  })();
  const paceTrend=(()=>{
    const v=dailyPaceSecs.filter(x=>x!=null);
    if(v.length<2)return null;
    return Math.round(v[v.length-1]-v[0]); // positive = slower
  })();
  const calsAvg=(()=>{
    const v=dailyCals.filter(x=>x!=null);
    return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null;
  })();
  const weightDelta=(()=>{
    const v=dailyWeight.filter(x=>x!=null);
    if(v.length<2)return null;
    return parseFloat((v[v.length-1]-v[0]).toFixed(1));
  })();
  const sleepAvg=(()=>{
    const v=dailySleep.filter(x=>x!=null);
    return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null;
  })();
  const hrvLatest=(()=>{
    const v=dailyHRV.filter(x=>x!=null);
    return v.length?v[v.length-1]:null;
  })();

  // Trend chart wrapper
  const TrendChart=({title,color,children,trendLabel,trendColor})=>(
    <div>
      <div style={subHdr}>{title}</div>
      {children}
      <div style={{display:'flex',justifyContent:'space-between',marginTop:2}}>
        <span style={{fontSize:8,color:'var(--text-muted)'}}>Mon</span>
        <span style={{fontSize:8,color:'var(--text-muted)'}}>Sun</span>
      </div>
      <div style={{fontSize:10,color:trendColor||'var(--text-muted)',marginTop:3}}>{trendLabel}</div>
    </div>
  );

  // Inline ArcDial (custom small SVG for the 5-dial row)
  // ── SmallDial / MacroDial — unified styling (Phase 4o.daily.5) ──
  // Both dials now share the same visual language: value lives INSIDE the
  // circle centered, label sits below in mixed-case "Distance (mi)" format.
  // No more all-caps labels, no more value-outside split. The two dial
  // variants differ only by ring size (60 vs 64).
  const SmallDial=({value,max,color,unit,label,displayValue})=>{
    const pct=Math.min((value||0)/(max||1),1);
    const isFull = pct >= 1;
    return(
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,flex:1}}>
        <svg width="60" height="60" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="23" fill="none" stroke="var(--bg-input)" strokeWidth="4.5"/>
          <circle cx="30" cy="30" r="23" fill="none" stroke={color} strokeWidth="4.5"
            strokeDasharray={isFull ? undefined : `${pct*145} 145`}
            strokeDashoffset={isFull ? 0 : -18}
            strokeLinecap="round"
            transform="rotate(135 30 30)"/>
          <text x="30" y="34" textAnchor="middle" fontSize="13" fontWeight="600"
            fill="var(--text-primary)" style={{fontFamily:'var(--font-ui)'}}>
            {displayValue??'—'}
          </text>
        </svg>
        <div style={{
          fontSize:10,color:'var(--text-secondary, var(--text-muted))',
          textAlign:'center',lineHeight:1.2,whiteSpace:'nowrap',
          overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',
        }}>
          {label}{unit ? ` (${unit})` : ''}
        </div>
      </div>
    );
  };

  const MacroDial=({value,max,color,unit,label,target})=>{
    const pct=Math.min((value||0)/(max||1),1);
    // Phase 4o.fix.1 — drop dasharray at 100%+ so the ring fully closes.
    const isFull = pct >= 1;
    const v = value!=null ? Math.round(value) : '—';
    return(
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,flex:1}}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="25" fill="none" stroke="var(--bg-input)" strokeWidth="5"/>
          <circle cx="32" cy="32" r="25" fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={isFull ? undefined : `${pct*157} 157`}
            strokeDashoffset={isFull ? 0 : -20}
            strokeLinecap="round"
            transform="rotate(135 32 32)"/>
          <text x="32" y="34" textAnchor="middle" fontSize="14" fontWeight="600"
            fill="var(--text-primary)" style={{fontFamily:'var(--font-ui)'}}>
            {v}
          </text>
          <text x="32" y="46" textAnchor="middle" fontSize="8"
            fill="var(--text-muted)" style={{fontFamily:'var(--font-ui)'}}>
            / {target}
          </text>
        </svg>
        <div style={{
          fontSize:10,color:'var(--text-secondary, var(--text-muted))',
          textAlign:'center',lineHeight:1.2,whiteSpace:'nowrap',
          overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',
        }}>
          {label}{unit ? ` (${unit})` : ''}
        </div>
      </div>
    );
  };

  // Today's Movement — ambient NEAT from Health Connect (populated by
  // syncDailyEnergy). Null when no HC wellness row exists for today yet.
  // Reads `hcDailyEnergy` — the dedicated HC-owned collection (separated
  // from dailyLogs in Phase 4a bug fix to avoid FIT/HC overwrite collisions).
  const todayMovement=(()=>{
    try{
      const today=td();
      const rows=storage.get('hcDailyEnergy')||[];
      const entry=rows.find(r=>r&&r.date===today);
      if(!entry)return null;
      const steps=Number(entry.steps)||0;
      const active=Number(entry.activeCalories)||0;
      const total=Number(entry.totalCalories)||0;
      if(steps===0&&total===0)return null;
      return{steps,active,total,source:entry.wellnessSource||null,updatedAt:entry.wellnessUpdatedAt||null};
    }catch{return null;}
  })();

  return(
    <div style={S.sec}>
      {/* Inner sub-header dropped on mobile (Phase 4o.mobile.6) \u2014 the
          mobile compact page header above already shows the tab name
          (Play/Fuel/Daily Log) plus today's date in the top-right.
          Desktop still renders it because the desktop tab strip doesn't
          carry a per-page title. */}
      {!mobileView && (
        <div style={S.st}>{'\u2295 Daily Log'} {'\u00b7'} {ts}</div>
      )}

      {false&&todayLoaded&&!mobileView&&(
        <div style={{fontSize:10,color:'var(--text-accent)',display:'flex',alignItems:'center',gap:4,marginBottom:8}}>
          <span>✓</span>
          <span>Today's entry loaded {'\u00b7'} {new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</span>
        </div>
      )}

      {/* ═══════ DAILY HERO · rTSS speedometer + coaching (Phase 4o.daily.10) ═══════
          Left  : 180° rTSS gauge — the day's run training-stress score with
                  zone bands (easy / moderate / hard / overreaching). Distinct
                  from EdgeIQ's daily 0-100 score: this one shows the absolute
                  load of today's run, not the composite training-readiness.
          Right : top-2 coaching prompts (vertical stack), with the inline
                  calibration line (BEHIND / ON PACE / AHEAD + drift) wedged
                  beneath them. Clicking the calibration row opens Goals.
          One bordered band, single source of truth for "what should I do
          right now".
          Phase 4o.mobile.1 — Mobile branch added: same data prep, compact
          single-column layout for Play (activity) + Fuel (nutrition). */}
      {(() => {
        // ── Today's session score + rolling readiness + A:C load ──
        // All folded into the hero so the entire "score story" lives in
        // one band. Calibration (BEHIND/ON PACE/AHEAD + "Lost X lb vs
        // predicted" prompts) is intentionally NOT shown here — that lives
        // on EdgeIQ where it belongs (Phase 4o.daily.13).
        let sessionType = 'rest';
        let sessionMetric = null;            // {label:'rTSS'|'Tonnage', value:number|string}
        let r7Score = 0, r30Score = 0;
        let domains = { activity: null, nutrition: null, body: null };
        try {
          const r7 = computeRolling7d(td());
          const r30 = computeRolling30d(td());
          sessionMetric = r7?.todayScore?.sessionMetric || null;
          sessionType   = r7?.todayScore?.sessionType   || 'rest';
          domains       = r7?.todayScore?.domains       || domains;
          r7Score  = r7?.score  || 0;
          r30Score = r30?.score || 0;
        } catch {}

        // ── Activity set + run metrics + A:C load + 30d EF baseline ──
        let runMetrics = null;
        let strengthMetrics = null; // Phase 4o.daily.21 — strength-day quality
        let acr = { ratio: null, zone: 'no_data' };
        let ef30Avg = null;        // 30-day average EF — gives today's EF context
        try {
          const csvActs = (storage.get('activities') || []).filter(a => a.source !== 'health_connect');
          const dailyLogs = storage.get('dailyLogs') || [];
          const fitActs = [];
          for (const l of dailyLogs) {
            if (!l?.date) continue;
            const fits = Array.isArray(l.fitActivities) && l.fitActivities.length
              ? l.fitActivities
              : (l.fitData ? [l.fitData] : []);
            for (const fd of fits) if (fd) fitActs.push({ ...fd, date: l.date, source: 'daily_fit' });
          }
          const activities = [...csvActs, ...fitActs];
          const ftpPace     = profile?.functionalThresholdPace || '8:30';
          // Unified maxHR via shared helper (Phase 4o.daily.22).
          const maxHR       = getEffectiveMaxHR(profile, activities);
          const thresholdHR = parseFloat(profile?.thresholdHR) || null;
          const todayActs = activities.filter(a => a.date === td());
          const runs = todayActs.filter(isRunAct);
          if (runs.length) {
            const best = runs.reduce((b, r) => (r.durationSecs || 0) > (b.durationSecs || 0) ? r : b, runs[0]);
            runMetrics = computeRTSS({
              durationSecs: best.durationSecs,
              avgPaceRaw:   best.avgPaceRaw,
              avgHR:        best.avgHeartRate || best.avgHR,
              ftpPace, maxHR, thresholdHR,
            });
          }

          // ── Strength quality metrics (Phase 4o.daily.21) ──
          // Mirror of runMetrics for lift days. Three values, same shape
          // as Pace/Effort/Efficiency so the hero stays consistent.
          //   Density — tonnage/min if a template matches, else reps/min.
          //   W:R     — totalRest/totalWork from FIT set messages, tagged
          //             with the energy-system tier (Power/Hyper/Endurance).
          //   Effort  — avgHR/maxHR percent with the same Easy/Aerobic/
          //             Tempo/Threshold/VO2 zones used for run Effort.
          const strengths = todayActs.filter(isStrengthAct);
          if (strengths.length) {
            const best = strengths.reduce((b, s) => (s.durationSecs || 0) > (b.durationSecs || 0) ? s : b, strengths[0]);

            // Density — tonnage/min preferred, reps/min fallback
            let density = null, densityUnit = '';
            try {
              const templates = storage.get('strengthTemplates') || [];
              const tpl = matchTemplate(best, templates);
              const bw = parseFloat(profile?.targetWeight) || parseFloat(profile?.weight) || 175;
              if (tpl && tpl.type !== 'hyrox') {
                const { totalTonnage } = computeTonnage(tpl, null, bw);
                const d = computeDensity(totalTonnage, best.durationSecs);
                if (d) { density = d.toLocaleString(); densityUnit = 'lb/min'; }
              }
            } catch {}
            if (density == null && best.totalReps && best.durationSecs) {
              const rpm = best.totalReps / (best.durationSecs / 60);
              density = rpm.toFixed(1);
              densityUnit = 'reps/min';
            }

            // Work:Rest ratio
            let wr = null, wrTier = null, wrColor = null;
            if (best.totalWorkSecs && best.totalRestSecs) {
              const restPerWork = best.totalRestSecs / best.totalWorkSecs;
              wr = `1:${restPerWork.toFixed(1)}`;
              if (restPerWork > 5)        { wrTier = 'Power';       wrColor = '#a78bfa'; }
              else if (restPerWork > 1.5) { wrTier = 'Hypertrophy'; wrColor = '#fbbf24'; }
              else                        { wrTier = 'Endurance';   wrColor = '#4ade80'; }
            }

            // Effort — same zone palette as run Effort, anchored to maxHR
            let effortPct = null, effortTier = null, effortColor = null;
            const sAvgHR = best.avgHR || best.avgHeartRate;
            if (sAvgHR && maxHR) {
              const pct = sAvgHR / maxHR;
              effortPct = `${Math.round(pct * 100)}%`;
              if (pct < 0.65)      { effortTier = 'Easy';      effortColor = '#4ade80'; }
              else if (pct < 0.80) { effortTier = 'Aerobic';   effortColor = '#4ade80'; }
              else if (pct < 0.92) { effortTier = 'Tempo';     effortColor = '#fbbf24'; }
              else if (pct < 1.00) { effortTier = 'Threshold'; effortColor = '#fb923c'; }
              else                 { effortTier = 'VO2/Race';  effortColor = '#f87171'; }
            }

            strengthMetrics = {
              density, densityUnit,
              wr, wrTier, wrColor,
              effortPct, effortTier, effortColor,
              setsCount:  best.setsCount  || null,
              totalReps:  best.totalReps  || null,
            };
          }

          acr = computeAcuteChronicRatio(activities, td(), ftpPace, maxHR) || acr;

          // 30-day EF baseline — averages efficiency factor across the
          // user's last 30 logged runs (excluding today). Used to flag
          // today's EF as trending up / typical / down so the user can
          // tell whether the run was efficient relative to their norm.
          const today = td();
          const pastRuns = activities
            .filter(a => isRunAct(a) && a.avgPaceRaw && (a.avgHeartRate || a.avgHR)
                        && a.durationSecs && a.date && a.date < today)
            .slice(-30);
          if (pastRuns.length >= 3) {
            const efs = pastRuns
              .map(r => computeRTSS({
                durationSecs: r.durationSecs, avgPaceRaw: r.avgPaceRaw,
                avgHR: r.avgHeartRate || r.avgHR,
                ftpPace, maxHR, thresholdHR,
              }).efficiencyFactor)
              .filter(v => v != null && isFinite(v));
            if (efs.length >= 3) ef30Avg = efs.reduce((s,v) => s+v, 0) / efs.length;
          }
        } catch {}
        const scoreColor = (s) => s >= 70 ? '#4ade80' : s >= 45 ? '#fbbf24' : '#f87171';

        // ── Adaptive gauge — rTSS on run/mixed days, Tonnage on
        //    strength/hyrox days, REST otherwise. The gauge is the
        //    single "today's load" reading, regardless of session
        //    modality, so strength days don't render an empty gauge.
        const isStrengthDay = sessionType === 'strength' || sessionType === 'hyrox';
        const isRunDay      = sessionType === 'run' || sessionType === 'mixed';
        let gaugeLabel = 'rTSS';
        let gaugeUnit  = '';
        let gaugeValue = 0;
        let gaugeMax   = 200;
        let gaugeBreaks = [50, 100, 150];
        let gaugeZoneNames = ['EASY','MODERATE','HARD','OVERREACHING'];
        if (isStrengthDay && sessionMetric?.label === 'Tonnage') {
          const raw = parseInt(String(sessionMetric.value).replace(/[^\d]/g,''), 10) || 0;
          gaugeLabel = 'Tonnage';
          gaugeUnit  = 'lbs';
          gaugeValue = raw;
          gaugeMax   = 25000;
          gaugeBreaks = [5000, 12000, 18000];
          gaugeZoneNames = ['LIGHT','MODERATE','HARD','HEAVY'];
        } else if (sessionMetric?.label === 'rTSS' || sessionMetric?.label === 'Load') {
          // Phase 4r.viz.26 — single HR-anchored methodology. Always display
          // as "rTSS" since users recognize that term, but the number under
          // the hood is hrTSS (duration × IF_hr²).
          gaugeLabel = 'rTSS';
          gaugeValue = Number(sessionMetric.value) || 0;
        }

        // ── Speedometer geometry (parameterised by gaugeMax/breaks) ──
        const cx = 100, cy = 100, R = 80;
        const angleFor = v => 180 + (Math.min(Math.max(v, 0), gaugeMax) / gaugeMax) * 180;
        const polar = (deg, radius=R) => {
          const rad = (deg * Math.PI) / 180;
          return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
        };
        const arcPath = (v0, v1, radius=R) => {
          const a0 = angleFor(v0), a1 = angleFor(v1);
          const p0 = polar(a0, radius), p1 = polar(a1, radius);
          const large = (a1 - a0) > 180 ? 1 : 0;
          return `M ${p0.x} ${p0.y} A ${radius} ${radius} 0 ${large} 1 ${p1.x} ${p1.y}`;
        };
        const zoneEasy = '#4ade80', zoneMod = '#60a5fa', zoneHard = '#fbbf24', zoneOver = '#f87171';
        const zoneColors = [zoneEasy, zoneMod, zoneHard, zoneOver];
        const [b1, b2, b3] = gaugeBreaks;
        const zoneIdx =
          gaugeValue >= b3 ? 3 :
          gaugeValue >= b2 ? 2 :
          gaugeValue >= b1 ? 1 :
          gaugeValue >  0  ? 0 : -1;
        const needleColor = zoneIdx >= 0 ? zoneColors[zoneIdx] : 'var(--text-muted)';
        const needleEnd = polar(angleFor(gaugeValue), R - 6);
        const zoneLabel = zoneIdx >= 0 ? gaugeZoneNames[zoneIdx] : 'REST';

        // Display-formatted gauge value: thousands separator for tonnage,
        // round int for rTSS.
        const gaugeDisplay = gaugeValue
          ? (gaugeMax >= 10000 ? gaugeValue.toLocaleString() : Math.round(gaugeValue))
          : '—';

        // ── Coaching prompts (top 2) — Daily shows TODAY-actionable
        // prompts only. Long-arc weight/pace/calibration prompts live on
        // EdgeIQ where the multi-week trend belongs:
        //   • pillar 'calibration'   → energy-balance audit lines
        //   • id 'cut-pace-*'        → "On-pace -0.55 lb/wk" weight rate
        //   • id 'cut-pace-fast'     → losing-too-fast warning
        //   • id 'weight-stalled'    → 4-week stall callout
        //   • id 'cal-below-rmr'     → goal-vs-RMR calibration
        // Pull a wider slice (8) and filter so we never short-fill.
        const longArcIds = new Set([
          'cut-pace-good', 'cut-pace-slow', 'cut-pace-fast',
          'weight-stalled', 'cal-below-rmr',
        ]);
        // Pull a wider slice and split by pillar so the right prompts
        // surface in the right context (Phase 4o.mobile.4):
        //   topPrompts        → desktop hero (everything except long-arc)
        //   trainingPrompts   → Play screen (no nutrition pillar)
        //   nutritionPrompts  → Fuel screen (nutrition pillar only)
        let topPrompts = [], trainingPrompts = [], nutritionPrompts = [];
        try {
          const all = (getTopCoachingPrompts(12) || [])
            .filter(p => p.pillar !== 'calibration' && !longArcIds.has(p.id));
          topPrompts        = all.slice(0, 2);
          trainingPrompts   = all.filter(p => p.pillar !== 'nutrition').slice(0, 1);
          nutritionPrompts  = all.filter(p => p.pillar === 'nutrition').slice(0, 1);
        } catch {}
        const colorFor = sev =>
          sev === 'critical' ? '#f87171' :
          sev === 'warning'  ? '#fbbf24' :
          sev === 'positive' ? '#4ade80' :
                               '#60a5fa';

        // ── Mobile compact hero (Phase 4o.mobile.1) ──
        // Same signal as desktop, but stacked vertically to fit Play /
        // Fuel narrow viewports. Speedometer + readiness rings on top
        // row, narrative + quality metrics + coaching beneath. Renders
        // on activity AND nutrition mobile views so both screens get
        // the same "what's today's load and how should I act on it"
        // anchor at the top.
        if (mobileView === 'activity' || mobileView === 'nutrition') {
          // Mobile hero — condensed single-band design (Phase 4o.mobile.3).
          // Activity panel below already carries the rich session detail,
          // so the hero only needs to anchor: today's state (readiness +
          // load/cal-summary + A:C) and one coaching nudge. Total height
          // target ~110-130px instead of the ~250px earlier draft.
          const isFuel = mobileView === 'nutrition';
          // Compute nutrition snapshot for Fuel cells.
          const fuel = (() => {
            try {
              const totals = nutDailyTotals(td()) || { calories: 0, protein: 0 };
              const dyn = getDynamicMacroTarget();
              const calT = dyn?.dynamicTarget ?? resolveCalorieTarget(todayStr, profile);
              const proT = dyn?.proteinG       ?? (parseFloat(profile?.dailyProteinTarget) || 150);
              return {
                calLeft: Math.max(0, Math.round(calT - (totals.calories || 0))),
                proLeft: Math.max(0, Math.round(proT - (totals.protein  || 0))),
                calT, proT,
                earned: dyn?.isTrainingDay ? Math.round(dyn.eatBackKcal || 0) : 0,
                isTrainingDay: !!dyn?.isTrainingDay,
              };
            } catch { return null; }
          })();

          // Mini ring helper — uses SVG text with dominantBaseline=central
          // so the number sits truly centered in the ring (the previous
          // div+inset pattern drifted ~1-2px due to font baseline).
          const MiniRing = ({ val, label, size = 32 }) => {
            const r = (size - 6) / 2;
            const C = 2 * Math.PI * r;
            const cx = size / 2, cy = size / 2;
            return (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="3"/>
                  <circle cx={cx} cy={cy} r={r} fill="none"
                    stroke={scoreColor(val)} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${(val/100)*C} ${C}`} transform={`rotate(-90 ${cx} ${cy})`}/>
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                    fontSize={size >= 36 ? 12 : 11} fontWeight="700"
                    fill="var(--text-primary)">{val || '—'}</text>
                </svg>
                <span style={{ fontSize:8, color:'var(--text-muted)', lineHeight:1, fontWeight:600, letterSpacing:'0.04em' }}>{label}</span>
              </div>
            );
          };

          // Render: separate Play and Fuel structures so each is
          // focused on its own story (Phase 4o.mobile.4):
          //   Play  → training-anchored: rings + Load + A:C ratio +
          //           training-pillar coaching prompt
          //   Fuel  → nutrition-anchored: cal/protein/earned trio +
          //           fuel-progress narrative + nutrition-pillar coaching
          //   No more shared cross-context coaching, no orphan rings on
          //   Fuel without a corresponding training anchor.
          if (isFuel) {
            const fuelPctConsumed = fuel && fuel.calT
              ? Math.round(((fuel.calT - fuel.calLeft) / fuel.calT) * 100)
              : null;
            return (
              <section style={{
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                marginBottom: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}>
                {/* ── Three-cell nutrition anchor row ── */}
                {fuel && (
                  <div style={{ display:'flex', gap:10, alignItems:'stretch' }}>
                    {[
                      { v: fuel.calLeft.toLocaleString(),
                        lbl: 'Cal Left',
                        sub: `of ${fuel.calT.toLocaleString()}` },
                      { v: `${fuel.proLeft}g`,
                        lbl: 'Protein Left',
                        sub: `of ${fuel.proT}g` },
                      { v: fuel.isTrainingDay ? `+${fuel.earned}` : '—',
                        lbl: 'Earned',
                        sub: fuel.isTrainingDay ? 'from session' : 'rest day',
                        color: fuel.isTrainingDay ? '#4ade80' : 'var(--text-primary)' },
                    ].map(c => (
                      <div key={c.lbl} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:2, minWidth:0 }}>
                        <span style={{ fontSize:15, fontWeight:700, color: c.color || 'var(--text-primary)', lineHeight:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%' }}>{c.v}</span>
                        <span style={{ fontSize:9, color:'var(--text-secondary)', fontWeight:600, letterSpacing:'0.04em', textTransform:'uppercase' }}>{c.lbl}</span>
                        <span style={{ fontSize:8.5, color:'var(--text-muted)', lineHeight:1.2 }}>{c.sub}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Compact fuel narrative ── */}
                {fuel && fuelPctConsumed != null && (
                  <div style={{ fontSize:10, color:'var(--text-secondary)', lineHeight:1.4 }}>
                    Fueled {fuelPctConsumed}% of today's
                    {fuel.isTrainingDay ? ' training-day' : ''} target
                    {fuel.isTrainingDay ? ` (+${fuel.earned} from session)` : ''}.
                    {fuelPctConsumed < 50  ? ' Anchor the next meal.' :
                     fuelPctConsumed < 90  ? ' On pace — stay consistent.' :
                     fuelPctConsumed < 110 ? ' At target.' :
                                              ' Past target — lighter dinner.'}
                  </div>
                )}

                {/* ── Single nutrition coaching prompt ── */}
                {nutritionPrompts.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:5, paddingTop:6, borderTop:'0.5px solid var(--border-subtle)' }}>
                    {nutritionPrompts.map(p => {
                      const c = colorFor(p.severity);
                      return (
                        <div key={p.id} style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:10, lineHeight:1.4 }}>
                          <span aria-hidden style={{ width:5, height:5, borderRadius:'50%', background:c, flexShrink:0, marginTop:4 }}/>
                          <span style={{ minWidth:0 }}>
                            <span style={{ fontWeight:600, color:c }}>{p.title}</span>
                            <span style={{ color:'var(--text-muted)' }}> · {p.detail}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          }

          // ── Play (activity) hero ──
          // Phase 4r.race.2 — compute upcoming race for the in-Play race
          // card. Race card renders below the hero and disappears once
          // the race date has passed (parseLocalDate-based midnight diff
          // so it persists through race-day until midnight).
          const _playRaces = (() => {
            try { return JSON.parse(localStorage.getItem('arnold:races')||'[]'); }
            catch { return []; }
          })();
          const _todayMid = new Date(); _todayMid.setHours(0,0,0,0);
          // Phase 4r.play.1 — only surface the race card on Play tab
          // within the 7-day pre-race window. Outside that window the
          // race lives on the Calendar tab; surfacing it on Play
          // months out clutters the daily-action view.
          const _sevenDaysOut = new Date(_todayMid); _sevenDaysOut.setDate(_sevenDaysOut.getDate() + 7);
          const _upcomingPlayRace = _playRaces
            .filter(r => {
              const d = parseLocalDate(r.date);
              return d && d >= _todayMid && d <= _sevenDaysOut;
            })
            .sort((a,b) => parseLocalDate(a.date) - parseLocalDate(b.date))[0] || null;
          let _playSweatRate = null;
          if (_upcomingPlayRace) {
            try {
              const summary = summarizeRecentSignatures({
                activities: getUnifiedActivities(),
                weightHistory: storage.get('weight') || [],
                daysBack: 60,
              });
              _playSweatRate = summary?.summary?.sweatRate?.trimmed
                || summary?.summary?.sweatRate?.median
                || summary?.summary?.sweatRate?.mean
                || null;
            } catch {}
          }
          const _playProfile = { ...(storage.get('profile') || {}), ...getGoals() };
          const _playGoalPaceSecs = (() => {
            const p = _playProfile?.targetRacePace || '9:30';
            const [m, s] = String(p).split(':').map(Number);
            return m * 60 + (s || 0);
          })();
          const _playFmtPace = secs => {
            if (!secs || !Number.isFinite(secs)) return '—';
            const m = Math.floor(secs / 60);
            const s = Math.round(secs % 60);
            return `${m}:${String(s).padStart(2,'0')}`;
          };

          return (
            <>
            <section style={{
              background: 'var(--bg-surface)',
              border: '0.5px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              marginBottom: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}>
              {/* Phase 4r.viz.26 — single row: speedometer LEFT, rings + A:C
                  ratio RIGHT. No duplicate rTSS number — the speedometer
                  itself shows the value. */}
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <svg width="100" height="60" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet" style={{flexShrink:0}}>
                  <path d={arcPath(0,  b1)}        stroke={zoneEasy} strokeWidth="10" fill="none" opacity={zoneIdx>0?0.35:zoneIdx===0?1:0.35}/>
                  <path d={arcPath(b1, b2)}        stroke={zoneMod}  strokeWidth="10" fill="none" opacity={zoneIdx>1?0.35:zoneIdx===1?1:0.35}/>
                  <path d={arcPath(b2, b3)}        stroke={zoneHard} strokeWidth="10" fill="none" opacity={zoneIdx>2?0.35:zoneIdx===2?1:0.35}/>
                  <path d={arcPath(b3, gaugeMax)}  stroke={zoneOver} strokeWidth="10" fill="none" opacity={zoneIdx===3?1:0.35}/>
                  {[0, b1, b2, b3, gaugeMax].map(v=>{
                    const inner = polar(angleFor(v), R-13);
                    const outer = polar(angleFor(v), R-3);
                    return <line key={v} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--border-subtle)" strokeWidth="0.6"/>;
                  })}
                  <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y} stroke={needleColor} strokeWidth="2.5" strokeLinecap="round"/>
                  <circle cx={cx} cy={cy} r="4" fill={needleColor}/>
                  <text x={cx} y={cy - 22} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text-primary)">{gaugeDisplay}</text>
                  <text x={cx} y={cy - 6} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--text-muted)" letterSpacing="0.06em">rTSS</text>
                </svg>
                <MiniRing val={r7Score}  label="7d"/>
                <MiniRing val={r30Score} label="30d"/>
                {acr.ratio != null && (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start',
                    marginLeft:'auto', paddingLeft:10, borderLeft:'0.5px solid var(--border-subtle)' }}>
                    <div style={{ display:'flex', alignItems:'baseline', gap:4 }}>
                      <span style={{ fontSize:13, fontWeight:600, color: ZONE_COLORS[acr.zone] }}>{acr.ratio}</span>
                      <span style={{ fontSize:8.5, color: ZONE_COLORS[acr.zone] }}>{ZONE_LABELS[acr.zone]}</span>
                    </div>
                    <span style={{ fontSize:8.5, color:'var(--text-muted)', marginTop:2 }}>A:C ratio</span>
                  </div>
                )}
              </div>

              {/* ── Compact training narrative ── */}
              {(() => {
                const tier =
                  r7Score >= 80 ? 'strong'  :
                  r7Score >= 65 ? 'solid'   :
                  r7Score >= 50 ? 'mixed'   :
                  r7Score >  0  ? 'fragile' : null;
                const delta = r7Score - r30Score;
                const trendClause =
                  delta >=  6 ? `up ${delta} on 30d`     :
                  delta <= -6 ? `${Math.abs(delta)} off 30d` :
                                `steady on 30d`;
                if (!tier) return null;
                let acrClause = '';
                if (acr.ratio != null) {
                  if (acr.zone === 'overreaching')        acrClause = ' · ramping fast — protect recovery.';
                  else if (acr.zone === 'danger')         acrClause = ' · injury risk — back off.';
                  else if (acr.zone === 'undertraining') acrClause = ' · load dropped — rebuild.';
                }
                return (
                  <div style={{ fontSize:10, color:'var(--text-secondary)', lineHeight:1.4 }}>
                    Readiness {r7Score} — {tier}, {trendClause}{acrClause}
                  </div>
                );
              })()}

              {/* ── Single training coaching prompt ── */}
              {trainingPrompts.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:5, paddingTop:6, borderTop:'0.5px solid var(--border-subtle)' }}>
                  {trainingPrompts.map(p => {
                    const c = colorFor(p.severity);
                    return (
                      <div key={p.id} style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:10, lineHeight:1.4 }}>
                        <span aria-hidden style={{ width:5, height:5, borderRadius:'50%', background:c, flexShrink:0, marginTop:4 }}/>
                        <span style={{ minWidth:0 }}>
                          <span style={{ fontWeight:600, color:c }}>{p.title}</span>
                          <span style={{ color:'var(--text-muted)' }}> · {p.detail}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Phase 4r.race.2 — Race card on Play tab. Renders only
                for mobileView='activity' (Play), only when there's an
                upcoming race that hasn't passed yet. Auto-disappears the
                day after race day. The card carries the same expandable
                fueling+hydration plan as the EdgeIQ/web RaceFocusCard. */}
            {mobileView === 'activity' && _upcomingPlayRace && (
              <div style={{ marginBottom: 10 }}>
                <RaceFocusCard
                  race={_upcomingPlayRace}
                  goalPaceSecs={_playGoalPaceSecs}
                  avgPace30={null}
                  fmtPace={_playFmtPace}
                  planned={null}
                  plannedTypeLabel={null}
                  profile={_playProfile}
                  sweatRateLbsPerHr={_playSweatRate}
                  mobile={true}
                />
              </div>
            )}
            </>
          );
        }
        // Other mobile views (none today) — no hero
        if (mobileView) return null;

        return (
          <section style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'clamp(10px,1vw,14px) clamp(12px,1.2vw,16px)',
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: '120px minmax(0,1.25fr) minmax(0,1fr)',
            gap: 'clamp(8px,1vw,12px)',
            alignItems: 'start',
            minWidth: 0,
          }}>
            {/* ── COL 1 · Adaptive speedometer ──
                Run/mixed days  → rTSS gauge (0–200, threshold-anchored).
                Strength/hyrox  → Tonnage gauge (0–25k lbs).
                Rest day        → needle parked at 0, label "REST".
                Long-form caption ("100 = 1 hr at threshold" / "lbs ·
                sets×reps×weight") moved to a hover tooltip on the column
                itself (Phase 4o.daily.18) so the hero band stays narrow. */}
            <div title={gaugeLabel === 'Tonnage'
                ? "Today's strength volume in pounds — sets × reps × weight summed across every exercise. Bigger lifts and longer sessions stack."
                : gaugeLabel === 'Load'
                ? "Today's training load (HR-derived) — for strength sessions without a template, we use duration × HR-relative-to-threshold² × 100. Same 0-200 scale as rTSS so it reads consistently."
                : "Today's run training load. rTSS = duration × intensity² scaled so 100 = 1 hour at lactate threshold. A long Z2 run can score high here even when the pace felt easy because the duration stacks the stress."}
              style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, minWidth:0, cursor:'help' }}>
              <svg width="100%" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet"
                   style={{ maxWidth: 130 }}>
                {/* zone arcs (easy → over) — opacity dims the inactive zones */}
                <path d={arcPath(0,  b1)}        stroke={zoneEasy} strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx>0?0.35:zoneIdx===0?1:0.35}/>
                <path d={arcPath(b1, b2)}        stroke={zoneMod}  strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx>1?0.35:zoneIdx===1?1:0.35}/>
                <path d={arcPath(b2, b3)}        stroke={zoneHard} strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx>2?0.35:zoneIdx===2?1:0.35}/>
                <path d={arcPath(b3, gaugeMax)}  stroke={zoneOver} strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx===3?1:0.35}/>

                {/* tick marks at zone boundaries */}
                {[0, b1, b2, b3, gaugeMax].map(v=>{
                  const inner = polar(angleFor(v), R-13);
                  const outer = polar(angleFor(v), R-3);
                  return <line key={v} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                    stroke="var(--border-subtle)" strokeWidth="0.6"/>;
                })}

                {/* needle */}
                <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y}
                  stroke={needleColor} strokeWidth="2.5" strokeLinecap="round"/>
                <circle cx={cx} cy={cy} r="4" fill={needleColor}/>

                {/* center value + metric label */}
                <text x={cx} y={cy-22} textAnchor="middle" fontSize={gaugeMax >= 10000 ? "16" : "22"} fontWeight="700"
                  fill="var(--text-primary)" style={{ fontFamily:'var(--font-ui)' }}>
                  {gaugeDisplay}
                </text>
                <text x={cx} y={cy-8} textAnchor="middle" fontSize="8" letterSpacing="0.1em"
                  fill="var(--text-muted)" style={{ fontFamily:'var(--font-ui)' }}>
                  {gaugeLabel}{gaugeUnit ? ` · ${gaugeUnit}` : ''}
                </text>
              </svg>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: needleColor, marginTop: -4,
              }}>
                {zoneLabel}
              </div>
              {/* Inline caption removed Phase 4o.daily.18 — full
                  explanation lives in the parent column's hover tooltip. */}
            </div>

            {/* ── COL 2 · Training Readiness · wider, no domain dupe ──
                Domain breakdown (Activity/Nutrition/Body) was removed
                Phase 4o.daily.14 — that's already the headline of EdgeIQ.
                What stays here: the rings, A:C, run pace quality, and a
                short narrative interpreting the readiness for today. */}
            <div style={{ display:'flex', flexDirection:'column', gap:7, minWidth:0,
              borderLeft: '0.5px solid var(--border-subtle)', paddingLeft: 12 }}>
              {/* Header — single line, no right-side subtitle (the
                  narrative below explains what readiness measures). */}
              <div style={{ fontSize:9, fontWeight:600, color:'var(--text-muted)',
                letterSpacing:'0.08em', textTransform:'uppercase', whiteSpace:'nowrap' }}>
                Training Readiness
              </div>

              {/* Rings + A:C + run metrics laid out HORIZONTALLY in one row
                  so the column packs vertically tight. Each cluster is its
                  own micro-section with the value(s) on top and a label
                  beneath. */}
              <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                {/* 7d + 30d rings */}
                {[
                  { val: r7Score,  label: '7-day',  caption: 'weighted' },
                  { val: r30Score, label: '30-day', caption: 'trend'    },
                ].map(ring => {
                  const C = 2 * Math.PI * 17;
                  return (
                    <div key={ring.label} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                      <div style={{ position:'relative', width:40, height:40, flexShrink:0 }}>
                        <svg width="40" height="40" viewBox="0 0 40 40">
                          <circle cx="20" cy="20" r="17" fill="none" stroke="var(--bg-elevated)" strokeWidth="3.5"/>
                          <circle cx="20" cy="20" r="17" fill="none"
                            stroke={scoreColor(ring.val)} strokeWidth="3.5" strokeLinecap="round"
                            strokeDasharray={`${(ring.val/100)*C} ${C}`} transform="rotate(-90 20 20)"/>
                        </svg>
                        <div style={{ position:'absolute', inset:0, display:'flex',
                          alignItems:'center', justifyContent:'center' }}>
                          <span style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', lineHeight:1 }}>
                            {ring.val || '—'}
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize:8.5, color:'var(--text-secondary)', fontWeight:600, lineHeight:1 }}>{ring.label}</span>
                    </div>
                  );
                })}

                {/* A:C ratio inline */}
                {acr.ratio != null && (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:1,
                    paddingLeft:10, borderLeft:'0.5px solid var(--border-subtle)' }}>
                    <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
                      <span style={{ fontSize:13, fontWeight:600, color: ZONE_COLORS[acr.zone] }}>{acr.ratio}</span>
                      <span style={{ fontSize:8.5, color: ZONE_COLORS[acr.zone] }}>{ZONE_LABELS[acr.zone]}</span>
                    </div>
                    <span style={{ fontSize:8.5, color:'var(--text-muted)', letterSpacing:'0.05em' }}>A:C ratio</span>
                  </div>
                )}

                {/* ── Session quality metrics (Phase 4o.daily.21) ──
                    Same three-tile rhythm regardless of session modality:
                      Run days     → Pace · Effort · Efficiency
                      Strength days → Density · W:R · Effort
                    The values change but the visual shape and tier-color
                    semantics stay constant, so the hero feels coherent
                    whether you logged a run, a lift, or both. */}
                {(() => {
                  let cells = null;

                  if (runMetrics && runMetrics.rTSS) {
                    const IF = runMetrics.intensityFactor;
                    const EF = runMetrics.efficiencyFactor;
                    let effortTier, effortColor;
                    if (IF == null) { effortTier = '—'; effortColor = 'var(--text-muted)'; }
                    else if (IF < 0.65) { effortTier = 'Easy';      effortColor = '#4ade80'; }
                    else if (IF < 0.80) { effortTier = 'Aerobic';   effortColor = '#4ade80'; }
                    else if (IF < 0.92) { effortTier = 'Tempo';     effortColor = '#fbbf24'; }
                    else if (IF < 1.00) { effortTier = 'Threshold'; effortColor = '#fb923c'; }
                    else                { effortTier = 'VO2/Race';  effortColor = '#f87171'; }

                    let efVerdict = 'baseline still loading';
                    let efColor = 'var(--text-muted)';
                    if (EF != null && ef30Avg) {
                      const pct = (EF - ef30Avg) / ef30Avg;
                      if (pct >= 0.06)       { efVerdict = `↑ ${Math.round(pct*100)}% vs 30d avg`; efColor = '#4ade80'; }
                      else if (pct <= -0.06) { efVerdict = `↓ ${Math.round(Math.abs(pct)*100)}% vs 30d avg`; efColor = '#fbbf24'; }
                      else                   { efVerdict = `near 30d avg (${ef30Avg.toFixed(2)})`; efColor = 'var(--text-secondary)'; }
                    } else if (EF == null) {
                      efVerdict = 'needs HR';
                    }

                    cells = [
                      { v: runMetrics.ngpPace || '—', lbl: 'Pace',
                        sub: 'graded', subColor: 'var(--text-muted)' },
                      { v: IF ?? '—', lbl: 'Effort', sub: effortTier, subColor: effortColor,
                        tooltip: runMetrics.ifSource === 'hr'
                          ? `IF ${IF} = ${Math.round(IF*100)}% of threshold HR (HR-based — your easy pace ran faster than your effort).`
                          : `IF ${IF} = ${Math.round(IF*100)}% of threshold pace (pace-based — set max HR in profile to switch to HR).`
                      },
                      { v: EF ?? '—', lbl: 'Efficiency', sub: efVerdict, subColor: efColor,
                        tooltip: ef30Avg
                          ? `Efficiency = pace ÷ HR. Today ${EF}, 30-day avg ${ef30Avg.toFixed(2)}. Rising over weeks at the same effort = aerobic engine improving.`
                          : 'Efficiency = pace ÷ HR. Need ≥3 past runs with HR to compare to your baseline.'
                      },
                    ];
                  } else if (strengthMetrics) {
                    const sm = strengthMetrics;
                    const setsLine = sm.setsCount && sm.totalReps ? `${sm.setsCount} sets · ${sm.totalReps} reps` : '';

                    cells = [
                      { v: sm.density ?? '—',
                        lbl: 'Density',
                        sub: sm.densityUnit || 'volume/min',
                        subColor: 'var(--text-muted)',
                        tooltip: sm.densityUnit === 'lb/min'
                          ? `Tonnage per minute (sets × reps × weight ÷ duration). ${setsLine}`
                          : sm.densityUnit === 'reps/min'
                          ? `Reps per minute — fallback when no strength template matches this session. ${setsLine} Add a template in Workouts to upgrade to lb/min.`
                          : 'No volume data available for this session.'
                      },
                      { v: sm.wr ?? '—',
                        lbl: 'W:R',
                        sub: sm.wrTier || 'no lap data',
                        subColor: sm.wrColor || 'var(--text-muted)',
                        tooltip: sm.wr
                          ? `Work:Rest ratio ${sm.wr} — ${sm.wrTier} energy system. >1:5 = power/phosphagen, 1:1.5–5 = hypertrophy/glycolytic, <1:1.5 = endurance/oxidative.`
                          : 'Work:Rest ratio needs typed set/rest segments from the FIT — older watches without lap-button discipline can\'t supply this.'
                      },
                      { v: sm.effortPct ?? '—',
                        lbl: 'Effort',
                        sub: sm.effortTier || 'needs HR',
                        subColor: sm.effortColor || 'var(--text-muted)',
                        tooltip: sm.effortPct
                          ? `Avg HR as percent of max HR. ${sm.effortTier} zone — same tiering as run Effort so the colour reads the same across modalities.`
                          : 'Effort needs avg HR + a maxHR estimate. Profile maxHR not set.'
                      },
                    ];
                  }

                  if (!cells) return null;
                  return (
                    <div style={{ display:'flex', gap:14, paddingLeft:12,
                      borderLeft:'0.5px solid var(--border-subtle)' }}>
                      {cells.map(c => (
                        <div key={c.lbl} title={c.tooltip || ''}
                          style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', lineHeight:1 }}>{c.v}</span>
                          <span style={{ fontSize:10, color:'var(--text-secondary)', fontWeight:500 }}>{c.lbl}</span>
                          <span style={{ fontSize:9, color: c.subColor, lineHeight:1.2 }}>{c.sub}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ── Readiness narrative ──
                  This is the one block where the abstract numbers get
                  translated into English. It always names:
                    1. the score and a quality tier (strong/solid/mixed/fragile)
                    2. how the 7d compares to the 30d baseline
                    3. the dominant + lagging domain when the spread is real
                    4. the A:C ramp-rate state and what to do about it
                  No generic filler — every clause is tied to the actual data. */}
              {(() => {
                const tier =
                  r7Score >= 80 ? 'strong'  :
                  r7Score >= 65 ? 'solid'   :
                  r7Score >= 50 ? 'mixed'   :
                  r7Score >  0  ? 'fragile' : null;
                const delta = r7Score - r30Score;
                let trendClause;
                if (delta >=  6) trendClause = `up ${delta} pts on the 30-day baseline`;
                else if (delta <= -6) trendClause = `${Math.abs(delta)} pts off the 30-day baseline`;
                else                  trendClause = `right on the 30-day baseline`;

                const headline = tier
                  ? `Readiness ${r7Score} — ${tier}, ${trendClause}.`
                  : `No readiness yet — log a few days to bootstrap.`;

                // Domain driver (uses the score breakdown internally; we
                // never print the raw 0–100 numbers, only the names).
                const ds = [
                  ['activity',  domains.activity ],
                  ['nutrition', domains.nutrition],
                  ['body',      domains.body     ],
                ].filter(([,v]) => v != null);
                let driverClause = '';
                if (ds.length >= 2) {
                  ds.sort((a,b) => b[1] - a[1]);
                  const [topName, topVal] = ds[0];
                  const [botName, botVal] = ds[ds.length - 1];
                  const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
                  if (topVal - botVal >= 15) {
                    driverClause = ` ${cap(topName)} is doing the lifting; ${botName} is the lever to push higher.`;
                  } else if (topVal >= 75) {
                    driverClause = ' All three pillars in shape.';
                  } else if (topVal < 60) {
                    driverClause = ' All three pillars middling — pick one to focus on.';
                  }
                }

                // A:C context — always carries the ratio number so the
                // claim is verifiable, plus a what-to-do tail.
                let acrClause = '';
                if (acr.ratio != null) {
                  if (acr.zone === 'overreaching')   acrClause = ` Load is ramping fast (A:C ${acr.ratio}) — green-light if recovery is on point, fragile if not.`;
                  else if (acr.zone === 'danger')    acrClause = ` Load is in injury territory (A:C ${acr.ratio}) — back off this week.`;
                  else if (acr.zone === 'undertraining') acrClause = ` Load has dropped (A:C ${acr.ratio}) — fine for a deload, rebuild after.`;
                  else if (acr.zone === 'optimal')   acrClause = ` Load ramp is in the sweet spot (A:C ${acr.ratio}).`;
                }

                return (
                  <div style={{ fontSize:10.5, color:'var(--text-secondary)', lineHeight:1.5,
                    paddingTop:6, borderTop:'0.5px solid var(--border-subtle)' }}>
                    {headline}{driverClause}{acrClause}
                  </div>
                );
              })()}
            </div>

            {/* ── COL 3 · Coaching prompts + calibration ── */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, minWidth:0,
              borderLeft: '0.5px solid var(--border-subtle)', paddingLeft: 12 }}>
              {/* Prompts wrap onto multiple lines so the full coaching text
                  reads — the old single-line ellipsis truncation hid most
                  of the detail (Phase 4o.daily.12 fix). */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                {topPrompts.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0, marginTop: 5, opacity: 0.7 }}/>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600, color: '#4ade80' }}>All clear</span>
                      <span style={{ color: 'var(--text-muted)' }}> · No flagged prompts. Keep the data flowing.</span>
                    </span>
                  </div>
                ) : topPrompts.map(p => {
                  const c = colorFor(p.severity);
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, lineHeight: 1.4, minWidth: 0 }}>
                      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0, marginTop: 5 }}/>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600, color: c }}>{p.title}</span>
                        <span style={{ color: 'var(--text-muted)' }}> · {p.detail}</span>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Calibration row (BEHIND/ON PACE/AHEAD + drift/ETA) removed
                  Phase 4o.daily.13 — that signal is the headline of EdgeIQ
                  and was duplicated here. The Daily hero now reads as
                  "today's load + readiness + actionable coaching", and
                  long-arc weight-trend lives on EdgeIQ. */}
            </div>
          </section>
        );
      })()}

      {/* Mobile coaching strips removed (Phase 4o.mobile.1) — the
          mobile Daily Hero above now carries the top-2 coaching prompts
          alongside the speedometer and readiness rings, so the
          standalone strips were redundant. */}

      {/* `minmax(0, 1fr)` lets each column actually shrink with the viewport
          (default `1fr` = `minmax(auto, 1fr)` won't shrink below content
          intrinsic size, which caused horizontal overflow on narrow widths). */}
      <div className="arnold-daily-grid" style={{display:'grid',gridTemplateColumns:mobileView?'1fr':'minmax(0,1fr) minmax(0,1fr)',gap:'clamp(8px,1vw,12px)',alignItems:'start'}}>

        {/* ── LEFT: Activity (show in desktop or mobileView=activity) ── */}
        {mobileView!=='nutrition'&&<div style={{minWidth:0}}>
          {/* Coaching now lives in the Daily Hero rail at the top of the
              page — single source of truth. Per-panel coaching strip
              removed (Phase 4o.daily.8). */}

          {!fitData?(
            <div style={panelStyle}>
              {/* Header — title + Garmin sync button so the user can pull
                  today's runs without leaving the page. Mirrors the
                  Nutrition panel's "Sync Cronometer" header for parity.
                  Phase 4o.daily.19 — restored after the fitData-gated
                  button disappeared on a fresh day with no activity yet. */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
                <span style={{fontSize:15,fontWeight:500,color:'var(--text-primary)'}}>Activity</span>
                {/* Subtle ghost-style sync button (Phase 4o.mobile.3) — no
                    filled background by default; only tints on done/error. */}
                <button
                  onClick={handleGarminSync}
                  disabled={syncFitState==='syncing'}
                  style={{
                    fontSize:10,fontWeight:500,padding:'3px 8px',borderRadius:6,flexShrink:0,
                    background: syncFitState==='done'  ? 'rgba(74,222,128,0.08)'
                              : syncFitState==='error' ? 'rgba(248,113,113,0.08)'
                              : 'transparent',
                    color: syncFitState==='done'  ? '#4ade80'
                         : syncFitState==='error' ? '#f87171'
                         : 'var(--text-secondary, var(--text-muted))',
                    border:`0.5px solid ${syncFitState==='done' ? 'rgba(74,222,128,0.25)' : syncFitState==='error' ? 'rgba(248,113,113,0.25)' : 'var(--border-subtle, rgba(255,255,255,0.08))'}`,
                    cursor:syncFitState==='syncing'?'wait':'pointer',
                    letterSpacing:'0.02em',
                  }}
                  title="Pull latest FIT activities from the Garmin Worker"
                >
                  {syncFitState==='syncing' ? '↻ Syncing…' : syncFitState==='done' ? '✓ Synced' : syncFitState==='error' ? '✗ Failed' : '↻ Sync'}
                </button>
              </div>
              <div style={{textAlign:'center',padding:'24px 0',color:'var(--text-muted)',fontSize:12}}>
                No activity logged yet today — sync Garmin or upload a .fit file.
              </div>
            </div>
          ):<>
            {/* Day summary strip — shown when there are 2+ activities. Includes
                a Split / Merged toggle so the user can flip between smart-grouped
                cards (hard sessions solo, easy runs / strength aggregated) and
                one-card-per-activity. */}
            {fitDataList.length>1&&(
              <div style={{...panelStyle,marginBottom:8}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:10}}>
                  <span style={{fontSize:14,fontWeight:500,color:'var(--text-primary)'}}>Today · {fitDataList.length} {fitDataList.length===1?'activity':'activities'}</span>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <button
                      onClick={()=>setSplitView(v=>!v)}
                      style={{
                        fontSize:9,fontWeight:600,padding:'4px 9px',borderRadius:6,
                        background:splitView?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.04)',
                        color:splitView?'#60a5fa':'var(--text-muted)',
                        border:`0.5px solid ${splitView?'rgba(96,165,250,0.3)':'var(--border-default)'}`,
                        cursor:'pointer',letterSpacing:'0.04em',textTransform:'uppercase',
                      }}
                      title="Toggle between merged (smart grouping) and split (every session as its own card)"
                    >
                      {splitView?'⊟ Merge':'⊞ Split'}
                    </button>
                    <span style={{fontSize:10,color:'var(--text-muted)'}}>cumulative</span>
                  </div>
                </div>
                <div style={{display:'flex',gap:5}}>
                  {[
                    {label:'total distance',val:fitTotals.distanceMi?`${fitTotals.distanceMi.toFixed(2)} mi`:'—'},
                    {label:'total time',val:fitTotals.durationSecs?fmtDurTotal(fitTotals.durationSecs):'—'},
                    {label:'total calories',val:fitTotals.calories?`${Math.round(fitTotals.calories)}`:'—'},
                    {label:'sessions',val:fitDataList.length},
                  ].map(m=>(
                    <div key={m.label} style={miniTile}>
                      <div style={miniVal}>{m.val}</div>
                      <div style={miniLbl}>{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fitGroups.map((fd,idx)=>(
              <div key={`${fd?._groupKey||idx}`} style={{...panelStyle,marginBottom:fitGroups.length>1&&idx<fitGroups.length-1?8:panelStyle.marginBottom}}>
                {/* Header — title + source badge + (desktop only) date.
                    Desktop: badge + date inline with the title.
                    Mobile (Phase 4o.mobile.5): title + sync button on top
                    row, Garmin-FIT badge stacked beneath title at smaller
                    font, date dropped (it's already in the "ACTIVITY ·
                    2026-05-04" screen header). */}
                {(() => {
                  const badgeLabel = fd.isHIIT ? 'HIIT'
                                   : fd.isRun ? 'Run'
                                   : fd.isMobility ? 'Mobility'
                                   : fd.isStrength ? 'Strength'
                                   : (fd.activityType || 'Activity');
                  const badgeColor = fd.isHIIT ? '#fb7185'
                                   : fd.isRun ? '#60a5fa'
                                   : fd.isMobility ? '#22d3ee'
                                   : '#a78bfa';
                  const sourceBadge = (
                    <span style={{fontSize: mobileView ? 8 : 9, fontWeight:500, padding: mobileView ? '1px 6px' : '2px 8px', borderRadius:10, background:`${badgeColor}1f`, color:badgeColor, whiteSpace:'nowrap', letterSpacing:'0.02em'}}>
                      {badgeLabel} · Garmin FIT{fd._groupCount>1?` · cumulative`:''}
                    </span>
                  );
                  const syncBtn = idx===0 && (
                    <button
                      onClick={handleGarminSync}
                      disabled={syncFitState==='syncing'}
                      style={{
                        fontSize:10,fontWeight:500,padding:'3px 8px',borderRadius:6,flexShrink:0,
                        background: syncFitState==='done'  ? 'rgba(74,222,128,0.08)'
                                  : syncFitState==='error' ? 'rgba(248,113,113,0.08)'
                                  : 'transparent',
                        color: syncFitState==='done'  ? '#4ade80'
                             : syncFitState==='error' ? '#f87171'
                             : 'var(--text-secondary, var(--text-muted))',
                        border:`0.5px solid ${syncFitState==='done' ? 'rgba(74,222,128,0.25)' : syncFitState==='error' ? 'rgba(248,113,113,0.25)' : 'var(--border-subtle, rgba(255,255,255,0.08))'}`,
                        cursor:syncFitState==='syncing'?'wait':'pointer',
                        letterSpacing:'0.02em',
                      }}
                      title="Pull latest FIT activities from the Garmin Worker"
                    >
                      {syncFitState==='syncing' ? '↻ Syncing…' : syncFitState==='done' ? '✓ Synced' : syncFitState==='error' ? '✗ Failed' : '↻ Sync'}
                    </button>
                  );

                  if (mobileView) {
                    // Phase 4r.viz.6 — title row collapsed to a single line.
                    // Was: [Run]                           [Sync]
                    //      [Run · Garmin FIT]
                    // Now: [HIIT  Run·Garmin FIT]         [Sync]
                    // Also: use HIIT as the title when the activity is HIIT
                    // (was incorrectly saying "Run" because HIIT inherits
                    // isRun=true for shared rendering).
                    const _titleLabel = fd.isHIIT ? 'HIIT'
                                       : fd.isRun ? 'Run'
                                       : fd.isStrength ? 'Strength'
                                       : fd.isMobility ? 'Mobility'
                                       : fd.isCycle ? 'Cycle'
                                       : fd.isSwim ? 'Swim'
                                       : fd.isWalk ? 'Walk'
                                       : 'Activity';
                    return (
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',minWidth:0}}>
                          <span style={{fontSize:14,fontWeight:500,color:'var(--text-primary)'}}>
                            {_titleLabel}{fd._groupCount>1?` · ${fd._groupCount} sessions`:''}
                          </span>
                          {sourceBadge}
                        </div>
                        {syncBtn}
                      </div>
                    );
                  }

                  return (
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,gap:8,flexWrap:'wrap'}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap',minWidth:0}}>
                        <span style={{fontSize:15,fontWeight:500,color:'var(--text-primary)'}}>{fd.isHIIT?'HIIT':fd.isRun?'Run':fd.isStrength?'Strength':fd.isMobility?'Mobility':fd.isCycle?'Cycle':fd.isSwim?'Swim':fd.isWalk?'Walk':'Activity'}{fd._groupCount>1?` · ${fd._groupCount} sessions`:''}</span>
                        {sourceBadge}
                        <span style={{fontSize:9,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{fd.date} · {fd.time}</span>
                      </div>
                      {syncBtn}
                    </div>
                  );
                })()}

                {/* Phase 4r.viz.11 — Plan-driven profile render. Single
                    block handles ALL activity types. planType from today's
                    plan (when it matches) drives Row 1 + Row 2 metric sets.
                    Row 3 (hydration) is universal per user spec. */}
                {(()=>{
                  // Phase 4r.viz.11 — planType is computed from today's plan
                  // when the activity discipline matches; else defaults from
                  // activity flags.
                  const _plannedToday = (typeof todayPlanned === 'function') ? todayPlanned() : null;
                  const planType = _resolvePlanType(fd, _plannedToday);
                  const { row1, row2 } = _buildActivityProfile(planType, fd);
                  const _typeLabels = {
                    easy_run:'Easy run', long_run:'Long run',
                    tempo:'Tempo', intervals:'Intervals',
                    hiit:'HIIT', strength:'Strength',
                    mobility:'Mobility', cycle:'Cycle',
                    cross:'Cross-train', swim:'Swim',
                    walk:'Walk', race:'Race',
                  };
                  return (
                    <>
                      {row1.length > 0 && (
                        <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:14,flexWrap:'wrap'}}>
                          {row1.map((t, i) => (
                            <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                              value={t.value} trend={t.trend} tint={t.tint}/>
                          ))}
                        </div>
                      )}
                      {row2.length > 0 && (
                        <>
                          <div style={divider}/>
                          <div style={subHdr}>{_typeLabels[planType] || 'Metrics'}</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {row2.map((t, i) => (
                              <IconMiniTile key={i} icon={t.icon} color={t.color}
                                value={t.value} label={t.label}/>
                            ))}
                          </div>
                        </>
                      )}
                      <HydrationRow fd={fd}/>
                      {idx===fitGroups.length-1 && (
                        <ReplenishTracker fd={fd} dateStr={todayStr}
                          onGoToFuel={setTab?()=>setTab('nutrition_mobile'):undefined}/>
                      )}
                      {idx===fitGroups.length-1 && (()=>{
                        const acts=getUnifiedActivities();
                        const monday=new Date();
                        const dow=monday.getDay();
                        monday.setDate(monday.getDate()-(dow===0?6:dow-1));
                        monday.setHours(0,0,0,0);
                        if (planType === 'strength') {
                          const wk=acts.filter(a=>isStrengthAct(a)&&a.date&&new Date(a.date+'T12:00:00')>=monday);
                          const cnt=wk.length;
                          const mins=wk.reduce((s,a)=>s+(a.durationSecs||0),0)/60;
                          const tgt=parseFloat(profile?.weeklyStrengthTarget)||2;
                          const minTgt=parseFloat(profile?.weeklyStrengthMinutesTarget)||60;
                          return <>
                            <div style={divider}/>
                            <div style={subHdr}>Vs Goal</div>
                            <MiniBar label="Sessions this week" displayValue={`${cnt} / ${tgt}`} goalLabel={`Goal: ${tgt}/week`} pct={cnt/tgt}/>
                            <MiniBar label="Strength minutes" displayValue={`${Math.round(mins)} / ${minTgt} min`} goalLabel={`Goal: ${minTgt} min/week`} pct={mins/minTgt}/>
                          </>;
                        }
                        if (planType === 'mobility') {
                          const wkMob=acts.filter(a=>(a.isMobility||/mobility|stretch|yoga|pilates/i.test(a.activityType||''))&&a.date&&new Date(a.date+'T12:00:00')>=monday);
                          const wkMins=wkMob.reduce((s,a)=>s+(a.durationSecs||0),0)/60;
                          const tgt=parseFloat(profile?.weeklyMobilityTarget)||45;
                          return <>
                            <div style={divider}/>
                            <div style={subHdr}>Vs Goal</div>
                            <MiniBar label="Mobility minutes" displayValue={`${Math.round(wkMins)} / ${tgt} min`} goalLabel={`Goal: ${tgt} min/week`} pct={wkMins/tgt}/>
                          </>;
                        }
                        return <>
                          <div style={divider}/>
                          <div style={subHdr}>Vs Goal</div>
                          {fd.avgPacePerMi && (
                            <MiniBar label="Pace vs target"
                              displayValue={`${fd.avgPacePerMi} /mi`}
                              goalLabel={`Goal: ${profile?.targetRacePace||'9:30'} /mi`}
                              pct={pacePctFn(fd.avgPacePerMi,profile?.targetRacePace)}/>
                          )}
                          <MiniBar label="Weekly miles"
                            displayValue={`${weeklyMiles.toFixed(1)} / ${profile?.weeklyRunDistanceTarget||20} mi`}
                            goalLabel={`Goal: ${profile?.weeklyRunDistanceTarget||20} mi/week`}
                            pct={weeklyMiles/(parseFloat(profile?.weeklyRunDistanceTarget)||20)}/>
                        </>;
                      })()}
                    </>
                  );
                })()}

                {/* Phase 4r.viz.5 — Hero metric tiles, dynamically filtered.
                    Only render tiles for which the activity actually carries
                    data. HIIT runs (no distance/pace/cadence) get a leaner
                    row with just the HR + duration tiles; outdoor runs get
                    the full 5-tile set. This replaces the prior all-or-
                    nothing layout where missing fields rendered as "—". */}
                {false&&fd.isRun&&(()=>{
                  const _avgHRNum = safeN(fd.avgHR,'avgHR');
                  const _cadNum = safeN(fd.avgCadence,'avgCadence');
                  const _voNum = fd.avgVerticalOscillation || null;
                  const paceToSec = p => {
                    if (!p || typeof p !== 'string') return null;
                    const m = p.match(/(\d+):(\d{1,2})/);
                    if (!m) return null;
                    return parseInt(m[1])*60 + parseInt(m[2]);
                  };
                  const _paceSec = paceToSec(fd.avgPacePerMi);
                  const paceBase = (() => {
                    const samples = (allActs||[]).filter(a => a !== fd && a.isRun && a.avgPacePerMi).map(a => paceToSec(a.avgPacePerMi)).filter(Number.isFinite);
                    if (samples.length < 3) return null;
                    const s = samples.sort((x,y)=>x-y); return s[Math.floor(s.length/2)];
                  })();
                  const hrBase = sameTypeBaseline(allActs, fd, 'avgHR');
                  const cadBase = sameTypeBaseline(allActs, fd, 'avgCadence');
                  const voBase = sameTypeBaseline(allActs, fd, 'avgVerticalOscillation');
                  // Build tile list dynamically.
                  const tiles = [];
                  // For HIIT, duration is more meaningful than distance,
                  // so we substitute the lead tile.
                  if (fd.isHIIT && !fd.distanceMi) {
                    tiles.push({ icon:'clock-hour-4', color:'#94a3b8', label:'Duration',
                      value: fd.duration || '—', tint:'rgba(148,163,184,0.06)' });
                  } else if (fd.distanceMi) {
                    tiles.push({ icon:'route', color:'#60a5fa', label:'Distance · mi',
                      value: fd.distanceMi.toFixed(1), tint:'rgba(96,165,250,0.06)' });
                  }
                  if (fd.avgPacePerMi) {
                    tiles.push({ icon:'stopwatch', color:'#4ade80', label:'Pace · /mi',
                      value: fd.avgPacePerMi, trend: computeTrend(_paceSec, paceBase, 'lower-better'),
                      tint:'rgba(74,222,128,0.06)' });
                  }
                  if (_avgHRNum) {
                    tiles.push({ icon:'heartbeat', color:'#f87171', label:'Avg HR · bpm',
                      value: safeDisp(fd.avgHR,'avgHR'), trend: computeTrend(_avgHRNum, hrBase, 'lower-better'),
                      tint:'rgba(248,113,113,0.06)' });
                  }
                  if (_cadNum) {
                    tiles.push({ icon:'shoe', color:'#a78bfa', label:'Cadence · spm',
                      value: safeDisp(fd.avgCadence,'avgCadence'), trend: computeTrend(_cadNum, cadBase, 'higher-better'),
                      tint:'rgba(167,139,250,0.06)' });
                  }
                  if (_voNum) {
                    tiles.push({ icon:'wave-sine', color:'#fbbf24', label:'Vert osc · cm',
                      value: _voNum.toFixed(1), trend: computeTrend(_voNum, voBase, 'lower-better'),
                      tint:'rgba(251,191,36,0.06)' });
                  }
                  // Phase 4r.viz.8 — pad hero to ~5 tiles by pulling from
                  // a universal-metrics pool when the watch didn't record
                  // distance/pace/cadence/vert-osc (HIIT-style workouts
                  // Garmin labels as sport=running).
                  // Phase 4r.viz.10 — track which keys got added so the
                  // detail row below can skip them and not duplicate.
                  const heroKeysUsed = new Set();
                  if (tiles.length < 4) {
                    if (fd.duration && fd.duration !== '—' && !tiles.find(t => t.label?.startsWith('Distance'))) {
                      tiles.unshift({ icon:'clock-hour-4', color:'#94a3b8', label:'Duration',
                        value: fd.duration, tint:'rgba(148,163,184,0.06)' });
                      heroKeysUsed.add('duration');
                    }
                  }
                  if (tiles.length < 5) {
                    if (fd.calories) {
                      tiles.push({ icon:'flame', color:'#fb923c', label:'Calories',
                        value: String(fd.calories), tint:'rgba(251,146,60,0.06)' });
                      heroKeysUsed.add('calories');
                    }
                  }
                  if (tiles.length < 5) {
                    const te = fd.aerobicTrainingEffect ?? fd.aerobicTE;
                    if (te) {
                      tiles.push({ icon:'target-arrow', color:'#4ade80', label:'Aero TE',
                        value: te.toFixed(1), tint:'rgba(74,222,128,0.06)' });
                      heroKeysUsed.add('aeroTE');
                    }
                  }
                  if (tiles.length < 5) {
                    const anaerTE = fd.anaerobicTrainingEffect ?? fd.anaerobicTE;
                    if (anaerTE) {
                      tiles.push({ icon:'activity', color:'#fb7185', label:'Anaer TE',
                        value: anaerTE.toFixed(1), tint:'rgba(251,113,133,0.06)' });
                      heroKeysUsed.add('anaerTE');
                    }
                  }
                  // Stash on fd so the detail-row IIFE below can read it
                  // and skip duplicates.
                  fd._heroKeysUsed = heroKeysUsed;
                  if (tiles.length === 0) return null;
                  return (
                    <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:14,flexWrap:'wrap'}}>
                      {tiles.map((t, i) => (
                        <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                          value={t.value} trend={t.trend} tint={t.tint}/>
                      ))}
                    </div>
                  );
                })()}

                {/* Strength: 5 dials parallel to runs */}
                {/* Phase 4r.viz.7 — Strength hero migrated to icon-tile style.
                    KRIs: Duration · Sets · Reps · Avg HR · Anaer TE
                    Phase 4r.viz.11 — disabled, replaced by unified profile-driven
                    render at the top of this block. */}
                {false&&fd.isStrength&&(()=>{
                  const movSecs=fd.movingTimeSecs||fd.durationSecs;
                  const movMins=movSecs?Math.round(movSecs/60):null;
                  const fmtHMS=s=>{if(s==null)return'—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;};
                  const _avgHRNum = safeN(fd.avgHR,'avgHR');
                  const anaerTE = fd.anaerobicTrainingEffect ?? fd.anaerobicTE;
                  const tiles = [];
                  if (movMins) tiles.push({ icon:'clock-hour-4', color:'#94a3b8',
                    label:'Duration', value: fmtHMS(movSecs), tint:'rgba(148,163,184,0.06)' });
                  if (fd.setsCount) tiles.push({ icon:'barbell', color:'#a78bfa',
                    label:'Sets', value: String(fd.setsCount), tint:'rgba(167,139,250,0.06)' });
                  if (fd.totalReps) tiles.push({ icon:'repeat', color:'#fbbf24',
                    label:'Reps', value: String(fd.totalReps), tint:'rgba(251,191,36,0.06)' });
                  if (_avgHRNum) tiles.push({ icon:'heartbeat', color:'#f87171',
                    label:'Avg HR · bpm', value: safeDisp(fd.avgHR,'avgHR'),
                    tint:'rgba(248,113,113,0.06)' });
                  if (anaerTE) tiles.push({ icon:'activity', color:'#fb7185',
                    label:'Anaer TE', value: anaerTE.toFixed(1),
                    tint:'rgba(251,113,133,0.06)' });
                  if (tiles.length === 0) return null;
                  return (
                    <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:14,flexWrap:'wrap'}}>
                      {tiles.map((t, i) => (
                        <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                          value={t.value} tint={t.tint}/>
                      ))}
                    </div>
                  );
                })()}

                {/* Phase 4r.viz.5 — Lower metrics with dynamic filtering.
                    Phase 4r.viz.11 — disabled, replaced by unified profile-driven
                    render at the top of this block. */}
                {false&&fd.isRun&&(()=>{
                  const _maxHRNum = safeN(fd.maxHR,'maxHR');
                  const te = fd.aerobicTrainingEffect ?? fd.aerobicTE;
                  const anaerTE = fd.anaerobicTrainingEffect ?? fd.anaerobicTE;
                  // Phase 4r.viz.10 — skip metrics that the hero already shows
                  // (set by the hero IIFE above). Prevents Duration/Calories/
                  // Aero TE from appearing twice when hero padded with them.
                  const heroSkip = fd._heroKeysUsed || new Set();
                  const tiles = [];
                  if (!heroSkip.has('duration') && fd.duration && fd.duration !== '—') {
                    tiles.push({ icon:'clock-hour-4', color:'#94a3b8',
                      value: fd.duration, label:'duration' });
                  }
                  if (_maxHRNum) {
                    tiles.push({ icon:'heart-rate-monitor', color:'#f87171',
                      value: safeDisp(fd.maxHR,'maxHR'), label:'max HR' });
                  }
                  if (fd.totalAscentFt) {
                    tiles.push({ icon:'mountain', color:'#94a3b8',
                      value: `${fd.totalAscentFt} ft`, label:'elevation' });
                  }
                  if (!heroSkip.has('calories') && fd.calories) {
                    tiles.push({ icon:'flame', color:'#fb923c',
                      value: String(fd.calories), label:'calories' });
                  }
                  if (fd.avgPowerW) {
                    tiles.push({ icon:'bolt', color:'#fbbf24',
                      value: `${fd.avgPowerW} W`, label:'avg power' });
                  }
                  if (fd.maxPowerW) {
                    tiles.push({ icon:'bolt', color:'#fbbf24',
                      value: `${fd.maxPowerW} W`, label:'max power' });
                  }
                  if (!heroSkip.has('aeroTE') && te) {
                    tiles.push({ icon:'target-arrow', color:'#4ade80',
                      value: te.toFixed(1), label:'aero TE' });
                  }
                  if (fd.isHIIT && !heroSkip.has('anaerTE') && anaerTE) {
                    tiles.push({ icon:'target-arrow', color:'#fbbf24',
                      value: anaerTE.toFixed(1), label:'anaer TE' });
                  } else if (!fd.isHIIT && fd.maxCadence) {
                    tiles.push({ icon:'shoe', color:'#a78bfa',
                      value: String(fd.maxCadence), label:'max cad' });
                  }
                  if (tiles.length === 0) return null;
                  // Render in rows of 4 max. Each row uses flex: 1 children so
                  // the last row's tiles fill the row even if it has < 4.
                  const rows = [];
                  for (let i = 0; i < tiles.length; i += 4) rows.push(tiles.slice(i, i + 4));
                  return (
                    <>
                      <div style={divider}/>
                      <div style={subHdr}>{fd.isHIIT ? 'HIIT metrics' : 'Run metrics'}</div>
                      {rows.map((row, ri) => (
                        <div key={ri} style={{display:'flex',gap:6,marginBottom: ri < rows.length - 1 ? 6 : 0}}>
                          {row.map((t, i) => (
                            <IconMiniTile key={i} icon={t.icon} color={t.color}
                              value={t.value} label={t.label}/>
                          ))}
                        </div>
                      ))}
                    </>
                  );
                })()}
                {fd.isRun&&<>

                  {/* Phase 4r.viz.33 — legacy fd.isRun block fully retired.
                      HydrationRow, ReplenishTracker, AND Vs Goal are all
                      rendered by the per-discipline activity card above
                      (line ~6338) which correctly routes by planType.
                      Keeping them here too caused duplicate Replenishment
                      AND duplicate Vs Goal sections on HIIT/Run cards. */}
                </>}

                {/* Phase 4r.viz.7 — Strength detail uses icon mini tiles in
                    rows of 4, dynamically filtered. Shared icons across
                    disciplines for Duration/Max HR/Calories/Aero TE. */}
                {false&&fd.isStrength&&<>
                  <div style={divider}/>
                  <div style={subHdr}>Strength metrics</div>
                  {(()=>{
                    const movSecs=fd.movingTimeSecs||fd.durationSecs;
                    const fmtHMS=s=>{if(s==null)return'—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;};
                    const _maxHRNum = safeN(fd.maxHR,'maxHR');
                    const te = fd.aerobicTrainingEffect ?? fd.aerobicTE;
                    const anaerTE = fd.anaerobicTrainingEffect ?? fd.anaerobicTE;
                    // hrTSS fallback when Garmin doesn't emit TSS for strength.
                    let tssVal = fd.trainingStressScore;
                    let tssDerived = false;
                    if (!tssVal) {
                      const mhr = getEffectiveMaxHR(profile, getUnifiedActivities());
                      const { hrTSS } = computeHrTSS({
                        durationSecs: fd.durationSecs,
                        avgHR:        fd.avgHR || fd.avgHeartRate,
                        maxHR:        mhr,
                        thresholdHR:  parseFloat(profile?.thresholdHR) || null,
                      });
                      if (hrTSS) { tssVal = hrTSS; tssDerived = true; }
                    }
                    const tiles = [];
                    if (_maxHRNum) tiles.push({ icon:'heart-rate-monitor', color:'#f87171',
                      value: safeDisp(fd.maxHR,'maxHR'), label:'max HR' });
                    if (fd.calories) tiles.push({ icon:'flame', color:'#fb923c',
                      value: String(fd.calories), label:'calories' });
                    if (te) tiles.push({ icon:'target-arrow', color:'#4ade80',
                      value: te.toFixed(1), label:'aero TE' });
                    if (tssVal) tiles.push({ icon:'activity', color:'#a78bfa',
                      value: Math.round(tssVal).toString(), label: tssDerived ? 'TSS*' : 'TSS' });
                    if (fd.bodyBatteryDrain) tiles.push({ icon:'gauge', color:'#94a3b8',
                      value: `-${fd.bodyBatteryDrain}`, label:'body batt' });
                    if (tiles.length === 0) return null;
                    const rows = [];
                    for (let i = 0; i < tiles.length; i += 4) rows.push(tiles.slice(i, i + 4));
                    return (
                      <>
                        {rows.map((row, ri) => (
                          <div key={ri} style={{display:'flex',gap:6,marginBottom: ri < rows.length - 1 ? 6 : 0}}>
                            {row.map((t, i) => (
                              <IconMiniTile key={i} icon={t.icon} color={t.color}
                                value={t.value} label={t.label}/>
                            ))}
                          </div>
                        ))}
                      </>
                    );
                  })()}

                  <HydrationRow fd={fd}/>
                  {idx===fitGroups.length-1&&<ReplenishTracker fd={fd} dateStr={todayStr} onGoToFuel={setTab?()=>setTab('nutrition_mobile'):undefined}/>}

                  {/* Vs goal MiniBars — only on last panel to avoid duplicate weekly stats */}
                  {idx===fitGroups.length-1&&(()=>{
                    const acts=getUnifiedActivities();
                    const monday=new Date();const dow=monday.getDay();monday.setDate(monday.getDate()-(dow===0?6:dow-1));monday.setHours(0,0,0,0);
                    const wkStrength=acts.filter(a=>isStrengthAct(a)&&a.date&&new Date(a.date+'T12:00:00')>=monday);
                    const wkCount=wkStrength.length;
                    const wkMins=wkStrength.reduce((s,a)=>s+(a.durationSecs||0),0)/60;
                    const target=parseFloat(profile?.weeklyStrengthTarget)||2;
                    const minTarget=parseFloat(profile?.weeklyStrengthMinutesTarget)||60;
                    return<>
                      <div style={divider}/>
                      <div style={subHdr}>Vs Goal</div>
                      <MiniBar label="Sessions this week"
                        displayValue={`${wkCount} / ${target}`}
                        goalLabel={`Goal: ${target}/week`}
                        pct={wkCount/target}/>
                      <MiniBar label="Strength minutes"
                        displayValue={`${Math.round(wkMins)} / ${minTarget} min`}
                        goalLabel={`Goal: ${minTarget} min/week`}
                        pct={wkMins/minTarget}/>
                    </>;
                  })()}
                </>}

                {/* Phase 4r.viz.7 — Mobility branch. Sparse by design.
                    Hero: Duration · Avg HR · Calories · Focus
                    No hydration (low-intensity, no sweat).
                    Vs Goal: Weekly mobility minutes. */}
                {false&&fd.isMobility&&(()=>{
                  const movSecs = fd.movingTimeSecs || fd.durationSecs;
                  const movMins = movSecs ? Math.round(movSecs/60) : null;
                  const _avgHRNum = safeN(fd.avgHR,'avgHR');
                  const tiles = [];
                  if (movMins) tiles.push({ icon:'lotus', color:'#a78bfa',
                    label:'Duration', value: `${movMins} min`,
                    tint:'rgba(167,139,250,0.06)' });
                  if (_avgHRNum) tiles.push({ icon:'heartbeat', color:'#f87171',
                    label:'Avg HR · bpm', value: safeDisp(fd.avgHR,'avgHR'),
                    tint:'rgba(248,113,113,0.06)' });
                  if (fd.calories) tiles.push({ icon:'flame', color:'#fb923c',
                    label:'Calories', value: String(fd.calories),
                    tint:'rgba(251,146,60,0.06)' });
                  if (tiles.length === 0) return null;
                  return (
                    <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:14,flexWrap:'wrap'}}>
                      {tiles.map((t, i) => (
                        <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                          value={t.value} tint={t.tint}/>
                      ))}
                    </div>
                  );
                })()}
                {false&&fd.isMobility&&idx===fitGroups.length-1&&(()=>{
                  const acts=getUnifiedActivities();
                  const monday=new Date();const dow=monday.getDay();monday.setDate(monday.getDate()-(dow===0?6:dow-1));monday.setHours(0,0,0,0);
                  const wkMob=acts.filter(a=>(a.isMobility||/mobility|stretch|yoga|pilates/i.test(a.activityType||''))&&a.date&&new Date(a.date+'T12:00:00')>=monday);
                  const wkMins=wkMob.reduce((s,a)=>s+(a.durationSecs||0),0)/60;
                  const target=parseFloat(profile?.weeklyMobilityTarget)||45;
                  return<>
                    <div style={divider}/>
                    <div style={subHdr}>Vs Goal</div>
                    <MiniBar label="Mobility minutes"
                      displayValue={`${Math.round(wkMins)} / ${target} min`}
                      goalLabel={`Goal: ${target} min/week`}
                      pct={wkMins/target}/>
                  </>;
                })()}

                {/* Phase 4r.viz.7 — Cycle branch.
                    Hero: Distance · Avg speed · Avg HR · Avg power · Cadence
                    + Hydration. Vs Goal: Weekly bike miles. */}
                {false&&fd.isCycle&&(()=>{
                  const distMi = fd.distanceMi;
                  const durHr = fd.durationSecs ? fd.durationSecs / 3600 : null;
                  const avgSpeed = (distMi && durHr) ? distMi / durHr : null;
                  const _avgHRNum = safeN(fd.avgHR,'avgHR');
                  const _cadNum = fd.avgCadence || null;
                  const tiles = [];
                  if (distMi) tiles.push({ icon:'bike', color:'#60a5fa',
                    label:'Distance · mi', value: distMi.toFixed(1),
                    tint:'rgba(96,165,250,0.06)' });
                  if (avgSpeed) tiles.push({ icon:'gauge', color:'#22d3ee',
                    label:'Avg · mph', value: avgSpeed.toFixed(1),
                    tint:'rgba(34,211,238,0.06)' });
                  if (_avgHRNum) tiles.push({ icon:'heartbeat', color:'#f87171',
                    label:'Avg HR · bpm', value: safeDisp(fd.avgHR,'avgHR'),
                    tint:'rgba(248,113,113,0.06)' });
                  if (fd.avgPowerW) tiles.push({ icon:'bolt', color:'#fbbf24',
                    label:'Avg power · W', value: String(fd.avgPowerW),
                    tint:'rgba(251,191,36,0.06)' });
                  if (_cadNum) tiles.push({ icon:'repeat', color:'#a78bfa',
                    label:'Cadence · rpm', value: String(_cadNum),
                    tint:'rgba(167,139,250,0.06)' });
                  if (tiles.length === 0) return null;
                  return (
                    <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:14,flexWrap:'wrap'}}>
                      {tiles.map((t, i) => (
                        <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                          value={t.value} tint={t.tint}/>
                      ))}
                    </div>
                  );
                })()}
                {false&&fd.isCycle&&<>
                  <div style={divider}/>
                  <div style={subHdr}>Cycle metrics</div>
                  {(()=>{
                    const _maxHRNum = safeN(fd.maxHR,'maxHR');
                    const te = fd.aerobicTrainingEffect ?? fd.aerobicTE;
                    const tiles = [];
                    if (fd.duration && fd.duration !== '—') tiles.push({ icon:'clock-hour-4', color:'#94a3b8',
                      value: fd.duration, label:'duration' });
                    if (_maxHRNum) tiles.push({ icon:'heart-rate-monitor', color:'#f87171',
                      value: safeDisp(fd.maxHR,'maxHR'), label:'max HR' });
                    if (fd.totalAscentFt) tiles.push({ icon:'mountain', color:'#94a3b8',
                      value: `${fd.totalAscentFt} ft`, label:'elevation' });
                    if (fd.calories) tiles.push({ icon:'flame', color:'#fb923c',
                      value: String(fd.calories), label:'calories' });
                    if (fd.maxPowerW) tiles.push({ icon:'bolt', color:'#fbbf24',
                      value: `${fd.maxPowerW} W`, label:'max power' });
                    if (te) tiles.push({ icon:'target-arrow', color:'#4ade80',
                      value: te.toFixed(1), label:'aero TE' });
                    if (tiles.length === 0) return null;
                    const rows = [];
                    for (let i = 0; i < tiles.length; i += 4) rows.push(tiles.slice(i, i + 4));
                    return rows.map((row, ri) => (
                      <div key={ri} style={{display:'flex',gap:6,marginBottom: ri < rows.length - 1 ? 6 : 0}}>
                        {row.map((t, i) => (
                          <IconMiniTile key={i} icon={t.icon} color={t.color}
                            value={t.value} label={t.label}/>
                        ))}
                      </div>
                    ));
                  })()}
                  <HydrationRow fd={fd}/>
                </>}

                {/* Phase 4r.viz.7 — Swim branch.
                    Hero: Distance · Pace per 100 · Avg HR · Strokes · SWOLF
                    No hydration (pool). Vs Goal: Weekly swim distance. */}
                {false&&fd.isSwim&&(()=>{
                  const _avgHRNum = safeN(fd.avgHR,'avgHR');
                  // Pace per 100 derived from distance + duration when available.
                  const distM = fd.distanceKm ? fd.distanceKm * 1000
                              : (fd.distanceMi ? fd.distanceMi * 1609.34 : null);
                  const pacePer100 = (distM && fd.durationSecs)
                    ? (fd.durationSecs / (distM / 100))
                    : null;
                  const fmtPace = (s) => {
                    if (!s) return null;
                    const m = Math.floor(s / 60);
                    const ss = Math.round(s % 60);
                    return `${m}:${String(ss).padStart(2,'0')}`;
                  };
                  const tiles = [];
                  if (distM) tiles.push({ icon:'swim', color:'#22d3ee',
                    label: distM >= 1000 ? 'Distance · km' : 'Distance · m',
                    value: distM >= 1000 ? (distM/1000).toFixed(2) : String(Math.round(distM)),
                    tint:'rgba(34,211,238,0.06)' });
                  if (pacePer100) tiles.push({ icon:'stopwatch', color:'#4ade80',
                    label:'Pace · /100m', value: fmtPace(pacePer100),
                    tint:'rgba(74,222,128,0.06)' });
                  if (_avgHRNum) tiles.push({ icon:'heartbeat', color:'#f87171',
                    label:'Avg HR · bpm', value: safeDisp(fd.avgHR,'avgHR'),
                    tint:'rgba(248,113,113,0.06)' });
                  if (tiles.length === 0) return null;
                  return (
                    <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:14,flexWrap:'wrap'}}>
                      {tiles.map((t, i) => (
                        <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                          value={t.value} tint={t.tint}/>
                      ))}
                    </div>
                  );
                })()}
                {false&&fd.isSwim&&<>
                  <div style={divider}/>
                  <div style={subHdr}>Swim metrics</div>
                  {(()=>{
                    const _maxHRNum = safeN(fd.maxHR,'maxHR');
                    const te = fd.aerobicTrainingEffect ?? fd.aerobicTE;
                    const tiles = [];
                    if (fd.duration && fd.duration !== '—') tiles.push({ icon:'clock-hour-4', color:'#94a3b8',
                      value: fd.duration, label:'duration' });
                    if (_maxHRNum) tiles.push({ icon:'heart-rate-monitor', color:'#f87171',
                      value: safeDisp(fd.maxHR,'maxHR'), label:'max HR' });
                    if (fd.calories) tiles.push({ icon:'flame', color:'#fb923c',
                      value: String(fd.calories), label:'calories' });
                    if (te) tiles.push({ icon:'target-arrow', color:'#4ade80',
                      value: te.toFixed(1), label:'aero TE' });
                    if (tiles.length === 0) return null;
                    return (
                      <div style={{display:'flex',gap:6}}>
                        {tiles.map((t, i) => (
                          <IconMiniTile key={i} icon={t.icon} color={t.color}
                            value={t.value} label={t.label}/>
                        ))}
                      </div>
                    );
                  })()}
                </>}

                {/* Phase 4r.viz.7 — Walk/Hike branch.
                    Hero: Distance · Pace · Avg HR · Cadence · Elevation
                    + Hydration (esp. hiking). Vs Goal: Daily steps. */}
                {false&&fd.isWalk&&(()=>{
                  const _avgHRNum = safeN(fd.avgHR,'avgHR');
                  const _cadNum = safeN(fd.avgCadence,'avgCadence');
                  const tiles = [];
                  if (fd.distanceMi) tiles.push({ icon:'footprints', color:'#60a5fa',
                    label:'Distance · mi', value: fd.distanceMi.toFixed(1),
                    tint:'rgba(96,165,250,0.06)' });
                  if (fd.avgPacePerMi) tiles.push({ icon:'stopwatch', color:'#4ade80',
                    label:'Pace · /mi', value: fd.avgPacePerMi,
                    tint:'rgba(74,222,128,0.06)' });
                  if (_avgHRNum) tiles.push({ icon:'heartbeat', color:'#f87171',
                    label:'Avg HR · bpm', value: safeDisp(fd.avgHR,'avgHR'),
                    tint:'rgba(248,113,113,0.06)' });
                  if (_cadNum) tiles.push({ icon:'walk', color:'#a78bfa',
                    label:'Cadence · spm', value: safeDisp(fd.avgCadence,'avgCadence'),
                    tint:'rgba(167,139,250,0.06)' });
                  if (fd.totalAscentFt) tiles.push({ icon:'mountain', color:'#fbbf24',
                    label:'Elev · ft', value: String(fd.totalAscentFt),
                    tint:'rgba(251,191,36,0.06)' });
                  if (tiles.length === 0) return null;
                  return (
                    <div style={{display:'flex',justifyContent:'space-between',gap:6,marginBottom:14,flexWrap:'wrap'}}>
                      {tiles.map((t, i) => (
                        <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                          value={t.value} tint={t.tint}/>
                      ))}
                    </div>
                  );
                })()}
                {false&&fd.isWalk&&<>
                  <div style={divider}/>
                  <div style={subHdr}>Walk metrics</div>
                  {(()=>{
                    const _maxHRNum = safeN(fd.maxHR,'maxHR');
                    const te = fd.aerobicTrainingEffect ?? fd.aerobicTE;
                    const tiles = [];
                    if (fd.duration && fd.duration !== '—') tiles.push({ icon:'clock-hour-4', color:'#94a3b8',
                      value: fd.duration, label:'duration' });
                    if (_maxHRNum) tiles.push({ icon:'heart-rate-monitor', color:'#f87171',
                      value: safeDisp(fd.maxHR,'maxHR'), label:'max HR' });
                    if (fd.calories) tiles.push({ icon:'flame', color:'#fb923c',
                      value: String(fd.calories), label:'calories' });
                    if (te) tiles.push({ icon:'target-arrow', color:'#4ade80',
                      value: te.toFixed(1), label:'aero TE' });
                    if (tiles.length === 0) return null;
                    return (
                      <div style={{display:'flex',gap:6}}>
                        {tiles.map((t, i) => (
                          <IconMiniTile key={i} icon={t.icon} color={t.color}
                            value={t.value} label={t.label}/>
                        ))}
                      </div>
                    );
                  })()}
                  <HydrationRow fd={fd}/>
                </>}
              </div>
            ))}
          </>}
          {/* Today's Movement moved out of Activity column → summary
              footer row at the bottom of the page (Phase 4o.daily.9). */}
        </div>}

        {/* ── RIGHT: Nutrition (show in desktop or mobileView=nutrition) ── */}
        {mobileView!=='activity'&&<div style={{minWidth:0}}>
          {/* Coaching now lives in the Daily Hero rail at the top of the
              page — single source of truth. Per-panel coaching strip
              removed (Phase 4o.daily.8). */}

          {/* Phase 4r.viz.17 — Race-prep banner removed from Fuel tab per
              user request. Race fueling info lives on the Play race card. */}

          {/* ── Nutrition panel — header carries the Cronometer sync button
              and the dynamic Today's Target line, mirroring Activity's
              "Run · sync · date" header structure. ── */}
          <div>
            <NutritionInputPanel
              key={nutUploadKey}
              date={todayStr}
              headerSlot={(
                <button
                  onClick={handleCronoSync}
                  disabled={syncNutState==='syncing'}
                  style={{
                    fontSize:10,fontWeight:500,padding:'3px 8px',borderRadius:6,flexShrink:0,
                    background: syncNutState==='done'  ? 'rgba(74,222,128,0.08)'
                              : syncNutState==='error' ? 'rgba(248,113,113,0.08)'
                              : 'transparent',
                    color: syncNutState==='done'  ? '#4ade80'
                         : syncNutState==='error' ? '#f87171'
                         : 'var(--text-secondary, var(--text-muted))',
                    border:`0.5px solid ${syncNutState==='done' ? 'rgba(74,222,128,0.25)' : syncNutState==='error' ? 'rgba(248,113,113,0.25)' : 'var(--border-subtle, rgba(255,255,255,0.08))'}`,
                    cursor:syncNutState==='syncing'?'wait':'pointer',
                    letterSpacing:'0.02em',
                  }}
                  title="Pull today's nutrition from Cronometer"
                >
                  {syncNutState==='syncing' ? '↻ Syncing…' : syncNutState==='done' ? '✓ Synced' : syncNutState==='error' ? '✗ Failed' : '↻ Sync'}
                </button>
              )}
              onUpdate={()=>{
              // Refresh nutrition data from the new nutrition-log store
              try{
                const entries=(storage.get('nutritionLog')||[])
                  .filter(e=>e.date===todayStr);
                if(entries.length>0){
                  const tot={calories:0,protein:0,carbs:0,fat:0,fiber:0,sugar:0,water:0};
                  entries.forEach(e=>{
                    const s=e.servings||1;
                    ['calories','protein','carbs','fat','fiber','sugar','water'].forEach(k=>{
                      tot[k]+=(e.macros?.[k]||0)*s;
                    });
                  });
                  setTodayNutrition({...tot,date:todayStr,source:'nutrition-log'});
                }
              }catch{}
            }}/>
          </div>
        </div>}

      </div>

      {/* ═══ SUMMARY FOOTER (Phase 4o.daily.11) ═══════════════════════════
          Single-row narrow footer: Today's Movement (left, aligns with the
          Activity column above) and Notes (right, aligns with the Nutrition
          column above), equal height. The old full-width Score detail panel
          (rTSS factor pills, NGP/IF/EF tiles, A:C load) was absorbed into
          the hero — the rTSS speedometer is flanked by a compact stats column
          (7d/30d rings, A:C ratio, NGP/IF/EF) so the whole score story lives
          in one band. Eliminates the redundant Score box entirely.
          ═══════════════════════════════════════════════════════════════ */}

      {/* ── Movement | Notes — narrow side-by-side band (desktop) ── */}
      {!mobileView && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
          gap: 'clamp(8px,1vw,12px)',
          marginTop: 12,
          alignItems: 'stretch',
        }}>
          {/* LEFT — Today's Movement (aligns with Activity column) */}
          <div style={{...panelStyle, display: 'flex', flexDirection: 'column'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>Today's Movement</span>
              <span style={{fontSize:9,color:'var(--text-muted)'}}>
                {todayMovement?.source==='health_connect' ? 'Health Connect'
                 : todayMovement ? 'synced'
                 : 'no data — sync your phone'}
              </span>
            </div>
            {todayMovement ? (
              <div style={{display:'flex',gap:6,flex:1,alignItems:'center'}}>
                <div style={miniTile}>
                  <div style={{...miniVal,color:'#60a5fa'}}>{todayMovement.steps.toLocaleString()}</div>
                  <div style={miniLbl}>steps</div>
                </div>
                <div style={miniTile}>
                  <div style={{...miniVal,color:'#fbbf24'}}>{todayMovement.active>0?Math.round(todayMovement.active):'—'}</div>
                  <div style={miniLbl}>active kcal</div>
                </div>
                <div style={miniTile}>
                  <div style={{...miniVal,color:'#4ade80'}}>{todayMovement.total>0?Math.round(todayMovement.total):'—'}</div>
                  <div style={miniLbl}>total kcal</div>
                </div>
              </div>
            ) : (
              <div style={{fontSize:11,color:'var(--text-muted)',textAlign:'center',padding:'14px 0',flex:1,
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                Open the Arnold app on your Android phone and tap sync to populate daily movement.
              </div>
            )}
          </div>

          {/* RIGHT — Notes (aligns with Nutrition column) */}
          <div style={{...panelStyle, display: 'flex', flexDirection: 'column'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>Notes</span>
              <span style={{fontSize:10,color:'var(--text-muted)'}}>{ts}</span>
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="How did today feel? Energy, mood, reflection..."
              style={{...S.ta, minHeight: 44, marginBottom: 8, fontSize: 12, flex: 1}}/>
            <button style={{...S.sb, padding: '8px 12px', width: '100%', fontSize: 12}} onClick={handleSave}>
              {saveStatus === 'saved' ? '✓ Saved' : 'Save daily entry'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ Mobile Activity: compact notes + save ═══ */}
      {mobileView==='activity'&&(
        <div style={panelStyle}>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="How did today feel? Energy, mood, reflection..."
            style={{...S.ta,minHeight:50,marginBottom:8,fontSize:12}}/>
          <button style={{...S.sb,padding:'10px 14px',width:'100%'}} onClick={handleSave}>
            {saveStatus==='saved'?'\u2713 Saved':'Save daily entry'}
          </button>
        </div>
      )}

      {/* StackCard removed — hydration + stack now combined in DailyLogStrip inside NutritionInput */}
    </div>
  );
}

// ─── Workout Log ──────────────────────────────────────────────────────────────
const WORKOUT_TYPES=["Run (outdoor)","Run (treadmill)","Strength","Cycling","Other"];

// SVG document icon used in upload drop zones
const DocIcon=()=>(
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/>
    <line x1="8" y1="17" x2="12" y2="17"/>
  </svg>
);

// Counts non-null extracted fields (excluding rawText/source)
function countExtracted(parsed){
  if(!parsed)return 0;
  return['date','distanceKm','durationMinutes','avgPacePerKm','avgHR','maxHR','calories','avgCadence','totalAscentM','avgPowerW']
    .filter(k=>parsed[k]!=null).length;
}

function WorkoutLog({showToast}){
  const today=td();
  const blankForm={type:"Run (outdoor)",date:today,duration:"",distance:"",heartRate:"",maxHR:"",calories:"",cadence:"",rpe:5,reflection:"",weather:null};
  const[f,sf]=useState(blankForm);
  const[autoFilled,setAutoFilled]=useState({});          // tracks which fields came from import
  const[importSource,setImportSource]=useState({type:"manual"});
  const[importStatus,setImportStatus]=useState(null);    // {level:'ok'|'warn', msg}
  const[pdfFilename,setPdfFilename]=useState(null);
  const[csvFilename,setCsvFilename]=useState(null);
  const[weatherLoad,setWeatherLoad]=useState(false);
  const[weatherErr,setWeatherErr]=useState(false);
  const[manualWeather,setManualWeather]=useState({temp:"",condition:"",humidity:"",wind:""});
  const[saving,setSaving]=useState(false);
  const[expanded,setExpanded]=useState(true);
  const pdfRef=useRef();
  const csvRef=useRef();

  const set=k=>e=>sf(p=>({...p,[k]:e.target.value}));
  const isOutdoor=f.type==="Run (outdoor)";
  const isRun=f.type.startsWith("Run");
  const reflLen=f.reflection.length;
  const reflValid=reflLen>=250&&reflLen<=300;
  const pace=isRun?calcPace(f.duration,f.distance):"";

  // Auto-fetch weather when type is any run type and date is set
  useEffect(()=>{
    if(!isRun||!f.date)return;
    setWeatherErr(false);setWeatherLoad(true);
    fetchWeatherForDate(f.date)
      .then(w=>{
        if(w){ sf(p=>({...p,weather:w})); setWeatherErr(false); }
        else { sf(p=>({...p,weather:null})); setWeatherErr(true); }
      })
      .catch(()=>{ sf(p=>({...p,weather:null})); setWeatherErr(true); })
      .finally(()=>setWeatherLoad(false));
  },[f.type,f.date]);

  // Apply parsed fields to form state, track which were auto-filled
  function applyParsed(parsed,srcType,filename){
    if(!parsed)return;
    const filled={};
    const updates={};
    // Map from normalized parser output to form fields
    if(parsed.date!=null){ updates.date=parsed.date; filled.date=true; }
    if(parsed.type!=null){ updates.type=parsed.type; filled.type=true; }
    if(parsed.distanceMi!=null){ updates.distance=String(parsed.distanceMi); filled.distance=true; }
    else if(parsed.distanceKm!=null){ updates.distance=String((parsed.distanceKm/1.60934).toFixed(2)); filled.distance=true; }
    if(parsed.durationMinutes!=null){ updates.duration=String(parsed.durationMinutes); filled.duration=true; }
    if(parsed.avgHR!=null){ updates.heartRate=String(parsed.avgHR); filled.heartRate=true; }
    if(parsed.maxHR!=null){ updates.maxHR=String(parsed.maxHR); filled.maxHR=true; }
    if(parsed.calories!=null){ updates.calories=String(parsed.calories); filled.calories=true; }
    if(parsed.avgCadence!=null){ updates.cadence=String(parsed.avgCadence); filled.cadence=true; }
    if(Object.keys(updates).length>0){
      sf(p=>({...p,...updates}));
      setAutoFilled(filled);
    }
    setImportSource({type:srcType,filename});
    const n=countExtracted(parsed);
    setImportStatus(n>=4
      ?{level:'ok',  msg:`PDF parsed — review fields and add your reflection`}
      :{level:'warn',msg:`Limited data — fill remaining fields manually (${n} extracted)`}
    );
  }

  const handlePDF=async file=>{
    if(!file)return;
    setPdfFilename(file.name);
    const ext=file.name.split('.').pop().toLowerCase();
    try{
      if(ext==='fit'){
        // Phase 4r.zones.3 — pass cached bpm zone boundaries.
        const _profile=storage.get('profile')||{};
        const _zb=_profile?.hrZoneBpm;
        const _zoneBpm=(_zb&&Number.isFinite(+_zb.z1Max)&&Number.isFinite(+_zb.z2Max)&&Number.isFinite(+_zb.z3Max)&&Number.isFinite(+_zb.z4Max))
          ?{z1Max:+_zb.z1Max,z2Max:+_zb.z2Max,z3Max:+_zb.z3Max,z4Max:+_zb.z4Max}:null;
        const parsed=await parseFITFile(file,{zoneBpm:_zoneBpm});
        applyParsed(parsed,'fit',file.name);
        setImportStatus({level:'ok',msg:'✓ FIT file parsed — fields pre-filled. Add your reflection to complete.'});
        setImportSource({type:'fit',filename:file.name});
      }else{
        const parsed=await parseRunPDF(file);
        applyParsed(parsed,'pdf',file.name);
      }
    }catch(e){
      setImportStatus({level:'warn',msg:`Could not read file: ${e.message}`});
      setImportSource({type:ext,filename:file.name});
    }
  };

  const handleCSV=file=>{
    if(!file)return;
    setCsvFilename(file.name);
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const parsed=parseWorkoutCSV(ev.target.result);
        if(parsed) applyParsed(parsed,'csv',file.name);
        else setImportStatus({level:'warn',msg:'Could not parse CSV — please fill fields manually.'});
      }catch{
        setImportStatus({level:'warn',msg:'CSV parse error — please fill fields manually.'});
      }
      setImportSource({type:'csv',filename:file.name});
    };
    reader.readAsText(file);
  };

  const clearImport=()=>{
    setPdfFilename(null);setCsvFilename(null);setAutoFilled({});
    setImportStatus(null);setImportSource({type:"manual"});
    sf(blankForm);
  };

  const handleSave=async()=>{
    if(!reflValid)return;
    setSaving(true);
    const weather=isRun
      ?(f.weather||{tempMaxF:parseFloat(manualWeather.temp)||null,condition:manualWeather.condition||null,windMph:parseFloat(manualWeather.wind)||null,source:'manual'})
      :null;
    const distMi=isRun?parseFloat(f.distance)||null:null;
    const distKm=distMi?+(distMi*1.60934).toFixed(2):null;
    const entry={
      id:genId(),date:f.date,type:f.type,
      distanceKm:distKm,
      distanceMi:distMi,
      duration:parseFloat(f.duration)||null,
      pace:isRun?pace||null:null,
      heartRate:parseFloat(f.heartRate)||null,
      maxHR:parseFloat(f.maxHR)||null,
      calories:parseInt(f.calories)||null,
      cadence:parseInt(f.cadence)||null,
      rpe:parseInt(f.rpe)||null,
      reflection:f.reflection,
      weather,
      source:importSource,
      createdAt:new Date().toISOString(),
    };
    await saveWorkout(entry);
    showToast("✓ Workout saved to ARNOLD Memory");
    sf(blankForm);setAutoFilled({});setImportSource({type:"manual"});
    setImportStatus(null);setPdfFilename(null);setCsvFilename(null);
    setSaving(false);setExpanded(false);
  };

  // Label with optional auto-filled badge
  const FL=({label,unit,field})=>(
    <label style={S.fl}>
      {label}
      {unit&&<span style={{color:C.m}}> {unit}</span>}
      {autoFilled[field]&&<span style={{fontStyle:"italic",fontSize:11,color:C.m,marginLeft:5,textTransform:"none",letterSpacing:0}}>auto-filled</span>}
    </label>
  );

  // Drop zone component
  const DropZone=({accept,label,sublabel,filename,onFile,inputRef})=>{
    const[drag,setDrag]=useState(false);
    const loaded=!!filename;
    return(
      <div
        onDragOver={e=>{e.preventDefault();setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);const file=e.dataTransfer.files[0];if(file)onFile(file);}}
        onClick={()=>!loaded&&inputRef.current?.click()}
        style={{
          border:`0.5px dashed ${loaded?"var(--accent)":drag?"var(--accent)":"var(--border-default)"}`,
          borderStyle:loaded?"solid":"dashed",
          borderRadius:"var(--radius-md)",
          background:loaded?"var(--accent-dim)":"var(--bg-input)",
          padding:"14px 10px",
          display:"flex",flexDirection:"column",alignItems:"center",gap:5,
          cursor:loaded?"default":"pointer",
          transition:"all var(--transition)",
          position:"relative",
        }}
      >
        <input ref={inputRef} type="file" accept={accept} style={{display:"none"}}
          onChange={e=>{const file=e.target.files[0];if(file)onFile(file);e.target.value="";}}/>
        {!loaded&&(
          <>
            <span style={{color:C.m}}><DocIcon/></span>
            <span style={{fontSize:"clamp(12px,0.4vw + 10px,13px)",color:C.t,fontWeight:500,textAlign:"center"}}>{label}</span>
            <span style={{fontSize:11,color:C.m}}>{sublabel}</span>
          </>
        )}
        {loaded&&(
          <>
            <span style={{color:"var(--accent)"}}><DocIcon/></span>
            <span style={{fontSize:"clamp(11px,0.3vw + 9px,12px)",color:"var(--text-accent)",fontWeight:500,textAlign:"center",wordBreak:"break-all"}}>{filename}</span>
            <button
              onClick={e=>{e.stopPropagation();clearImport();}}
              style={{position:"absolute",top:5,right:7,background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}
            >×</button>
          </>
        )}
      </div>
    );
  };

  return(
    <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",overflow:"hidden"}}>
      {/* header / toggle */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"clamp(12px,1vw,18px)",cursor:"pointer",background:C.surf}} onClick={()=>setExpanded(e=>!e)}>
        <div style={{...S.gt,marginBottom:0,paddingBottom:0,borderBottom:"none"}}>◉ Workout Log</div>
        <span style={{color:C.m,fontSize:12,transition:"transform 0.2s ease",transform:expanded?"rotate(0deg)":"rotate(180deg)"}}>{expanded?"▼":"▼"}</span>
      </div>

      {expanded&&(
        <div style={{padding:"0 clamp(12px,1vw,18px) clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:10,transition:"all 0.2s ease"}}>

          {/* ── Import from file ── */}
          <div style={{background:C.elev,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",padding:10}}>
            <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Import from file</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <DropZone
                accept=".pdf,.fit,.FIT" label="Drop Garmin PDF or FIT" sublabel="or click to browse"
                filename={pdfFilename} onFile={handlePDF} inputRef={pdfRef}
              />
              <DropZone
                accept=".csv" label="Drop workout CSV" sublabel="or click to browse"
                filename={csvFilename} onFile={handleCSV} inputRef={csvRef}
              />
            </div>

            {/* Import status banner */}
            {importStatus&&(
              <div style={{
                marginTop:8,padding:"7px 10px",borderRadius:"var(--radius-sm)",fontSize:"clamp(11px,0.4vw + 9px,12px)",lineHeight:1.5,
                background:importStatus.level==='ok'?"var(--status-ok-bg)":"var(--status-warn-bg)",
                border:`0.5px solid ${importStatus.level==='ok'?"rgba(74,222,128,0.3)":"rgba(245,158,11,0.3)"}`,
                color:importStatus.level==='ok'?"var(--status-ok)":"var(--status-warn)",
              }}>
                {importStatus.level==='ok'?"✓ ":"⚠ "}{importStatus.msg}
              </div>
            )}
          </div>

          {/* Type + Date */}
          <div style={S.fr}>
            <div style={S.field}>
              <label style={S.fl}>Workout Type</label>
              <select value={f.type} onChange={set("type")} style={S.inp}>
                {WORKOUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={S.field}>
              <FL label="Date" field="date"/>
              <input type="date" value={f.date} onChange={set("date")} style={S.inp}/>
            </div>
          </div>

          {/* Duration + Distance */}
          <div style={S.fr}>
            <div style={S.field}>
              <FL label="Duration" unit="min" field="duration"/>
              <input type="number" min="0" value={f.duration} onChange={set("duration")} style={S.inp}/>
            </div>
            {isRun&&(
              <div style={S.field}>
                <FL label="Distance" unit="mi" field="distance"/>
                <input type="number" min="0" step="0.01" value={f.distance} onChange={set("distance")} style={S.inp}/>
                {autoFilled.distance&&f.distance&&<div style={{fontSize:10,color:C.m,marginTop:2}}>({(parseFloat(f.distance)*1.60934).toFixed(2)} km)</div>}
              </div>
            )}
          </div>

          {/* Auto-pace + HR */}
          <div style={S.fr}>
            {isRun&&pace&&(
              <div style={S.field}>
                <label style={S.fl}>Avg Pace <span style={{color:C.m}}>min/mi</span></label>
                <div style={{...S.inp,background:C.elev,color:C.ta,cursor:"default"}}>{pace}</div>
              </div>
            )}
            <div style={S.field}>
              <FL label="Avg HR" unit="bpm" field="heartRate"/>
              <input type="number" min="0" value={f.heartRate} onChange={set("heartRate")} style={S.inp}/>
            </div>
            <div style={S.field}>
              <FL label="Max HR" unit="bpm" field="maxHR"/>
              <input type="number" min="0" value={f.maxHR} onChange={set("maxHR")} style={S.inp}/>
            </div>
          </div>

          {/* Calories + Cadence */}
          <div style={S.fr}>
            <div style={S.field}>
              <FL label="Active Calories" unit="kcal" field="calories"/>
              <input type="number" min="0" value={f.calories} onChange={set("calories")} style={S.inp}/>
            </div>
            <div style={S.field}>
              <FL label="Cadence" unit="spm" field="cadence"/>
              <input type="number" min="0" value={f.cadence} onChange={set("cadence")} style={S.inp}/>
            </div>
          </div>

          {/* RPE slider */}
          <div style={S.field}>
            <label style={S.fl}>Perceived Exertion (RPE) — <span style={{color:C.ta}}>{f.rpe}/10</span></label>
            <input type="range" min="1" max="10" value={f.rpe} onChange={set("rpe")} style={{width:"100%",accentColor:"var(--accent)"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.m,marginTop:2}}>
              <span>1 Easy</span><span>5 Moderate</span><span>10 Max</span>
            </div>
          </div>

          {/* Weather — all run types */}
          {isRun&&(
            <div style={{background:"var(--bg-elevated)",border:`0.5px solid var(--border-default)`,borderRadius:"var(--radius-sm)",padding:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa",letterSpacing:"0.08em",textTransform:"uppercase"}}>
                  {weatherLoad?"Fetching weather…":"Weather"}{!weatherLoad&&f.weather&&f.date?` · ${new Date(f.date+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`:""}
                </div>
                {!weatherLoad&&f.weather?.source&&(
                  <span style={{fontSize:10,color:C.m,background:C.elev,border:`0.5px solid ${C.b}`,borderRadius:3,padding:"1px 5px",textTransform:"capitalize"}}>{f.weather.source}</span>
                )}
              </div>
              {weatherLoad&&<div style={{color:C.m,fontSize:12}}>Loading…</div>}
              {!weatherLoad&&f.weather&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:12,fontSize:"clamp(12px,0.4vw + 10px,13px)",color:C.t}}>
                  <span>{f.weather.condition}</span>
                  <span>High {f.weather.tempMaxF}°F / Low {f.weather.tempMinF}°F</span>
                  <span>Wind {f.weather.windMph} mph</span>
                  <span>Precip {f.weather.precipitationMm??0} mm</span>
                </div>
              )}
              {!weatherLoad&&(weatherErr||!f.weather)&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {[["temp","Temp (°F)"],["condition","Condition"],["humidity","Humidity (%)"],["wind","Wind (mph)"]].map(([k,lbl])=>(
                    <div key={k} style={S.field}>
                      <label style={S.fl}>{lbl}</label>
                      <input type={k==="condition"?"text":"number"} value={manualWeather[k]} onChange={e=>setManualWeather(p=>({...p,[k]:e.target.value}))} style={S.inp}/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reflection — hard-enforced 250–300 chars, never auto-filled */}
          <div style={S.field}>
            <label style={S.fl}>
              How did it feel?{" "}
              <span style={{color:reflLen<250?C.wn:reflLen>300?C.dn:C.ok}}>
                ({reflLen}/300 chars — 250–300 required for analysis)
              </span>
            </label>
            <textarea
              value={f.reflection}
              onChange={e=>{if(e.target.value.length<=300)sf(p=>({...p,reflection:e.target.value}));}}
              placeholder="Describe how the workout felt — your energy, breathing, effort, what went well or poorly. This reflection is used for AI analysis. Must be 250–300 characters."
              style={{...S.ta,minHeight:90,borderColor:reflLen>0&&!reflValid?"var(--status-warn)":"var(--border-default)"}}
            />
            <div style={{fontSize:10,color:reflLen>=250&&reflLen<=300?C.ok:C.m,textAlign:"right"}}>
              {reflLen<250?`${250-reflLen} more characters needed`:reflLen>300?`${reflLen-300} over limit`:"✓ Good length"}
            </div>
          </div>

          <button
            style={{...S.sb,...(!reflValid||saving?{opacity:0.4,cursor:"not-allowed"}:{})}}
            onClick={handleSave}
            disabled={!reflValid||saving}
          >
            {saving?"Saving…":"Save Workout"}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT HUB — Garmin + Cronometer + API placeholders
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT HUB — Garmin + Cronometer + API placeholders
// ═══════════════════════════════════════════════════════════════════════════════
// ── Import type labels ───────────────────────────────────────────────────────
const IMPORT_ZONES=[
  {id:'activities',label:'Activities',icon:'⌚',color:'#3b82f6'},
  {id:'hrv',label:'HRV Status',icon:'∿',color:'#a78bfa'},
  {id:'sleep',label:'Sleep',icon:'◑',color:'#60a5fa'},
  {id:'weight',label:'Weight',icon:'⊗',color:'#4ade80'},
];

async function processImport(type,text){
  if(type==='activities'){
    const rows=parseActivitiesCSV(text);
    const ex=await getGarminActivities();
    const{merged,added,updated}=mergeActivities(ex,rows);
    await await saveGarminActivities(merged);
    storage.set('activities',merged);
    // Also save to legacy garmin store for Training tab compatibility
    const runRows=rows.filter(isRunAct);
    if(runRows.length){
      const legacyRows=runRows.map(r=>({...r,avgPacePerKm:r.avgPaceRaw||null,source:'garmin-csv'}));
      const exLeg=await getGarmin();
      const{merged:m2}=mergeGarminActivities(exLeg,legacyRows);
      await saveGarmin(m2);
    }
    return{count:rows.length,added,updated,label:`${rows.length} activities`};
  }
  if(type==='hrv'){
    const rows=parseHRVCSV(text);
    const ex=await getGarminHRV();
    const{merged,added,updated}=mergeHRV(ex,rows);
    await saveGarminHRV(merged);
    storage.set('hrv',merged);
    return{count:rows.length,added,updated,label:`${rows.length} days`};
  }
  if(type==='sleep'){
    const rows=parseSleepCSV(text);
    const ex=await getGarminSleep();
    const{merged,added,updated}=mergeSleep(ex,rows);
    await saveGarminSleep(merged);
    storage.set('sleep',merged);
    return{count:rows.length,added,updated,label:`${rows.length} nights`};
  }
  if(type==='weight'){
    const rows=parseWeightCSV(text);
    const ex=await getGarminWeight();
    const{merged,added,updated}=mergeWeight(ex,rows);
    await saveGarminWeight(merged);
    storage.set('weight',merged);
    return{count:rows.length,added,updated,label:`${rows.length} entries`};
  }
  if(type==='cronometer'){
    const rows=parseCronometerCSV(text);
    if(rows.length){
      const merged=storage.merge('cronometer',rows,'date');
      await saveCronometer(merged);
      return{count:rows.length,added:rows.length,updated:0,label:`${rows.length} days of nutrition data`};
    }
    // Fallback to legacy parser
    const legacyRows=parseCSV(text);
    const mapped=mapCrono(legacyRows);
    await saveCronometer(mapped);
    storage.set('cronometer',mapped);
    return{count:mapped.length,added:mapped.length,updated:0,label:`${mapped.length} days`};
  }
  return null;
}

function ImportHub({data,persist,showToast,setTab}){
  const[zones,setZones]=useState({activities:null,hrv:null,sleep:null,weight:null,cronometer:null});
  const[banners,setBanners]=useState({});
  const[hist,setHist]=useState([]);
  const masterRef=useRef();
  const zoneRefs={activities:useRef(),hrv:useRef(),sleep:useRef(),weight:useRef(),cronometer:useRef()};

  useEffect(()=>{getImportHistory().then(setHist);},[]);

  const handleFile=async(file,forceType)=>{
    if(!file)return;
    // FIT file (binary) — route to the Garmin FIT SDK parser and merge into activities
    if(/\.fit$/i.test(file.name)){
      setZones(z=>({...z,activities:{file:file.name,loading:true}}));
      try{
        // Phase 4r.zones.3 — pass cached bpm zone boundaries.
        const _profile=storage.get('profile')||{};
        const _zb=_profile?.hrZoneBpm;
        const _zoneBpm=(_zb&&Number.isFinite(+_zb.z1Max)&&Number.isFinite(+_zb.z2Max)&&Number.isFinite(+_zb.z3Max)&&Number.isFinite(+_zb.z4Max))
          ?{z1Max:+_zb.z1Max,z2Max:+_zb.z2Max,z3Max:+_zb.z3Max,z4Max:+_zb.z4Max}:null;
        const act=await parseFITFile(file,{zoneBpm:_zoneBpm});
        const {merged}=mergeActivities(storage.get('activities')||[],[act]);
        storage.set('activities',merged);
        setZones(z=>({...z,activities:{file:file.name,count:merged.length,loading:false}}));
        setBanners(b=>({...b,activities:`Detected: FIT file — ${act.activityType} on ${act.date}`}));
        const newEntry={date:new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}),count:1,source:'fit',file:file.name};
        const newHist=[newEntry,...hist].slice(0,20);
        setHist(newHist);
        await saveImportHistory(newHist);
        showToast(`✓ FIT: ${act.activityType} imported`);
      }catch(e){
        setZones(z=>({...z,activities:null}));
        showToast(`⚠ FIT parse failed: ${e.message}`);
      }
      return;
    }
    const text=await file.text();
    const type=forceType||detectCSVType(text,file.name);
    if(!type){showToast("⚠ Could not detect CSV type");return;}
    const typeLbl={activities:'Activities',hrv:'HRV Status',sleep:'Sleep',weight:'Weight',resting_hr:'Resting HR',cronometer:'Cronometer'}[type]||type;
    setZones(z=>({...z,[type]:{file:file.name,loading:true}}));
    setBanners(b=>({...b,[type]:null}));
    try{
      const res=await processImport(type,text);
      if(!res){showToast("⚠ Parse failed");setZones(z=>({...z,[type]:null}));return;}
      setZones(z=>({...z,[type]:{file:file.name,count:res.count,loading:false}}));
      setBanners(b=>({...b,[type]:`Detected: ${typeLbl} CSV — ${res.label} found`}));
      const newEntry={date:new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}),count:res.count,source:type,file:file.name};
      const newHist=[newEntry,...hist].slice(0,20);
      setHist(newHist);
      await saveImportHistory(newHist);
      showToast(`✓ ${typeLbl}: ${res.added} new, ${res.updated} updated`);
    }catch(e){
      setZones(z=>({...z,[type]:null}));
      showToast(`⚠ ${typeLbl} import failed: ${e.message}`);
    }
  };

  const handleMultiDrop=async(e)=>{
    e.preventDefault();
    const files=Array.from(e.dataTransfer.files).filter(f=>/\.(csv|fit)$/i.test(f.name));
    for(const file of files) await handleFile(file,null);
  };

  const DZ=({id,label,icon,color})=>{
    const z=zones[id];
    const ref=zoneRefs[id];
    const loaded=z&&!z.loading;
    const loading=z?.loading;
    return(
      <div
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f,id);}}
        onClick={()=>!loaded&&ref.current?.click()}
        style={{
          border:`0.5px solid ${loaded?color:"var(--border-default)"}`,
          background:loaded?`${color}10`:"var(--bg-surface)",
          borderRadius:"var(--radius-md)",height:80,
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,
          cursor:loaded?"default":"pointer",transition:"all var(--transition)",padding:6,overflow:"hidden",
        }}
      >
        <input ref={ref} type="file" accept=".csv,.fit" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0];if(f)handleFile(f,id);e.target.value="";}}/>
        {loading&&<div style={{fontSize:11,color:C.m}}>Parsing…</div>}
        {!loaded&&!loading&&<>
          <span style={{fontSize:16,color,opacity:0.8,lineHeight:1}}>{icon}</span>
          <span style={{fontSize:11,fontWeight:500,color:C.t,lineHeight:1.1}}>{label}</span>
          <span style={{fontSize:9,color:C.m}}>or click</span>
        </>}
        {loaded&&<>
          <span style={{fontSize:14,color,lineHeight:1}}>✓</span>
          <span style={{fontSize:10,color,fontWeight:500,textAlign:"center",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{label}</span>
          <span style={{fontSize:9,color:C.m,padding:"1px 5px",borderRadius:3,background:`${color}15`}}>{z.count}</span>
        </>}
      </div>
    );
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:"clamp(10px,1vw,16px)"}}>
      {/* Master drop zone — compact 60px */}
      <div
        onDragOver={e=>e.preventDefault()}
        onDrop={handleMultiDrop}
        onClick={()=>masterRef.current?.click()}
        style={{
          border:`0.5px dashed var(--border-default)`,background:"var(--bg-input)",
          borderRadius:"var(--radius-md)",height:60,
          display:"flex",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",
        }}
      >
        <input ref={masterRef} type="file" accept=".csv,.fit" multiple style={{display:"none"}}
          onChange={async e=>{for(const f of Array.from(e.target.files))await handleFile(f,null);e.target.value="";}}/>
        <span style={{fontSize:18,color:C.acc}}>⇡</span>
        <span style={{fontSize:13,fontWeight:500,color:C.t}}>Drop all files here</span>
        <span style={{fontSize:11,color:C.m}}>· auto-detects type</span>
      </div>

      {/* Detection banners */}
      {Object.entries(banners).filter(([,v])=>v).map(([k,msg])=>(
        <div key={k} style={{padding:"7px 12px",borderRadius:"var(--radius-sm)",background:"var(--status-ok-bg)",border:"0.5px solid rgba(74,222,128,0.3)",color:"var(--status-ok)",fontSize:12}}>✓ {msg}</div>
      ))}

      {/* Single row of 5 compact zones */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5, minmax(0, 1fr))",gap:8}}>
        {[...IMPORT_ZONES,{id:'cronometer',label:'Cronometer',icon:'◆',color:'#f59e0b'}].map(z=><DZ key={z.id} {...z}/>)}
      </div>

      {/* How to export */}
      <div style={{background:C.elev,borderLeft:`3px solid ${C.acc}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
        <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.ta,textTransform:"uppercase",marginBottom:10}}>How to Export from Garmin Connect</div>
        <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.s,lineHeight:1.8}}>
          <strong>Activities:</strong> Activities → Export CSV (top right)<br/>
          <strong>HRV Status:</strong> Health Stats → HRV Status → Export CSV<br/>
          <strong>Sleep:</strong> Health Stats → Sleep → Export CSV<br/>
          <strong>Weight:</strong> Health Stats → Weight → Export CSV<br/>
          <strong>Cronometer:</strong> More → Account → Export → Nutrition Summary
        </div>
      </div>

      {/* Import history */}
      {hist.length>0&&(
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",marginBottom:8}}>Recent Imports</div>
          {hist.slice(0,5).map((h,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:i<Math.min(hist.length-1,4)?`0.5px solid ${C.bs}`:"none"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{color:C.ta,fontSize:11}}>✓</span>
                <div>
                  <span style={{fontSize:12,color:C.t}}>{h.file||"CSV"}</span>
                  <span style={{fontSize:11,color:C.m,marginLeft:6}}>{h.count} {h.source==='activities'?'activities':h.source==='sleep'?'nights':h.source==='hrv'?'days':'entries'}</span>
                </div>
              </div>
              <span style={{fontSize:10,color:C.m,fontFamily:"var(--font-mono)"}}>{h.date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH SYSTEMS — 10-tile grid for EdgeIQ (moved from NutritionInput)
// ═══════════════════════════════════════════════════════════════════════════════
const SYSTEM_ICONS = {
  brain: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8 2 5 5 5 9c0 2 .5 3.5 1.5 5 .8 1.2 1 2.5 1 4h9c0-1.5.2-2.8 1-4 1-1.5 1.5-3 1.5-5 0-4-3-7-7-7z"/><path d="M9 18h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2z"/><path d="M12 2v16"/><path d="M6.5 8c2 1 3.5 1.5 5.5 1.5s3.5-.5 5.5-1.5"/><path d="M7 12.5c1.5.8 3 1 5 1s3.5-.2 5-1"/></svg>,
  heart: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg>,
  bones: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/><line x1="6" y1="12" x2="18" y2="12"/><rect x="5" y="7" width="2" height="10" rx="0.5"/><rect x="17" y="7" width="2" height="10" rx="0.5"/></svg>,
  gut: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4h10c1.5 0 2.5 1 2.5 2.5S18.5 9 17 9H7c-1.5 0-2.5 1-2.5 2.5S6 14 7 14h10"/><path d="M17 14c1.5 0 2.5 1 2.5 2.5S18.5 19 17 19H7"/><circle cx="5" cy="19" r="1.2" fill={c} stroke="none"/></svg>,
  immune: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 L4 7v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V7l-8-5Z"/></svg>,
  energy: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>,
  longevity: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>,
  sleep: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  metabolism: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h4l2-8 4 16 2-8h4"/></svg>,
  endurance: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12c4-6 8-6 12 0s8 6 12 0"/></svg>,
};

// ── SYSTEM_SIGNALS ─────────────────────────────────────────────────────────
// Maps each Health System to the training / body / blood-marker signals
// most relevant to it. Used by WebSystemDetail to surface cross-domain
// inputs that influence the score. Mirrors the same map in MobileHome.jsx —
// keep them in sync (or extract to a shared module in a future pass).
const SYSTEM_SIGNALS = {
  brain:     { training: ['HRV', 'Sleep Score'],                       body: ['Body Fat %'],         blood: ['Vitamin B12', 'Folate', 'Vitamin D'] },
  heart:     { training: ['RHR', 'Avg HR', 'Weekly Miles'],            body: ['Weight'],             blood: ['Cholesterol', 'Triglycerides', 'CRP'] },
  bones:     { training: ['Strength Sessions', 'Weekly Hours'],        body: ['Lean Mass', 'Weight'],blood: ['Vitamin D', 'Calcium'] },
  gut:       { training: [],                                           body: ['Body Fat %'],         blood: ['CRP', 'Iron'] },
  immune:    { training: ['HRV', 'Sleep Score'],                       body: [],                     blood: ['Vitamin D', 'Vitamin C', 'Zinc', 'WBC'] },
  energy:    { training: ['Weekly Hours', 'Weekly Miles'],             body: ['Weight'],             blood: ['Iron', 'Ferritin', 'Vitamin B12'] },
  longevity: { training: ['HRV', 'RHR', 'Weekly Hours'],               body: ['Body Fat %', 'Weight'],blood: ['Glucose', 'HbA1c', 'CRP'] },
  sleep:     { training: ['Sleep Score', 'HRV', 'RHR'],                body: [],                     blood: ['Magnesium'] },
  metabolism:{ training: ['Weekly Hours', 'Weekly Miles'],             body: ['Weight', 'Body Fat %'],blood: ['Glucose', 'HbA1c', 'Triglycerides'] },
  endurance: { training: ['Weekly Miles', 'Avg Pace', 'Weekly Hours'], body: ['Weight'],             blood: ['Iron', 'Ferritin', 'Hemoglobin'] },
};

// ── WebSystemDetail — inline expansion panel for a Health System tile ─────
// Same data backbone as the mobile SystemDetailPanel (getSystemDetail +
// getSystemWeekly + SYSTEM_SIGNALS) but with web-native styling: CSS
// variables instead of mobile constants, slightly larger typography, more
// breathing room since we have desktop real estate.
//
// Renders three tabs:
//   Daily   → today's nutrient targets + training/body/blood signal snapshots
//   Weekly  → 7-day score sparkline bars + weekly training rollups
//   Annual  → YTD training totals + current body snapshot
//
// Future stages will add: 30-day trend, last-optimal detection + trigger
// hypothesis, hand-crafted recommendations, live Labs cross-references.
function WebSystemDetail({ system, comment, onClose, data }) {
  const [tab, setTab] = useState('daily');
  const containerRef = useRef(null);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);
  const detail = useMemo(() => getSystemDetail(system.id, today), [system.id, today]);
  const weekly = useMemo(() => getSystemWeekly(system.id), [system.id]);

  // Phase 4n.3.2 — auto-scroll the panel into view when it opens, so the
  // user doesn't have to manually scroll down after clicking a tile.
  // Smooth scroll, block=start positions the panel near the top of the
  // viewport (with a small offset so the tile that was clicked stays
  // visible above it).
  useEffect(() => {
    if (containerRef.current) {
      const t = setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [system.id]);

  if (!detail) return null;
  const nutrients = detail.details || [];
  const signals = SYSTEM_SIGNALS[system.id] || { training: [], body: [], blood: [] };

  // Status color mirrors the tile
  const statusColor = system.status === 'good' ? '#4ade80'
                    : system.status === 'focus' ? '#fbbf24'
                    : '#f87171';

  // ── Resolve signal values for daily/weekly/annual contexts ──
  const activities = useMemo(() => getUnifiedActivities(), []);
  const sleepData = useMemo(() => cleanSleepForAveraging(storage.get('sleep') || []), []);
  const hrvData = useMemo(() => storage.get('hrv') || [], []);
  const weightData = useMemo(() => storage.get('weight') || [], []);
  const labsSource = useMemo(() => {
    const s = storage.get('labSnapshots');
    if (Array.isArray(s) && s.length) return s;
    return data?.labSnapshots || [];
  }, [data]);
  const labMarkers = useMemo(() => {
    const sorted = [...labsSource].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sorted[0]?.markers || {};
  }, [labsSource]);

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const d7 = new Date(); d7.setDate(d7.getDate() - 7);
  const recentSleep = useMemo(() => [...sleepData].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [sleepData]);
  const recentHRV = useMemo(() => [...hrvData].filter(h => h.overnightHRV).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [hrvData]);
  const recentWeight = useMemo(() => [...weightData].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [weightData]);
  const ytdRunsLocal = useMemo(() => activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart && isRunAct(a)), [activities]);
  const ytdAll = useMemo(() => activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart), [activities]);
  const wk7 = useMemo(() => activities.filter(a => a.date && parseLocalDate(a.date) >= d7), [activities]);
  const wk7Runs = useMemo(() => wk7.filter(isRunAct), [wk7]);
  const wk7Str = useMemo(() => wk7.filter(isStrengthAct), [wk7]);

  const resolveSignal = (name, period) => {
    if (period === 'annual') {
      if (name === 'Weekly Miles') return { value: (ytdRunsLocal.reduce((s, a) => s + (a.distanceMi || 0), 0) / Math.max((now - yearStart) / 604800000, 1)).toFixed(1), unit: 'mi/wk' };
      if (name === 'Weekly Hours') return { value: (ytdAll.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600 / Math.max((now - yearStart) / 604800000, 1)).toFixed(1), unit: 'hrs/wk' };
      if (name === 'Strength Sessions') return { value: ytdAll.filter(a => /strength|weight|gym/i.test(a.activityType || '')).length, unit: 'YTD' };
      if (name === 'Avg Pace') {
        const p = ytdRunsLocal.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean);
        return p.length ? { value: `${Math.floor(p.reduce((s, v) => s + v, 0) / p.length / 60)}:${String(Math.round(p.reduce((s, v) => s + v, 0) / p.length % 60)).padStart(2, '0')}`, unit: '/mi' } : { value: '—', unit: '' };
      }
    }
    if (name === 'HRV') return { value: recentHRV[0]?.overnightHRV || recentSleep.find(s => s?.overnightHRV)?.overnightHRV || '—', unit: 'ms' };
    if (name === 'RHR') return { value: recentSleep[0]?.restingHR || '—', unit: 'bpm' };
    if (name === 'Sleep Score') return { value: recentSleep.find(s => s.sleepScore)?.sleepScore || '—', unit: '/100' };
    if (name === 'Avg HR') { const hrs = wk7Runs.map(a => a.avgHR).filter(Boolean); return { value: hrs.length ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : '—', unit: 'bpm' }; }
    if (name === 'Weekly Miles') return { value: wk7Runs.reduce((s, a) => s + (a.distanceMi || 0), 0).toFixed(1), unit: 'mi' };
    if (name === 'Weekly Hours') return { value: (wk7.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600).toFixed(1), unit: 'hrs' };
    if (name === 'Strength Sessions') return { value: wk7Str.length, unit: 'this wk' };
    if (name === 'Avg Pace') {
      const p = wk7Runs.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean);
      return p.length ? { value: `${Math.floor(p.reduce((s, v) => s + v, 0) / p.length / 60)}:${String(Math.round(p.reduce((s, v) => s + v, 0) / p.length % 60)).padStart(2, '0')}`, unit: '/mi' } : { value: '—', unit: '' };
    }
    if (name === 'Weight') return { value: recentWeight[0]?.weightLbs?.toFixed(1) || '—', unit: 'lbs' };
    if (name === 'Body Fat %') return { value: recentWeight.find(w => w?.bodyFatPct > 0)?.bodyFatPct?.toFixed(1) || '—', unit: '%' };
    if (name === 'Lean Mass') return { value: recentWeight.find(w => w?.skeletalMuscleMassLbs)?.skeletalMuscleMassLbs?.toFixed(1) || '—', unit: 'lbs' };
    return { value: '—', unit: '' };
  };
  const resolveBlood = (name) => {
    const v = labMarkers[name];
    return v != null ? { value: v, unit: '' } : { value: '—', unit: '' };
  };

  const barColor = (pct) => pct >= 80 ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171';
  const weeklyAvg = weekly.length ? Math.round(weekly.reduce((s, d) => s + d.pct, 0) / weekly.length) : null;
  const weeklyMax = Math.max(...weekly.map(d => d.pct), 1);

  // ── 7-day history map per signal name (for mini sparklines) ──
  // Walks each of the last 7 days and resolves the signal value for that
  // date. Returns oldest→newest array, nulls preserved for missing data.
  const last7Days = useMemo(() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      arr.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    return arr;
  }, []);
  const sigHistory = useMemo(() => {
    const map = {};
    map['HRV'] = last7Days.map(ds => {
      const s = sleepData.find(s => s?.date === ds);
      if (s?.overnightHRV != null) return Number(s.overnightHRV);
      const h = hrvData.find(h => h?.date === ds);
      return h?.overnightHRV != null ? Number(h.overnightHRV) : null;
    });
    map['RHR'] = last7Days.map(ds => {
      const s = sleepData.find(s => s?.date === ds);
      return s?.restingHR != null ? Number(s.restingHR) : null;
    });
    map['Sleep Score'] = last7Days.map(ds => {
      const s = sleepData.find(s => s?.date === ds);
      return s?.sleepScore != null ? Math.min(Number(s.sleepScore), 100) : null;
    });
    map['Avg HR'] = last7Days.map(ds => {
      const dayRuns = activities.filter(a => a.date === ds && isRunAct(a));
      const hrs = dayRuns.map(r => r.avgHR).filter(Boolean);
      return hrs.length ? hrs.reduce((s, v) => s + v, 0) / hrs.length : null;
    });
    map['Weekly Miles'] = last7Days.map(ds => {
      const dayRuns = activities.filter(a => a.date === ds && isRunAct(a));
      return dayRuns.reduce((s, a) => s + (a.distanceMi || 0), 0) || null;
    });
    map['Weekly Hours'] = last7Days.map(ds => {
      const dayActs = activities.filter(a => a.date === ds);
      const total = dayActs.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600;
      return total > 0 ? +total.toFixed(2) : null;
    });
    map['Strength Sessions'] = last7Days.map(ds => {
      return activities.filter(a => a.date === ds && /strength|weight|gym/i.test(a.activityType || '')).length || null;
    });
    map['Avg Pace'] = last7Days.map(ds => {
      const dayRuns = activities.filter(a => a.date === ds && isRunAct(a));
      const paces = dayRuns.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean);
      return paces.length ? paces.reduce((s, v) => s + v, 0) / paces.length : null;
    });
    map['Weight'] = last7Days.map(ds => {
      const w = weightData.find(w => w?.date === ds && (w?.weightLbs || w?.weight));
      return w ? Number(w.weightLbs || w.weight) : null;
    });
    map['Body Fat %'] = last7Days.map(ds => {
      const w = weightData.find(w => w?.date === ds && w?.bodyFatPct > 0);
      return w?.bodyFatPct != null ? Number(w.bodyFatPct) : null;
    });
    map['Lean Mass'] = last7Days.map(ds => {
      const w = weightData.find(w => w?.date === ds && w?.skeletalMuscleMassLbs);
      return w?.skeletalMuscleMassLbs != null ? Number(w.skeletalMuscleMassLbs) : null;
    });
    return map;
  }, [last7Days, sleepData, hrvData, activities, weightData]);

  // Reference targets — lets each signal tile show "vs goal" context.
  const goals = getGoals();
  const sigTarget = (name) => {
    if (name === 'HRV') return parseFloat(goals?.targetHRV) || 45;
    if (name === 'RHR') return parseFloat(goals?.targetRHR) || 50;
    if (name === 'Sleep Score') return parseFloat(goals?.targetSleepScore) || 80;
    if (name === 'Avg HR') return parseFloat(goals?.targetAvgRunHR) || null;
    if (name === 'Weekly Miles') return parseFloat(goals?.weeklyRunDistanceTarget) || null;
    if (name === 'Weekly Hours') return parseFloat(goals?.weeklyTimeTargetHrs) || null;
    if (name === 'Strength Sessions') return parseFloat(goals?.weeklyStrengthTarget) || null;
    if (name === 'Weight') return parseFloat(goals?.targetWeight) || null;
    if (name === 'Body Fat %') return parseFloat(goals?.targetBodyFat) || null;
    if (name === 'Lean Mass') return parseFloat(goals?.targetLeanMass) || null;
    return null;
  };
  // Status-color logic per signal — knows direction (lower-better for HR/RHR/pace, higher-better for HRV/sleep, etc.)
  const sigColor = (name, val) => {
    if (val == null || val === '—' || !Number.isFinite(Number(val))) return 'var(--text-muted)';
    const v = Number(val);
    const t = sigTarget(name);
    if (name === 'HRV')         return v >= 40 ? '#4ade80' : v >= 30 ? '#fbbf24' : '#f87171';
    if (name === 'RHR')         return v <= 55 ? '#4ade80' : v <= 65 ? '#fbbf24' : '#f87171';
    if (name === 'Sleep Score') return v >= 80 ? '#4ade80' : v >= 60 ? '#fbbf24' : '#f87171';
    if (t == null) return 'var(--text-primary)';
    // Default: % of target, lower-better for HR-style, higher-better otherwise
    if (name === 'Avg HR')      return v <= t * 1.05 ? '#4ade80' : v <= t * 1.15 ? '#fbbf24' : '#f87171';
    const pct = v / t;
    return pct >= 0.9 ? '#4ade80' : pct >= 0.7 ? '#fbbf24' : '#f87171';
  };

  const tabStyle = (active) => ({
    flex: 1, textAlign: 'center', fontSize: 12, fontWeight: active ? 600 : 500,
    padding: '8px 0', color: active ? statusColor : 'var(--text-muted)',
    borderBottom: active ? `2px solid ${statusColor}` : '2px solid transparent',
    cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.04em',
    textTransform: 'uppercase',
  });

  const subHeaderStyle = {
    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.10em',
    marginTop: 14, marginBottom: 8,
  };
  const signalCellStyle = {
    background: 'var(--bg-elevated)',
    borderRadius: 8, padding: '8px 10px',
    border: '0.5px solid var(--border-subtle)',
    display: 'flex', flexDirection: 'column', gap: 2,
  };

  // Mini-sparkline SVG for signal tiles. Stretches to container width.
  const SignalSparkline = ({ history, color }) => {
    const valid = (history || []).filter(v => v != null && Number.isFinite(v));
    if (valid.length < 2) return <div style={{ height: 16 }}/>;
    const lo = Math.min(...valid); const hi = Math.max(...valid);
    const rng = hi - lo || 1;
    const W = 100, H = 16;
    const xS = (i) => (i / (history.length - 1)) * W;
    const yS = (v) => H - 2 - ((v - lo) / rng) * (H - 4);
    let path = ''; let inPath = false;
    history.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { inPath = false; return; }
      const p = { x: xS(i), y: yS(v) };
      path += inPath ? ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : ` M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      inPath = true;
    });
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: H, marginTop: 2 }}>
        <path d={path} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
      </svg>
    );
  };

  // Status indicator word per signal — succinct interpretation.
  const sigStatus = (name, val) => {
    if (val == null || val === '—') return null;
    const v = Number(val);
    if (!Number.isFinite(v)) return null;
    if (name === 'HRV')         return v >= 40 ? 'recovered' : v >= 30 ? 'borderline' : 'strained';
    if (name === 'RHR')         return v <= 55 ? 'fit' : v <= 65 ? 'normal' : 'elevated';
    if (name === 'Sleep Score') return v >= 80 ? 'restful' : v >= 60 ? 'fair' : 'poor';
    return null;
  };

  // ── Enriched signal tile renderer ──
  // Each tile: label + value+unit + sparkline + target/status sub-line.
  // Significantly more info than the single-value version, less black space.
  const renderSignalGrid = (sigList, period, opts = {}) => (
    // Always render at least 3 columns so a single-signal section (e.g.
    // Heart > Body > Weight) doesn't stretch to a giant empty banner.
    // Set { fillCols: false } to disable this when you actually want the
    // grid to size to content.
    <div style={{
      display: 'grid',
      gridTemplateColumns: opts.fillCols === false
        ? `repeat(${Math.min(sigList.length, 4)}, minmax(0, 1fr))`
        : `repeat(${Math.max(3, Math.min(sigList.length, 4))}, minmax(0, 1fr))`,
      gap: 8,
    }}>
      {sigList.map((sig, i) => {
        const r = resolveSignal(sig, period);
        const valueColor = sigColor(sig, r.value);
        const target = sigTarget(sig);
        const statusWord = sigStatus(sig, r.value);
        const hist = sigHistory[sig] || [];
        return (
          <div key={i} style={signalCellStyle}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sig}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: r.value === '—' ? 'var(--text-muted)' : valueColor, lineHeight: 1 }}>{r.value}</span>
              {r.unit && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.unit}</span>}
            </div>
            <SignalSparkline history={hist} color={valueColor === 'var(--text-muted)' ? 'var(--text-muted)' : valueColor}/>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {target != null ? (
                <span>goal {target}{r.unit ? ` ${r.unit}` : ''}</span>
              ) : (
                <span>{statusWord || ''}</span>
              )}
              {target != null && statusWord && <span style={{ color: valueColor, fontWeight: 500 }}>{statusWord}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={containerRef} style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${statusColor}55`,
      borderRadius: 12,
      padding: 'clamp(14px,1.4vw,18px)',
      marginTop: 10,
      animation: 'edgeiqSlideDown 0.25s ease-out',
      scrollMarginTop: 80,  // leaves space for any sticky header above
    }}>
      <style>{`@keyframes edgeiqSlideDown { from { opacity: 0; max-height: 0; transform: translateY(-8px); } to { opacity: 1; max-height: 1200px; transform: translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{system.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{comment || 'Click tile again to close'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 28, fontWeight: 600, color: statusColor, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{system.pct || 0}%</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>today</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
            aria-label="Close detail panel"
            title="Close"
          >×</button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-default)', marginBottom: 12 }}>
        <div style={tabStyle(tab === 'daily')}  onClick={() => setTab('daily')}>Daily</div>
        <div style={tabStyle(tab === 'weekly')} onClick={() => setTab('weekly')}>Weekly</div>
        <div style={tabStyle(tab === 'annual')} onClick={() => setTab('annual')}>Annual</div>
      </div>

      {/* ── Tab summary header — directional interpretation per tab ── */}
      {(() => {
        // Compute insights specific to the tab
        const lowestNutrient = nutrients.length ? [...nutrients].filter(n => n.pct != null).sort((a, b) => a.pct - b.pct)[0] : null;
        const highestNutrient = nutrients.length ? [...nutrients].filter(n => n.pct != null).sort((a, b) => b.pct - a.pct)[0] : null;
        // 7-day delta (this week's first day vs last week's same day)
        const wowDelta = weekly.length >= 7 && weekly[0]?.pct != null && weekly[6]?.pct != null
          ? weekly[0].pct - weekly[6].pct
          : null;
        // Days logged this week (any data)
        const daysLogged = weekly.filter(d => d.pct != null && d.pct > 0).length;
        // YTD trend direction (compare first half vs second half of weekly)
        const firstHalfAvg = weekly.slice(0, 3).filter(d => d.pct).map(d => d.pct);
        const secondHalfAvg = weekly.slice(4, 7).filter(d => d.pct).map(d => d.pct);
        const trendDir = firstHalfAvg.length && secondHalfAvg.length
          ? (secondHalfAvg.reduce((s,v)=>s+v,0)/secondHalfAvg.length) - (firstHalfAvg.reduce((s,v)=>s+v,0)/firstHalfAvg.length)
          : null;

        const summaryStyle = {
          background: `${statusColor}11`,
          border: `0.5px solid ${statusColor}33`,
          borderLeft: `3px solid ${statusColor}`,
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 14,
          fontSize: 12,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        };
        const labelStyle = { fontSize: 9, fontWeight: 700, color: statusColor, letterSpacing: '0.10em', textTransform: 'uppercase', marginRight: 8 };

        if (tab === 'daily') {
          const score = system.pct || 0;
          const verdict = score >= 80 ? 'Strong' : score >= 50 ? 'On track' : 'Needs attention';
          const nutHook = lowestNutrient && lowestNutrient.pct < 50 ? `${lowestNutrient.short || lowestNutrient.name} ${lowestNutrient.pct}%` : null;
          const winHook = highestNutrient && highestNutrient.pct >= 100 ? `${highestNutrient.short || highestNutrient.name} ${highestNutrient.pct}%` : null;
          return (
            <div style={summaryStyle}>
              <span style={labelStyle}>Today</span>
              <span style={{ color: statusColor, fontWeight: 600 }}>{verdict}</span>
              <span> — {comment || `${system.name} score reflects today's inputs.`}</span>
              {(nutHook || winHook) && (
                <div style={{ marginTop: 6, fontSize: 11 }}>
                  {nutHook && <span style={{ color: '#f87171' }}>⚠ Lowest: {nutHook}</span>}
                  {nutHook && winHook && <span style={{ color: 'var(--text-muted)' }}>  ·  </span>}
                  {winHook && <span style={{ color: '#4ade80' }}>✓ Hit: {winHook}</span>}
                </div>
              )}
            </div>
          );
        }
        if (tab === 'weekly') {
          const dirWord = trendDir == null ? '' : trendDir > 5 ? 'trending up' : trendDir < -5 ? 'trending down' : 'flat';
          const dirColor = trendDir == null ? 'var(--text-muted)' : trendDir > 0 ? '#4ade80' : trendDir < 0 ? '#f87171' : 'var(--text-muted)';
          return (
            <div style={summaryStyle}>
              <span style={labelStyle}>This week</span>
              <span>Avg <span style={{ color: barColor(weeklyAvg || 0), fontWeight: 600 }}>{weeklyAvg || '—'}%</span></span>
              {dirWord && <span> · <span style={{ color: dirColor, fontWeight: 500 }}>{dirWord}</span></span>}
              <span style={{ color: 'var(--text-muted)' }}> · {daysLogged}/7 days with data</span>
              {wowDelta != null && (
                <span style={{ marginLeft: 8, color: wowDelta > 0 ? '#4ade80' : wowDelta < 0 ? '#f87171' : 'var(--text-muted)' }}>
                  {wowDelta > 0 ? '↑' : wowDelta < 0 ? '↓' : '→'} {Math.abs(wowDelta)} vs 7d ago
                </span>
              )}
            </div>
          );
        }
        if (tab === 'annual') {
          // Find the most recent lab panel date + age in months
          const sortedLabs = [...labsSource].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          const latestLab = sortedLabs[0];
          const labAge = latestLab?.date ? Math.round((Date.now() - new Date(`${latestLab.date}T12:00:00`).getTime()) / (30 * 86400000)) : null;
          const stale = labAge != null && labAge > 12;
          return (
            <div style={summaryStyle}>
              <span style={labelStyle}>YTD</span>
              <span>{system.name} trajectory · score today <span style={{ color: statusColor, fontWeight: 600 }}>{system.pct}%</span></span>
              {latestLab?.date ? (
                <span style={{ color: 'var(--text-muted)' }}>  ·  last lab <span style={{ color: stale ? '#fbbf24' : 'var(--text-secondary)', fontWeight: 500 }}>{latestLab.date}</span>
                  {stale && <span style={{ color: '#fbbf24' }}> ({labAge}mo old — schedule new panel)</span>}
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>  ·  <span style={{ color: '#fbbf24' }}>No lab panel on file — schedule baseline test</span></span>
              )}
            </div>
          );
        }
        return null;
      })()}

      {/* ── Daily tab ── */}
      {tab === 'daily' && (
        <div>
          {/* Nutrient breakdown */}
          {nutrients.length > 0 && (
            <>
              <div style={{ ...subHeaderStyle, marginTop: 0 }}>Nutrients · today's intake</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'clamp(8px,1vw,14px)' }}>
                {nutrients.map((n, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>
                      <span style={{ fontWeight: 500 }}>{n.short || n.name}</span>
                      <span style={{ color: barColor(n.pct), fontWeight: 600 }}>
                        {n.value} / {n.target}
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>({n.pct}%)</span>
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                      <div style={{ height: 5, background: barColor(n.pct), borderRadius: 3, width: `${Math.min(n.pct, 100)}%`, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {signals.training.length > 0 && (<><div style={subHeaderStyle}>Training signals</div>{renderSignalGrid(signals.training, 'daily')}</>)}
          {signals.body.length > 0 && (<><div style={subHeaderStyle}>Body signals</div>{renderSignalGrid(signals.body, 'daily')}</>)}
          {signals.blood.length > 0 && (
            <>
              <div style={subHeaderStyle}>Blood markers · last lab panel</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.blood.length, 4)}, 1fr)`, gap: 8 }}>
                {signals.blood.map((sig, i) => {
                  const r = resolveBlood(sig);
                  return (
                    <div key={i} style={signalCellStyle}>
                      <div style={{ fontSize: 18, fontWeight: 600, color: r.value === '—' ? 'var(--text-muted)' : 'var(--text-primary)', lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 6 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Weekly tab ── */}
      {tab === 'weekly' && (
        <div>
          <div style={{ ...subHeaderStyle, marginTop: 0 }}>7-day score</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'flex-end' }}>
            {weekly.map((d, i) => {
              const barH = weeklyMax > 0 ? Math.max(6, Math.round((d.pct / weeklyMax) * 90)) : 6;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 10, color: barColor(d.pct), fontWeight: 600, marginBottom: 4 }}>{d.pct}</div>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 90 }}>
                    <div style={{ width: '100%', borderRadius: 4, height: barH, background: barColor(d.pct), transition: 'height 0.4s ease' }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>{d.dayLabel}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', padding: '8px 0', borderTop: '0.5px solid var(--border-subtle)' }}>
            <span style={{ fontWeight: 500 }}>Weekly avg</span>
            <span style={{ fontWeight: 600, color: barColor(weeklyAvg || 0) }}>{weeklyAvg || '—'}%</span>
          </div>
          {signals.training.length > 0 && (<><div style={subHeaderStyle}>Weekly training</div>{renderSignalGrid(signals.training, 'weekly')}</>)}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center', fontStyle: 'italic' }}>
            Nutrient scores reflect today's intake — log consistently for accurate weekly trends
          </div>
        </div>
      )}

      {/* ── Annual tab ── */}
      {tab === 'annual' && (
        <div>
          {signals.training.length > 0 && (<><div style={{ ...subHeaderStyle, marginTop: 0 }}>YTD training</div>{renderSignalGrid(signals.training, 'annual')}</>)}
          {signals.body.length > 0 && (<><div style={subHeaderStyle}>Body · current</div>{renderSignalGrid(signals.body, 'daily')}</>)}
          {signals.blood.length > 0 && (() => {
            // Lab freshness — pulled from the most recent panel that
            // contains *any* of this system's blood markers. Marker-level
            // status badges so the tile communicates what to act on.
            const sortedLabs = [...labsSource].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const latestLab = sortedLabs[0];
            const labAgeMo = latestLab?.date
              ? Math.round((Date.now() - new Date(`${latestLab.date}T12:00:00`).getTime()) / (30 * 86400000))
              : null;
            const stale = labAgeMo != null && labAgeMo > 12;
            return (
              <>
                <div style={{ ...subHeaderStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Latest labs</span>
                  {latestLab?.date ? (
                    <span style={{ fontSize: 9, color: stale ? '#fbbf24' : 'var(--text-muted)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                      panel · {latestLab.date}{stale ? ` · ${labAgeMo}mo old` : ''}
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, color: '#fbbf24', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>no panel on file</span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(3, Math.min(signals.blood.length, 4))}, 1fr)`, gap: 8 }}>
                  {signals.blood.map((sig, i) => {
                    const r = resolveBlood(sig);
                    const hasValue = r.value !== '—' && r.value != null;
                    return (
                      <div key={i} style={{ ...signalCellStyle, opacity: hasValue ? 1 : 0.65 }}>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sig}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 18, fontWeight: 600, color: hasValue ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1 }}>{r.value}</span>
                          {r.unit && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.unit}</span>}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                          {hasValue
                            ? (stale ? <span style={{ color: '#fbbf24' }}>stale — re-test</span> : <span>recorded</span>)
                            : <span style={{ color: '#fbbf24' }}>no result</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function HealthSystemTile({ sys, isExpanded, onClick }) {
  const { pct, status, comment, color, name, id } = sys;
  const statusColor = status === 'good' ? '#4ade80' : status === 'focus' ? '#fbbf24' : '#f87171';
  const fillTint = status === 'good' ? 'rgba(74,222,128,0.15)'
    : status === 'focus' ? 'rgba(251,191,36,0.15)'
    : 'rgba(248,113,113,0.18)';
  const pngSrc = SYSTEM_PNGS_DESKTOP[id];
  const svgIcon = SYSTEM_ICONS[id] ? SYSTEM_ICONS[id](color) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      style={{
        position: 'relative',
        background: 'var(--bg-elevated)',
        border: isExpanded ? `1px solid ${statusColor}` : '0.5px solid var(--border-subtle)',
        borderRadius: 12,
        padding: '10px 6px 9px',
        overflow: 'hidden',
        minHeight: 0,
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: isExpanded ? `0 0 0 1px ${statusColor}55 inset` : 'none',
      }}>

      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: `${Math.max(8, pct)}%`,
        background: `linear-gradient(180deg, transparent, ${fillTint})`,
        borderRadius: '0 0 12px 12px',
        transition: 'height 0.6s ease',
        zIndex: 0,
      }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, margin: '0 auto 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{pngSrc
          ? <img src={pngSrc} alt={name} width={44} height={44} style={{ display: 'block' }} />
          : svgIcon}</div>
        <div style={{
          fontSize: 9, fontWeight: 600, color: 'var(--text-primary)',
          lineHeight: 1.15, marginBottom: 3, minHeight: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{name.replace(' & ', '/')}</div>
        <div style={{
          fontSize: 13, fontWeight: 700, color: statusColor,
          fontFamily: 'var(--font-mono)', marginBottom: 3,
        }}>{pct}%</div>
        <div style={{
          fontSize: 8, color: 'var(--text-muted)',
          lineHeight: 1.25, minHeight: 20,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>{comment}</div>
      </div>
    </div>
  );
}

// ─── Start Tile Picker Section (Goals tab, Phase 4b) ──────────────────────
// Embeds the picker inline as the last section of the Goals tab. Lets the
// user pick which 2-4 metrics show in each Start screen category. Saves to
// storage('startTilePrefs'); cloud-sync propagates to mobile within seconds.
function StartTilePickerSection({ data }) {
  // useStorageVersion → tile context rebuilds whenever any storage key changes.
  // Previously this useMemo had [] deps, so the picker would only see fresh
  // data after a force-close + reopen — annoying UX after every Cloud Sync.
  const storageVersion = useStorageVersion();
  const ctx = useMemo(() => buildTileContext({
    activities: getUnifiedActivities(),
    sleepData: cleanSleepForAveraging(storage.get('sleep') || []),
    hrvData: storage.get('hrv') || [],
    weightData: storage.get('weight') || [],
    nutritionLog: storage.get('nutritionLog') || [],
    cronometer: storage.get('cronometer') || [],
    dailyLogs: storage.get('dailyLogs') || [],
    profile: { ...(storage.get('profile') || {}), ...getGoals() },
    wellness: storage.get('wellness') || [],
  }), [storageVersion]);
  return (
    <div style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>◈ Customize Start Screen</div>
      <StartTilePickerInner ctx={ctx} layout="grid" />
    </div>
  );
}

// ─── Today's energy target line (web EdgeIQ panel) ─────────────────────────
function TodaysTargetLine() {
  const dyn = useMemo(() => getDynamicMacroTarget(), []);
  if (!dyn.dynamicTarget) return null;
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 8,
      background: 'rgba(155,142,196,0.06)',
      border: '1px solid rgba(155,142,196,0.15)',
      marginBottom: 8,
      display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Today's Target
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{dyn.dynamicTarget} kcal</span>
      {dyn.isTrainingDay && (
        <span style={{ fontSize: 10, color: '#e0b45e', fontWeight: 600 }}>
          training day · {dyn.baseline} + {dyn.eatBackKcal} earned
        </span>
      )}
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        <strong style={{ color: '#9b8ec4' }}>{dyn.proteinG}g</strong> P ·
        <strong style={{ color: '#6bcf9a', marginLeft: 4 }}>{dyn.carbsG}g</strong> C ·
        <strong style={{ color: '#e0b45e', marginLeft: 4 }}>{dyn.fatG}g</strong> F ·
        <strong style={{ color: '#6fd4e4', marginLeft: 4 }}>{dyn.fiberG}g</strong> fiber
      </span>
    </div>
  );
}

// ─── Calibration headline (single-row, tap-to-navigate) ───────────────────
// One-line status summary at the top of the EdgeIQ panel. Tap navigates to
// the Goals tab where the full Nutrition Calibration Panel lives — that's
// the canonical home for the deep diagnostic (predicted/actual tiles,
// path-to-target, RMR/TDEE breakdown, drift causes, body prompts).
//
// Today's target line lives on Daily / Fuel where you log food.
function CalibrationSummaryStrip({ setTab }) {
  const cal = useMemo(() => {
    try { return assessCalibration({ weeks: 4 }); } catch { return null; }
  }, []);
  if (!cal || cal.status === 'no-data') return null;
  const statusColor =
    cal.status === 'aligned'    ? '#4ade80' :
    cal.status === 'under-loss' ? '#fbbf24' :
    cal.status === 'over-loss'  ? '#60a5fa' :
                                  'var(--text-muted)';
  const statusLabel =
    cal.status === 'aligned'    ? 'ON PACE' :
    cal.status === 'under-loss' ? 'BEHIND'  :
    cal.status === 'over-loss'  ? 'AHEAD'   :
                                  cal.status.toUpperCase();
  const tile = (label, value, sub, color) => (
    <div style={{
      flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 8,
      background: 'rgba(255,255,255,0.025)',
      borderLeft: `2px solid ${color}`,
    }}>
      <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
  const rec = useMemo(() => { try { return recommendCalorieTarget(); } catch { return null; } }, []);

  // Compact one-line summary
  const driftStr = `${cal.driftLbs > 0 ? '+' : ''}${cal.driftLbs.toFixed(1)} lb drift`;
  const etaPart  = rec?.projectedDate ? ` · ETA ${rec.projectedDate}` : '';
  const goalPart = rec?.userTargetDate
    ? ` vs goal ${rec.userTargetDate}${rec?.requiredLossRate != null && rec.requiredLossRate > 1.0 ? ' — aggressive' : ''}`
    : '';

  return (
    <div
      onClick={() => setTab?.('goals')}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,0.025)',
        borderLeft: `3px solid ${statusColor}`,
        cursor: setTab ? 'pointer' : 'default',
        userSelect: 'none',
        marginBottom: 10,
      }}
      title={setTab ? 'Open full calibration panel in Goals' : ''}
    >
      <span style={{ fontSize: 11, fontWeight: 800, color: statusColor, letterSpacing: '0.05em', flexShrink: 0 }}>
        {statusLabel}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {driftStr}{etaPart}{goalPart}
      </span>
      {setTab && (
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          see Goals →
        </span>
      )}
    </div>
  );
}

// ─── Pillar-filtered coaching strip ───────────────────────────────────────
// Used by Fuel (nutrition pillar) and Play (run + recovery pillars).
// Shows up to 3 prompts limited to the requested pillars, plus a contextual
// "all clear" fallback message when no prompts fire for those pillars.
function PillarCoachingStrip({ pillars, fallbackTitle, fallbackDetail, accentColor = '#9b8ec4', compact = false }) {
  const wanted = Array.isArray(pillars) ? pillars : [pillars];
  const prompts = useMemo(() => getPromptsByPillar(wanted, 3), [wanted.join(',')]);
  const [expanded, setExpanded] = useState(false);
  const colorFor = sev =>
    sev === 'critical' ? '#f87171' :
    sev === 'warning'  ? '#fbbf24' :
    sev === 'positive' ? '#4ade80' :
                         '#60a5fa';
  const iconFor = pillar =>
    pillar === 'nutrition' ? '🍽' :
    pillar === 'recovery'  ? '☾' :
    pillar === 'run'       ? '↗' :
    pillar === 'body'      ? '◎' : '•';

  // ── Compact coach line (Phase 4o.daily.7) ──
  // No outer container card. Single inline row: tiny status dot + title +
  // detail (truncating ellipsis) + optional "+N more" expander. Designed
  // to sit at the top of a panel column without competing visually with
  // the panel below it. Honors `min-width:0` so it shrinks gracefully on
  // narrow viewports.
  if (compact) {
    if (!prompts.length) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 4px', marginBottom: 8, minWidth: 0,
          fontSize: 11,
        }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: accentColor, flexShrink: 0, opacity: 0.7 }}/>
          <span style={{ fontWeight: 600, color: accentColor, whiteSpace: 'nowrap' }}>{fallbackTitle}</span>
          <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>· {fallbackDetail}</span>
        </div>
      );
    }
    const visible = expanded ? prompts : prompts.slice(0, 1);
    const hidden = prompts.length - visible.length;
    return (
      <div style={{ marginBottom: 8, minWidth: 0 }}>
        {visible.map((p, i) => {
          const c = colorFor(p.severity);
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 4px', minWidth: 0, fontSize: 11,
              borderTop: i > 0 ? '0.5px solid var(--border-subtle)' : 'none',
            }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }}/>
              <span style={{ fontWeight: 600, color: c, whiteSpace: 'nowrap' }}>{p.title}</span>
              <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>· {p.detail}</span>
              {p.action?.label && (
                <span style={{ fontSize: 9, fontWeight: 600, color: c, opacity: 0.85, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                  {p.action.label}
                </span>
              )}
            </div>
          );
        })}
        {hidden > 0 && (
          <button onClick={() => setExpanded(true)}
            style={{ fontSize: 9, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.04em' }}>
            +{hidden} more
          </button>
        )}
        {expanded && prompts.length > 1 && (
          <button onClick={() => setExpanded(false)}
            style={{ fontSize: 9, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.04em' }}>
            ↑ less
          </button>
        )}
      </div>
    );
  }

  // ── Full mode (legacy, used elsewhere) — bordered card with multi-row layout ──
  const card = {
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 14px',
    marginBottom: 10,
    minWidth: 0,
  };

  if (!prompts.length) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `${accentColor}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>✓</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: accentColor, marginBottom: 2 }}>{fallbackTitle}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{fallbackDetail}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        ◎ Today's Coaching
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {prompts.map(p => {
          const c = colorFor(p.severity);
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px', borderRadius: 8, minWidth: 0,
              background: 'rgba(255,255,255,0.025)',
              borderLeft: `3px solid ${c}`,
            }}>
              <div style={{ fontSize: 14, opacity: 0.75, marginTop: 1, minWidth: 14, textAlign: 'center' }}>{iconFor(p.pillar)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: c, marginBottom: 2 }}>{p.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{p.detail}</div>
              </div>
              {p.action?.label && (
                <div style={{ fontSize: 9, fontWeight: 700, color: c, opacity: 0.85, whiteSpace: 'nowrap', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {p.action.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Coaching prompts strip ────────────────────────────────────────────────
// (legacy) Generic top-3 strip — kept available for non-EdgeIQ surfaces if
// needed; not currently rendered.
function CoachingStrip({ dateStr }) {
  const prompts = useMemo(() => getTopCoachingPrompts(3), [dateStr]);
  if (!prompts.length) return <TodaysTargetLine />;
  const colorFor = sev =>
    sev === 'critical' ? '#f87171' :
    sev === 'warning'  ? '#fbbf24' :
    sev === 'positive' ? '#4ade80' :
                         '#60a5fa';
  const iconFor = pillar =>
    pillar === 'nutrition' ? '🍽' :
    pillar === 'recovery'  ? '☾' :
    pillar === 'run'       ? '↗' :
    pillar === 'body'      ? '◎' : '•';
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
      <TodaysTargetLine />
      {prompts.map(p => {
        const c = colorFor(p.severity);
        return (
          <div key={p.id} style={{
            display:'flex',alignItems:'flex-start',gap:10,
            padding:'8px 10px',borderRadius:8,
            background:'rgba(255,255,255,0.025)',
            borderLeft:`3px solid ${c}`,
          }}>
            <div style={{fontSize:14,opacity:0.7,marginTop:1,minWidth:14,textAlign:'center'}}>{iconFor(p.pillar)}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:c,marginBottom:2}}>{p.title}</div>
              <div style={{fontSize:11,color:'var(--text-muted)',lineHeight:1.35}}>{p.detail}</div>
            </div>
            {p.action?.label && (
              <div style={{fontSize:10,fontWeight:600,color:c,opacity:0.85,whiteSpace:'nowrap',alignSelf:'center'}}>
                → {p.action.label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HealthSystemsGrid({ dateStr, data }) {
  const report = useMemo(() => getSystemsReport(dateStr), [dateStr]);
  const goodCount = report.filter(s => s.status === 'good').length;
  const focusCount = report.filter(s => s.status === 'focus').length;
  const defCount = report.filter(s => s.status === 'def').length;

  // Phase 4n.3.1 — single tile expands at a time. Click a tile to open
  // the WebSystemDetail panel; click the same tile again (or the close
  // button) to collapse. The panel renders BELOW the grid, not inside
  // any individual tile, so the grid stays clean and the detail has
  // full row width.
  const [expandedId, setExpandedId] = useState(null);
  const expandedSystem = expandedId ? report.find(s => s.id === expandedId) : null;

  return (
    <div style={{background:'var(--bg-surface)',border:'0.5px solid var(--border-default)',borderRadius:'var(--radius-md)',padding:'14px 16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>⬡ Health Systems</span>
        <div style={{display:'flex',gap:8,fontSize:9,color:'var(--text-muted)'}}>
          <span style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'#4ade80'}}/>{goodCount}
          </span>
          <span style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'#fbbf24'}}/>{focusCount}
          </span>
          <span style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'#f87171'}}/>{defCount}
          </span>
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 6,
      }}>
        {report.map(sys => (
          <HealthSystemTile
            key={sys.id}
            sys={sys}
            isExpanded={expandedId === sys.id}
            onClick={() => setExpandedId(expandedId === sys.id ? null : sys.id)}
          />
        ))}
      </div>
      {expandedSystem && (
        <WebSystemDetail
          system={expandedSystem}
          comment={expandedSystem.comment}
          data={data}
          onClose={() => setExpandedId(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING TAB
// ═══════════════════════════════════════════════════════════════════════════════
function TrainingTab({setTab,data,mobileInitView,onMobileInitViewUsed}){
  const profile={...(storage.get('profile')||{}),...getGoals()};
  const activities=getUnifiedActivities();
  const cronometer=storage.get('cronometer')||[];
  const weightData=storage.get('weight')||[];
  const hrvData=storage.get('hrv')||[];
  const sleepData=cleanSleepForAveraging(storage.get('sleep')||[]);
  const dailyLogs=storage.get('dailyLogs')||[];

  // ── Tab-owned AI analysis (persisted) ──
  const AI_KEY='arnold:ai:training';
  const[aiState,setAiState]=useState(()=>{
    try{return JSON.parse(localStorage.getItem(AI_KEY)||'null');}catch{return null;}
  });
  const[aiLoading,setAiLoading]=useState(false);
  const[aiStream2,setAiStream2]=useState('');
  const runTrainingAI=async()=>{
    if(aiLoading)return;
    setAiLoading(true);setAiStream2('');
    try{
      // Build a compact training context from the same data the tab already reads.
      const ytdRunsLocal=activities.filter(a=>a.date&&parseLocalDate(a.date)>=new Date(new Date().getFullYear(),0,1)&&isRunAct(a));
      const ytdMi=ytdRunsLocal.reduce((s,a)=>s+(a.distanceMi||0),0);
      const last7Sleep=sleepData.slice(0,7).filter(s=>s.durationMinutes);
      const last7HRV=hrvData.slice(0,7).filter(h=>h.overnightHRV);
      const ctx={
        date:td(),
        ytd:{runs:ytdRunsLocal.length,miles:Math.round(ytdMi*10)/10,goalMi:profile?.annualRunDistanceTarget||800},
        weekly:{
          avgMi:ytdRunsLocal.length?Math.round((ytdMi/((Date.now()-new Date(new Date().getFullYear(),0,1))/86400000/7))*10)/10:0,
          targetMi:profile?.weeklyRunDistanceTarget||20,
        },
        recovery:{
          avgSleepHrs:last7Sleep.length?Math.round((last7Sleep.reduce((s,r)=>s+r.durationMinutes,0)/last7Sleep.length/60)*10)/10:null,
          avgHRV:last7HRV.length?Math.round(last7HRV.reduce((s,r)=>s+r.overnightHRV,0)/last7HRV.length):null,
        },
        body:{
          weightLbs:weightData[0]?.weightLbs||null,
          bodyFatPct:weightData[0]?.bodyFatPct||null,
          targetLbs:profile?.targetWeight||null,
          targetBF:profile?.targetBodyFat||null,
        },
        recentRuns:ytdRunsLocal.slice(0,8).map(r=>({date:r.date,mi:r.distanceMi,pace:r.avgPaceRaw,hr:r.avgHR})),
        goalPace:profile?.targetRacePace||null,
      };
      const text=await aiStream(
        `You are Arnold, a precise training analyst. Use only the provided JSON. Be direct, cite real numbers, and avoid fluff.`,
        `Analyze my training. Today: ${ctx.date}.

DATA:
${JSON.stringify(ctx,null,2)}

Structure:
## Training Status
2-3 sentence executive summary with a 1-10 readiness score.

## What's Working ✓
2-3 bullets with specific numbers.

## What Needs Attention ⚠
2-3 bullets with specific numbers and why they matter for the annual mileage and race-pace goals.

## 3 Actions for Next Week
1. [Specific, measurable]
2. [Specific, measurable]
3. [Specific, measurable]`,
        1500,
        chunk=>setAiStream2(chunk)
      );
      const next={text,date:new Date().toISOString()};
      localStorage.setItem(AI_KEY,JSON.stringify(next));
      setAiState(next);
    }catch(e){
      setAiStream2(`Error: ${e.message}`);
    }finally{
      setAiLoading(false);
    }
  };

  // ── Mobile detection: serve smart-home layout on narrow screens ──
  const [isMobile,setIsMobile]=useState(()=>window.innerWidth<=600);
  useEffect(()=>{
    const mq=window.matchMedia('(max-width: 600px)');
    const handler=e=>setIsMobile(e.matches);
    mq.addEventListener('change',handler);
    return()=>mq.removeEventListener('change',handler);
  },[]);

  // Empty state — on mobile, show MobileHome even without data (with sync prompt)
  const nextRaceEmpty=(()=>{try{const races=JSON.parse(localStorage.getItem('arnold:races')||'[]');const now2=new Date();now2.setHours(0,0,0,0);return races.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=now2;}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date))[0]||null;}catch{return null;}})();
  if(!activities.length&&!cronometer.length&&!weightData.length){
    if(isMobile){
      return <MobileHome data={data} onOpenTab={setTab} initialView={mobileInitView} />;
    }
    return(
      <div style={S.sec}>
        <div style={S.st}>◈ EdgeIQ</div>
        <div style={{...S.empty,display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{fontSize:"clamp(13px,0.8vw + 9px,16px)",color:C.t}}>No training data yet.</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>Import your CSVs in the Daily tab to unlock EdgeIQ.</div>
          <button style={{...S.sb,width:"auto",padding:"10px 24px"}} onClick={()=>setTab("daily")}>Go to Daily →</button>
        </div>
      </div>
    );
  }

  // ── Targets / goals ──
  const weeklyRunTarget=parseFloat(profile?.weeklyRunDistanceTarget)||20;
  const annualRunTarget=parseFloat(profile?.annualRunDistanceTarget)||800;
  const annualWorkoutTarget=parseFloat(profile?.annualWorkoutsTarget)||200;
  const strTarget=parseFloat(profile?.weeklyStrengthTarget)||2;
  const goalPaceSecs=(()=>{const p=profile?.targetRacePace||'9:30';const[m,s]=p.split(':').map(Number);return m*60+(s||0);})();
  const weeklyHrsTarget=parseFloat(profile?.weeklyTimeTargetHrs)||5;

  // ── Date helpers ──
  const yearStart=new Date(new Date().getFullYear(),0,1);
  const today=new Date();
  const yearStr=String(today.getFullYear());
  const yearLabel=`Jan 1 – ${today.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
  const daysInYear=Math.floor((today-yearStart)/86400000)||1;

  // YTD activities
  const ytdActs=activities.filter(a=>{const d=parseLocalDate(a.date);return d&&d>=yearStart;});
  const ytdRuns=ytdActs.filter(a=>a.activityType?.toLowerCase().includes('run'));
  const ytdStrength=ytdActs.filter(a=>{const t=a.activityType?.toLowerCase()||'';return t.includes('strength')||t.includes('training');});

  const totalMi=ytdRuns.reduce((s,a)=>s+(a.distanceMi||0),0);
  const totalSessions=ytdActs.length;
  const weeksElapsed=Math.max(daysInYear/7,1);
  const avgWeeklyMi=totalMi/weeksElapsed;
  const avgWeeklyHrsRun=(ytdRuns.reduce((s,a)=>s+(a.durationSecs||0),0)/3600)/weeksElapsed;
  const avgWeeklyHrsStr=(ytdStrength.reduce((s,a)=>s+(a.durationSecs||0),0)/3600)/weeksElapsed;
  const avgWeeklyHrsTotal=avgWeeklyHrsRun+avgWeeklyHrsStr;

  const runPaces=ytdRuns.map(a=>{if(!a.avgPaceRaw)return null;const[m,s]=a.avgPaceRaw.split(':').map(Number);return m*60+(s||0);}).filter(Boolean);
  const avgPaceSecs=runPaces.length?runPaces.reduce((s,v)=>s+v,0)/runPaces.length:null;
  const fmtPace=s=>s?`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`:'—';
  const avgHRRuns=ytdRuns.map(a=>a.avgHR).filter(Boolean);
  const avgHR=avgHRRuns.length?Math.round(avgHRRuns.reduce((s,v)=>s+v,0)/avgHRRuns.length):null;
  const longRun=Math.max(...ytdRuns.slice(-12).map(a=>a.distanceMi||0),0);

  // Aerobic vs anaerobic balance — runs vs everything else
  const aeroPct=totalSessions>0?Math.round((ytdRuns.length/totalSessions)*100):62;
  const anaPct=100-aeroPct;

  // Weekly stats for charts (last 8 weeks) — Monday-start weeks. Sunday belongs
  // to the previous week's Monday, so we offset by 6 instead of getDay()=0.
  const weeklyStats=Array.from({length:8},(_,i)=>{
    const dow=today.getDay();const offset=dow===0?6:dow-1;
    const wStart=new Date(today);wStart.setDate(today.getDate()-(7*(7-i)+offset));wStart.setHours(0,0,0,0);
    const wEnd=new Date(wStart);wEnd.setDate(wStart.getDate()+7);
    const wRuns=activities.filter(a=>{const d=parseLocalDate(a.date);return d&&d>=wStart&&d<wEnd&&a.activityType?.toLowerCase().includes('run');});
    const wAll=activities.filter(a=>{const d=parseLocalDate(a.date);return d&&d>=wStart&&d<wEnd;});
    const wMi=wRuns.reduce((s,a)=>s+(a.distanceMi||0),0);
    const wHrs=wAll.reduce((s,a)=>s+(a.durationSecs||0),0)/3600;
    const wPaces=wRuns.map(a=>{if(!a.avgPaceRaw)return null;const[m,s]=a.avgPaceRaw.split(':').map(Number);return m*60+(s||0);}).filter(Boolean);
    const wPace=wPaces.length?wPaces.reduce((s,v)=>s+v,0)/wPaces.length:null;
    const wWeights=weightData.filter(w=>{const d=parseLocalDate(w.date);return d&&d>=wStart&&d<wEnd;});
    const wWt=wWeights.length?wWeights.reduce((s,w)=>s+(w.weightLbs||0),0)/wWeights.length:null;
    // Sleep / HRV / RHR per week — same window, averaged
    const wSleep=sleepData.filter(s=>{const d=parseLocalDate(s.date);return d&&d>=wStart&&d<wEnd;});
    const wHRV=hrvData.filter(h=>{const d=parseLocalDate(h.date);return d&&d>=wStart&&d<wEnd&&h.overnightHRV;});
    const wSleepScore=wSleep.filter(s=>s.sleepScore).length?Math.round(wSleep.filter(s=>s.sleepScore).reduce((s,sl)=>s+sl.sleepScore,0)/wSleep.filter(s=>s.sleepScore).length):null;
    const wHRVAvg=wHRV.length?Math.round(wHRV.reduce((s,h)=>s+h.overnightHRV,0)/wHRV.length):null;
    const wRHRArr=wSleep.filter(s=>s.restingHR);
    const wRHR=wRHRArr.length?Math.round(wRHRArr.reduce((s,sl)=>s+sl.restingHR,0)/wRHRArr.length):null;
    const wSleepMins=wSleep.filter(s=>s.durationMinutes).length?Math.round(wSleep.filter(s=>s.durationMinutes).reduce((s,sl)=>s+sl.durationMinutes,0)/wSleep.filter(s=>s.durationMinutes).length):null;
    return{mi:wMi,hrs:wHrs,pace:wPace,weight:wWt,sleepScore:wSleepScore,hrv:wHRVAvg,rhr:wRHR,sleepMins:wSleepMins,sessions:wAll.length,runs:wRuns.length};
  });

  // Current week: Mon→Sun window containing today
  const thisWeekData=(()=>{
    const d=new Date(today);
    const dow=d.getDay(); // 0=Sun..6=Sat
    const mondayOffset=dow===0?6:dow-1; // days since Monday
    const wkStart=new Date(d);wkStart.setDate(d.getDate()-mondayOffset);wkStart.setHours(0,0,0,0);
    const wkEnd=new Date(wkStart);wkEnd.setDate(wkStart.getDate()+7);
    const wRuns=activities.filter(a=>{if(!a.date)return false;const ad=new Date(a.date+'T12:00:00');return ad>=wkStart&&ad<wkEnd&&a.activityType?.toLowerCase().includes('run');});
    const wAll=activities.filter(a=>{if(!a.date)return false;const ad=new Date(a.date+'T12:00:00');return ad>=wkStart&&ad<wkEnd;});
    const mi=wRuns.reduce((s,a)=>s+(a.distanceMi||0),0);
    const hrs=wAll.reduce((s,a)=>s+(a.durationSecs||0),0)/3600;
    return{mi,hrs,sessions:wAll.length,runs:wRuns.length};
  })();

  // 30-day nutrition — merge cronometer CSV + manual nutritionLog entries
  const thirtyDays=new Date();thirtyDays.setDate(today.getDate()-30);
  const recentNut=(()=>{
    // Build per-day totals from both sources using the unified dailyTotals()
    const days=[];
    for(let i=0;i<30;i++){
      const d=new Date();d.setDate(today.getDate()-i);
      const ds=td(d);
      const t=nutDailyTotals(ds);
      if(t.calories>0||t.protein>0) days.push({date:ds,...t});
    }
    return days;
  })();
  const avgCalories=recentNut.length?Math.round(recentNut.reduce((s,n)=>s+(n.calories||0),0)/recentNut.length):null;
  const avgProtein=recentNut.length?Math.round(recentNut.reduce((s,n)=>s+(n.protein||0),0)/recentNut.length):null;
  const avgCarbs=recentNut.length?Math.round(recentNut.reduce((s,n)=>s+(n.carbs||0),0)/recentNut.length):null;
  const avgFat=recentNut.length?Math.round(recentNut.reduce((s,n)=>s+(n.fat||0),0)/recentNut.length):null;
  const avgBurned=(avgCalories||0)+341;
  const calT=resolveCalorieTarget(td(),profile);

  // 7-day recovery — HRV merge same pattern as the upper card.
  // Worker writes overnightHRV onto sleep rows (Phase 4c); legacy `hrv`
  // collection holds older / CSV-imported readings. Worker wins per date.
  const sevenDays=new Date();sevenDays.setDate(today.getDate()-7);
  const recentSleep=sleepData.filter(s=>s.date&&parseLocalDate(s.date)>=sevenDays);
  const _mergedHrv7 = (() => {
    const byDate = new Map();
    for (const h of (hrvData || [])) {
      if (h?.date && parseLocalDate(h.date) >= sevenDays && h.overnightHRV != null && !isNaN(Number(h.overnightHRV))) {
        byDate.set(h.date, Number(h.overnightHRV));
      }
    }
    for (const s of (sleepData || [])) {
      if (s?.date && parseLocalDate(s.date) >= sevenDays && s.overnightHRV != null && !isNaN(Number(s.overnightHRV))) {
        byDate.set(s.date, Number(s.overnightHRV));
      }
    }
    return [...byDate.values()];
  })();
  const avgHRV7 = _mergedHrv7.length ? Math.round(_mergedHrv7.reduce((s, v) => s + v, 0) / _mergedHrv7.length) : null;
  const recentSleepDur2=recentSleep.filter(s=>s.durationMinutes);
  const avgSleepMins7=recentSleepDur2.length?Math.round(recentSleepDur2.reduce((s,sl)=>s+sl.durationMinutes,0)/recentSleepDur2.length):null;
  // sortedSleep uses full cleaned dataset (not just 7-day) — needed for history sparklines and MobileHome
  const sortedSleep=[...sleepData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const latestRHR=sortedSleep[0]?.restingHR||null;
  // latestSleepScore — only if the most-recent row is from today/yesterday
  // AND has a non-null score. Stale fallback (older nights) was causing
  // "last night" to display 2-3 night old scores when today's row was
  // pending Garmin Worker pull.
  const latestSleepScore=(()=>{
    const top=sortedSleep[0];
    if(!top) return null;
    const today=td();
    const yest=(()=>{const d=new Date();d.setDate(d.getDate()-1);return td(d);})();
    if(top.date!==today && top.date!==yest) return null;
    if(top.sleepScore==null) return null;
    return Math.min(top.sleepScore,100);
  })();
  // 7-day average sleep score for Focus tile threshold checks
  const avgSleepScore7=recentSleep.filter(s=>s.sleepScore).length?Math.round(recentSleep.filter(s=>s.sleepScore).reduce((s,sl)=>s+sl.sleepScore,0)/recentSleep.filter(s=>s.sleepScore).length):null;

  // 30-day recovery averages
  const hrv30=hrvData.filter(h=>h.date&&parseLocalDate(h.date)>=thirtyDays);
  const sleep30=sleepData.filter(s=>s.date&&parseLocalDate(s.date)>=thirtyDays);
  const hrv30Valid=hrv30.filter(h=>h.overnightHRV);
  const avgHRV30=hrv30Valid.length?Math.round(hrv30Valid.reduce((s,h)=>s+h.overnightHRV,0)/hrv30Valid.length):null;
  const sleep30Dur=sleep30.filter(s=>s.durationMinutes);
  const avgSleepMins30=sleep30Dur.length?Math.round(sleep30Dur.reduce((s,sl)=>s+sl.durationMinutes,0)/sleep30Dur.length):null;
  const sleep30RHR=sleep30.filter(s=>s.restingHR);
  const avgRHR30=sleep30RHR.length?Math.round(sleep30RHR.reduce((s,sl)=>s+sl.restingHR,0)/sleep30RHR.length):null;
  const fmtSleep=m=>m?`${Math.floor(m/60)}h ${m%60}m`:'—';

  // Latest weight
  const sortedW=[...weightData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const latestW=sortedW[0];
  const prevW=sortedW[7];
  const currentWeight=latestW?.weightLbs;
  const currentBF=latestW?.bodyFatPct;
  const currentBMI=latestW?.bmi;
  const currentLean=latestW?.skeletalMuscleMassLbs;
  const weightDelta=currentWeight&&prevW?.weightLbs?(currentWeight-prevW.weightLbs).toFixed(1):null;

  // Today's protein (single day, not average)
  const todayProtein=(()=>{const t=nutDailyTotals(td(today));return t.protein||0;})();
  // This week's strength sessions (actual count)
  const thisWeekStrSessions=(()=>{try{const d=new Date(today);const dow=d.getDay();const off=dow===0?6:dow-1;const wkStart=new Date(d);wkStart.setDate(d.getDate()-off);wkStart.setHours(0,0,0,0);const wkEnd=new Date(wkStart);wkEnd.setDate(wkStart.getDate()+7);return activities.filter(a=>{if(!a.date)return false;const ad=new Date(a.date+'T12:00:00');return ad>=wkStart&&ad<wkEnd&&!a.activityType?.toLowerCase().includes('run');}).length;}catch{return 0;}})();

  // Avg RPE from daily logs
  const rpeEntries=dailyLogs.filter(l=>l.rpe!=null);
  const avgRPE=rpeEntries.length?(rpeEntries.reduce((s,l)=>s+l.rpe,0)/rpeEntries.length).toFixed(1):null;

  // ── Focus areas ──
  // Each tile reports a status using the locked semantic palette, plus an
  // ACTION line driven by the Weekly Planner so the dashboard suggests what
  // to do today (advisory only — the user always decides).
  const strSessPerWk=ytdStrength.length/weeksElapsed;
  const planned=todayPlanned();
  const plannedTypeLabel=planned?({easy_run:'Easy run',long_run:'Long run',tempo:'Tempo',intervals:'Intervals',strength:'Strength',hiit:'HIIT',mobility:'Mobility',cross:'Cross-train',rest:'Rest day',race:'Race day'}[planned.type]||(planned.type.charAt(0).toUpperCase()+planned.type.slice(1))):null;
  const plannedDist=planned?.distanceMi?` · ${planned.distanceMi}mi`:planned?.durationMin?` · ${planned.durationMin}min`:'';
  const volPct=avgWeeklyMi/weeklyRunTarget;
  const strPct=strSessPerWk/strTarget;
  // ── Attention tiles (dynamic) ──
  // Build candidates, then keep ONLY items that need eyes today. The rail
  // already shows state; these tiles surface action. If everything is green
  // we collapse to a single "all systems nominal" tile.
  const attention=[];
  // Today's planned session — check completion via shared 3-store merge
  const todayDateStr=td();
  const{completed:planCompleted}=checkTodayCompletion(todayDateStr,planned);
  if(planned&&plannedTypeLabel){
    attention.push({
      label:'Today',value:plannedTypeLabel,unit:'',
      detail:plannedDist?plannedDist.replace(' · ',''):'planned',
      severity:planCompleted?'ok':'neutral',
      action:planCompleted?'Completed ✓':'From your weekly plan',
      completed:planCompleted,
    });
  }
  // Volume gap — corrective action tile
  if(volPct<0.9){
    attention.push({label:'Volume gap',value:avgWeeklyMi.toFixed(1),unit:'mi/wk',detail:`${Math.round(volPct*100)}% of ${weeklyRunTarget} mi goal`,severity:volPct<0.5?'critical':volPct<0.7?'critical':'warn',corrective:true,action:`Add ${Math.max(2,Math.round((weeklyRunTarget-avgWeeklyMi)*0.5))} easy miles this week`});
  }
  // Strength gap — corrective action tile
  if(strPct<0.9){
    attention.push({label:'Strength gap',value:strSessPerWk.toFixed(1),unit:'sess/wk',detail:`${Math.round(strPct*100)}% of ${strTarget}/wk`,severity:strPct<0.5?'critical':'warn',corrective:true,action:'Schedule a strength block this week'});
  }
  // Pace drift — corrective action tile
  if(avgPaceSecs&&avgPaceSecs>goalPaceSecs*1.02){
    const driftPct=(avgPaceSecs-goalPaceSecs)/goalPaceSecs;
    attention.push({label:'Pace drift',value:fmtPace(avgPaceSecs),unit:'/mi',detail:`${Math.round(avgPaceSecs-goalPaceSecs)}s off ${fmtPace(goalPaceSecs)}`,severity:driftPct>0.1?'critical':'warn',corrective:true,action:`Add a tempo run at ${fmtPace(goalPaceSecs)}`});
  }
  // Recovery flag — HRV or sleep dip
  const latestHRV=hrvData[0]?.overnightHRV||null;
  if(avgHRV30&&latestHRV&&latestHRV<avgHRV30*0.9){
    const hrvDip=1-latestHRV/avgHRV30;
    attention.push({label:'Recovery dip',value:latestHRV,unit:'ms',detail:`HRV ${Math.round(hrvDip*100)}% below 30-day avg`,severity:hrvDip>0.2?'critical':'warn',action:'Easy day or full rest'});
  }
  // Sleep flag — use 7-day average for trend, show latest score as value
  if(avgSleepScore7&&avgSleepScore7<70){
    attention.push({label:'Sleep low',value:avgSleepScore7,unit:'/100',detail:'7-day avg below 70 — recovery compromised',severity:avgSleepScore7<50?'critical':'warn',action:'Aim for earlier bedtime tonight'});
  }
  // Nutrition flag — protein under target
  if(avgProtein&&avgProtein<(getGoals().dailyProteinTarget||150)*0.85){
    const protPct=avgProtein/(getGoals().dailyProteinTarget||150);
    attention.push({label:'Protein low',value:Math.round(avgProtein),unit:'g/day',detail:`${Math.round(protPct*100)}% of target`,severity:protPct<0.5?'critical':'warn',corrective:true,action:'Add a protein-anchored snack'});
  }
  // If everything is green, collapse to a single nominal tile
  if(attention.length===0){
    attention.push({label:'All systems',value:'nominal',unit:'',detail:'Every metric on or above target',severity:'ok',action:null});
  }
  const focusItems=attention;

  // ── Blood markers ──
  const labSnaps=[...((data?.labSnapshots)||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const latestLab=labSnaps[0];
  const lab=latestLab?.markers||{};
  const labDate=latestLab?.date||'Dec 2025';
  const bloodMarker=(name,unit,optMin,optMax)=>{
    const v=lab[name];
    if(v==null)return{val:'—',status:'—',clr:C.m};
    const num=parseFloat(v);
    const ok=num>=optMin&&num<=optMax;
    return{val:`${num} ${unit}`,status:ok?'O':'W',clr:ok?'#4ade80':'#fbbf24'};
  };

  // ── Style helpers ──
  const panelStyle={background:'var(--bg-surface)',border:'0.5px solid var(--border-default)',borderRadius:'var(--radius-md)',padding:'14px 16px'};
  const divider={height:'0.5px',background:'var(--border-subtle)',margin:'10px 0'};
  const subHdr={fontSize:9,fontWeight:500,letterSpacing:'0.07em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:8};
  const miniTile={background:'var(--bg-elevated)',borderRadius:'6px',padding:'7px 8px',textAlign:'center'};
  const miniVal={fontSize:13,fontWeight:500,color:'var(--text-primary)'};
  const miniLbl={fontSize:8,color:'var(--text-muted)',marginTop:1};

  // Aero/ana dual arc dial
  const DualArcDial=({aero,ana,size=76})=>{
    const r=size/2-8;
    const circ=2*Math.PI*r;
    const arcLength=circ*0.75;
    const aeroFilled=(aero/100)*arcLength;
    const anaFilled=(ana/100)*arcLength;
    return(
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-input)" strokeWidth="6"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#4ade80" strokeWidth="6"
          strokeDasharray={`${aeroFilled} ${circ}`}
          strokeDashoffset={-arcLength*0.167}
          strokeLinecap="round"
          transform={`rotate(135 ${size/2} ${size/2})`}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f87171" strokeWidth="6"
          strokeDasharray={`${anaFilled} ${circ}`}
          strokeDashoffset={-(arcLength*0.167+aeroFilled)}
          strokeLinecap="round"
          transform={`rotate(135 ${size/2} ${size/2})`}/>
        <text x={size/2} y={size/2-5} textAnchor="middle" fontSize="7.5" fill="var(--text-muted)" style={{fontFamily:'var(--font-ui)'}}>aero/ana</text>
        <text x={size/2} y={size/2+7} textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--text-primary)" style={{fontFamily:'var(--font-ui)'}}>{aero}/{ana}</text>
        <text x={size/2} y={size/2+17} textAnchor="middle" fontSize="7" fill="var(--text-muted)" style={{fontFamily:'var(--font-ui)'}}>%</text>
      </svg>
    );
  };

  // Charts maxes
  const maxHrs=Math.max(...weeklyStats.map(w=>w.hrs),weeklyHrsTarget,1);
  const validPaces=weeklyStats.map(w=>w.pace).filter(Boolean);
  const minPace=validPaces.length?Math.min(...validPaces):0;
  const maxPace=validPaces.length?Math.max(...validPaces):1;
  const validWeights=weeklyStats.map(w=>w.weight).filter(Boolean);
  const minWt=validWeights.length?Math.min(...validWeights):0;
  const maxWt=validWeights.length?Math.max(...validWeights):1;
  const targetWt=parseFloat(profile?.targetWeight)||175;

  // Next race for mobile home
  const nextRaceMobile=(()=>{try{const races=JSON.parse(localStorage.getItem('arnold:races')||'[]');const now2=new Date();now2.setHours(0,0,0,0);return races.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=now2;}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date))[0]||null;}catch{return null;}})();

  // On mobile, render MobileHome (Start screen) — TrainingTab runs for tab==='training'
  if(isMobile){
    return <MobileHome data={data} onOpenTab={setTab} initialView={mobileInitView} />;
  }

  return(
    <div style={S.sec}>
      {/* Section 1: Page header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <div>
          <div style={{fontSize:14,fontWeight:500,color:'var(--text-primary)',letterSpacing:'0.02em'}}>◈ EdgeIQ</div>
          <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{yearLabel} · {yearStr}</div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:10,background:'rgba(96,165,250,0.12)',color:'#60a5fa'}}>YTD</span>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:10,background:'rgba(167,139,250,0.12)',color:'#a78bfa'}}>{Math.floor(daysInYear)} days in</span>
          <button onClick={runTrainingAI} disabled={aiLoading} style={{fontSize:10,padding:'4px 10px',borderRadius:10,background:'rgba(167,139,250,0.15)',color:'#a78bfa',border:'0.5px solid rgba(167,139,250,0.35)',cursor:aiLoading?'wait':'pointer',fontWeight:500,letterSpacing:'0.03em'}}>{aiLoading?'✦ Analyzing…':(aiState?'✦ Refresh AI':'✦ Analyze training')}</button>
        </div>
      </div>

      {/* ═══════ HERO LINE · EdgeIQ (Phase 4n.1.4) ═══════
          ONE consolidated hero line — answers "where are you + what to
          do" at a glance. Dial shrunk so it doesn't dominate. Action-
          oriented tiles added: Today's Plan, Recovery (HRV+Sleep), Fuel
          Gap (cal+protein still to log), Race countdown. Calibration
          coach line rendered inline (no separate container) as a thin
          footer with status pill on the left + drift summary inline. ═══════ */}
      {(() => {
        const today = td();
        // 7-day data for sparklines + rolling context
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(today + 'T12:00:00');
          d.setDate(d.getDate() - i);
          days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        }
        const dailyResults = days.map(d => {
          try { return computeDailyScore(d); } catch { return null; }
        });
        const todayResult = dailyResults[0];
        const todayScore = todayResult?.score ?? null;
        const reversedScores = (key) =>
          dailyResults.map(r => key ? (r?.domains?.[key] ?? null) : (r?.score ?? null)).reverse();
        const activityHist  = reversedScores('activity');
        const nutritionHist = reversedScores('nutrition');
        const bodyHist      = reversedScores('body');

        // Rolling avgs
        let r7 = null, r30 = null;
        try { r7  = computeRolling7d(today);  } catch {}
        try { r30 = computeRolling30d(today); } catch {}

        // ACWR
        const ftpPace = profile?.functionalThresholdPace || '8:30';
        // Unified maxHR helper (Phase 4o.daily.22) — same lifetime peak
        // logic the Daily hero / activity panel use, so hrTSS computed
        // here matches what those panels show for the same session.
        const maxHREdge = getEffectiveMaxHR(profile, activities);
        const thresholdHREdge = parseFloat(profile?.thresholdHR) || null;
        let acwrToday = null;
        try { acwrToday = computeAcuteChronicRatio(activities, today, ftpPace, maxHREdge); } catch {}

        // ── Action-oriented data ──
        // Recovery vitals (latest from sleep/HRV)
        const latestSleep = (sleepData || [])[0];
        const sleepHrs = latestSleep?.durationMinutes ? +(latestSleep.durationMinutes / 60).toFixed(1) : null;
        const sleepScore = latestSleep?.sleepScore != null ? Math.min(latestSleep.sleepScore, 100) : null;
        const latestHrv = (() => {
          // Merge: prefer sleep.overnightHRV, fall back to hrvData[0]
          const sourced = (sleepData || []).find(s => s?.overnightHRV);
          if (sourced) return sourced.overnightHRV;
          return (hrvData || [])[0]?.overnightHRV || null;
        })();

        // Fuel gap — calories + protein still to consume today.
        // Phase 4o.edgeiq.2 — uses the DYNAMIC target so training-day
        // eat-back kcal is honoured. The static profile target was wrong
        // on lift/run days: once intake crossed the static value, the
        // remaining clamped to 0 even though the dynamic target still
        // had room. Same getDynamicMacroTarget() the Daily tab uses, so
        // the two views agree.
        const todayNutTotals = (() => {
          try { return nutDailyTotals(today); } catch { return { calories: 0, protein: 0 }; }
        })();
        const dynTarget = (() => {
          try { return getDynamicMacroTarget(); } catch { return null; }
        })();
        const calTarget = dynTarget?.dynamicTarget
                        ?? resolveCalorieTarget(td(), profile);
        const proTarget = dynTarget?.proteinG
                        ?? (parseFloat(profile?.dailyProteinTarget) || 150);
        const calRemaining = Math.max(0, Math.round(calTarget - (todayNutTotals.calories || 0)));
        const proRemaining = Math.max(0, Math.round(proTarget - (todayNutTotals.protein || 0)));

        // Race countdown
        const races = (() => {
          try { return JSON.parse(localStorage.getItem('arnold:races') || '[]'); } catch { return []; }
        })();
        const todayDate = new Date(); todayDate.setHours(0,0,0,0);
        const nextRace = races
          .filter(r => { const d = parseLocalDate(r.date); return d && d >= todayDate; })
          .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date))[0];
        const daysToRace = nextRace?.date ? daysUntil(nextRace.date) : null;

        // Calibration drift — rendered inline (no separate container)
        const cal = (() => { try { return assessCalibration({ weeks: 4 }); } catch { return null; } })();
        const calRec = (() => { try { return recommendCalorieTarget(); } catch { return null; } })();
        const calStatusColor =
          cal?.status === 'aligned'    ? '#4ade80' :
          cal?.status === 'under-loss' ? '#fbbf24' :
          cal?.status === 'over-loss'  ? '#60a5fa' :
                                          'var(--text-muted)';
        const calStatusLabel =
          cal?.status === 'aligned'    ? 'ON PACE' :
          cal?.status === 'under-loss' ? 'BEHIND'  :
          cal?.status === 'over-loss'  ? 'AHEAD'   :
                                         (cal?.status || '—').toUpperCase();
        const driftStr = cal ? `${cal.driftLbs > 0 ? '+' : ''}${cal.driftLbs.toFixed(1)} lb drift` : '';
        const etaPart  = calRec?.projectedDate ? ` · ETA ${calRec.projectedDate}` : '';
        const goalPart = calRec?.userTargetDate
          ? ` vs goal ${calRec.userTargetDate}${calRec?.requiredLossRate != null && calRec.requiredLossRate > 1.0 ? ' — aggressive' : ''}`
          : '';

        // ── Compact speedometer (smaller — no longer overpowering) ──
        const R = 56;
        const cx = 78, cy = 78;
        const angleAt = (t) => Math.PI * (1 - t);
        const ptAt = (t) => ({ x: cx + R * Math.cos(angleAt(t)), y: cy - R * Math.sin(angleAt(t)) });
        const arcPath = (t0, t1) => {
          const p0 = ptAt(t0); const p1 = ptAt(t1);
          return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R} ${R} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
        };
        const zoneRed   = arcPath(0,    0.30);
        const zoneAmber = arcPath(0.30, 0.70);
        const zoneGreen = arcPath(0.70, 1.00);
        const needleAngle = todayScore != null ? -90 + (todayScore / 100) * 180 : -90;
        const needleColor = todayScore == null ? 'var(--text-muted)' :
                            todayScore >= 70 ? '#4ade80' :
                            todayScore >= 30 ? '#fbbf24' :
                                                '#f87171';

        // Status helper for tile colors
        const statusFor = (val, type) => {
          if (val == null) return 'var(--text-muted)';
          if (type === 'acwr')   { if (val >= 0.8 && val <= 1.3) return '#4ade80'; if (val >= 0.5 && val <= 1.5) return '#fbbf24'; return '#f87171'; }
          if (type === 'sleep')  { if (val >= 7) return '#4ade80'; if (val >= 6) return '#fbbf24'; return '#f87171'; }
          if (type === 'hrv')    { if (val >= 40) return '#4ade80'; if (val >= 30) return '#fbbf24'; return '#f87171'; }
          if (type === 'fuel')   return val > 0 ? '#fbbf24' : '#4ade80';  // remaining > 0 = needs action
          if (type === 'race')   return val != null ? '#a78bfa' : 'var(--text-muted)';
          if (val >= 70) return '#4ade80';
          if (val >= 50) return '#fbbf24';
          return '#f87171';
        };

        // Mini-stat tile — compact, with optional sparkline.
        // `tier` controls visual hierarchy: 'domain' (bold/larger) for the
        // 3 composite scores; 'driver' (smaller) for the 6 contributors;
        // 'action' (medium) for Today/Race.
        const MiniStat = ({ label, value, sub, history, type, fmt, tier = 'driver' }) => {
          const color = statusFor(typeof value === 'number' ? value : null, type);
          const valueSize = tier === 'domain' ? 19 : tier === 'action' ? 15 : 15;
          const valueWeight = tier === 'domain' ? 600 : 600;
          const tileMinW = tier === 'domain' ? 62 : 58;

          let pathEl = null;
          if (history && history.filter(v => v != null && Number.isFinite(v)).length >= 2) {
            const valid = history.filter(v => v != null && Number.isFinite(v));
            const lo = Math.min(...valid); const hi = Math.max(...valid); const rng = hi - lo || 1;
            const sparkW = 56, sparkH = 12;
            const xS = (i) => (i / (history.length - 1)) * sparkW;
            const yS = (v) => sparkH - 2 - ((v - lo) / rng) * (sparkH - 4);
            let path = ''; let inPath = false;
            history.forEach((v, i) => {
              if (v == null || !Number.isFinite(v)) { inPath = false; return; }
              const p = { x: xS(i), y: yS(v) };
              path += inPath ? ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : ` M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
              inPath = true;
            });
            pathEl = <svg viewBox={`0 0 ${sparkW} ${sparkH}`} width={sparkW} height={sparkH} preserveAspectRatio="none" style={{ display: 'block' }}>
              <path d={path} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
            </svg>;
          }
          // Reserve sparkline + sub-text space on every tile so heights
          // match across the rail (some tiles have neither — placeholder
          // keeps the 4-row vertical structure consistent).
          // flex:'1 1 0' lets tiles grow evenly within their RailColumn,
          // so the rail fills the full width of its container instead of
          // leaving dead space on the right.
          return (
            <div style={{
              display: 'grid',
              gridTemplateRows: '12px 22px 12px 12px',
              rowGap: 1,
              minWidth: tileMinW,
              flex: '1 1 0',
              alignContent: 'start',
            }}>
              <div style={{
                fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '0.08em', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{label}</div>
              <div style={{
                fontSize: valueSize, fontWeight: valueWeight, color, lineHeight: 1.05,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: 'flex', alignItems: 'center',
              }}>
                {value == null || value === '' ? '—' : (fmt ? fmt(value) : value)}
              </div>
              <div style={{
                fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{sub || ''}</div>
              <div style={{ height: 12 }}>{pathEl}</div>
            </div>
          );
        };

        // ── RailColumn — wraps any rail item with a reserved bracket-
        // header row so all items top-align identically.
        // When `bracket` is set, renders a subtle "─── LABEL ───" divider
        // in the bracket's color above the children. When null, the row
        // is empty but still occupies its 14px so the tiles below stay
        // aligned with bracketed pairs.
        const RailColumn = ({ bracket, color, children, gap = 'clamp(6px,0.7vw,10px)', flexWeight = 1 }) => (
          <div style={{
            display: 'flex', flexDirection: 'column', minWidth: 0,
            // flexWeight=0 → fixed natural width (used by the speedometer);
            // any other → grow proportionally to fill remaining width.
            flex: flexWeight === 0 ? '0 0 auto' : `${flexWeight} 1 0`,
          }}>
            <div style={{
              height: 14,
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 7, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: bracket ? color : 'transparent',
              marginBottom: 4,
            }}>
              {bracket ? (
                <>
                  <div style={{ flex: 1, height: 1, background: `${color}55` }}/>
                  <span style={{ whiteSpace: 'nowrap' }}>{bracket}</span>
                  <div style={{ flex: 1, height: 1, background: `${color}55` }}/>
                </>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap, alignItems: 'flex-start' }}>
              {children}
            </div>
          </div>
        );

        return (
          <section style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'clamp(12px,1.2vw,16px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {/* ── One-line cockpit: dial + status + 12 mini-stats ──
                Outer flex top-aligns everything. Each child is a
                RailColumn that reserves a 14px bracket-header row so
                tiles line up regardless of whether they're under a
                bracket or not. ── */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'clamp(8px,0.8vw,12px)', flexWrap: 'wrap' }}>
              {/* Compact speedometer + minimal label block */}
              <RailColumn flexWeight={0}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:6, flexShrink:0 }}>
                <svg viewBox="0 0 156 100" width="112" height="72">
                  <path d={zoneRed}   fill="none" stroke="#f87171" strokeWidth="9" strokeLinecap="round" opacity="0.35"/>
                  <path d={zoneAmber} fill="none" stroke="#fbbf24" strokeWidth="9" strokeLinecap="round" opacity="0.35"/>
                  <path d={zoneGreen} fill="none" stroke="#4ade80" strokeWidth="9" strokeLinecap="round" opacity="0.35"/>
                  {todayScore != null && (
                    <g transform={`rotate(${needleAngle} ${cx} ${cy})`}>
                      <line x1={cx} y1={cy} x2={cx} y2={cy - R + 8} stroke={needleColor} strokeWidth="2" strokeLinecap="round"/>
                    </g>
                  )}
                  <circle cx={cx} cy={cy} r="3.5" fill="var(--text-primary)"/>
                  <circle cx={cx} cy={cy} r="1.6" fill="var(--bg-surface)"/>
                  <text x={cx} y="98" textAnchor="middle" fontSize="18" fontWeight="600" fill={needleColor} style={{fontFamily:'var(--font-ui)'}}>
                    {todayScore ?? '—'}<tspan fontSize="9" fill="var(--text-muted)" fontWeight="400">/100</tspan>
                  </text>
                </svg>
                <div style={{ display:'flex', flexDirection:'column', gap:1, minWidth:0 }}>
                  <div style={{ fontSize:8, fontWeight:600, letterSpacing:'0.10em', textTransform:'uppercase', color:'var(--text-muted)', whiteSpace:'nowrap' }}>Daily</div>
                  <div style={{ fontSize:11, fontWeight:500, color:'var(--text-primary)', whiteSpace:'nowrap' }}>
                    {todayScore == null ? '—' :
                      todayScore >= 80 ? 'Optimal' :
                      todayScore >= 60 ? 'On track' :
                      todayScore >= 40 ? 'Mixed' : 'Attention'}
                  </div>
                  <div style={{ fontSize:8, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                    7d <span style={{color:'var(--text-secondary)',fontWeight:500}}>{r7?.score ?? '—'}</span> · 30d <span style={{color:'var(--text-secondary)',fontWeight:500}}>{r30?.score ?? '—'}</span>
                  </div>
                </div>
              </div>
              </RailColumn>

              <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)', marginTop: 18 }}/>

              {/* 12-tile cockpit:
                    Speedometer · Activity · Nutrition · Body
                    | ACWR · rTSS                  ← Activity drivers
                    | Cal-left · Protein-left      ← Nutrition drivers
                    | HRV · Sleep                  ← Body drivers
                    | Today · Race                 ← Action + deadline
                  Each domain score is followed by its 2 most impactful
                  drivers so the rail reads "score → what's making it →
                  what to do". Sparklines where the metric has a meaningful
                  7-day series; status colors throughout. */}
              {(() => {
                // ── Pull the focus contributors for each domain ──
                // Activity: ACWR (load mgmt) + rTSS (today's effort intensity)
                const activityFactors = (todayResult?.factors || []).filter(f => f.domain === 'activity');
                const rTSSFactor = activityFactors.find(f => /rtss/i.test(f.label || ''));
                const todayRTSS = (() => {
                  // Phase 4r.viz.26 — single HR-anchored methodology. Every
                  // activity (run, HIIT, strength) computes hrTSS = duration
                  // × (avgHR/thresholdHR)². Pace dropped entirely.
                  const todayActsAll = (activities || []).filter(a => a.date === today);
                  if (!todayActsAll.length) return null;
                  let total = 0;
                  for (const a of todayActsAll) {
                    try {
                      if (isRunAct(a) || isStrengthAct(a)) {
                        const { hrTSS } = computeHrTSS({
                          durationSecs: a.durationSecs,
                          avgHR:        a.avgHR || a.avgHeartRate,
                          maxHR: maxHREdge, thresholdHR: thresholdHREdge,
                        });
                        total += hrTSS || 0;
                      }
                    } catch {}
                  }
                  return total > 0 ? Math.round(total) : null;
                })();
                // Today completed = any logged session today. Phase
                // 4r.edgeiq.1 — mobility sessions produce 0 rTSS but
                // still count as "done" for the daily completion ✓.
                // Previously only run + strength flipped this flag.
                const todayActsCount = (activities || []).filter(a => a.date === today).length;
                const todayCompleted = (todayRTSS != null && todayRTSS > 0) || todayActsCount > 0;

                // 7-day history for HRV + Sleep (sparkline data)
                const hrvHist = days.map(d => {
                  const sleepRow = (sleepData || []).find(s => s?.date === d);
                  if (sleepRow?.overnightHRV) return Number(sleepRow.overnightHRV);
                  const csvRow = (hrvData || []).find(h => h?.date === d);
                  return csvRow?.overnightHRV != null ? Number(csvRow.overnightHRV) : null;
                }).reverse();
                const sleepHistHrs = days.map(d => {
                  const sleepRow = (sleepData || []).find(s => s?.date === d);
                  return sleepRow?.durationMinutes ? +(sleepRow.durationMinutes / 60).toFixed(1) : null;
                }).reverse();

                // Vertical divider between rail groups
                const Sep = () => (
                  <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)', flexShrink: 0, marginTop: 18 }}/>
                );

                return (
                  <>
                    {/* ── Domain scores (3 tiles → weight 3) ── */}
                    <RailColumn flexWeight={3}>
                      <MiniStat tier="domain" label="Activity"  value={todayResult?.domains?.activity}  history={activityHist}/>
                      <MiniStat tier="domain" label="Nutrition" value={todayResult?.domains?.nutrition} history={nutritionHist}/>
                      <MiniStat tier="domain" label="Body"      value={todayResult?.domains?.body}      history={bodyHist}/>
                    </RailColumn>

                    <Sep/>

                    {/* ── Activity drivers (bracket: Activity / blue) ── */}
                    <RailColumn bracket="Activity" color="#60a5fa" flexWeight={2}>
                      <MiniStat label="ACWR" value={acwrToday?.ratio} type="acwr"
                        fmt={v => v.toFixed(2)}
                        sub={acwrToday?.ratio != null ? (acwrToday.ratio > 1.5 ? 'high risk' : acwrToday.ratio > 1.3 ? 'over-reach' : acwrToday.ratio < 0.8 ? 'under-load' : 'in zone') : 'no data'}/>
                      <MiniStat label="rTSS today" value={todayRTSS}
                        sub={todayRTSS == null ? 'no session' : todayRTSS > 80 ? 'big effort' : todayRTSS > 40 ? 'moderate' : 'easy'}/>
                    </RailColumn>

                    {/* ── Nutrition drivers (bracket: Nutrition / green) ── */}
                    <RailColumn bracket="Nutrition" color="#4ade80" flexWeight={2}>
                      <MiniStat label="Cal left"  value={calRemaining} type="fuel"
                        fmt={v => `${v}`}
                        sub={`/${calTarget}`}/>
                      <MiniStat label="Protein left" value={proRemaining} type="fuel"
                        fmt={v => `${v}g`}
                        sub={`/${proTarget}g`}/>
                    </RailColumn>

                    {/* ── Body drivers (bracket: Body / cyan) ── */}
                    <RailColumn bracket="Body" color="#22d3ee" flexWeight={2}>
                      <MiniStat label="HRV" value={latestHrv} history={hrvHist} type="hrv"
                        fmt={v => `${v}ms`}
                        sub={latestHrv != null ? (latestHrv >= 40 ? 'recovered' : latestHrv >= 30 ? 'borderline' : 'strained') : 'no data'}/>
                      {/* Phase 4r.viz.25 — fall back to sleep score when
                          duration isn't recorded by HC. Was showing "—" with
                          "score 77" as sub which made the tile look empty. */}
                      <MiniStat label="Sleep"
                        value={sleepHrs != null ? sleepHrs : sleepScore}
                        history={sleepHistHrs} type="sleep"
                        fmt={v => sleepHrs != null ? `${v}h` : `${v}`}
                        sub={sleepHrs != null && sleepScore != null ? `score ${sleepScore}`
                             : sleepHrs != null ? 'hours slept'
                             : sleepScore != null ? 'sleep score'
                             : 'no data'}/>
                    </RailColumn>

                    <Sep/>

                    {/* ── Action + Race (2 tiles → weight 2) ── */}
                    <RailColumn flexWeight={2}>
                      <MiniStat
                        tier="action"
                        label="Today"
                        value={(
                          <span style={{ display:'inline-flex', alignItems:'baseline', gap:5 }}>
                            <span>{plannedTypeLabel || 'Rest'}</span>
                            {todayCompleted && (
                              <span
                                aria-label="completed"
                                title={`Today's session logged · ${todayRTSS} load`}
                                style={{ color:'#4ade80', fontSize:12, lineHeight:1, fontWeight:700 }}>
                                ✓
                              </span>
                            )}
                          </span>
                        )}
                        type="plan"
                        sub={
                          todayCompleted
                            ? `${todayRTSS} load logged`
                            : (planned?.distanceMi ? `${planned.distanceMi}mi` : (planned?.minutes ? `${planned.minutes}min` : 'No plan'))
                        }/>
                      <MiniStat tier="action" label="Race" value={daysToRace} type="race"
                        fmt={v => `${v}d`}
                        sub={nextRace?.name ? nextRace.name.split(' ').slice(0,3).join(' ') : 'No race'}/>
                    </RailColumn>
                  </>
                );
              })()}
            </div>

            {/* ─── Phase 4n.3 — Coaching prompts integrated ───
                Top 3 active coaching prompts, rendered as compact one-line
                strips. Sits between the rail body and the calibration footer
                so the user reads "score → drivers → what to actually do".
                Calibration-pillar prompts are filtered OUT here because the
                calibration footer below already covers that signal — we'd
                duplicate it otherwise. Severity colors match the rail's:
                  critical → red, warning → amber, info → blue, positive → green.
                Tap any row to jump to the relevant tab. Empty state is
                omitted (no "all clear" placeholder — it'd just waste height
                when the calibration footer below is already saying that). */}
            {(() => {
              let prompts = [];
              try {
                prompts = (getTopCoachingPrompts(5) || [])
                  .filter(p => p.pillar !== 'calibration')
                  .slice(0, 3);
              } catch {}
              if (!prompts.length) return null;
              const sevColor = (sev) =>
                sev === 'critical' ? '#f87171' :
                sev === 'warning'  ? '#fbbf24' :
                sev === 'positive' ? '#4ade80' :
                                     '#60a5fa';
              const pillarTab = (pillar) =>
                pillar === 'nutrition' ? 'daily' :
                pillar === 'recovery'  ? 'trend' :
                pillar === 'run'       ? 'training' :
                pillar === 'body'      ? 'trend' :
                                          'goals';
              const pillarLabel = (pillar) =>
                pillar === 'nutrition' ? 'Fuel' :
                pillar === 'recovery'  ? 'Recover' :
                pillar === 'run'       ? 'Train' :
                pillar === 'body'      ? 'Body' :
                                          (pillar || 'Coach').toString().toUpperCase();
              return (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 6,
                  paddingTop: 8, borderTop: '0.5px solid var(--border-subtle)',
                }}>
                  {prompts.map(p => {
                    const c = sevColor(p.severity);
                    return (
                      <div
                        key={p.id}
                        onClick={() => setTab?.(pillarTab(p.pillar))}
                        title={p.detail || ''}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          minHeight: 22,
                          cursor: setTab ? 'pointer' : 'default',
                          userSelect: 'none',
                        }}
                      >
                        {/* severity dot */}
                        <span aria-hidden style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: c, flexShrink: 0,
                        }}/>
                        {/* pillar tag — uppercase, severity-tinted */}
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
                          color: c, textTransform: 'uppercase',
                          minWidth: 48, flexShrink: 0,
                        }}>{pillarLabel(p.pillar)}</span>
                        {/* title — truncates if long, full text on hover */}
                        <span style={{
                          fontSize: 11, fontWeight: 500,
                          color: 'var(--text-primary)',
                          flex: 1, minWidth: 0,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{p.title}</span>
                        {/* action arrow */}
                        {p.action?.label ? (
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            color: c, opacity: 0.85,
                            whiteSpace: 'nowrap', flexShrink: 0,
                          }}>→ {p.action.label}</span>
                        ) : setTab ? (
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            color: 'var(--text-muted)',
                            whiteSpace: 'nowrap', flexShrink: 0,
                          }}>→</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── Inline calibration footer (no separate container) ── */}
            {cal && cal.status !== 'no-data' && (
              <div
                onClick={() => setTab?.('goals')}
                style={{
                  display:'flex', alignItems:'center', gap:10,
                  paddingTop:8, borderTop:'0.5px solid var(--border-subtle)',
                  cursor: setTab ? 'pointer' : 'default',
                  userSelect:'none',
                }}
                title={setTab ? 'Open full calibration in Goals' : ''}
              >
                <span style={{ fontSize:10, fontWeight:700, color: calStatusColor, letterSpacing:'0.08em', flexShrink:0,
                  padding:'2px 8px', borderRadius:10, background:`${calStatusColor}1a` }}>
                  {calStatusLabel}
                </span>
                <span style={{ fontSize:11, color:'var(--text-secondary)', fontFamily:'var(--font-mono)', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {driftStr}{etaPart}{goalPart}
                </span>
                {setTab && (
                  <span style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                    see Goals →
                  </span>
                )}
              </div>
            )}
          </section>
        );
      })()}

      {/* Standalone Coach line + Focus tiles removed — embedded in or
          consolidated by the Hero Line above (Phase 4n.1.3). */}

      {/* ═══════ SECTION 3: HEALTH SYSTEMS — clickable tiles, inline detail ═══════ */}
      <HealthSystemsGrid dateStr={td()} data={data} />

      {/* DCY breakdown removed (Phase 4n.2.1) — DCY is the Mobile Start
          readiness compass; web EdgeIQ covers the same signal differently
          via the hero-rail composite + drivers. Keeping both surfaces
          duplicates the readiness story.

          AnnotationStrip removed — coaching nudges are surfaced through
          the hero-rail Behind line + (future Stage 3) coaching prompts. */}

      {/* Race detail — conditional. Only render when there's a race within
          the next 60 days. Carries info the hero's compact Race tile can't:
          predicted finish, goal pace vs current pace, race readiness. */}
      {(()=>{
        const races=(()=>{try{return JSON.parse(localStorage.getItem('arnold:races')||'[]');}catch{return[];}})();
        const nowD=new Date(); nowD.setHours(0,0,0,0);
        const cutoff60=new Date(nowD); cutoff60.setDate(nowD.getDate()+60);
        const upcoming=races.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=nowD&&d<=cutoff60;}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date));
        const nr=upcoming[0];
        if(!nr)return null;
        const runs30=ytdRuns.filter(a=>a.date&&parseLocalDate(a.date)>=thirtyDays);
        const paces30=runs30.map(a=>{if(!a.avgPaceRaw)return null;const[m,s]=a.avgPaceRaw.split(':').map(Number);return m*60+(s||0);}).filter(Boolean);
        const avgPace30=paces30.length?paces30.reduce((s,v)=>s+v,0)/paces30.length:null;
        // Phase 4r.race.1 — pass profile + observed sweat rate so the
        // race-fueling plan can size carbs & hydration to the user.
        // Sweat rate comes from recent recovery signatures (Phase
        // 4r.adapt.1); falls back to population avg in raceFueling.
        let _sweatRate = null;
        try {
          const summary = summarizeRecentSignatures({
            activities: activities,
            weightHistory: storage.get('weight') || [],
            daysBack: 60,
          });
          _sweatRate = summary?.summary?.sweatRate?.trimmed
            || summary?.summary?.sweatRate?.median
            || summary?.summary?.sweatRate?.mean
            || null;
        } catch {}
        return <RaceFocusCard race={nr} goalPaceSecs={goalPaceSecs} avgPace30={avgPace30} fmtPace={fmtPace} planned={planned} plannedTypeLabel={plannedTypeLabel} profile={profile} sweatRateLbsPerHr={_sweatRate}/>;
      })()}

      {/* AI analysis card */}
      {(aiLoading||aiStream2||aiState)&&(
        <div style={{...panelStyle,borderLeft:'3px solid #a78bfa'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>✦ Training Analysis</span>
            <span style={{fontSize:9,color:'var(--text-muted)'}}>{aiLoading?'streaming…':(aiState?.date?new Date(aiState.date).toLocaleString():'')}</span>
          </div>
          <div style={{fontSize:12,lineHeight:1.6,color:'var(--text-secondary)',whiteSpace:'pre-wrap'}}>{aiLoading?aiStream2:(aiState?.text||'')}</div>
        </div>
      )}

      {/* Nutrition section relocated to the right column of the
          Training+Nutrition row above (Phase 4k web layout pass). */}

      {/* Recovery / Readiness panel moved to Trend tab (Phase 4l Stage 2.4). */}

      {/* Annual Trends moved to Trend tab (Phase 4l Stage 2.5). */}

    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// RACES TAB
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Race helpers (shared by RacesTab + RaceList) ────────────────────────────
function getMilestones(raceDate){
  const rd=parseLocalDate(raceDate);if(!rd)return[];rd.setHours(0,0,0,0);
  const now2=new Date();now2.setHours(0,0,0,0);
  return[
    {weeks:12,label:"Base building complete"},
    {weeks:8, label:"Peak training begins"},
    {weeks:4, label:"Taper starts"},
    {weeks:1, label:"Race week — reduce intensity"},
  ].map(m=>{
    const mDate=new Date(rd);mDate.setDate(mDate.getDate()-m.weeks*7);
    return{...m,date:`${mDate.getFullYear()}-${String(mDate.getMonth()+1).padStart(2,'0')}-${String(mDate.getDate()).padStart(2,'0')}`,passed:now2>=mDate};
  });
}
function getTrainingProgress(raceDate){
  const rd=parseLocalDate(raceDate);if(!rd)return 0;rd.setHours(0,0,0,0);
  const start=new Date(rd);start.setDate(start.getDate()-112);
  const now2=new Date();now2.setHours(0,0,0,0);
  if(now2<start)return 0;
  if(now2>=rd)return 100;
  return Math.round(((now2-start)/(rd-start))*100);
}
function raceStatus(date){
  const d=daysUntil(date);
  if(d<0)return{label:"Past",color:"var(--text-muted)"};
  if(d<=7)return{label:"This week",color:"var(--status-danger)"};
  return{label:"Upcoming",color:"var(--status-ok)"};
}

function RacesTab({showToast}){
  const[races,setRaces]=useState([]);
  const[csv,setCsv]=useState("");
  const[view,setView]=useState("list");
  const[loading,setLoading]=useState(true);
  const fileRef=useRef();

  // ICS calendar state
  const[icsUrl,setIcsUrl]=useState(()=>localStorage.getItem('arnold:calendar-url')||'https://connect.garmin.com/modern/calendar/export/24126ad8882b483ba0bee8a5f6e9446f');
  const[icsSyncing,setIcsSyncing]=useState(false);
  const[icsResult,setIcsResult]=useState(null);
  const[lastSyncTime,setLastSyncTime]=useState(()=>localStorage.getItem('arnold:calendar-last-sync')||null);

  useEffect(()=>{
    getRaces().then(r=>{
      // Deduplicate by name+date (old sync merges could create copies)
      const seen=new Map();
      for(const race of r){
        const key=`${(race.name||'').trim().toLowerCase()}|${race.date}`;
        if(!seen.has(key))seen.set(key,race);
        else{
          // Keep the richer entry (more fields populated)
          const prev=seen.get(key);
          seen.set(key,{...prev,...race});
        }
      }
      const deduped=[...seen.values()];
      if(deduped.length!==r.length)saveRaces(deduped); // persist cleanup
      setRaces(deduped);setLoading(false);
    });
  },[]);

  const syncICS=async()=>{
    if(!icsUrl.trim()){showToast("⚠ Enter a calendar URL");return;}
    setIcsSyncing(true);setIcsResult(null);
    try{
      const events=await fetchAndParseICS(icsUrl.trim());
      localStorage.setItem('arnold:calendar-url',icsUrl.trim());
      // Merge with existing races — dedupe by name+date
      const existing=await getRaces();
      const byKey=new Map(existing.map(r=>[`${r.name}|${r.date}`,r]));
      let added=0;
      for(const e of events){
        const key=`${e.name}|${e.date}`;
        if(!byKey.has(key)){byKey.set(key,e);added++;}
        else{byKey.set(key,{...byKey.get(key),...e,source:'garmin-ics'});}
      }
      const merged=[...byKey.values()].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      await saveRaces(merged);
      console.log('[ARNOLD] ICS sync: parsed',events.length,'events, merged total:',merged.length,merged);
      setRaces(merged);
      const ts=new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
      localStorage.setItem('arnold:calendar-last-sync',ts);
      setLastSyncTime(ts);
      setIcsResult({ok:true,msg:`Synced — ${merged.length} total races in Arnold (${added} new from calendar)`});
      showToast(`✓ ${merged.length} total races synced`);
    }catch(e){
      setIcsResult({ok:false,msg:`Could not reach calendar. Check the URL or try again. (${e.message})`});
    }finally{setIcsSyncing(false);}
  };

  const importCSV=async()=>{
    if(!csv.trim()){showToast("⚠ No CSV data");return;}
    const rows=parseCSV(csv);
    if(!rows.length){showToast("⚠ Parse failed");return;}
    const parsed=rows.map(r=>({
      id:genId(),
      name:r["name"]||r["race name"]||"",
      date:ndate(r["date"])||r["date"]||"",
      distance_km:parseFloat(r["distance_km"]||r["distance"]||"")||null,
      type:r["type"]||"",
      goal_time:r["goal_time"]||r["goal time"]||"",
      location:r["location"]||"",
    })).filter(r=>r.name&&r.date);
    const merged=[...races,...parsed.filter(n=>!races.find(e=>e.id===n.id))];
    merged.sort((a,b)=>a.date.localeCompare(b.date));
    await saveRaces(merged);setRaces(merged);
    showToast(`✓ ${parsed.length} races imported`);setCsv("");setView("list");
  };

  if(loading)return<div style={S.sec}><div style={S.empty}>Loading races…</div></div>;

  return(
    <div style={S.sec}>
      <div style={S.st}>⚑ Race Calendar</div>

      {/* ── Calendar Feed ── */}
      <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
        <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.ta,textTransform:"uppercase",marginBottom:10}}>◈ Calendar Feed</div>
        <input value={icsUrl} onChange={e=>setIcsUrl(e.target.value)} placeholder="Paste your Garmin calendar export URL" style={{...S.inp,marginBottom:8,fontSize:12}}/>
        <div style={{display:"flex",gap:7,marginBottom:8}}>
          <button style={{...S.sb,flex:1}} onClick={syncICS} disabled={icsSyncing}>{icsSyncing?"Syncing…":lastSyncTime?"Re-sync":"Subscribe & Sync"}</button>
          {lastSyncTime&&<button style={{...S.gb,padding:"9px 14px"}} onClick={()=>{setIcsUrl('');localStorage.removeItem('arnold:calendar-url');localStorage.removeItem('arnold:calendar-last-sync');setLastSyncTime(null);setIcsResult(null);}}>Clear</button>}
        </div>
        {icsResult&&(
          <div style={{padding:"7px 10px",borderRadius:"var(--radius-sm)",fontSize:12,marginBottom:6,background:icsResult.ok?"var(--status-ok-bg)":"var(--status-danger-bg)",border:`0.5px solid ${icsResult.ok?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,color:icsResult.ok?"var(--status-ok)":"var(--status-danger)"}}>
            {icsResult.ok?"✓ ":"✗ "}{icsResult.msg}
          </div>
        )}
        <div style={{fontSize:10,color:C.m}}>Last synced: {lastSyncTime||"Never"}</div>
      </div>

      <div style={S.labNav}>
        {[["list","Race List"],["upload","Upload CSV"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setView(id)} style={{...S.lnb,...(view===id?S.lnba:{})}}>{lbl}</button>
        ))}
      </div>

      {view==="upload"&&<>
        <div style={{...S.ic,borderColor:"rgba(74,222,128,0.3)"}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.acc,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>Expected CSV columns</div>
          <div style={{fontSize:"clamp(11px,0.4vw + 9px,12px)",color:C.m,fontFamily:"var(--font-mono)"}}>name, date, distance_km, type, goal_time, location</div>
        </div>
        <div style={S.uz} onClick={()=>fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setCsv(ev.target.result);r.readAsText(f);e.target.value="";}}/>
          <div style={{fontSize:24,color:C.acc}}>⇡</div>
          <div style={{fontSize:11,color:C.t}}>Drag & drop or click to upload CSV</div>
        </div>
        <textarea value={csv} onChange={e=>setCsv(e.target.value)} placeholder={"name,date,distance_km,type,goal_time,location\nBrooklyn Half,2026-05-16,21.1,Half,1:55:00,Brooklyn"} style={{...S.ta,minHeight:100,fontFamily:"monospace",fontSize:10}}/>
        {csv&&<button style={S.sb} onClick={importCSV}>Import Races</button>}
      </>}

      {view==="list"&&<RaceList races={races} showToast={showToast}/>}
    </div>
  );
}

function RaceList({races}){
  const[showPast,setShowPast]=useState(false);
  if(!races.length)return<div style={S.empty}>No races yet. Upload a CSV or sync your Garmin calendar.</div>;
  const sorted=[...races].sort((a,b)=>{
    const da=daysUntil(a.date),db=daysUntil(b.date);
    if(da>=0&&db>=0)return da-db;
    if(da<0&&db<0)return db-da;
    return da>=0?-1:1;
  });
  const upcomingRaces=sorted.filter(r=>daysUntil(r.date)>=0);
  const pastRaces=sorted.filter(r=>daysUntil(r.date)<0);
  {/* keep old renderRace below */}
  const renderRace=race=>{
          const days=daysUntil(race.date);
          const status=raceStatus(race.date);
          const milestones=getMilestones(race.date);
          const progress=getTrainingProgress(race.date);
          const badge=raceTypeBadge(race.distance_km||race.distanceKm);
          const isFuture=days>=0;
          return(
            <div key={race.id||race.name+race.date} style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:"clamp(13px,0.8vw + 9px,16px)",fontWeight:500,color:C.t,marginBottom:2}}>{race.name}</div>
                  <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m}}>{race.date}{race.location?` · ${race.location}`:""}</div>
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:"rgba(96,165,250,0.12)",color:"#60a5fa",border:"0.5px solid rgba(96,165,250,0.3)"}}>{badge}</span>
                  {race.source==='garmin-ics'&&<span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:"rgba(74,222,128,0.12)",color:"#4ade80",border:"0.5px solid rgba(74,222,128,0.3)"}}>Garmin</span>}
                  <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:isFuture?`${status.color}18`:C.elev,color:isFuture?status.color:C.m,border:`0.5px solid ${isFuture?status.color+'40':C.b}`}}>{status.label}</span>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {[
                  ["Distance",(race.distance_km||race.distanceKm)?`${race.distance_km||race.distanceKm} km`:"—"],
                  ["Goal Time",race.goal_time||race.goalTime||"—"],
                  ["Days Until",isFuture?`${days}d`:"Past"],
                ].map(([k,v])=>(
                  <div key={k}><div style={{fontSize:10,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>{k}</div><div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.t,fontWeight:500,marginTop:1}}>{v}</div></div>
                ))}
              </div>
              {isFuture&&(
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:10,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>Training Progress (16-week block)</span>
                    <span style={{fontSize:10,color:C.ta}}>{progress}%</span>
                  </div>
                  <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
                    <div style={{height:4,width:`${progress}%`,background:"var(--accent)",borderRadius:2,transition:"width 0.4s ease"}}/>
                  </div>
                </div>
              )}
              {isFuture&&(
                <div>
                  <div style={{fontSize:10,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>Milestones</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {milestones.map((m,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
                        <span style={{fontSize:12,color:m.passed?C.ok:C.m,flexShrink:0}}>{m.passed?"✓":"○"}</span>
                        <span style={{fontSize:"clamp(12px,0.4vw + 10px,13px)",color:m.passed?C.t:C.m}}>{m.label}</span>
                        <span style={{fontSize:10,color:C.m,marginLeft:"auto",flexShrink:0}}>{m.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        };
  return<>
    {upcomingRaces.map(renderRace)}
    {pastRaces.length>0&&(
      <div style={{cursor:"pointer"}} onClick={()=>setShowPast(p=>!p)}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0"}}>
          <div style={{flex:1,height:'0.5px',background:C.bs}}/>
          <span style={{fontSize:11,color:C.m,flexShrink:0}}>{showPast?"▲":"▼"} ◦ {pastRaces.length} past race{pastRaces.length!==1?"s":""}</span>
          <div style={{flex:1,height:'0.5px',background:C.bs}}/>
        </div>
      </div>
    )}
    {showPast&&pastRaces.map(renderRace)}
  </>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI COACH + MEMORY TIMELINE
// ═══════════════════════════════════════════════════════════════════════════════
function AICoach({data,loading,setLoading,response,setResponse,question,setQuestion}){
  const[memContext,setMemContext]=useState("");
  const[workoutHistory,setWorkoutHistory]=useState([]);
  const[garminActivities,setGarminActivities]=useState([]);
  const[racesData,setRacesData]=useState([]);
  const[expanded,setExpanded]=useState(null);

  useEffect(()=>{
    getWorkouts().then(ws=>setWorkoutHistory(ws));
    getGarmin().then(g=>setGarminActivities(g.filter(a=>a.source==='garmin-csv')));
    getRaces().then(r=>setRacesData(r));
  },[]);

  const ask=async q=>{
    if(!q.trim())return;
    setLoading(true);setResponse("");
    // Build training context from garmin data + workouts + races
    const trainingCtx=buildTrainingContext(garminActivities,racesData,workoutHistory);
    const workoutCtx=await buildWorkoutMemoryContext(q.toLowerCase().includes("run")?"Run (outdoor)":"",3);
    const fullPrompt=`${trainingCtx}\n\n${workoutCtx}\n\n${buildFullPrompt(data)}`;
    setMemContext(trainingCtx);
    setResponse(await ai(fullPrompt,q));
    setLoading(false);
  };

  const PS=[
    "Give me a complete integrated health summary across all my test results",
    "Cross-reference my blood panel with my body composition and VO2Max",
    "Based on my DEXA and RMR, what should my daily calorie target be?",
    "What training zones should I prioritise given my current body composition goals?",
    "How do my hormone levels (T, Cortisol, TSH) interact with my fitness metrics?",
    "What should I focus on before my next DexaFit and blood panel in 6 months?",
    "Analyse my recent runs and suggest how to pace my next workout",
  ];

  return(
    <div style={S.sec}>
      <div style={S.st}>✦ AI Coach</div>

      {/* Prompt suggestions */}
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {PS.map((p,i)=><button key={i} style={S.qb} onClick={()=>{setQuestion(p);ask(p);}}>{p}</button>)}
      </div>

      <div style={{display:"flex",gap:7}}>
        <input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask anything about your health…" style={{...S.inp,flex:1}} onKeyDown={e=>e.key==="Enter"&&ask(question)}/>
        <button style={S.ab} onClick={()=>ask(question)} disabled={loading}>{loading?"…":"Ask"}</button>
      </div>

      {loading&&<div style={{display:"flex",alignItems:"center",gap:7,color:C.m,fontSize:"clamp(13px,0.5vw + 10px,15px)",padding:"12px 0"}}><span style={{color:C.acc}}>✦</span><span>Analysing all your data…</span></div>}
      {memContext&&!loading&&<div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,background:C.elev,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",padding:"5px 8px"}}>↑ Training context injected ({garminActivities.length} activities, {workoutHistory.length} reflections)</div>}
      {response&&!loading&&<div style={S.air}><div style={S.aih}>✦ Analysis</div><div style={S.ait}>{response}</div></div>}
      {!response&&!loading&&<div style={S.empty}>Pick a prompt or ask your own question.</div>}

      {/* ── Memory Timeline ── */}
      <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
        <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",marginBottom:10}}>◈ Memory · Past Workouts</div>
        {!workoutHistory.length&&<div style={{fontSize:"clamp(12px,0.4vw + 10px,13px)",color:C.m}}>No workouts logged yet. Use the Workout Log in the Log tab.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:340,overflowY:"auto"}}>
          {workoutHistory.map(w=>(
            <div key={w.id} style={{border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",overflow:"hidden",cursor:"pointer"}} onClick={()=>setExpanded(e=>e===w.id?null:w.id)}>
              {/* Summary row */}
              <div style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",background:expanded===w.id?"rgba(255,255,255,0.03)":"transparent"}}>
                <div style={{fontSize:10,color:C.m,fontFamily:"var(--font-mono)",flexShrink:0}}>{w.date}</div>
                <div style={{fontSize:"clamp(12px,0.4vw + 10px,13px)",color:C.t,fontWeight:500,flexShrink:0}}>{w.type}</div>
                {w.distance&&<div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m}}>{w.distance}km</div>}
                {w.rpe&&<div style={{fontSize:10,padding:"1px 5px",borderRadius:3,background:C.elev,color:C.m}}>RPE {w.rpe}</div>}
                <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.s,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.reflection?.slice(0,100)}{w.reflection?.length>100?"…":""}</div>
                <span style={{fontSize:10,color:C.m,flexShrink:0}}>{expanded===w.id?"▲":"▼"}</span>
              </div>
              {/* Expanded detail */}
              {expanded===w.id&&(
                <div style={{padding:"0 10px 10px",borderTop:`0.5px solid ${C.bs}`}}>
                  <div style={{fontSize:"clamp(12px,0.4vw + 10px,13px)",color:C.s,lineHeight:1.65,marginTop:8}}>{w.reflection}</div>
                  {w.weather&&(
                    <div style={{display:"flex",gap:10,marginTop:8,flexWrap:"wrap"}}>
                      {[["🌡",`${w.weather.temp}°C`],["☁",w.weather.condition||""],["💨",`${w.weather.wind}km/h`],["🌧",`${w.weather.precipitation??0}mm`]].filter(([,v])=>v).map(([ic,v])=>(
                        <div key={ic} style={{fontSize:11,color:C.m}}>{ic} {v}</div>
                      ))}
                    </div>
                  )}
                  <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
                    {w.duration&&<span style={{fontSize:11,color:C.m}}>{w.duration}min</span>}
                    {w.pace&&<span style={{fontSize:11,color:C.m}}>{w.pace} min/km</span>}
                    {w.heartRate&&<span style={{fontSize:11,color:C.m}}>{w.heartRate} bpm</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function aiSummary(data,onChunk){
  return aiStream(
    buildFullPrompt(data),
    `Generate my weekly health summary. Today: ${td()}.

Structure your response exactly as follows:

## Weekly Overview
2-3 sentence executive summary of my health status this week with an overall score out of 10.

## Trends This Week
Review my last 7 daily logs and report on: weight direction, sleep quality & duration, HRV pattern, calorie & protein intake, workout consistency. Use actual numbers.

## What's Improving ✓
3-4 specific positive trends backed by data from my logs, labs, or clinical tests. Be encouraging but precise.

## What Needs Attention ⚠
2-3 areas where the data shows room for improvement. Include specific numbers and why each matters for longevity or performance.

## 3 Action Recommendations for Next Week
1. [Specific, measurable action with a target number and timeline]
2. [Specific, measurable action with a target number and timeline]
3. [Specific, measurable action with a target number and timeline]

Be direct, use real numbers from my data, and make every sentence count.`,
    1800,
    onChunk
  );
}

function buildFullPrompt(data){
  const lb=[...(data.labSnapshots||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const tests=data.clinicalTests||[];
  const ct=tests.reduce((acc,t)=>{if(!acc[t.type]||t.date>acc[t.type].date)acc[t.type]=t;return acc;},{});
  return `You are ARNOLD, a personal performance intelligence coach for Emil. You have access to his complete health and training data. Your role is to give specific, actionable, data-driven advice — not generic fitness tips. Always reference specific numbers from the context. Be direct and concise. When identifying issues, prioritize the highest-impact ones. Cross-reference training load with body composition goals — Emil's primary targets are reducing body fat from 24.7% to 16.7% and visceral fat from 1.29 to 0.60 lbs while maintaining his Elite VO2 Max and building lean mass to 138 lbs.

USER: ${data.profile.name||"Emil"}, DOB 02/09/1975 (age ~50), Goal: ${data.profile.goal||"performance & longevity"}

DEXA (${ct.dexa?.date||"Mar 2025"}): Total 187 lbs, Lean 134 lbs (target 138), Body Fat 24.7% (target 16.7%), Visceral Fat 1.29 lbs (target 0.60), A/G Ratio 1.12, T-Score 2.80, ALMI 9.1, FFMI 20.2, Spine BMD 37th %ile

VO2MAX (${ct.vo2max?.date||"Mar 2025"}): 51 ml/kg/min (Elite, 98th %ile), Bio Age 33, Lean VO2 72 (99th), Leg Lean VO2 200 (96th), Redline Ratio 89% (70th), Max HR 164, VT1 110, VT2 154

RMR (${ct.rmr?.date||"Mar 2025"}): 1,880 kcal/day (fast), RER 0.84 (Fat 53%/Carbs 47%), Predicted 1,783, Peer avg 1,915

LATEST BLOOD PANEL (${lb[0]?.date||"Dec 2025"}):
${JSON.stringify(lb[0]?.markers||{})}

PREVIOUS BLOOD PANEL (${lb[1]?.date||"Jul 2025"}):
${JSON.stringify(lb[1]?.markers||{})}

DAILY LOGS (last 7): ${JSON.stringify((data.logs||[]).slice(0,7))}

SUPPLEMENT STACK: ${(()=>{try{const cat=getSupCatalog();const st=getSupStack();const by=Object.fromEntries(cat.map(s=>[s.id,s]));const adh=getSupAdherence(7);const lines=st.map(e=>{const s=by[e.supplementId];return s?`${s.brand} ${s.product} (${e.timeOfDay}${e.doseMultiplier!==1?`, ${e.doseMultiplier}x`:''})`:null;}).filter(Boolean);return `${lines.length} daily · ${adh.pct}% 7-day adherence\n${lines.join('; ')}`;}catch{return 'n/a';}})()}

CONTEXT: Clinical tests are 6-month baselines. Daily Garmin/Cronometer data is the ongoing signal. Training data from Garmin CSV is prepended as [ARNOLD TRAINING CONTEXT]. Be precise, cite actual numbers, and connect metrics across test types. Use optimal longevity ranges, not just clinical normals.`;
}

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

  // Inline field renderer — NOT a component. Just returns JSX with the parent's
  // closure variables, so React doesn't treat it as a new component type.
  const numField=(label,key,unit,placeholder)=>(
    <div key={key} style={S.field}>
      <label style={S.fl}>{label}{unit&&<span style={{color:C.m}}> ({unit})</span>}</label>
      <input type="number" step="any" value={form[key]??""}
        onChange={e=>update(key,e.target.value)} placeholder={placeholder||""} style={S.inp}/>
    </div>
  );
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

  return(
    <div style={S.sec}>
      <div style={S.st}>Profile</div>

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

      {/* ═══ ADMIN SECTION ═══════════════════════════════════════════════════ */}
      <div style={{marginTop:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <div style={{fontSize:"clamp(12px,0.5vw+10px,14px)",fontWeight:600,color:'var(--text-primary)',letterSpacing:'0.02em'}}>Admin</div>
          <div style={{flex:1,height:'0.5px',background:'var(--border-subtle)'}}/>
        </div>

        {/* Architecture Map link — use a real <a> so browsers + Capacitor webviews open the
            static asset natively instead of window.open('_blank'), which was being blocked
            (or redirecting the root webview back to the SPA's default tab). */}
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
              style={{...S.lg,marginBottom:8,cursor:'pointer',textDecoration:'none',display:'block'}}>
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

        {/* Backup & Restore */}
        <BackupPanel showToast={showToast}/>

        <div style={{height:1,background:C.b,margin:"8px 0"}}/>
        <BackupStatusPanel/>

        {/* ── BULK HISTORICAL IMPORT ───────────────────────────────────
            Rescued from the `{false && <>` legacy-hidden block so
            users can actually run it. Loads the 5 CSVs from
            public/data-imports/ through the same per-format parsers
            used by the per-file import flow. */}
        <div style={{height:1,background:C.b,margin:"8px 0"}}/>
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

        <div style={{height:1,background:C.b,margin:"8px 0"}}/>
        <SyncPanel showToast={showToast}/>

        <div style={{height:1,background:C.b,margin:"8px 0"}}/>
        <CloudSyncPanel/>

        <div style={{height:1,background:C.b,margin:"4px 0"}}/>
        <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.dn,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>Reset Arnold</div>
        <button style={S.db} onClick={()=>{
          // Double gate: (1) typed-word confirmation so it can't be done with a
          // muscle-memory Enter, (2) pre-op snapshot so even a confirmed reset
          // is recoverable from the pre-op ring.
          const typed = window.prompt('This will permanently delete ALL your Arnold data.\n\nType ARNOLD to confirm:');
          if (typed !== 'ARNOLD') { showToast('\u2717 Reset cancelled'); return; }
          try { snapshotBeforeOp('reset-all'); } catch(e){ console.warn('pre-op snapshot failed',e); }
          persist(DD).then(()=>showToast("\u2713 Arnold reset — pre-op snapshot saved if you need to roll back"));
        }}>Reset All Data</button>
      </div>

      {/* legacy block hidden */}
      {false&&<>
      {/* ── RUN GOALS ── */}
      <div style={{...S.lg,marginTop:4}}>
        <div style={S.gt}>◉ Run Goals</div>
        <div style={S.fr}>
          {numField("Annual run distance","annualRunDistanceTarget","miles","800")}
          {numField("Weekly run distance","weeklyRunDistanceTarget","miles","20")}
        </div>
        <div style={S.fr}>
          {numField("Weekly long run","weeklyLongRunTarget","miles","10")}
          {numField("Weekly run hours","weeklyRunHrsTarget","hrs","4")}
        </div>
        <div style={S.field}>
          <label style={S.fl}>Target race pace <span style={{color:C.m}}>(min/mi)</span></label>
          <input type="text" value={form.targetRacePace??""}
            onChange={e=>update("targetRacePace",e.target.value)} placeholder="9:30" style={S.inp}/>
        </div>
      </div>

      {/* ── STRENGTH GOALS ── */}
      <div style={S.lg}>
        <div style={S.gt}>◈ Strength Goals</div>
        <div style={S.fr}>
          {numField("Weekly sessions","weeklyStrengthSessions","sess","2")}
          {numField("Weekly strength hours","weeklyStrengthHrs","hrs","1")}
        </div>
        <div style={S.fr}>
          {numField("Annual sessions","annualStrengthSessions","sess","104")}
          {numField("Target avg RPE","targetRPE","1–10","7")}
        </div>
      </div>

      {/* ── NUTRITION GOALS ── */}
      <div style={S.lg}>
        <div style={S.gt}>◆ Nutrition Goals</div>
        <div style={S.fr}>
          {numField("Daily calories","dailyCalorieTarget","kcal","2200")}
          {numField("Daily protein","dailyProteinTarget","g","150")}
        </div>
        <div style={S.fr}>
          {numField("Daily carbs","dailyCarbTarget","g","180")}
          {numField("Daily fat","dailyFatTarget","g","65")}
        </div>
      </div>

      {/* ── BODY GOALS ── */}
      <div style={S.lg}>
        <div style={S.gt}>⊗ Body Goals</div>
        <div style={S.fr}>
          {numField("Target weight","targetWeight","lbs","175")}
          {numField("Target body fat","targetBodyFat","%","16.7")}
        </div>
        <div style={S.field}>
          {numField("Target lean mass","targetLeanMass","lbs","138")}
        </div>
      </div>

      <button style={S.sb} onClick={handleSave}>{saved?'✓ Saved':'Save Profile & Goals'}</button>

      {/* ── GOALS HUB ── */}
      <GoalsHub showToast={showToast}/>

      {/* ── WEEKLY PLANNER ── */}
      <WeeklyPlanner showToast={showToast}/>

      {/* ── IMPORT DIAGNOSTICS ── */}
      <ImportDiagnostics/>

      {/* ── BULK HISTORICAL IMPORT ── */}
      <div style={S.lg}>
        <div style={S.gt}>⇪ Bulk Historical Import</div>
        <div style={{fontSize:11,color:C.m,lineHeight:1.5}}>
          Loads all CSVs from <code style={{color:C.ta}}>public/data-imports/</code>: Activities, Cronometer, HRV, Sleep, Weight. Safe to re-run — merges by date.
        </div>
        <button
          style={{...S.sb,background:C.ad,borderColor:C.ab2,color:C.ta}}
          onClick={async()=>{
            const strip=t=>t.replace(/^\uFEFF/,'');
            const load=async(name)=>{
              const r=await fetch(`/data-imports/${name}`);
              if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);
              return strip(await r.text());
            };
            const report=[];
            try{
              // Writes to the SAME storage keys the Training/Weekly tabs read from.
              // storage.merge() dedupes by date and sorts.
              try{
                const parsed=parseActivitiesCSV(await load('Activities.csv'));
                storage.set('activities',parsed);const merged=parsed;
                report.push(`✓ Activities: ${parsed.length} parsed, ${merged.length} total`);
              }catch(e){report.push(`✗ Activities: ${e.message}`);}
              try{
                const parsed=parseCronometerCSV(await load('Cronometer-dailysummary.csv'));
                storage.set('cronometer',parsed);const merged=parsed;
                report.push(`✓ Cronometer: ${parsed.length} parsed, ${merged.length} total`);
              }catch(e){report.push(`✗ Cronometer: ${e.message}`);}
              try{
                const parsed=parseHRVCSV(await load('HRV Status.csv'));
                storage.set('hrv',parsed);const merged=parsed;
                report.push(`✓ HRV: ${parsed.length} parsed, ${merged.length} total`);
              }catch(e){report.push(`✗ HRV: ${e.message}`);}
              try{
                const parsed=parseSleepCSV(await load('Sleep.csv'));
                storage.set('sleep',parsed);const merged=parsed;
                report.push(`✓ Sleep: ${parsed.length} parsed, ${merged.length} total`);
              }catch(e){report.push(`✗ Sleep: ${e.message}`);}
              try{
                const parsed=parseWeightCSV(await load('Weight.csv'));
                storage.set('weight',parsed);const merged=parsed;
                report.push(`✓ Weight: ${parsed.length} parsed, ${merged.length} total`);
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

      {/* ── DATA SYNC (PC ↔ Phone) ── */}
      <DataSync variant="desktop"/>

      <div style={{height:1,background:C.b,margin:"4px 0"}}/>
      <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.dn,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>Danger Zone</div>
      <button style={S.db} onClick={()=>{if(window.confirm("This will permanently delete all your data. Are you sure?"))persist(DD).then(()=>showToast("✓ Data cleared"));}}>Delete All Data</button>
      <div style={{display:"flex",gap:12,fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>
        <span>{data.logs.length} daily logs</span>
        <span>{(data.labSnapshots||[]).length} lab snapshots</span>
        <span>{(data.clinicalTests||[]).length} clinical tests</span>
      </div>
      </>}
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
const C={
  bg:"var(--bg-base)",
  surf:"var(--bg-surface)",
  elev:"var(--bg-elevated)",
  inp:"var(--bg-input)",
  b:"var(--border-default)",
  bs:"var(--border-subtle)",
  bst:"var(--border-strong)",
  acc:"var(--accent)",
  ad:"var(--accent-dim)",
  ab2:"var(--accent-border)",
  t:"var(--text-primary)",
  s:"var(--text-secondary)",
  m:"var(--text-muted)",
  ta:"var(--text-accent)",
  ok:"var(--status-ok)",
  okb:"var(--status-ok-bg)",
  wn:"var(--status-warn)",
  wnb:"var(--status-warn-bg)",
  dn:"var(--status-danger)",
  dnb:"var(--status-danger-bg)",
};
const S={
  root:{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"var(--font-ui)",position:"relative"},
  bg:{position:"fixed",inset:0,backgroundImage:"none",pointerEvents:"none"},
  splash:{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:C.bg},
  si:{position:"relative",display:"flex",alignItems:"center",justifyContent:"center"},
  pr:{position:"absolute",width:56,height:56,borderRadius:"50%",border:`1px solid ${C.acc}`,opacity:0.4},
  sl:{fontSize:26,color:C.acc},
  hdr:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 clamp(16px,2vw,40px)",height:"clamp(52px,5vw,64px)",borderBottom:`0.5px solid ${C.bs}`,background:C.bg,backdropFilter:"blur(12px)",position:"sticky",top:0,zIndex:10},
  hl:{display:"flex",alignItems:"center",gap:10},
  logo:{fontSize:22,color:C.acc,fontFamily:"var(--font-mono)"},
  an:{fontSize:"clamp(11px,0.5vw + 8px,14px)",fontWeight:600,letterSpacing:"0.18em",color:C.t,fontFamily:"var(--font-mono)"},
  as:{fontSize:10,color:C.m,letterSpacing:"0.10em",fontWeight:400},
  hr:{display:"flex",alignItems:"center",gap:14},
  un:{fontSize:"clamp(14px,0.4vw + 12px,18px)",color:"#f0f0f0",fontFamily:'"Snell Roundhand","Apple Chancery","Brush Script MT","Lucida Handwriting",cursive',fontStyle:"italic",fontWeight:600,letterSpacing:"0.03em",lineHeight:1,textShadow:"0 0 8px rgba(255,255,255,0.15)"},
  dc2:{fontSize:11,color:C.m,background:"transparent",border:"none",padding:0,fontFamily:"var(--font-mono)",lineHeight:1},
  nav:{display:"flex",borderBottom:`0.5px solid ${C.bs}`,background:C.bg,overflowX:"auto",height:"clamp(52px,5vw,64px)",position:"sticky",top:"clamp(52px,5vw,64px)",zIndex:9},
  nb:{flex:1,minWidth:44,padding:"0 4px",background:"none",border:"none",borderBottom:"2px solid transparent",color:C.s,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,transition:"color var(--transition)",fontFamily:"var(--font-ui)"},
  nba:{color:C.ta,borderBottom:`2px solid ${C.acc}`},
  ni:{fontSize:"clamp(14px,1vw + 10px,18px)"},
  nl:{fontSize:"clamp(9px,0.3vw + 8px,11px)",fontWeight:500,letterSpacing:"0.04em"},
  main:{padding:"clamp(16px,2vw,40px)",paddingBottom:60},
  sec:{display:"flex",flexDirection:"column",gap:"clamp(10px,1vw,16px)"},
  st:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",paddingBottom:8,borderBottom:`0.5px solid ${C.bs}`},
  sc:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:4},
  // Border split into individual properties so inline overrides of just
  // borderColor (used heavily in card grids) don't trigger React 19's
  // "removing style property during rerender" warning.
  sc2:{background:C.surf,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:4},
  sic:{fontSize:"clamp(14px,1vw + 10px,18px)",color:C.acc,opacity:0.8},
  sv:{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"},
  sl2:{fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,color:C.t},
  ss:{fontSize:"clamp(10px,0.3vw + 9px,12px)",color:C.m},
  cg:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"clamp(10px,1vw,16px)"},
  snap:{background:C.surf,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"},
  tb:{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",background:C.surf},
  wb:{background:C.elev,border:`0.5px solid ${C.ab2}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  wt2:{fontSize:"clamp(13px,0.8vw + 9px,16px)",fontWeight:500,color:C.t},
  ws:{fontSize:"clamp(10px,0.3vw + 9px,12px)",color:C.m,marginTop:4},
  ip:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  ih:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6},
  it2:{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.s,lineHeight:1.7},
  empty:{textAlign:"center",color:C.m,fontSize:"clamp(12px,0.5vw + 10px,14px)",padding:"32px 16px",border:`0.5px dashed ${C.b}`,borderRadius:"var(--radius-md)"},
  labNav:{display:"flex",gap:6,flexWrap:"wrap"},
  lnb:{background:"transparent",border:`0.5px solid ${C.b}`,color:C.s,padding:"5px 14px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"var(--font-ui)",fontSize:11,fontWeight:500,letterSpacing:"0.04em",transition:"all var(--transition)"},
  // Active state: use the full `border` shorthand instead of borderColor alone.
  // Mixing shorthand (border) and non-shorthand (borderColor) on the same
  // element triggers a React 19 warning when toggling between active/inactive
  // because removing borderColor while a `border` shorthand is set is ambiguous.
  lnba:{background:C.ad,border:`0.5px solid ${C.ab2}`,color:C.ta},
  lg:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:10},
  gt:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase"},
  fr:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"clamp(10px,1vw,16px)"},
  field:{display:"flex",flexDirection:"column",gap:5},
  fl:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.06em",color:C.m,textTransform:"uppercase"},
  inp:{background:C.inp,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",color:C.t,padding:"10px 14px",fontFamily:"var(--font-ui)",fontSize:"clamp(13px,0.5vw + 10px,15px)",outline:"none",width:"100%",boxSizing:"border-box",transition:`border-color var(--transition),box-shadow var(--transition)`},
  ta:{background:C.inp,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-sm)",color:C.t,padding:"10px 14px",fontFamily:"var(--font-ui)",fontSize:"clamp(13px,0.5vw + 10px,15px)",resize:"vertical",minHeight:72,outline:"none",width:"100%",boxSizing:"border-box",transition:`border-color var(--transition),box-shadow var(--transition)`},
  eb:{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.ta,background:C.ad,padding:"3px 10px",borderRadius:"var(--radius-sm)",alignSelf:"flex-start",border:`0.5px solid ${C.ab2}`},
  sb:{background:C.ad,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.ab2,borderRadius:"var(--radius-md)",padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,letterSpacing:"0.03em",cursor:"pointer",color:C.ta,width:"100%",transition:`background var(--transition),border-color var(--transition)`},
  gb:{background:"transparent",border:`0.5px solid ${C.b}`,color:C.s,borderRadius:"var(--radius-sm)",padding:"9px 16px",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,cursor:"pointer",transition:`all var(--transition)`},
  db:{background:C.dnb,border:`0.5px solid rgba(248,113,113,0.25)`,color:C.dn,padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",borderRadius:"var(--radius-md)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,cursor:"pointer",width:"100%",transition:`all var(--transition)`},
  scard:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"12px 8px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,transition:`border-color var(--transition)`},
  ic:{background:C.surf,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  uz:{border:`0.5px dashed ${C.b}`,borderRadius:"var(--radius-md)",padding:20,display:"flex",flexDirection:"column",alignItems:"center",gap:6,cursor:"pointer",background:"transparent"},
  is:{display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:"clamp(12px,1vw,18px)",background:C.ad,border:`0.5px solid ${C.ab2}`,borderRadius:"var(--radius-md)",textAlign:"center"},
  aib:{background:C.ad,color:C.ta,border:`0.5px solid ${C.ab2}`,borderLeft:`3px solid ${C.acc}`,borderRadius:"var(--radius-md)",padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,letterSpacing:"0.03em",cursor:"pointer",display:"flex",alignItems:"center",gap:8,justifyContent:"center",width:"100%",boxSizing:"border-box",transition:`background var(--transition),border-color var(--transition)`},
  qb:{background:C.surf,border:`0.5px solid ${C.b}`,color:C.s,padding:"9px 12px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",textAlign:"left",transition:`all var(--transition)`},
  ab:{background:C.ad,color:C.ta,border:`0.5px solid ${C.ab2}`,borderRadius:"var(--radius-sm)",padding:"0 14px",fontFamily:"var(--font-ui)",fontWeight:500,fontSize:"clamp(12px,0.5vw + 10px,14px)",cursor:"pointer",whiteSpace:"nowrap",transition:`all var(--transition)`},
  air:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  aih:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8},
  ait:{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.s,lineHeight:1.75,whiteSpace:"pre-wrap"},
  aisp:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  aish:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,display:"flex",alignItems:"center",gap:6},
  aist:{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.s,lineHeight:1.85,whiteSpace:"pre-wrap"},
  toast:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:"var(--status-ok-bg)",color:"var(--text-accent)",border:"0.5px solid var(--accent-border)",padding:"10px 20px",borderRadius:"var(--radius-sm)",fontWeight:500,fontSize:13,zIndex:100,backdropFilter:"blur(8px)"},
};
