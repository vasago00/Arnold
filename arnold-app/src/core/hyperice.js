// ─── Hyperice recovery log ───────────────────────────────────────────────────
// Phase 4r.recover.1
//
// User logs which Hyperice product they used (Normatec compression boots,
// Hypervolt percussive gun, Venom 2 heat-vibration wrap, Vyper roller,
// Ice X cold therapy) along with minutes. The post-workout card shows a
// small icon + minute count for the day so recovery activity is visible
// at a glance.
//
// Pure data + storage only. The icon component lives in
// components/HypericeIcon.jsx because Vite requires JSX to be in .jsx
// files.

import { storage } from './storage.js';
// Phase 4r.utc.2 — local-timezone day.
import { localDate } from './time.js';

export const HYPERICE_PRODUCTS = [
  { id: 'normatec',  label: 'Normatec',  short: 'Boots',  category: 'compression' },
  { id: 'hypervolt', label: 'Hypervolt', short: 'Gun',    category: 'percussive'  },
  { id: 'venom2',    label: 'Venom 2',   short: 'Wrap',   category: 'thermal'     },
  { id: 'vyper',     label: 'Vyper',     short: 'Roller', category: 'vibration'   },
  { id: 'icex',      label: 'Ice X',     short: 'Cold',   category: 'thermal'     },
  { id: 'other',     label: 'Other',     short: 'Other',  category: 'other'       },
];

const STORAGE_KEY = 'arnold:hyperice:sessions';

// Each session: { id, productId, minutes, dateStr, ts }
export function getHypericeSessions() {
  try {
    const raw = storage.get(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function getHypericeSessionsForDate(dateStr) {
  return getHypericeSessions().filter(s => s.dateStr === dateStr);
}

export function logHypericeSession({ productId, minutes, dateStr }) {
  if (!productId || !minutes || minutes <= 0) return null;
  const all = getHypericeSessions();
  const session = {
    id: `hi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId,
    minutes: Math.round(parseFloat(minutes)),
    dateStr: dateStr || localDate(),
    ts: Date.now(),
  };
  all.push(session);
  storage.set(STORAGE_KEY, all, { skipValidation: true });
  return session;
}

export function deleteHypericeSession(id) {
  const all = getHypericeSessions().filter(s => s.id !== id);
  storage.set(STORAGE_KEY, all, { skipValidation: true });
}

export function findProduct(productId) {
  return HYPERICE_PRODUCTS.find(p => p.id === productId) || HYPERICE_PRODUCTS[HYPERICE_PRODUCTS.length - 1];
}

// Summary helpers for the card.
export function summarizeDay(dateStr) {
  const sessions = getHypericeSessionsForDate(dateStr);
  return {
    sessions,
    totalMinutes: sessions.reduce((s, x) => s + (x.minutes || 0), 0),
    productCount: new Set(sessions.map(s => s.productId)).size,
  };
}

// Detect Hyperice usage from activity names. If the user logged a Garmin
// "Other" or Mobility activity with the product name in it (e.g.
// "Normatec 20min", "Hypervolt back", "Venom 2 wrap"), pull the product
// + duration into a session-shaped record. Lets users keep their
// existing logging habit (start an activity on the watch / Connect)
// without needing a separate Arnold log step.
//
// Returns an array of { productId, minutes, source: 'activity', activityId }
// or [] if no matches today.
export function detectHypericeFromActivities(activities, dateStr) {
  if (!Array.isArray(activities)) return [];
  const found = [];
  for (const a of activities) {
    if (a.date && a.date !== dateStr) continue;
    const name = String(a.activityName || a.activityType || '').toLowerCase();
    if (!name) continue;
    let productId = null;
    if      (/\bnormatec\b/.test(name) || /\bcompression\s*(boot|sleeve)/.test(name)) productId = 'normatec';
    else if (/\bhypervolt\b|\bhyperbolt\b|\bmassage\s*gun\b/.test(name))               productId = 'hypervolt';
    else if (/\bvenom\b/.test(name))                                                     productId = 'venom2';
    else if (/\bvyper\b|\bvibrating\s*roller\b/.test(name))                              productId = 'vyper';
    else if (/\bice\s*x\b|\bcold\s*therapy\b/.test(name))                                productId = 'icex';
    else if (/\bhyperice\b/.test(name))                                                  productId = 'other';
    if (!productId) continue;
    const minutes = Math.round((a.durationSecs || 0) / 60) || a.durationMin || 0;
    if (minutes <= 0) continue;
    found.push({
      productId,
      minutes,
      source: 'activity',
      activityId: a.id || a.fitId || null,
      _matchedName: a.activityName,
    });
  }
  return found;
}

// Merge stored Hyperice sessions + auto-detected ones from activities,
// dedup by activityId so a Garmin Normatec activity doesn't appear twice
// if the user also tapped "log" manually. Returns the final list to
// render on the workout card.
export function resolveDailyHyperice({ dateStr, activities }) {
  const stored = getHypericeSessionsForDate(dateStr);
  const detected = detectHypericeFromActivities(activities, dateStr);
  // Drop manual entries that have a matching activity-source entry
  // (we'd rather show the activity-derived one since it's tied to real
  // duration data).
  const seenActivityIds = new Set(detected.map(d => d.activityId).filter(Boolean));
  const manual = stored.filter(s => !s.activityId || !seenActivityIds.has(s.activityId));
  return [...detected, ...manual];
}
