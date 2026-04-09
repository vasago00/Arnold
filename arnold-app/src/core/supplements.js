// ─── ARNOLD Supplements ──────────────────────────────────────────────────────
// Three layers: catalog (products), stack (your routine), log (daily intake).
// All seeded from published Supplement Facts labels — VERIFY against your
// bottle since formulas change. Flagged entries marked { verify: true }.

import { storage } from "./storage.js";

// ─── Nutrient benefit tags ───────────────────────────────────────────────────
// Used by the AI + catalog UI to explain "what it helps with".
export const BENEFIT_TAGS = {
  sleep:        { label: 'Sleep',         color: '#a78bfa' },
  recovery:     { label: 'Recovery',      color: '#34d399' },
  immune:       { label: 'Immune',        color: '#22d3ee' },
  cognition:    { label: 'Cognition',     color: '#60a5fa' },
  longevity:    { label: 'Longevity',     color: '#f472b6' },
  energy:       { label: 'Energy',        color: '#fbbf24' },
  inflammation: { label: 'Anti-inflam',   color: '#4ade80' },
  cardio:       { label: 'Cardio',        color: '#f87171' },
  bone:         { label: 'Bone',          color: '#e5e7eb' },
  muscle:       { label: 'Muscle',        color: '#a3e635' },
  gut:          { label: 'Gut',           color: '#fb923c' },
  hormonal:     { label: 'Hormonal',      color: '#c084fc' },
};

