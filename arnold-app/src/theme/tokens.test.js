// Locks the single color source (Phase 0.4). Guards the 0.1 token migration —
// every discipline must have a category color, and STATUS must be complete.
import { describe, it, expect } from 'vitest';
import { CATEGORY, STATUS, categoryColor } from './tokens.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('tokens — CATEGORY', () => {
  const disciplines = [
    'run', 'easy_run', 'long_run', 'tempo', 'intervals',
    'strength', 'hiit', 'mobility', 'cross',
    'cycle', 'swim', 'ski', 'walk', 'race', 'rest',
  ];
  it('has a hex color for every plannable discipline + family', () => {
    for (const d of disciplines) {
      expect(CATEGORY[d], `missing CATEGORY.${d}`).toMatch(HEX);
    }
  });
  it('categoryColor falls back to neutral (rest) for unknown keys', () => {
    expect(categoryColor('nope')).toBe(CATEGORY.rest);
  });
});

describe('tokens — STATUS', () => {
  it('has the full ramp', () => {
    for (const k of ['good', 'warn', 'hot', 'bad', 'over']) {
      expect(STATUS[k], `missing STATUS.${k}`).toMatch(HEX);
    }
    expect(STATUS.neutral).toMatch(HEX);
  });
});
