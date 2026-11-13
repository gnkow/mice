import { expect } from '@playwright/test'
import { cleanTest as test, openSettings } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * Ticket 41 — Unsigned 14+ day access-review overdue alert in Settings.
 */
test.describe('Access review overdue alert (#41)', () => {
  test('TC-41-01: overdue banner is role=alert and links open the report', async ({ page }) => {
    const quarter = '2025-Q1'
    const reportId = 'ar-overdue-e2e'
    await mintSession(page, {
      sub: uniqueId('ar-overdue'),
      role: 'admin',
      iss: 'mice-e2e',
    })

    await page.route('**/auth/admin/access-review/overdue', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { overdue: [{ quarter, reportId }] },
      })
    })
    await page.route(`**/auth/admin/access-review/${encodeURIComponent(quarter)}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          report: {
            reportId,
            quarter,
            generatedAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
            principals: [],
          },
          contentHash: 'overdue-hash',
        },
      })
    })

    await page.goto('/')
    await openSettings(page)
    await page.getByRole('link', { name: 'Access review', exact: true }).click()

    const section = page.locator('#access-review')
    const alert = section.getByTestId('access-review-overdue-alert')
    await expect(alert).toHaveAttribute('role', 'alert')
    await expect(alert).toContainText(/Unsigned for 14\+ days/i)
    await expect(alert).toContainText(reportId)

    await section.getByTestId(`access-review-overdue-link-${quarter}`).click()
    await expect(section.getByRole('heading', { name: `Report: ${quarter}` })).toBeVisible({
      timeout: 10_000,
    })
    await expect(section.getByRole('status').filter({ hasText: /Opened stored report/i })).toBeVisible()
  })
})
