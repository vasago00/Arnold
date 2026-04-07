import { useState, useEffect, useCallback, useRef } from "react";

// ─── Storage ──────────────────────────────────────────────────────────────────
const SK = "vitals-v4";
const DD = { profile:{name:"",goal:"",age:"",height:""}, logs:[], aiInsights:[], labSnapshots:[], clinicalTests:[] };
async function loadData(){ try{ const r=await window.storage.get(SK); return r?JSON.parse(r.value):DD; }catch{ return DD; }}
async function saveData(d){ try{ await window.storage.set(SK,JSON.stringify(d)); }catch{} }

// ─── AI ───────────────────────────────────────────────────────────────────────
async function ai(system,user,max=1200){
  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:max,system,messages:[{role:"user",content:user}]}),
  });
  const d=await r.json(); return d.content?.[0]?.text||"No response.";
}

// ─── Blood Panel Reference Ranges (optimal, not just lab-normal) ──────────────
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
const SC={optimal:"#4ade80",warn:"#facc15",flag:"#f87171",unknown:"#555"};
const SL={optimal:"Optimal",warn:"Monitor",flag:"Review",unknown:"—"};

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
function mapGarmin(rows){
  const by={};
  const mg=(d,p)=>{if(!d)return;by[d]={...(by[d]||{date:d}),...p};};
  rows.forEach(r=>{
    const d=ndate(r["date"]||r["start time"]||r["activity date"]||r["calendar date"]);
    if(r["activity type"]!==undefined)mg(d,{workout:r["activity type"]||r["title"]||"",workoutDuration:r["time"]||r["elapsed time"]||"",calories:r["calories"]||"",heartRate:r["avg hr"]||"",steps:r["steps"]||""});
    if(r["deep sleep"]!==undefined){const h=["deep sleep","light sleep","rem sleep"].reduce((s,k)=>{const v=r[k]||"";const p=v.split(":").map(Number);return s+(p[0]||0)+(p[1]||0)/60;},0);mg(d,{sleep:h>0?h.toFixed(2):""});}
    if(r["last night"]!==undefined)mg(d,{hrv:r["last night"]||"",hrvStatus:{"balanced":"good","unbalanced":"moderate","poor":"low"}[(r["status"]||"").toLowerCase()]||""});
    if(r["weight"]!==undefined&&!r["activity type"]&&!r["last night"])mg(d,{weight:r["weight (kg)"]||r["weight"]||"",bodyFat:r["body fat %"]||""});
    if(r["avg resting hr"]!==undefined)mg(d,{heartRate:r["avg resting hr"]||""});
  });
  return Object.values(by).filter(e=>e.date);
}
function mapCrono(rows){
  const by={};
  const mg=(d,p)=>{if(!d)return;by[d]={...(by[d]||{date:d}),...p};};
  rows.forEach(r=>{
    const d=ndate(r["date"]||r["day"]);
    if(r["energy (kcal)"]!==undefined)mg(d,{calories:r["energy (kcal)"]||"",protein:r["protein (g)"]||"",carbs:r["carbohydrates (g)"]||"",fat:r["fat (g)"]||""});
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

// ─── Utilities ────────────────────────────────────────────────────────────────
const td=()=>new Date().toISOString().split("T")[0];
const fmt=(v,u="")=>(v!==""&&v!=null?`${v}${u}`:"—");
const Q=["—","1","2","3","4","5"];
const HRV_L={excellent:"Excellent",good:"Good",moderate:"Moderate",low:"Low"};
function hc(hrv){const n=parseFloat(hrv);if(isNaN(n))return"#aaa";if(n>=70)return"#4ade80";if(n>=50)return"#facc15";if(n>=35)return"#fb923c";return"#f87171";}
function dc(name,delta){const m=BM[name];if(!m)return"#aaa";if(m.dir==="high")return delta>0?"#4ade80":"#f87171";if(m.dir==="low")return delta<0?"#4ade80":"#f87171";return"#aaa";}

const TABS=[
  {id:"dashboard",label:"Dash",icon:"◈"},
  {id:"labs",     label:"Labs",  icon:"⬡"},
  {id:"clinical", label:"Body",  icon:"◉"},
  {id:"log",      label:"Log",   icon:"⊕"},
  {id:"import",   label:"Import",icon:"⇣"},
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
  const [toast,setToast]=useState("");

  useEffect(()=>{loadData().then(d=>{
    const needSeed=!d.labSnapshots?.length&&!d.clinicalTests?.length;
    if(needSeed){const s={...d,labSnapshots:SEED_LABS,clinicalTests:SEED_CLINICAL};setData(s);saveData(s);}
    else setData(d);
    setLoading(false);
  });},[]);

  const persist=useCallback(async nd=>{setData(nd);await saveData(nd);},[]);
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),3000);};

  if(loading)return(<div style={S.splash}><div style={S.si}><div style={S.pr}/><span style={S.sl}>⬡</span></div></div>);

  return(
    <div style={S.root}>
      <div style={S.bg}/>
      <header style={S.hdr}>
        <div style={S.hl}><span style={S.logo}>⬡</span><div><div style={S.an}>ARNOLD</div><div style={S.as}>Health Intelligence</div></div></div>
        <div style={S.hr}>{data.profile.name&&<span style={S.un}>{data.profile.name}</span>}<span style={S.dc2}>{td()}</span></div>
      </header>
      <nav style={S.nav}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{...S.nb,...(tab===t.id?S.nba:{})}}><span style={S.ni}>{t.icon}</span><span style={S.nl}>{t.label}</span></button>)}
      </nav>
      <main style={S.main}>
        {tab==="dashboard"&&<Dashboard data={data} setTab={setTab} onAiSum={async()=>{setAiLoad(true);setTab("ai");const ins=await aiSummary(data);setAiResp(ins);await persist({...data,aiInsights:[{date:td(),text:ins},...data.aiInsights.slice(0,4)]});setAiLoad(false);}}/>}
        {tab==="labs"&&<LabsModule data={data} persist={persist} showToast={showToast}/>}
        {tab==="clinical"&&<ClinicalModule data={data} persist={persist} showToast={showToast}/>}
        {tab==="log"&&<LogDay data={data} persist={persist} showToast={showToast}/>}
        {tab==="import"&&<ImportHub data={data} persist={persist} showToast={showToast}/>}
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

      {/* ── OVERVIEW ── */}
      {view==="overview"&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {label:"VO₂ Max",value:"51",unit:"ml/kg/min",sub:"98th pct · Elite",color:"#60a5fa",icon:"◈"},
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
              <div style={{fontSize:18,fontWeight:700,color:C.t,letterSpacing:"-0.03em"}}>{c.value}<span style={{fontSize:9,color:C.m,fontWeight:400,marginLeft:3}}>{c.unit}</span></div>
              <div style={{fontSize:9,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>{c.label}</div>
              <div style={{fontSize:9,color:c.color,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Key priorities */}
        <div style={{background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#f87171",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Priority Targets · Mar 2025 Baseline</div>
          {[
            ["Body Fat %","24.7% → 16.7%","Reduce 8 percentage points — primarily trunk fat (27.6%)"],
            ["A/G Ratio","1.12 → <1.0","Apple-shaped distribution; reduce abdominal fat preferentially"],
            ["Visceral Fat","1.29 → 0.60 lbs","Needs 53% reduction — key metabolic risk driver"],
            ["Lean Mass","134 → 138 lbs","Add 4 lbs — prioritise resistance training"],
            ["Redline Ratio","89% → 93%+","Train near VT2 (Zone 3) to improve fatigue resistance"],
            ["Spine BMD","37th %ile","Below average — consider loading exercises + calcium/D3 review"],
          ].map(([metric,target,note],i)=>(
            <div key={i} style={{borderBottom:i<5?`1px solid rgba(255,255,255,0.04)`:"none",paddingBottom:i<5?8:0,marginBottom:i<5?8:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                <span style={{fontSize:11,color:C.t,fontWeight:600}}>{metric}</span>
                <span style={{fontSize:10,color:"#f87171"}}>{target}</span>
              </div>
              <div style={{fontSize:10,color:C.m,marginTop:2}}>{note}</div>
            </div>
          ))}
        </div>

        <button style={S.aib} onClick={runAI} disabled={aiRun}><span>✦</span>{aiRun?"Analysing all data…":"Full Cross-Test AI Analysis"}</button>
        {aiText&&!aiRun&&<div style={S.air}><div style={S.aih}>✦ Integrated Clinical Analysis</div><div style={S.ait}>{aiText}</div></div>}
      </>}

      {/* ── DEXA ── */}
      {view==="dexa"&&dexa&&<>
        <div style={{...S.snap,borderColor:"rgba(168,139,250,0.3)"}}>
          <div style={{fontSize:10,color:"#a78bfa",letterSpacing:"0.1em",textTransform:"uppercase"}}>DEXA Body Composition · {dexa.date}</div>
          <div style={{fontSize:10,color:C.m,marginTop:2}}>DexaFit New York City</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {lbl:"Body Score",val:"B",unit:"",note:"Target: A",clr:"#facc15"},
            {lbl:"Total Mass",val:"187",unit:"lbs",note:"Target: 175 lbs",clr:"#f87171"},
            {lbl:"Body Fat",val:"24.7",unit:"%",note:"Target: 16.7%",clr:"#f87171"},
            {lbl:"Lean Mass",val:"134",unit:"lbs",note:"Target: 138 lbs",clr:"#facc15"},
            {lbl:"Visceral Fat",val:"1.29",unit:"lbs",note:"Target: 0.60 lbs",clr:"#f87171"},
            {lbl:"T-Score",val:"2.80",unit:"",note:"Excellent",clr:"#4ade80"},
            {lbl:"ALMI",val:"9.1",unit:"kg/m²",note:"Target: 9.3",clr:"#facc15"},
            {lbl:"FFMI",val:"20.2",unit:"kg/m²",note:"Target: 21",clr:"#facc15"},
            {lbl:"A/G Ratio",val:"1.12",unit:"",note:"Want <1.0",clr:"#f87171"},
            {lbl:"Z-Score",val:"2.50",unit:"",note:"Excellent",clr:"#4ade80"},
          ].map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}30`}}>
              <div style={{fontSize:16,fontWeight:700,color:C.t}}>{c.val}<span style={{fontSize:9,color:C.m,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:9,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase"}}>{c.lbl}</div>
              <div style={{fontSize:9,color:c.clr,marginTop:1}}>{c.note}</div>
            </div>
          ))}
        </div>

        <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#a78bfa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Regional Body Fat %</div>
          {[
            ["Total","24.7%","Target: 16.7%",0.75],
            ["Trunk","27.6%","Main concern — 3% under peer avg",0.85],
            ["Arms","20.7%","Good — at peer avg",0.55],
            ["Legs","23.2%","4% over peer avg",0.70],
          ].map(([region,val,note,fill],i)=>(
            <div key={i} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:11,color:C.t}}>{region}</span>
                <span style={{fontSize:11,color:C.t,fontWeight:600}}>{val}</span>
              </div>
              <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
                <div style={{height:4,width:`${fill*100}%`,background:fill>0.75?"#f87171":"#facc15",borderRadius:2}}/>
              </div>
              <div style={{fontSize:9,color:C.m,marginTop:2}}>{note}</div>
            </div>
          ))}
        </div>

        <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#a78bfa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Bone Mineral Density by Region</div>
          {[
            ["Total Body","1.48 g/cm²","86th %ile","#4ade80"],
            ["Legs","1.61 g/cm²","93rd %ile","#4ade80"],
            ["Head","2.59 g/cm²","73rd %ile","#4ade80"],
            ["Pelvis","1.27 g/cm²","71st %ile","#4ade80"],
            ["Trunk","1.15 g/cm²","64th %ile","#facc15"],
            ["Ribs","0.98 g/cm²","70th %ile","#4ade80"],
            ["Arms","1.11 g/cm²","52nd %ile","#facc15"],
            ["Spine","1.24 g/cm²","37th %ile ⚠","#f87171"],
          ].map(([r,v,p,clr],i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",borderBottom:i<7?`1px solid rgba(255,255,255,0.04)`:"none",paddingBottom:6,marginBottom:6}}>
              <span style={{fontSize:11,color:C.t}}>{r}</span>
              <span style={{fontSize:11,color:clr}}>{v} · {p}</span>
            </div>
          ))}
        </div>
      </>}

      {/* ── VO2 MAX ── */}
      {view==="vo2"&&vo2&&<>
        <div style={{...S.snap,borderColor:"rgba(96,165,250,0.3)"}}>
          <div style={{fontSize:10,color:"#60a5fa",letterSpacing:"0.1em",textTransform:"uppercase"}}>VO₂ Max Assessment · {vo2.date}</div>
          <div style={{fontSize:10,color:C.m,marginTop:2}}>DexaFit New York City</div>
        </div>

        {/* Hero metrics */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          {[
            {lbl:"VO₂ Max",val:"51",unit:"ml/kg/min",sub:"Elite · 98th %ile",clr:"#60a5fa"},
            {lbl:"Bio Age",val:"33",unit:"years",sub:"17 yrs younger",clr:"#4ade80"},
            {lbl:"Redline Ratio",val:"89",unit:"%",sub:"70th %ile · Good",clr:"#facc15"},
            {lbl:"Lean VO₂ Max",val:"72",unit:"ml/lm·kg",sub:"99th %ile · Elite",clr:"#4ade80"},
            {lbl:"Leg Lean VO₂",val:"200",unit:"ml/lm·kg",sub:"96th %ile · Elite",clr:"#4ade80"},
            {lbl:"Max HR",val:"164",unit:"bpm",sub:"58th %ile",clr:"#facc15"},
          ].map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}35`}}>
              <div style={{fontSize:15,fontWeight:700,color:C.t,letterSpacing:"-0.02em"}}>{c.val}<span style={{fontSize:8,color:C.m,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:8,color:C.m,textTransform:"uppercase",letterSpacing:"0.05em"}}>{c.lbl}</div>
              <div style={{fontSize:8,color:c.clr,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Training zones */}
        <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Your Training Zones</div>
          {[
            {z:"Zone 4 · Peak",hr:"152–172 bpm",kcal:"1225–1388 kcal/hr",note:"VO₂Max development & HIIT",clr:"#f87171",pct:"20%"},
            {z:"Zone 3 · High",hr:"138–152 bpm",kcal:"1057–1225 kcal/hr",note:"Tempo — raise Redline Ratio",clr:"#fb923c",pct:"selective"},
            {z:"Zone 2 · Moderate",hr:"99–138 bpm",kcal:"601–1057 kcal/hr",note:"Fat oxidation & mitochondria",clr:"#60a5fa",pct:"80%"},
            {z:"Zone 1 · Recovery",hr:"82–99 bpm",kcal:"501–601 kcal/hr",note:"Active recovery & warmup",clr:"#4ade80",pct:""},
          ].map((z,i)=>(
            <div key={i} style={{borderLeft:`3px solid ${z.clr}`,paddingLeft:10,marginBottom:i<3?10:0}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:11,color:C.t,fontWeight:600}}>{z.z}</span>
                {z.pct&&<span style={{fontSize:9,background:`${z.clr}20`,color:z.clr,padding:"1px 6px",borderRadius:3}}>{z.pct} of training</span>}
              </div>
              <div style={{fontSize:10,color:z.clr}}>{z.hr}</div>
              <div style={{fontSize:10,color:C.m}}>{z.kcal} · {z.note}</div>
            </div>
          ))}
        </div>

        {/* Thresholds */}
        <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Ventilatory Thresholds</div>
          {[
            ["VT1","110 bpm","Peak fat oxidation — Zone 2 ceiling","#4ade80"],
            ["VT2","154 bpm","Rapid lactate accumulation — Zone 3/4 boundary","#f87171"],
          ].map(([k,v,note,clr],i)=>(
            <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:i<1?8:0}}>
              <div style={{fontSize:12,color:clr,fontWeight:700,minWidth:36}}>{k}</div>
              <div><div style={{fontSize:12,color:C.t}}>{v}</div><div style={{fontSize:10,color:C.m}}>{note}</div></div>
            </div>
          ))}
        </div>
      </>}

      {/* ── RMR ── */}
      {view==="rmr"&&rmr&&<>
        <div style={{...S.snap,borderColor:"rgba(74,222,128,0.3)"}}>
          <div style={{fontSize:10,color:"#4ade80",letterSpacing:"0.1em",textTransform:"uppercase"}}>Resting Metabolic Rate · {rmr.date}</div>
          <div style={{fontSize:10,color:C.m,marginTop:2}}>DexaFit New York City</div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {lbl:"RMR",val:"1,880",unit:"kcal/day",sub:"Fast (+97 vs predicted)",clr:"#4ade80"},
            {lbl:"Predicted RMR",val:"1,783",unit:"kcal/day",sub:"Statistical avg for age/body",clr:"#facc15"},
            {lbl:"RER",val:"0.84",unit:"",sub:"Fat 53% / Carbs 47%",clr:"#60a5fa"},
            {lbl:"Peer Average",val:"1,915",unit:"kcal/day",sub:"Slightly below peers",clr:"#fb923c"},
          ].map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}35`}}>
              <div style={{fontSize:18,fontWeight:700,color:C.t,letterSpacing:"-0.02em"}}>{c.val}<span style={{fontSize:9,color:C.m,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:9,color:C.m,textTransform:"uppercase",letterSpacing:"0.06em"}}>{c.lbl}</div>
              <div style={{fontSize:9,color:c.clr,marginTop:1}}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Fuel mix bar */}
        <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#4ade80",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Resting Fuel Composition (RER 0.84)</div>
          <div style={{height:20,borderRadius:4,overflow:"hidden",display:"flex",marginBottom:6}}>
            <div style={{width:"53%",background:"#60a5fa",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:9,color:"#fff",fontWeight:700}}>Fat 53%</span></div>
            <div style={{width:"47%",background:"#fb923c",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:9,color:"#fff",fontWeight:700}}>Carbs 47%</span></div>
          </div>
          <div style={{fontSize:10,color:C.m}}>Good metabolic flexibility. RER 0.70 = pure fat; 1.0 = pure carbs. Your 0.84 shows balanced substrate use at rest.</div>
        </div>

        {/* TDEE table */}
        <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#4ade80",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Total Daily Energy Expenditure</div>
          {[
            ["Sedentary","2,256 kcal","1,256–1,756","2,506–2,756"],
            ["Lightly Active","2,585 kcal","1,585–2,085","2,835–3,085"],
            ["Moderately Active","2,914 kcal","1,914–2,414","3,164–3,414"],
            ["Very Active","3,243 kcal","2,243–2,743","3,493–3,743"],
            ["Extremely Active","3,572 kcal","2,572–3,072","3,822–4,072"],
          ].map(([level,tdee,fatLoss,lean],i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1.2fr 0.8fr 1fr 1fr",borderBottom:i<4?`1px solid rgba(255,255,255,0.04)`:"none",paddingBottom:5,marginBottom:5,gap:4}}>
              <div style={{fontSize:10,color:C.t}}>{level}</div>
              <div style={{fontSize:10,color:"#4ade80",fontWeight:600}}>{tdee}</div>
              <div style={{fontSize:9,color:"#60a5fa"}}>{fatLoss}</div>
              <div style={{fontSize:9,color:"#a78bfa"}}>{lean}</div>
            </div>
          ))}
          <div style={{display:"grid",gridTemplateColumns:"1.2fr 0.8fr 1fr 1fr",marginTop:4}}>
            <div/><div style={{fontSize:8,color:C.m}}>TDEE</div><div style={{fontSize:8,color:"#60a5fa"}}>Fat Loss</div><div style={{fontSize:8,color:"#a78bfa"}}>Lean Gain</div>
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
  const [selMkr,setSelMkr]=useState(null);
  const [upText,setUpText]=useState("");
  const [uploading,setUploading]=useState(false);
  const [aiTxt,setAiTxt]=useState("");
  const [aiRun,setAiRun]=useState(false);
  const fileRef=useRef();

  const snaps=[...(data.labSnapshots||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const latest=snaps[0]; const prev=snaps[1];

  const sCounts={optimal:0,warn:0,flag:0};
  if(latest)Object.entries(latest.markers).forEach(([n,v])=>{const s=bStatus(n,v);if(sCounts[s]!==undefined)sCounts[s]++;});

  const sparkV=(name,n=7)=>snaps.slice(0,n).reverse().map(s=>parseFloat(s.markers[name])||null);

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
    showToast(`✓ ${a} new, ${u} updated`);setUpText("");setView("overview");setUploading(false);
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

  return(
    <div style={S.sec}>
      <div style={S.st}>⬡ Blood Panel</div>
      <div style={S.labNav}>
        {[["overview","Overview"],["trend","Trends"],["upload","Upload"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setView(id)} style={{...S.lnb,...(view===id?S.lnba:{})}}>{lbl}</button>
        ))}
      </div>

      {view==="overview"&&<>
        {!latest&&<div style={S.empty}>No lab data. Upload a blood panel CSV.</div>}
        {latest&&<>
          <div style={S.snap}>
            <div><div style={{fontSize:12,fontWeight:700,color:C.acc}}>{latest.date}</div><div style={{fontSize:9,color:C.m,marginTop:1}}>{Object.keys(latest.markers).length} markers</div></div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {[["optimal","#4ade80"],[" warn","#facc15"],["flag","#f87171"]].map(([k,clr])=>(
                <div key={k} style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:`${clr}18`,border:`1px solid ${clr}40`,color:clr}}>{sCounts[k.trim()]} {k.trim()}</div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:0,overflowX:"auto",borderBottom:`1px solid ${C.b}`}}>
            {BCATS.map(cat=>(
              <button key={cat} onClick={()=>setSelCat(cat)} style={{background:"none",border:"none",borderBottom:`2px solid ${selCat===cat?BCAT_CLR[cat]:"transparent"}`,color:selCat===cat?BCAT_CLR[cat]:C.m,padding:"6px 9px",cursor:"pointer",fontFamily:"inherit",fontSize:8,letterSpacing:"0.06em",whiteSpace:"nowrap",display:"flex",gap:3,alignItems:"center"}}>
                {BCAT_ICO[cat]} {cat}
              </button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
            {Object.entries(BM).filter(([,m])=>m.cat===selCat).map(([name,meta])=>{
              const val=latest.markers[name];
              const pv=prev?.markers[name];
              const stat=bStatus(name,val);
              const delta=val!=null&&pv!=null?parseFloat(val)-parseFloat(pv):null;
              const has=val!=null&&!isNaN(val);
              return(
                <div key={name} style={{background:C.cb,border:`1px solid ${has?SC[stat]+"40":C.b}`,borderRadius:7,padding:9,cursor:"pointer"}} onClick={()=>{setSelMkr(name);setView("trend");}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
                    <div style={{fontSize:8,color:C.m,letterSpacing:"0.06em",textTransform:"uppercase",lineHeight:1.3,maxWidth:"60%"}}>{meta.lbl}</div>
                    <div style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:`${SC[stat]}20`,color:SC[stat]}}>{SL[stat]}</div>
                  </div>
                  <div style={{fontSize:18,fontWeight:700,color:C.t,letterSpacing:"-0.03em"}}>{has?val:"—"}<span style={{fontSize:8,color:C.m,fontWeight:400,marginLeft:2}}>{has?meta.unit:""}</span></div>
                  <div style={{fontSize:8,color:"#333",marginTop:1}}>{meta.opt[0]}–{meta.opt[1]} {meta.unit}</div>
                  {delta!==null&&<div style={{fontSize:8,marginTop:2,color:dc(name,delta)}}>{delta>0?"▲":"▼"}{Math.abs(delta).toFixed(2)}</div>}
                  <Spark vals={sparkV(name)} color={SC[stat]}/>
                </div>
              );
            })}
          </div>
          <button style={S.aib} onClick={runAI} disabled={aiRun}><span>✦</span>{aiRun?"Analysing…":"AI Blood Panel Analysis"}</button>
          {aiTxt&&!aiRun&&<div style={S.air}><div style={S.aih}>✦ Blood Panel Analysis · {latest.date}</div><div style={S.ait}>{aiTxt}</div></div>}
        </>}
      </>}

      {view==="trend"&&<>
        <div style={S.field}>
          <label style={S.fl}>Marker</label>
          <select value={selMkr||""} onChange={e=>setSelMkr(e.target.value)} style={S.inp}>
            <option value="">— choose —</option>
            {BCATS.map(cat=>(
              <optgroup key={cat} label={cat}>
                {Object.entries(BM).filter(([,m])=>m.cat===cat).map(([n,m])=><option key={n} value={n}>{m.lbl}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {selMkr&&<TrendChart marker={selMkr} snaps={snaps} meta={BM[selMkr]}/>}
        {selMkr&&snaps.length>0&&(
          <div style={{border:`1px solid ${C.b}`,borderRadius:7,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 1fr 1fr",background:"rgba(255,255,255,0.04)",padding:"6px 10px"}}>
              {["Date","Value","Status","Δ Prev"].map(h=><div key={h} style={{fontSize:8,color:C.m,letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</div>)}
            </div>
            {snaps.map((s,i)=>{
              const v=s.markers[selMkr]; const pv=snaps[i+1]?.markers[selMkr];
              const stat=bStatus(selMkr,v);
              const delta=v!=null&&pv!=null?parseFloat(v)-parseFloat(pv):null;
              return(
                <div key={s.date} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 1fr 1fr",padding:"7px 10px",background:i%2?"rgba(255,255,255,0.02)":"transparent"}}>
                  <div style={{fontSize:10,color:C.t}}>{s.date}</div>
                  <div style={{fontSize:10,color:SC[stat],fontWeight:600}}>{v!=null?`${v} ${BM[selMkr]?.unit||""}`:"—"}</div>
                  <div style={{fontSize:10,color:SC[stat]}}>{SL[stat]}</div>
                  <div style={{fontSize:10,color:delta!=null?dc(selMkr,delta):"#555"}}>{delta!=null?(delta>0?`▲${Math.abs(delta).toFixed(2)}`:`▼${Math.abs(delta).toFixed(2)}`):""}</div>
                </div>
              );
            })}
          </div>
        )}
      </>}

      {view==="upload"&&<>
        <div style={{...S.ic,borderColor:"rgba(200,245,90,0.3)"}}>
          <div style={{fontSize:9,color:C.acc,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Expected format</div>
          <div style={{fontSize:11,color:C.m,lineHeight:1.6}}>Rows = markers, Columns = dates (e.g. "Dec 06 2025"). Same format as your existing bloodwork CSV. New dates added; existing dates merged.</div>
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

// ─── SVG Trend Chart ──────────────────────────────────────────────────────────
function TrendChart({marker,snaps,meta}){
  if(!meta||!snaps.length)return null;
  const pts=snaps.slice().reverse().map(s=>({date:s.date,val:parseFloat(s.markers[marker])})).filter(p=>!isNaN(p.val));
  if(pts.length<2)return<div style={{color:C.m,fontSize:11,padding:"10px 0"}}>Not enough data points.</div>;
  const W=300,H=100,P={t:12,b:26,l:32,r:8};
  const vals=pts.map(p=>p.val);
  const minV=Math.min(...vals,meta.opt[0]*0.85),maxV=Math.max(...vals,meta.opt[1]*1.1);
  const xS=i=>(P.l+(i/(pts.length-1))*(W-P.l-P.r));
  const yS=v=>(H-P.b-((v-minV)/(maxV-minV))*(H-P.t-P.b));
  const path=pts.map((p,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(p.val).toFixed(1)}`).join(" ");
  const oY1=yS(meta.opt[1]),oY2=yS(meta.opt[0]);
  return(
    <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:7,padding:12}}>
      <div style={{fontSize:9,color:BCAT_CLR[meta.cat]||C.acc,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
        {meta.lbl} · Optimal {meta.opt[0]}–{meta.opt[1]} {meta.unit}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
        <rect x={P.l} y={oY1} width={W-P.l-P.r} height={oY2-oY1} fill="rgba(74,222,128,0.07)" stroke="rgba(74,222,128,0.2)" strokeWidth="0.5"/>
        {[0,0.5,1].map(t=>{const v=(minV+(maxV-minV)*t).toFixed(1);const y=yS(parseFloat(v));return(<g key={t}><line x1={P.l} x2={W-P.r} y1={y} y2={y} stroke="#1e1e2e" strokeWidth="1"/><text x={P.l-3} y={y+3} fontSize="7" fill="#555" textAnchor="end">{v}</text></g>);})}
        <path d={path} fill="none" stroke={C.acc} strokeWidth="1.5" strokeLinejoin="round"/>
        {pts.map((p,i)=><circle key={i} cx={xS(i)} cy={yS(p.val)} r="3.5" fill={SC[bStatus(marker,p.val)]} stroke={C.bg} strokeWidth="1.5"/>)}
        {pts.map((p,i)=><text key={i} x={xS(i)} y={H-P.b+11} fontSize="6.5" fill="#555" textAnchor="middle">{p.date.slice(5)}</text>)}
      </svg>
    </div>
  );
}

