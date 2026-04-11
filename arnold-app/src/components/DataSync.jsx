// ─── DataSync: Export / Import all Arnold data ──────────────────────────────
// Enables moving all localStorage data between devices (PC ↔ Phone).
// Export: dumps all arnold:* keys into a downloadable JSON file.
// Import: reads a JSON file and merges into localStorage, then reloads.

import { useState, useRef } from 'react';

// All known arnold: keys (from storage.js KEYS + extras not in the map)
const ARNOLD_KEYS = [
  'arnold:garmin-activities',
  'arnold:garmin-hrv',
  'arnold:garmin-sleep',
  'arnold:garmin-weight',
  'arnold:cronometer',
  'arnold:workouts',
  'arnold:profile',
  'arnold:goals',
  'arnold:planner',
  'arnold:races',
  'arnold:logs',
  'arnold:import-history',
  'arnold:events',
  'arnold:diagnostics',
  'arnold:ai-cache',
  'arnold:daily-logs',
  'arnold:nutrition-log',
  'arnold:supplements-stack',
  'arnold:supplements-adherence',
  'arnold:migration:v1',
];

function getAllArnoldData() {
  const data = {};
  // Grab all known keys
  for (const key of ARNOLD_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) data[key] = val;
  }
  // Also scan for any arnold:* keys we might have missed
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('arnold:') && !(key in data)) {
      data[key] = localStorage.getItem(key);
    }
  }
  data._exportedAt = new Date().toISOString();
  data._version = 'arnold-sync-v1';
  return data;
}

function importArnoldData(data) {
  let count = 0;
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith('_')) continue; // skip metadata
    if (!key.startsWith('arnold:')) continue; // safety: only arnold keys
    localStorage.setItem(key, val);
    count++;
  }
  return count;
}

export function DataSync({ variant = 'desktop' }) {
  const [status, setStatus] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();

  const isMobile = variant === 'mobile';

  const handleExport = () => {
    try {
      const data = getAllArnoldData();
      const json = JSON.stringify(data);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arnold-sync-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const keyCount = Object.keys(data).filter(k => !k.startsWith('_')).length;
      const sizeMB = (json.length / 1024 / 1024).toFixed(1);
      setStatus(`✓ Exported ${keyCount} data stores (${sizeMB} MB)`);
      setTimeout(() => setStatus(null), 5000);
    } catch (e) {
      setStatus(`✗ Export failed: ${e.message}`);
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data._version !== 'arnold-sync-v1') {
        setStatus('✗ Not a valid Arnold sync file');
        setImporting(false);
        return;
      }

      const count = importArnoldData(data);
      setStatus(`✓ Imported ${count} data stores from ${data._exportedAt?.slice(0, 10) || 'unknown date'}`);
      setImporting(false);

      // Reload after short delay so user sees the success message
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setStatus(`✗ Import failed: ${e.message}`);
      setImporting(false);
    }
  };

  // ─── Mobile styling ────────────────────────────────────────────────────────
  if (isMobile) {
    const glass = {
      background: 'rgba(20, 22, 30, 0.65)',
      backdropFilter: 'blur(20px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ ...glass, padding: '16px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            DATA SYNC
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 14, lineHeight: 1.5 }}>
            Export your data from your PC, then import it here to sync all your history.
          </div>

          <button onClick={handleExport} style={{
            width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'rgba(96,165,250,0.12)', color: '#60a5fa', fontSize: 13, fontWeight: 600,
            marginBottom: 8,
          }}>
            ↓ Export data from this device
          </button>

          <button onClick={() => fileRef.current?.click()} disabled={importing} style={{
            width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'rgba(74,222,128,0.12)', color: '#4ade80', fontSize: 13, fontWeight: 600,
          }}>
            {importing ? 'Importing...' : '↑ Import data from file'}
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }} />

          {status && (
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 10,
              background: status.startsWith('✓') ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
              color: status.startsWith('✓') ? '#4ade80' : '#ef4444',
              fontSize: 11, fontWeight: 500, textAlign: 'center',
            }}>
              {status}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Desktop styling ───────────────────────────────────────────────────────
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Data Sync</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>PC ↔ Phone</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Export all your data to a file, then import on another device to sync your history, workouts, nutrition, goals, and settings.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleExport} style={{
          flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--bg-elevated)', color: 'var(--text-accent)', fontSize: 12, fontWeight: 500,
        }}>
          ↓ Export all data
        </button>

        <button onClick={() => fileRef.current?.click()} disabled={importing} style={{
          flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 500,
        }}>
          {importing ? 'Importing...' : '↑ Import from file'}
        </button>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }} />
      </div>

      {status && (
        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8,
          background: status.startsWith('✓') ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
          color: status.startsWith('✓') ? '#4ade80' : '#ef4444',
          fontSize: 11, fontWeight: 500,
        }}>
          {status}
        </div>
      )}
    </div>
  );
}
