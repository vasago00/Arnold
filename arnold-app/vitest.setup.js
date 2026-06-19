// Vitest global setup. Registers @testing-library/jest-dom matchers
// (toBeInTheDocument, etc.) on vitest's `expect` for the component/snapshot tests.
// Safe to load for the node-env logic suites too — it only extends `expect`,
// it does not touch the DOM at import time.
import '@testing-library/jest-dom/vitest';