// ─── Mini Sparkline ───────────────────────────────────────────────────────────
function Spark({vals,color}){
  const pts=(vals||[]).filter(Boolean);
  if(pts.length<2)return null;
  const W=54,H=14,min=Math.min(...pts),max=Math.max(...pts),range=max-min||1;
  const xS=i=>i/(pts.length-1)*W;
  const yS=v=>H-(((v-min)/range)*H*0.75+H*0.1);
  const path=pts.map((v,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join(" ");
  return(<svg width={W} height={H} style={{marginTop:3,display:"block"}}><path d={path} fill="none" stroke={color} strokeWidth="1.1" opacity="0.65"/></svg>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({data,setTab,onAiSum}){
  const l7=data.logs.slice(0,7);
  const lat=data.logs[0];
  const avg=f=>{const v=l7.map(l=>parseFloat(l[f])).filter(v=>!isNaN(v));return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):"—";};
  const wt=(()=>{const w=l7.map(l=>parseFloat(l.weight)).filter(v=>!isNaN(v));return w.length<2?null:w[0]-w[w.length-1];})();
  const labSnap=[...(data.labSnapshots||[])].sort((a,b)=>b.date.localeCompare(a.date))[0];
  const labFlags=labSnap?Object.entries(labSnap.markers).map(([n,v])=>({n,v,m:BM[n],s:bStatus(n,v)})).filter(x=>x.m&&x.s==="flag").slice(0,3):[];

  return(
    <div style={S.sec}>
      <div style={S.wb}>
        <div style={S.wt2}>{data.profile.name?`Good day, ${data.profile.name}.`:"Welcome to ARNOLD."}</div>
        <div style={S.ws}>{data.profile.goal?`Goal: ${data.profile.goal}`:"Set your goal in Profile →"}</div>
      </div>

      {/* Clinical snapshot hero */}
      <div style={{background:"rgba(96,165,250,0.06)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:8,padding:12,cursor:"pointer"}} onClick={()=>setTab("clinical")}>
        <div style={{fontSize:9,color:"#60a5fa",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>◉ Body & Fitness Baseline · Mar 2025</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
          {[["VO₂ Max","51","#4ade80"],["Bio Age","33y","#4ade80"],["Body Fat","24.7%","#f87171"],["RMR","1,880","#facc15"]].map(([l,v,c],i)=>(
            <div key={i} style={{textAlign:"center"}}><div style={{fontSize:15,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:8,color:C.m,textTransform:"uppercase"}}>{l}</div></div>
          ))}
        </div>
      </div>

      {/* Daily avg cards */}
      <div style={S.cg}>
        {[["Avg Weight",avg("weight")," kg","⊗"],["Avg Sleep",avg("sleep")," h","◑"],["Avg HRV",avg("hrv"),"","∿"],["Avg Calories",avg("calories")," kcal","◆"]].map(([l,v,u,ic],i)=>(
          <div key={i} style={S.sc}><div style={S.sic}>{ic}</div><div style={S.sv}>{v}{v!=="—"?u:""}</div><div style={S.sl2}>{l}</div><div style={S.ss}>7-day avg</div></div>
        ))}
      </div>

      {wt!==null&&<div style={{...S.tb,borderColor:wt<=0?"#4ade80":"#f87171"}}><span>{wt<=0?"▼":"▲"}</span><span style={{fontSize:11,color:C.m}}>Weight {wt<=0?"down":"up"} <strong>{Math.abs(wt).toFixed(1)} kg</strong> over last 7 entries</span></div>}

      {labSnap&&(
        <div style={{background:"rgba(200,245,90,0.05)",border:"1px solid rgba(200,245,90,0.2)",borderRadius:7,padding:11,cursor:"pointer"}} onClick={()=>setTab("labs")}>
          <div style={{fontSize:9,color:C.acc,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>⬡ Blood Panel · {labSnap.date}</div>
          {labFlags.length>0?(
            labFlags.map(f=>(
              <div key={f.n} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:10,color:C.m}}>{f.m.lbl}</span>
                <span style={{fontSize:10,color:"#f87171",fontWeight:600}}>{f.v} {f.m.unit} · Review</span>
              </div>
            ))
          ):<div style={{fontSize:11,color:"#4ade80"}}>All key markers in range ✓</div>}
        </div>
      )}

      <button style={S.aib} onClick={onAiSum}><span>✦</span>Generate AI Weekly Summary</button>
      {data.aiInsights[0]&&<div style={S.ip}><div style={S.ih}>Last Analysis · {data.aiInsights[0].date}</div><div style={S.it2}>{data.aiInsights[0].text.slice(0,200)}…</div></div>}
      {!l7.length&&!labSnap&&<div style={S.empty}>No data yet — Log, Import, or explore Labs and Body tabs.</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOG TODAY
// ═══════════════════════════════════════════════════════════════════════════════
function LogDay({data,persist,showToast}){
  const ts=td(),ex=data.logs.find(l=>l.date===ts);
  const[f,sf]=useState({date:ts,weight:ex?.weight||"",bodyFat:ex?.bodyFat||"",sleep:ex?.sleep||"",sleepQuality:ex?.sleepQuality||"",hrv:ex?.hrv||"",hrvStatus:ex?.hrvStatus||"",calories:ex?.calories||"",protein:ex?.protein||"",carbs:ex?.carbs||"",fat:ex?.fat||"",workout:ex?.workout||"",workoutDuration:ex?.workoutDuration||"",steps:ex?.steps||"",heartRate:ex?.heartRate||"",notes:ex?.notes||""});
  const set=k=>e=>sf(p=>({...p,[k]:e.target.value}));
  const save=async()=>{const cl=Object.fromEntries(Object.entries(f).filter(([,v])=>v!==""));await persist({...data,logs:[cl,...data.logs.filter(l=>l.date!==ts)]});showToast("✓ Saved!");};
  const F=({label,field,type="number",placeholder="",unit=""})=>(<div style={S.field}><label style={S.fl}>{label}{unit&&<span style={{color:"#444",fontSize:8}}> {unit}</span>}</label><input type={type} value={f[field]} onChange={set(field)} placeholder={placeholder} style={S.inp}/></div>);
  return(
    <div style={S.sec}>
      <div style={S.st}>Log · {ts}</div>
      {ex&&<div style={S.eb}>Editing today's entry</div>}
      <div style={S.lg}><div style={S.gt}>⊗ Body</div><div style={S.fr}><F label="Weight" field="weight" unit="kg"/><F label="Body Fat" field="bodyFat" unit="%"/></div></div>
      <div style={S.lg}><div style={S.gt}>◑ Sleep</div><div style={S.fr}><F label="Hours" field="sleep" unit="h"/><div style={S.field}><label style={S.fl}>Quality</label><select value={f.sleepQuality} onChange={set("sleepQuality")} style={S.inp}>{Q.map(q=><option key={q} value={q==="—"?"":q}>{q}</option>)}</select></div></div></div>
      <div style={S.lg}><div style={S.gt}>∿ HRV</div><div style={S.fr}><F label="Score" field="hrv" placeholder="ms"/><div style={S.field}><label style={S.fl}>Status</label><select value={f.hrvStatus} onChange={set("hrvStatus")} style={S.inp}><option value="">—</option>{Object.entries(HRV_L).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div></div></div>
      <div style={S.lg}><div style={S.gt}>◆ Nutrition</div><div style={S.fr}><F label="Calories" field="calories" unit="kcal"/><F label="Protein" field="protein" unit="g"/></div><div style={S.fr}><F label="Carbs" field="carbs" unit="g"/><F label="Fat" field="fat" unit="g"/></div></div>
      <div style={S.lg}><div style={S.gt}>◉ Activity</div><div style={S.fr}><div style={S.field}><label style={S.fl}>Workout</label><input type="text" value={f.workout} onChange={set("workout")} placeholder="Running, Weights…" style={S.inp}/></div><F label="Duration" field="workoutDuration" unit="min"/></div><div style={S.fr}><F label="Steps" field="steps"/><F label="Heart Rate" field="heartRate" unit="bpm"/></div></div>
      <div style={S.lg}><div style={S.gt}>◎ Notes</div><textarea value={f.notes} onChange={set("notes")} placeholder="How do you feel?" style={S.ta}/></div>
      <button style={S.sb} onClick={save}>Save Entry</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT HUB
// ═══════════════════════════════════════════════════════════════════════════════
function ImportHub({data,persist,showToast}){
  const[src,setSrc]=useState("garmin");const[csv,setCsv]=useState("");const[strat,setStrat]=useState("fill");const[prev2,setPrev]=useState(null);const[step,setStep]=useState("paste");const[res,setRes]=useState(null);const fr=useRef();
  const reset=()=>{setCsv("");setPrev(null);setStep("paste");setRes(null);};
  const parse=()=>{if(!csv.trim()){showToast("⚠ No data");return;}const rows=parseCSV(csv);if(!rows.length){showToast("⚠ Parse failed");return;}setPrev({mapped:src==="garmin"?mapGarmin(rows):mapCrono(rows)});setStep("preview");};
  const doImp=async()=>{if(!prev2?.mapped?.length){showToast("⚠ No rows");return;}const{logs,added,updated}=mergeLogs(data.logs,prev2.mapped,strat);await persist({...data,logs});setRes({added,updated});setStep("done");};
  const INF={garmin:{icon:"⌚",label:"Garmin Connect",color:"#3b82f6",steps:["Garmin Connect → Reports → CSV","Upload below"]},cronometer:{icon:"◆",label:"Cronometer",color:"#f59e0b",steps:["More → Account → Export Data","Upload below"]}};
  const inf=INF[src];
  return(
    <div style={S.sec}>
      <div style={S.st}>⇣ Import Hub</div>
      {step==="done"&&res&&<div style={S.is}><div style={{fontSize:32,color:C.acc}}>✓</div><div style={{fontSize:14,fontWeight:700,color:C.acc}}>Done</div><div style={{fontSize:11,color:C.m}}>{res.added} new · {res.updated} updated</div><button style={S.sb} onClick={reset}>Import More</button></div>}
      {step!=="done"&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
          {Object.entries(INF).map(([id,i])=><button key={id} onClick={()=>{setSrc(id);reset();}} style={{...S.scard,...(src===id?{borderColor:i.color,background:`${i.color}15`}:{})}}><span style={{fontSize:18,color:i.color}}>{i.icon}</span><span style={{fontSize:10,color:C.t}}>{i.label}</span></button>)}
        </div>
        <div style={{...S.ic,borderColor:`${inf.color}40`}}><div style={{fontSize:9,color:inf.color,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>{inf.label}</div>{inf.steps.map((s,i)=><div key={i} style={{fontSize:11,color:C.m,marginBottom:2}}>{i+1}. {s}</div>)}</div>
        {step==="paste"&&<><div style={S.uz} onClick={()=>fr.current?.click()}><input ref={fr} type="file" accept=".csv" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setCsv(ev.target.result);r.readAsText(f);e.target.value="";}} /><div style={{fontSize:24,color:C.acc}}>⇡</div><div style={{fontSize:11,color:C.t}}>Upload CSV</div></div><textarea value={csv} onChange={e=>setCsv(e.target.value)} placeholder={`Paste ${inf.label} CSV…`} style={{...S.ta,minHeight:80,fontFamily:"monospace",fontSize:10}}/>{csv&&<button style={S.sb} onClick={parse}>Parse →</button>}</>}
        {step==="preview"&&prev2&&<>
          <div style={{fontSize:14,fontWeight:700,color:C.acc}}>{prev2.mapped.length} rows ready</div>
          <div style={{background:C.cb,border:`1px solid ${C.b}`,borderRadius:7,padding:10}}>
            {[["fill","Fill gaps only"],["overwrite","Overwrite"],["skip","Skip existing"]].map(([v,l])=>(
              <label key={v} style={{display:"flex",gap:7,cursor:"pointer",marginBottom:5,alignItems:"center"}}><input type="radio" name="str" value={v} checked={strat===v} onChange={()=>setStrat(v)} style={{accentColor:C.acc}}/><span style={{fontSize:11,color:C.t}}>{l}</span></label>
            ))}
          </div>
          <button style={S.sb} onClick={doImp}>Import {prev2.mapped.length}</button>
          <button style={S.gb} onClick={()=>setStep("paste")}>← Back</button>
        </>}
      </>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI COACH
// ═══════════════════════════════════════════════════════════════════════════════
function AICoach({data,loading,setLoading,response,setResponse,question,setQuestion}){
  const ask=async q=>{if(!q.trim())return;setLoading(true);setResponse("");setResponse(await ai(buildFullPrompt(data),q));setLoading(false);};
  const PS=[
    "Give me a complete integrated health summary across all my test results",
    "Cross-reference my blood panel with my body composition and VO2Max",
    "Based on my DEXA and RMR, what should my daily calorie target be?",
    "What training zones should I prioritise given my current body composition goals?",
    "How do my hormone levels (T, Cortisol, TSH) interact with my fitness metrics?",
    "What should I focus on before my next DexaFit and blood panel in 6 months?",
  ];
  return(
    <div style={S.sec}>
      <div style={S.st}>✦ AI Coach</div>
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {PS.map((p,i)=><button key={i} style={S.qb} onClick={()=>{setQuestion(p);ask(p);}}>{p}</button>)}
      </div>
      <div style={{display:"flex",gap:7}}>
        <input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask anything about your health…" style={{...S.inp,flex:1}} onKeyDown={e=>e.key==="Enter"&&ask(question)}/>
        <button style={S.ab} onClick={()=>ask(question)} disabled={loading}>{loading?"…":"Ask"}</button>
      </div>
      {loading&&<div style={{display:"flex",alignItems:"center",gap:7,color:C.m,fontSize:11,padding:"12px 0"}}><span style={{color:C.acc}}>✦</span><span>Analysing all your data…</span></div>}
      {response&&!loading&&<div style={S.air}><div style={S.aih}>✦ Analysis</div><div style={S.ait}>{response}</div></div>}
      {!response&&!loading&&<div style={S.empty}>Pick a prompt or ask your own question.</div>}
    </div>
  );
}

function aiSummary(data){ return ai(buildFullPrompt(data),"Generate a comprehensive weekly health summary across daily logs, blood panel, DEXA, VO2Max, and RMR data. Include: overall health score, key trends, strengths, priority improvements, and 3 action items for next week.",1500); }

function buildFullPrompt(data){
  const lb=[...(data.labSnapshots||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const tests=data.clinicalTests||[];
  const ct=tests.reduce((acc,t)=>{if(!acc[t.type]||t.date>acc[t.type].date)acc[t.type]=t;return acc;},{});
  return `You are ARNOLD — an elite health coach specialising in longevity and performance optimisation.

USER: ${data.profile.name||"Emil"}, DOB 02/09/1975 (age ~50), Goal: ${data.profile.goal||"performance & longevity"}

DEXA (${ct.dexa?.date||"Mar 2025"}): Total 187 lbs, Lean 134 lbs (target 138), Body Fat 24.7% (target 16.7%), Visceral Fat 1.29 lbs (target 0.60), A/G Ratio 1.12, T-Score 2.80, ALMI 9.1, FFMI 20.2, Spine BMD 37th %ile

VO2MAX (${ct.vo2max?.date||"Mar 2025"}): 51 ml/kg/min (Elite, 98th %ile), Bio Age 33, Lean VO2 72 (99th), Leg Lean VO2 200 (96th), Redline Ratio 89% (70th), Max HR 164, VT1 110, VT2 154

RMR (${ct.rmr?.date||"Mar 2025"}): 1,880 kcal/day (fast), RER 0.84 (Fat 53%/Carbs 47%), Predicted 1,783, Peer avg 1,915

LATEST BLOOD PANEL (${lb[0]?.date||"Dec 2025"}):
${JSON.stringify(lb[0]?.markers||{})}

PREVIOUS BLOOD PANEL (${lb[1]?.date||"Jul 2025"}):
${JSON.stringify(lb[1]?.markers||{})}

DAILY LOGS (last 7): ${JSON.stringify((data.logs||[]).slice(0,7))}

CONTEXT: Clinical tests are 6-month baselines. Daily Garmin/Cronometer data is the ongoing signal. Be precise, cite actual numbers, and connect metrics across test types. Use optimal longevity ranges, not just clinical normals.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileSettings({data,persist,showToast}){
  const[f,sf]=useState({...data.profile});
  const set=k=>e=>sf(p=>({...p,[k]:e.target.value}));
  return(
    <div style={S.sec}>
      <div style={S.st}>Profile</div>
      {[["Name","name","text"],["Age","age","number"],["Height (cm)","height","number"],["Main Goal","goal","text"]].map(([l,k,t])=>(
        <div key={k} style={S.field}><label style={S.fl}>{l}</label><input type={t} value={f[k]||""} onChange={set(k)} style={S.inp}/></div>
      ))}
      <button style={S.sb} onClick={async()=>{await persist({...data,profile:f});showToast("✓ Saved!");}}>Save</button>
      <div style={{height:1,background:C.b,margin:"4px 0"}}/>
      <div style={{fontSize:9,color:"#f87171",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>Danger Zone</div>
      <button style={S.db} onClick={async()=>{if(confirm("Delete all data?"))await persist(DD);}}>Delete All Data</button>
      <div style={{display:"flex",gap:12,fontSize:10,color:C.m}}>
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
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════
const C={bg:"#0a0a0f",surf:"#111118",b:"#1e1e2e",acc:"#c8f55a",ad:"rgba(200,245,90,0.12)",t:"#e8e8e8",m:"#666680",cb:"rgba(255,255,255,0.04)"};
const S={
  root:{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'DM Mono','Courier New',monospace",position:"relative"},
  bg:{position:"fixed",inset:0,backgroundImage:"linear-gradient(rgba(200,245,90,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(200,245,90,0.025) 1px,transparent 1px)",backgroundSize:"40px 40px",pointerEvents:"none"},
  splash:{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:C.bg},
  si:{position:"relative",display:"flex",alignItems:"center",justifyContent:"center"},
  pr:{position:"absolute",width:56,height:56,borderRadius:"50%",border:`2px solid ${C.acc}`,opacity:0.5},
  sl:{fontSize:26,color:C.acc},
  hdr:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:`1px solid ${C.b}`,background:`${C.surf}dd`,backdropFilter:"blur(12px)",position:"sticky",top:0,zIndex:10},
  hl:{display:"flex",alignItems:"center",gap:9},
  logo:{fontSize:20,color:C.acc},
  an:{fontSize:12,fontWeight:700,letterSpacing:"0.2em",color:C.acc},
  as:{fontSize:8,color:C.m,letterSpacing:"0.1em"},
  hr:{display:"flex",alignItems:"center",gap:7},
  un:{fontSize:10,color:C.m},
  dc2:{fontSize:9,background:C.ad,color:C.acc,padding:"2px 7px",borderRadius:3},
  nav:{display:"flex",borderBottom:`1px solid ${C.b}`,background:C.surf,overflowX:"auto"},
  nb:{flex:1,minWidth:48,padding:"8px 2px",background:"none",border:"none",color:C.m,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2},
  nba:{color:C.acc,borderBottom:`2px solid ${C.acc}`},
  ni:{fontSize:13},
  nl:{fontSize:7,letterSpacing:"0.05em"},
  main:{padding:"14px 12px",maxWidth:620,margin:"0 auto",paddingBottom:50},
  sec:{display:"flex",flexDirection:"column",gap:12},
  st:{fontSize:9,letterSpacing:"0.2em",color:C.m,textTransform:"uppercase",paddingBottom:3,borderBottom:`1px solid ${C.b}`},
  // Lab nav
  labNav:{display:"flex",gap:5,flexWrap:"wrap"},
  lnb:{background:C.cb,border:`1px solid ${C.b}`,color:C.m,padding:"5px 10px",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:10},
  lnba:{background:C.ad,borderColor:C.acc,color:C.acc},
  // Cards
  sc:{background:C.cb,border:`1px solid ${C.b}`,borderRadius:7,padding:"11px 12px",display:"flex",flexDirection:"column",gap:3},
  sc2:{background:C.cb,border:"1px solid",borderRadius:7,padding:"10px 11px",display:"flex",flexDirection:"column",gap:2},
  sic:{fontSize:15,color:C.acc,opacity:0.7},
  sv:{fontSize:18,fontWeight:700,color:C.t,letterSpacing:"-0.03em"},
  sl2:{fontSize:9,color:C.m,letterSpacing:"0.07em"},
  ss:{fontSize:7,color:"#333"},
  cg:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7},
  // Snap header
  snap:{background:C.cb,border:"1px solid rgba(200,245,90,0.2)",borderRadius:7,padding:10,display:"flex",justifyContent:"space-between",alignItems:"flex-start"},
  // Trend bar
  tb:{display:"flex",alignItems:"center",gap:7,padding:"8px 11px",border:"1px solid",borderRadius:5,background:"rgba(255,255,255,0.02)"},
  // Dashboard
  wb:{background:`linear-gradient(135deg,${C.ad},rgba(200,245,90,0.03))`,border:`1px solid rgba(200,245,90,0.2)`,borderRadius:7,padding:"13px 14px"},
  wt2:{fontSize:15,fontWeight:700,color:C.acc,letterSpacing:"-0.02em"},
  ws:{fontSize:10,color:C.m,marginTop:3},
  ip:{background:C.ad,border:`1px solid rgba(200,245,90,0.15)`,borderRadius:7,padding:11},
  ih:{fontSize:8,color:C.acc,letterSpacing:"0.1em",marginBottom:5,textTransform:"uppercase"},
  it2:{fontSize:10,color:C.m,lineHeight:1.6},
  empty:{textAlign:"center",color:C.m,fontSize:11,padding:"28px 14px",border:`1px dashed ${C.b}`,borderRadius:7},
  // Log
  lg:{background:C.cb,border:`1px solid ${C.b}`,borderRadius:7,padding:11,display:"flex",flexDirection:"column",gap:7},
  gt:{fontSize:8,color:C.acc,letterSpacing:"0.15em",textTransform:"uppercase"},
  fr:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7},
  field:{display:"flex",flexDirection:"column",gap:3},
  fl:{fontSize:8,color:C.m,letterSpacing:"0.08em",textTransform:"uppercase"},
  inp:{background:"rgba(255,255,255,0.05)",border:`1px solid ${C.b}`,borderRadius:3,color:C.t,padding:"6px 8px",fontFamily:"inherit",fontSize:11,outline:"none",width:"100%",boxSizing:"border-box"},
  ta:{background:"rgba(255,255,255,0.05)",border:`1px solid ${C.b}`,borderRadius:3,color:C.t,padding:"6px 8px",fontFamily:"inherit",fontSize:11,resize:"vertical",minHeight:60,outline:"none",width:"100%",boxSizing:"border-box"},
  eb:{fontSize:8,color:C.acc,background:C.ad,padding:"3px 7px",borderRadius:3,alignSelf:"flex-start"},
  sb:{background:C.acc,color:"#0a0a0f",border:"none",borderRadius:5,padding:"9px 16px",fontFamily:"inherit",fontSize:10,fontWeight:700,letterSpacing:"0.1em",cursor:"pointer",textTransform:"uppercase"},
  gb:{background:"none",border:`1px solid ${C.b}`,color:C.m,borderRadius:5,padding:"8px 13px",fontFamily:"inherit",fontSize:10,cursor:"pointer"},
  db:{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.3)",color:"#f87171",padding:"7px 12px",borderRadius:5,fontFamily:"inherit",fontSize:10,cursor:"pointer"},
  // Import
  scard:{background:C.cb,border:`1px solid ${C.b}`,borderRadius:7,padding:"10px 7px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:5},
  ic:{background:C.cb,border:"1px solid",borderRadius:7,padding:11},
  uz:{border:`2px dashed ${C.b}`,borderRadius:7,padding:"18px",display:"flex",flexDirection:"column",alignItems:"center",gap:4,cursor:"pointer",background:"rgba(255,255,255,0.01)"},
  is:{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"32px 16px",background:C.ad,border:`1px solid rgba(200,245,90,0.3)`,borderRadius:10,textAlign:"center"},
  // AI
  aib:{background:C.acc,color:"#0a0a0f",border:"none",borderRadius:5,padding:"10px 16px",fontFamily:"inherit",fontSize:10,fontWeight:700,letterSpacing:"0.1em",cursor:"pointer",display:"flex",alignItems:"center",gap:6,justifyContent:"center",textTransform:"uppercase"},
  qb:{background:C.cb,border:`1px solid ${C.b}`,color:C.m,padding:"7px 11px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10,textAlign:"left"},
  ab:{background:C.acc,color:"#0a0a0f",border:"none",borderRadius:5,padding:"0 13px",fontFamily:"inherit",fontWeight:700,fontSize:10,cursor:"pointer",whiteSpace:"nowrap"},
  air:{background:C.cb,border:`1px solid rgba(200,245,90,0.2)`,borderRadius:7,padding:12},
  aih:{fontSize:8,color:C.acc,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8},
  ait:{fontSize:11,color:C.t,lineHeight:1.75,whiteSpace:"pre-wrap"},
  toast:{position:"fixed",bottom:18,left:"50%",transform:"translateX(-50%)",background:C.acc,color:"#0a0a0f",padding:"8px 16px",borderRadius:5,fontWeight:700,fontSize:10,zIndex:100},
};
