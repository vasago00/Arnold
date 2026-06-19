// AI / cloud-sync layer — Phase 0.5 monolith slice 5. Extracted verbatim from
// Arnold.jsx: the Anthropic call helpers (`ai`, streaming `aiStream`), the
// Worker-proxy/key resolvers, and the prompt builders (`buildFullPrompt`,
// `aiSummary`). This is infrastructure, not UI — it belongs in core/.
//
// Routed through the Cloud Sync Worker's /ai/messages endpoint:
//   - No CORS (Worker is server-side relative to api.anthropic.com)
//   - No API key in the bundle (ANTHROPIC_API_KEY is a Worker secret)
//   - Rate limiting (60 calls/hour per token, see worker.js handleAIMessages)
// Direct-browser path kept as a fallback for when the Worker is unconfigured.
//
// FIXED 2026-06-13: `aiStream` previously called an undefined `AI_HDR()`, so the
// streaming path threw "AI_HDR is not defined" if reached (the training-summary
// feature). Replaced with the same direct-browser Anthropic headers used by the
// non-streaming `ai()` fallback (x-api-key + anthropic-version + browser-access).
import { td } from './uiFormat.js';
import { getCatalog as getSupCatalog, getStack as getSupStack, getAdherence as getSupAdherence } from './supplements.js';

const AI_WORKER_ENDPOINT = () => (localStorage.getItem('arnold:cloud-sync:endpoint') || '').replace(/\/$/, '');
const AI_WORKER_TOKEN    = () => localStorage.getItem('arnold:cloud-sync:token') || '';
const AI_KEY = () => import.meta.env.VITE_ANTHROPIC_API_KEY || ''; // legacy / fallback only

export async function ai(system, user, max = 1200) {
  // Preferred path: Worker proxy
  const ep = AI_WORKER_ENDPOINT();
  const tok = AI_WORKER_TOKEN();
  if (ep && tok) {
    try {
      const r = await fetch(`${ep}/ai/messages`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'authorization': `Bearer ${tok}`,
        },
        body: JSON.stringify({ system, user, max, model: 'claude-sonnet-4-5-20250929' }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        // 503 ai_not_configured → fall through to direct-browser path
        if (e?.error === 'ai_not_configured') {
          /* fall through */
        } else {
          return `API error ${r.status}: ${e.error?.message || e?.detail || e?.error || 'Unknown error'}`;
        }
      } else {
        const d = await r.json();
        return d.content?.[0]?.text || 'No response.';
      }
    } catch (err) {
      console.warn('[ai] Worker proxy failed, trying direct:', err?.message || err);
      /* fall through to direct */
    }
  }
  // Fallback: direct browser → Anthropic. Requires VITE_ANTHROPIC_API_KEY in
  // the bundle and a browser-allowed key. Subject to CORS issues post-2024.
  if (!AI_KEY()) return 'AI not configured — set ANTHROPIC_API_KEY on the Worker via `wrangler secret put`, or add VITE_ANTHROPIC_API_KEY to .env';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_KEY(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-dangerous-allow-browser': 'true',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return `API error ${r.status}: ${e.error?.message || 'Unknown error'}`; }
  const d = await r.json();
  return d.content?.[0]?.text || 'No response.';
}

export async function aiStream(system,user,max=1800,onChunk){
  if(!AI_KEY())throw new Error("API key not configured — add VITE_ANTHROPIC_API_KEY to arnold-app/.env");
  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{
      'Content-Type': 'application/json',
      'x-api-key': AI_KEY(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-dangerous-allow-browser': 'true',
    },
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

export function aiSummary(data,onChunk){
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

export function buildFullPrompt(data){
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

SUPPLEMENT STACK: ${(()=>{try{const cat=getSupCatalog();const st=getSupStack();const by=Object.fromEntries(cat.map(s=>[s.id,s]));const adh=getSupAdherence(7);const lines=st.map(e=>{const s=by[e.supplementId];return s?`${s.brand} ${s.product} (${e.timeOfDay}${e.doseMultiplier!==1?`, ${e.doseMultiplier}x`:''})`:null;}).filter(Boolean);return `${lines.length} daily · ${adh.pct}% 7-day adherence\n${lines.join('; ')}`;}catch{return 'n/a';}})()}

CONTEXT: Clinical tests are 6-month baselines. Daily Garmin/Cronometer data is the ongoing signal. Training data from Garmin CSV is prepended as [ARNOLD TRAINING CONTEXT]. Be precise, cite actual numbers, and connect metrics across test types. Use optimal longevity ranges, not just clinical normals.`;
}
