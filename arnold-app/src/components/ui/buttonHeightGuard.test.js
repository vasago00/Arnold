// @vitest-environment node
// GUARD (POSTMORTEMS.md 2026-06-16): mobile.css forces `button { min-height: 42px
// !important }` unless the button carries `.arnold-compact-btn`. So an inline
// `height` on a bare <button> is silently clamped to 42px — dead code that cost ~6
// rounds of debugging. This fails CI if any such button reappears. Fix = use the
// <Button>/<Pill> primitives (which attach the class) or add the class manually.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(process.cwd(), 'src', 'components');

function jsxFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsxFiles(p));
    else if (e.name.endsWith('.jsx')) out.push(p);
  }
  return out;
}

// Extract each <button ...> opening tag, tracking {} depth so `>` inside arrow
// functions / JSX expressions (e.g. onClick={() => ...}) doesn't end the tag early.
function buttonOpenTags(src) {
  const tags = [];
  let i = 0;
  while ((i = src.indexOf('<button', i)) !== -1) {
    let depth = 0, j = i + 7;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(src.slice(i, j + 1));
    i = j + 1;
  }
  return tags;
}

describe('mobile button height guard', () => {
  it('no bare <button> sets an inline height without .arnold-compact-btn', () => {
    const offenders = [];
    for (const f of jsxFiles(ROOT)) {
      for (const tag of buttonOpenTags(readFileSync(f, 'utf8'))) {
        const hm = tag.match(/height:\s*(\d+)\b/);
        if (hm && Number(hm[1]) < 42 && !/arnold-compact-btn/.test(tag)) {
          offenders.push(`${f.split(/[\\/]src[\\/]/)[1]} :: height ${hm[1]} :: ${tag.replace(/\s+/g, ' ').slice(0, 70)}`);
        }
      }
    }
    expect(offenders, `inline height is dead under mobile.css 42px floor — use <Button>/<Pill> or add .arnold-compact-btn:\n${offenders.join('\n')}\n`).toEqual([]);
  });
});
