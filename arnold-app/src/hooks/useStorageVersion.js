// ─── useStorageVersion ───────────────────────────────────────────────────────
// React hook that forces a re-render whenever the storage layer fires a
// change event. Subscribes via storage.onStorageChange (already wired in
// storage.js) and bumps a counter that callers can include in their useMemo
// or useEffect dep arrays.
//
// USAGE:
//   const storageVersion = useStorageVersion();
//   const ctx = useMemo(() => buildTileContext({...}), [today, storageVersion]);
//
// Without this hook, components that compute derived state inside useMemo([])
// only rebuild on mount — meaning Cloud Sync pulls, manual edits, or any
// external storage change wouldn't surface until force-close + reopen. Now
// they re-render automatically as soon as a write completes.

import { useEffect, useState } from 'react';
import { onStorageChange, setCloudApplying } from '../core/storage.js';

export function useStorageVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = onStorageChange(() => {
      setVersion((v) => v + 1);
    });
    return unsubscribe;
  }, []);
  return version;
}

// Re-export for convenience — callers that batch writes can wrap them with
// setCloudApplying(true)/setCloudApplying(false) to suppress per-key change
// events and emit a single "all done" event at the end.
export { setCloudApplying };
