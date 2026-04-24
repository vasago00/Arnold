#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Worker /cronometer/pull smoke test
//
// Usage:
//   CRONO_USER=you@example.com \
//   CRONO_PASS=yourpw \
//   SYNC_TOKEN=your-bearer \
//   node scripts/worker-crono-test.mjs
//
// Optional:
//   --url=http://localhost:8787     (default)
//   --date=2026-04-22               (default: today local)
//   --type=servings                 (default)
// ─────────────────────────────────────────────────────────────────────────────

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const user  = process.env.CRONO_USER;
const pass  = process.env.CRONO_PASS;
const token = process.env.SYNC_TOKEN;
if (!user || !pass || !token) {
  console.error('Missing env vars. Set CRONO_USER, CRONO_PASS, SYNC_TOKEN.');
  process.exit(1);
}

const d = new Date();
const todayLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const url  = arg('url', 'http://localhost:8787');
const date = arg('date', todayLocal);
const type = arg('type', 'servings');

console.log(`→ POST ${url}/cronometer/pull  date=${date} type=${type} user=${user}`);

const res = await fetch(`${url}/cronometer/pull`, {
  method: 'POST',
  headers: {
    'authorization': `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ user, pass, date, type }),
});

const text = await res.text();
let json; try { json = JSON.parse(text); } catch { json = null; }

console.log(`\n← HTTP ${res.status}`);
if (!json) {
  console.log(text);
  process.exit(res.ok ? 0 : 2);
}

if (json.error) {
  console.log(JSON.stringify(json, null, 2));
  process.exit(2);
}

console.log(`  rowCount: ${json.rowCount}`);
console.log(`  cached:   ${json.cached}`);
console.log(`  fetchedAt: ${new Date(json.fetchedAt).toISOString()}`);

const t = json.totals || {};
const pick = (n) => t[n] ?? '—';
console.log(`\n── HEADLINE (${date}) ───────────────────────────────`);
console.log(`  Calories (kcal):  ${pick('Energy (kcal)')}`);
console.log(`  Protein  (g):     ${pick('Protein (g)')}`);
console.log(`  Carbs    (g):     ${pick('Carbs (g)')}`);
console.log(`  Fat      (g):     ${pick('Fat (g)')}`);
console.log(`  Water    (g):     ${pick('Water (g)')}`);

console.log(`\n── FIRST 3 ENTRIES ───────────────────────────────────`);
for (const r of (json.rows || []).slice(0, 3)) {
  console.log(`  ${r.Time || '—'}  ${r.Group}  ${r['Food Name']}  (${r.Amount})`);
}

console.log(`\n✓ Worker test complete`);
