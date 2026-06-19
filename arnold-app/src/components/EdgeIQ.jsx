// Phase 0.5 (slice 19) — EdgeIQ (formerly the misnamed `Dashboard`) extracted
// verbatim from Arnold.jsx. This is the web "EdgeIQ / Trend" tab (rendered for
// tab==="weekly"): the CockpitRail WoW gauges + 8-week sparklines, the KRI
// "spaceship" matrix (Run / Activity / Recovery / Body with tap-to-pin), and the
// Sunday weekly-CSV sync. On phones it delegates to <MobileEdgeIQ>. Renamed from
// Dashboard (a stale historical name) per Emil. The only body change from the
// monolith original is `getUnifiedActivities()` → its underlying `allActivities()`.
import { useState, useEffect, useMemo, useCallback } from "react";
import { currentTrueWeightLbs } from '../core/bodyWeight.js';
import { useStorageVersion } from "../hooks/useStorageVersion.js";
import { C } from "../arnoldTheme.js";
import { S } from "../arnoldStyles.js";
import { storage } from "../core/storage.js";
import { getGoals } from "../core/goals.js";
import { allActivities } from "../core/dcyMath.js";
import { parseLocalDate } from "../core/dateUtils.js";
import { td } from "../core/uiFormat.js";
import { dailyTotals as nutDailyTotals } from "../core/nutrition.js";
import { isRun as isRunAct, isStrength as isStrengthAct, isMobility as isMobilityAct, isStrengthVolume as isStrengthVol, isHIIT as isHIITAct } from "../core/activityClass.js";
import { parseActivitiesCSV, mergeActivities } from "../core/parsers/activitiesParser.js";
import { parseHRVCSV, mergeHRV } from "../core/parsers/hrvParser.js";
import { parseSleepCSV, mergeSleep, cleanSleepForAveraging } from "../core/parsers/sleepParser.js";
import { parseWeightCSV, mergeWeight } from "../core/parsers/weightParser.js";
import { detectCSVType } from "../core/parsers/detectType.js";
import { parseCronometerCSV } from "../core/parsers/cronometerParser.js";
import { buildTileContext, TILE_METRICS, deriveStatus, normalizeTilePrefs } from "../core/derive/tileMetrics.js";
import { resolveAllStartTiles } from "../core/derive/autoPromote.js";
import { getTopCoachingPrompts } from "../core/coachingPrompts.js";
import { getCurrentBodyComp, computeRMR } from "../core/energyBalance.js";
import { getEffectiveTargets as getDerivedTargets } from "../core/goalModel.js";
import { KRITile, InlineKRIStat } from "./KRITile.jsx";
import { CoachComment } from "./CoachComment.jsx";
import { CockpitRail } from "./CockpitRail.jsx";
import { MobileEdgeIQ } from "./MobileHome.jsx";

export function EdgeIQ({data,setTab,onAiSum,aiSummLoad,aiSummStream,showToast,mobileInitView}){
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
  const activities=allActivities();
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
          const lines=txt.replace(/^﻿/,'').trim().split(/\r?\n/).slice(1);
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
  // Phase 4r.dataspine.1 — canonical calorie target via goalModel
  // Phase 4r.dataspine.4 — legacy resolveCalorieTarget fallback removed.
  const _calTargetForConsumedPct = (()=>{ try { return getDerivedTargets({date:td()}).dailyCalories.effective; } catch { return 0; } })();
  const consumedPct=avgConsumed?Math.min(avgConsumed/_calTargetForConsumedPct,1):0;
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
  const currentWeight   = currentTrueWeightLbs(sortedWeight) || null; // morning-fasted only
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
  // Phase 4r.dataspine.1 — canonical calorie target via goalModel
  // Phase 4r.dataspine.4 — legacy resolveCalorieTarget fallback removed.
  const _calToday = (()=>{ try { return getDerivedTargets({date:td()}).dailyCalories.effective; } catch { return 0; } })();
  const avg30Burned=Math.round(_calToday+(last30ActKcal/30));
  const calT=_calToday;

  // ── Training analysis variables (Phase 4l moves from EdgeIQ) ──
  // Suffixed with Ytd / Trend where Dashboard already has same-name
  // variables for THIS-WEEK calculations (e.g. avgPaceSecs is this-week
  // pace at line 2595; mine is YTD average and gets a different name).
  const ytdStrength=yearActs.filter(isStrengthVol);
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
  const weeklyRunTarget=parseFloat(profile?.weeklyRunDistanceTarget)||30;
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
      {/* Phase 4r.narrative.5.fix.5 — page-title headers removed across
          web tabs. The top nav already highlights the active tab, so a
          duplicate "◈ Trend" label inside the content was visual noise.
          Same cleanup applied to Plan / Labs / Core / Coach / Calendar /
          EdgeIQ / Daily / Profile / Supplements (user feedback 2026-05-27). */}

      {/* Phase 4r.narrative.5.fix.29 — ambient Coach for the Trend tab:
          the recovery/trend read (HRV/sleep/RHR). Silent when nothing
          actionable. */}
      <CoachComment surface="trend" />

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
