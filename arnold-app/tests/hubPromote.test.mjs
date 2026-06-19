// Tests for hub-driven Start-tile promotion (core/hub/promote.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { hubScoreTile, nextRaceDays } from '../src/core/hub/promote.js';

const TODAY = '2026-06-06';
// A hub that has learned a confident heat sensitivity.
const hubHeat = { response: { factors: { heat: { value: 0.01, precision: 2 } } } };

test('nextRaceDays returns the soonest upcoming race, ignoring past', () => {
  const races = [{ date: '2026-06-01' }, { date: '2026-06-20' }, { date: '2026-06-10' }];
  assert.equal(nextRaceDays(races, TODAY), 4);   // 06-10
  assert.equal(nextRaceDays([{ date: '2026-01-01' }], TODAY), null); // all past
  assert.equal(nextRaceDays([], TODAY), null);
});

test('race proximity promotes the predictor', () => {
  const m = { id: 'racePredictor', category: 'run' };
  const near = hubScoreTile(m, null, null, { today: TODAY, races: [{ date: '2026-06-09' }] });
  const none = hubScoreTile(m, null, null, { today: TODAY, races: [] });
  assert.ok(near.score > none.score);
  assert.ok(near.reasons.some(r => /race in 3d/.test(r)));
});

test('heat sensitivity × hot day strongly surfaces recovery; cool day is base', () => {
  const m = { id: 'hydration', category: 'recovery' };
  const hot = hubScoreTile(m, null, null, { hubState: hubHeat, conditions: { tempC: 30 }, today: TODAY });
  const cool = hubScoreTile(m, null, null, { hubState: hubHeat, conditions: { tempC: 14 }, today: TODAY });
  assert.ok(hot.score > cool.score, `${hot.score} should exceed ${cool.score}`);
  assert.ok(hot.reasons.some(r => /adverse/.test(r)));
});

test('a non-sensitive factor / unrelated category gets no sensitivity boost', () => {
  const m = { id: 'someRunTile', category: 'run' };
  const r = hubScoreTile(m, null, null, { hubState: hubHeat, conditions: { tempC: 30 }, today: TODAY });
  assert.ok(!r.reasons.some(rr => /sensitive/.test(rr))); // heat domain is 'recovery', not 'run'
});

test('a red status still surfaces (alerts retained)', () => {
  const m = { id: 'rhr', category: 'recovery', thresholds: { red: 60 } };
  const deriveStatus = (v, thr) => (v >= thr.red ? 'red' : 'neutral');
  const r = hubScoreTile(m, { week: 65 }, null, { today: TODAY, deriveStatus });
  assert.ok(r.reasons.includes('needs attention'));
  assert.ok(r.score >= 3);
});

test('nutrition tile with nothing logged today is gated out', () => {
  const m = { id: 'carbs', category: 'body', subgroup: 'fuel' };
  const r = hubScoreTile(m, null, { value: 0 }, { today: TODAY });
  assert.equal(r.score, 0);
});