// ─── Seed catalog ────────────────────────────────────────────────────────────
// Dose values are per scoop/capsule (per serving as labeled). When you take
// a partial or multiple, the stack layer multiplies. Values rounded.
// Sources noted inline; AG1 formula changes often — verify.
export const SEED_CATALOG = [
  {
    id: 'ag1',
    brand: 'AG1', product: 'Athletic Greens — Original',
    servingSize: '1 scoop (12g)',
    form: 'powder',
    benefits: ['immune','energy','gut','recovery'],
    notes: 'AG1 is a blend of 75+ ingredients. Only major vitamins/minerals tracked here; whole-food, adaptogen and probiotic blends present but not individually quantified on the label.',
    nutrients: [
      { name: 'Calories',        amount: 50,    unit: 'kcal' },
      { name: 'Carbs',           amount: 6,     unit: 'g' },
      { name: 'Fiber',           amount: 2,     unit: 'g' },
      { name: 'Protein',         amount: 2,     unit: 'g' },
      { name: 'Vitamin A',       amount: 2813,  unit: 'IU' },
      { name: 'Vitamin C',       amount: 420,   unit: 'mg' },
      { name: 'Vitamin E',       amount: 80,    unit: 'IU' },
      { name: 'Thiamin (B1)',    amount: 3.6,   unit: 'mg' },
      { name: 'Riboflavin (B2)', amount: 2.0,   unit: 'mg' },
      { name: 'Niacin (B3)',     amount: 20,    unit: 'mg' },
      { name: 'Vitamin B6',      amount: 4.9,   unit: 'mg' },
      { name: 'Folate',          amount: 400,   unit: 'mcg' },
      { name: 'Vitamin B12',     amount: 22.5,  unit: 'mcg' },
      { name: 'Biotin',          amount: 330,   unit: 'mcg' },
      { name: 'Pantothenic acid',amount: 10,    unit: 'mg' },
      { name: 'Calcium',         amount: 111,   unit: 'mg' },
      { name: 'Phosphorus',      amount: 140,   unit: 'mg' },
      { name: 'Magnesium',       amount: 26,    unit: 'mg' },
      { name: 'Zinc',            amount: 15,    unit: 'mg' },
      { name: 'Selenium',        amount: 20,    unit: 'mcg' },
      { name: 'Copper',          amount: 0.4,   unit: 'mg' },
      { name: 'Manganese',       amount: 0.4,   unit: 'mg' },
      { name: 'Chromium',        amount: 20,    unit: 'mcg' },
      { name: 'Sodium',          amount: 45,    unit: 'mg' },
      { name: 'Potassium',       amount: 300,   unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'nmn-resveratrol',
    brand: 'OMRE', product: 'NMN + Resveratrol',
    servingSize: '2 capsules',
    form: 'capsule',
    benefits: ['longevity','energy','cognition'],
    notes: 'NMN is an NAD+ precursor; trans-resveratrol supports mitochondrial function and often paired with NMN for synergistic uptake.',
    nutrients: [
      { name: 'NMN (Nicotinamide Mononucleotide)', amount: 500, unit: 'mg' },
      { name: 'Trans-Resveratrol', amount: 500, unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'spermidine',
    brand: 'OMRE', product: 'Spermidine',
    servingSize: '2 capsules',
    form: 'capsule',
    benefits: ['longevity','cognition'],
    notes: 'Polyamine that triggers autophagy; linked to cellular renewal and healthy aging.',
    nutrients: [
      { name: 'Spermidine (wheat germ extract)', amount: 10, unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'quercetin-fisetin',
    brand: 'OMRE', product: 'Quercetin + Fisetin',
    servingSize: '2 capsules',
    form: 'capsule',
    benefits: ['longevity','inflammation','immune'],
    notes: 'Senolytic flavonoids that help clear senescent cells; fisetin particularly studied for brain aging.',
    nutrients: [
      { name: 'Quercetin', amount: 500, unit: 'mg' },
      { name: 'Fisetin',   amount: 500, unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'vit-d3-naturewise',
    brand: 'NatureWise', product: 'Vitamin D3 5000 IU',
    servingSize: '1 softgel',
    form: 'gel capsule',
    benefits: ['immune','bone','hormonal'],
    notes: 'Fat-soluble; take with a meal containing fat for best absorption.',
    nutrients: [
      { name: 'Vitamin D3 (cholecalciferol)', amount: 5000, unit: 'IU' },
    ],
  },
  {
    id: 'fish-oil-mbg',
    brand: 'mindbodygreen', product: 'Omega-3 Potency+',
    servingSize: '2 softgels',
    form: 'gel capsule',
    benefits: ['cardio','inflammation','cognition'],
    notes: 'Fish oil with a high EPA:DHA ratio; anti-inflammatory and supports cardiovascular function.',
    nutrients: [
      { name: 'Fish Oil (total)', amount: 2000, unit: 'mg' },
      { name: 'EPA',              amount: 1080, unit: 'mg' },
      { name: 'DHA',              amount: 720,  unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'tmg-partiqlar',
    brand: 'PartiQlar', product: 'TMG (Trimethylglycine)',
    servingSize: '1 capsule',
    form: 'capsule',
    benefits: ['cardio','longevity','energy'],
    notes: 'Methyl donor; supports methylation cycle, often paired with NMN to offset methyl depletion.',
    nutrients: [
      { name: 'Trimethylglycine (TMG/Betaine anhydrous)', amount: 1000, unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'turmeric-humann',
    brand: 'HumanN', product: 'Turmeric Gummy',
    servingSize: '1 gummy',
    form: 'gummy',
    benefits: ['inflammation','recovery'],
    notes: 'Curcumin is the active anti-inflammatory compound in turmeric.',
    nutrients: [
      { name: 'Turmeric (curcumin extract)', amount: 200, unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'beet-humann',
    brand: 'HumanN', product: 'SuperBeets Heart Chews',
    servingSize: '1 chew',
    form: 'gummy',
    benefits: ['cardio','energy'],
    notes: 'Beetroot extract boosts nitric oxide for vasodilation, BP, and endurance.',
    nutrients: [
      { name: 'Beetroot powder concentrate', amount: 500, unit: 'mg' },
      { name: 'Grape seed extract',          amount: 150, unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'shilajit-chuga',
    brand: 'Chuga', product: 'Shilajit Resin',
    servingSize: '1 small scoop (~300mg)',
    form: 'resin',
    benefits: ['energy','hormonal','longevity'],
    notes: 'Rich in fulvic and humic acids plus trace minerals; traditionally used as an adaptogen.',
    nutrients: [
      { name: 'Shilajit resin',       amount: 300, unit: 'mg' },
      { name: 'Fulvic acid (approx)', amount: 60,  unit: 'mg' },
    ],
    verify: true,
  },
  {
    id: 'ashwagandha-momentous',
    brand: 'Momentous', product: 'Ashwagandha (KSM-66)',
    servingSize: '1 capsule',
    form: 'capsule',
    benefits: ['sleep','recovery','hormonal'],
    notes: 'KSM-66 is a full-spectrum root extract; cortisol-lowering and supports testosterone.',
    nutrients: [
      { name: 'Ashwagandha (KSM-66)', amount: 600, unit: 'mg' },
    ],
  },
  {
    id: 'magnesium-threonate-momentous',
    brand: 'Momentous', product: 'Magnesium L-Threonate (Magtein)',
    servingSize: '3 capsules',
    form: 'capsule',
    benefits: ['sleep','cognition','recovery'],
    notes: 'Only form of magnesium that crosses the blood-brain barrier effectively.',
    nutrients: [
      { name: 'Magnesium L-Threonate (Magtein)', amount: 2000, unit: 'mg' },
      { name: 'Elemental Magnesium',             amount: 144,  unit: 'mg' },
    ],
  },
  {
    id: 'apigenin-momentous',
    brand: 'Momentous', product: 'Apigenin',
    servingSize: '1 capsule',
    form: 'capsule',
    benefits: ['sleep','longevity'],
    notes: 'Flavonoid that promotes deep sleep and inhibits CD38 (NAD+ preserving).',
    nutrients: [
      { name: 'Apigenin', amount: 50, unit: 'mg' },
    ],
  },
  {
    id: 'b12-naturewise',
    brand: 'NatureWise', product: 'Vitamin B12 Methylcobalamin',
    servingSize: '1 capsule',
    form: 'capsule',
    benefits: ['energy','cognition'],
    notes: 'Methylcobalamin is the active form, more bioavailable than cyanocobalamin.',
    nutrients: [
      { name: 'Vitamin B12 (methylcobalamin)', amount: 5000, unit: 'mcg' },
    ],
  },
];

// ─── Default stack from your xlsx ────────────────────────────────────────────
// { id (unique stack entry id), supplementId, doseMultiplier, timeOfDay, notes }
// doseMultiplier of 0.5 = half serving, 1 = full serving as labeled.
export const DEFAULT_STACK = [
  { id: 's1',  supplementId: 'ag1',                         doseMultiplier: 1,   timeOfDay: 'morning'   },
  { id: 's2',  supplementId: 'shilajit-chuga',              doseMultiplier: 1,   timeOfDay: 'morning'   },
  { id: 's3',  supplementId: 'b12-naturewise',              doseMultiplier: 1,   timeOfDay: 'morning'   },
  { id: 's4',  supplementId: 'nmn-resveratrol',             doseMultiplier: 1,   timeOfDay: 'afternoon' },
  { id: 's5',  supplementId: 'spermidine',                  doseMultiplier: 1,   timeOfDay: 'afternoon' },
  { id: 's6',  supplementId: 'quercetin-fisetin',           doseMultiplier: 1,   timeOfDay: 'afternoon' },
  { id: 's7',  supplementId: 'vit-d3-naturewise',           doseMultiplier: 0.5, timeOfDay: 'afternoon', notes: '½ softgel = 2500 IU' },
  { id: 's8',  supplementId: 'fish-oil-mbg',                doseMultiplier: 1,   timeOfDay: 'afternoon' },
  { id: 's9',  supplementId: 'tmg-partiqlar',               doseMultiplier: 1,   timeOfDay: 'afternoon' },
  { id: 's10', supplementId: 'turmeric-humann',             doseMultiplier: 1,   timeOfDay: 'afternoon' },
  { id: 's11', supplementId: 'beet-humann',                 doseMultiplier: 1,   timeOfDay: 'afternoon' },
  { id: 's12', supplementId: 'ashwagandha-momentous',       doseMultiplier: 1,   timeOfDay: 'evening'   },
  { id: 's13', supplementId: 'magnesium-threonate-momentous', doseMultiplier: 1, timeOfDay: 'evening'   },
  { id: 's14', supplementId: 'apigenin-momentous',          doseMultiplier: 1,   timeOfDay: 'evening'   },
];

export const TIME_SLOTS = [
  { id: 'morning',   label: 'Morning',   icon: '☀' },
  { id: 'afternoon', label: 'Afternoon', icon: '◐' },
  { id: 'evening',   label: 'Evening',   icon: '☾' },
];

// ─── Storage helpers ─────────────────────────────────────────────────────────
export function getCatalog() {
  const stored = storage.get('supplements') || [];
  // Seed on first run
  if (!stored.length) {
    storage.set('supplements', SEED_CATALOG, { skipValidation: true });
    return SEED_CATALOG;
  }
  return stored;
}

export function saveCatalog(catalog) {
  storage.set('supplements', catalog, { skipValidation: true });
}

export function getStack() {
  const stored = storage.get('supplementStack');
  if (!stored) {
    storage.set('supplementStack', DEFAULT_STACK, { skipValidation: true });
    return DEFAULT_STACK;
  }
  return stored;
}

export function saveStack(stack) {
  storage.set('supplementStack', stack, { skipValidation: true });
}

// ─── Daily log ───────────────────────────────────────────────────────────────
// Shape: { 'YYYY-MM-DD': { [stackEntryId]: timestamp } }
export function getSupplementLog() {
  return storage.get('supplementLog') || {};
}

export function getTodayTaken(dateStr) {
  const log = getSupplementLog();
  return log[dateStr] || {};
}

export function toggleTaken(dateStr, stackEntryId) {
  const log = getSupplementLog();
  const today = { ...(log[dateStr] || {}) };
  if (today[stackEntryId]) {
    delete today[stackEntryId];
  } else {
    today[stackEntryId] = Date.now();
  }
  log[dateStr] = today;
  storage.set('supplementLog', log, { skipValidation: true });
  return today;
}

export function takeAllInSlot(dateStr, slotId) {
  const log = getSupplementLog();
  const today = { ...(log[dateStr] || {}) };
  const stack = getStack();
  const ts = Date.now();
  for (const entry of stack) {
    if (entry.timeOfDay === slotId && !today[entry.id]) {
      today[entry.id] = ts;
    }
  }
  log[dateStr] = today;
  storage.set('supplementLog', log, { skipValidation: true });
  return today;
}

// ─── Derived: total daily nutrients from the stack ───────────────────────────
// Used by AI and nutrition views. Sums every nutrient across the stack,
// multiplied by each entry's doseMultiplier.
export function getDailyNutrientTotals() {
  const catalog = getCatalog();
  const stack = getStack();
  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));
  const totals = {}; // { 'Vitamin D3': { amount: 5000, unit: 'IU' } }
  for (const entry of stack) {
    const sup = byId[entry.supplementId];
    if (!sup) continue;
    const mult = entry.doseMultiplier || 1;
    for (const n of sup.nutrients || []) {
      const key = `${n.name}|${n.unit}`;
      if (!totals[key]) totals[key] = { name: n.name, unit: n.unit, amount: 0 };
      totals[key].amount += (n.amount || 0) * mult;
    }
  }
  return Object.values(totals).sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Adherence summary (last N days) ─────────────────────────────────────────
export function getAdherence(nDays = 7) {
  const log = getSupplementLog();
  const stack = getStack();
  if (!stack.length) return { pct: 0, taken: 0, total: 0 };
  const today = new Date();
  let taken = 0, total = 0;
  for (let i = 0; i < nDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const dayLog = log[iso] || {};
    total += stack.length;
    taken += Object.keys(dayLog).length;
  }
  return { pct: total ? Math.round((taken / total) * 100) : 0, taken, total };
}
