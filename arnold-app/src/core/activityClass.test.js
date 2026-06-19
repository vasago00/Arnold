// Locks the activity classifier's behavior (Phase 0.4). This is the contract the
// 0.3b dedup must preserve when CalendarTab + Arnold._resolvePlanType stop
// re-implementing classification and call these helpers instead.
import { describe, it, expect } from 'vitest';
import { activityKind, isCycling, isSwim, isRun, isStrength, isSki, isWalk } from './activityClass.js';

describe('activityKind — discipline classification', () => {
  it('classifies a distance run as run', () => {
    expect(activityKind({ activityType: 'Run', distanceMi: 5 })).toBe('run');
    expect(activityKind({ activityType: 'Easy Run', distanceMi: 6 })).toBe('run');
  });
  it('classifies strength', () => {
    expect(activityKind({ activityType: 'Strength Training' })).toBe('strength');
  });
  it('classifies cycling from type AND from name', () => {
    expect(activityKind({ activityType: 'Cycling' })).toBe('cycling');
    expect(activityKind({ activityName: 'Indoor Cycling' })).toBe('cycling');
  });
  it('classifies swim', () => {
    expect(activityKind({ activityType: 'Pool Swim' })).toBe('swim');
  });
  it('classifies mobility', () => {
    expect(activityKind({ activityType: 'Yoga' })).toBe('mobility');
  });
  it('classifies HIIT', () => {
    expect(activityKind({ activityType: 'HIIT' })).toBe('hiit');
  });
  it('falls back to other for walk/row/etc.', () => {
    expect(activityKind({ activityType: 'Walk' })).toBe('other');
    expect(activityKind({ activityType: 'Rowing' })).toBe('other');
  });
});

describe('discipline predicates', () => {
  it('isCycling / isSwim read type + name', () => {
    expect(isCycling({ activityType: 'Gravel Bike' })).toBe(true);
    expect(isSwim({ activityName: 'Open Water Swim' })).toBe(true);
    expect(isCycling({ activityType: 'Run' })).toBe(false);
  });
  it('isRun matches running variants', () => {
    expect(isRun({ activityType: 'Trail Run', distanceMi: 8 })).toBe(true);
    expect(isStrength({ activityType: 'Strength' })).toBe(true);
  });
});

describe('isSki / isWalk — centralized name detection (0.3b)', () => {
  it('isSki matches ski/snowboard variants', () => {
    expect(isSki({ activityType: 'Alpine Ski' })).toBe(true);
    expect(isSki({ activityName: 'Backcountry Skiing' })).toBe(true);
    expect(isSki({ activityType: 'Snowboarding' })).toBe(true);
    expect(isSki({ activityType: 'Run' })).toBe(false);
  });
  it('isWalk matches walk/hike variants', () => {
    expect(isWalk({ activityType: 'Walk' })).toBe(true);
    expect(isWalk({ activityName: 'Morning Hike' })).toBe(true);
    expect(isWalk({ activityType: 'Trekking' })).toBe(true);
    expect(isWalk({ activityType: 'Cycling' })).toBe(false);
  });
});
