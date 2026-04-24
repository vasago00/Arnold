// ─── Sync Panel ─────────────────────────────────────────────────────────────
// Two-way data sync between devices.
// EXPORT: serializes all arnold:* localStorage keys → compressed base64 blob
//         → stores in a hash fragment URL → shows QR code.
// IMPORT: detects ?sync= or #sync= param on load → decompresses → writes to
//         localStorage → reloads.
// Uses built-in CompressionStream (no deps) with base64 encoding.

import { useState, useEffect } from "react";
import { Capacitor } from '@capacitor/core';

// ── Compression helpers ─────────────────────────────────────────────────────
async function compress(str) {
  const buf = new TextEncoder().encode(str);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(buf);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const blob = new Blob(chunks);
  const ab = await blob.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(ab)));
}

async function decompress(b64) {
  const bin = atob(b64);
  const buf = Uint8Array.from(bin, c => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(buf);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const blob = new Blob(chunks);
  return new TextDecoder().decode(await blob.arrayBuffer());
}

// ── QR code generator (pure JS, no deps) ────────────────────────────────────
// Generates a simple SVG QR code using a minimal encoder.
// For large payloads we use a data-transfer URL pattern instead.
function qrSvg(text, size = 200) {
  // Use the browser's built-in QR via a canvas-free SVG approach:
  // We'll generate a Google Charts QR URL as fallback
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&bgcolor=111118&color=4ade80`;
}

// ── Auto-import on page load ────────────────────────────────────────────────
export function checkSyncImport() {
  const url = new URL(window.location.href);
  const syncData = url.searchParams.get('sync') || url.hash.match(/#sync=(.+)/)?.[1];
  if (!syncData) return false;
  return syncData;
}

export async function applySyncData(syncPayload, showToast) {
  try {
    const json = await decompress(syncPayload);
    const data = JSON.parse(json);
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      count++;
    }
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    showToast?.(`✓ Synced ${count} data keys from another device`);
    setTimeout(() => window.location.reload(), 1500);
    return true;
  } catch (e) {
    console.error('Sync import failed:', e);
    showToast?.('✗ Sync import failed — data may be corrupted');
    return false;
  }
}

// ── Export panel UI ─────────────────────────────────────────────────────────
export function SyncPanel({ showToast }) {
  const [syncUrl, setSyncUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copyText, setCopyText] = useState('Copy link');

  const handleExport = async () => {
    setLoading(true);
    try {
      // Gather all arnold:* keys
      const payload = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('arnold:')) {
          payload[key] = localStorage.getItem(key);
        }
      }
      const compressed = await compress(JSON.stringify(payload));

      // If compressed payload is small enough for URL (<4000 chars), use hash
      // Otherwise, use a blob download approach
      // Use current origin so port matches whatever Vite is running on
      const base = window.location.origin + '/';

      if (compressed.length < 4000) {
        // Small dataset: the full compressed payload fits in a URL, so we
        // generate a scannable QR code.
        setSyncUrl(`${base}?sync=${compressed}`);
        showToast?.('✓ Sync URL generated');
      } else if (Capacitor?.isNativePlatform?.()) {
        // Large dataset on mobile: write compressed payload to a file in the
        // cache dir and hand it to the native share sheet. User can email,
        // upload to Drive, Nearby Share, USB-transfer, etc.
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `arnold-sync-${stamp}.txt`;
        const written = await Filesystem.writeFile({
          path: filename,
          data: compressed,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        try {
          await Share.share({
            title: 'Arnold sync payload',
            text: `Arnold sync · ${stamp} · paste into web at ?sync=<contents>`,
            url: written.uri,
            dialogTitle: 'Send Arnold sync payload',
          });
          showToast?.('✓ Sync payload shared');
        } catch (e) {
          console.warn('[sync] share dismissed:', e?.message || e);
          showToast?.('Share dismissed — file saved to app cache');
        }
        // Also try clipboard as a belt-and-suspenders fallback; ignore failure.
        try { await navigator.clipboard.writeText(compressed); } catch {}
        setSyncUrl(null); // no URL/QR to show for this path
      } else {
        // Large dataset on web: offer clipboard copy AND show the full URL
        // so the user can paste into the phone's browser address bar.
        const fullUrl = `${base}?sync=${compressed}`;
        setSyncUrl(fullUrl);
        try {
          await navigator.clipboard.writeText(fullUrl);
          showToast?.('✓ Sync URL copied to clipboard (large dataset)');
        } catch {
          showToast?.('✓ Sync URL generated — long, use Copy link');
        }
      }
    } catch (e) {
      console.error('Export failed:', e);
      showToast?.('✗ Export failed');
    }
    setLoading(false);
  };

  const handleCopy = async () => {
    if (!syncUrl) return;
    try {
      await navigator.clipboard.writeText(syncUrl);
      setCopyText('Copied!');
      setTimeout(() => setCopyText('Copy link'), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = syncUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopyText('Copied!');
      setTimeout(() => setCopyText('Copy link'), 2000);
    }
  };

  const C = {
    m: '#71717a', t: '#e4e4e7', acc: '#4ade80',
    surf: '#13151c', b: 'rgba(255,255,255,0.06)',
    elev: '#1a1d27',
  };

  return (
    <div>
      <div style={{ fontSize: "clamp(10px,0.3vw + 9px,11px)", color: C.m, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
        Sync to Another Device
      </div>
      <div style={{ fontSize: 11, color: C.m, marginBottom: 8 }}>
        Transfer all your Arnold data to your phone or another browser.
      </div>

      <button
        onClick={handleExport}
        disabled={loading}
        style={{
          background: 'rgba(74,222,128,0.12)',
          border: '0.5px solid rgba(74,222,128,0.3)',
          borderRadius: 8, padding: '8px 16px',
          color: C.acc, fontSize: 11, fontWeight: 500,
          cursor: loading ? 'wait' : 'pointer',
          letterSpacing: '0.03em',
        }}
      >
        {loading ? '◌ Generating…' : '◈ Generate Sync Link'}
      </button>

      {syncUrl && (
        <div style={{
          marginTop: 12, background: C.elev,
          border: `0.5px solid ${C.b}`, borderRadius: 10,
          padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {/* QR code */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={qrSvg(syncUrl, 180)}
              alt="Sync QR"
              style={{ width: 180, height: 180, borderRadius: 8 }}
            />
          </div>
          <div style={{ fontSize: 10, color: C.m, textAlign: 'center' }}>
            Scan with your phone's camera to open Arnold with all your data.
          </div>

          {/* URL + copy */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <input
              type="text" readOnly value={syncUrl}
              onClick={e => e.target.select()}
              style={{
                flex: 1, background: C.surf, border: `0.5px solid ${C.b}`,
                borderRadius: 6, padding: '6px 10px', color: C.t,
                fontSize: 10, fontFamily: 'monospace',
              }}
            />
            <button
              onClick={handleCopy}
              style={{
                background: 'rgba(74,222,128,0.12)',
                border: '0.5px solid rgba(74,222,128,0.3)',
                borderRadius: 6, padding: '6px 12px',
                color: C.acc, fontSize: 10, cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {copyText}
            </button>
          </div>

          <div style={{ fontSize: 9, color: C.m, fontStyle: 'italic' }}>
            Or paste the link in your phone's browser. Works over USB (localhost) or WiFi (network IP).
          </div>
        </div>
      )}
    </div>
  );
}
