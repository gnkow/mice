import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BOXEN_BASE_URL ?? 'http://127.0.0.1:5173'
const oxenURL = process.env.OXEN_URL ?? 'http://127.0.0.1:3001'
const slowMo = Number(process.env.SLOWMO || 0)

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: slowMo > 0 ? { slowMo } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  metadata: { oxenURL },
})

