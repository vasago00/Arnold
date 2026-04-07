import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { parseSleepCSV, mergeSleep } from "./core/parsers/sleepParser.js";
import { parseWeightCSV, mergeWeight } from "./core/parsers/weightParser.js";
import { detectCSVType } from "./core/parsers/detectType.js";
import { fetchAndParseICS } from "./core/parsers/icsParser.js";
import { parseCronometerCSV } from "./core/parsers/cronometerParser.js";
import { storage } from "./core/storage.js";
import { ArcDial } from "./components/ArcDial.jsx";
import { TrendBadge } from "./components/TrendBadge.jsx";
import { MiniBar } from "./components/MiniBar.jsx";
import {
  weeklyLoad, loadTrend, paceTrend, hrEfficiency,
  trainingMonotony, raceReadiness, trainingConsistency, buildTrainingContext,
} from "./core/trainingIntelligence.js";

// ─── Storage ──────────────────────────────────────────────────────────────────
const SK = "vitals-v4";
const DD = { profile:{name:"",goal:"",age:"",height:""}, logs:[], aiInsights:[], labSnapshots:[], clinicalTests:[] };
async function loadData(){ try{ const r=await window.storage.get(SK); return r?JSON.parse(r.value):DD; }catch{ return DD; }}
async function saveData(d){ try{ await window.storage.set(SK,JSON.stringify(d)); }catch{} }

// ─── AI ───────────────────────────────────────────────────────────────────────
const AI_KEY=()=>import.meta.env.VITE_ANTHROPIC_API_KEY||"";
const AI_HDR=()=>({"Content-Type":"application/json","x-api-key":AI_KEY(),"anthropic-version":"2023-06-01","anthropic-dangerous-allow-browser":"true"});

async function ai(system,user,max=1200){
  if(!AI_KEY())return"API key not configured — add VITE_ANTHROPIC_API_KEY to arnold-app/.env";
  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:AI_HDR(),
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:max,system,messages:[{role:"user",content:user}]}),
  });
  if(!r.ok){const e=await r.json().catch(()=>({}));return`API error ${r.status}: ${e.error?.message||"Unknown error"}`;}
  const d=await r.json(); return d.content?.[0]?.text||"No response.";
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
const BM={
  "Glucose (mg/dL)":{cat:"Metabolic",opt:[72,90],warn:[90,100],unit:"mg/dL",dir:"low",lbl:"Fasting Glucose"},
  "HbA1c (%)":{cat:"Metabolic",opt:[4.6,5.3],warn:[5.3,5.7],unit:"%",dir:"low",lbl:"HbA1c"},
  "Insulin (µIU/mL)":{cat:"Metabolic",opt:[2,6],warn:[6,10],unit:"µIU/mL",dir:"low",lbl:"Fasting Insulin"},
  "LDL Cholesterol (mg/dL)":{cat:"Lipids",opt:[40,99],warn:[99,130],unit:"mg/dL",dir:"low",lbl:"LDL"},
  "HDL Cholesterol (mg/dL)":{cat:"Lipids",opt:[60,100],warn:[50,60],unit:"mg/dL",dir:"high",lbl:"HDL"},
  "Triglycerides (mg/dL)":{cat:"Lipids",opt:[40,100],warn:[100,150],unit:"mg/dL",dir:"low",lbl:"Triglycerides"},
  "Total Cholesterol (mg/dL)":{cat:"Lipids",opt:[140,180],warn:[180,200],unit:"mg/dL",dir:"low",lbl:"Total Chol"},
  "ApoB (mg/dL)":{cat:"Lipids",opt:[40,80],warn:[80,100],unit:"mg/dL",dir:"low",lbl:"ApoB"},
  "hsCRP (mg/L)":{cat:"Inflammation",opt:[0,0.5],warn:[0.5,1.0],unit:"mg/L",dir:"low",lbl:"hsCRP"},
  "Ferritin (ng/mL)":{cat:"Inflammation",opt:[50,150],warn:[150,200],unit:"ng/mL",dir:"mid",lbl:"Ferritin"},
  "Testosterone (ng/dL)":{cat:"Hormones",opt:[600,900],warn:[450,600],unit:"ng/dL",dir:"high",lbl:"Testosterone"},
  "Free testosterone (ng/dL)":{cat:"Hormones",opt:[8,15],warn:[6,8],unit:"ng/dL",dir:"high",lbl:"Free T"},
  "Cortisol (µg/dL)":{cat:"Hormones",opt:[8,18],warn:[18,22],unit:"µg/dL",dir:"mid",lbl:"Cortisol"},
  "TSH (µIU/L)":{cat:"Hormones",opt:[1.0,2.5],warn:[2.5,3.5],unit:"µIU/L",dir:"mid",lbl:"TSH"},
  "SHBG (nmol/L)":{cat:"Hormones",opt:[20,55],warn:[55,70],unit:"nmol/L",dir:"mid",lbl:"SHBG"},
  "Testosterone:Cortisol Ratio (Units)":{cat:"Hormones",opt:[50,100],warn:[40,50],unit:"",dir:"high",lbl:"T:C Ratio"},
  "Vitamin D (ng/mL)":{cat:"Nutrients",opt:[50,80],warn:[30,50],unit:"ng/mL",dir:"high",lbl:"Vitamin D"},
  "Vitamin B12 (pg/mL)":{cat:"Nutrients",opt:[500,900],warn:[300,500],unit:"pg/mL",dir:"high",lbl:"B12"},
  "Folate (ng/mL)":{cat:"Nutrients",opt:[10,24],warn:[7,10],unit:"ng/mL",dir:"high",lbl:"Folate"},
  "Magnesium (mg/dL)":{cat:"Nutrients",opt:[2.0,2.5],warn:[1.8,2.0],unit:"mg/dL",dir:"high",lbl:"Magnesium"},
  "RBC Magnesium (mg/dL)":{cat:"Nutrients",opt:[4.2,6.0],warn:[3.5,4.2],unit:"mg/dL",dir:"high",lbl:"RBC Mg"},
  "Iron (ug/dL)":{cat:"Nutrients",opt:[70,140],warn:[50,70],unit:"µg/dL",dir:"mid",lbl:"Iron"},
  "ALT (U/L)":{cat:"Liver",opt:[7,25],warn:[25,40],unit:"U/L",dir:"low",lbl:"ALT"},
  "AST (U/L)":{cat:"Liver",opt:[10,30],warn:[30,40],unit:"U/L",dir:"low",lbl:"AST"},
  "GGT (U/L)":{cat:"Liver",opt:[8,25],warn:[25,40],unit:"U/L",dir:"low",lbl:"GGT"},
  "Albumin (g/dL)":{cat:"Liver",opt:[4.3,5.0],warn:[4.0,4.3],unit:"g/dL",dir:"high",lbl:"Albumin"},
  "Hemoglobin (g/dL)":{cat:"Blood",opt:[13.5,17],warn:[12,13.5],unit:"g/dL",dir:"high",lbl:"Hemoglobin"},
  "Hematocrit (%)":{cat:"Blood",opt:[40,50],warn:[38,40],unit:"%",dir:"mid",lbl:"Hematocrit"},
  "White blood cells (thousands/uL)":{cat:"Blood",opt:[4.0,7.0],warn:[3.5,4.0],unit:"K/µL",dir:"mid",lbl:"WBC"},
  "Platelets (thousands/uL)":{cat:"Blood",opt:[150,300],warn:[130,150],unit:"K/µL",dir:"mid",lbl:"Platelets"},
  "Creatine kinase (U/L)":{cat:"Blood",opt:[40,300],warn:[300,500],unit:"U/L",dir:"mid",lbl:"CK"},
};
const BCATS=["Metabolic","Lipids","Inflammation","Hormones","Nutrients","Liver","Blood"];
const BCAT_CLR={Metabolic:"#60a5fa",Lipids:"#f59e0b",Inflammation:"#f87171",Hormones:"#a78bfa",Nutrients:"#4ade80",Liver:"#fb923c",Blood:"#e879f9"};
const BCAT_ICO={Metabolic:"◈",Lipids:"◉",Inflammation:"⚡",Hormones:"∿",Nutrients:"◆",Liver:"⊕",Blood:"○"};

function bStatus(name,val){
  const m=BM[name]; if(!m||val==null)return"unknown";
  const v=parseFloat(val); const[oL,oH]=m.opt; const[wL,wH]=m.warn;
  if(v>=oL&&v<=oH)return"optimal";
  if(m.dir==="low"){ if(v>wH)return"flag"; if(v>oH)return"warn"; return"optimal"; }
  if(m.dir==="high"){ if(v<wL)return"flag"; if(v<oL)return"warn"; return"optimal"; }
  if(v<wL||v>wH)return"flag"; if(v<oL||v>oH)return"warn"; return"optimal";
}
const SC={optimal:"var(--status-ok)",warn:"var(--status-warn)",flag:"var(--status-danger)",unknown:"var(--text-muted)"};
const SL={optimal:"Optimal",warn:"Monitor",flag:"Review",unknown:"—"};
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
    if(r["deep sleep"]!==undefined){const h=["deep sleep","light sleep","rem sleep"].reduce((s,k)=>{const v=r[k]||"";const p=v.split(":").map(Number);return s+(p[0]||0)+(p[1]||0)/60;},0);mg(d,{sleep:h>0?h.toFixed(2):""});}
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
const td=()=>new Date().toISOString().split("T")[0];
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
  const target=new Date(dateStr);target.setHours(0,0,0,0);
  return Math.round((target-now)/(1000*60*60*24));
}
function raceTypeBadge(distKm){
  const d=parseFloat(distKm);
  if(isNaN(d))return"Other";
  if(d<=5.1)return"5K";if(d<=10.1)return"10K";if(d<=21.2)return"Half";if(d<=42.3)return"Full";return"Ultra";
}

