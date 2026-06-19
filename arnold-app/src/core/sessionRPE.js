// Session-RPE (Foster CR-10) — internal-load capture.
//
// sRPE load = RPE × duration(min) is a validated internal-load metric (Foster et
// al.; 36+ studies) that works for EVERY activity — including strength, mobility,
// and HR-unreliable sessions where rTSS under- or over-states the true cost. We
// store one rating per session, keyed by a stable signature so a Garmin re-sync
// doesn't lose it. Pure data layer; UI lives in components/SessionRPE.jsx.

import { storage } from './storage.js';

// Modified CR-10 scale (Foster). One-tap values 0–10 with plain-language anchors.
export const CR10 = [
  { v: 0,  label: 'Rest' },
  { v: 1,  label: 'Very easy' },
  { v: 2,  label: 'Easy' },
  { v: 3,  label: 'Moderate' },
  { v: 4,  label: 'Somewhat hard' },
  { v: 5,  label: 'Hard' },
  { v: 6,  label: 'Hard +' },
  { v: 7,  label: 'Very hard' },
  { v: 8,  label: 'Very hard +' },
  { v: 9,  label: 'Near maximal' },
  { v: 10, label: 'Maximal' },
];

// Stable per-session key — survives Garmin re-syncs (no reliance on a mutable id).
export function rpeKey(activity, dateStr) {
  const d = activity?.date || dateStr || '';
  const t = activity?.activityType || activity?.activityName || 'session';
  const dur = Math.round(Number(activity?.durationSecs) || 0);
  return `${d}|${t}|${dur}`;
}

// sRPE load in arbitrary units (AU) = RPE × minutes.
export function sessionLoad(rpe, durationSecs) {
  if (!(rpe >= 0) || !(durationSecs > 0)) return null;
  return Math.round(rpe * (durationSecs / 60));
}

export function getSessionRPE(activity, dateStr) {
  const all = storage.get('sessionRPE') || {};
  const e = all[rpeKey(activity, dateStr)];
  return e && Number.isFinite(e.rpe) ? e.rpe : null;
}

export function setSessionRPE(activity, dateStr, rpe) {
  const all = storage.get('sessionRPE') || {};
  const key = rpeKey(activity, dateStr);
  const load = sessionLoad(rpe, Number(activity?.durationSecs) || 0);
  all[key] = { rpe, load, ts: Date.now() };
  try { storage.set('sessionRPE', all, { skipValidation: true }); } catch {}
  return { rpe, load };
}

// sRPE → rTSS-equivalent. sRPE is in AU (RPE×min); rTSS is benchmarked so 100 =
// 1 h at threshold ≈ RPE 7.5 × 60 = 450 AU. So ÷4.5 maps sRPE onto the rTSS scale,
// letting perceived effort act as a load FLOOR for HR-unreliable days (strength).
const SRPE_AU_PER_RTSS = 4.5;
export function srpeEquivRTSS(activity, dateStr) {
  const rpe = getSessionRPE(activity, dateStr);
  const load = sessionLoad(rpe, Number(activity?.durationSecs) || 0);
  return load != null ? +(load / SRPE_AU_PER_RTSS).toFixed(1) : null;
}

// Coarse load banding for color/wording (sRPE AU).
export function loadTier(load) {
  if (load == null) return { tier: '—', color: '#94a3b8' };
  if (load < 150) return { tier: 'light',     color: '#4ade80' };
  if (load < 300) return { tier: 'moderate',  color: '#22d3ee' };
  if (load < 500) return { tier: 'hard',      color: '#fbbf24' };
  return            { tier: 'very hard', color: '#f87171' };
}
