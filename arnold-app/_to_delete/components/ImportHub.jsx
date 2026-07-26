// Phase 0.5 (slice 20) — IMPORT_ZONES + processImport + ImportHub moved verbatim
// out of Arnold.jsx. ⚠ PARKED / NOT CURRENTLY USED: this component had no
// <ImportHub> render site anywhere in the web app — it's dead/superseded by the
// wired SyncPanel / DataSync panels. Kept as a standalone, working module in case
// it's ever re-wired (it self-contains its drop zones, auto-detect, Garmin-store
// merge, and import history). Nothing imports this file today; safe to delete if
// the Import Hub isn't coming back. No behavior changes from the monolith original.
import { useState, useEffect, useRef } from "react";
import { C } from "../arnoldTheme.js";
import { storage } from "../core/storage.js";
import {
  getGarmin, saveGarmin, saveCronometer,
  getGarminActivities, saveGarminActivities,
  getGarminHRV, saveGarminHRV,
  getGarminSleep, saveGarminSleep,
  getGarminWeight, saveGarminWeight,
  getImportHistory, saveImportHistory,
} from "../core/memory.js";
import { mergeGarminActivities } from "../core/garminParser.js";
import { parseCSV, mapCrono } from "../core/importParsers.js";
import { parseActivitiesCSV, mergeActivities } from "../core/parsers/activitiesParser.js";
import { parseHRVCSV, mergeHRV } from "../core/parsers/hrvParser.js";
import { parseSleepCSV, mergeSleep } from "../core/parsers/sleepParser.js";
import { parseWeightCSV, mergeWeight } from "../core/parsers/weightParser.js";
import { parseCronometerCSV } from "../core/parsers/cronometerParser.js";
import { detectCSVType } from "../core/parsers/detectType.js";
import { parseFITFile } from "../core/parsers/fitParser.js";
import { isRun as isRunAct } from "../core/activityClass.js";

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

export function ImportHub({data,persist,showToast,setTab}){
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
