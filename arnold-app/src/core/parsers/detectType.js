// ─── CSV Type Auto-Detection ─────────────────────────────────────────────────

export function detectCSVType(text, filename) {
  // Strip BOM (\uFEFF) that Garmin/Excel exports often prepend
  const clean = text.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/);
  const firstLine = (lines[0] || '').toLowerCase();
  // Peek at the next few lines too — key-value CSVs put signal past row 0.
  const head = lines.slice(0, 20).map(l => l.toLowerCase()).join('\n');
  const fname = (filename || '').toLowerCase();

  if (firstLine.includes('activity type') && firstLine.includes('aerobic te'))
    return 'activities';
  if (firstLine.includes('overnight hrv') && firstLine.includes('baseline'))
    return 'hrv';
  // Tabular sleep export (headers on row 0)
  if (firstLine.includes('sleep score') && firstLine.includes('resting heart rate'))
    return 'sleep';
  // Key-value sleep export — Garmin "Sleep Score 1 Day" single-night format.
  // Recognised by the title line plus a "Date,YYYY-MM-DD" row within the head.
  if (firstLine.includes('sleep score') && /\bdate\s*,\s*\d{4}-\d{2}-\d{2}/.test(head))
    return 'sleep';
  if (firstLine.includes('weight') && firstLine.includes('skeletal muscle mass'))
    return 'weight';

  // Standalone Resting Heart Rate export (header: ",Resting Heart Rate" or "Date,Resting Heart Rate")
  if (firstLine.includes('resting heart rate') && !firstLine.includes('sleep score'))
    return 'resting_hr';

  // Cronometer: detect by column signature or filename
  if (firstLine.includes('energy (kcal)') && firstLine.includes('b1 (thiamine)'))
    return 'cronometer';
  if (firstLine.includes('energy (kcal)') && firstLine.includes('protein (g)'))
    return 'cronometer';
  if (fname.includes('daily') || fname.includes('cronometer'))
    return 'cronometer';

  return null;
}
