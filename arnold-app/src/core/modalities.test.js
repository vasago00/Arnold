// Tests for the modality profile's PURE reads (the gate for cross-train swaps).
// getModalities/setModalities are storage-backed (integration); here we lock the pure
// capability logic the swap ladder depends on.
import { describe, it, expect } from 'vitest';
import { capabilitiesFor, hasModalityProfile, ownedModalities, MODALITY_CAP } from './modalities.js';

describe('capabilitiesFor', () => {
  it('accepts a profile object and returns owned capability records', () => {
    const caps = capabilitiesFor({ bike: true, pool: false, gym: true });
    expect(caps.map((c) => c.key).sort()).toEqual(['bike', 'gym']);
    expect(caps.find((c) => c.key === 'bike').vo2).toBe(true);
  });

  it('accepts a keys array too', () => {
    expect(capabilitiesFor(['rower']).map((c) => c.key)).toEqual(['rower']);
  });

  it('jointSafeOnly drops running-impact modalities (treadmill) but keeps pool/bike/gym', () => {
    const keys = capabilitiesFor({ pool: true, bike: true, treadmill: true, gym: true }, { jointSafeOnly: true }).map((c) => c.key);
    expect(keys).toContain('pool');
    expect(keys).toContain('bike');
    expect(keys).toContain('gym');
    expect(keys).not.toContain('treadmill');
  });

  it('every capability carries trains/jointSafe/how', () => {
    for (const cap of capabilitiesFor(['pool', 'bike', 'treadmill', 'gym', 'elliptical', 'rower'])) {
      expect(Array.isArray(cap.trains)).toBe(true);
      expect(typeof cap.jointSafe).toBe('boolean');
      expect(typeof cap.how).toBe('string');
      expect(MODALITY_CAP[cap.key]).toBeTruthy();
    }
  });
});

describe('profile predicates', () => {
  it('hasModalityProfile is true only when ≥1 owned', () => {
    expect(hasModalityProfile({ pool: false, bike: false })).toBe(false);
    expect(hasModalityProfile(null)).toBe(false);
    expect(hasModalityProfile({ bike: true })).toBe(true);
  });

  it('ownedModalities lists owned keys in canonical order', () => {
    expect(ownedModalities({ rower: true, pool: true, bike: true })).toEqual(['pool', 'bike', 'rower']);
    expect(ownedModalities(null)).toEqual([]);
  });
});
