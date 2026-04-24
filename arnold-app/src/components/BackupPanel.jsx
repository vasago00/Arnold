// ─── BackupPanel ─────────────────────────────────────────────────────────────
// Manual export/import + auto-backup status display for the Profile tab.

import { useState, useRef } from 'react';
import {
  exportBackup, importBackup, importBackupFromText, createBackup,
  listBackups, restoreFromSlot, getBackupMeta,
} from '../core/backup.js';

export function BackupPanel({ showToast }) {
  const [backups, setBackups] = useState(() => listBackups());
  const [meta, setMeta] = useState(() => getBackupMeta());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef(null);

  const refresh = () => {
    setBackups(listBackups());
    setMeta(getBackupMeta());
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const r = await exportBackup();
      if (r.method === 'native-share') {
        showToast?.(`Shared ${r.keyCount} keys — pick a target`);
      } else {
        showToast?.(`Exported ${r.keyCount} keys to Downloads`);
      }
    } catch (e) {
      showToast?.(`Export failed: ${e.message || e}`);
    } finally {
      setExporting(false);
    }
  };

  const handlePasteImport = () => {
    const txt = pasteText.trim();
    if (!txt) {
      showToast?.('Paste the backup JSON first');
      return;
    }
    try {
      const result = importBackupFromText(txt);
      showToast?.(`Restored ${result.restored} keys from pasted text`);
      setPasteText('');
      setPasteOpen(false);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      showToast?.(`Paste-import failed: ${err.message}`);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importBackup(file);
      showToast?.(`Restored ${result.restored} keys`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      showToast?.(`Import failed: ${err.message}`);
    }
    // Reset file input
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleManualBackup = () => {
    const result = createBackup();
    if (result) {
      showToast?.(`Backup saved (slot ${result.slot}, ${result.keyCount} keys)`);
      refresh();
    } else {
      showToast?.('No data to back up');
    }
  };

  const handleRestore = (slot) => {
    if (!window.confirm('Restore from this backup? Current data will be overwritten.')) return;
    try {
      const result = restoreFromSlot(slot);
      showToast?.(`Restored ${result.restored} keys from ${new Date(result.timestamp).toLocaleString()}`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      showToast?.(`Restore failed: ${err.message}`);
    }
  };

  const fmtSize = (bytes) => bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const panelStyle = {
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
    marginTop: 12,
  };

  const btnStyle = {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.15s',
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
          ◈ Data Backup
        </div>
        {meta.lastBackup && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Last auto-backup: {fmtTime(meta.lastBackup)}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={handleExport} disabled={exporting} style={{ ...btnStyle, background: 'rgba(74,222,128,0.15)', color: '#4ade80', opacity: exporting ? 0.6 : 1 }}>
          {exporting ? '… Exporting' : '↓ Export backup'}
        </button>
        <label style={{ ...btnStyle, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', display: 'inline-flex', alignItems: 'center' }}>
          ↑ Import backup
          <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
        </label>
        <button onClick={() => setPasteOpen(v => !v)} style={{ ...btnStyle, background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
          {pasteOpen ? '× Hide paste' : '⎘ Paste backup'}
        </button>
        <button onClick={handleManualBackup} style={{ ...btnStyle, background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
          ⟳ Backup now
        </button>
      </div>

      {/* Paste-JSON fallback: handy when file transfer between devices isn't
          available. Accepts either a full export wrapper or a raw { 'arnold:*': ... }
          object. */}
      {pasteOpen && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '0.5px solid rgba(251,191,36,0.2)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
            Paste the contents of an Arnold backup JSON below and click Import.
          </div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder='{"exportedAt":"…","data":{"arnold:profile":"…"}}'
            spellCheck={false}
            style={{ width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 10, padding: 8, borderRadius: 6, background: '#0b0d12', color: '#e6e8ec', border: '0.5px solid rgba(255,255,255,0.08)', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handlePasteImport} style={{ ...btnStyle, background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>
              ✓ Import pasted JSON
            </button>
            <button onClick={() => { setPasteText(''); }} style={{ ...btnStyle, background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Backup history */}
      {backups.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Local snapshots ({backups.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {backups.map((b) => (
              <div key={b.slot} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', borderRadius: 6,
                background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)',
              }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {fmtTime(b.timestamp)} · {b.keyCount} keys · {fmtSize(b.size)}
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(b.slot)}
                  style={{ ...btnStyle, padding: '4px 10px', fontSize: 10, background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
        Auto-backup runs every 6 hours. Keeps 3 rolling snapshots.
      </div>
    </div>
  );
}
