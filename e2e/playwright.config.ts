import { defineConfig, devices } from '@playwright/test'

// Prefer localhost (not 127.0.0.1) so OIDC redirect_uri / cookies match Keycloak.
const baseURL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const oxenURL = process.env.OXEN_URL ?? 'http://127.0.0.1:3001'
const slowMo = Number(process.env.SLOWMO || 0)

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  /** Stop the suite on the first failed test (fail-fast). */
  maxFailures: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // Every dataset and access change needs a reason, and cookie-session mutations need an Origin; suite traffic states both. Reason-rule tests use bare contexts.
    extraHTTPHeaders: { 'x-mice-reason': 'e2e: automated test change', origin: baseURL },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: slowMo > 0 ? { slowMo } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  metadata: { oxenURL },
})

