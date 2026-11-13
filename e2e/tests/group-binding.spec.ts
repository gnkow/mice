import { test, expect, openAccountMenu } from '../fixtures'
import { mintSession } from '../helpers/session'

test.describe('Group binding (#31)', () => {
  test('admin opens Group binding via Settings nav and can Check', async ({ page }) => {
    await mintSession(page, { sub: 'e2e-group-binding-admin', role: 'admin' })
    await page.goto('/')
    await openAccountMenu(page)
    await page
      .locator('.profile-menu-panel')
      .getByRole('link', { name: 'Settings' })
      .click()

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByRole('link', { name: 'Group binding', exact: true }).click()

    const section = page.locator('#group-binding')
    await expect(
      section.getByRole('heading', { name: /Group binding validation/i }),
    ).toBeVisible()
    await expect(
      section.getByText(/immutable group object ids|No binding check yet|binding/i).first(),
    ).toBeVisible()

    const checkButton = section.getByRole('button', { name: /Check|Checking/i })
    await expect(checkButton).toBeVisible()
    await checkButton.click()
    await expect(
      section.locator('.flash-success, .flash-warn, .flash-error').first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})
