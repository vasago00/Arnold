import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './mobile.css'
import App from './App.jsx'

// ─── Resilient storage boot ─────────────────────────────────────────────────
// Order matters:
//   1. Attach OPFS mirror BEFORE any storage writes happen so Tier C writes
//      from React's first render fan out correctly.
//   2. Run startup-heal once in the background. It reads from OPFS if local
//      data is missing and repopulates storage — React will observe the new
//      state via normal re-reads on the next tick.
// Both are fire-and-forget; we don't block React mount on them because
// storage.get is synchronous-with-fallback and returns null cleanly if not
// yet hydrated.
import { attachOpfsMirror } from './core/storage.js'
import { opfsWrite } from './core/persist-opfs.js'
import { tierOfFullKey } from './core/storage-tiers.js'
import { runSelfHeal } from './core/startup-heal.js'
import { startAutoExport } from './core/auto-export.js'

attachOpfsMirror(opfsWrite, tierOfFullKey)
// Schedule heal + auto-export after the first paint so they never block UI.
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    runSelfHeal().catch(e => console.warn('[boot] self-heal failed:', e))
    startAutoExport().catch(e => console.warn('[boot] auto-export start failed:', e))
  }, { once: true })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
