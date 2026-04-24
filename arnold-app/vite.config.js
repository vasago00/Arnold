import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build-time cache buster — Rolldown's content hash is stable across semantically
// identical bundles, which makes the HTTP cache silently serve stale JS after
// a non-trivial source change. Appending a per-build timestamp guarantees a
// fresh filename every `vite build` so browsers and Capacitor's WebView must
// refetch.
const BUILD_ID = Date.now().toString(36)

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: true,
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_ID}[extname]`,
      },
    },
  },
})
