import { test, expect, openAccountMenu } from '../fixtures'
import { mintSession } from '../helpers/session'

test.describe('Principal re-enable (#27)', () => {
  test('admin opens Re-enable via Settings nav and sees empty queue', async ({ page }) => {
    await mintSession(page, { sub: 'e2e-reenable-admin', role: 'admin' })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByRole('link', { name: 'Re-enable', exact: true }).click()

    const section = page.locator('#re-enable')
    await expect(section.getByRole('heading', { name: /Re-enable/i })).toBeVisible()
    await expect(
      section.getByText(/No Principals are in a disable period/i),
    ).toBeVisible()
    await expect(section.getByText(/None awaiting/i)).toBeVisible()
  })

  test('confirm without reason shows accessible validation error', async ({ page }) => {
    await mintSession(page, { sub: 'e2e-reenable-admin2', role: 'admin' })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()
    await page.getByRole('link', { name: 'Re-enable', exact: true }).click()

    const section = page.locator('#re-enable')
    await page.route('**/auth/admin/re-enable', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            periods: [
              {
                principal: 'mice-e2e|long-disabled',
                disabledAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
                awaitingConfirmation: true,
              },
            ],
          }),
        })
        return
      }
      await route.continue()
    })
    await page.reload()
    await page.getByRole('link', { name: 'Re-enable', exact: true }).click()

    await expect(section.getByRole('button', { name: 'Confirm' })).toBeVisible()
    await section.getByRole('button', { name: 'Confirm' }).click()
    await expect(section.getByRole('alert')).toContainText(/Reason must be at least 10 characters/i)
  })
})
