// LogDay — the daily logger (Daily / Play / Fuel mobile views). Phase 0.5
// (monolith decomposition) — extracted verbatim from Arnold.jsx. The only body
// change vs the monolith: getUnifiedActivities() (a 1-line delegate that lived in
// Arnold.jsx) is called as allActivities() directly, imported from core/dcyMath.js.
// Everything else is byte-identical.
import { useState, useEffect, useCallback, useRef } from "react";
import { useStorageVersion } from "../hooks/useStorageVersion.js";
import { cleanSleepForAveraging } from "../core/parsers/sleepParser.js";
import { parseFITFile } from "../core/parsers/fitParser.js";
import { pushFit as pushFitToRelay, pullFitsNow } from "../core/fit-relay.js";
import { parseTodayNutrition } from "../core/parsers/cronometerParser.js";
import { storage } from "../core/storage.js";
import { getGoals } from "../core/goals.js";
import { parseLocalDate } from "../core/dateUtils.js";
import { fmtHMS, hydrationFor } from "../core/derive/index.js";
import { computeActivityNeeds, trackReplenishment, replenishmentSummary } from "../core/activityNeeds.js";
import { buildIntelContext, makePaint, resolveIntelMaxHR } from "../core/intelContext.js";
import { CoachComment } from "./CoachComment.jsx";
import { MetricCluster } from "./MetricCluster.jsx";
import { LoadGauge } from "./LoadGauge.jsx";
import { selectMetrics } from "../core/presentation/metricRegistry.js";
import { coachCard } from "../core/presentation/cardCoach.js";
import { ContextCluster } from "./ContextCluster.jsx";
import { readinessVerdict } from "../core/presentation/readinessTokens.js";
import { td } from "../core/uiFormat.js";
import { S } from "../arnoldStyles.js";
import { SessionVsUsual } from "./SessionVsUsual.jsx";
import { SECTION_HDR, SECTION_RULE, cardGrid } from "../core/presentation/cardLayout.js";
import { LearnedHero } from "./LearnedHero.jsx";
import { SessionRPE } from "./SessionRPE.jsx";
import { AddedLoad } from "./AddedLoad.jsx";
import { getAddedLoad, unweightedEquivPaceSecs } from "../core/addedLoad.js";
import { C } from "../arnoldTheme.js";
import { RaceFocusCard } from "./RaceFocusCard.jsx";
import { summarizeRecentSignatures } from "../core/derive/recoverySignature.js";
import { todayPlanned } from "../core/planner.js";
import { MiniBar } from "./MiniBar.jsx";
import { NutritionInput as NutritionInputPanel } from "./NutritionInput.jsx";
import { PlannedWorkoutTile, getPlannedWorkoutState } from "./PlannedWorkoutTile.jsx";
import { createEntry as createNutEntry, saveEntry as saveNutEntry, getEntriesForDate as getNutEntries, deleteEntry as deleteNutEntry, dailyTotals as nutDailyTotals } from "../core/nutrition.js";
import { isRun as isRunAct, isStrength as isStrengthAct, isStrengthVolume as isStrengthVol, isMobility as isMobilityAct, isHIIT as isHIITAct, isCycling as isCyclingAct, isSwim as isSwimAct, isSki as isSkiAct, isWalk as isWalkAct, isHardSession } from "../core/activityClass.js";
import { cyclingMetricsFor } from "../core/derive/cyclingMetrics.js";
import { getTopCoachingPrompts } from "../core/coachingPrompts.js";
import { getEffectiveTargets as getDerivedTargets } from "../core/goalModel.js";
import { paceTrend } from "../core/trainingIntelligence.js";
import { computeRTSS, computeHrTSS, computeAcuteChronicRatio, computeTonnage, computeDensity, matchTemplate, computeRolling7d, computeRolling30d, getEffectiveMaxHR } from "../core/trainingStress.js";
import { allActivities } from "../core/dcyMath.js";
export function LogDay({data,persist,showToast,mobileView,setTab}){
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
      const { syncRecentActivities } = await import('../core/garmin-activities-client.js');
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
      const { fetchCronometerToday } = await import('../core/cronometer-client.js');
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
  const panelStyle={background:'var(--bg-surface)',border:'0.5px solid var(--border-default)',borderRadius:'var(--radius-md)',padding: mobileView ? '8px 12px' : '14px 16px'};
  const divider={height:'0.5px',background:'var(--border-subtle)',margin:'10px 0'};
  const subHdr={fontSize:11,fontWeight:600,letterSpacing:'0.06em',color:'var(--text-secondary)',textTransform:'uppercase',marginBottom:8};
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
  // `compact` (mobile) trims the vertical padding + icon so the 2×2 headline
  // block on a phone isn't so tall.
  const HeroTile = ({ icon, color, value, label, trend, tint, compact }) => (
    <div style={{
      background: tint || 'rgba(255,255,255,0.03)',
      border: `0.5px solid ${color}33`,
      borderRadius: 10, padding: compact ? '9px 8px 8px' : '12px 8px 10px', textAlign: 'center',
      flex: 1, position: 'relative', minWidth: 0,
    }}>
      <TrendChip trend={trend}/>
      <div style={{height: compact ? 22 : 30,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <TIcon name={icon} size={compact ? 20 : 26} color={color}/>
      </div>
      <div style={{color:'var(--text-primary)',fontSize: compact ? 19 : 17,fontWeight:600,marginTop:5,lineHeight:1}}>{value ?? '—'}</div>
      <div style={{color:'var(--text-secondary)',fontSize:11.5,marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</div>
    </div>
  );
  // Mini tile — icon left, value+label stacked right. Used in the lower run
  // metrics and hydration rows so visual language is consistent across the card.
  // Fill layout: icon + label on the left, value pinned RIGHT — so each tile uses
  // its full width instead of leaving the right half black. (Was icon + stacked
  // value/label hugging the left.)
  const IconMiniTile = ({ icon, color, value, label, dim }) => (
    <div style={{
      background:'var(--bg-elevated)', borderRadius:8, padding:'9px 11px',
      display:'flex',alignItems:'center',gap:9,flex:1,minWidth:0,
      opacity: dim ? 0.55 : 1,
    }}>
      <TIcon name={icon} size={18} color={color}/>
      <span style={{flex:1,minWidth:0,color:'var(--text-secondary)',fontSize:11,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label?String(label).charAt(0).toUpperCase()+String(label).slice(1):label}</span>
      <span style={{color:'var(--text-primary)',fontSize:14,fontWeight:600,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',flexShrink:0}}>{value}</span>
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
      // Phase 4r.sports — new first-class disciplines complete their own slots.
      if (pt === 'cycle') return fd.isCycle;
      if (pt === 'swim')  return fd.isSwim;
      if (pt === 'walk')  return fd.isWalk;
      if (pt === 'ski')   return /\b(ski|skiing|nordic|alpine|snowboard)\b/i.test(`${fd.activityType||''} ${fd.activityName||''} ${fd.garminTypeKey||''}`);
      return false;
    };
    if (plan && matches(plan)) return plan;
    // Default by discipline — delegate to the SINGLE-SOURCE classifiers in
    // activityClass.js (isCyclingAct/isSwimAct/etc.). Those read activityType +
    // activityName + Garmin's authoritative type keys, so the card classifies the
    // SAME way the gauge does. This is what fixes the split where the gauge saw a
    // ride (via activityName "Indoor Cycling") but the card, checking only
    // activityType, fell through to easy-run. Walk has no dedicated predicate, so
    // it keeps a small name/type regex.
    const txt = `${fd.activityType || ''} ${fd.activityName || ''} ${fd.garminTypeKey || ''} ${fd.garminParentTypeKey || ''}`;
    if (fd.isHIIT || isHIITAct(fd)) return 'hiit';
    if (isMobilityAct(fd)) return 'mobility';
    if (isSkiAct(fd)) return 'ski';
    if (isCyclingAct(fd)) return 'cycle';
    if (isSwimAct(fd)) return 'swim';
    if (fd.isWalk || isWalkAct(fd)) return 'walk';
    if (isStrengthVol(fd)) return 'strength';
    if (isRunAct(fd)) return 'easy_run';
    // Unknown discipline → generic card (cross-train concept dropped).
    if (txt.trim() && !isRunAct(fd)) return 'generic';
    return 'easy_run';
  };

  // Build the row1 + row2 tile lists for a given planType + activity.
  // Tiles with null values are dropped at render time so missing data
  // doesn't show "—" — the row just gets shorter.
  const _buildActivityProfile = (planType, fd) => {
    // Phase 4r.intel.12-fix2 — `activities` was referenced inside this fn
    // (intelMaxHR + intelCtx) but LogDay never declared one at this scope.
    // Resolve via the same getUnifiedActivities helper Dashboard uses.
    const activities = allActivities();
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
    // Z2-tile color = aerobic COMPLIANCE, not "has a value". A green "Z2 time" tile
    // shouldn't imply you hit a target just because Z2 is non-zero — for an EASY/long
    // run the real question is whether you stayed easy, judged by time ABOVE Z2 (Z3+),
    // since a run can be 60% Z1 / 35% Z2 and be perfectly easy. Low Z3+ → on-target
    // (green); creeping up → amber; well over → red. Other plan types: neutral (Z2 is
    // just context there, not the goal). Fixes the always-green bug.
    const zAbove = (Number.isFinite(+z.z3)?+z.z3:0)+(Number.isFinite(+z.z4)?+z.z4:0)+(Number.isFinite(+z.z5)?+z.z5:0);
    const z2Paint = () => {
      const easy = planType==='easy_run' || planType==='long_run';
      const c = !easy ? '#94a3b8' : zAbove<=15 ? '#4ade80' : zAbove<=30 ? '#fbbf24' : '#f87171';
      const tint = { '#4ade80':'rgba(74,222,128,0.06)','#fbbf24':'rgba(251,191,36,0.06)','#f87171':'rgba(248,113,113,0.06)','#94a3b8':'rgba(148,163,184,0.06)' }[c];
      return { c, tint };
    };
    const aeroTE = fd.aerobicTrainingEffect ?? fd.aerobicTE;
    const anaerTE = fd.anaerobicTrainingEffect ?? fd.anaerobicTE;
    const decoupling = fd.aerobicDecoupling ?? fd.decoupling ?? null;
    const drift = _cardiacDrift(fd);
    // Durability (fatigue resistance) — within-session decoupling (pref) or cardiac
    // drift, read ONLY on long aerobic efforts where it's meaningful. <5% durable.
    const _durLong = (Number(fd.durationSecs) || 0) >= 60 * 60;
    const _durVal = decoupling != null ? decoupling : (drift != null ? drift : null);
    // Estimated 1RM (Epley) — heaviest lift's e1RM when a strength template matches
    // (gives per-set weight×reps). Reps capped at 12 (Epley reliable in that range).
    let _e1rm = null, _e1rmLift = null;
    if (fd.isStrength || /strength|weight|gym/i.test(fd.activityType || '')) {
      try {
        const _tpl = matchTemplate(fd, storage.get('strengthTemplates') || []);
        if (_tpl) {
          const { exercises } = computeTonnage(_tpl, fd.setsCount || null, parseFloat(profile?.weight) || 175);
          for (const ex of (exercises || [])) {
            if (ex.weight > 0 && ex.reps > 0 && ex.reps <= 12) {
              const e = ex.weight * (1 + ex.reps / 30);
              if (e > (_e1rm || 0)) { _e1rm = Math.round(e); _e1rmLift = ex.name; }
            }
          }
        }
      } catch { /* no template / no weights → no e1RM */ }
    }
    const hrRecovery = fd.hrRecoveryDrop1min ?? fd.hrRecovery1min ?? null;
    // Load (TSS): prefer Garmin's own; else derive HR-based hrTSS so HR-only
    // activities (e.g. an indoor bike with no power meter) still report a Load.
    let tss = fd.trainingStressScore ?? null;
    if (tss == null && (fd.avgHR || fd.avgHeartRate) && fd.durationSecs) {
      try {
        const _mhr = getEffectiveMaxHR(profile, allActivities());
        const { hrTSS } = computeHrTSS({
          durationSecs: fd.durationSecs,
          avgHR: fd.avgHR || fd.avgHeartRate,
          maxHR: _mhr,
          thresholdHR: parseFloat(profile?.thresholdHR) || null,
        });
        if (hrTSS) tss = hrTSS;
      } catch { /* leave tss null */ }
    }
    const calories = fd.calories ?? null;
    const avgHR = safeN(fd.avgHR,'avgHR');
    const maxHR = safeN(fd.maxHR,'maxHR');
    const avgCad = safeN(fd.avgCadence,'avgCadence');
    const vert = fd.avgVerticalOscillation ?? null;

    // Progress/regress TRENDS — Arnold's app-wide rule: computeTrend vs the user's
    // usual same-type session → 'good'/'flat'/'bad' (rendered green/amber/red). These
    // attach to the directional headline metrics so the mobile primary stat row can
    // colour the value by progress, and the desktop HeroTile shows its trend arrow —
    // replacing the decorative category colours, which carried no progress meaning.
    const _paceSamples = (activities||[]).filter(a=>a&&a!==fd&&a.isRun&&a.avgPacePerMi)
      .map(a=>_paceToSec(a.avgPacePerMi)).filter(Number.isFinite).sort((x,y)=>x-y);
    const _paceBaseSec = _paceSamples.length>=3 ? _paceSamples[Math.floor(_paceSamples.length/2)] : null;
    const _cadBase = sameTypeBaseline(activities, fd, 'avgCadence');
    // Pace is only a TARGET on quality sessions. On an easy/long run a faster pace
    // isn't "better" — it usually means you didn't keep it easy — so pace stays
    // neutral there and Z2 compliance carries the judgement instead.
    const paceIsTarget = !(planType==='easy_run' || planType==='long_run');
    // Phase 4r.load — if the run carried added load (weight vest / ruck), compare
    // the UNWEIGHTED-EQUIVALENT pace to baseline so the weight doesn't read as a
    // fitness regression. Falls back to actual pace when no load is logged.
    const _actualPaceSec = _paceToSec(fd.avgPacePerMi);
    const _addedLb = getAddedLoad(fd, fd.date);
    const _bodyLb = parseFloat(profile?.weight) || null;
    const _paceForTrend = (_addedLb && _bodyLb)
      ? (unweightedEquivPaceSecs(_actualPaceSec, _addedLb, _bodyLb) || _actualPaceSec)
      : _actualPaceSec;
    const paceTrend = paceIsTarget ? computeTrend(_paceForTrend, _paceBaseSec, 'lower-better') : null;
    const cadTrend  = computeTrend(avgCad, _cadBase, 'higher-better');
    const gapTrend  = computeTrend(_paceToSec(fd.avgGapPerMi), _paceBaseSec, 'lower-better');
    // Z2: easy/long runs only — stayed aerobic (low Z3+) is the "good" direction.
    const z2Trend = (planType==='easy_run'||planType==='long_run')
      ? (zAbove<=15 ? 'good' : zAbove<=30 ? 'flat' : 'bad') : null;

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
      pace:       () => fd.avgPacePerMi ? { icon:'stopwatch',       color:'#4ade80', label:'Pace · /mi',    value: fd.avgPacePerMi,           tint:'rgba(74,222,128,0.06)', trend: paceTrend } : null,
      avgHR:      () => avgHR           ? { icon:'heartbeat',       color: _paintM('avgHR_pctMax', avgHRPctMax, '#f87171'), label:'Avg HR · bpm',  value: safeDisp(fd.avgHR,'avgHR'),tint: _paintT('avgHR_pctMax', avgHRPctMax, 'rgba(248,113,113,0.06)') } : null,
      // Phase 4r.color — Max HR is a raw PEAK, not a good/bad signal, and was
      // mis-painted by the AVERAGE's %max band (→ yellow on tempo days). Emil's
      // standing pref is progress/regress, never category/tier; with no per-tile
      // trend on the card, the right unify is NEUTRAL (matches mobile's "no color").
      maxHRHero:  () => maxHR           ? { icon:'heart-rate-monitor', color: '#94a3b8', label:'Max HR · bpm',value: safeDisp(fd.maxHR,'maxHR'),tint: 'rgba(148,163,184,0.06)' } : null,
      cadence:    () => avgCad          ? { icon:'shoe',            color:'#a78bfa', label:'Cadence · spm', value: safeDisp(fd.avgCadence,'avgCadence'), tint:'rgba(167,139,250,0.06)', trend: cadTrend } : null,
      vertOsc:    () => vert            ? { icon:'wave-sine',       color:'#fbbf24', label:'Vert osc · cm', value: vert.toFixed(1),           tint:'rgba(251,191,36,0.06)' } : null,
      elevation:  () => fd.totalAscentFt? { icon:'mountain',        color:'#94a3b8', label:'Elev · ft',     value: String(fd.totalAscentFt),  tint:'rgba(148,163,184,0.06)' } : null,
      duration:   () => (fd.duration && fd.duration !== '—') ? { icon:'clock-hour-4', color:'#94a3b8', label:'Duration', value: fd.duration, tint:'rgba(148,163,184,0.06)' } : null,
      z1pct:      () => { const v=Number.isFinite(+z.z1)?+z.z1:null; return v==null?null:{ icon:'target-arrow', color:'#22d3ee', label:'Z1 time', value:_fmtPct(v), tint:'rgba(34,211,238,0.06)' }; },
      z2pct:      () => { if (z2==null) return null; const p=z2Paint(); return { icon:'target-arrow', color:p.c, label:'Z2 time', value:_fmtPct(z2), tint:p.tint, trend: z2Trend }; },
      z34pct:     () => z34             ? { icon:'target-arrow',    color:'#fbbf24', label:'Z3–Z4 time',    value: _fmtPct(z34),              tint:'rgba(251,191,36,0.06)' } : null,
      z45pct:     () => z45             ? { icon:'activity',        color: _paintM('z45Pct', z45, '#fb7185'), label:'Z4–Z5 time',    value: _fmtPct(z45),              tint: _paintT('z45Pct', z45, 'rgba(251,113,133,0.06)') } : null,
      cardiacDrift: () => drift != null ? { icon:'activity',        color: _paintM('cardiacDrift', drift, '#fb7185'), label:'Cardiac drift', value: `${drift>=0?'+':''}${drift.toFixed(1)}%`, tint: _paintT('cardiacDrift', drift, 'rgba(251,113,133,0.06)') } : null,
      gap:        () => fd.avgGapPerMi  ? { icon:'mountain',        color:'#fbbf24', label:'GAP · /mi',     value: fd.avgGapPerMi,            tint:'rgba(251,191,36,0.06)', trend: gapTrend } : null,
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
      loadHero:   () => tss            ? { icon:'activity',        color:'#a78bfa', label:'Load',          value: String(Math.round(tss)),   tint:'rgba(167,139,250,0.06)' } : null,
      // Row 2 (context) tiles — same component, smaller display.
      r2_duration:   () => (fd.duration && fd.duration !== '—') ? { icon:'clock-hour-4', color:'#94a3b8', value: fd.duration,                       label:'duration' } : null,
      r2_avgHR:      () => avgHR        ? { icon:'heartbeat',          color: _paintM('avgHR_pctMax', avgHRPctMax, '#f87171'), value: safeDisp(fd.avgHR,'avgHR'),       label:'avg HR' } : null,
      r2_maxHR:      () => maxHR        ? { icon:'heart-rate-monitor', color: '#94a3b8', value: safeDisp(fd.maxHR,'maxHR'),       label:'max HR' } : null,
      r2_calories:   () => calories     ? { icon:'flame',              color:'#fb923c', value: String(calories),                  label:'calories' } : null,
      r2_aeroTE:     () => aeroTE       ? { icon:'target-arrow',       color:'#4ade80', value: aeroTE.toFixed(1),                 label:'aero TE' } : null,
      r2_anaerTE:    () => anaerTE      ? { icon:'activity',           color: _paintM('anaerobicTE', anaerTE, '#fb7185'), value: anaerTE.toFixed(1),                label:'anaer TE' } : null,
      r2_tss:        () => tss          ? { icon:'activity',           color:'#a78bfa', value: String(Math.round(tss)),            label:'TSS' } : null,
      r2_load:       () => tss          ? { icon:'activity',           color:'#a78bfa', value: String(Math.round(tss)),            label:'load' } : null,
      r2_decoupling: () => decoupling != null ? { icon:'wave-sine',    color: _paintM('decoupling', decoupling, '#fbbf24'), value: `${decoupling.toFixed(1)}%`,        label:'decoupling' } : null,
      r2_z1pct:      () => { const v=Number.isFinite(+z.z1)?+z.z1:null; return v==null?null:{ icon:'target-arrow', color:'#22d3ee', value:_fmtPct(v), label:'Z1 time' }; },
      r2_z2pct:      () => { if (z2==null) return null; const p=z2Paint(); return { icon:'target-arrow', color:p.c, value:_fmtPct(z2), label:'Z2 time' }; },
      r2_z34pct:     () => z34 != null  ? { icon:'target-arrow',       color:'#fbbf24', value:_fmtPct(z34),                        label:'Z3–4 time' } : null,
      r2_z45pct:     () => z45 != null  ? { icon:'activity',           color: _paintM('z45Pct', z45, '#fb7185'), value:_fmtPct(z45), label:'Z4–5 time' } : null,
      r2_cardiacDrift: () => drift != null ? { icon:'activity',        color: _paintM('cardiacDrift', drift, '#fb7185'), value:`${drift>=0?'+':''}${drift.toFixed(1)}%`, label:'drift' } : null,
      r2_vertOsc:    () => vert         ? { icon:'wave-sine',          color:'#fbbf24', value: vert.toFixed(1),                    label:'vert osc · cm' } : null,
      r2_hrRecovery: () => hrRecovery   ? { icon:'heartbeat',          color: _paintM('hrRecovery1m', hrRecovery, '#22d3ee'), value: `−${Math.round(hrRecovery)}`,       label:'HR recov 1m' } : null,
      r2_avgPace:    () => fd.avgPacePerMi ? { icon:'stopwatch',       color:'#4ade80', value: fd.avgPacePerMi,                    label:'avg pace' } : null,
      r2_avgPower:   () => fd.avgPowerW ? { icon:'bolt',               color:'#fbbf24', value: `${fd.avgPowerW} W`,                label:'avg power' } : null,
      r2_normPower:  () => fd.normalizedPower ? { icon:'bolt',         color:'#fb923c', value: `${fd.normalizedPower} W`,          label:'NP' } : null,
      r2_avgSpeed:   () => (fd.distanceMi && fd.durationSecs) ? { icon:'gauge', color:'#22d3ee', value: `${(fd.distanceMi / (fd.durationSecs/3600)).toFixed(1)} mph`, label:'avg speed' } : null,
      r2_if:         () => (tss && fd.durationSecs) ? { icon:'gauge', color:'#a78bfa', value: Math.sqrt(tss / (fd.durationSecs/3600 * 100)).toFixed(2), label:'IF' } : null,
      r2_elevation:  () => fd.totalAscentFt ? { icon:'mountain',       color:'#94a3b8', value: `${fd.totalAscentFt} ft`,           label:'elevation' } : null,
      // Running-form / economy metrics (already in our FIT output) + cycling pacing.
      r2_groundContact:  () => fd.avgGroundContactTime ? { icon:'shoe',   color:'#a78bfa', value: `${Math.round(fd.avgGroundContactTime)} ms`, label:'ground contact' } : null,
      r2_verticalRatio:  () => fd.avgVerticalRatio     ? { icon:'wave-sine', color:'#fbbf24', value: `${(+fd.avgVerticalRatio).toFixed(1)}%`,    label:'vert ratio' } : null,
      r2_variabilityIndex: () => (fd.normalizedPower && fd.avgPowerW) ? { icon:'gauge', color:'#22d3ee', value: (fd.normalizedPower / fd.avgPowerW).toFixed(2), label:'variability' } : null,
      // Durability (long efforts) + estimated 1RM (strength).
      r2_durability: () => { if (!_durLong || _durVal == null) return null; const t = _durVal < 5 ? 'durable' : _durVal < 8 ? 'holding' : 'fading'; const c = _durVal < 5 ? '#4ade80' : _durVal < 8 ? '#fbbf24' : '#f87171'; return { icon:'activity', color:c, value:t, label:`durability ${_durVal.toFixed(1)}%` }; },
      e1rmHero:   () => _e1rm ? { icon:'barbell', color:'#a78bfa', label:`Est 1RM${_e1rmLift?` · ${_e1rmLift}`:''}`, value:`${_e1rm} lb`, tint:'rgba(167,139,250,0.06)' } : null,
      r2_e1rm:    () => _e1rm ? { icon:'barbell', color:'#a78bfa', value:`${_e1rm} lb`, label:`est 1RM${_e1rmLift?` · ${_e1rmLift}`:''}` } : null,
      // Per-session VO2max estimate + respiration rate (Garmin).
      r2_vo2max:      () => fd.estimatedVo2Max ? { icon:'activity',  color:'#22d3ee', value:`${fd.estimatedVo2Max}`,      label:'VO₂max' } : null,
      r2_respiration: () => fd.avgRespirationRate ? { icon:'wave-sine', color:'#60a5fa', value:`${fd.avgRespirationRate}`, label:'breaths/min' } : null,
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
      // Lean cycle card: Avg HR · Duration · Load · Calories for an HR-only
      // indoor ride. A real bike with sensors fills distance/power/cadence first
      // (those candidates lead row1) and speed/power into row2 — power-less rides
      // drop those and surface the HR-based set.
      cycle:     { row1: ['distance','avgPower','cadenceRpm','avgHR','duration'],
                   row2: ['r2_avgPower','r2_avgSpeed','r2_load','r2_calories'] },
      cross:     { row1: ['distance','avgPower','cadenceRpm','elevation','avgHR'],
                   row2: ['r2_avgSpeed','r2_tss','r2_aeroTE','r2_calories'] },
      swim:      { row1: ['distance','pace','avgHR','maxHRHero','duration'],
                   row2: ['r2_aeroTE','r2_calories'] },
      walk:      { row1: ['distance','pace','elevation','avgHR','cadence'],
                   row2: ['r2_avgHR','r2_calories','r2_aeroTE','r2_elevation'] },
      ski:       { row1: ['distance','elevation','duration','avgHR','maxHRHero'],
                   row2: ['r2_avgHR','r2_calories','r2_aeroTE','r2_elevation'] },
      race:      { row1: ['distance','pace','avgHR','maxHRHero','elevation'],
                   row2: ['r2_avgPace','r2_tss','r2_aeroTE','r2_calories'] },
    };
    // Phase 4r.intel.12-fix — renamed from `profile` to `tileProfile` to
    // avoid TDZ collision with the outer LogDay `profile` (user profile from
    // storage + goals). The earlier shadowing caused 'Cannot access profile
    // before initialization' in _buildActivityProfile when intelMaxHR (added
    // in 4r.intel.7) tried to use the outer profile at line ~4740.
    const tileProfile = PROFILES[planType] || PROFILES.easy_run;
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
      cardiacDrift:   'r2_cardiacDrift',
      pace:           'r2_avgPace',
      avgPower:       'r2_avgPower',
      normPower:      'r2_normPower',
      avgSpeed:       'r2_avgSpeed',
      elevation:      'r2_elevation',
      e1rmHero:       'r2_e1rm',
      z1pct:          'r2_z1pct',
      z2pct:          'r2_z2pct',
      z34pct:         'r2_z34pct',
      z45pct:         'r2_z45pct',
      loadHero:       'r2_load',
    };
    // ── Coach-driven card (Option 1) ──────────────────────────────────────────
    // MACRO row is fixed per discipline (scannable anchor); the MICRO row + the
    // one-line message are chosen TOGETHER by the coach to fit the session's
    // story. We pass the already-derived metrics; cardCoach returns the ids +
    // line. `tileProfile`/PROFILES stay only as a legacy fallback.
    const _m = {
      z2, z34, z45, drift, decoupling,
      aeroTE, anaerTE, tss,
      avgHR, maxHR, hrRecovery, calories,
      IF: (tss && fd.durationSecs) ? +Math.sqrt(tss / (fd.durationSecs / 3600 * 100)).toFixed(2) : null,
      setsCount: fd.setsCount, totalReps: fd.totalReps, density: fd.density || null,
      durationMins: fd.durationMins, distanceMi: fd.distanceMi,
      hasPower: Number(fd.avgPowerW) > 0,
      effortPct: (avgHR && maxHR) ? avgHR / maxHR : null,
    };
    let _coach;
    try { _coach = coachCard(planType, _m); }
    catch { _coach = { macroIds: tileProfile.row1, microIds: tileProfile.row2, line: null, angle: null }; }

    const row1Pairs = [];
    for (const k of _coach.macroIds) {
      if (row1Pairs.length >= 4) break;                // macro = 4 fixed basics
      const t = TILE[k] && TILE[k]();
      if (t) row1Pairs.push({ id: k, tile: t });
    }
    const row1 = row1Pairs.map(p => p.tile);
    const usedR2Ids = new Set(row1Pairs.map(p => R1_TO_R2[p.id]).filter(Boolean));
    // Render the first 3–4 micro tiles that actually have data (the coach's
    // ordered pool backfills so a sparse session still fills the row).
    const row2 = _coach.microIds
      .filter(k => !usedR2Ids.has(k))                 // skip any metric already in macro
      .map(k => TILE[k] && TILE[k]())
      .filter(Boolean)
      .slice(0, 4);
    return { row1, row2, coachAngle: _coach.angle };
  };

  // fitData = today's .fit upload OR fallback to today's row from synced activities
  // Hydration row — uses pure derive/hydration.js so the formula lives in one place.
  // Phase 4r.viz.1 — icon-prefixed tiles for visual consistency with run metrics.
  const HydrationRow=({fd,bare})=>{
    const h=hydrationFor(fd,profile);
    // Tinted-value variant: when value should use a semantic color (sweat loss
    // blue, replenish green), pass through valueColor; IconMiniTile keeps its
    // standard layout.
    const TintedTile = ({ icon, iconColor, value, label, valueColor }) => (
      <div style={{
        background:'var(--bg-elevated)', borderRadius:8, padding:'9px 11px',
        display:'flex',alignItems:'center',gap:9,flex:1,minWidth:0,
      }}>
        <TIcon name={icon} size={18} color={iconColor}/>
        <span style={{flex:1,minWidth:0,color:'var(--text-secondary)',fontSize:11,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label?String(label).charAt(0).toUpperCase()+String(label).slice(1):label}</span>
        <span style={{color:valueColor||'var(--text-primary)',fontSize:14,fontWeight:600,whiteSpace:'nowrap',flexShrink:0}}>{value}</span>
      </div>
    );
    return<>
      {!bare && <div style={divider}/>}
      {!bare && <div style={subHdr}>Hydration</div>}
      {/* Three clean tiles: how much you lost, how much to drink back, and by when.
          (Dropped the redundant "≈ in oz" — it just restated the litres — and
          shortened labels so they no longer truncate to "Est. sweat..".) */}
      <div style={cardGrid('context', !!mobileView)}>
        <TintedTile icon="droplet" iconColor="#60a5fa" valueColor="#60a5fa"
          value={h.sweatLossL!=null?`${h.sweatLossL.toFixed(2)} L`:'—'}
          label="sweat loss"/>
        <TintedTile icon="droplet" iconColor="#4ade80" valueColor="#4ade80"
          value={h.replenishL!=null?`${h.replenishL.toFixed(2)} L`:'—'}
          label="replenish"/>
        <IconMiniTile icon="hourglass" color="#94a3b8"
          value={`${h.windowHrs} hrs`} label="rehydrate by"/>
      </div>
    </>;
  };

  // ── Replenishment Tracker: micro-goals from activity needs engine ──
  // ReplenishTracker \u2014 Phase 4r.viz.30 redesign.
  // Compact 2-column grid of phase-coded goal cards (pre=amber, during=blue,
  // post=green). Each card: phase tag \u00b7 short label \u00b7 big value \u00b7 vs target \u00b7
  // background fill behind the card shows progress. Replaces the previous
  // long-line list which was hard to scan and visually heavy.
  const ReplenishTracker=({fd,dateStr,onGoToFuel,bare})=>{
    const needs=computeActivityNeeds(fd,profile);
    if(!needs)return null;
    const progress=trackReplenishment(needs,dateStr,fd);
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
      {!bare && <div style={divider}/>}
      {/* No own header when bare — these recovery-fuel tiles live UNDER the single
          "Fuel" section header (Fuel & Fluids + Replenish merged). */}
      {!bare && (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <div style={{...subHdr,marginBottom:0}}>Replenishment</div>
          <div style={{
            padding:'2px 8px',borderRadius:10,fontSize:9,fontWeight:600,
            background:summary.status==='complete'?'rgba(74,222,128,0.12)':summary.status==='partial'?'rgba(251,191,36,0.12)':'rgba(248,113,113,0.12)',
            color:summary.status==='complete'?'#4ade80':summary.status==='partial'?'#fbbf24':'#f87171',
          }}>{summary.met}/{summary.total} {'\u00b7'} {summary.pct}%</div>
        </div>
      )}
      {!bare && <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:8}}>
        <span style={{fontWeight:500,color:fd.isHIIT?'#fb7185':fd.isRun?'#60a5fa':fd.isStrength?'#a78bfa':'var(--text-primary)'}}>{actType}</span>
        {dMins!=null&&<span> {'\u00b7'} {dMins} min</span>}
        {' \u00b7 '}<span style={{fontWeight:600,color:'var(--text-primary)'}}>{needs.caloriesBurned} kcal</span>
      </div>}
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
              borderRadius:6,padding:'6px 9px',
              border:`0.5px solid ${g.met?color+'55':'var(--border-subtle)'}`,
              background:'var(--bg-elevated)',
              cursor:g.met?'default':onGoToFuel?'pointer':'default',
            }}>
            {/* Progress fill behind content \u2014 subtle wash */}
            <div style={{
              position:'absolute',inset:0,
              background:`linear-gradient(to right, ${color}${g.met?'18':'10'} 0%, ${color}${g.met?'18':'10'} ${fillPct}%, transparent ${fillPct}%, transparent 100%)`,
              pointerEvents:'none',
            }}/>
            <div style={{position:'relative'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:4}}>
                <span style={{fontSize:9,fontWeight:700,letterSpacing:'0.06em',color,opacity:0.9}}>{tag}</span>
                <span style={{fontSize:9,color:g.met?color:'var(--text-muted)',fontWeight:g.met?600:500}}>{g.met?'\u2713':`${fillPct}%`}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:6,marginTop:3}}>
                <span style={{flex:1,minWidth:0,fontSize:11,color:'var(--text-primary)',fontWeight:500,lineHeight:1.2,textTransform:'capitalize',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{shortLabel(g)}</span>
                <span style={{fontSize:11,color:'var(--text-secondary)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap',flexShrink:0}}>
                  <span style={{color:g.met?color:'var(--text-primary)',fontWeight:600}}>{g.consumed}</span>
                  <span style={{opacity:0.5}}>{` / ${g.target}${g.unit==='ml'?'ml':'g'}`}</span>
                </span>
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
    if(inMemory.length)return inMemory.map(f=>{
      // Stamp discipline flags via the single-source classifiers (which read
      // activityType + activityName + Garmin type keys). The FIT parser only sets
      // isRun/isStrength/isHIIT — not isCycle/isSwim — so without this an
      // in-memory bike/swim would fall through to the generic run layout.
      const s=sanitizeFit(f);
      const at=`${s.activityType||''} ${s.activityName||''} ${s.garminTypeKey||''} ${s.garminParentTypeKey||''}`;
      return {
        ...s,
        isCycle:    isCyclingAct(s),
        isSwim:     isSwimAct(s),
        isRun:      s.isRun===true || isRunAct(s),
        isStrength: s.isStrength===true || isStrengthVol(s),
        isMobility: s.isMobility===true || isMobilityAct(s),
        isWalk:     s.isWalk===true || /\b(walk|walking|hike|hiking|trekking)\b/i.test(at),
      };
    });
    const acts=allActivities().filter(a=>a.date===todayStr);
    return acts.map(row=>{
      // Prefer the row's own classification flags (set by fitParser /
      // garmin-activities-client). Fall back to regex against activityType
      // when flags are missing — historical CSV rows lack these fields.
      // Regex updated: matches "Run (outdoor)", "Run (treadmill)", "HIIT",
      // "Trail Run", etc. — the previous /running|trail/ pattern only caught
      // legacy CSV strings and missed the modern parser's "Run (...)" labels.
      // Phase 4r.viz.7 — explicit Cycle / Swim / Walk-Hike classification so
      // each gets a discipline-appropriate render branch instead of falling
      // through to a generic activity layout. Delegate to the single-source
      // classifiers (activityType + activityName + Garmin type keys) so a ride
      // whose local activityType isn't "Cycling" (but whose activityName/Garmin
      // key is) still classifies as cycling — same as the gauge.
      const isMobility = isMobilityAct(row);
      const isCycle = !isMobility && isCyclingAct(row);
      const isSwim = !isMobility && !isCycle && isSwimAct(row);
      const isWalk = !isMobility && !isCycle && !isSwim && (row.isWalk === true || /\b(walk|walking|hike|hiking|trekking)\b/i.test(row.activityType||'') || /\b(walk|hike)\b/i.test(row.activityName||''));
      const isRun = !isMobility && !isCycle && !isSwim && !isWalk && isRunAct(row);
      const isStrength = !isMobility && !isCycle && !isSwim && !isWalk && !isRun && isStrengthVol(row);
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
  // Phase 4r.dataspine.4 — canonical Layer 3; legacy fallback removed.
  const calT=(()=>{ try { return getDerivedTargets({date:todayStr}).dailyCalories.effective; } catch { return 0; } })();

  // Pace helpers
  const paceToSecs=p=>{if(!p)return 0;const[m,s]=p.split(':').map(Number);return(isNaN(m)||isNaN(s))?0:m*60+s;};
  const secsToPace=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
  const pacePctFn=(actualPace,goalPace)=>{
    const a=paceToSecs(actualPace),g=paceToSecs(goalPace||'9:30');
    return a>0?Math.min(g/a,1):0;
  };

  // Weekly miles for "Vs Goal"
  const weeklyMiles=(()=>{
    const acts=allActivities();
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

  const allActs=allActivities();
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
      {/* Phase 4r.narrative.5.fix.5 \u2014 web page-title header removed; the
          top nav already highlights "Daily". Mobile was already gated
          out via `!mobileView` so this only affects web. (Earlier
          Phase 4o.mobile.6 had removed it from mobile for the same
          reason: redundant with the unified mobile per-tab header.) */}

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
        let cyclingMetrics = null;  // bike-day quality (power · effort · efficiency)
        let strengthMetrics = null; // Phase 4o.daily.21 — strength-day quality
        let acr = { ratio: null, zone: 'no_data' };
        let ef30Avg = null;        // 30-day average EF — gives today's EF context
        let sessionSummary = null; // universal hero right-rail: Effort · Avg HR · Calories
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

          // ── Cycling quality metrics — power · effort · efficiency (the bike
          // analogue of runMetrics, fills the hero's right cluster on ride days). ──
          const cyclingActs = todayActs.filter(isCyclingAct);
          if (cyclingActs.length) {
            const bestC = cyclingActs.reduce((b, c) => (c.durationSecs || 0) > (b.durationSecs || 0) ? c : b, cyclingActs[0]);
            cyclingMetrics = cyclingMetricsFor(bestC, profile);
          }

          // ── Universal session summary — the 3 metrics on the RIGHT of the
          // speedometer, identical on every activity (Effort · Avg HR · Calories).
          // Effort = avg HR vs effective max; calories summed across the day's
          // sessions; avg HR/peak from the day's longest session.
          if (todayActs.length) {
            const bestS = todayActs.reduce((b, a) => (a.durationSecs || 0) > (b.durationSecs || 0) ? a : b, todayActs[0]);
            const sAvgHR = bestS.avgHeartRate || bestS.avgHR || null;
            const sCals = todayActs.reduce((s, a) => s + (a.calories || a.activeCalories || 0), 0) || null;
            sessionSummary = {
              avgHR: sAvgHR,
              maxHR: bestS.maxHeartRate || bestS.maxHR || null,
              effortPct: (sAvgHR && maxHR) ? +(sAvgHR / maxHR).toFixed(2) : null,
              calories: sCals,
            };
          }

          // ── Strength quality metrics (Phase 4o.daily.21) ──
          // Mirror of runMetrics for lift days. Three values, same shape
          // as Pace/Effort/Efficiency so the hero stays consistent.
          //   Density — tonnage/min if a template matches, else reps/min.
          //   W:R     — totalRest/totalWork from FIT set messages, tagged
          //             with the energy-system tier (Power/Hyper/Endurance).
          //   Effort  — avgHR/maxHR percent with the same Easy/Aerobic/
          //             Tempo/Threshold/VO2 zones used for run Effort.
          // Strength hero cluster — use the volume predicate so HYROX/hybrid
          // race days get the cluster (Phase 4r.hybrid.root).
          const strengths = todayActs.filter(isStrengthVol);
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

        // Speedometer geometry + zone/needle/display derivation moved into the
        // shared <LoadGauge> component (Phase 4r.viz.34, docs/PRESENTATION_LAYER.md
        // headline role). The hero just passes the gauge MODEL (gaugeValue /
        // gaugeMax / gaugeBreaks / gaugeZoneNames / gaugeLabel / gaugeUnit) below.

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
              // Phase 4r.dataspine.4 — canonical Layer 3 only. eatBack +
              // isTrainingDay derived from goalModel's explain.components
              // instead of the legacy getDynamicMacroTarget shape.
              const eff = (()=>{ try { return getDerivedTargets({date:todayStr}); } catch { return null; } })();
              const calT = eff?.dailyCalories?.effective || 0;
              const proT = eff?.dailyProtein?.effective  || 0;
              const eatBack = eff?.dailyCalories?.explain?.components?.eatBack || 0;
              return {
                calLeft: Math.max(0, Math.round(calT - (totals.calories || 0))),
                proLeft: Math.max(0, Math.round(proT - (totals.protein  || 0))),
                calT, proT,
                earned: eatBack > 0 ? Math.round(eatBack) : 0,
                isTrainingDay: eatBack > 0,
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

                {/* Phase 4r.coach.cleanup — retired the residual "Compact
                    fuel narrative" line ("Fueled X% of today's target.
                    Anchor the next meal.") that lived above the Coach. The
                    coaching half of that line ("Anchor the next meal" /
                    "On pace — stay consistent" / etc.) was a second voice
                    competing with the sigil-marked Coach. Calorie + macro
                    numbers stay visible via the panel above; the Coach is
                    the only commenting voice on the Fuel hero. */}
                <div style={{ paddingTop:4, borderTop:'0.5px solid var(--border-subtle)' }}>
                  <CoachComment surface="fuel" />
                </div>
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
          // Phase 4r.race.15 — a race counts as DONE once a meaningful session
          // is logged on its date (any non-mobility ≥30min/≥5mi — HYROX logs as
          // strength/cardio, not run). Once done, the pre-race card drops
          // immediately rather than lingering until midnight.
          const _raceDoneToday = (rDate) => {
            try {
              return (allActivities() || []).some(a => a?.date === rDate && !isMobilityAct(a)
                && (((Number(a.durationSecs)||0)/60) >= 30 || (Number(a.distanceMi)||0) >= 5));
            } catch { return false; }
          };
          const _upcomingPlayRace = _playRaces
            .filter(r => {
              const d = parseLocalDate(r.date);
              return d && d >= _todayMid && d <= _sevenDaysOut && !_raceDoneToday(r.date);
            })
            .sort((a,b) => parseLocalDate(a.date) - parseLocalDate(b.date))[0] || null;
          let _playSweatRate = null;
          if (_upcomingPlayRace) {
            try {
              const summary = summarizeRecentSignatures({
                activities: allActivities(),
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
              padding: '10px 12px 8px',
              marginBottom: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}>
              {/* Phase 4r.viz.27 — three-column hero matching web layout:
                  LEFT cluster (7d · 30d · A:C) | CENTER speedometer |
                  RIGHT cluster (Pace · Effort · Efficiency from today's run).
                  When today has no run logged, RIGHT cluster is omitted so
                  the speedometer + LEFT cluster center naturally. */}
              {(() => {
                // Phase 4r.viz.33 — RIGHT cluster now comes from the presentation
                // layer (docs/PRESENTATION_LAYER.md): the per-kind story spec
                // picks the primary metric ids, the metric registry formats them
                // (one source of truth, shared with the web Daily hero), and
                // MetricCluster lays them out for this surface. The old inline
                // run IF/EF tier logic + the strength tile builder were deleted —
                // they're now in core/presentation/metricRegistry.js, used by
                // both heroes, so the two can no longer drift.
                const heroBag = { runMetrics, cyclingMetrics, strengthMetrics, ef30Avg, session: sessionSummary };
                // Right of the speedometer = 3 UNIVERSAL metrics (same every
                // activity): Effort · Avg HR · Calories. Sport-specific detail now
                // lives in the card below, not the hero.
                const primaryIds = ['sessEffort', 'sessAvgHR', 'sessCalories'];
                const hasPrimary = selectMetrics(primaryIds, heroBag).length > 0;

                return (
                  // Phase 4r.viz.28 — 3-column GRID (equal side columns, auto
                  // center) so the speedometer stays DEAD-CENTER whether or not
                  // the RIGHT run-metrics cluster is present. Previously a
                  // space-between flex pushed the speedometer to the right edge
                  // on non-run days (no right cluster). On non-run days the right
                  // column renders empty, balancing the left so center holds.
                  <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap:8, width:'100%' }}>
                    {/* LEFT cluster — readiness rings + A:C ratio (shared
                        ContextCluster, compact profile). */}
                    <div style={{ flexShrink:0, justifySelf:'start', minWidth:0, display:'flex', flexDirection:'column', gap:4 }}>
                      {/* Phase 3.1 — the one read, shared with the web hero via
                          readinessVerdict() (single source → can't drift). The word
                          carries the accent; the score stays in the rings. */}
                      {(() => { const v = readinessVerdict(r7Score); return v.word && (
                        <div style={{ fontSize:15, fontWeight:700, lineHeight:1, color: v.color, whiteSpace:'nowrap' }}>{v.word}</div>
                      ); })()}
                      <ContextCluster r7={r7Score} r30={r30Score} acr={acr} surface="play-hero" />
                    </div>

                    {/* CENTER — speedometer + zone label below (Phase 4r.viz.30).
                        rTSS number RELOCATED out of the dial (it now lives in the
                        right cluster / below) — the dial shows the needle + the
                        ZONE name (OVERREACHING etc.), matching the web hero. */}
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
                      <LoadGauge value={gaugeValue} max={gaugeMax} breaks={gaugeBreaks}
                        zoneNames={gaugeZoneNames} label={gaugeLabel} unit={gaugeUnit}
                        surface="play-hero" />
                    </div>

                    {/* RIGHT cluster — today's session quality (Pace/Effort/
                        Efficiency for runs; Density/W:R/Effort for strength/HYROX),
                        from the presentation layer. Empty div on days with neither
                        so the 3-column grid keeps the speedometer dead-center. */}
                    {hasPrimary ? (
                      <div style={{ flexShrink:0, paddingLeft:8, borderLeft:'0.5px solid var(--border-subtle)', minWidth:0, justifySelf:'end' }}>
                        <MetricCluster ids={primaryIds} bag={heroBag} surface="play-hero" align="end" />
                      </div>
                    ) : <div/>}
                  </div>
                );
              })()}

              {/* Phase 4r.coach.cleanup — retired the residual "Compact
                  training narrative" line ("Readiness X — strong, steady on
                  30d · ramping fast — protect recovery") that lived above
                  the Coach. It duplicated coaching the Coach already does
                  and competed with the sigil-marked voice. Numbers stay
                  visible via the rings + A:C chip above; the Coach is the
                  only commenting voice on the Play hero. */}
              <div style={{ paddingTop:4, borderTop:'0.5px solid var(--border-subtle)' }}>
                <CoachComment surface="play" />
              </div>
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
            // Phase 4r.viz.32 — TWO top-level columns now: a LEFT section that
            // mirrors mobile (metrics-left · centered speedometer · metrics-
            // right, narrative below) and the Coach digest as the RIGHT column.
            // (Was 3 cols: speedometer | readiness | coach.)
            // 50/50 so the Coach column's left border lines up exactly with
            // the divider between the Activity and Nutrition tiles below
            // (that grid is also minmax(0,1fr) minmax(0,1fr) with the same gap).
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
            gap: 'clamp(8px,1vw,12px)',
            alignItems: 'start',
            minWidth: 0,
          }}>
            {/* ── LEFT SECTION · readiness band (metrics | centered gauge | metrics) ── */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, minWidth:0 }}>
              {/* Flex row with EVEN spacing: space-evenly puts four equal gaps
                  (both edges + both sides of the gauge) instead of space-between's
                  two big gaps, so the gauge (order:2) is centered with the readiness
                  group (order:1) and session cells (order:3) evenly spaced around it
                  — no oversized gap beside the speedometer. */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-evenly', gap:'clamp(10px,1.5vw,18px)', minWidth:0 }}>
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
              style={{ order:2, display:'flex', flexDirection:'column', alignItems:'center', gap:2, minWidth:0, cursor:'help' }}>
              <LoadGauge value={gaugeValue} max={gaugeMax} breaks={gaugeBreaks}
                zoneNames={gaugeZoneNames} label={gaugeLabel} unit={gaugeUnit}
                surface="daily-hero" />
              {/* Inline caption removed Phase 4o.daily.18 — full
                  explanation lives in the parent column's hover tooltip. */}
            </div>

            {/* ── COL 2 · Training Readiness · wider, no domain dupe ──
                Domain breakdown (Activity/Nutrition/Body) was removed
                Phase 4o.daily.14 — that's already the headline of EdgeIQ.
                What stays here: the rings, A:C, run pace quality, and a
                short narrative interpreting the readiness for today. */}
            <div style={{ order:1, display:'flex', flexDirection:'column', gap:7, minWidth:0 }}>
              {/* Header — single line, no right-side subtitle (the
                  narrative below explains what readiness measures). */}
              <div style={{ fontSize:9, fontWeight:600, color:'var(--text-muted)',
                letterSpacing:'0.08em', textTransform:'uppercase', whiteSpace:'nowrap' }}>
                Training Readiness
              </div>

              {/* Phase 3.1 — the one read. A plain-language verdict is the hero's
                  focal line: the single thing the screen is telling you today.
                  From the shared readinessVerdict() (same source as the mobile
                  hero + the ring bands → can never disagree). The WORD carries the
                  accent (the one place color is spent); the score itself lives in
                  the rings, so we don't repeat the number here. */}
              {(() => { const v = readinessVerdict(r7Score); return v.word && (
                <div style={{ fontSize:18, fontWeight:700, lineHeight:1, color: v.color, whiteSpace:'nowrap' }}>{v.word}</div>
              ); })()}

              {/* Rings + A:C — shared ContextCluster (comfortable profile),
                  the same component the mobile Play hero uses. */}
              <ContextCluster r7={r7Score} r30={r30Score} acr={acr} surface="daily-hero" />
            </div>

            {/* ── RIGHT band cell · session-quality metrics (order:3) ──
                Mirrors mobile: the gauge sits centered, readiness numbers
                (rings + A:C) on its left, session-quality cells on its right. */}
            <div style={{ order:3, display:'flex', alignItems:'center', minWidth:0 }}>
                {/* ── Session quality metrics (Phase 4o.daily.21) ──
                    Same three-tile rhythm regardless of session modality:
                      Run days     → Pace · Effort · Efficiency
                      Strength days → Density · W:R · Effort
                    The values change but the visual shape and tier-color
                    semantics stay constant, so the hero feels coherent
                    whether you logged a run, a lift, or both. */}
                {(() => {
                  // Presentation layer (docs/PRESENTATION_LAYER.md) — the SAME
                  // story spec + metric registry + MetricCluster as the mobile
                  // Play hero, just a different surface profile ('daily-hero'
                  // vs 'play-hero'). The old inline cells builder (duplicated run
                  // IF/EF tier logic + strength tiles) is gone; the tier logic
                  // now lives once in core/presentation/metricRegistry.js, so the
                  // web and mobile heroes can no longer drift.
                  const heroBag = { runMetrics, cyclingMetrics, strengthMetrics, ef30Avg, session: sessionSummary };
                  // Universal right rail (Effort · Avg HR · Calories) — same on
                  // every activity; sport detail moved to the card below.
                  const primaryIds = ['sessEffort', 'sessAvgHR', 'sessCalories'];
                  if (!selectMetrics(primaryIds, heroBag).length) return null;
                  return (
                    <div style={{ paddingLeft:12, borderLeft:'0.5px solid var(--border-subtle)' }}>
                      <MetricCluster ids={primaryIds} bag={heroBag} surface="daily-hero" align="start" />
                    </div>
                  );
                })()}
                {/* Readiness narrative retired Phase 4r.narrative.5.fix.30 —
                    the Coach (Daily + EdgeIQ) is the single coaching voice;
                    the rings/A:C/cells above still show the raw numbers. */}
            </div>
            </div>
            </div>

            {/* ── RIGHT SECTION · Coaching prompts + calibration ── */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, minWidth:0,
              borderLeft: '0.5px solid var(--border-subtle)', paddingLeft: 12 }}>
              {/* Phase 4r.narrative.5.fix.33 — COL 3 is the empty right slot
                  of the hero, so it now carries the WHOLE-DAY Coach digest:
                  one warm, cohesive paragraph (training + fuel + rest) instead
                  of three terse per-section status lines. The Daily screen is
                  the diary — reassuring, never a wall of red warnings. */}
              <CoachComment surface="daily_digest" />

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
          {/* Phase 4r.narrative.5.fix.33 — per-section training/nutrition
              Coach lines retired: the Daily diary speaks once, cohesively,
              in the hero digest above (training + fuel + rest in one warm
              paragraph) rather than scattering status lines per column. */}
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
              {/* Phase 4r.race.13 — Coach moved up to the mobile Play hero
                  rail (replacing the legacy trainingPrompts bullets). The
                  Activity card is just the session data now. */}
              {/* Empty state — before anything's logged, show the SAME pre-workout
                  tile the mobile Start screen uses (Emil 2026-06-10): it carries the
                  day's plan, targets and coach. On a rest/no-plan day fall back to the
                  compact "ready" placeholder. Once an activity is logged the branch
                  below takes over with the normal activity card(s). */}
              {(()=>{
                const _pl=(typeof todayPlanned==='function')?todayPlanned():null;
                const _nextRace=(()=>{try{const races=JSON.parse(localStorage.getItem('arnold:races')||'[]');const n=new Date();n.setHours(0,0,0,0);return races.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=n;}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date))[0]||null;}catch{return null;}})();
                const _ws=getPlannedWorkoutState({plannedToday:_pl,nextRace:_nextRace,storageVersion});
                // Web Daily only (mobileView is undefined there); the mobile
                // Start screen already carries this tile, so don't double it on
                // the mobile activity tab.
                if(!mobileView&&_ws.kind!=='none'){
                  return (
                    <PlannedWorkoutTile
                      profile={profile}
                      plannedToday={_pl}
                      nextRace={_nextRace}
                      storageVersion={storageVersion}
                      onTap={setTab?()=>setTab('goals'):undefined}
                      figureSize={104}
                      figureTop={48}
                    />
                  );
                }
                const _lbl=_pl&&_pl.type&&_pl.type!=='rest'?({easy_run:'Easy run',long_run:'Long run',tempo:'Tempo',intervals:'Intervals',strength:'Strength',hiit:'HIIT',mobility:'Mobility',cross:'Cross-train',race:'Race'}[_pl.type]||_pl.type):null;
                return (
                  <div style={{textAlign:'center',padding:'14px 8px 16px'}}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.85}}>
                      <path d="M3 12h3l2 6 4-12 2 6h5"/>
                    </svg>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--text-primary)',marginTop:8}}>{_lbl?`Today: ${_lbl}`:'Ready when you are'}</div>
                    <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>{_lbl?'Get after it — tap Sync once you’re done.':'Sync Garmin or upload a .fit to log a session.'}</div>
                  </div>
                );
              })()}
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
                      Garmin FIT{fd._groupCount>1?` · cumulative`:''}
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
                  // RACE DETECTION — a logged race on this activity's date makes this a
                  // race effort. We keep the detected SPORT's card (a run race shows the
                  // run macro/micro) and add a race header with the result (finish time).
                  // Guard against tagging a short shake-out on race day.
                  const _raceMatch = (() => {
                    if (isMobilityAct(fd) || !fd.date) return null;
                    if (!((fd.durationSecs || 0) >= 1200 || (fd.distanceMi || 0) >= 2)) return null;
                    return (storage.get('races') || []).find(r => r && r.date === fd.date) || null;
                  })();
                  const isRace = !!_raceMatch;
                  const _raceDist = fd.distanceMi ? `${fd.distanceMi.toFixed(1)} mi`
                    : (_raceMatch && (_raceMatch.distance_km || _raceMatch.distanceKm) ? `${_raceMatch.distance_km || _raceMatch.distanceKm} km` : null);
                  const _raceFinish = (fd.durationSecs > 0) ? (typeof fmtHMS === 'function' ? fmtHMS(fd.durationSecs) : fd.duration) : fd.duration;
                  const _typeLabels = {
                    easy_run:'Easy', long_run:'Long',
                    tempo:'Tempo', intervals:'Intervals',
                    hiit:'HIIT', strength:'Strength',
                    mobility:'Mobility', cycle:'Cycle',
                    swim:'Swim', walk:'Walk', ski:'Ski',
                    race:'Race', generic:'Session',
                  };
                  return (
                    <>
                      {/* RACE HEADER — when this effort is a logged race, lead with the
                          result (name · distance · finish time). The card below stays the
                          detected sport's macro/micro. */}
                      {isRace && (
                        <div style={{
                          display:'flex', flexDirection:'column', gap:3,
                          background:'var(--bg-elevated)', borderLeft:'3px solid #fbbf24',
                          borderRadius:8, padding:'10px 12px', marginBottom:10,
                        }}>
                          <div style={{display:'flex', alignItems:'center', gap:7}}>
                            <span style={{color:'#fbbf24', fontWeight:700, fontSize:11, letterSpacing:'0.06em'}}>★ RACE</span>
                            <span style={{color:'var(--text-primary)', fontWeight:700, fontSize:14, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{_raceMatch.name || 'Race'}</span>
                          </div>
                          <div style={{fontSize:12, color:'var(--text-secondary)'}}>
                            {[_raceDist, _raceFinish ? `finished ${_raceFinish}` : null, _raceMatch.location || _raceMatch.city].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      )}
                      {/* SESSION — headline + context metrics in packed fill-grids
                          (cardLayout.js): dense on web, auto 2-col on a phone. The
                          context metrics fold straight under the headline with a
                          compact label, no full divider. */}
                      {row1.length > 0 && (mobileView ? (
                        /* PRIMARY — the run's key outcomes get a treatment DISTINCT
                           from the secondary boxed tiles below: one divider-separated
                           card with color-coded values (the MobileHome/EdgeIQ stat-row
                           language). It reads as the headline, is dense (no per-tile
                           black), and the colour per metric tells them apart at a glance. */
                        <div style={{display:'flex', alignItems:'stretch', background:'var(--bg-elevated)', borderRadius:10, padding:'15px 2px', marginBottom:10}}>
                          {row1.slice(0,4).map((t,i)=>{
                            // Value colour follows Arnold's progress/regress rule:
                            // green = better than usual, red = worse, amber = flat,
                            // neutral when the metric has no meaningful direction
                            // (e.g. distance). Category colours are NOT used here.
                            const tc = t.trend==='good' ? '#22c55e'
                                     : t.trend==='bad'  ? '#ef4444'
                                     : t.trend==='flat' ? '#f59e0b'
                                     : 'var(--text-primary)';
                            return (
                            <div key={i} style={{flex:1, minWidth:0, textAlign:'center', padding:'0 6px', borderLeft: i>0?'1px solid var(--border-subtle)':'none'}}>
                              <div style={{fontSize:22, fontWeight:700, color:tc, lineHeight:1.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{t.value}</div>
                              <div style={{fontSize:10, fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em', marginTop:5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{String(t.label||'').split('·')[0].trim()}</div>
                            </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={cardGrid('headline', false)}>
                          {row1.map((t,i)=>(
                            <HeroTile key={i} icon={t.icon} color={t.color} label={t.label}
                              value={t.value} trend={t.trend} tint={t.tint}/>
                          ))}
                        </div>
                      ))}
                      {/* DETAILS — the per-activity sub-metrics, INCLUDING the
                          user-logged RPE + Added Load (those are details too, not a
                          separate "Effort & Load" section). Always shown. */}
                      <div style={{...SECTION_HDR, marginTop:2}}>Details</div>
                      <div style={cardGrid('context', !!mobileView)}>
                        {row2.map((t, i) => (
                          <IconMiniTile key={i} icon={t.icon} color={t.color}
                            value={t.value} label={t.label}/>
                        ))}
                        <SessionRPE fd={fd} dateStr={todayStr}/>
                        <AddedLoad fd={fd} dateStr={todayStr} profile={profile}/>
                      </div>
                      {/* FUEL — hydration + replenishment merged under one header. */}
                      <div style={SECTION_RULE}/>
                      <div style={SECTION_HDR}>Fuel</div>
                      <HydrationRow fd={fd} bare/>
                      {/* Post-run weigh-in auto-picked-up from the synced weight log. */}
                      {idx===fitGroups.length-1 && (
                        <div style={{marginTop:8}}>
                          <ReplenishTracker fd={fd} dateStr={todayStr} bare
                            onGoToFuel={setTab?()=>setTab('nutrition_mobile'):undefined}/>
                        </div>
                      )}
                      {idx===fitGroups.length-1 && (()=>{
                        const acts=allActivities();
                        const monday=new Date();
                        const dow=monday.getDay();
                        monday.setDate(monday.getDate()-(dow===0?6:dow-1));
                        monday.setHours(0,0,0,0);
                        if (planType === 'strength') {
                          const wk=acts.filter(a=>isStrengthVol(a)&&a.date&&new Date(a.date+'T12:00:00')>=monday);
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
                        if (planType === 'cycle' || planType === 'swim' || planType === 'ski' || planType === 'walk') {
                          const SPORT = { cycle:'Cycling', swim:'Swim', ski:'Ski', walk:'Walk/Hike' }[planType];
                          const PRED = {
                            cycle: isCyclingAct, swim: isSwimAct, ski: isSkiAct,
                            walk: (a)=> a?.isWalk===true || isWalkAct(a),
                          }[planType];
                          const wk = acts.filter(a=>PRED(a) && a.date && new Date(a.date+'T12:00:00')>=monday);
                          const dCnt = wk.length;
                          const dMi = wk.reduce((s,a)=>s+(a.distanceMi||0),0);
                          const dHrs = wk.reduce((s,a)=>s+(a.durationSecs||0),0)/3600;
                          const allHrs = acts.filter(a=>a.date && new Date(a.date+'T12:00:00')>=monday).reduce((s,a)=>s+(a.durationSecs||0),0)/3600;
                          const tgtHrs = parseFloat(profile?.weeklyTimeTargetHrs)||5;
                          return <>
                            <div style={divider}/>
                            <div style={subHdr}>Vs Goal</div>
                            <MiniBar label="Weekly active time"
                              displayValue={`${allHrs.toFixed(1)} / ${tgtHrs} h`}
                              goalLabel={`Goal: ${tgtHrs} h/week`}
                              pct={allHrs/tgtHrs}/>
                            <div style={{fontSize:11,color:'var(--text-secondary)',marginTop:6}}>{SPORT} this week: {dCnt} session{dCnt===1?'':'s'}{dMi>0?` · ${dMi.toFixed(1)} mi`:''}{dHrs>0?` · ${dHrs.toFixed(1)} h`:''}</div>
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
                            displayValue={`${weeklyMiles.toFixed(1)} / ${profile?.weeklyRunDistanceTarget||30} mi`}
                            goalLabel={`Goal: ${profile?.weeklyRunDistanceTarget||30} mi/week`}
                            pct={weeklyMiles/(parseFloat(profile?.weeklyRunDistanceTarget)||30)}/>
                        </>;
                      })()}
                      {idx===fitGroups.length-1 && (
                        <SessionVsUsual fd={fd} todayStr={todayStr} divider={divider} subHdr={subHdr}/>
                      )}
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
                      const mhr = getEffectiveMaxHR(profile, allActivities());
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
                    const acts=allActivities();
                    const monday=new Date();const dow=monday.getDay();monday.setDate(monday.getDate()-(dow===0?6:dow-1));monday.setHours(0,0,0,0);
                    // Phase 4r.strength.hybrid — count HYBRID workouts (HYROX,
                    // Strength volume incl. hybrid (Phase 4r.hybrid.root).
                    const wkStrength=acts.filter(a=>isStrengthVol(a)&&a.date&&new Date(a.date+'T12:00:00')>=monday);
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

                  {/* Session vs-usual panel — fills the gap above Nutrition with
                      today's session stats, upgrading to a "vs usual" comparison
                      once enough history exists. Extracted to a component to
                      avoid the brittle inline-IIFE parse issues. */}
                  {idx===fitGroups.length-1 && (
                    <SessionVsUsual fd={fd} todayStr={todayStr} divider={divider} subHdr={subHdr}/>
                  )}
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
                  const acts=allActivities();
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
          {/* Intelligence Hub panel — fills the training column under the activity
              card with the hub's on-screen presence: what it's learned about YOU
              (response sensitivities) + race-fitness predictions. Rendered outside
              the fitData ternary so it shows even on a no-activity day (learning
              state when the model is still cold). This is the hub using a real
              surface to speak, per the design (no standalone top-of-Daily tile). */}
          <LearnedHero style={{marginTop:8}} />
          {/* Today's Movement moved out of Activity column → summary
              footer row at the bottom of the page (Phase 4o.daily.9). */}
        </div>}

        {/* ── RIGHT: Nutrition (show in desktop or mobileView=nutrition) ── */}
        {mobileView!=='activity'&&<div style={{minWidth:0}}>
          {/* Phase 4r.narrative.5.fix.33 — per-section nutrition Coach line
              retired; the Daily diary now speaks once in the hero digest
              (training + fuel + rest as one warm paragraph). */}

          {/* Phase 4r.viz.17 — Race-prep banner removed from Fuel tab per
              user request. Race fueling info lives on the Play race card. */}

          {/* ── Nutrition panel — header carries the Cronometer sync button
              and the dynamic Today's Target line, mirroring Activity's
              "Run · sync · date" header structure. ── */}
          <div>
            {/* Phase 4r.race.13 — Coach now lives in the mobile Fuel hero
                rail above this card (replacing the legacy nutritionPrompts
                bullets), so no coachSlot is passed here. */}
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
