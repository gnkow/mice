import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * Ticket 22 — Login-driven name history visible on PrincipalNamePage.
 * Complements signature-name-history.spec (#47 mocked chronological table).
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

    await page.goto(
      `/settings/principal?iss=${encodeURIComponent(iss)}&sub=${encodeURIComponent(sub)}`,
    )

    const section = page.getByTestId('principal-name-history')
    await expect(section.getByTestId('principal-name-empty')).toBeVisible()
    await expect(section.getByTestId('principal-name-empty')).toHaveAttribute('role', 'status')
    await expect(section.getByText(/signs in with a name from the IdP/i)).toBeVisible()
  })

  test('TC-22-02: mintSession write path appears as history UI', async ({ page }) => {
    const iss = 'mice-e2e'
    const sub = uniqueId('name-login')
    const name = 'Login Driven Name'
    await mintSession(page, { role: 'admin', sub, iss, name })

    // No route mock — sealSession → ensurePrincipal → trackNameChange writes history.
    await page.goto(
      `/settings/principal?iss=${encodeURIComponent(iss)}&sub=${encodeURIComponent(sub)}`,
    )

    const section = page.getByTestId('principal-name-history')
    await expect(section.getByRole('heading', { name: 'Name history' })).toBeVisible()
    await expect(section.getByTestId('principal-current-name')).toContainText(name, {
      timeout: 15_000,
    })
    await expect(section.getByRole('table')).toBeVisible()
    await expect(section.locator('tbody tr').first()).toContainText(name)
    await expect(section.locator('tbody tr[data-current="true"]')).toContainText('current')
    await expect(section.locator('caption')).toContainText(/login-driven/i)
  })
})
