// @vitest-environment jsdom
// Component/snapshot test for the shared MiniBar tile (Phase 4r.tests.1 / F).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MiniBar } from './MiniBar.jsx';

describe('MiniBar', () => {
  it('renders label, value and the rounded pct', () => {
    const { container } = render(
      <MiniBar label="Weekly miles" displayValue="34.2 / 40 mi" goalLabel="Goal: 40 mi/week" pct={0.855} />
    );
    expect(container.textContent).toContain('Weekly miles');
    expect(container.textContent).toContain('34.2 / 40 mi');
    expect(container.textContent).toContain('86%'); // Math.round(0.855 * 100)
    expect(container).toMatchSnapshot();
  });

  it('clamps the fill width to 100% when pct exceeds 1', () => {
    const { container } = render(<MiniBar label="x" displayValue="y" goalLabel="g" pct={1.4} />);
    expect(container.textContent).toContain('140%'); // label shows raw pct...
    expect(container).toMatchSnapshot();   // ...but the snapshot pins width:100% on the fill
  });
});
