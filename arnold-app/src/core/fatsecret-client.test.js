// Tests for the PURE FatSecret→Arnold mappers (the only logic that must be exact;
// the network layer is a thin proxy call). Payloads mirror FatSecret's documented
// foods.search.v3 / food.get.v4 / barcode shapes, incl. the array-vs-object
// `serving` quirk and the gram-serving → per-100g derivation.
import { describe, it, expect } from 'vitest';
import {
  parseFsDescription, mapFsSearchItem, mapFsSearchResults,
  asServingArray, servingMacros, per100gFromServings, pickDefaultServing, mapFsFood,
} from './fatsecret-client.js';

describe('parseFsDescription', () => {
  it('parses the compact description string', () => {
    const r = parseFsDescription('Per 1 cup - Calories: 233kcal | Fat: 8.20g | Carbs: 32.00g | Protein: 8.00g');
    expect(r).toEqual({ serving: '1 cup', calories: 233, protein: 8, carbs: 32, fat: 8.2 });
  });
  it('handles "Per 100g" and returns null on junk', () => {
    expect(parseFsDescription('Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g').calories).toBe(89);
    expect(parseFsDescription('no macros here')).toBe(null);
    expect(parseFsDescription('')).toBe(null);
  });
});

describe('mapFsSearchResults — array and single-object forms', () => {
  const payload = { foods_search: { results: { food: [
    { food_id: '33691', food_name: 'Banana', brand_name: '', food_description: 'Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g' },
    { food_id: '5', food_name: 'Greek Yogurt', brand_name: 'Fage', food_description: 'Per 170g - Calories: 100kcal | Fat: 0.00g | Carbs: 6.00g | Protein: 18.00g' },
  ] } } };
  it('maps each result to the UI shape', () => {
    const out = mapFsSearchResults(payload);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: 'Banana', macros: { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 }, foodId: '33691', source: 'fatsecret' });
    expect(out[1]).toMatchObject({ name: 'Greek Yogurt', brand: 'Fage', macros: { protein: 18, calories: 100 } });
  });
  it('coerces a single-object result into a list', () => {
    const single = { foods_search: { results: { food: { food_id: '1', food_name: 'Egg', food_description: 'Per 1 large - Calories: 72kcal | Fat: 4.75g | Carbs: 0.36g | Protein: 6.28g' } } } };
    expect(mapFsSearchResults(single)).toHaveLength(1);
  });
});

describe('asServingArray + per100gFromServings + mapFsFood', () => {
  const food = { food: {
    food_id: '33691', food_name: 'Banana', brand_name: '',
    servings: { serving: [
      { serving_id: '1', serving_description: '1 medium', is_default: '1', metric_serving_amount: '118.000', metric_serving_unit: 'g', calories: '105', carbohydrate: '27.0', protein: '1.3', fat: '0.4', fiber: '3.1', sugar: '14.4' },
      { serving_id: '2', serving_description: '100 g', metric_serving_amount: '100.000', metric_serving_unit: 'g', calories: '89', carbohydrate: '22.84', protein: '1.09', fat: '0.33', fiber: '2.6', sugar: '12.23' },
    ] },
  } };
  it('normalizes array/object serving forms', () => {
    expect(asServingArray(food.food.servings)).toHaveLength(2);
    expect(asServingArray({ serving: { serving_id: 'x' } })).toHaveLength(1);
    expect(asServingArray(undefined)).toEqual([]);
  });
  it('derives per-100g from the gram serving', () => {
    const p = per100gFromServings(asServingArray(food.food.servings));
    expect(p.calories).toBe(Math.round(105 * 100 / 118)); // 89
    expect(p.protein).toBeCloseTo(1.1, 1);
  });
  it('picks the default serving and maps the full food', () => {
    const def = pickDefaultServing(asServingArray(food.food.servings));
    expect(def.serving_description).toBe('1 medium');
    const m = mapFsFood(food);
    expect(m).toMatchObject({ name: 'Banana', servingSize: '1 medium', servingWeightG: 118 });
    expect(m.macros).toMatchObject({ calories: 105, protein: 1.3, carbs: 27, fat: 0.4 });
    expect(m.servings).toHaveLength(2);
    expect(m.per100g.calories).toBe(89);
    expect(m.source).toBe('fatsecret');
  });
  it('attaches the barcode when supplied', () => {
    expect(mapFsFood(food, '0000000012345').barcode).toBe('0000000012345');
  });
  it('returns null on an empty/invalid food', () => {
    expect(mapFsFood({})).toBe(null);
    expect(mapFsFood(null)).toBe(null);
  });
});
