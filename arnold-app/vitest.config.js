// Vitest config — separate from vite.config.js so the build config is untouched.
// Phase 0.4 of the uplift: seed a test net around the pure core math + classifiers.
// Phase 4r.tests.1 (F): + component/snapshot tests for the shared tiles ("one number,
// shown identically").
//
// Component test files opt INTO a DOM with a top-of-file docblock:
//   // @vitest-environment jsdom
// so the pure-logic suites keep the fast default `node` environment.
//
// esbuild.jsx 'automatic' = the React 19 automatic JSX runtime (imports react/jsx-runtime),
// so test files don't need an explicit `import React`. The @vitejs/plugin-react path did
// NOT apply automatic JSX under vite 8 / rolldown (component tests threw "React is not
// defined"); driving the transform through esbuild here is the reliable fix.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
  },
});
