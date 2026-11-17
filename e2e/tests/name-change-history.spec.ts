import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * Ticket 22 — Login-driven name history visible in UserInfo (via UserRef).
 */
test.describe('Name change history (#22)', () => {
  test('TC-22-01: empty state is an accessible status region', async ({ page }) => {
    const iss = 'mice-e2e'
    const sub = uniqueId('name-empty')
    await mintSession(page, { role: 'admin', sub, iss, name: 'Empty Viewer' })

    await page.route('**/auth/admin/principals/names?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { currentName: null, history: [] },
      })
    })
    await page.route('**/auth/admin/access-review/overdue', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', json: { overdue: [] } })
    })
    await page.route('**/auth/admin/access-review/**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          report: {
            reportId: 'r-empty',
            quarter: '2099-Q1',
            generatedAt: Date.now(),
            principals: [{ principal: { iss, sub, name: 'Empty Viewer' }, roles: [], grants: [] }],
          },
          contentHash: 'h',
        },
      })
    })

    await page.goto('/settings')
    const accessReview = page.locator('#access-review')
    await accessReview.scrollIntoViewIfNeeded()
    await accessReview.getByRole('button', { name: 'Open stored report' }).click()
    await accessReview.getByTestId('user-ref').getByRole('button').click()

    const history = page.getByTestId('user-info-name-history')
    await expect(history.getByTestId('user-info-name-history-empty')).toBeVisible()
    await expect(history.getByTestId('user-info-name-history-empty')).toHaveAttribute(
      'role',
      'status',
    )
  })

  test('TC-22-02: mintSession write path appears as history UI', async ({ page }) => {
    const iss = 'mice-e2e'
    const sub = uniqueId('name-login')
    const name = 'Login Driven Name'
    await mintSession(page, { role: 'admin', sub, iss, name })

    // No names mock — sealSession → ensurePrincipal → trackNameChange writes history.
    await page.goto('/settings')
    const admins = page.locator('#instance-administrators')
    await admins.scrollIntoViewIfNeeded()
    await admins
      .getByTestId('user-ref')
      .filter({ hasText: name })
      .getByRole('button')
      .first()
      .click()

    const history = page.getByTestId('user-info-name-history')
    await expect(history).toBeVisible({ timeout: 15_000 })
    await expect(history.locator('li').first()).toContainText(name)
    await expect(history.locator('li[data-current="true"]')).toContainText('current')
  })
})
