// Phase 0.5 (slice 17) — ClinicalModule extracted verbatim from Arnold.jsx.
// The clinical/Core tab: Overview + DEXA / VO₂ Max / RMR sub-tabs, the historical
// scan-picker, the PDF-upload→preview→save flow, and the cross-test AI analysis.
// Sub-component ScanPicker is internal. Dependency-light: C/S/ai/buildFullPrompt
// + React hooks; `data`/`persist`/`showToast` are props. The ONLY change from the
// in-monolith original is the lazy pdfParser import path (./core → ../core),
// since this file now lives one directory deeper.
import { useState, useRef, useMemo } from "react";
import { C } from "../arnoldTheme.js";
import { S } from "../arnoldStyles.js";
import { ai, buildFullPrompt } from "../core/ai.js";

export function ClinicalModule({data,persist,showToast}){
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
      const { parseClinicalPDF } = await import('../core/pdfParser.js');
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

  // Phase 4r.narrative.5.fix.5 — page-title header removed on both web
  // and mobile. Web: top nav already says "Core". Mobile: unified
  // per-tab header in Arnold.jsx already says "Core". The sub-nav
  // (Overview/DEXA/VO2/RMR) sits directly below the page nav now.
  return(
    <div style={S.sec}>
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

        // Phase 4r.core.1 — sub text shortened: dropped the "🔬 Lab ·" /
        // "🔬 DEXA ·" prefixes and the "(DEXA only)" suffix so the tile reads
        // cleanly at 3-col mobile width. The label already says what it is;
        // the source live in the tile's accent colour.
        const cards = [
          {label:"VO₂ Max",     value: fmt(vo2Headline),     unit:"ml/kg/min", sub: vo2Sub,                                                                  color:"#34d399", icon:"◈"},
          {label:"Bio Age",     value: fmt(v2.bioAge),       unit:"years",     sub: v2.bioAge != null ? labVO2Date : "—",                                    color:"#4ade80", icon:"∿"},
          {label:"Body Fat",    value: fmt1(bodyFat.value),  unit:"%",         sub: bodyFat.sub,                                                             color:"#f59e0b", icon:"⊗"},
          {label:"Lean Mass",   value: fmt(leanMass.value),  unit:"lbs",       sub: leanMass.sub,                                                            color:"#a78bfa", icon:"◆"},
          {label:"Weight",      value: fmt1(weight.value),   unit:"lbs",       sub: weight.sub,                                                              color:"#60a5fa", icon:"⚖"},
          {label:"RMR",         value: fmtKcal(rm.rmr),      unit:"kcal",      sub: latest.rmr?.date || "—",                                                 color:"#4ade80", icon:"⬡"},
          {label:"T-Score",     value: fmt(dxa.tScore),      unit:"",          sub: dxa.tScore     != null ? latest.dexa.date : "—",                         color:"#4ade80", icon:"○"},
          {label:"Visceral Fat",value: fmt(dxa.visceralFat), unit:"lbs",       sub: dxa.visceralFat!= null ? latest.dexa.date : "—",                         color:"#facc15", icon:"⚡"},
          {label:"ALMI",        value: fmt(dxa.almi),        unit:"kg/m²",     sub: dxa.almi       != null ? latest.dexa.date : "—",                         color:"#fb923c", icon:"◉"},
        ];
        return (<>
        {/* Phase 4r.core.1 — auto-fit grid lands ~3 cols on a phone, 4–5 on
            desktop, instead of the old fixed 2×5 stack of oversized tiles.
            Tile padding tightened (was clamp(12,1vw,18) on S.sc2). */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(110px, 1fr))",gap:6}}>
          {cards.map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.color}40`,padding:"9px 10px",gap:2,minWidth:0}}>
              <div style={{fontSize:12,color:c.color,opacity:0.8,lineHeight:1}}>{c.icon}</div>
              <div style={{fontSize:"clamp(15px,1vw + 10px,22px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em",lineHeight:1.1}}>{c.value}<span style={{fontSize:"clamp(9px,0.3vw + 7px,11px)",color:C.m,fontWeight:400,marginLeft:3}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(9px,0.2vw + 8px,10px)",color:C.m,letterSpacing:"0.05em",textTransform:"uppercase",lineHeight:1.2}}>{c.label}</div>
              <div style={{fontSize:"clamp(9px,0.2vw + 8px,10px)",color:c.color,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.sub}</div>
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
        {/* Phase 4r.core.1 — auto-fit grid + tighter tiles to match Overview. */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(110px, 1fr))",gap:6}}>
          {cards.map((c,i)=>(
            <div key={i} style={{...S.sc2,borderColor:`${c.clr}30`,padding:"9px 10px",gap:2,minWidth:0}}>
              <div style={{fontSize:"clamp(15px,1vw + 10px,22px)",fontWeight:500,color:C.t,lineHeight:1.1}}>{c.val}<span style={{fontSize:"clamp(9px,0.3vw + 7px,11px)",color:C.m,fontWeight:400,marginLeft:2}}>{c.unit}</span></div>
              <div style={{fontSize:"clamp(9px,0.2vw + 8px,10px)",color:C.m,letterSpacing:"0.05em",textTransform:"uppercase",lineHeight:1.2}}>{c.lbl}</div>
              <div style={{fontSize:"clamp(9px,0.2vw + 8px,10px)",color:c.clr,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.note}</div>
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
