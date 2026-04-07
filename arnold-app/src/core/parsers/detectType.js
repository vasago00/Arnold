// ─── CSV Type Auto-Detection ─────────────────────────────────────────────────

export function detectCSVType(text, filename) {
  const firstLine = text.trim().split(/\r?\n/)[0].toLowerCase();
  const fname = (filename || '').toLowerCase();

  if (firstLine.includes('activity type') && firstLine.includes('aerobic te'))
    return 'activities';
  if (firstLine.includes('overnight hrv') && firstLine.includes('baseline'))
    return 'hrv';
  if (firstLine.includes('sleep score') && firstLine.includes('resting heart rate'))
    return 'sleep';
  if (firstLine.includes('weight') && firstLine.includes('skeletal muscle mass'))
    return 'weight';

  // Cronometer: detect by column signature or filename
  if (firstLine.includes('energy (kcal)') && firstLine.includes('b1 (thiamine)'))
    return 'cronometer';
  if (firstLine.includes('energy (kcal)') && firstLine.includes('protein (g)'))
    return 'cronometer';
  if (fname.includes('daily') || fname.includes('cronometer'))
    return 'cronometer';

  return null;
}
