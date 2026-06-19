// @vitest-environment jsdom
// Component/snapshot test for the SHARED MetricTile primitive (Phase 4r.tests.1 / F).
// This is the "one number, shown identically on web + mobile" tile — the audit's
// snapshot target. The test pins that the value renders and the gauge draws, and
// snapshots the markup so an accidental divergence is caught.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MetricTile } from './MetricTile.jsx';

describe('MetricTile (shared primitive)', () => {
  it('renders the value, label, and the semicircle gauge', () => {
    const { container } = render(
      <MetricTile
        label="VO₂max" todayVal="51" todayUnit="ml/kg/min"
        trendText="+2 vs 30d" trendColor="#4ade80"
        avg30="49" avg30Label="30d avg"
        gaugePct={0.7} color="#60a5fa"
      />
    );
    expect(container.textContent).toContain('51');     // the value
    expect(container.textContent).toContain('VO₂max'); // the label
    expect(container.querySelector('svg')).toBeInTheDocument(); // MiniArcGauge
    expect(container).toMatchSnapshot();
  });

  it('renders without a gauge fill at pct 0 (still deterministic)', () => {
    const { container } = render(
      <MetricTile label="Resting HR" todayVal="48" todayUnit="bpm" gaugePct={0} color="#a78bfa" />
    );
    expect(container.textContent).toContain('48');
    expect(container).toMatchSnapshot();
  });
});
