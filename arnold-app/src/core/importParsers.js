// CSV / import parsers — Phase 0.5 monolith slice 2. Extracted verbatim from
// Arnold.jsx. Pure functions (string/row → structured rows); they reference only
// each other (mapGarmin/mapCrono use ndate), no app state. Used by the data-load
// + import flows.

export function parseCSV(text){
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

export function parseLabCSV(text){
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

export function ndate(raw){
  if(!raw)return null;
  if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10);
  const m=raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m)return`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  return null;
}

// ─── Garmin column mapping (structured for specific columns) ──────────────────
export function mapGarmin(rows){
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
export function mapCrono(rows){
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

export function mergeLogs(ex,inc,strat){
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
