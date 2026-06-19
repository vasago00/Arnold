// TrainingTab — the EdgeIQ "Start" / training screen (web tab==="training").
// Phase 0.5 (monolith decomposition) — extracted verbatim from Arnold.jsx.
// The only body change vs the monolith: getUnifiedActivities() (a 1-line
// delegate that lived in Arnold.jsx) is called as allActivities() directly,
// imported from core/dcyMath.js. Everything else is byte-identical.
import { useState, useEffect, useMemo } from "react";
import { currentTrueWeightLbs } from "../core/bodyWeight.js";
import { useStorageVersion } from "../hooks/useStorageVersion.js";
import { storage } from "../core/storage.js";
import { getGoals } from "../core/goals.js";
import { allActivities } from "../core/dcyMath.js";
import { cleanSleepForAveraging } from "../core/parsers/sleepParser.js";
import { generateInsights } from "../core/insights.js";
import { computeUserState, synthesizeRecommendations } from "../core/intelligence.js";
import { parseLocalDate } from "../core/dateUtils.js";
import { isRun as isRunAct, isStrength as isStrengthAct, isMobility as isMobilityAct } from "../core/activityClass.js";
import { td, daysUntil } from "../core/uiFormat.js";
import { aiStream } from "../core/ai.js";
import { dailyTotals as nutDailyTotals } from "../core/nutrition.js";
import { getEffectiveTargets as getDerivedTargets } from "../core/goalModel.js";
import { todayPlanned, checkTodayCompletion } from "../core/planner.js";
import { computeHrTSS, computeAcuteChronicRatio, computeDailyScore, computeRolling7d, computeRolling30d, getEffectiveMaxHR, rtssBand } from "../core/trainingStress.js";
import { assessCalibration, recommendCalorieTarget } from "../core/energyBalance.js";
import { computeGlycogenEstimate } from "../core/coachSignals.js";
import { summarizeRecentSignatures } from "../core/derive/recoverySignature.js";
import { resolveEdgeStat, EDGE_RAIL } from "../core/presentation/edgeiqRegistry.js";
import { S } from "../arnoldStyles.js";
import { C } from "../arnoldTheme.js";
import { MobileHome } from "./MobileHome.jsx";
import { CoachComment } from "./CoachComment.jsx";
import { HealthSystemsGrid } from "./HealthSystemsGrid.jsx";
import { RaceFocusCard } from "./RaceFocusCard.jsx";

