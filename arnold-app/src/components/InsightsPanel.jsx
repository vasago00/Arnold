// ─── InsightsPanel (Phase 4r.intel.12 — Layer 4 UI) ────────────────────────
// Renders the active list of statistically-gated patterns from insights.js.
// Each insight is a card with a severity stripe (info / attention / concern),
// a one-line headline, a longer detail paragraph, and an evidence footer
// (n / period / p-value when applicable). Empty state: a one-line "nothing
// significant yet — log more sessions" hint with the minimum-n threshold.

import { useEffect, useMemo, useState } from 'react';
import { generateInsights } from '../core/insights.js';
import { storage } from '../core/storage.js';
import { allActivities as getUnifiedActivities } from '../core/dcyMath.js';
import { cleanSleepForAveraging } from '../core/parsers/sleepParser.js';
import { getGoals } from '../core/goals.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';
import {
  ChartLineUp, Lightning, Moon, Heartbeat, Scales, Info,
} from '@phosphor-icons/react';

const SEVERITY_STYLE = {
  info:      { color: '#60a5fa', label: 'Info',      bg: 'rgba(96,165,250,0.10)', border: 'rgba(96,165,250,0.40)' },
  attention: { color: '#fbbf24', label: 'Attention', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.40)' },
  concern:   { color: '#f87171', label: 'Concern',   bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.40)' },
};

const CATEGORY_ICON = {
  training:  <Lightning size={12} weight="duotone" />,
  recovery:  <Moon size={12} weight="duotone" />,
  nutrition: <ChartLineUp size={12} weight="duotone" />,
  body:      <Scales size={12} weight="duotone" />,
  cross:     <Heartbeat size={12} weight="duotone" />,
};

/**
 * Pulls the data Arnold normally keeps in storage and runs insights.js.
 * Memoized on storageVersion so it re-runs when any storage key changes
 * (Cloud Sync apply, manual edit, scheduled task write).
 */
function useInsights() {
  const storageVersion = useStorageVersion();
  return useMemo(() => {
    try {
      const data = {
        activities: getUnifiedActivities(),
        sleep:      cleanSleepForAveraging(storage.get('sleep') || []),
        hrv:        storage.get('hrv') || [],
        weight:     storage.get('weight') || [],
        cronometer: storage.get('cronometer') || [],
        profile:    { ...(storage.get('profile') || {}), ...getGoals() },
      };
      return generateInsights(data);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[InsightsPanel] generateInsights threw:', e?.message || e);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion]);
}

function InsightCard({ insight }) {
  const sev = SEVERITY_STYLE[insight.severity] || SEVERITY_STYLE.info;
  const icon = CATEGORY_ICON[insight.category] || <Info size={12} weight="duotone" />;
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderLeft: `2px solid ${sev.color}`,
      borderRadius: 'var(--radius-md, 8px)',
      padding: '10px 12px',
      marginBottom: 8,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: 8, marginBottom: 4,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 9, fontWeight: 700, color: sev.color, letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}>
          {icon}
          {sev.label} · {insight.category}
        </span>
        <span style={{
          fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>
          n={insight.evidence?.n ?? '—'}{insight.evidence?.period ? ` · ${insight.evidence.period}` : ''}
          {Number.isFinite(insight.evidence?.pValue) && insight.evidence.pValue < 0.10
            ? ` · p=${insight.evidence.pValue.toFixed(2)}`
            : ''}
        </span>
      </div>
      <div style={{
        fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
        lineHeight: 1.35, marginBottom: 4,
      }}>
        {insight.headline}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-secondary, var(--text-muted))',
        lineHeight: 1.4,
      }}>
        {insight.detail}
      </div>
    </div>
  );
}

/**
 * Public component. Pass `compact` to render in a tighter, mobile-friendly
 * variant (smaller fonts, less padding, no section header).
 */
export function InsightsPanel({ compact = false, maxItems = 5 }) {
  const insights = useInsights();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth <= 600
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const shown = (insights || []).slice(0, maxItems);

  // Empty state when nothing's significant yet.
  if (!shown.length) {
    return (
      <div style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-md, 8px)',
        padding: '12px 14px',
        fontSize: 11, color: 'var(--text-muted)',
        lineHeight: 1.4,
      }}>
        {compact ? null : (
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
            letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 6,
          }}>Insights</div>
        )}
        Nothing significant in the data yet. Keep logging — most patterns need
        at least 5 sessions plus statistical significance (p &lt; 0.10) before
        Arnold surfaces them here.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: compact ? 4 : 8 }}>
      {!compact && (
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.10em', textTransform: 'uppercase',
          marginBottom: 6, padding: '0 2px',
        }}>
          Insights · {shown.length}{insights.length > maxItems ? ` of ${insights.length}` : ''}
        </div>
      )}
      {shown.map(ins => <InsightCard key={ins.id} insight={ins}/>)}
    </div>
  );
}

export default InsightsPanel;
