// ─── useCronometerToday — React hook ────────────────────────────────────────
// Drives the live Cronometer pull. Mount it once high up in the tree (e.g.
// MobileHome or the DCY hero container) and it will:
//
//   - Fire one pull on mount (if creds + worker endpoint configured)
//   - Poll every 5 minutes while the tab is visible
//   - Refresh on tab-focus (visibilitychange)
//   - Expose refresh() for pull-to-refresh + a manual "Refresh" button
//   - Return the most recent macros + staleness metadata
//
// The hook never throws — every error surfaces via the `error` field. When
// the user hasn't configured Cronometer yet, the hook stays inert (no
// network calls, no interval).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCronometerDay,
  getLiveCacheFor,
  isConfigured,
  hasCronometerAuth,
} from '../core/cronometer-client.js';

const POLL_MS = 5 * 60 * 1000; // 5 min — matches the Worker response cache

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function useCronometerToday(dateStr) {
  const date = dateStr || localDate();

  // Seed state from live cache so first render already shows something when
  // the app comes back from background without waiting on the network.
  const seed = (() => {
    const c = getLiveCacheFor(date);
    if (!c) return null;
    return {
      date,
      totalsRaw: c.totals,
      fetchedAt: c.fetchedAt,
      cached:    c.cached,
      rowCount:  c.rowCount,
      rows:      c.rows || [],
      stale:     true, // force a refresh on mount
    };
  })();

  const [data, setData]       = useState(seed);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const abortRef  = useRef(null);
  const timerRef  = useRef(null);

  const configured = isConfigured();

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!isConfigured()) {
      setError(hasCronometerAuth() ? 'no_worker_config' : 'no_auth');
      return;
    }
    // Cancel any in-flight fetch
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await fetchCronometerDay(date, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (!r.ok) {
        setError(r.error || 'unknown');
        return;
      }
      setData({
        date: r.date,
        macros: r.macros,
        totalsRaw: r.totalsRaw,
        fetchedAt: r.fetchedAt,
        cached: r.cached,
        rowCount: r.rowCount,
        rows: r.rows || [],
        stale: false,
      });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setError(String(e?.message || e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [date]);

  // Initial pull + polling
  useEffect(() => {
    if (!configured) return;

    let cancelled = false;
    refresh();

    function tick() {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      refresh({ silent: true });
    }
    timerRef.current = setInterval(tick, POLL_MS);

    function onVisible() {
      if (document.visibilityState === 'visible') refresh({ silent: true });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
    // `refresh` is memoized on `date`; intentionally excluding `configured`
    // from deps so the hook doesn't thrash when user saves/clears creds —
    // they can call refresh() manually from the settings UI instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, configured]);

  // Staleness helper for the UI — minutes since last fetch.
  const ageMin = data?.fetchedAt ? Math.round((Date.now() - data.fetchedAt) / 60000) : null;

  return {
    date,
    configured,
    loading,
    error,
    data,
    ageMin,
    refresh,
  };
}
