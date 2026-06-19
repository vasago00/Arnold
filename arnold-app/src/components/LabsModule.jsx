// Labs tab — Phase 0.5 monolith slice 7. `LabsModule` (blood-panel viewer +
// CSV import + AI analysis) and its internal `LabSparkline`, lifted verbatim
// from Arnold.jsx. All deps are now importable (C/S/ai/biomarkers/etc.).
import { useState, useEffect, useRef } from "react";
import { C } from "../arnoldTheme.js";
import { S } from "../arnoldStyles.js";
import { BM, BCATS, BCAT_CLR, BCAT_ICO, bStatus, SC, SL, SC_BG, SC_BORDER } from "../core/biomarkers.js";
import { parseLabCSV } from "../core/importParsers.js";
import { ai, buildFullPrompt } from "../core/ai.js";
import { dc } from "../core/uiFormat.js";

export function LabsModule({data,persist,showToast}){
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

  // Phase 4r.narrative.5.fix.5 — page-title header removed on both web
  // and mobile. Top nav (web) / mobile per-tab header already say "Labs".
  // Overview/Upload sub-nav now sits directly below.
  return(
    <div style={S.sec}>
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

export default LabsModule;
