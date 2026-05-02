// Local Garmin relay smoke test.
//
// Workflow:
//   1. In one terminal, from arnold-worker/, run:
//        npx wrangler dev --port 8787
//      (loads SYNC_TOKEN from `wrangler secret put` or .dev.vars)
//
//   2. In another terminal, set creds and run this:
//        export GARMIN_USER='you@example.com'
//        export GARMIN_PASS='your-garmin-password'
//        export SYNC_TOKEN='same-bearer-as-the-worker'
//        export TEST_DATE='2026-04-28'           # optional, default: yesterday
//        node test-garmin.mjs
//
// The script hits /garmin/sleep first (smallest payload, fastest auth check),
// then if that works it pulls /garmin/all and prints a compact summary so you
// can cross-check Sleep Score / Body Battery / Stress against Garmin Connect web.
//
// All credentials stay local — they're POSTed to your locally-running
// `wrangler dev` instance, which talks to Garmin from your IP. Once you're
// happy with the output, deploy and the same flow runs from Cloudflare's edge.

const ENDPOINT  = process.env.WORKER_URL || 'http://localhost:8787';
const USER      = process.env.GARMIN_USER;
const PASS      = process.env.GARMIN_PASS;
const TOKEN     = process.env.SYNC_TOKEN;
const TEST_DATE = process.env.TEST_DATE || (() => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

if (!USER || !PASS || !TOKEN) {
  console.error('Missing env. Set GARMIN_USER, GARMIN_PASS, SYNC_TOKEN.');
  process.exit(1);
}

async function call(path) {
  const t0 = Date.now();
  const res = await fetch(`${ENDPOINT}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ user: USER, pass: PASS, date: TEST_DATE }),
  });
  const ms = Date.now() - t0;
  let body;
  try { body = await res.json(); } catch { body = { _raw: await res.text() }; }
  return { status: res.status, ms, body };
}

console.log(`▶ Garmin relay test  date=${TEST_DATE}  endpoint=${ENDPOINT}`);
console.log(`  user=${USER}  (password length ${PASS.length})\n`);

console.log('─── /garmin/sleep ──────────────────────────────────────────────');
const sleep = await call('/garmin/sleep');
console.log(`  status=${sleep.status}  took=${sleep.ms}ms`);
if (sleep.status !== 200) {
  console.log('  body:', JSON.stringify(sleep.body, null, 2).slice(0, 800));
  process.exit(1);
}

const dto = sleep.body?.sleep?.dailySleepDTO || {};
const scores = dto.sleepScores?.overall || {};
console.log(`  sleepScore        = ${scores.value}  (${scores.qualifierKey || '?'})`);
console.log(`  totalSleepHrs     = ${(dto.sleepTimeSeconds || 0) / 3600 | 0}h ${Math.round(((dto.sleepTimeSeconds || 0) % 3600) / 60)}m`);
console.log(`  deepMin           = ${Math.round((dto.deepSleepSeconds || 0) / 60)}`);
console.log(`  remMin            = ${Math.round((dto.remSleepSeconds || 0) / 60)}`);
console.log(`  lightMin          = ${Math.round((dto.lightSleepSeconds || 0) / 60)}`);
console.log(`  awakeMin          = ${Math.round((dto.awakeSleepSeconds || 0) / 60)}`);
console.log(`  restingHR         = ${dto.restingHeartRate}`);
console.log(`  avgOvernightHRV   = ${dto.avgOvernightHrv}`);
console.log(`  avgSleepStress    = ${dto.avgSleepStress}`);
console.log(`  bodyBatteryChange = ${dto.bodyBatteryChange}`);
console.log(`  avgRespiration    = ${dto.averageRespiration}\n`);

console.log('─── /garmin/all ────────────────────────────────────────────────');
const all = await call('/garmin/all');
console.log(`  status=${all.status}  took=${all.ms}ms  cached=${all.body?.cached}\n`);

const stress = all.body?.stress || {};
console.log('  STRESS:');
console.log(`    avg       = ${stress.avgStressLevel}`);
console.log(`    max       = ${stress.maxStressLevel}`);
console.log(`    restMins  = ${stress.restStressDuration / 60 | 0}`);
console.log(`    lowMins   = ${stress.lowStressDuration / 60 | 0}`);
console.log(`    medMins   = ${stress.mediumStressDuration / 60 | 0}`);
console.log(`    highMins  = ${stress.highStressDuration / 60 | 0}\n`);

const bb = (all.body?.body && Array.isArray(all.body.body) ? all.body.body[0] : all.body?.body) || {};
console.log('  BODY BATTERY:');
console.log(`    charged   = ${bb.charged}`);
console.log(`    drained   = ${bb.drained}`);
console.log(`    samples   = ${(bb.bodyBatteryValuesArray || []).length}\n`);

const readiness = Array.isArray(all.body?.readiness) ? all.body.readiness[0] : all.body?.readiness;
console.log('  TRAINING READINESS:');
if (readiness && !readiness.error) {
  console.log(`    score     = ${readiness.score}`);
  console.log(`    level     = ${readiness.level}`);
  console.log(`    feedback  = ${readiness.feedbackLong || readiness.feedbackShort}`);
} else {
  console.log(`    (no reading for this date — ${readiness?.error || 'empty'})`);
}
console.log('');

const summary = all.body?.summary || {};
console.log('  DAILY SUMMARY:');
console.log(`    steps         = ${summary.totalSteps}`);
console.log(`    activeKcal    = ${summary.activeKilocalories}`);
console.log(`    totalKcal     = ${summary.totalKilocalories}`);
console.log(`    intensityMins = ${summary.moderateIntensityMinutes + summary.vigorousIntensityMinutes * 2}`);
console.log(`    floorsClimbed = ${summary.floorsAscended}\n`);

console.log('✓ Done.  If Sleep Score matches what Garmin Connect shows for ' + TEST_DATE + ', the relay is working.');
