import { test, expect, openAccountMenu } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

async function openDelegated(page: import('@playwright/test').Page) {
  await page.goto('/')
  await openAccountMenu(page)
  await page
    .locator('.profile-menu-panel')
    .getByRole('link', { name: 'Settings' })
    .click()
  await page
    .getByRole('list', { name: 'Access' })
    .getByRole('link', { name: 'Delegated permissions', exact: true })
    .click()
  return page.locator('#delegated-permissions')
}

test.describe('Delegated permission expiry (#14)', () => {
  test('TC-DEL-01: empty state and required expiry field', async ({ page }) => {
    await mintSession(page, { sub: uniqueId('del-empty'), role: 'admin' })
    await page.route('**/auth/instance', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enforce: true, admins: [], permissions: [] }),
      })
    })

    const section = await openDelegated(page)
    await expect(section.getByRole('heading', { name: 'Delegated permissions' })).toBeVisible()
    await expect(section.getByTestId('delegated-empty')).toBeVisible()
    await expect(section.getByLabel(/Expires \(required\)/i)).toBeVisible()
    await expect(section.getByTestId('delegated-expiry-hint')).toContainText(
      /future expiry|rejected/i,
    )
    await expect(
      section.getByText(/daily job revokes expired grants/i),
    ).toBeVisible()
  })

  test('TC-DEL-02: grant list shows soon and expired chips', async ({ page }) => {
    await mintSession(page, { sub: uniqueId('del-chips'), role: 'admin' })
    const soon = Date.now() + 2 * 24 * 60 * 60 * 1000
    const expired = Date.now() - 60_000
    await page.route('**/auth/instance', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enforce: true,
          admins: [],
          permissions: [
            {
              sub: 'soon-user',
              iss: 'mice-e2e',
              permissions: ['create_namespace'],
              expiresAt: soon,
            },
            {
              sub: 'expired-user',
              iss: 'mice-e2e',
              permissions: ['view_audit'],
              expiresAt: expired,
            },
          ],
        }),
      })
    })

    const section = await openDelegated(page)
    const chips = section.getByTestId('delegated-expiry-chip')
    await expect(chips).toHaveCount(2)
    await expect(chips.filter({ hasText: /Expires in/i }).first()).toHaveAttribute(
      'data-expiry-tone',
      'soon',
    )
    await expect(chips.filter({ hasText: /^Expired$/i }).first()).toHaveAttribute(
      'data-expiry-tone',
      'expired',
    )
  })
})
