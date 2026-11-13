import { expect } from '@playwright/test'
import { test, openSettings } from '../fixtures'
import { mintSession } from '../helpers/session'

/**
 * Ticket 37 — Privileged group recheck failures on Settings access-review sign.
 */

test.describe('privileged group recheck UX (#37)', () => {
  test('TC-37-01: access-review sign shows directory-unavailable alert', async ({
    page,
  }) => {
    await mintSession(page, { sub: `e2e-admin-37-${Date.now()}`, role: 'admin' })
    await page.goto('/')
    await openSettings(page)
    await page.getByRole('link', { name: 'Access review', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Quarterly Access Review' })).toBeVisible()

    await page.route('**/auth/admin/access-review/generate', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          report: {
            reportId: 'r37',
            quarter: '2026-Q4',
            generatedAt: Date.now(),
            principals: [],
          },
          contentHash: 'hash-e2e-37',
        },
      })
    })

    await page.route('**/auth/admin/access-review/sign', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        json: { error: 'Directory unavailable' },
      })
    })

    await page.locator('#access-review').getByRole('button', { name: /Generate Report/i }).click()
    await expect(page.getByRole('heading', { name: /Report:/i })).toBeVisible({
      timeout: 15_000,
    })
    await page.locator('#access-review').getByRole('button', { name: /Sign report/i }).click()

    const alert = page.getByTestId('access-review-privileged-error')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveAttribute('role', 'alert')
    await expect(alert).toContainText(/Directory unavailable/i)
    await expect(alert).toContainText(/live group check/i)
  })

  test('TC-37-02: access-review sign shows group-invalid alert on 403', async ({
    page,
  }) => {
    await mintSession(page, { sub: `e2e-admin-37b-${Date.now()}`, role: 'admin' })
    await page.goto('/')
    await openSettings(page)
    await page.getByRole('link', { name: 'Access review', exact: true }).click()

    await page.route('**/auth/admin/access-review/generate', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          report: {
            reportId: 'r37b',
            quarter: '2026-Q4',
            generatedAt: Date.now(),
            principals: [],
          },
          contentHash: 'hash-e2e-37b',
        },
      })
    })

    await page.route('**/auth/admin/access-review/sign', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        json: { error: 'Forbidden' },
      })
    })

    await page.locator('#access-review').getByRole('button', { name: /Generate Report/i }).click()
    await expect(page.getByRole('heading', { name: /Report:/i })).toBeVisible({
      timeout: 15_000,
    })
    await page.locator('#access-review').getByRole('button', { name: /Sign report/i }).click()

    const alert = page.getByTestId('access-review-privileged-error')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveAttribute('role', 'alert')
    await expect(alert).toContainText(/Group membership is no longer valid/i)
  })
})
