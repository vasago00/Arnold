// @vitest-environment node
// GUARD (Emil, ROUND 97, 2026-07-26): *"All writing in Arnold should start with a
// capital letter if this the first or the only word."*
//
// WHY A GUARD AND NOT JUST A FIX. The offending strings were not one mistake, they
// were ~130 of them spread over 26 files — `of 1,880`, `rest day`, `just committed`,
// `all three roads · 6 mi`, `working ▾`, `base 20.7`. That is not a bug, it is DRIFT:
// every round adds a label, and a convention nobody checks decays back to whatever
// each site felt like at the time. One sweep fixes today's screenshot and nothing
// else. This test is what makes the convention hold — a new lowercase label fails on
// Emil's machine before he ever sees it in a screenshot.
//
// SCOPE. Two shapes, both of which are unambiguously a LABEL rather than prose:
//   (1) label-ish object keys — `label: 'x'`, `lbl:`, `sub:`, `word:`, `caption:`,
//       `hint:`, `placeholder:`
//   (2) JSX attribute strings — `placeholder="x"`, `aria-label="x"`, `title="x"`
// Bare JSX TEXT NODES are deliberately NOT scanned: `<span>{label}</span><span>or
// click</span>` is a legitimate mid-sentence continuation, and a guard that cannot
// tell prose from a label would train people to add exceptions rather than fix
// strings. Those were swept by hand in ROUND 97 and are left to review.
//
// EXCEPTIONS are things whose lowercase first letter is the CORRECT spelling —
// unit and assay names, format tokens, example addresses. Capitalising `mL` or
// `hh` would be a different error, not a fix. Keep this list SHORT; if you are
// reaching for it to silence a real label, capitalise the label instead.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(process.cwd(), 'src', 'components');

// Correct-as-lowercase: units, assay names, input format tokens, example values.
const ALLOW = new Set([
  'mL', 'ml/kg/min', 'mg/L', 'mmol/L', 'kcal', 'lb', 'lb/wk', 'mi', 'km', 'min',
  'mins', 'ms', 'ft', 'bpm', 'g', 'hsCRP', 'rTSS', 'hh', 'mm', 'ss', 'reps',
]);
// Attribute names that carry MACHINE values (form option values, input types,
// CSS keywords) rather than writing. `value=` is excluded wholesale for that
// reason — `<option value="marathon">` is data, not a sentence.
const TEXT_ATTRS = /\b(placeholder|aria-label|title)="([a-z][^"{}]*)"/g;
const LABEL_KEYS = /(?<![.\w])(label|lbl|sub|word|caption|hint|placeholder)\s*:\s*'([a-z][^'\\]*)'/g;
// Anything that is plainly not prose: URLs, emails, template holes, e.g.-prefixed
// examples, and single glyphs.
const NOT_WRITING = /^(https?:|[\w.]+@|e\.g\.|\$\{|—|·)/;

function jsxFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsxFiles(p));
    else if (e.name.endsWith('.jsx')) out.push(p);
  }
  return out;
}

function offendersIn(src, file) {
  const out = [];
  for (const re of [TEXT_ATTRS, LABEL_KEYS]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const val = m[2];
      const first = val.split(/[\s/]/)[0];
      if (ALLOW.has(val) || ALLOW.has(first) || NOT_WRITING.test(val)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      out.push(`${file.split(/[\\/]src[\\/]/)[1]}:${line}  ${m[0].slice(0, 60)}`);
    }
  }
  return out;
}

describe('sentence-case guard', () => {
  it('every user-visible label starts with a capital', () => {
    const offenders = [];
    for (const f of jsxFiles(ROOT)) offenders.push(...offendersIn(readFileSync(f, 'utf8'), f));
    expect(
      offenders,
      `Arnold's writing rule: the first (or only) word of a label is capitalised.\n` +
        `Capitalise these, or — only if the lowercase spelling is genuinely correct\n` +
        `(a unit, an assay name, a format token) — add it to ALLOW in this file:\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });
});