const TABS=[
  {id:"dashboard",label:"Dash",  icon:"◈"},
  {id:"labs",     label:"Labs",  icon:"⬡"},
  {id:"clinical", label:"Body",  icon:"◉"},
  {id:"training", label:"Training",icon:"◈"},
  {id:"log",      label:"Log",   icon:"⊕"},
  {id:"import",   label:"Import",icon:"⇣"},
  {id:"races",    label:"Races", icon:"⚑"},
  {id:"ai",       label:"AI",    icon:"✦"},
  {id:"settings", label:"Profile",icon:"◎"},
];

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════
export default function App(){
  const [tab,setTab]=useState("dashboard");
  const [data,setData]=useState(DD);
  const [loading,setLoading]=useState(true);
  const [aiLoad,setAiLoad]=useState(false);
  const [aiResp,setAiResp]=useState("");
  const [aiQ,setAiQ]=useState("");
  const [aiSummLoad,setAiSummLoad]=useState(false);
  const [aiSummStream,setAiSummStream]=useState("");
  const [toast,setToast]=useState("");

  useEffect(()=>{loadData().then(d=>{
    const needSeed=!d.labSnapshots?.length&&!d.clinicalTests?.length;
    if(needSeed){const s={...d,labSnapshots:SEED_LABS,clinicalTests:SEED_CLINICAL};setData(s);saveData(s);}
    else setData(d);
    setLoading(false);
  });},[]);

  const persist=useCallback(async nd=>{setData(nd);await saveData(nd);},[]);
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),2500);};

  if(loading)return(<div style={S.splash}><div style={S.si}><div style={S.pr}/><span style={S.sl}>⬡</span></div></div>);

  return(
    <div style={S.root}>
      <div style={S.bg}/>
      <header style={S.hdr}>
        <div style={S.hl}><div style={{width:28,height:28,borderRadius:6,background:"var(--accent-dim)",border:"0.5px solid var(--accent-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:600,color:"var(--text-accent)",fontFamily:"var(--font-mono)"}}>A</div><div style={{display:"flex",flexDirection:"column",gap:1}}><div style={S.an}>ARNOLD</div><div style={S.as}>Health Intelligence</div></div></div>
        <div style={S.hr}>{data.profile.name&&<span style={S.un}>{data.profile.name}</span>}<span style={S.dc2}>{td()}</span></div>
      </header>
      <nav style={S.nav}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{...S.nb,...(tab===t.id?S.nba:{})}}><span style={S.ni}>{t.icon}</span><span style={S.nl}>{t.label}</span></button>)}
      </nav>
      <main style={S.main}>
        {tab==="dashboard"&&<Dashboard data={data} setTab={setTab} aiSummLoad={aiSummLoad} aiSummStream={aiSummStream} onAiSum={async()=>{
          if(aiSummLoad)return;
          setAiSummLoad(true);setAiSummStream("");
          try{
            const ins=await aiSummary(data,chunk=>setAiSummStream(chunk));
            await persist({...data,aiInsights:[{date:td(),text:ins},...data.aiInsights.slice(0,4)]});
          }catch(e){setAiSummStream(`Error: ${e.message}`);}
          finally{setAiSummLoad(false);}
        }}/>}
        {tab==="labs"&&<LabsModule data={data} persist={persist} showToast={showToast}/>}
        {tab==="clinical"&&<ClinicalModule data={data} persist={persist} showToast={showToast}/>}
        {tab==="training"&&<TrainingTab setTab={setTab}/>}
        {tab==="log"&&<LogDay data={data} persist={persist} showToast={showToast}/>}
        {tab==="import"&&<ImportHub data={data} persist={persist} showToast={showToast} setTab={setTab}/>}
        {tab==="races"&&<RacesTab showToast={showToast}/>}
        {tab==="ai"&&<AICoach data={data} loading={aiLoad} setLoading={setAiLoad} response={aiResp} setResponse={setAiResp} question={aiQ} setQuestion={setAiQ}/>}
        {tab==="settings"&&<ProfileSettings data={data} persist={persist} showToast={showToast}/>}
      </main>
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
  const latest=tests.reduce((acc,t)=>{
    if(!acc[t.type]||t.date>acc[t.type].date)acc[t.type]=t;
    return acc;
  },{});

  const dexa=latest["dexa"];
  const vo2=latest["vo2max"];
  const rmr=latest["rmr"];

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

  return(
    <div style={S.sec}>
      <div style={S.st}>◉ Body & Fitness</div>
      <div style={S.labNav}>
        {[["overview","Overview"],["dexa","DEXA"],["vo2","VO₂ Max"],["rmr","RMR"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setView(id)} style={{...S.lnb,...(view===id?S.lnba:{})}}>{lbl}</button>
        ))}
      </div>

      {view==="overview"&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {label:"VO₂ Max",value:"51",unit:"ml/kg/min",sub:"98th pct · Elite",color:"#34d399",icon:"◈"},
            {label:"Bio Age",value:"33",unit:"years",sub:"17 yrs younger",color:"#4ade80",icon:"∿"},
            {label:"Body Fat",value:"24.7",unit:"%",sub:"Target: 16.7%",color:"#f59e0b",icon:"⊗"},
            {label:"Lean Mass",value:"134",unit:"lbs",sub:"Target: 138 lbs",color:"#a78bfa",icon:"◆"},
            {label:"RMR",value:"1,880",unit:"kcal",sub:"Fast metabolism",color:"#4ade80",icon:"⬡"},
            {label:"T-Score",value:"2.80",unit:"",sub:"Excellent bone density",color:"#4ade80",icon:"○"},
            {label:"Visceral Fat",value:"1.29",unit:"lbs",sub:"Target: 0.60 lbs",color:"#facc15",icon:"⚡"},
            {label:"ALMI",value:"9.1",unit:"kg/m²",sub:"Target: 9.3",color:"#fb923c",icon:"◉"},
          ].map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.color}40`}}>
              <div style={{fontSize:14,color:c.color,opacity:0.8}}>{c.icon}</div>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"}}>{c.value}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:3}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>{c.label}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.color,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>

        <div style={{background:C.dnb,border:`0.5px solid rgba(248,113,113,0.2)`,borderRadius:"var(--radius-md)",padding:12}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.dn,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Priority Targets · Mar 2025 Baseline</div>
          {[
            ["Body Fat %","24.7% → 16.7%","Reduce 8 percentage points — primarily trunk fat (27.6%)"],
            ["A/G Ratio","1.12 → <1.0","Apple-shaped distribution; reduce abdominal fat preferentially"],
            ["Visceral Fat","1.29 → 0.60 lbs","Needs 53% reduction — key metabolic risk driver"],
            ["Lean Mass","134 → 138 lbs","Add 4 lbs — prioritise resistance training"],
            ["Redline Ratio","89% → 93%+","Train near VT2 (Zone 3) to improve fatigue resistance"],
            ["Spine BMD","37th %ile","Below average — consider loading exercises + calcium/D3 review"],
          ].map(([metric,target,note],i)=>(
            <div key={i} style={{borderBottom:i<5?`0.5px solid rgba(255,255,255,0.06)`:"none",paddingBottom:i<5?8:0,marginBottom:i<5?8:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t,fontWeight:500}}>{metric}</span>
                <span style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.dn}}>{target}</span>
              </div>
              <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m,marginTop:2}}>{note}</div>
            </div>
          ))}
        </div>

        <button style={S.aib} onClick={runAI} disabled={aiRun}><span>✦</span>{aiRun?"Analysing all data…":"Full Cross-Test AI Analysis"}</button>
        {aiText&&!aiRun&&<div style={S.air}><div style={S.aih}>✦ Integrated Clinical Analysis</div><div style={S.ait}>{aiText}</div></div>}
      </>}

      {view==="dexa"&&dexa&&<>
        <div style={{...S.snap,borderColor:"rgba(168,139,250,0.3)"}}>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:"#a78bfa",letterSpacing:"0.1em",textTransform:"uppercase"}}>DEXA Body Composition · {dexa.date}</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m,marginTop:2}}>DexaFit New York City</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {lbl:"Body Score",val:"B",unit:"",note:"Target: A",clr:"#facc15"},
            {lbl:"Total Mass",val:"187",unit:"lbs",note:"Target: 175 lbs",clr:"#f87171"},
            {lbl:"Body Fat",val:"24.7",unit:"%",note:"Target: 16.7%",clr:"#fbbf24"},
            {lbl:"Lean Mass",val:"134",unit:"lbs",note:"Target: 138 lbs",clr:"#facc15"},
            {lbl:"Visceral Fat",val:"1.29",unit:"lbs",note:"Target: 0.60 lbs",clr:"#f87171"},
            {lbl:"T-Score",val:"2.80",unit:"",note:"Excellent",clr:"#4ade80"},
            {lbl:"ALMI",val:"9.1",unit:"kg/m²",note:"Target: 9.3",clr:"#facc15"},
            {lbl:"FFMI",val:"20.2",unit:"kg/m²",note:"Target: 21",clr:"#facc15"},
            {lbl:"A/G Ratio",val:"1.12",unit:"",note:"Want <1.0",clr:"#f87171"},
            {lbl:"Z-Score",val:"2.50",unit:"",note:"Excellent",clr:"#4ade80"},
          ].map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}30`}}>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t}}>{c.val}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>{c.lbl}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.clr,marginTop:1}}>{c.note}</div>
            </div>
          ))}
        </div>
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Regional Body Fat %</div>
          {[["Total","24.7%","Target: 16.7%",0.75],["Trunk","27.6%","Main concern — 3% under peer avg",0.85],["Arms","20.7%","Good — at peer avg",0.55],["Legs","23.2%","4% over peer avg",0.70]].map(([region,val,note,fill],i)=>(
            <div key={i} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t}}>{region}</span><span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t,fontWeight:500}}>{val}</span></div>
              <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}><div style={{height:4,width:`${fill*100}%`,background:fill>0.75?C.dn:C.wn,borderRadius:2}}/></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,marginTop:2}}>{note}</div>
            </div>
          ))}
        </div>
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Bone Mineral Density by Region</div>
          {[["Total Body","1.48 g/cm²","86th %ile","#4ade80"],["Legs","1.61 g/cm²","93rd %ile","#4ade80"],["Head","2.59 g/cm²","73rd %ile","#4ade80"],["Pelvis","1.27 g/cm²","71st %ile","#4ade80"],["Trunk","1.15 g/cm²","64th %ile","#facc15"],["Ribs","0.98 g/cm²","70th %ile","#4ade80"],["Arms","1.11 g/cm²","52nd %ile","#facc15"],["Spine","1.24 g/cm²","37th %ile ⚠","#f87171"]].map(([r,v,p,clr],i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",borderBottom:i<7?`0.5px solid rgba(255,255,255,0.06)`:"none",paddingBottom:6,marginBottom:6}}>
              <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t}}>{r}</span>
              <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:clr}}>{v} · {p}</span>
            </div>
          ))}
        </div>
      </>}

      {view==="vo2"&&vo2&&<>
        <div style={{...S.snap,borderColor:"rgba(96,165,250,0.3)"}}>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:"#60a5fa",letterSpacing:"0.1em",textTransform:"uppercase"}}>VO₂ Max Assessment · {vo2.date}</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m,marginTop:2}}>DexaFit New York City</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          {[{lbl:"VO₂ Max",val:"51",unit:"ml/kg/min",sub:"Elite · 98th %ile",clr:"#60a5fa"},{lbl:"Bio Age",val:"33",unit:"years",sub:"17 yrs younger",clr:"#4ade80"},{lbl:"Redline Ratio",val:"89",unit:"%",sub:"70th %ile · Good",clr:"#facc15"},{lbl:"Lean VO₂ Max",val:"72",unit:"ml/lm·kg",sub:"99th %ile · Elite",clr:"#4ade80"},{lbl:"Leg Lean VO₂",val:"200",unit:"ml/lm·kg",sub:"96th %ile · Elite",clr:"#4ade80"},{lbl:"Max HR",val:"164",unit:"bpm",sub:"58th %ile",clr:"#facc15"}].map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}35`}}>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"}}>{c.val}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.05em"}}>{c.lbl}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.clr,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Your Training Zones</div>
          {[{z:"Zone 4 · Peak",hr:"152–172 bpm",kcal:"1225–1388 kcal/hr",note:"VO₂Max development & HIIT",clr:"#f87171",pct:"20%"},{z:"Zone 3 · High",hr:"138–152 bpm",kcal:"1057–1225 kcal/hr",note:"Tempo — raise Redline Ratio",clr:"#fb923c",pct:"selective"},{z:"Zone 2 · Moderate",hr:"99–138 bpm",kcal:"601–1057 kcal/hr",note:"Fat oxidation & mitochondria",clr:"#60a5fa",pct:"80%"},{z:"Zone 1 · Recovery",hr:"82–99 bpm",kcal:"501–601 kcal/hr",note:"Active recovery & warmup",clr:"#4ade80",pct:""}].map((z,i)=>(
            <div key={i} style={{borderLeft:`3px solid ${z.clr}`,paddingLeft:10,marginBottom:i<3?10:0}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t,fontWeight:500}}>{z.z}</span>{z.pct&&<span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",background:`${z.clr}20`,color:z.clr,padding:"2px 6px",borderRadius:3}}>{z.pct} of training</span>}</div>
              <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:z.clr}}>{z.hr}</div>
              <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>{z.kcal} · {z.note}</div>
            </div>
          ))}
        </div>
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Ventilatory Thresholds</div>
          {[["VT1","110 bpm","Peak fat oxidation — Zone 2 ceiling","#4ade80"],["VT2","154 bpm","Rapid lactate accumulation — Zone 3/4 boundary","#f87171"]].map(([k,v,note,clr],i)=>(
            <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:i<1?8:0}}>
              <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:clr,fontWeight:500,minWidth:36}}>{k}</div>
              <div><div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.t}}>{v}</div><div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>{note}</div></div>
            </div>
          ))}
        </div>
      </>}

      {view==="rmr"&&rmr&&<>
        <div style={{...S.snap,borderColor:"rgba(74,222,128,0.3)"}}>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.ta,letterSpacing:"0.1em",textTransform:"uppercase"}}>Resting Metabolic Rate · {rmr.date}</div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m,marginTop:2}}>DexaFit New York City</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[{lbl:"RMR",val:"1,880",unit:"kcal/day",sub:"Fast (+97 vs predicted)",clr:"#4ade80"},{lbl:"Predicted RMR",val:"1,783",unit:"kcal/day",sub:"Statistical avg for age/body",clr:"#facc15"},{lbl:"RER",val:"0.84",unit:"",sub:"Fat 53% / Carbs 47%",clr:"#60a5fa"},{lbl:"Peer Average",val:"1,915",unit:"kcal/day",sub:"Slightly below peers",clr:"#fb923c"}].map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}35`}}>
              <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"}}>{c.val}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,fontWeight:400,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.06em"}}>{c.lbl}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:c.clr,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.ta,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Resting Fuel Composition (RER 0.84)</div>
          <div style={{height:20,borderRadius:4,overflow:"hidden",display:"flex",marginBottom:6}}>
            <div style={{width:"53%",background:"#60a5fa",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#fff",fontWeight:500}}>Fat 53%</span></div>
            <div style={{width:"47%",background:"#fb923c",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#fff",fontWeight:500}}>Carbs 47%</span></div>
          </div>
          <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>Good metabolic flexibility. RER 0.70 = pure fat; 1.0 = pure carbs. Your 0.84 shows balanced substrate use at rest.</div>
        </div>
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:12}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.ta,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Total Daily Energy Expenditure</div>
          {[["Sedentary","2,256 kcal","1,256–1,756","2,506–2,756"],["Lightly Active","2,585 kcal","1,585–2,085","2,835–3,085"],["Moderately Active","2,914 kcal","1,914–2,414","3,164–3,414"],["Very Active","3,243 kcal","2,243–2,743","3,493–3,743"],["Extremely Active","3,572 kcal","2,572–3,072","3,822–4,072"]].map(([level,tdee,fatLoss,lean],i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1.2fr 0.8fr 1fr 1fr",borderBottom:i<4?`0.5px solid rgba(255,255,255,0.06)`:"none",paddingBottom:5,marginBottom:5,gap:4}}>
              <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.t}}>{level}</div>
              <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.ta,fontWeight:500}}>{tdee}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa"}}>{fatLoss}</div>
              <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa"}}>{lean}</div>
            </div>
          ))}
          <div style={{display:"grid",gridTemplateColumns:"1.2fr 0.8fr 1fr 1fr",marginTop:4}}>
            <div/><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m}}>TDEE</div><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa"}}>Fat Loss</div><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#a78bfa"}}>Lean Gain</div>
          </div>
        </div>
      </>}
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
  const fileRef=useRef();

  const snaps=[...(data.labSnapshots||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const latest=snaps[0]; const prev=snaps[1];

  const sCounts={optimal:0,warn:0,flag:0};
  if(latest)Object.entries(latest.markers).forEach(([n,v])=>{const s=bStatus(n,v);if(sCounts[s]!==undefined)sCounts[s]++;});

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

  return(
    <div style={S.sec}>
      <div style={S.st}>⬡ Blood Panel</div>
      <div style={S.labNav}>
        {[["overview","Overview"],["upload","Upload"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setView(id)} style={{...S.lnb,...(view===id?S.lnba:{})}}>{lbl}</button>
        ))}
      </div>

      {view==="overview"&&<>
        {!latest&&<div style={S.empty}>No lab data. Upload a blood panel CSV.</div>}
        {latest&&<>
          <div style={S.snap}>
            <div><div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,color:C.acc}}>{latest.date}</div><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,marginTop:1}}>{Object.keys(latest.markers).length} markers</div></div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {[["optimal","#4ade80"],[" warn","#facc15"],["flag","#f87171"]].map(([k,clr])=>(
                <div key={k} style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",padding:"2px 7px",borderRadius:10,background:`${clr}18`,border:`0.5px solid ${clr}40`,color:clr}}>{sCounts[k.trim()]} {k.trim()}</div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:0,overflowX:"auto",borderBottom:`0.5px solid ${C.b}`}}>
            {BCATS.map(cat=>(
              <button key={cat} onClick={()=>setSelCat(cat)} style={{background:"none",border:"none",borderBottom:`2px solid ${selCat===cat?BCAT_CLR[cat]:"transparent"}`,color:selCat===cat?BCAT_CLR[cat]:C.m,padding:"6px 9px",cursor:"pointer",fontFamily:"inherit",fontSize:"clamp(10px,0.3vw + 9px,11px)",letterSpacing:"0.06em",whiteSpace:"nowrap",display:"flex",gap:3,alignItems:"center"}}>
                {BCAT_ICO[cat]} {cat}
              </button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(0, 1fr))",gap:7}}>
            {Object.entries(BM).filter(([,m])=>m.cat===selCat).map(([name,meta])=>{
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
                    <div style={{fontSize:10,fontWeight:500,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,marginRight:6}}>{meta.lbl}</div>
                    <div style={{fontSize:10,fontWeight:500,padding:"1px 6px",borderRadius:4,background:SC_BG[stat],color:SC[stat],border:`0.5px solid ${SC_BORDER[stat]}`,letterSpacing:"0.05em",flexShrink:0,whiteSpace:"nowrap"}}>{SL[stat]}</div>
                  </div>
                  <div style={{fontSize:"clamp(18px,1.5vw + 12px,24px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em",lineHeight:1.2}}>{has?val:"—"}<span style={{fontSize:11,color:C.m,fontWeight:400,marginLeft:3}}>{has?meta.unit:""}</span></div>
                  <div style={{fontSize:11,color:C.m,marginTop:3,display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap"}}>
                    <span>{meta.opt[0]}–{meta.opt[1]} {meta.unit}</span>
                    {delta!==null&&<span style={{color:dc(name,delta)}}>{delta>0?"▲":"▼"}{Math.abs(delta).toFixed(1)} from prev</span>}
                  </div>
                  <LabSparkline data={sd} color={SC[stat]} tooltip={tooltip}/>
                </div>
              );
            })}
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
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({data,setTab,onAiSum,aiSummLoad,aiSummStream}){
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
  const profile=storage.get('profile')||{};
  const activities=storage.get('activities')||[];
  const nutrition=storage.get('cronometer')||[];
  const weightData=storage.get('weight')||[];
  const sleepData=storage.get('sleep')||[];
  const hrvData=storage.get('hrv')||[];
  // ── This/last week activities ──
  const thisWeekActs=activities.filter(a=>inWk(a.date,monday,now));
  const lastWeekActs=activities.filter(a=>inWk(a.date,lastMonday,lastSunday));
  const runs=a=>/running|trail/i.test(a.activityType||'');
  const strength=a=>/strength|weight/i.test(a.activityType||'');
  const runCount=thisWeekActs.filter(runs).length;
  const strengthCount=thisWeekActs.filter(strength).length;
  const otherCount=thisWeekActs.filter(a=>!runs(a)&&!strength(a)).length;

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
  const consumedPct=avgConsumed?Math.min(avgConsumed/(parseFloat(profile?.dailyCalorieTarget)||2200),1):0;
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
  const sortedWeight=[...weightData].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const latestW2=sortedWeight[0];
  const prevW2=sortedWeight.find(w=>w.date&&new Date(w.date+'T12:00:00')<monday);
  const currentWeight=latestW2?.weightLbs||null;
  const currentBodyFat=latestW2?.bodyFatPct||null;
  const currentLeanMass=latestW2?.skeletalMuscleMassLbs||null;
  const currentBMI=latestW2?.bmi||null;
  const latestWeightDate=latestW2?.date?new Date(latestW2.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';
  const weightDelta=currentWeight&&prevW2?.weightLbs?parseFloat((currentWeight-prevW2.weightLbs).toFixed(1)):null;
  const bodyFatDelta=currentBodyFat&&prevW2?.bodyFatPct?parseFloat((currentBodyFat-prevW2.bodyFatPct).toFixed(1)):null;
  const leanDelta=currentLeanMass&&prevW2?.skeletalMuscleMassLbs?parseFloat((currentLeanMass-prevW2.skeletalMuscleMassLbs).toFixed(1)):null;
  const bmiDelta=currentBMI&&prevW2?.bmi?parseFloat((currentBMI-prevW2.bmi).toFixed(1)):null;

  // HRV & Sleep
  const thisWeekHRV=hrvData.filter(h=>inWk(h.date,monday,now));
  const lastWeekHRV=hrvData.filter(h=>inWk(h.date,lastMonday,lastSunday));
  const avgHRVv=thisWeekHRV.length?avg2(thisWeekHRV,'overnightHRV'):null;
  const lastAvgHRV=lastWeekHRV.length?avg2(lastWeekHRV,'overnightHRV'):null;
  const hrvDelta=avgHRVv&&lastAvgHRV?Math.round(avgHRVv-lastAvgHRV):null;
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
  const last28=activities.filter(a=>a.date>=d28.toISOString().slice(0,10)).filter(runs);
  const weeklyAvgDist=last28.reduce((s,a)=>s+(a.distanceMi||0),0)/4;
  const d30=new Date(now);d30.setDate(d30.getDate()-30);
  const last30Crono=nutrition.filter(c=>c.date>=d30.toISOString().slice(0,10)&&c.calories);
  const avg30Cal=last30Crono.length?Math.round(last30Crono.reduce((s,c)=>s+(parseFloat(c.calories)||0),0)/last30Crono.length):null;
  const avg30Pro=last30Crono.length?Math.round(last30Crono.reduce((s,c)=>s+(parseFloat(c.protein)||0),0)/last30Crono.length):null;
  const today=td();
  const allRaces=(()=>{try{return JSON.parse(localStorage.getItem('arnold:races')||'[]');}catch{return[];}})();
  const todayDate=new Date();todayDate.setHours(0,0,0,0);
  const cutoff=new Date(todayDate);cutoff.setDate(todayDate.getDate()+90);
  const upRaces=allRaces.filter(r=>{if(!r.date)return false;const d=new Date(r.date);return d>=todayDate&&d<=cutoff;}).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const nextFutureRace=allRaces.filter(r=>r.date&&new Date(r.date)>=todayDate).sort((a,b)=>new Date(a.date)-new Date(b.date))[0];

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

  const panelStyle={background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:'14px 16px'};
  const divider={height:'0.5px',background:C.bs,margin:'10px 0'};
  const subHdr={fontSize:9,fontWeight:500,letterSpacing:'0.07em',color:C.m,textTransform:'uppercase',marginBottom:8};

  return(
    <div style={S.sec}>

      {/* ── Section 1: Weekly Cockpit ── */}
      <div style={{fontSize:13,fontWeight:500,color:C.m,marginBottom:8}}>◈ Week of {weekLabel}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(0, 1fr))',gap:'clamp(8px,1vw,12px)',marginBottom:10}}>

        {/* ── TRAINING ── */}
        <div style={panelStyle}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <span style={{fontSize:15,fontWeight:500,color:C.t}}>Training</span>
            <span style={{fontSize:10,color:C.m}}>vs last week</span>
          </div>
          <div style={{display:'flex',gap:5,marginBottom:12,flexWrap:'wrap'}}>
            <span style={{fontSize:9,fontWeight:500,padding:'2px 8px',borderRadius:10,background:'rgba(96,165,250,0.12)',color:'#60a5fa'}}>{runCount} run{runCount!==1?'s':''}</span>
            {strengthCount>0&&<span style={{fontSize:9,fontWeight:500,padding:'2px 8px',borderRadius:10,background:'rgba(167,139,250,0.12)',color:'#a78bfa'}}>{strengthCount} strength</span>}
            {otherCount>0&&<span style={{fontSize:9,fontWeight:500,padding:'2px 8px',borderRadius:10,background:'rgba(156,163,175,0.12)',color:'#9ca3af'}}>{otherCount} other</span>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2, minmax(0,1fr))',gap:8,marginBottom:12}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
              <ArcDial value={weekMi} max={parseFloat(profile?.weeklyRunDistanceTarget)||20} size={68} color="#60a5fa" label="mi" sublabel={weekMi?.toFixed(1)||'—'}/>
              <div style={{fontSize:9,color:C.m,marginTop:2,textAlign:'center'}}>Weekly miles <TrendBadge delta={miDelta} unit=" mi"/></div>
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
              <ArcDial value={weekMins} max={300} size={68} color="#a78bfa" label="time" sublabel={formatDuration(weekMins)}/>
              <div style={{fontSize:9,color:C.m,marginTop:2,textAlign:'center'}}>Active time <TrendBadge delta={timeDelta} unit="m"/></div>
            </div>
          </div>
          <div style={divider}/>
          <div style={subHdr}>Run metrics</div>
          <MiniBar label="Avg pace" displayValue={avgPace||'—'} delta={paceDeltaSecs} deltaUnit="s" goal={profile?.targetRacePace} goalLabel={`Goal ${profile?.targetRacePace||'not set'} /mi`} pct={pacePct} inverted/>
          <MiniBar label="Avg HR" displayValue={avgHR?`${avgHR} bpm`:'—'} delta={hrDelta} deltaUnit=" bpm" goalLabel="Zone 2 target" pct={hrPct}/>
          <MiniBar label="Elevation gain" displayValue={weekAscent?`${weekAscent.toLocaleString()} ft`:'—'} delta={ascentDelta} deltaUnit=" ft" pct={0.6}/>
          <div style={divider}/>
          <div style={subHdr}>Strength</div>
          <MiniBar label="Sessions" displayValue={`${strengthCount}`} delta={strengthDelta} deltaUnit="" goalLabel={`Goal ${profile?.weeklyStrengthTarget||2}/week`} pct={strengthCount/(parseFloat(profile?.weeklyStrengthTarget)||2)}/>
          <MiniBar label="Calories burned" displayValue={weekCals?`${weekCals.toLocaleString()} kcal`:'—'} delta={calsDelta} deltaUnit=" kcal" pct={0.65}/>
        </div>

        {/* ── NUTRITION ── */}
        <div style={panelStyle}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <span style={{fontSize:15,fontWeight:500,color:C.t}}>Nutrition</span>
            <span style={{fontSize:10,color:C.m}}>vs last week</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
            <svg width="72" height="72" viewBox="0 0 72 72" style={{flexShrink:0}}>
              <circle cx="36" cy="36" r="28" fill="none" stroke="var(--bg-input)" strokeWidth="6"/>
              <circle cx="36" cy="36" r="28" fill="none" stroke="#4ade80" strokeWidth="6" strokeDasharray={`${Math.min(consumedPct,1)*176} 176`} strokeDashoffset="44" strokeLinecap="round"/>
              <circle cx="36" cy="36" r="28" fill="none" stroke="#60a5fa" strokeWidth="6" strokeDasharray={`${Math.min(burnedPct,1)*176} 176`} strokeDashoffset={-(consumedPct*176-44)} strokeLinecap="round" opacity="0.7"/>
              <text x="36" y="32" textAnchor="middle" fontSize="8" fill="var(--text-muted)" style={{fontFamily:'var(--font-ui)'}}>net</text>
              <text x="36" y="44" textAnchor="middle" fontSize="12" fontWeight="500" fill="var(--text-primary)" style={{fontFamily:'var(--font-ui)'}}>{netCalories!=null?(netCalories>0?'+':'')+netCalories:'—'}</text>
              <text x="36" y="54" textAnchor="middle" fontSize="8" fill="var(--text-muted)" style={{fontFamily:'var(--font-ui)'}}>kcal/day</text>
            </svg>
            <div style={{flex:1}}>
              <div style={{fontSize:9,color:C.m,marginBottom:4}}>7-day avg</div>
              <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:3}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#4ade80',flexShrink:0}}/>
                <span style={{fontSize:10,color:C.s}}>Consumed</span>
                <span style={{fontSize:11,fontWeight:500,color:C.t,marginLeft:'auto'}}>{avgConsumed?avgConsumed.toLocaleString():'—'}</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:4}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#60a5fa',opacity:0.8,flexShrink:0}}/>
                <span style={{fontSize:10,color:C.s}}>Burned</span>
                <span style={{fontSize:11,fontWeight:500,color:C.t,marginLeft:'auto'}}>{avgBurned?avgBurned.toLocaleString():'—'}</span>
              </div>
              {netCalories!=null&&<div style={{fontSize:9,color:netCalories<0?'#4ade80':'#f87171'}}>{netCalories<0?`↓ ${Math.abs(netCalories)} deficit`:`↑ ${netCalories} surplus`}</div>}
            </div>
          </div>
          <div style={divider}/>
          <div style={subHdr}>Macros · daily avg vs goal</div>
          <MiniBar label="Protein" displayValue={`${Math.round(avgProtein||0)}g`} delta={proteinDelta} deltaUnit="g" goalLabel={`Goal ${profile?.dailyProteinTarget||150}g`} pct={(avgProtein||0)/(parseFloat(profile?.dailyProteinTarget)||150)}/>
          <MiniBar label="Carbs" displayValue={`${Math.round(avgCarbs||0)}g`} delta={carbsDelta} deltaUnit="g" goalLabel={`Goal ${profile?.dailyCarbTarget||180}g`} pct={(avgCarbs||0)/(parseFloat(profile?.dailyCarbTarget)||180)}/>
          <MiniBar label="Fat" displayValue={`${Math.round(avgFat||0)}g`} delta={fatDelta} deltaUnit="g" goalLabel={`Goal ${profile?.dailyFatTarget||65}g`} pct={(avgFat||0)/(parseFloat(profile?.dailyFatTarget)||65)}/>
          <div style={divider}/>
          <div style={subHdr}>Micronutrients</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(0,1fr))',gap:5}}>
            {[{label:'Sodium',val:avgSodium?`${(avgSodium/1000).toFixed(1)}g`:'—',color:C.t},{label:'Potassium',val:avgPotassium?`${(avgPotassium/1000).toFixed(1)}g`:'—',color:C.t},{label:'Magnesium',val:avgMagnesium?`${Math.round(avgMagnesium)}mg`:'—',color:avgMagnesium&&avgMagnesium<300?'#fbbf24':C.t}].map(m=>(
              <div key={m.label} style={{background:C.elev,borderRadius:6,padding:'5px 7px',textAlign:'center'}}>
                <div style={{fontSize:12,fontWeight:500,color:m.color}}>{m.val}</div>
                <div style={{fontSize:8,color:C.m}}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── BODY ── */}
        <div style={panelStyle}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <span style={{fontSize:15,fontWeight:500,color:C.t}}>Body</span>
            <span style={{fontSize:10,color:C.m}}>vs last week</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
            <ArcDial value={profile?.targetWeight&&currentWeight?Math.max(0,currentWeight-parseFloat(profile.targetWeight)):15} max={30} size={72} color="#fbbf24" label="lbs" sublabel={currentWeight?Math.round(currentWeight):'—'}/>
            <div style={{flex:1}}>
              <div style={{fontSize:9,color:C.m,marginBottom:2}}>Latest · {latestWeightDate}</div>
              <div style={{fontSize:22,fontWeight:500,color:C.t,lineHeight:1}}>{currentWeight?.toFixed(1)||'—'}</div>
              <div style={{fontSize:10,color:weightDelta!=null?(weightDelta<0?'#4ade80':'#f87171'):C.m,marginTop:2}}>{weightDelta!=null?`${weightDelta>0?'↑':'↓'} ${Math.abs(weightDelta).toFixed(1)} lbs this week`:'—'}</div>
              <div style={{fontSize:9,color:C.m,marginTop:1}}>Target {profile?.targetWeight||'—'} lbs{currentWeight&&profile?.targetWeight?` · ${(currentWeight-parseFloat(profile.targetWeight)).toFixed(1)} to go`:''}</div>
            </div>
          </div>
          <div style={divider}/>
          <div style={subHdr}>Composition</div>
          <MiniBar label="Body fat" displayValue={`${currentBodyFat?.toFixed(1)||'—'}%`} delta={bodyFatDelta} deltaUnit="%" inverted goalLabel={`Target ${profile?.targetBodyFat||16.7}%`} pct={currentBodyFat?Math.max(0,1-(currentBodyFat-(parseFloat(profile?.targetBodyFat)||16.7))/15):0}/>
          <MiniBar label="Lean mass" displayValue={`${currentLeanMass?.toFixed(1)||'—'} lbs`} delta={leanDelta} deltaUnit=" lbs" goalLabel={`Target ${profile?.targetLeanMass||138} lbs`} pct={currentLeanMass?currentLeanMass/(parseFloat(profile?.targetLeanMass)||138):0}/>
          <MiniBar label="BMI" displayValue={`${currentBMI?.toFixed(1)||'—'}`} delta={bmiDelta} deltaUnit="" inverted pct={currentBMI?Math.max(0,1-(currentBMI-22)/10):0}/>
          <div style={divider}/>
          <div style={subHdr}>Recovery</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(0,1fr))',gap:5}}>
            {[{label:'HRV avg',val:avgHRVv?`${Math.round(avgHRVv)}ms`:'—',delta:hrvDelta,positive:hrvDelta>0},{label:'Avg sleep',val:avgSleepMins?formatDuration(avgSleepMins):'—',delta:sleepDelta,positive:sleepDelta>0},{label:'Sleep score',val:avgSleepScore?`${Math.round(avgSleepScore)}/100`:'—',delta:scoreDelta,positive:scoreDelta>0}].map(m=>(
              <div key={m.label} style={{background:C.elev,borderRadius:6,padding:'6px 7px',textAlign:'center'}}>
                <div style={{fontSize:13,fontWeight:500,color:C.t}}>{m.val}</div>
                <div style={{fontSize:8,color:C.m}}>{m.label}</div>
                {m.delta!=null&&<div style={{fontSize:8,color:m.positive?'#4ade80':'#f87171',marginTop:1}}>{m.positive?'↑':'↓'} {Math.abs(m.delta)}</div>}
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Section 2: AI Weekly Summary ── */}
      <button style={{...S.aib,...(aiSummLoad?{opacity:0.7,cursor:"not-allowed"}:{})}} onClick={onAiSum} disabled={aiSummLoad}>
        <span style={aiSummLoad?{display:"inline-block",animation:"arnoldSpin 1s linear infinite"}:{}}>{aiSummLoad?"◌":"✦"}</span>
        {aiSummLoad?"Generating Summary…":"Generate AI Weekly Summary"}
      </button>
      {(aiSummLoad||aiSummStream)&&(
        <div style={S.aisp}>
          <div style={S.aish}>
            <span style={{color:C.acc,fontSize:"clamp(12px,0.5vw + 10px,14px)"}}>✦</span>
            <span>ARNOLD · Weekly Summary</span>
            {aiSummLoad&&<span style={{marginLeft:"auto",color:C.m,fontSize:"clamp(10px,0.3vw + 9px,11px)",letterSpacing:"0.05em"}}>streaming…</span>}
          </div>
          {aiSummStream?<div style={S.aist}>{aiSummStream}</div>:<div style={{display:"flex",gap:5,padding:"10px 0",alignItems:"center"}}>{[0,1,2].map(i=><span key={i} style={{width:5,height:5,borderRadius:"50%",background:C.acc,display:"inline-block",opacity:0.4+i*0.3}}/>)}</div>}
        </div>
      )}
      {!aiSummLoad&&!aiSummStream&&data.aiInsights[0]&&<div style={S.ip}><div style={S.ih}>Last Analysis · {data.aiInsights[0].date}</div><div style={S.it2}>{data.aiInsights[0].text.slice(0,220)}…</div></div>}

      {/* ── Section 3: Annual Progress & Upcoming Races ── */}
      <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(14px,1.5vw,20px)"}}>
        <div style={{fontSize:10,fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",marginBottom:14}}>⚑ Annual Progress · {yearStr}</div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:"clamp(10px,1vw,16px)"}}>
          <div>
            <ProgBar label="Annual run distance" actual={Math.round(yearDist)} target={parseFloat(profile.annualRunDistanceTarget)||800} unit="mi"/>
            <ProgBar label="Annual workouts" actual={yearWorkouts} target={parseFloat(profile.annualWorkoutsTarget)||200} unit="sessions"/>
            <ProgBar label="Avg weekly distance" actual={Math.round(weeklyAvgDist*10)/10} target={parseFloat(profile.weeklyRunDistanceTarget)||20} unit="mi"/>
            {avg30Cal!=null&&<ProgBar label="Avg daily calories" actual={avg30Cal} target={parseFloat(profile.dailyCalorieTarget)||2200} unit="kcal"/>}
            {avg30Pro!=null&&<ProgBar label="Avg daily protein" actual={avg30Pro} target={parseFloat(profile.dailyProteinTarget)||150} unit="g"/>}
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",marginBottom:10}}>⚑ Next Races</div>
            {upRaces.length>0?upRaces.map((r,i)=>(
              <div key={i} style={{marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:13,fontWeight:500,color:C.t}}>{r.name||"Race"}</span>
                  {r.source==='garmin-ics'&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(74,222,128,0.12)",color:"#4ade80"}}>Garmin</span>}
                </div>
                <div style={{fontSize:11,color:C.m}}>{new Date(r.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · {daysUntil(r.date)} days away</div>
                {(r.goalTime||r.goal_time||r.distanceKm||r.distance_km)&&<div style={{fontSize:11,color:C.m}}>{(r.goalTime||r.goal_time)?`Goal: ${r.goalTime||r.goal_time}`:""}{(r.distanceKm||r.distance_km)?` · ${r.distanceKm||r.distance_km} km`:""}</div>}
              </div>
            )):allRaces.length>0?<div style={{fontSize:12,color:C.m}}>No races in the next 90 days{nextFutureRace?<span> · Next: <span style={{color:C.t}}>{nextFutureRace.name}</span></span>:""}<div style={{cursor:"pointer",color:C.ta,marginTop:4}} onClick={()=>setTab("races")}>See all races →</div></div>:<div style={{fontSize:12,color:C.m,cursor:"pointer"}} onClick={()=>setTab("races")}>Sync your Garmin calendar in the Races tab →</div>}
          </div>
        </div>
      </div>

      {/* ── Section 4: Body & Fitness Baseline ── */}
      <div style={{background:"rgba(96,165,250,0.06)",border:"0.5px solid rgba(96,165,250,0.2)",borderRadius:"var(--radius-md)",padding:12,cursor:"pointer"}} onClick={()=>setTab("clinical")}>
        <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>◉ Body & Fitness Baseline · Mar 2025</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
          {[["VO₂ Max","51","#34d399"],["Bio Age","33y","#4ade80"],["Body Fat","24.7%","#fbbf24"],["RMR","1,880","#facc15"]].map(([l,v,c],i)=>(
            <div key={i} style={{textAlign:"center"}}><div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:c}}>{v}</div><div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase"}}>{l}</div></div>
          ))}
        </div>
      </div>

      {/* ── Section 5: Principles Score ── */}
      <PrinciplesPanel data={data}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOG TODAY + WORKOUT LOG
// ═══════════════════════════════════════════════════════════════════════════════
function LogDay({data,persist,showToast}){
  const ts=td(),ex=data.logs.find(l=>l.date===ts);
  const[f,sf]=useState({date:ts,weight:ex?.weight||"",bodyFat:ex?.bodyFat||"",sleep:ex?.sleep||"",sleepQuality:ex?.sleepQuality||"",hrv:ex?.hrv||"",hrvStatus:ex?.hrvStatus||"",calories:ex?.calories||"",protein:ex?.protein||"",carbs:ex?.carbs||"",fat:ex?.fat||"",workout:ex?.workout||"",workoutDuration:ex?.workoutDuration||"",steps:ex?.steps||"",heartRate:ex?.heartRate||"",notes:ex?.notes||""});
  const set=k=>e=>sf(p=>({...p,[k]:e.target.value}));
  const save=async()=>{const cl=Object.fromEntries(Object.entries(f).filter(([,v])=>v!==""));await persist({...data,logs:[cl,...data.logs.filter(l=>l.date!==ts)]});showToast("✓ Entry saved");};
  const F=({label,field,type="number",placeholder="",unit=""})=>(<div style={S.field}><label style={S.fl}>{label}{unit&&<span style={{color:C.m,fontSize:"clamp(10px,0.3vw + 9px,11px)"}}> {unit}</span>}</label><input type={type} value={f[field]} onChange={set(field)} placeholder={placeholder} style={S.inp}/></div>);

  return(
    <div style={S.sec}>
      <div style={S.st}>Log · {ts}</div>

      {/* ── Workout Log — top of tab ── */}
      <WorkoutLog showToast={showToast}/>

      {/* ── Daily Log sections ── */}
      {ex&&<div style={S.eb}>Editing today's entry</div>}
      <div style={S.lg}><div style={S.gt}>⊗ Body</div><div style={S.fr}><F label="Weight" field="weight" unit="kg"/><F label="Body Fat" field="bodyFat" unit="%"/></div></div>
      <div style={S.lg}><div style={S.gt}>◑ Sleep</div><div style={S.fr}><F label="Hours" field="sleep" unit="h"/><div style={S.field}><label style={S.fl}>Quality</label><select value={f.sleepQuality} onChange={set("sleepQuality")} style={S.inp}>{Q.map(q=><option key={q} value={q==="—"?"":q}>{q}</option>)}</select></div></div></div>
      <div style={S.lg}><div style={S.gt}>∿ HRV</div><div style={S.fr}><F label="Score" field="hrv" placeholder="ms"/><div style={S.field}><label style={S.fl}>Status</label><select value={f.hrvStatus} onChange={set("hrvStatus")} style={S.inp}><option value="">—</option>{Object.entries(HRV_L).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div></div></div>
      <div style={S.lg}><div style={S.gt}>◆ Nutrition</div><div style={S.fr}><F label="Calories" field="calories" unit="kcal"/><F label="Protein" field="protein" unit="g"/></div><div style={S.fr}><F label="Carbs" field="carbs" unit="g"/><F label="Fat" field="fat" unit="g"/></div></div>
      <div style={S.lg}><div style={S.gt}>◉ Activity</div><div style={S.fr}><div style={S.field}><label style={S.fl}>Workout</label><input type="text" value={f.workout} onChange={set("workout")} placeholder="Running, Weights…" style={S.inp}/></div><F label="Duration" field="workoutDuration" unit="min"/></div><div style={S.fr}><F label="Steps" field="steps"/><F label="Heart Rate" field="heartRate" unit="bpm"/></div></div>
      <div style={S.lg}><div style={S.gt}>◎ Notes</div><textarea value={f.notes} onChange={set("notes")} placeholder="How do you feel?" style={S.ta}/></div>
      <button style={S.sb} onClick={save}>Save Daily Entry</button>
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
    try{
      const parsed=await parseRunPDF(file);
      applyParsed(parsed,'pdf',file.name);
    }catch(e){
      setImportStatus({level:'warn',msg:'Could not parse PDF — please fill fields manually.'});
      setImportSource({type:'pdf',filename:file.name});
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
                accept=".pdf" label="Drop Garmin PDF" sublabel="or click to browse"
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
    await saveGarminActivities(merged);
    storage.set('activities',merged);
    // Also save to legacy garmin store for Training tab compatibility
    const runRows=rows.filter(r=>/running|trail/i.test(r.activityType||''));
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
    const text=await file.text();
    const type=forceType||detectCSVType(text,file.name);
    if(!type){showToast("⚠ Could not detect CSV type");return;}
    const typeLbl={activities:'Activities',hrv:'HRV Status',sleep:'Sleep',weight:'Weight',cronometer:'Cronometer'}[type]||type;
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
    const files=Array.from(e.dataTransfer.files).filter(f=>f.name.endsWith('.csv'));
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
          border:`0.5px ${loaded?"solid":"dashed"} ${loaded?color:"var(--border-default)"}`,
          background:loaded?`${color}10`:"var(--bg-input)",
          borderRadius:"var(--radius-md)",minHeight:120,
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,
          cursor:loaded?"default":"pointer",transition:"all var(--transition)",padding:12,
        }}
      >
        <input ref={ref} type="file" accept=".csv" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0];if(f)handleFile(f,id);e.target.value="";}}/>
        {loading&&<div style={{fontSize:12,color:C.m}}>Parsing…</div>}
        {!loaded&&!loading&&<>
          <span style={{fontSize:22,color,opacity:0.7}}>{icon}</span>
          <span style={{fontSize:12,fontWeight:500,color:C.t}}>Drop {label}.csv</span>
          <span style={{fontSize:10,color:C.m}}>or click to browse</span>
        </>}
        {loaded&&<>
          <span style={{fontSize:18,color}}>✓</span>
          <span style={{fontSize:11,color,fontWeight:500,wordBreak:"break-all",textAlign:"center"}}>{z.file}</span>
          <span style={{fontSize:10,color:C.m}}>{z.count} rows parsed</span>
        </>}
      </div>
    );
  };

  return(
    <div style={S.sec}>
      <div style={S.st}>⇣ Import Hub</div>

      {/* Master drop zone */}
      <div
        onDragOver={e=>e.preventDefault()}
        onDrop={handleMultiDrop}
        onClick={()=>masterRef.current?.click()}
        style={{
          border:`0.5px dashed var(--border-default)`,background:"var(--bg-input)",
          borderRadius:"var(--radius-md)",padding:"18px 12px",
          display:"flex",flexDirection:"column",alignItems:"center",gap:6,cursor:"pointer",
        }}
      >
        <input ref={masterRef} type="file" accept=".csv" multiple style={{display:"none"}}
          onChange={async e=>{for(const f of Array.from(e.target.files))await handleFile(f,null);e.target.value="";}}/>
        <span style={{fontSize:26,color:C.acc}}>⇡</span>
        <span style={{fontSize:13,fontWeight:500,color:C.t}}>Drop all files here</span>
        <span style={{fontSize:11,color:C.m}}>Auto-detects Activities, HRV, Sleep, Weight, or Cronometer CSV</span>
      </div>

      {/* Detection banners */}
      {Object.entries(banners).filter(([,v])=>v).map(([k,msg])=>(
        <div key={k} style={{padding:"7px 12px",borderRadius:"var(--radius-sm)",background:"var(--status-ok-bg)",border:"0.5px solid rgba(74,222,128,0.3)",color:"var(--status-ok)",fontSize:12}}>✓ {msg}</div>
      ))}

      {/* 2×2 Garmin zones */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {IMPORT_ZONES.map(z=><DZ key={z.id} {...z}/>)}
      </div>

      {/* Cronometer zone */}
      <DZ id="cronometer" label="Cronometer" icon="◆" color="#f59e0b"/>

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
// TRAINING TAB
// ═══════════════════════════════════════════════════════════════════════════════
function TrainingTab({setTab}){
  const[activities,setActivities]=useState([]);
  const[races,setRacesData]=useState([]);
  const[loading,setLoading]=useState(true);
  const[expanded,setExpanded]=useState(null);

  useEffect(()=>{
    Promise.all([getGarmin(),getRaces()]).then(([g,r])=>{
      setActivities(g.filter(a=>a.source==='garmin-csv'));
      setRacesData(r);
      setLoading(false);
    });
  },[]);

  if(loading)return<div style={S.sec}><div style={S.st}>◈ Training</div><div style={{color:C.m,padding:20,textAlign:"center"}}>Loading…</div></div>;

  if(!activities.length)return(
    <div style={S.sec}>
      <div style={S.st}>◈ Training</div>
      <div style={{...S.empty,display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
        <div style={{fontSize:"clamp(13px,0.8vw + 9px,16px)",color:C.t}}>No training data yet.</div>
        <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>Import your Garmin CSV in the Import tab to unlock training analysis.</div>
        <button style={{...S.sb,width:"auto",padding:"10px 24px"}} onClick={()=>setTab("import")}>Go to Import →</button>
      </div>
    </div>
  );

  const lt=loadTrend(activities);
  const pt=paceTrend(activities);
  const hre=hrEfficiency(activities);
  const cons=trainingConsistency(activities,30);
  const mono=trainingMonotony(activities);

  // Find longest run in last 30 days
  const now=new Date();const d30=new Date(now);d30.setDate(d30.getDate()-30);
  const recent30=activities.filter(a=>a.date>=d30.toISOString().slice(0,10));
  const longestRun=recent30.reduce((mx,a)=>Math.max(mx,a.distanceKm||0),0);

  // Upcoming races
  const todayStr=new Date().toISOString().slice(0,10);
  const upcomingRaces=races.filter(r=>r.date>=todayStr).sort((a,b)=>a.date.localeCompare(b.date));

  // Chart: max km for scaling
  const weekKms=lt.weeklyLoads.map(w=>w.totalKm);
  const maxKm=Math.max(...weekKms,1);

  return(
    <div style={S.sec}>
      <div style={S.st}>◈ Training Intelligence</div>

      {/* Section 1: Training Load — 4 week bar chart */}
      <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase"}}>Training Load · Last 4 Weeks</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t}}>{weekKms[0].toFixed(1)} km</span>
            <span style={{fontSize:"clamp(14px,1vw + 10px,18px)",color:lt.direction==='increasing'?C.ta:lt.direction==='decreasing'?C.dn:C.m}}>
              {lt.direction==='increasing'?'↑':lt.direction==='decreasing'?'↓':'→'}
            </span>
          </div>
        </div>

        {/* SVG Bar Chart */}
        <svg viewBox="0 0 300 100" style={{width:"100%",height:"auto",maxHeight:120}}>
          {[...weekKms].reverse().map((km,i)=>{
            const barW=55;const gap=20;const x=i*(barW+gap)+15;
            const h=maxKm>0?Math.max(2,(km/maxKm)*75):2;
            const y=85-h;
            const isThis=i===3;
            return(<g key={i}>
              <rect x={x} y={y} width={barW} height={h} rx={3} fill={isThis?"var(--accent)":"rgba(74,222,128,0.3)"}/>
              <text x={x+barW/2} y={y-4} textAnchor="middle" fontSize="9" fill="var(--text-muted)">{km.toFixed(1)}</text>
              <text x={x+barW/2} y={96} textAnchor="middle" fontSize="8" fill="var(--text-muted)">{i===3?"This wk":`${3-i}w ago`}</text>
            </g>);
          })}
        </svg>

        <div style={{fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.s,marginTop:8}}>{lt.recommendation}</div>
      </div>

      {/* Section 2: Key Metrics — 4 cards */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div style={S.sc2}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.06em"}}>Avg Pace Trend</div>
          <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t}}>{pt.avgPaceLastMonth||"—"}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,marginLeft:3}}>/km</span></div>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:pt.trend==='improving'?C.ta:pt.trend==='declining'?C.dn:C.m}}>
            {pt.trend==='improving'?`↑ ${Math.abs(pt.deltaSeconds)}s faster`:pt.trend==='declining'?`↓ ${pt.deltaSeconds}s slower`:'→ Stable'} vs last month
          </div>
        </div>
        <div style={S.sc2}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.06em"}}>HR Efficiency</div>
          <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t}}>{hre.current||"—"}</div>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:hre.trend==='improving'?C.ta:hre.trend==='declining'?C.dn:C.m}}>
            {hre.trend==='improving'?'↑ Improving':hre.trend==='declining'?'↓ Declining':'→ Stable'}
          </div>
        </div>
        <div style={S.sc2}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.06em"}}>Longest Run (30d)</div>
          <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t}}>{longestRun>0?longestRun.toFixed(1):"—"}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,marginLeft:3}}>km</span></div>
        </div>
        <div style={S.sc2}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,textTransform:"uppercase",letterSpacing:"0.06em"}}>Consistency (30d)</div>
          <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t}}>{cons.consistencyPct}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m,marginLeft:3}}>%</span></div>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m}}>{cons.activeDays} active / {cons.restDays} rest · streak {cons.currentStreak}d</div>
        </div>
      </div>

      {/* Section 3: Race Readiness */}
      {upcomingRaces.length>0&&(
        <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
          <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",marginBottom:10}}>Race Readiness</div>
          {upcomingRaces.slice(0,3).map((race,i)=>{
            const rr=raceReadiness(activities,race.distanceKm||42.2,race.date);
            const barClr=rr.score>=75?C.ta:rr.score>=40?C.wn:C.dn;
            const statusClr=rr.status==='ready'?"rgba(74,222,128,0.15)":rr.status==='building'?"rgba(245,158,11,0.15)":"rgba(248,113,113,0.15)";
            const statusTxt=rr.status==='ready'?"Ready":rr.status==='building'?"Building":"Undertrained";
            return(
              <div key={i} style={{marginBottom:i<upcomingRaces.length-1?14:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div>
                    <span style={{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.t,fontWeight:500}}>{race.name||"Race"}</span>
                    <span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m,marginLeft:8}}>{race.date} · {rr.daysUntil}d away</span>
                  </div>
                  <span style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",padding:"2px 8px",borderRadius:4,background:statusClr,color:barClr}}>{statusTxt}</span>
                </div>
                {/* Score bar */}
                <div style={{height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,marginBottom:6}}>
                  <div style={{height:6,width:`${rr.score}%`,background:barClr,borderRadius:3,transition:"width 0.3s"}}/>
                </div>
                <div style={{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:barClr,marginBottom:4}}>{rr.score}<span style={{fontSize:"clamp(10px,0.4vw + 8px,12px)",color:C.m}}>/100</span></div>
                {rr.gaps.slice(0,2).map((g,gi)=>(
                  <div key={gi} style={{fontSize:"clamp(11px,0.4vw + 9px,12px)",color:C.m,paddingLeft:8,borderLeft:`2px solid ${barClr}40`,marginBottom:3}}>{g}</div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Section 4: Activity Feed */}
      <div style={{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"}}>
        <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",marginBottom:10}}>Recent Runs</div>
        <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:400,overflowY:"auto"}}>
          {activities.slice(0,20).map((a,i)=>(
            <div key={i} style={{border:`0.5px solid ${C.bs}`,borderRadius:"var(--radius-sm)",overflow:"hidden",cursor:"pointer"}} onClick={()=>setExpanded(e=>e===i?null:i)}>
              <div style={{display:"grid",gridTemplateColumns:"80px 1fr 60px 55px 50px 50px",gap:6,alignItems:"center",padding:"7px 10px",fontSize:"clamp(11px,0.4vw + 9px,12px)"}}>
                <span style={{color:C.m,fontFamily:"var(--font-mono)",fontSize:10}}>{a.date}</span>
                <span style={{color:C.t,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.distanceKm?`${a.distanceKm} km`:""}</span>
                <span style={{color:C.ta}}>{a.avgPacePerKm||"—"}</span>
                <span style={{color:C.m}}>{a.avgHR?`${a.avgHR}♡`:""}</span>
                <span style={{color:C.m}}>{a.durationFormatted||""}</span>
                <span style={{color:C.m,fontSize:10}}>{a.calories?`${a.calories}cal`:""}</span>
              </div>
              {expanded===i&&(
                <div style={{padding:"0 10px 10px",borderTop:`0.5px solid ${C.bs}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.m}}>
                  {a.title&&<div>Title: <span style={{color:C.t}}>{a.title}</span></div>}
                  {a.activityType&&<div>Type: <span style={{color:C.t}}>{a.activityType}</span></div>}
                  {a.maxHR&&<div>Max HR: <span style={{color:C.t}}>{a.maxHR}</span></div>}
                  {a.avgCadence&&<div>Cadence: <span style={{color:C.t}}>{a.avgCadence} spm</span></div>}
                  {a.totalAscentM!=null&&<div>Ascent: <span style={{color:C.t}}>{a.totalAscentM}m</span></div>}
                  {a.totalDescentM!=null&&<div>Descent: <span style={{color:C.t}}>{a.totalDescentM}m</span></div>}
                  {a.avgStrideLength&&<div>Stride: <span style={{color:C.t}}>{a.avgStrideLength}m</span></div>}
                  {a.aerobicTE&&<div>Aerobic TE: <span style={{color:C.t}}>{a.aerobicTE}</span></div>}
                  {a.bestPacePerKm&&<div>Best pace: <span style={{color:C.t}}>{a.bestPacePerKm}/km</span></div>}
                  {a.distanceMi&&<div>Distance: <span style={{color:C.t}}>{a.distanceMi} mi</span></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RACES TAB
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Race helpers (shared by RacesTab + RaceList) ────────────────────────────
function getMilestones(raceDate){
  const rd=new Date(raceDate);rd.setHours(0,0,0,0);
  const now2=new Date();now2.setHours(0,0,0,0);
  return[
    {weeks:12,label:"Base building complete"},
    {weeks:8, label:"Peak training begins"},
    {weeks:4, label:"Taper starts"},
    {weeks:1, label:"Race week — reduce intensity"},
  ].map(m=>{
    const mDate=new Date(rd);mDate.setDate(mDate.getDate()-m.weeks*7);
    return{...m,date:mDate.toISOString().split("T")[0],passed:now2>=mDate};
  });
}
function getTrainingProgress(raceDate){
  const rd=new Date(raceDate);rd.setHours(0,0,0,0);
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
    getRaces().then(r=>{setRaces(r);setLoading(false);});
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
      storage.set('races',merged);
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

CONTEXT: Clinical tests are 6-month baselines. Daily Garmin/Cronometer data is the ongoing signal. Training data from Garmin CSV is prepended as [ARNOLD TRAINING CONTEXT]. Be precise, cite actual numbers, and connect metrics across test types. Use optimal longevity ranges, not just clinical normals.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileSettings({data,persist,showToast}){
  const saved=storage.get('profile')||{};
  const[f,sf]=useState({...data.profile,...saved});
  const set=k=>e=>sf(p=>({...p,[k]:e.target.value}));
  const doSave=async()=>{
    await persist({...data,profile:{name:f.name,goal:f.goal,age:f.age,height:f.height}});
    storage.set('profile',f);
    showToast("✓ Profile & goals saved!");
  };
  const GF=({label,field,unit,placeholder})=>(
    <div style={S.field}>
      <label style={S.fl}>{label}{unit&&<span style={{color:C.m}}> ({unit})</span>}</label>
      <input type="number" step="any" value={f[field]||""} onChange={set(field)} placeholder={placeholder||""} style={S.inp}/>
    </div>
  );
  return(
    <div style={S.sec}>
      <div style={S.st}>Profile</div>
      {[["Name","name","text"],["Age","age","number"],["Height (cm)","height","number"],["Main Goal","goal","text"]].map(([l,k,t])=>(
        <div key={k} style={S.field}><label style={S.fl}>{l}</label><input type={t} value={f[k]||""} onChange={set(k)} style={S.inp}/></div>
      ))}

      {/* ── ANNUAL GOALS ── */}
      <div style={{...S.lg,marginTop:4}}>
        <div style={S.gt}>◈ Training Goals</div>
        <div style={S.fr}>
          <GF label="Annual run distance" field="annualRunDistanceTarget" unit="miles" placeholder="800"/>
          <GF label="Annual workouts" field="annualWorkoutsTarget" unit="sessions" placeholder="200"/>
        </div>
        <div style={S.fr}>
          <GF label="Weekly run distance" field="weeklyRunDistanceTarget" unit="miles" placeholder="20"/>
          <GF label="Weekly long run" field="weeklyLongRunTarget" unit="miles" placeholder="10"/>
        </div>
        <div style={S.field}>
          <label style={S.fl}>Target race pace <span style={{color:C.m}}>(min/mi)</span></label>
          <input type="text" value={f.targetRacePace||""} onChange={set("targetRacePace")} placeholder="9:30" style={S.inp}/>
        </div>
      </div>

      <div style={S.lg}>
        <div style={S.gt}>◆ Nutrition Goals</div>
        <div style={S.fr}>
          <GF label="Daily calories" field="dailyCalorieTarget" unit="kcal" placeholder="2200"/>
          <GF label="Daily protein" field="dailyProteinTarget" unit="g" placeholder="150"/>
        </div>
        <div style={S.fr}>
          <GF label="Daily carbs" field="dailyCarbTarget" unit="g" placeholder="180"/>
          <GF label="Daily fat" field="dailyFatTarget" unit="g" placeholder="65"/>
        </div>
      </div>

      <div style={S.lg}>
        <div style={S.gt}>⊗ Body Goals</div>
        <div style={S.fr}>
          <GF label="Target weight" field="targetWeight" unit="lbs" placeholder="175"/>
          <GF label="Target body fat" field="targetBodyFat" unit="%" placeholder="16.7"/>
        </div>
        <div style={S.field}>
          <GF label="Target lean mass" field="targetLeanMass" unit="lbs" placeholder="138"/>
        </div>
      </div>

      <button style={S.sb} onClick={doSave}>Save Profile & Goals</button>
      <div style={{height:1,background:C.b,margin:"4px 0"}}/>
      <div style={{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.dn,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>Danger Zone</div>
      <button style={S.db} onClick={()=>{if(window.confirm("This will permanently delete all your data. Are you sure?"))persist(DD).then(()=>showToast("✓ Data cleared"));}}>Delete All Data</button>
      <div style={{display:"flex",gap:12,fontSize:"clamp(12px,0.5vw + 10px,14px)",color:C.m}}>
        <span>{data.logs.length} daily logs</span>
        <span>{(data.labSnapshots||[]).length} lab snapshots</span>
        <span>{(data.clinicalTests||[]).length} clinical tests</span>
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
  {date:"2025-12-06",source:"csv",markers:{"Glucose (mg/dL)":85,"Calcium (mg/dL)":9.4,"Magnesium (mg/dL)":2.2,"Creatine kinase (U/L)":251,"Vitamin B12 (pg/mL)":696,"Folate (ng/mL)":19.1,"Vitamin D (ng/mL)":67,"Ferritin (ng/mL)":65,"Total Cholesterol (mg/dL)":164,"Hemoglobin (g/dL)":15,"HDL Cholesterol (mg/dL)":71,"LDL Cholesterol (mg/dL)":74,"Triglycerides (mg/dL)":102,"Testosterone (ng/dL)":756,"Potassium (mmol/L)":4,"Sodium (mmol/L)":139,"White blood cells (thousands/uL)":4.7,"HbA1c (%)":5.1,"ALT (U/L)":21,"Cortisol (µg/dL)":15.2,"Iron (ug/dL)":94,"TIBC (ug/dL)":324,"Albumin (g/dL)":4.6,"Free testosterone (ng/dL)":9.42,"AST (U/L)":27,"GGT (U/L)":18,"Transferrin saturation (%)":29,"SHBG (nmol/L)":57,"hsCRP (mg/L)":0.2,"TSH (µIU/L)":1.88,"RBC (x10E6/µL)":5.09,"Hematocrit (%)":45,"Platelets (thousands/uL)":183,"RBC Magnesium (mg/dL)":4.6,"Insulin (µIU/mL)":4,"ApoB (mg/dL)":47,"Testosterone:Cortisol Ratio (Units)":64.56}},
  {date:"2025-07-30",source:"csv",markers:{"Glucose (mg/dL)":82,"Magnesium (mg/dL)":2.3,"Creatine kinase (U/L)":292,"Vitamin B12 (pg/mL)":599,"Folate (ng/mL)":19.6,"Vitamin D (ng/mL)":85,"Ferritin (ng/mL)":59,"Total Cholesterol (mg/dL)":162,"Hemoglobin (g/dL)":14.6,"HDL Cholesterol (mg/dL)":71,"LDL Cholesterol (mg/dL)":71,"Triglycerides (mg/dL)":110,"Testosterone (ng/dL)":593,"HbA1c (%)":5.2,"ALT (U/L)":26,"Cortisol (µg/dL)":18.4,"Iron (ug/dL)":67,"Albumin (g/dL)":4.7,"Free testosterone (ng/dL)":7.34,"AST (U/L)":24,"GGT (U/L)":23,"SHBG (nmol/L)":63,"hsCRP (mg/L)":0.3,"TSH (µIU/L)":3.5,"RBC (x10E6/µL)":5.01,"Hematocrit (%)":45.1,"Platelets (thousands/uL)":200,"RBC Magnesium (mg/dL)":4.8,"Insulin (µIU/mL)":8,"ApoB (mg/dL)":50,"Testosterone:Cortisol Ratio (Units)":42.91}},
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
  hr:{display:"flex",alignItems:"center",gap:8},
  un:{fontSize:"clamp(10px,0.3vw + 9px,12px)",color:C.m},
  dc2:{fontSize:11,color:C.m,background:C.elev,border:"0.5px solid var(--border-subtle)",borderRadius:5,padding:"3px 10px",fontFamily:"var(--font-mono)"},
  nav:{display:"flex",borderBottom:`0.5px solid ${C.bs}`,background:C.bg,overflowX:"auto",height:"clamp(52px,5vw,64px)",position:"sticky",top:"clamp(52px,5vw,64px)",zIndex:9},
  nb:{flex:1,minWidth:44,padding:"0 4px",background:"none",border:"none",borderBottom:"2px solid transparent",color:C.s,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,transition:"color var(--transition)",fontFamily:"var(--font-ui)"},
  nba:{color:C.ta,borderBottom:`2px solid ${C.acc}`},
  ni:{fontSize:"clamp(14px,1vw + 10px,18px)"},
  nl:{fontSize:"clamp(9px,0.3vw + 8px,11px)",fontWeight:500,letterSpacing:"0.04em"},
  main:{padding:"clamp(16px,2vw,40px)",paddingBottom:60},
  sec:{display:"flex",flexDirection:"column",gap:"clamp(10px,1vw,16px)"},
  st:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",paddingBottom:8,borderBottom:`0.5px solid ${C.bs}`},
  sc:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:4},
  sc2:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:4},
  sic:{fontSize:"clamp(14px,1vw + 10px,18px)",color:C.acc,opacity:0.8},
  sv:{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"},
  sl2:{fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,color:C.t},
  ss:{fontSize:"clamp(10px,0.3vw + 9px,12px)",color:C.m},
  cg:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"clamp(10px,1vw,16px)"},
  snap:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"},
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
  lnba:{background:C.ad,borderColor:C.ab2,color:C.ta},
  lg:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:10},
  gt:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase"},
  fr:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"clamp(10px,1vw,16px)"},
  field:{display:"flex",flexDirection:"column",gap:5},
  fl:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.06em",color:C.m,textTransform:"uppercase"},
  inp:{background:C.inp,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",color:C.t,padding:"10px 14px",fontFamily:"var(--font-ui)",fontSize:"clamp(13px,0.5vw + 10px,15px)",outline:"none",width:"100%",boxSizing:"border-box",transition:`border-color var(--transition),box-shadow var(--transition)`},
  ta:{background:C.inp,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",color:C.t,padding:"10px 14px",fontFamily:"var(--font-ui)",fontSize:"clamp(13px,0.5vw + 10px,15px)",resize:"vertical",minHeight:72,outline:"none",width:"100%",boxSizing:"border-box",transition:`border-color var(--transition),box-shadow var(--transition)`},
  eb:{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.ta,background:C.ad,padding:"3px 10px",borderRadius:"var(--radius-sm)",alignSelf:"flex-start",border:`0.5px solid ${C.ab2}`},
  sb:{background:C.ad,border:`0.5px solid ${C.ab2}`,borderRadius:"var(--radius-md)",padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,letterSpacing:"0.03em",cursor:"pointer",color:C.ta,width:"100%",transition:`background var(--transition),border-color var(--transition)`},
  gb:{background:"transparent",border:`0.5px solid ${C.b}`,color:C.s,borderRadius:"var(--radius-sm)",padding:"9px 16px",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,cursor:"pointer",transition:`all var(--transition)`},
  db:{background:C.dnb,border:`0.5px solid rgba(248,113,113,0.25)`,color:C.dn,padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",borderRadius:"var(--radius-md)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,cursor:"pointer",width:"100%",transition:`all var(--transition)`},
  scard:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"12px 8px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,transition:`border-color var(--transition)`},
  ic:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
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
