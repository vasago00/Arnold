// Phase 0.5 (slice 21) — HealthSystemTile (web wrapper) + HealthSystemsGrid
// extracted verbatim from Arnold.jsx. The web Health Systems 10-tile grid
// (rendered on the home/EdgeIQ surface): good/focus/deficient status dots, and
// tap-a-tile to expand the WebSystemDetail panel below the grid (single tile open
// at a time). HealthSystemTile is the thin web wrapper over the shared
// HealthTileBase (resolves desktop PNG → SVG-icon fallback). No behavior changes.
import { useState, useMemo } from "react";
import { HealthTileBase } from "./HealthSystemTile.jsx";
import { SYSTEM_ICONS } from "./systemIcons.jsx";
import { SYSTEM_PNGS_DESKTOP } from "../core/systemPngs.js";
import { getSystemsReport } from "../core/healthSystems.js";
import { healthStatusColor } from "../core/presentation/healthTokens.js";
import { WebSystemDetail } from "./WebSystemDetail.jsx";

// Phase 3.2 — thin wrapper over the shared HealthTileBase. Resolves the WEB icon
// maps (desktop PNGs → SVG fallback) and maps expand state; the skeleton lives
// once in components/HealthSystemTile.jsx.
function HealthSystemTile({ sys, isExpanded, onClick }) {
  return (
    <HealthTileBase
      sys={sys}
      variant="web"
      active={isExpanded}
      onClick={onClick}
      pngSrc={SYSTEM_PNGS_DESKTOP[sys.id]}
      svgIcon={SYSTEM_ICONS[sys.id] ? SYSTEM_ICONS[sys.id](sys.color) : null}
    />
  );
}

export function HealthSystemsGrid({ dateStr, data }) {
  const report = useMemo(() => getSystemsReport(dateStr), [dateStr]);
  const goodCount = report.filter(s => s.status === 'good').length;
  const focusCount = report.filter(s => s.status === 'focus').length;
  const defCount = report.filter(s => s.status === 'def').length;

  // Phase 4n.3.1 — single tile expands at a time. Click a tile to open
  // the WebSystemDetail panel; click the same tile again (or the close
  // button) to collapse. The panel renders BELOW the grid, not inside
  // any individual tile, so the grid stays clean and the detail has
  // full row width.
  const [expandedId, setExpandedId] = useState(null);
  const expandedSystem = expandedId ? report.find(s => s.id === expandedId) : null;

  return (
    <div style={{background:'var(--bg-surface)',border:'0.5px solid var(--border-default)',borderRadius:'var(--radius-md)',padding:'14px 16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>⬡ Health Systems</span>
        <div style={{display:'flex',gap:8,fontSize:9,color:'var(--text-muted)'}}>
          <span style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:healthStatusColor('good')}}/>{goodCount}
          </span>
          <span style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:healthStatusColor('focus')}}/>{focusCount}
          </span>
          <span style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:healthStatusColor('def')}}/>{defCount}
          </span>
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 6,
      }}>
        {report.map(sys => (
          <HealthSystemTile
            key={sys.id}
            sys={sys}
            isExpanded={expandedId === sys.id}
            onClick={() => setExpandedId(expandedId === sys.id ? null : sys.id)}
          />
        ))}
      </div>
      {expandedSystem && (
        <WebSystemDetail
          system={expandedSystem}
          comment={expandedSystem.comment}
          data={data}
          onClose={() => setExpandedId(null)}
        />
      )}
    </div>
  );
}
