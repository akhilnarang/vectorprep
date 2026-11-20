import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets two checkouts run their tests at the same time without sharing a server.
const PORT = Number(process.env.E2E_PORT ?? 4173);

// End-to-end tests run against the production build served by `vite preview`
// (which also sends the headers from public/_headers, including the CSP).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
