// @vitest-environment jsdom
// Reactivity test for LearnedHero — guards the "stale window" bug where the
// card computed its data in a useMemo([]) at mount and never refreshed when
// storage changed (Cloud Sync pull / fresh Garmin/Cronometer sync). The card
// must re-derive on a storage change event.
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

// Mutable holders the mocks read, so we can simulate "new data landed" between
// renders. vi.hoisted keeps them defined before the hoisted vi.mock factories run.
const S = vi.hoisted(() => ({ facts: null, energy: null }));
vi.mock('../core/hub/hubDebug.js', () => ({ buildHubFromStorage: () => ({ facts: S.facts }) }));
vi.mock('../core/energyExpenditure.js', () => ({ energyExpenditure: () => S.energy }));

import { notifyStorageChanged } from '../core/storage.js';
import { LearnedHero } from './LearnedHero.jsx';

describe('LearnedHero reactivity', () => {
  it('re-derives from storage when a change event fires (no stale window)', () => {
    S.facts  = { responses: [], predictions: [], sweat: null, refEquivSecs: 1000 };
    S.energy = { maintenance: { value: 800, note: 'from estimate' } };

    const { container } = render(<LearnedHero />);
    expect(container.textContent).toContain('800 kcal');
    expect(container.textContent).toContain('from estimate');

    // Simulate a Cloud Sync pull / fresh sync writing new data.
    S.energy = { maintenance: { value: 950, note: "from today's expenditure" } };
    act(() => { notifyStorageChanged('arnold:test'); });

    // The footer must reflect the new numbers, not the mount-time snapshot.
    expect(container.textContent).toContain('950 kcal');
    expect(container.textContent).toContain("from today's expenditure");
    expect(container.textContent).not.toContain('800 kcal');
  });
});
