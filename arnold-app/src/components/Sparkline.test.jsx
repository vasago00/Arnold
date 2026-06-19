// @vitest-environment jsdom
// Component/snapshot test for the shared Sparkline tile (Phase 4r.tests.1 / F).
// Sparkline is pure (data -> SVG path), so its output is deterministic and a good
// first guard that the tiles render identically everywhere.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline.jsx';

describe('Sparkline', () => {
  it('renders a dashed placeholder line when given fewer than 2 points', () => {
    const { container } = render(<Sparkline data={[5]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('line')).toBeInTheDocument(); // placeholder, not a trajectory
    expect(container.querySelector('path')).toBeNull();
    expect(container).toMatchSnapshot();
  });

  it('draws a deterministic trajectory path for a real series', () => {
    const { container } = render(<Sparkline data={[10, 12, 11, 15, 18]} width={60} height={18} />);
    expect(container.querySelector('path')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });
});
