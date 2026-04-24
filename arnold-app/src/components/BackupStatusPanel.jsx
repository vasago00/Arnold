// ─── Backup Status Panel ────────────────────────────────────────────────────
// A single glance at whether your config is actually protected. Shows the
// durability state of each tier across every persistence layer:
//
//   localStorage · IndexedDB · OPFS · auto-download · cloud-sync
//
// The panel is purely informational + provides three action buttons:
//   • Export now     — force an immediate Tier C download.
//   • Import backup  — restore from a previously downloaded JSON file.
//   • Run self-heal  — re-execute the startup recovery logic on demand.

import { useEffect, useState } from 'react';
import { KEYS, storage } from '../core/storage.js';
import {
  fullKeysInTier,
  collectionsInTier,
  describeTier,
} from '../core/storage-tiers.js';
import {
  exportTierCNow,
  applyExportedSnapshot,
  getLastExportTs,
  isEnabled as isAutoExportEnabled,
  setEnabled as setAutoExportEnabled,
} from '../core/auto-export.js';
import {
  opfsInventory,
  isAvailable as opfsAvailable,
} from '../core/persist-opfs.js';
import {
  runSelfHeal,
  getLastHealReport,
} from '../core/startup-heal.js';

function fmtAgo(ts) {
  if (!ts) return 'never';
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  const m = Math.floor(delta / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function countRows(col) {
  const v = storage.get(col);
  if (v == null) return 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'object') return Object.keys(v).length;
  return 1;
}

export default function BackupStatusPanel() {
  const [opfs, setOpfs] = useState({ available: false, items: {} });
  const [heal, setHeal] = useState(getLastHealReport());
  const [exportTs, setExportTs] = useState(getLastExportTs());
  const [autoOn, setAutoOn] = useState(isAutoExportEnabled());
  const [busy, setBusy] = useState('');
  const [lastMsg, setLastMsg] = useState('');

  useEffect(() => {
    (async () => {
      const inv = await opfsInventory();
      setOpfs(inv);
    })();
  }, []);

  async function refresh() {
    const inv = await opfsInventory();
    setOpfs(inv);
    setHeal(getLastHealReport());
    setExportTs(getLastExportTs());
  }

  async function handleExport() {
    setBusy('export');
    const r = await exportTierCNow({ force: true });
    setLastMsg(r.exported ? `Exported ${r.filename} (${r.bytes} bytes)` : `Skipped: ${r.reason}`);
    setBusy('');
    refresh();
  }

  async function handleHeal() {
    setBusy('heal');
    const r = await runSelfHeal();
    setLastMsg(`Self-heal: ${r.status} (restored ${r.restoredTotal || 0} keys)`);
    setBusy('');
    refresh();
  }

  function handleImportClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setBusy('import');
      try {
        const text = await f.text();
        const r = applyExportedSnapshot(text);
        setLastMsg(r.error ? `Import failed: ${r.error}` : `Restored ${r.applied} keys (snapshot from ${r.writtenAt})`);
      } catch (e) {
        setLastMsg(`Import error: ${e.message}`);
      } finally {
        setBusy('');
        refresh();
      }
    };
    input.click();
  }

  function toggleAuto() {
    const next = !autoOn;
    setAutoOn(next);
    setAutoExportEnabled(next);
  }

  const styleCard = { padding: 14, border: '1px solid #2a2e38', borderRadius: 10, background: '#141821', color: '#e6e8ec', marginBottom: 10 };
  const styleRow = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed #20242c' };
  const styleBtn = { padding: '7px 12px', border: '1px solid #2a2e38', borderRadius: 6, background: '#1b6feb', color: '#fff', cursor: 'pointer', fontSize: 12, marginRight: 8 };
  const styleSec = { ...styleBtn, background: '#2a2e38' };
  const styleDim = { color: '#8a92a5', fontSize: 11 };

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#e6e8ec' }}>Backup status</div>

      {/* Per-tier breakdown */}
      {['C', 'B', 'A'].map(tier => {
        const meta = describeTier(tier);
        const cols = collectionsInTier(tier);
        const totalRows = cols.reduce((s, c) => s + countRows(c), 0);
        const withData = cols.filter(c => countRows(c) > 0).length;
        return (
          <div key={tier} style={styleCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: meta.color }}>Tier {tier} · {meta.label}</span>
                <div style={styleDim}>{meta.durability}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{withData}/{cols.length} collections</div>
                <div style={styleDim}>{totalRows} rows total</div>
              </div>
            </div>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
              {cols.map(c => {
                const n = countRows(c);
                const fullKey = KEYS[c];
                const inOpfs = tier === 'C' && opfs?.items?.[fullKey];
                return (
                  <div key={c} style={{ padding: '4px 6px', background: '#0b0d12', border: '1px solid #20242c', borderRadius: 4, fontSize: 11 }}>
                    <div style={{ fontWeight: 500, color: n > 0 ? '#4ade80' : '#6b7280' }}>{c}</div>
                    <div style={styleDim}>
                      {n} row{n === 1 ? '' : 's'}
                      {tier === 'C' && (inOpfs ? ' · OPFS ✓' : ' · OPFS —')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Layer status */}
      <div style={styleCard}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Durability layers</div>
        <div style={styleRow}>
          <span style={{ flex: 1 }}>OPFS (survives localStorage clear)</span>
          <span style={{ color: opfs.available ? '#4ade80' : '#f87171', fontSize: 12 }}>
            {opfs.available ? `active · ${Object.keys(opfs.items || {}).length} files` : 'unavailable'}
          </span>
        </div>
        <div style={styleRow}>
          <span style={{ flex: 1 }}>Auto-download to Downloads</span>
          <span style={{ fontSize: 12 }}>
            <label style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={autoOn} onChange={toggleAuto} style={{ marginRight: 6 }}/>
              {autoOn ? 'enabled' : 'disabled'}
            </label>
            <span style={{ ...styleDim, marginLeft: 8 }}>last: {fmtAgo(exportTs)}</span>
          </span>
        </div>
        <div style={styleRow}>
          <span style={{ flex: 1 }}>Last self-heal</span>
          <span style={{ fontSize: 12, color: heal?.status === 'intact' ? '#4ade80' : heal?.status === 'healed' ? '#60a5fa' : heal?.status === 'missing' ? '#f87171' : '#fbbf24' }}>
            {heal ? `${heal.status} · ${fmtAgo(new Date(heal.startedAt).getTime())}` : 'never run'}
          </span>
        </div>
        {heal && heal.restoredTotal > 0 && (
          <div style={{ ...styleDim, marginTop: 4 }}>
            Restored {heal.restoredTotal} key(s) from {heal.layers.filter(l => l.restored).map(l => l.layer).join(', ')}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={styleCard}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Actions</div>
        <button style={styleBtn} onClick={handleExport} disabled={!!busy}>
          {busy === 'export' ? 'Exporting…' : 'Export Tier C now'}
        </button>
        <button style={styleSec} onClick={handleImportClick} disabled={!!busy}>
          {busy === 'import' ? 'Importing…' : 'Import backup file'}
        </button>
        <button style={styleSec} onClick={handleHeal} disabled={!!busy}>
          {busy === 'heal' ? 'Healing…' : 'Run self-heal'}
        </button>
        {lastMsg && <div style={{ marginTop: 8, fontSize: 12, color: '#8a92a5' }}>{lastMsg}</div>}
      </div>
    </div>
  );
}
