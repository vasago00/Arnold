// ─── Cronometer Daily Summary CSV Parser ─────────────────────────────────────
// Handles the full 61-column dailysummary.csv export from Cronometer.

function parseCSVLine(line) {
  const vals = []; let cur = '', inQ = false;
  for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; } else cur += ch; }
  vals.push(cur);
  return vals.map(v => v.trim().replace(/^"|"$/g, ''));
}

function num(v) {
  if (!v || v === '' || v === '--') return null;
  const n = parseFloat(v.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseDate(raw) {
  if (!raw) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // MM/DD/YYYY or M/D/YYYY
  const m1 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[1].padStart(2, '0')}-${m1[2].padStart(2, '0')}`;
  // Try Date parse
  const d = new Date(raw);
  return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

export function parseCronometerCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const hdrs = parseCSVLine(lines[0]);
  const col = {};
  hdrs.forEach((h, i) => { col[h.toLowerCase().trim()] = i; });

  // Helper: find column by partial name match
  const g = (row, ...names) => {
    for (const name of names) {
      const idx = Object.keys(col).find(k => k.includes(name.toLowerCase()));
      if (idx !== undefined && col[idx] < row.length) {
        const v = row[col[idx]];
        return v;
      }
    }
    return null;
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 3) continue;

    const rawDate = g(row, 'date');
    const date = parseDate(rawDate);
    if (!date) continue;

    const completed = (g(row, 'completed') || '').toLowerCase();

    results.push({
      date,
      calories: num(g(row, 'energy (kcal)', 'energy')),
      protein: num(g(row, 'protein (g)', 'protein')),
      carbs: num(g(row, 'carbs (g)', 'carbohydrates')),
      netCarbs: num(g(row, 'net carbs')),
      fat: num(g(row, 'fat (g)')),
      fiber: num(g(row, 'fiber (g)', 'fiber')),
      sugar: num(g(row, 'sugars (g)', 'sugar')),
      saturatedFat: num(g(row, 'saturated (g)', 'saturated fat')),
      omega3: num(g(row, 'omega-3 (g)', 'omega-3')),
      alcohol: num(g(row, 'alcohol (g)', 'alcohol')),
      caffeine: num(g(row, 'caffeine (mg)', 'caffeine')),
      water: num(g(row, 'water (g)', 'water')),
      sodium: num(g(row, 'sodium (mg)', 'sodium')),
      potassium: num(g(row, 'potassium (mg)', 'potassium')),
      magnesium: num(g(row, 'magnesium (mg)', 'magnesium')),
      calcium: num(g(row, 'calcium (mg)', 'calcium')),
      iron: num(g(row, 'iron (mg)')),
      vitaminD: num(g(row, 'vitamin d (iu)', 'vitamin d')),
      vitaminC: num(g(row, 'vitamin c (mg)', 'vitamin c')),
      vitaminA: num(g(row, 'vitamin a')),
      vitaminB12: num(g(row, 'b12 (cobalamin)', 'b12')),
      folate: num(g(row, 'folate')),
      zinc: num(g(row, 'zinc (mg)', 'zinc')),
      cholesterol: num(g(row, 'cholesterol (mg)', 'cholesterol')),
      completed: completed === 'true' || completed === 'yes' || completed === '1',
      source: 'cronometer-daily',
    });
  }

  return results.sort((a, b) => b.date.localeCompare(a.date));
}
