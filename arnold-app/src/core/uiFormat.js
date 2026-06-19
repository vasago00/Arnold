// Small display/format utilities — Phase 0.5 monolith slice 3. Extracted verbatim
// from Arnold.jsx: a grab-bag of tiny, widely-used helpers (today-string, value
// formatter, HRV/biomarker color, id gen, pace, days-until, race badge) + two
// small constant maps. Pure except for the two clearly-named imports below.
import { BM } from './biomarkers.js';
import { parseLocalDate } from './dateUtils.js';

export const td = (dt = new Date()) => { const d = dt instanceof Date ? dt : new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const fmt = (v, u = "") => (v !== "" && v != null ? `${v}${u}` : "—");
export const Q = ["—","1","2","3","4","5"];
export const HRV_L = { excellent:"Excellent", good:"Good", moderate:"Moderate", low:"Low" };

export function hc(hrv){ const n=parseFloat(hrv); if(isNaN(n))return"#aaa"; if(n>=70)return"#4ade80"; if(n>=50)return"#facc15"; if(n>=35)return"#fb923c"; return"#f87171"; }
export function dc(name,delta){ const m=BM[name]; if(!m)return"#aaa"; if(m.dir==="high")return delta>0?"#4ade80":"#f87171"; if(m.dir==="low")return delta<0?"#4ade80":"#f87171"; return"#aaa"; }
export function genId(){ return (crypto.randomUUID?.())||`${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function calcPace(duration,distance){
  const m=parseFloat(duration),d=parseFloat(distance);
  if(isNaN(m)||isNaN(d)||d===0)return"";
  const pm=m/d;const min=Math.floor(pm);const sec=Math.round((pm-min)*60);
  return`${min}:${sec.toString().padStart(2,"0")}`;
}

export function daysUntil(dateStr){
  const now=new Date();now.setHours(0,0,0,0);
  const target=parseLocalDate(dateStr);if(!target)return 0;
  target.setHours(0,0,0,0);
  return Math.round((target-now)/(1000*60*60*24));
}

export function raceTypeBadge(distKm){
  const d=parseFloat(distKm);
  if(isNaN(d))return"Other";
  if(d<=5.1)return"5K";if(d<=10.1)return"10K";if(d<=21.2)return"Half";if(d<=42.3)return"Full";return"Ultra";
}
