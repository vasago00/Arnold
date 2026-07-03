// Seeded pseudo-random number generator for the simulation harness.
//
// WHY seeded: every simulation run must be REPRODUCIBLE. A failing case reports
// its seed; re-running that seed reproduces the exact athlete + day-stream that
// broke an invariant. No flaky "it failed once" — determinism is the whole point
// of using this as a test.
//
// mulberry32: tiny, fast, well-distributed 32-bit generator (good enough for
// Monte-Carlo property testing; NOT for cryptography).

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;   // → [0,1)
  };

  const uniform = (min, max) => min + (max - min) * next();
  const int = (min, max) => Math.floor(uniform(min, max + 1));
  const chance = (p) => next() < p;
  const choice = (arr) => arr[Math.floor(next() * arr.length)];

  // Box–Muller normal; clamp keeps samples inside a physiological range so a
  // 4-sigma tail can't produce a nonsensical athlete (e.g. negative sleep).
  let spare = null;
  const normal = (mean = 0, sd = 1) => {
    if (spare != null) { const s = spare; spare = null; return mean + sd * s; }
    let u = 0, v = 0, s = 0;
    do { u = next() * 2 - 1; v = next() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const mul = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * mul;
    return mean + sd * (u * mul);
  };
  const clampedNormal = (mean, sd, lo, hi) => Math.max(lo, Math.min(hi, normal(mean, sd)));

  return { next, uniform, int, chance, choice, normal, clampedNormal };
}

export default makeRng;