export function TrainingTab({setTab,data,mobileInitView,onMobileInitViewUsed}){
  // Phase 4r.intel.13-fix1 — useStorageVersion lets the insightsForHero
  // memo invalidate on Cloud Sync / manual edits the same way Dashboard does.
  const storageVersion = useStorageVersion();
  const profile={...(storage.get('profile')||{}),...getGoals()};
  const activities=allActivities();
  const cronometer=storage.get('cronometer')||[];
  const weightData=storage.get('weight')||[];
  const hrvData=storage.get('hrv')||[];
  const sleepData=cleanSleepForAveraging(storage.get('sleep')||[]);
  const dailyLogs=storage.get('dailyLogs')||[];

  // Phase 4r.intel.17 — Intelligence pipeline (Layer 3 + 4).
  // computeUserState builds the canonical model-of-the-user (trust, phase,
  // trajectory, recoveryDebt, burdens, numbers). synthesizeRecommendations
  // takes that state and the raw insight evidence, returns the ordered
  // list of cards the action grid renders. Every card is a facet of one
  // coherent plan — contradictions impossible by construction.
  //
  // Insights still fire as evidence (we pass them through so the
  // synthesizer can surface n + p chips on stat-gated rows), but their
  // recommendation text is owned by Layer 4 now.
  const intelligence = useMemo(() => {
    let rawInsights = [];
    try {
      rawInsights = generateInsights({
        activities,
        sleep: sleepData,
        hrv: hrvData,
        weight: weightData,
        cronometer,
        profile,
      }) || [];
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TrainingTab] generateInsights threw:', e?.message || e);
    }
    let userState = null;
    try {
      userState = computeUserState({
        activities,
        sleep: sleepData,
        hrv: hrvData,
        weight: weightData,
        cronometer,
        profile,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TrainingTab] computeUserState threw:', e?.message || e);
    }
    let cards = [];
    if (userState) {
      try {
        cards = synthesizeRecommendations(userState, { rawInsights, rawPrompts: [] }) || [];
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[TrainingTab] synthesizeRecommendations threw:', e?.message || e);
      }
    }
    return { userState, cards, rawInsights };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion]);

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
          weightLbs:currentTrueWeightLbs(weightData),
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
        {/* Phase 4r.narrative.5.fix.5 — empty-state title dropped to match
            the loaded view; top nav is the page identifier. */}
        <div style={{...S.empty,display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{fontSize:"clamp(13px,0.8vw + 9px,16px)",color:C.t}}>No training data yet.</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>Import your CSVs in the Daily tab to unlock EdgeIQ.</div>
          <button style={{...S.sb,width:"auto",padding:"10px 24px"}} onClick={()=>setTab("daily")}>Go to Daily →</button>
        </div>
      </div>
    );
  }

  // ── Targets / goals ──
  const weeklyRunTarget=parseFloat(profile?.weeklyRunDistanceTarget)||30;
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
  // Phase 4r.dataspine.4 — canonical Layer 3; legacy fallback removed.
  const calT=(()=>{ try { return getDerivedTargets({date:td()}).dailyCalories.effective; } catch { return 0; } })();

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
  const currentWeight=currentTrueWeightLbs(weightData) ?? latestW?.weightLbs; // morning-fasted (not the post-workout reading)
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
  const subHdr={fontSize:11,fontWeight:600,letterSpacing:'0.06em',color:'var(--text-secondary)',textTransform:'uppercase',marginBottom:8};
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
      {/* Section 1: Page meta — Phase 4r.narrative.5.fix.5 dropped the
          "◈ EdgeIQ" label (top nav already highlights EdgeIQ). The
          yearLabel/yearStr subtitle + YTD/days-in/AI badges stay since
          they carry real information, not just a tab name. */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <div>
          <div style={{fontSize:10,color:'var(--text-muted)'}}>{yearLabel} · {yearStr}</div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:10,background:'rgba(96,165,250,0.12)',color:'#60a5fa'}}>YTD</span>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:10,background:'rgba(167,139,250,0.12)',color:'#a78bfa'}}>{Math.floor(daysInYear)} days in</span>
          <button onClick={runTrainingAI} disabled={aiLoading} style={{fontSize:10,padding:'4px 10px',borderRadius:10,background:'rgba(167,139,250,0.15)',color:'#a78bfa',border:'0.5px solid rgba(167,139,250,0.35)',cursor:aiLoading?'wait':'pointer',fontWeight:500,letterSpacing:'0.03em'}}>{aiLoading?'✦ Analyzing…':(aiState?'✦ Refresh AI':'✦ Analyze training')}</button>
        </div>
      </div>

      {/* Phase 4r.intel.12-fix7 — Insights panel relocated. It used to
          live above the hero; user preferred it as a right-side column
          next to the Activity/Nutrition/Body domain rail. See the wrapping
          grid added a few lines down. Component is rendered alongside the
          hero so they read as a single intelligence band. */}

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
        // Phase 4r.dataspine.4 — canonical Layer 3 only. getEffectiveTargets
        // already honours training-day eat-back (via the calorie target
        // derivation in goalModel), so the same path drives every fuel
        // surface in the app. Legacy fallback chain removed.
        const todayNutTotals = (() => {
          try { return nutDailyTotals(today); } catch { return { calories: 0, protein: 0 }; }
        })();
        const eff = (() => { try { return getDerivedTargets({date:td()}); } catch { return null; } })();
        const calTarget = eff?.dailyCalories?.effective || 0;
        const proTarget = eff?.dailyProtein?.effective  || 0;
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
          // Phase 4r.edgeiq.2 — added driver tiles (Weekly load, Weight).
          if (type === 'load' || type === 'weight') return '#cbd5e1'; // neutral — context metric, not pass/fail
          // Phase 4r.edgeiq.5 — glycogen adequacy band. val = adequacyRatio×100.
          if (type === 'glycogen') { if (val >= 80) return '#4ade80'; if (val >= 50) return '#fbbf24'; return '#f87171'; }
          // Phase 4r.narrative.5.fix.11 — rTSS uses the canonical RTSS_BANDS
          // table so the EdgeIQ MiniStat color matches the Daily gauge color
          // for the same value. Without this, the generic "high = good" rule
          // below painted rTSS=39 RED (because <50) while Daily painted it
          // GREEN (because ≤50 = easy). User feedback 2026-05-27.
          if (type === 'rtss')   return rtssBand(val).color;
          if (val >= 70) return '#4ade80';
          if (val >= 50) return '#fbbf24';
          return '#f87171';
        };

        // Mini-stat tile — compact, with optional sparkline.
        // `tier` controls visual hierarchy: 'domain' (bold/larger) for the
        // 3 composite scores; 'driver' (smaller) for the 6 contributors;
        // 'action' (medium) for Today/Race.
        const MiniStat = ({ label, value, sub, history, type, fmt, tier = 'driver', valuePx }) => {
          const color = statusFor(typeof value === 'number' ? value : null, type);
          // valuePx overrides the tier default — used for text-status tiles
          // (e.g. Glycogen "Moderate") whose words are wider than a number.
          const valueSize = valuePx != null ? valuePx : (tier === 'domain' ? 19 : tier === 'action' ? 15 : 15);
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
        const RailColumn = ({ bracket, color, children, gap = 'clamp(6px,0.7vw,10px)', flexWeight = 1, vertical = false }) => (
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
            <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 6 : gap, alignItems: 'flex-start' }}>
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
                  // SINGLE SOURCE OF TRUTH — use the SAME load the Daily gauge shows
                  // (computeDailyScore.sessionMetric, which applies the canonical
                  // hrTSS + the sRPE load floor) so EdgeIQ and Daily never disagree.
                  // (They previously did: 50 here vs 57 on Daily, because this loop
                  // didn't apply the sRPE blend.)
                  try {
                    const ds = computeDailyScore(today);
                    const n = Number(ds?.sessionMetric?.value);
                    if (Number.isFinite(n) && n > 0) return Math.round(n);
                  } catch {}
                  // Fallback: HR-derived sum if the score engine errors.
                  const todayActsAll = (activities || []).filter(a => a.date === today);
                  if (!todayActsAll.length) return null;
                  let total = 0;
                  for (const a of todayActsAll) {
                    try {
                      if (isMobilityAct(a)) continue;
                      if (Number(a.trainingStressScore) > 0) { total += Number(a.trainingStressScore); continue; }
                      if ((a.avgHR || a.avgHeartRate) && a.durationSecs) {
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

                // ── Phase 4r.edgeiq.2 — third driver tile per domain ──
                // Activity: 7-day acute training load (the volume ACWR is built
                // from). Nutrition: glycogen fuel-tank status. Body: weight.
                const weeklyLoadVal = (acwrToday?.acuteLoad != null && acwrToday.acuteLoad > 0)
                  ? acwrToday.acuteLoad : null;
                // Phase 4r.edgeiq.5 — Nutrition 3rd tile = Glycogen (Coach
                // signal). "Am I fueled to train?" — adequacyRatio of carbs
                // supplied vs 24h training burn. Replaced Carbs left (which
                // itself replaced the broken intake−TDEE "Balance"). Point-in-
                // time status, so no daily sparkline.
                const glyco = (() => {
                  try {
                    const log = storage.get('nutritionLog') || [];
                    return computeGlycogenEstimate(activities || [], log, { today });
                  } catch { return null; }
                })();
                // Map status → a 0-100-ish value for color (reuse score bands).
                const glycoPct = (glyco && Number.isFinite(glyco.adequacyRatio))
                  ? Math.round(Math.min(glyco.adequacyRatio, 1.5) * 100 / 1.2) : null;
                const weightRowsEdge = (() => { try { return storage.get('weight') || []; } catch { return []; } })();
                const curWeight = (() => {
                  const fasted = currentTrueWeightLbs(weightRowsEdge); // morning-fasted only (not the post-workout reading)
                  if (fasted != null) return fasted;
                  const r = [...weightRowsEdge]
                    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                    .find(w => Number(w?.weightLbs) > 0);
                  return r ? Number(r.weightLbs) : null;
                })();
                const weightHist = days.map(d => {
                  const r = weightRowsEdge.find(w => w?.date === d && Number(w?.weightLbs) > 0);
                  return r ? Number(r.weightLbs) : null;
                }).reverse();

                // ── Phase 4r.edgeiq.3 — 7-day sparkline series so every
                // driver tile carries a trend line (oldest→newest). ──
                const acwrSeries = days.map(d => {
                  try { return computeAcuteChronicRatio(activities, d, ftpPace, maxHREdge); } catch { return null; }
                });
                const acwrHist = acwrSeries.map(r => (r?.ratio != null ? r.ratio : null)).reverse();
                const loadHist = acwrSeries.map(r => (r?.acuteLoad ? r.acuteLoad : null)).reverse();
                const rtssHist = days.map(d => {
                  const acts = (activities || []).filter(a => a.date === d);
                  if (!acts.length) return null;
                  let total = 0;
                  for (const a of acts) {
                    try {
                      if (isRunAct(a) || isStrengthAct(a)) {
                        const { hrTSS } = computeHrTSS({
                          durationSecs: a.durationSecs,
                          avgHR: a.avgHR || a.avgHeartRate,
                          maxHR: maxHREdge, thresholdHR: thresholdHREdge,
                        });
                        total += hrTSS || 0;
                      }
                    } catch {}
                  }
                  return total > 0 ? Math.round(total) : null;
                }).reverse();
                const calLeftHist = days.map(d => {
                  try {
                    const t = nutDailyTotals(d);
                    const tgt = getDerivedTargets({ date: d })?.dailyCalories?.effective || 0;
                    return tgt ? Math.round(tgt - (t.calories || 0)) : null;
                  } catch { return null; }
                }).reverse();
                const proLeftHist = days.map(d => {
                  try {
                    const t = nutDailyTotals(d);
                    const tgt = getDerivedTargets({ date: d })?.dailyProtein?.effective || 0;
                    return tgt ? Math.round(tgt - (t.protein || 0)) : null;
                  } catch { return null; }
                }).reverse();

                // Vertical divider between rail groups
                const Sep = () => (
                  <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)', flexShrink: 0, marginTop: 18 }}/>
                );

                // Presentation layer (docs/PRESENTATION_LAYER.md) — the domain +
                // driver tiles below are now declared in EDGE_RAIL and resolved
                // through edgeiqRegistry (one source of truth for each signal's
                // label / format / sub / type), instead of hand-written MiniStats.
                // The bag is just the already-computed values + sparkline
                // histories + helpers the registry's select() functions read.
                const edgeBag = {
                  domains: todayResult?.domains,
                  acwrToday, todayRTSS, weeklyLoadVal,
                  calRemaining, calTarget, proRemaining, proTarget,
                  glycoPct, glyco, latestHrv, sleepHrs, sleepScore, curWeight, targetWt,
                  rtssBand,
                  hist: {
                    activity: activityHist, nutrition: nutritionHist, body: bodyHist,
                    acwr: acwrHist, rtss: rtssHist, load: loadHist,
                    calLeft: calLeftHist, proLeft: proLeftHist,
                    hrv: hrvHist, sleepHrs: sleepHistHrs, weight: weightHist,
                  },
                };

                return (
                  <>
                    {/* ── Domain scores + Activity/Nutrition/Body drivers ──
                        Declared in EDGE_RAIL, resolved via edgeiqRegistry. The
                        MiniStat/RailColumn/Sep renderers are unchanged; only the
                        per-signal formatting moved to the single registry. */}
                    {EDGE_RAIL.map((col, ci) => col.sep
                      ? <Sep key={`sep-${ci}`}/>
                      : (
                        <RailColumn key={`col-${ci}`} bracket={col.bracket} color={col.color} flexWeight={col.flexWeight}>
                          {col.metrics.map(id => <MiniStat key={id} {...resolveEdgeStat(id, edgeBag)} />)}
                        </RailColumn>
                      )
                    )}

                    <Sep/>

                    {/* ── Action + Race (2 tiles, single row) ──
                        Widened (flexWeight 3, matching the driver columns) so
                        the 2 tiles get enough share for "Long run ✓" to fit
                        inline without squashing — no stacking, no dead space. */}
                    <RailColumn flexWeight={3}>
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
                            : (planned?.distanceMi ? `${planned.distanceMi}mi`
                                : (planned?.minutes ? `${planned.minutes}min`
                                    // A session IS planned (e.g. Mobility) but has no
                                    // distance/duration target → "no target", not the
                                    // misleading "No plan". "No plan" is reserved for a
                                    // truly empty day (no planned entry at all).
                                    : (planned ? 'no target' : 'No plan')))
                        }/>
                      <MiniStat tier="action" label="Race" value={daysToRace} type="race"
                        fmt={v => `${v}d`}
                        sub={nextRace?.name ? nextRace.name.split(' ').slice(0,3).join(' ') : 'No race'}/>
                    </RailColumn>
                  </>
                );
              })()}
            </div>

            {/* ─── Phase 4r.narrative.5.fix.8 — Coach gets its own voice ────
                User feedback 2026-05-27: tinted backgrounds + colored edges
                + severity chips are the vocabulary EdgeIQ already uses for
                Goal Tensions, Health Systems, Today's Status, etc. The
                Coach was blending in with that vocabulary.

                The Coach IS different — it's the human voice over the
                cockpit instruments. Numbers and gauges are the machine;
                Coach is the strategist who interprets them. New treatment
                reflects that:

                  • TEAL is Coach's signature color, always — regardless of
                    severity. State is communicated via a small dot + tag,
                    not a colored fill or border.
                  • SERIF ITALIC body text — visually distinct from the
                    sans-serif data everywhere else in Arnold. Reads as
                    "voice" rather than "metric."
                  • A "Coach" wordmark + sigil ("A°") at the top — a
                    consistent signature that will appear on every Coach
                    surface (EdgeIQ summary here, CoachBeta header, mobile
                    CoachLine). Trains the user's eye to recognize the
                    Coach's voice across the app.
                  • HUD-style frame: slightly darker panel than the page,
                    teal hairline outline, no left-border accent. Reads as
                    an overlay, not a status band.
                  • Tap affordance ("open ↗") in italic, lower-case,
                    smaller — feels like a "read more" link in editorial
                    copy, not a button. */}
            {/* Phase 4r.narrative.5.fix.25 — ambient Coach. The inline
                summary IIFE is replaced by the shared <CoachComment>
                component (surface='edgeiq' → leverage + action). It only
                renders when there's an actionable leverage signal; on an
                aligned day it stays silent. Same component is woven into
                Daily / Plan / Trend with their own surface focus, so the
                Coach speaks contextually everywhere instead of living in
                a dedicated tab. */}
            <div style={{ marginTop: 8 }}>
              <CoachComment surface="edgeiq_web" />
            </div>

            {/* Phase 4r.narrative.5.fix.6 — Goal Tensions block and Today's
                Status strip both moved to the Coach tab (Model B). EdgeIQ
                stays the status/numbers surface; the Coach summary line
                above is the bridge to the synthesis layer (full read on
                Coach). intelligence.userState + intelligence.cards still
                computed here in case future numbers-side widgets need
                them, but they no longer render as their own panels. */}

            {/* Phase 4r.intel.15 — Inline calibration footer removed.
                The BEHIND / ETA / goal-pace story is now a first-class
                card inside the unified action grid above (Goal card),
                with its own concrete recommendation. */}
          </section>
        );
      })()}

      {/* Phase 4r.intel.12-fix9 — InsightsPanel moved INSIDE the hero
          section (between the metric rail and coaching prompts), so the
          full-width row that used to live here has been removed. */}

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

      {/* Race detail — conditional. Phase 4r.race.16 — only render within the
          7-day pre-race window (was 60 days, which surfaced the NEXT race ~weeks
          out the moment the current one finished — violated the 7-day rule the
          Play tab already follows). Outside 7 days the race lives on Calendar.
          Carries info the hero's compact Race tile can't: predicted finish,
          goal pace vs current pace, race readiness. */}
      {(()=>{
        const races=(()=>{try{return JSON.parse(localStorage.getItem('arnold:races')||'[]');}catch{return[];}})();
        const nowD=new Date(); nowD.setHours(0,0,0,0);
        const cutoff7=new Date(nowD); cutoff7.setDate(nowD.getDate()+7);
        // Phase 4r.race.15 — drop the race card once the race is LOGGED on its
        // date (any non-mobility ≥30min/≥5mi — HYROX logs as strength/cardio,
        // not run), rather than lingering until midnight on race day.
        const _raceDoneToday=(rDate)=>(activities||[]).some(a=>a?.date===rDate&&!isMobilityAct(a)&&(((Number(a.durationSecs)||0)/60)>=30||(Number(a.distanceMi)||0)>=5));
        const upcoming=races.filter(r=>{const d=parseLocalDate(r.date);return d&&d>=nowD&&d<=cutoff7&&!_raceDoneToday(r.date);}).sort((a,b)=>parseLocalDate(a.date)-parseLocalDate(b.date));
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
