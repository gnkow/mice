import { expect } from '@playwright/test'
import { cleanTest as test, openSettings } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * Ticket 34 — Automatic seal-key rotation schedule status in Settings.
 * API has no next-run/last-tick endpoint; UI derives status from current key validFrom.
 */
test.describe('Seal key rotation schedule (#34)', () => {
  test('TC-34-01: schedule status region shows 30-day basis and next eligible', async ({
    page,
  }) => {
    const validFrom = Math.floor(Date.UTC(2026, 0, 1) / 1000)
    await mintSession(page, {
      sub: uniqueId('seal-sched'),
      role: 'admin',
      iss: 'mice-e2e',
    })

    await page.route('**/auth/admin/seal-keys/current', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          key: {
            id: 'seal_e2e_current',
            validFrom,
            validUntil: null,
            revokedAt: null,
            rotationType: 'normal',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'current',
            isCurrent: true,
          },
        },
      })
    })
    await page.route('**/auth/admin/seal-keys', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { keys: [] },
      })
    })

    await page.goto('/')
    await openSettings(page)
    await page.getByRole('link', { name: 'Seal keys', exact: true }).click()

    const section = page.locator('#seal-key-rotation')
    await expect(section.getByRole('heading', { name: 'Automatic rotation schedule' })).toBeVisible()

    const status = section.getByTestId('seal-key-schedule-status')
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toContainText(/30-day schedule/i)
    await expect(status).toContainText(/Next eligible/i)
    await expect(status.getByText('Schedule basis (key issued)')).toBeVisible()
    await expect(status.getByText('Next eligible automatic run')).toBeVisible()
  })
})
