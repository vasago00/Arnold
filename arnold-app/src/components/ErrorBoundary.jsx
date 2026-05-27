// ─── ErrorBoundary — Phase 4r.hygiene.1 ───────────────────────────────────
//
// Wraps a tab's content so a component-level crash shows a graceful
// error UI instead of blanking the whole tab. Motivated by the 4r.dataspine.5
// "Daily tab blank screen" bug: a `dyn is not defined` ReferenceError
// inside NutritionInput took down the entire Daily tab. React's
// component-level error propagation walks UP to the nearest boundary;
// without one, it goes to the React root, which renders nothing for
// the whole tab.
//
// Usage:
//   <ErrorBoundary tabName="Daily">
//     <DailyTabContent />
//   </ErrorBoundary>
//
// Each tab gets its own boundary so a crash in one tab doesn't take
// down sibling tabs. The boundary's UI shows:
//   - Tab name + "encountered an error" headline
//   - The error message (so the user can copy/paste when reporting)
//   - A "Reload" button that retries the render (resets state)
//
// Boundaries MUST be class components — React's error API (getDerivedStateFromError
// and componentDidCatch) has no hook equivalent as of React 19.

import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    // React calls this when a child throws during render.
    return { error };
  }

  componentDidCatch(error, info) {
    // Log to console so the developer can pick it up. The boundary's
    // own UI shows the message to the user too, but a structured
    // console.error captures the stack trace.
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.tabName ? `:${this.props.tabName}` : ''}] caught:`,
      error,
      info?.componentStack
    );
    this.setState({ info });
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const tab = this.props.tabName || 'This tab';
    const message = this.state.error?.message || String(this.state.error);

    return (
      <div style={{
        background: 'var(--bg-elevated, rgba(255,255,255,0.04))',
        border: '0.5px solid rgba(248,113,113,0.4)',
        borderLeft: '3px solid #f87171',
        borderRadius: 8,
        padding: '14px 16px',
        margin: '12px 0',
        color: 'var(--text-primary, #fff)',
        fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#f87171',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          marginBottom: 6,
        }}>
          {tab} — render error
        </div>
        <div style={{
          fontSize: 13, fontWeight: 500, lineHeight: 1.4,
          color: 'var(--text-primary, #fff)', marginBottom: 8,
        }}>
          Something went wrong rendering this tab. The other tabs still work.
        </div>
        <pre style={{
          fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          color: 'rgba(255,255,255,0.65)',
          background: 'rgba(0,0,0,0.25)',
          padding: '8px 10px', borderRadius: 4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          margin: 0,
          maxHeight: 120, overflow: 'auto',
        }}>{message}</pre>
        <button
          type="button"
          onClick={this.reset}
          style={{
            marginTop: 10,
            background: 'rgba(96,165,250,0.12)',
            border: '0.5px solid rgba(96,165,250,0.4)',
            color: '#60a5fa',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          Retry render
        </button>
        <div style={{
          marginTop: 8,
          fontSize: 10, color: 'rgba(255,255,255,0.45)',
          fontStyle: 'italic',
        }}>
          Full stack trace in DevTools console under `[ErrorBoundary{tab && `:${tab}`}]`.
        </div>
      </div>
    );
  }
}
